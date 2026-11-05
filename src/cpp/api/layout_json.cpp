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

struct box_entry {
    std::string p;
    std::string t;
    std::string i;
    std::string c;
    litehtml::style_display display = litehtml::display_none;
    double x = 0, y = 0, w = 0, h = 0;
    bool has_cells = false;  // table rows only: any direct cell child entry
    std::string style;       // computed-style object body (with include_style)
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

// The used values litehtml computed for an element, as the body of a JSON object (px numbers, CSS keywords).
std::string style_json(const std::shared_ptr<element>& el, const std::shared_ptr<litehtml::render_item>& ri) {
    using namespace litehtml;
    const css_properties& css = el->css();
    std::string o;
    auto key = [&](const char* k) {
        if (!o.empty()) o += ',';
        o += '"';
        o += k;
        o += "\":";
    };
    auto str = [&](const char* k, const char* v) {
        key(k);
        o += '"';
        o += v;
        o += '"';
    };
    auto num = [&](const char* k, double v) {
        key(k);
        number(o, v);
    };
    str("display", display_name(css.get_display()));
    const char* pos[] = {"static", "relative", "absolute", "fixed"};
    str("position", pos[css.get_position() & 3]);
    const char* fl[] = {"none", "left", "right"};
    str("float", fl[css.get_float() % 3]);
    const char* vis[] = {"visible", "hidden", "collapse"};
    str("visibility", vis[css.get_visibility() % 3]);
    str("overflowX", overflow_name(css.get_overflow_x()));
    str("overflowY", overflow_name(css.get_overflow_y()));
    const char* ta[] = {"left", "right", "center", "justify", "start", "end"};
    str("textAlign", ta[css.get_text_align() % 6]);
    web_color c = css.get_color();
    key("color");
    char buf[64];
    if (c.alpha == 255) snprintf(buf, sizeof(buf), "\"rgb(%d, %d, %d)\"", c.red, c.green, c.blue);
    else snprintf(buf, sizeof(buf), "\"rgba(%d, %d, %d, %.3g)\"", c.red, c.green, c.blue, c.alpha / 255.0);
    o += buf;
    num("fontSize", css.get_font_size());
    num("opacity", css.get_opacity());
    if (ri) {
        num("marginTop", ri->margin_top());
        num("marginRight", ri->margin_right());
        num("marginBottom", ri->margin_bottom());
        num("marginLeft", ri->margin_left());
        num("paddingTop", ri->padding_top());
        num("paddingRight", ri->padding_right());
        num("paddingBottom", ri->padding_bottom());
        num("paddingLeft", ri->padding_left());
        num("borderTop", ri->border_top());
        num("borderRight", ri->border_right());
        num("borderBottom", ri->border_bottom());
        num("borderLeft", ri->border_left());
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
            if (with_style) e.style = style_json(el, ri);
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
                if (with_style) e.style = style_json(el, ri);
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
    auto unite_children = [&](box_entry& parent, litehtml::style_display child_display) {
        bool found = false;
        double x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        for (const auto& e : entries) {
            if (e.display != child_display || !is_direct_child(parent.p, e.p)) continue;
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
        for (const auto& c : entries) {
            if (c.display == litehtml::display_table_cell && is_direct_child(e.p, c.p)) {
                e.has_cells = true;
                break;
            }
        }
    }
    for (auto& e : entries) {
        if (e.display == litehtml::display_table_row) unite_children(e, litehtml::display_table_cell);
    }
    // Widen every row to its table's column band: the band is the union of all rows
    // that share the same nearest table ancestor.
    for (auto& row : entries) {
        if (row.display != litehtml::display_table_row) continue;
        const box_entry* table = nullptr;
        for (const auto& e : entries) {
            if ((e.display == litehtml::display_table || e.display == litehtml::display_inline_table) &&
                is_ancestor_path(e.p, row.p) && (!table || e.p.size() > table->p.size())) {
                table = &e;
            }
        }
        if (!table) continue;
        bool found = false;
        double x0 = 0, x1 = 0;
        for (auto& other : entries) {
            if (other.display != litehtml::display_table_row || !is_ancestor_path(table->p, other.p)) continue;
            bool nested = false;
            for (const auto& e : entries) {
                if ((e.display == litehtml::display_table || e.display == litehtml::display_inline_table) &&
                    e.p.size() > table->p.size() && is_ancestor_path(table->p, e.p) &&
                    is_ancestor_path(e.p, other.p)) {
                    nested = true;
                    break;
                }
            }
            if (nested || other.w <= 0) continue;
            if (!found) {
                x0 = other.x; x1 = other.x + other.w;
                found = true;
            } else {
                x0 = std::min(x0, other.x); x1 = std::max(x1, other.x + other.w);
            }
        }
        if (found) {
            row.x = x0;
            row.w = x1 - x0;
        }
    }
    // A row with no cells at all (an empty <tr>, e.g. a styled spacer row) paints
    // nothing but still occupies its grid slot: the following rows are placed
    // after it. The union above cannot see it, so interpolate its band from the
    // neighbouring rows of the same parent when both exist. Runs of consecutive
    // empty rows keep the degenerate box (their split of the gap is unknowable
    // from boxes alone), as do empty first/last rows.
    {
        auto parent_of = [](const std::string& path) {
            const size_t dot = path.rfind('.');
            return dot == std::string::npos ? std::string() : path.substr(0, dot);
        };
        for (size_t i = 0; i < entries.size(); i++) {
            box_entry& row = entries[i];
            if (row.display != litehtml::display_table_row || row.has_cells) continue;
            const std::string parent = parent_of(row.p);
            const box_entry* prev = nullptr;
            const box_entry* next = nullptr;
            for (size_t j = i; j-- > 0;) {
                if (entries[j].display == litehtml::display_table_row && parent_of(entries[j].p) == parent) {
                    prev = &entries[j];
                    break;
                }
            }
            for (size_t j = i + 1; j < entries.size(); j++) {
                if (entries[j].display == litehtml::display_table_row && parent_of(entries[j].p) == parent) {
                    next = &entries[j];
                    break;
                }
            }
            if (prev && next && prev->has_cells && next->has_cells) {
                row.y = prev->y + prev->h;
                row.h = std::max(0.0, next->y - row.y);
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
    if (!inst->doc || !inst->doc->root_render()) return "[]";
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
            out += e.style;
            out += '}';
        }
        out += '}';
    }
    out += ']';
    return out;
}
