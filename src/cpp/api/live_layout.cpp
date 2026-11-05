// Live layout (doc/design/live-layout-incremental.md): keep the laid-out document and apply the page's attribute changes
// to it, instead of building the document again from HTML for every read of a box.
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <initializer_list>
#include <string>
#include <vector>

#include <litehtml/document.h>
#include <litehtml/element.h>

#include "layout_json.h"
#include "satoru_api.h"

namespace {

bool tag_is_one_of(const char* tag, std::initializer_list<const char*> names) {
    for (const char* n : names)
        if (tag && strcmp(tag, n) == 0) return true;
    return false;
}

// Can the children of this element be replaced from HTML parsed as if in a <body>? Not inside what the parser treats on its
// own (tables, forms' selects, raw text, templates, foreign content) or where a document-wide thing hangs (style).
bool can_replace_children(const std::shared_ptr<litehtml::element>& el) {
    for (auto a = el; a; a = a->parent()) {
        const char* tag = a->get_tagName();
        if (a != el && tag_is_one_of(tag, {"html"})) continue; // every body element has the html element above it
        if (tag_is_one_of(tag, {"html", "head", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "caption",
                                "select", "optgroup", "option", "textarea", "style", "script", "title", "template", "noscript",
                                "iframe", "object", "svg", "math", "frameset", "datalist"}))
            return false;
    }
    return true;
}

// New content that needs more than a layout: style sheets, resources to fetch, tables, forms the parser reshapes.
bool content_needs_rebuild(const std::string& html) {
    std::string lower = html;
    for (auto& ch : lower) ch = (char)tolower((unsigned char)ch);
    static const char* const bad[] = {"<style", "<link", "<script", "<base", "<template", "<table", "<tr", "<td", "<th",
                                     "<tbody", "<thead", "<tfoot", "<caption", "<colgroup", "<col", "<img", "<picture",
                                     "<video", "<audio", "<source", "<iframe", "<object", "<embed", "<meta", "<title",
                                     "<image", "<input", "<select", "<textarea", "<svg", "<math", "<noscript", "<frame"};
    for (const char* b : bad)
        if (lower.find(b) != std::string::npos) return true;
    return false;
}

void collect_ids(const std::shared_ptr<litehtml::element>& el,
                 std::unordered_map<uint32_t, std::weak_ptr<litehtml::element>>& ids) {
    if (!el) return;
    // the page marks every element with a class token `qjsl-<id>` (see __edgeMarkLayout in quickjs-dom)
    const char* cls = el->get_attr("class");
    if (cls) {
        const char* p = cls;
        while (*p) {
            while (*p == ' ') p++;
            const char* start = p;
            while (*p && *p != ' ') p++;
            if (p - start > 5 && strncmp(start, "qjsl-", 5) == 0) {
                char* end = nullptr;
                unsigned long v = strtoul(start + 5, &end, 10);
                if (end == p) ids[(uint32_t)v] = el;
                break;
            }
        }
    }
    for (const auto& c : el->children()) collect_ids(c, ids);
}

}  // namespace

// Builds (or reuses) the document for `html` and learns which element carries which id.
void satoru_api_live_open(SatoruInstance* inst, const std::string& html, int width, int mediaType) {
    if (!inst) return;
    inst->collect_resources(html, width, 0, mediaType);
    inst->live_ids.clear();
    inst->live_width = width;
    if (inst->doc) collect_ids(inst->doc->root(), inst->live_ids);
}

// ops: entries separated by \x02, each `id \x01 name \x01 kind \x01 value` (kind "0" set, "1" remove).
// Returns true when every op was applied and the document was laid out again; false asks the caller to open the document anew.
bool satoru_api_live_apply(SatoruInstance* inst, const std::string& ops, int width) {
    if (!inst || !inst->doc || inst->live_ids.empty()) return false;
    struct op {
        uint32_t id;
        std::string name, value;
        bool remove;
        bool kids;
    };
    std::vector<op> list;
    size_t pos = 0;
    while (pos < ops.size()) {
        size_t end = ops.find('\x02', pos);
        if (end == std::string::npos) end = ops.size();
        std::string entry = ops.substr(pos, end - pos);
        pos = end + 1;
        size_t a = entry.find('\x01');
        size_t b = a == std::string::npos ? a : entry.find('\x01', a + 1);
        size_t c = b == std::string::npos ? b : entry.find('\x01', b + 1);
        if (c == std::string::npos) return false;
        op o;
        o.id = (uint32_t)strtoul(entry.substr(0, a).c_str(), nullptr, 10);
        o.name = entry.substr(a + 1, b - a - 1);
        const std::string kind = entry.substr(b + 1, c - b - 1);
        o.remove = kind == "1";
        o.kids = kind == "2";
        o.value = entry.substr(c + 1);
        list.push_back(std::move(o));
    }
    // Elements the ops refer to by id are taken before anything changes: moving one means it leaves its old parent first.
    std::unordered_map<uint32_t, std::shared_ptr<litehtml::element>> pool;
    for (const auto& o : list) {
        if (!o.kids) continue;
        size_t p = 0;
        while (p <= o.value.size()) {
            size_t e = o.value.find('\x03', p);
            if (e == std::string::npos) e = o.value.size();
            if (e > p && o.value[p] == 'E') {
                uint32_t id = (uint32_t)strtoul(o.value.substr(p + 1, e - p - 1).c_str(), nullptr, 10);
                auto it = inst->live_ids.find(id);
                auto el = it == inst->live_ids.end() ? nullptr : it->second.lock();
                if (!el) return false;
                pool[id] = el;
            }
            p = e + 1;
        }
    }
    std::vector<std::shared_ptr<litehtml::element>> changed, scopes;
    bool attrs_only = true; // every op sets an attribute that styles and nothing else reads
    for (const auto& o : list) {
        auto it = inst->live_ids.find(o.id);
        auto el = it == inst->live_ids.end() ? nullptr : it->second.lock();
        if (!el) return false;
        if (o.kids) {
            attrs_only = false;
            if (!can_replace_children(el)) return false;
            // value: segments joined by \x03, `E<id>` an element the host already has, `H<html>` new content
            std::vector<std::shared_ptr<litehtml::element>> items, fresh;
            size_t p = 0;
            while (p <= o.value.size()) {
                size_t e = o.value.find('\x03', p);
                if (e == std::string::npos) e = o.value.size();
                if (e > p) {
                    if (o.value[p] == 'E') {
                        items.push_back(pool[(uint32_t)strtoul(o.value.substr(p + 1, e - p - 1).c_str(), nullptr, 10)]);
                    } else {
                        std::string html = o.value.substr(p + 1, e - p - 1);
                        if (content_needs_rebuild(html)) return false;
                        std::vector<std::shared_ptr<litehtml::element>> parsed;
                        if (!inst->doc->live_parse_fragment(html.c_str(), parsed)) return false;
                        for (const auto& n : parsed) {
                            items.push_back(n);
                            fresh.push_back(n);
                        }
                    }
                }
                p = e + 1;
            }
            auto restyle = inst->doc->live_set_children(el, items, fresh);
            for (const auto& s : restyle) scopes.push_back(s);
            for (const auto& n : fresh) collect_ids(n, inst->live_ids);
            continue;
        }
        std::string lname = o.name;
        for (auto& ch : lname) ch = (char)tolower((unsigned char)ch);
        if (!(lname == "class" || lname == "style" || lname == "id" || lname == "title" || lname == "role" ||
              lname == "tabindex" || lname.rfind("data-", 0) == 0 || lname.rfind("aria-", 0) == 0))
            attrs_only = false;
        if (lname == "class") {
            // keep the page's marker: it is how the boxes are matched to elements
            std::string cls = "qjsl-" + std::to_string(o.id);
            if (!o.remove && !o.value.empty()) cls += " " + o.value;
            inst->doc->live_set_attr(el, "class", cls.c_str());
        } else {
            inst->doc->live_set_attr(el, o.name.c_str(), o.remove ? nullptr : o.value.c_str());
        }
        changed.push_back(el);
    }
    inst->doc->live_relayout(changed, scopes, (litehtml::pixel_t)width, attrs_only);
    // the document no longer matches the HTML it was built from: a plain layout call must not reuse it
    inst->last_parsed_html = "\x01live";
    return true;
}
