// Live layout (doc/design/live-layout-incremental.md): keep the laid-out document and apply the page's attribute changes
// to it, instead of building the document again from HTML for every read of a box.
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <litehtml/document.h>
#include <litehtml/element.h>

#include "layout_json.h"
#include "satoru_api.h"

namespace {

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
        o.remove = entry.substr(b + 1, c - b - 1) == "1";
        o.value = entry.substr(c + 1);
        list.push_back(std::move(o));
    }
    std::vector<std::shared_ptr<litehtml::element>> changed;
    for (const auto& o : list) {
        auto it = inst->live_ids.find(o.id);
        auto el = it == inst->live_ids.end() ? nullptr : it->second.lock();
        if (!el) return false;
        std::string lname = o.name;
        for (auto& ch : lname) ch = (char)tolower((unsigned char)ch);
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
    inst->doc->live_relayout(changed, (litehtml::pixel_t)width);
    // the document no longer matches the HTML it was built from: a plain layout call must not reuse it
    inst->last_parsed_html = "\x01live";
    return true;
}
