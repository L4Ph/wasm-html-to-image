#include "layout_json.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

#include <litehtml/document.h>
#include <litehtml/element.h>
#include <litehtml/render_item.h>

namespace {

using litehtml::element;

bool is_tree_element(const std::shared_ptr<element>& el) {
    if (!el || el->is_text() || el->is_comment() || el->is_white_space()) return false;
    const char* tag = el->get_tagName();
    // "-tag-before" / "-tag-after" are the engine's pseudo-element nodes, "anonymous" its table fix-ups:
    // neither exists in a browser's element tree, and counting them would shift every later index.
    return tag && tag[0] && tag[0] != '-' && strcmp(tag, "anonymous") != 0;
}

struct path_index {
    // Index of an element among its parent's element children, filled one parent at a time.
    std::unordered_map<const element*, int> index;
    std::unordered_map<const element*, std::string> memo;

    const std::string& path_of(const std::shared_ptr<element>& el) {
        auto it = memo.find(el.get());
        if (it != memo.end()) return it->second;
        auto parent = el->parent();
        std::string p;
        if (parent) {
            if (!index.count(el.get())) {
                int n = 0;
                for (const auto& c : parent->children()) {
                    if (is_tree_element(c)) index[c.get()] = n++;
                }
            }
            p = path_of(parent) + "." + std::to_string(index[el.get()]);
        } else {
            p = "0";
        }
        return memo.emplace(el.get(), std::move(p)).first->second;
    }
};

std::string escaped(const char* s, size_t max_len) {
    std::string out;
    if (!s) return out;
    size_t n = 0;
    for (; *s && n < max_len; ++s, ++n) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') {
            out += '\\';
            out += (char)c;
        } else if (c < 0x20) {
            out += ' ';
        } else {
            out += (char)c;
        }
    }
    return out;
}

bool is_replaced_tag(const char* tag) {
    static const char* names[] = {"img", "svg", "video", "canvas", "iframe", "input", "select", "textarea"};
    for (const char* n : names) {
        if (strcmp(tag, n) == 0) return true;
    }
    return false;
}

void number(std::string& out, double v) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%.2f", std::round(v * 100.0) / 100.0);
    out += buf;
}

struct style_vals {
    int display, position, flt, visibility, overflow_x, overflow_y, text_align;
    unsigned color;  // r << 24 | g << 16 | b << 8 | a
    double font_size, opacity;
    double box[12];  // margin, padding, border: top right bottom left
    int has_box;
};

struct box_entry {
    std::string p;
    std::string t;
    std::string i;
    std::string c;
    litehtml::style_display display = litehtml::display_none;
    double x = 0, y = 0, w = 0, h = 0;
    bool has_cells = false;  // table rows only: any direct cell child entry
    style_vals sv{};         // computed style (with include_style)
    bool has_style = false;
};

const char* display_name(litehtml::style_display d) {
    using namespace litehtml;
    switch (d) {
        case display_none: return "none";
        case display_block: return "block";
        case display_inline: case display_inline_text: return "inline";
        case display_inline_block: return "inline-block";
        case display_inline_table: return "inline-table";
        case display_list_item: return "list-item";
        case display_table: return "table";
        case display_table_caption: return "table-caption";
        case display_table_cell: return "table-cell";
        case display_table_column: return "table-column";
        case display_table_column_group: return "table-column-group";
        case display_table_footer_group: return "table-footer-group";
        case display_table_header_group: return "table-header-group";
        case display_table_row: return "table-row";
        case display_table_row_group: return "table-row-group";
        case display_flex: return "flex";
        case display_inline_flex: return "inline-flex";
        case display_webkit_box: return "-webkit-box";
        case display_webkit_inline_box: return "-webkit-inline-box";
        case display_grid: return "grid";
        case display_inline_grid: return "inline-grid";
        case display_contents: return "contents";
        case display_flow_root: return "flow-root";
    }
    return "block";
}

const char* overflow_name(litehtml::overflow o) {
    using namespace litehtml;
    switch (o) {
        case overflow_hidden: return "hidden";
        case overflow_scroll: return "scroll";
        case overflow_auto: return "auto";
        case overflow_clip: return "clip";
        default: return "visible";
    }
}

// The used values litehtml computed for an element, kept as numbers so that two answers can be compared without
// formatting either (live layout compares every element on every read).

double round2(double v) { return std::round(v * 100.0) / 100.0; }

style_vals collect_style(const std::shared_ptr<element>& el, const std::shared_ptr<litehtml::render_item>& ri) {
    using namespace litehtml;
    style_vals v;
    memset(&v, 0, sizeof(v));
    const css_properties& css = el->css();
    v.display = css.get_display();
    v.position = css.get_position() & 3;
    v.flt = css.get_float() % 3;
    v.visibility = css.get_visibility() % 3;
    v.overflow_x = css.get_overflow_x();
    v.overflow_y = css.get_overflow_y();
    v.text_align = css.get_text_align() % 6;
    web_color c = css.get_color();
    v.color = ((unsigned)c.red << 24) | ((unsigned)c.green << 16) | ((unsigned)c.blue << 8) | c.alpha;
    v.font_size = round2(css.get_font_size());
    v.opacity = round2(css.get_opacity());
    if (ri) {
        v.has_box = 1;
        v.box[0] = round2(ri->margin_top());
        v.box[1] = round2(ri->margin_right());
        v.box[2] = round2(ri->margin_bottom());
        v.box[3] = round2(ri->margin_left());
        v.box[4] = round2(ri->padding_top());
        v.box[5] = round2(ri->padding_right());
        v.box[6] = round2(ri->padding_bottom());
        v.box[7] = round2(ri->padding_left());
        v.box[8] = round2(ri->border_top());
        v.box[9] = round2(ri->border_right());
        v.box[10] = round2(ri->border_bottom());
        v.box[11] = round2(ri->border_left());
    }
    return v;
}

// The body of a JSON object (px numbers, CSS keywords).
std::string style_to_json(const style_vals& v) {
    using namespace litehtml;
    std::string o;
    auto key = [&](const char* k) {
        if (!o.empty()) o += ',';
        o += '"';
        o += k;
        o += "\":";
    };
    auto str = [&](const char* k, const char* val) {
        key(k);
        o += '"';
        o += val;
        o += '"';
    };
    auto num = [&](const char* k, double val) {
        key(k);
        number(o, val);
    };
    str("display", display_name((style_display)v.display));
    const char* pos[] = {"static", "relative", "absolute", "fixed"};
    str("position", pos[v.position]);
    const char* fl[] = {"none", "left", "right"};
    str("float", fl[v.flt]);
    const char* vis[] = {"visible", "hidden", "collapse"};
    str("visibility", vis[v.visibility]);
    str("overflowX", overflow_name((overflow)v.overflow_x));
    str("overflowY", overflow_name((overflow)v.overflow_y));
    const char* ta[] = {"left", "right", "center", "justify", "start", "end"};
    str("textAlign", ta[v.text_align]);
    key("color");
    char buf[64];
    const unsigned r = v.color >> 24, g = (v.color >> 16) & 255, b = (v.color >> 8) & 255, a = v.color & 255;
    if (a == 255) snprintf(buf, sizeof(buf), "\"rgb(%u, %u, %u)\"", r, g, b);
    else snprintf(buf, sizeof(buf), "\"rgba(%u, %u, %u, %.3g)\"", r, g, b, a / 255.0);
    o += buf;
    num("fontSize", v.font_size);
    num("opacity", v.opacity);
    if (v.has_box) {
        static const char* names[12] = {"marginTop", "marginRight", "marginBottom", "marginLeft", "paddingTop", "paddingRight",
                                        "paddingBottom", "paddingLeft", "borderTop", "borderRight", "borderBottom", "borderLeft"};
        for (int i = 0; i < 12; i++) num(names[i], v.box[i]);
    }
    return o;
}

void walk(const std::shared_ptr<litehtml::render_item>& ri, path_index& paths,
          std::vector<box_entry>& entries, bool include_inline, bool with_style) {
    if (!ri) return;
    const auto& el = ri->src_el();
    if (is_tree_element(el)) {
        const auto display = el->css().get_display();
        const char* tag = el->get_tagName();
        const bool inline_box = display == litehtml::display_inline || display == litehtml::display_inline_text;
        if ((!inline_box || is_replaced_tag(tag)) && strcmp(tag, "br") != 0) {
            litehtml::position pl = ri->get_placement();
            box_entry e;
            e.p = paths.path_of(el);
            e.t = escaped(tag, 32);
            e.i = escaped(el->get_attr("id"), 60);
            e.c = escaped(el->get_attr("class"), 80);
            e.display = display;
            e.x = pl.x - ri->padding_left() - ri->border_left();
            e.y = pl.y - ri->padding_top() - ri->border_top();
            e.w = ri->pos().width + ri->padding_left() + ri->padding_right() + ri->border_left() + ri->border_right();
            e.h = ri->pos().height + ri->padding_top() + ri->padding_bottom() + ri->border_top() + ri->border_bottom();
            if (with_style) { e.sv = collect_style(el, ri); e.has_style = true; }
            entries.push_back(std::move(e));
        } else if (include_inline && display == litehtml::display_inline && strcmp(tag, "br") != 0) {
            // an inline element fragments across lines: report the box that encloses all its fragments
            litehtml::position::vector fragments;
            ri->get_rendering_boxes(fragments);
            if (!fragments.empty()) {
                double x0 = fragments[0].x, y0 = fragments[0].y;
                double x1 = x0 + fragments[0].width, y1 = y0 + fragments[0].height;
                for (const auto& f : fragments) {
                    x0 = std::min(x0, (double)f.x);
                    y0 = std::min(y0, (double)f.y);
                    x1 = std::max(x1, (double)f.x + f.width);
                    y1 = std::max(y1, (double)f.y + f.height);
                }
                box_entry e;
                e.p = paths.path_of(el);
                e.t = escaped(tag, 32);
                e.i = escaped(el->get_attr("id"), 60);
                e.c = escaped(el->get_attr("class"), 80);
                e.display = display;
                e.x = x0;
                e.y = y0;
                e.w = x1 - x0;
                e.h = y1 - y0;
                if (with_style) { e.sv = collect_style(el, ri); e.has_style = true; }
                entries.push_back(std::move(e));
            }
        }
    }
    for (const auto& child : ri->children()) walk(child, paths, entries, include_inline, with_style);
}

bool is_direct_child(const std::string& parent, const std::string& path) {
    if (path.size() <= parent.size() + 1) return false;
    if (path.compare(0, parent.size(), parent) != 0 || path[parent.size()] != '.') return false;
    return path.find('.', parent.size() + 1) == std::string::npos;
}

// Table layout positions the cells and never writes a row's (or row group's) own size back to
// its render item, so rows would report a 0x0 box even though the table paints correctly.
// Rebuild those boxes the way a browser reports them: a row's height band comes from its own
// cells, its inline extent is the table's full column band (a short row still spans every
// column), and a row group's box is the union of its rows.
bool is_ancestor_path(const std::string& ancestor, const std::string& path) {
    return path.size() > ancestor.size() && path.compare(0, ancestor.size(), ancestor) == 0 &&
           path[ancestor.size()] == '.';
}

void fix_up_table_boxes(std::vector<box_entry>& entries) {
    // Everything here goes through indexes by path: a table of a thousand rows must not scan the entries for each row.
    auto parent_of = [](const std::string& path) {
        const size_t dot = path.rfind('.');
        return dot == std::string::npos ? std::string() : path.substr(0, dot);
    };
    const bool any_table = std::any_of(entries.begin(), entries.end(), [](const box_entry& e) {
        return e.display == litehtml::display_table_row || e.display == litehtml::display_table_cell;
    });
    if (!any_table) return;
    std::unordered_map<std::string, std::vector<size_t>> children;  // parent path -> direct children, in order
    std::unordered_map<std::string, size_t> by_path;
    children.reserve(entries.size());
    by_path.reserve(entries.size());
    for (size_t i = 0; i < entries.size(); i++) {
        const std::string& p = entries[i].p;
        const size_t dot = p.rfind('.');
        if (dot != std::string::npos && dot > 0 && dot + 1 < p.size()) children[p.substr(0, dot)].push_back(i);
        by_path.emplace(p, i);
    }
    auto unite_children = [&](box_entry& parent, litehtml::style_display child_display) {
        auto it = children.find(parent.p);
        if (it == children.end()) return;
        bool found = false;
        double x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        for (size_t idx : it->second) {
            const auto& e = entries[idx];
            if (e.display != child_display) continue;
            if (!found) {
                x0 = e.x; y0 = e.y; x1 = e.x + e.w; y1 = e.y + e.h;
                found = true;
            } else {
                x0 = std::min(x0, e.x); y0 = std::min(y0, e.y);
                x1 = std::max(x1, e.x + e.w); y1 = std::max(y1, e.y + e.h);
            }
        }
        if (found) {
            parent.x = x0; parent.y = y0; parent.w = x1 - x0; parent.h = y1 - y0;
        }
    };
    for (auto& e : entries) {
        if (e.display != litehtml::display_table_row) continue;
        auto it = children.find(e.p);
        if (it == children.end()) continue;
        for (size_t idx : it->second) {
            if (entries[idx].display == litehtml::display_table_cell) {
                e.has_cells = true;
                break;
            }
        }
    }
    for (auto& e : entries) {
        if (e.display == litehtml::display_table_row) unite_children(e, litehtml::display_table_cell);
    }
    // Widen every row to its table's column band: the band is the union of all rows
    // that share the same nearest table ancestor (a row of a nested table is not one of them).
    auto is_table = [](const box_entry& e) {
        return e.display == litehtml::display_table || e.display == litehtml::display_inline_table;
    };
    auto nearest_table = [&](const std::string& path) -> long {
        std::string p = path;
        for (;;) {
            const size_t dot = p.rfind('.');
            if (dot == std::string::npos) return -1;
            p.resize(dot);
            auto it = by_path.find(p);
            if (it != by_path.end() && is_table(entries[it->second])) return (long)it->second;
        }
    };
    std::vector<long> table_of(entries.size(), -1);
    struct band { bool found = false; double x0 = 0, x1 = 0; };
    std::unordered_map<long, band> bands;
    for (size_t i = 0; i < entries.size(); i++) {
        if (entries[i].display != litehtml::display_table_row) continue;
        table_of[i] = nearest_table(entries[i].p);
        if (table_of[i] < 0 || entries[i].w <= 0) continue;
        band& b = bands[table_of[i]];
        if (!b.found) { b.x0 = entries[i].x; b.x1 = entries[i].x + entries[i].w; b.found = true; }
        else { b.x0 = std::min(b.x0, entries[i].x); b.x1 = std::max(b.x1, entries[i].x + entries[i].w); }
    }
    for (size_t i = 0; i < entries.size(); i++) {
        if (table_of[i] < 0) continue;
        auto it = bands.find(table_of[i]);
        if (it == bands.end() || !it->second.found) continue;
        entries[i].x = it->second.x0;
        entries[i].w = it->second.x1 - it->second.x0;
    }
    // A row with no cells at all (an empty <tr>, e.g. a styled spacer row) paints
    // nothing but still occupies its grid slot: the following rows are placed
    // after it. The union above cannot see it, so interpolate its band from the
    // neighbouring rows of the same parent when both exist. Runs of consecutive
    // empty rows keep the degenerate box (their split of the gap is unknowable
    // from boxes alone), as do empty first/last rows.
    {
        std::unordered_map<std::string, std::vector<size_t>> rows_of;  // parent path -> its rows, in order
        for (size_t i = 0; i < entries.size(); i++)
            if (entries[i].display == litehtml::display_table_row) rows_of[parent_of(entries[i].p)].push_back(i);
        for (const auto& kv : rows_of) {
            const auto& rows = kv.second;
            for (size_t k = 0; k < rows.size(); k++) {
                box_entry& row = entries[rows[k]];
                if (row.has_cells || k == 0 || k + 1 == rows.size()) continue;
                const box_entry* prev = &entries[rows[k - 1]];
                const box_entry* next = &entries[rows[k + 1]];
                if (prev->has_cells && next->has_cells) {
                    row.y = prev->y + prev->h;
                    row.h = std::max(0.0, next->y - row.y);
                }
            }
        }
    }
    for (auto& e : entries) {
        if (e.display == litehtml::display_table_row_group ||
            e.display == litehtml::display_table_header_group ||
            e.display == litehtml::display_table_footer_group) {
            unite_children(e, litehtml::display_table_row);
        }
    }
}

}  // namespace

std::string satoru_api_layout_json(SatoruInstance* inst, const std::string& html, int width,
                                   int height, int mediaType, bool include_inline, bool include_style) {
    if (!inst) return "[]";
    width = normalize_viewport_width(width);
    if (!inst->document_ready_for(html, width, height, mediaType)) {
        inst->collect_resources(html, width, height, mediaType);
    }
    return satoru_api_layout_json_current(inst, include_inline, include_style);
}

std::string satoru_api_layout_json_current(SatoruInstance* inst, bool include_inline, bool include_style) {
    if (!inst || !inst->doc || !inst->doc->root_render()) return "[]";
    path_index paths;
    std::vector<box_entry> entries;
    walk(inst->doc->root_render(), paths, entries, include_inline, include_style);
    fix_up_table_boxes(entries);
    std::string out = "[";
    bool first = true;
    for (const auto& e : entries) {
        if (!first) out += ',';
        first = false;
        out += "{\"p\":\"";
        out += e.p;
        out += "\",\"t\":\"";
        out += e.t;
        out += "\",\"i\":\"";
        out += e.i;
        out += "\",\"c\":\"";
        out += e.c;
        out += "\",\"x\":";
        number(out, e.x);
        out += ",\"y\":";
        number(out, e.y);
        out += ",\"w\":";
        number(out, e.w);
        out += ",\"h\":";
        number(out, e.h);
        if (include_style) {
            out += ",\"s\":{";
            out += style_to_json(e.sv);
            out += '}';
        }
        out += '}';
    }
    out += ']';
    return out;
}

// The id of the `qjsl-<id>` token in an element's class attribute (the page's marker); false when it has none.
static bool marker_id(const std::string& cls, uint32_t& id) {
    size_t pos = 0;
    while (pos < cls.size()) {
        while (pos < cls.size() && cls[pos] == ' ') pos++;
        size_t end = cls.find(' ', pos);
        if (end == std::string::npos) end = cls.size();
        if (end - pos > 5 && cls.compare(pos, 5, "qjsl-") == 0) {
            char* stop = nullptr;
            unsigned long v = strtoul(cls.c_str() + pos + 5, &stop, 10);
            if (stop == cls.c_str() + end) {
                id = (uint32_t)v;
                return true;
            }
        }
        pos = end;
    }
    return false;
}

// Live layout: the boxes and used styles of the held document by element id, `{"<id>":[x,y,w,h,{style}], ...}`.
// With `delta` only the elements that differ from the last answer are listed, and an element that left the render tree
// (display:none, removed) is listed as null; without it everything is listed and the memory of the last answer is reset.
// Elements are compared as numbers; only the ones that differ are formatted.
std::string satoru_api_live_boxes(SatoruInstance* inst, bool delta) {
    if (!inst || !inst->doc || !inst->doc->root_render()) return "{}";
    path_index paths;
    std::vector<box_entry> entries;
    walk(inst->doc->root_render(), paths, entries, true, true);
    fix_up_table_boxes(entries);
    if (!delta) inst->live_prev.clear();
    std::string out = "{";
    bool first = true;
    std::unordered_map<uint32_t, bool> seen;
    for (const auto& e : entries) {
        uint32_t id;
        if (!marker_id(e.c, id)) continue;
        seen[id] = true;
        struct {
            double g[4];
            style_vals s;
        } now;
        memset(&now, 0, sizeof(now));
        now.g[0] = round2(e.x);
        now.g[1] = round2(e.y);
        now.g[2] = round2(e.w);
        now.g[3] = round2(e.h);
        now.s = e.sv;
        std::string bytes((const char*)&now, sizeof(now));
        auto it = inst->live_prev.find(id);
        if (it != inst->live_prev.end() && it->second == bytes) continue;
        if (!first) out += ',';
        first = false;
        out += '"' + std::to_string(id) + "\":[";
        number(out, e.x);
        out += ',';
        number(out, e.y);
        out += ',';
        number(out, e.w);
        out += ',';
        number(out, e.h);
        out += ",{";
        out += style_to_json(e.sv);
        out += "}]";
        inst->live_prev[id] = std::move(bytes);
    }
    for (auto it = inst->live_prev.begin(); it != inst->live_prev.end();) {
        if (seen.count(it->first)) {
            ++it;
            continue;
        }
        if (!first) out += ',';
        first = false;
        out += '"' + std::to_string(it->first) + "\":null";
        it = inst->live_prev.erase(it);
    }
    out += '}';
    return out;
}
