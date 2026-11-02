#include "mermaid/state.h"

#include <algorithm>
#include <cmath>
#include <map>

#include "mermaid/frame_clear.h"
#include "mermaid/layered.h"
#include "mermaid/nodestyle.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

enum class Kind { State, Start, End, Choice, Fork, Note };

struct Node {
    std::string name;
    std::vector<std::string> desc;
    bool named = false;  // declared with a quoted name (`state "Name" as id`), so the name is a label line
    Kind kind = Kind::State;
    int group = -1;
    double w = 0, h = 0;
    std::vector<std::string> title_lines;
};

struct Group {
    std::string title;
    int parent = -1;
    bool desc_title = false;  // the title is the bare id, so an `id : description` line may replace it
};

struct Edge {
    int from, to;  // node index, or -(group + 2) for a composite state
    std::string label;
    bool note = false;  // the dotted link between a note and its state
};

struct Doc {
    std::vector<Node> nodes;
    std::vector<Group> groups;
    std::vector<Edge> edges;
    std::map<std::string, int> index;      // key -> node
    std::map<std::string, int> composite;  // id -> group
    std::map<std::string, std::string> comp_desc;  // composite id -> the description an `id : ...` line gave it
    std::map<std::string, int> group_index;        // composite id -> the group once its block is parsed
    Direction dir = Direction::TD;
    StyleSheet sheet;
};

std::string strip_class(std::string s) {
    size_t p = s.find(":::");
    return trim(p == std::string::npos ? s : s.substr(0, p));
}

int node_for(Doc& d, const std::string& raw, int scope, bool as_target) {
    std::string id = strip_class(raw);
    size_t cls_at = raw.find(":::");
    if (cls_at != std::string::npos) d.sheet.use(id, trim(raw.substr(cls_at + 3)));
    if (auto c = d.composite.find(id); c != d.composite.end()) return -(c->second + 2);
    std::string key = id;
    Kind kind = Kind::State;
    if (id == "[*]") {
        kind = as_target ? Kind::End : Kind::Start;
        key = std::string(as_target ? "[*]end#" : "[*]start#") + std::to_string(scope);
    }
    auto it = d.index.find(key);
    if (it != d.index.end()) return it->second;
    Node n;
    n.name = id;
    n.kind = kind;
    n.group = scope;
    d.nodes.push_back(n);
    return d.index[key] = (int)d.nodes.size() - 1;
}

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

/// A note beside a state: a node of its own, joined to the state by a dotted link (the note comes after the state for `right of`, before for `left of`).
void add_note(Doc& d, const std::string& target, bool left, int scope, const std::string& text) {
    if (target.empty() || text.empty()) return;
    int t = node_for(d, target, scope, false);
    Node n;
    n.kind = Kind::Note;
    n.name = text;
    n.group = t >= 0 ? d.nodes[t].group : scope;
    d.nodes.push_back(n);
    int at = (int)d.nodes.size() - 1;
    Edge e;
    e.from = left ? at : t;
    e.to = left ? t : at;
    e.note = true;
    d.edges.push_back(e);
}

bool parse(const std::string& source, Doc& d, std::string& error) {
    std::vector<int> scopes;
    bool first = true, in_note = false, note_left = false;
    std::string note_target, note_text;
    int note_scope = -1;
    // composite states can be named by transitions before their block, so register them up front
    {
        int count = 0;
        for (size_t p = 0; p < source.size();) {
            size_t q = source.find('\n', p);
            std::string l = trim(source.substr(p, q == std::string::npos ? std::string::npos : q - p));
            p = q == std::string::npos ? source.size() : q + 1;
            if (!starts(l, "state ") || l.back() != '{') continue;
            std::string rest = trim(l.substr(6, l.size() - 7)), id = rest;
            if (!rest.empty() && rest[0] == '"') {
                size_t as = rest.find(" as ", 1);
                id = as == std::string::npos ? rest.substr(1, rest.size() - 2) : trim(rest.substr(as + 4));
            }
            d.composite[id] = count++;
        }
    }
    size_t i = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        std::string line = trim(source.substr(i, e == std::string::npos ? std::string::npos : e - i));
        i = e == std::string::npos ? source.size() + 1 : e + 1;
        if (!line.empty() && line.back() == ';') line = trim(line.substr(0, line.size() - 1));
        if (line.empty() || starts(line, "%%")) continue;
        if (first) {
            first = false;
            continue;
        }
        if (in_note) {
            if (line == "end note") {
                in_note = false;
                add_note(d, note_target, note_left, note_scope, note_text);
            } else {
                note_text += (note_text.empty() ? "" : "\n") + line;
            }
            continue;
        }
        int scope = scopes.empty() ? -1 : scopes.back();
        if (starts(line, "note ")) {  // `note right of A : text`, or a block that runs to `end note`
            std::string rest = trim(line.substr(5));
            bool left = starts(rest, "left of ");
            if (left || starts(rest, "right of ")) {
                rest = trim(rest.substr(left ? 8 : 9));
                size_t colon = rest.find(':');
                note_target = trim(colon == std::string::npos ? rest : rest.substr(0, colon));
                note_left = left;
                note_scope = scope;
                if (colon != std::string::npos) add_note(d, note_target, left, scope, trim(rest.substr(colon + 1)));
                else in_note = true, note_text.clear();
            } else if (line.find(':') == std::string::npos) {
                in_note = true, note_text.clear(), note_target.clear();
            }
            continue;
        }
        if (starts(line, "direction ")) {
            std::string v = trim(line.substr(10));
            d.dir = v == "LR" ? Direction::LR : v == "RL" ? Direction::RL : v == "BT" ? Direction::BT : Direction::TD;
            continue;
        }
        if (d.sheet.take(line)) continue;
        if (starts(line, "click ") || starts(line, "accTitle") ||
            starts(line, "accDescr") || starts(line, "title ") || line == "--" || line == "||")
            continue;
        if (line == "}") {
            if (scopes.empty()) {
                error = "unbalanced '}'";
                return false;
            }
            scopes.pop_back();
            continue;
        }
        if (starts(line, "state ")) {
            std::string rest = trim(line.substr(6));
            bool open = !rest.empty() && rest.back() == '{';
            if (open) rest = trim(rest.substr(0, rest.size() - 1));
            std::string id = rest, name;
            if (rest[0] == '"') {
                size_t q = rest.find('"', 1);
                if (q == std::string::npos) {
                    error = "unterminated state name: " + line;
                    return false;
                }
                name = rest.substr(1, q - 1);
                size_t as = rest.find(" as ", q);
                id = as == std::string::npos ? name : trim(rest.substr(as + 4));
            }
            Kind kind = Kind::State;
            size_t mark = id.find("<<");
            if (mark != std::string::npos) {
                std::string t = id.substr(mark);
                kind = t.find("choice") != std::string::npos ? Kind::Choice : (t.find("fork") != std::string::npos || t.find("join") != std::string::npos) ? Kind::Fork : Kind::State;
                id = trim(id.substr(0, mark));
            }
            if (open) {
                Group g;
                g.title = name.empty() ? id : name;
                g.desc_title = name.empty();
                if (g.desc_title) {  // an `id : description` line before the block names it already
                    auto it = d.comp_desc.find(id);
                    if (it != d.comp_desc.end()) g.title = it->second;
                }
                g.parent = scope;
                d.groups.push_back(g);
                d.composite[id] = (int)d.groups.size() - 1;
                d.group_index[id] = (int)d.groups.size() - 1;
                scopes.push_back((int)d.groups.size() - 1);
            } else {
                int n = node_for(d, id, scope, false);
                if (n >= 0) {
                    if (!name.empty()) d.nodes[n].name = name, d.nodes[n].named = true;
                    d.nodes[n].kind = kind;
                }
            }
            continue;
        }
        size_t arrow = line.find("-->");
        size_t first_colon = line.find(':');
        // `A: a --> b` describes A; a transition has its arrow before any colon (`A:::cls --> B` is a class mark, not a colon)
        if (arrow != std::string::npos && first_colon != std::string::npos && first_colon < arrow && line.compare(first_colon, 3, ":::") != 0 &&
            trim(line.substr(0, first_colon)).find(' ') == std::string::npos)
            arrow = std::string::npos;
        if (arrow != std::string::npos) {
            std::string right = line.substr(arrow + 3), label;
            size_t colon = right.find(':');
            if (colon != std::string::npos) {
                label = trim(right.substr(colon + 1));
                right = right.substr(0, colon);
            }
            std::string from = trim(line.substr(0, arrow)), to = trim(right);
            if (from.empty() || to.empty()) {
                error = "a transition needs two states: " + line;
                return false;
            }
            Edge ed;
            ed.from = node_for(d, from, scope, false);
            ed.to = node_for(d, to, scope, true);
            ed.label = label;
            d.edges.push_back(ed);
            continue;
        }
        size_t colon = line.find(':');
        if (colon != std::string::npos) {  // `id : description`
            std::string id = strip_class(trim(line.substr(0, colon)));
            std::string desc = trim(line.substr(colon + 1));
            int n = node_for(d, line.substr(0, colon), scope, false);
            if (n >= 0) {
                d.nodes[n].desc.push_back(desc);
            } else {  // a composite state: the description is its heading, as Mermaid draws it
                d.comp_desc[id] = desc;
                auto gi = d.group_index.find(id);
                if (gi != d.group_index.end() && d.groups[gi->second].desc_title) d.groups[gi->second].title = desc;
            }
            continue;
        }
        node_for(d, line, scope, false);  // a bare state id
    }
    if (!scopes.empty()) {
        error = "unclosed state block";
        return false;
    }
    return true;
}

bool inside(const Doc& d, int group, int ancestor) {
    for (; group >= 0; group = d.groups[group].parent)
        if (group == ancestor) return true;
    return false;
}

/// Edges to a composite state attach to its start marker, or to its first member.
int resolve(const Doc& d, int ref) {
    if (ref >= 0) return ref;
    int g = -ref - 2, any = -1;
    for (size_t k = 0; k < d.nodes.size(); k++) {
        if (!inside(d, d.nodes[k].group, g) || d.nodes[k].kind == Kind::Note) continue;
        if (d.nodes[k].kind == Kind::Start && d.nodes[k].group == g) return (int)k;
        if (any < 0) any = (int)k;
    }
    return any;
}

void draw_arrow(std::string& out, Pt tip, Pt from, const std::string& color) {
    using namespace metrics;
    double dx = tip.x - from.x, dy = tip.y - from.y, len = std::sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;
    dx /= len;
    dy /= len;
    Pt base = {tip.x - dx * kArrowW, tip.y - dy * kArrowW};
    double nx = -dy * kArrowH / 2, ny = dx * kArrowH / 2;
    out += "<polygon points=\"" + num(tip.x) + "," + num(tip.y) + " " + num(base.x + nx) + "," + num(base.y + ny) + " " + num(base.x - nx) + "," +
           num(base.y - ny) + "\" fill=\"" + color + "\" stroke=\"" + color + "\" stroke-width=\"0.75\" stroke-linejoin=\"round\"/>\n";
}

}  // namespace

bool render_state(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    Doc d;
    if (!parse(source, d, error)) return false;
    for (auto& e : d.edges) {
        e.from = resolve(d, e.from);
        e.to = resolve(d, e.to);
        if (e.from < 0 || e.to < 0) {
            error = "a transition points at an empty composite state";
            return false;
        }
    }
    if (d.nodes.empty()) {
        error = "empty diagram";
        return false;
    }
    Theme th = make_theme(options);
    Text text{options};
    const double lh = kNodeFont * kLineHeight, dlh = kEdgeFont * kLineHeight + 2;
    const bool horizontal = d.dir == Direction::LR || d.dir == Direction::RL;

    std::vector<LayoutNode> ln(d.nodes.size());
    for (size_t k = 0; k < d.nodes.size(); k++) {
        Node& n = d.nodes[k];
        switch (n.kind) {
            case Kind::Start: n.w = n.h = 14; break;
            case Kind::End: n.w = n.h = 20; break;
            case Kind::Choice: n.w = n.h = 26; break;
            case Kind::Fork: n.w = horizontal ? 6 : 60, n.h = horizontal ? 60 : 6; break;
            case Kind::Note: {
                n.title_lines = wrap_lines(text, split_lines(n.name), kEdgeFont, 400, kWrapWidth);
                n.w = std::max(40.0, text.block_width(n.title_lines, kEdgeFont, 400) + 20);
                n.h = n.title_lines.size() * dlh + 16;
                break;
            }
            case Kind::State: {
                // the label: a quoted name first, then each `id : description` line; a bare id labels itself only when it has neither
                std::vector<std::string> label;
                if (n.named) label.push_back(n.name);
                for (auto& s : n.desc)
                    if (!s.empty()) label.push_back(s);
                if (label.empty()) label.push_back(n.name);
                n.title_lines = wrap_lines(text, label, kNodeFont, kNodeWeight, kWrapWidth);
                n.desc.clear();  // consumed into the label; there is no separate description section
                double w = text.block_width(n.title_lines, kNodeFont, kNodeWeight);
                double h = n.title_lines.size() * lh;
                n.w = std::max(60.0, w + 2 * kPadX);
                n.h = h + 2 * kPadY;
                break;
            }
        }
        ln[k].w = n.w;
        ln[k].h = n.h;
        ln[k].group = n.group;
        ln[k].outline = n.kind == Kind::Choice ? 1 : (n.kind == Kind::Start || n.kind == Kind::End) ? 2 : 0;
    }
    std::vector<LayoutEdge> le(d.edges.size());
    std::vector<std::vector<std::string>> label_lines(d.edges.size());
    for (size_t k = 0; k < d.edges.size(); k++) {
        le[k].from = d.edges[k].from;
        le[k].to = d.edges[k].to;
        if (!d.edges[k].label.empty()) {
            label_lines[k] = wrap_lines(text, split_lines(d.edges[k].label), kEdgeFont, kEdgeWeight, kWrapWidth);
            le[k].label_w = text.block_width(label_lines[k], kEdgeFont, kEdgeWeight) + 16;
            le[k].label_h = label_lines[k].size() * kEdgeFont * kLineHeight + 16;
        }
    }
    std::vector<int> group_parent;
    std::vector<double> group_min_w;  // a frame is wide enough for its title
    for (const Group& gr : d.groups) {
        group_parent.push_back(gr.parent);
        group_min_w.push_back(std::ceil(text.width(gr.title, kGroupFont, kGroupWeight)) + 24 + 4);
    }
    LayoutResult lay;
    if (horizontal) {
        lay = layout_layered(ln, le, d.dir, group_parent, group_min_w);
    } else {
        // top-down: the layout leaves the notes out, and each one is set beside its state afterwards (not a rank above or below it)
        std::vector<int> lmap(d.nodes.size(), -1), emap(d.edges.size(), -1);
        std::vector<LayoutNode> cn;
        std::vector<LayoutEdge> ce;
        for (size_t k = 0; k < d.nodes.size(); k++)
            if (d.nodes[k].kind != Kind::Note) lmap[k] = (int)cn.size(), cn.push_back(ln[k]);
        for (size_t k = 0; k < d.edges.size(); k++) {
            if (d.edges[k].note) continue;
            LayoutEdge e = le[k];
            e.from = lmap[e.from];
            e.to = lmap[e.to];
            emap[k] = (int)ce.size();
            ce.push_back(e);
        }
        LayoutResult core = layout_layered(cn, ce, d.dir, group_parent, group_min_w);
        lay.width = core.width;
        lay.height = core.height;
        lay.center.assign(d.nodes.size(), Pt{0, 0});
        lay.points.assign(d.edges.size(), {});
        lay.label_center.assign(d.edges.size(), Pt{0, 0});
        for (size_t k = 0; k < d.nodes.size(); k++)
            if (lmap[k] >= 0) lay.center[k] = core.center[lmap[k]];
        for (size_t k = 0; k < d.edges.size(); k++)
            if (emap[k] >= 0) lay.points[k] = core.points[emap[k]], lay.label_center[k] = core.label_center[emap[k]];
        constexpr double kNoteGap = 28;
        std::map<int, double> stacked;  // per state and side: the height of the notes already set there
        for (size_t k = 0; k < d.edges.size(); k++) {
            if (!d.edges[k].note) continue;
            const bool left = d.nodes[d.edges[k].from].kind == Kind::Note;
            const int ni = left ? d.edges[k].from : d.edges[k].to, ti = left ? d.edges[k].to : d.edges[k].from;
            const Node &note = d.nodes[ni], &st = d.nodes[ti];
            double& used = stacked[ti * 2 + (left ? 1 : 0)];
            const double cy = lay.center[ti].y + used, tx = lay.center[ti].x;
            const double cx = tx + (left ? -1 : 1) * (st.w / 2 + kNoteGap + note.w / 2);
            used += note.h + 8;
            lay.center[ni] = Pt{cx, cy};
            if (left) lay.points[k] = {Pt{cx + note.w / 2, cy}, Pt{tx - st.w / 2, cy}};
            else lay.points[k] = {Pt{tx + st.w / 2, cy}, Pt{cx - note.w / 2, cy}};
        }
    }

    // composite state frames, children first so a parent covers them
    struct Frame {
        double x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        bool used = false;
    };
    std::vector<Frame> frames(d.groups.size());
    auto grow = [&](Frame& f, double x0, double y0, double x1, double y1) {
        if (!f.used) f = {x0, y0, x1, y1, true};
        else f = {std::min(f.x0, x0), std::min(f.y0, y0), std::max(f.x1, x1), std::max(f.y1, y1), true};
    };
    constexpr double kFramePad = 16, kHeader = 26;
    for (size_t k = 0; k < d.nodes.size(); k++)
        if (d.nodes[k].group >= 0)
            grow(frames[d.nodes[k].group], lay.center[k].x - d.nodes[k].w / 2, lay.center[k].y - d.nodes[k].h / 2, lay.center[k].x + d.nodes[k].w / 2,
                 lay.center[k].y + d.nodes[k].h / 2);
    for (int gi = (int)d.groups.size() - 1; gi >= 0; gi--) {
        if (!frames[gi].used) continue;
        Frame& f = frames[gi];
        f = {f.x0 - kFramePad, f.y0 - kFramePad - kHeader, f.x1 + kFramePad, f.y1 + kFramePad, true};
        f.x1 = std::max(f.x1, f.x0 + group_min_w[gi]);  // wide enough for its title; the layout left the room
        if (d.groups[gi].parent >= 0) grow(frames[d.groups[gi].parent], f.x0, f.y0, f.x1, f.y1);
    }
    double x0 = 0, y0 = 0, x1 = lay.width, y1 = lay.height;
    for (const Frame& f : frames)
        if (f.used) x0 = std::min(x0, f.x0), y0 = std::min(y0, f.y0), x1 = std::max(x1, f.x1), y1 = std::max(y1, f.y1);
    for (size_t k = 0; k < d.nodes.size(); k++)  // notes set beside their states may reach past the layout's box
        if (d.nodes[k].kind == Kind::Note)
            x0 = std::min(x0, lay.center[k].x - d.nodes[k].w / 2), y0 = std::min(y0, lay.center[k].y - d.nodes[k].h / 2),
            x1 = std::max(x1, lay.center[k].x + d.nodes[k].w / 2), y1 = std::max(y1, lay.center[k].y + d.nodes[k].h / 2);
    const double ox = kMargin - x0, oy = kMargin - y0;
    auto at = [&](Pt p) { return Pt{p.x + ox, p.y + oy}; };

    std::string body;
    for (size_t gi = 0; gi < d.groups.size(); gi++) {
        const Frame& f = frames[gi];
        if (!f.used) continue;
        body += "<g class=\"composite\">\n<rect x=\"" + num(f.x0 + ox) + "\" y=\"" + num(f.y0 + oy) + "\" width=\"" + num(f.x1 - f.x0) + "\" height=\"" + num(f.y1 - f.y0) +
                "\" rx=\"5\" ry=\"5\" fill=\"" + th.composite_fill + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        if (!th.composite_header.empty())
            body += "<rect x=\"" + num(f.x0 + ox) + "\" y=\"" + num(f.y0 + oy) + "\" width=\"" + num(f.x1 - f.x0) + "\" height=\"" + num(kHeader) + "\" rx=\"5\" ry=\"5\" fill=\"" + th.composite_header + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        body += "<text x=\"" + num(f.x0 + ox + 12) + "\" y=\"" + num(f.y0 + oy + kHeader / 2 + kGroupFont * 0.35) + "\" font-size=\"" + num(kGroupFont) + "\" font-weight=\"" +
                std::to_string(kGroupWeight) + "\" font-family=\"" + esc(th.font) + "\" fill=\"" + th.text + "\">" + esc(d.groups[gi].title) + "</text>\n";
        body += "<line x1=\"" + num(f.x0 + ox) + "\" y1=\"" + num(f.y0 + oy + kHeader) + "\" x2=\"" + num(f.x1 + ox) + "\" y2=\"" + num(f.y0 + oy + kHeader) + "\" stroke=\"" + th.border +
                "\" stroke-width=\"1\"/>\n</g>\n";
    }
    clear_frame_borders(lay.points, lay.label_center, le, frames);
    for (size_t k = 0; k < d.edges.size(); k++) {
        if (lay.points[k].size() < 2) continue;
        std::vector<Pt> pts;
        std::string list;
        for (const Pt& p : lay.points[k]) {
            pts.push_back(at(p));
            list += (list.empty() ? "" : " ") + num(pts.back().x) + "," + num(pts.back().y);
        }
        if (d.edges[k].note) {  // a note's link: dotted, no arrow head
            body += "<polyline class=\"edge note-link\" points=\"" + list + "\" fill=\"none\" stroke=\"" + th.note_border + "\" stroke-width=\"1\" stroke-dasharray=\"3 3\" stroke-linejoin=\"round\"/>\n";
            continue;
        }
        body += "<polyline class=\"edge\" points=\"" + list + "\" fill=\"none\" stroke=\"" + th.line + "\" stroke-width=\"1\" stroke-linejoin=\"round\"/>\n";
        draw_arrow(body, pts.back(), pts[pts.size() - 2], th.arrow);
    }
    for (size_t k = 0; k < d.edges.size(); k++) {
        if (label_lines[k].empty()) continue;
        Pt c = at(lay.label_center[k]);
        body += "<g class=\"edge-label\">\n<rect x=\"" + num(c.x - le[k].label_w / 2) + "\" y=\"" + num(c.y - le[k].label_h / 2) + "\" width=\"" + num(le[k].label_w) + "\" height=\"" +
                num(le[k].label_h) + "\" rx=\"2\" ry=\"2\" fill=\"" + th.label_bg + "\" stroke=\"" + th.label_stroke + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, label_lines[k], c.x, c.y, kEdgeFont, kEdgeWeight, th.text_sec);
        body += "</g>\n";
    }
    for (size_t k = 0; k < d.nodes.size(); k++) {
        const Node& n = d.nodes[k];
        Pt c = at(lay.center[k]);
        body += "<g class=\"node\">\n";
        switch (n.kind) {
            case Kind::Start:
                body += "<circle cx=\"" + num(c.x) + "\" cy=\"" + num(c.y) + "\" r=\"7\" fill=\"" + th.text + "\"/>\n";
                break;
            case Kind::End:
                body += "<circle cx=\"" + num(c.x) + "\" cy=\"" + num(c.y) + "\" r=\"9\" fill=\"none\" stroke=\"" + th.text + "\" stroke-width=\"1.5\"/>\n";
                body += "<circle cx=\"" + num(c.x) + "\" cy=\"" + num(c.y) + "\" r=\"5\" fill=\"" + th.text + "\"/>\n";
                break;
            case Kind::Choice:
                body += "<polygon points=\"" + num(c.x) + "," + num(c.y - 13) + " " + num(c.x + 13) + "," + num(c.y) + " " + num(c.x) + "," + num(c.y + 13) + " " + num(c.x - 13) + "," +
                        num(c.y) + "\"" + d.sheet.paint(n.name, th.surface, th.border) + "/>\n";
                break;
            case Kind::Fork:
                body += "<rect x=\"" + num(c.x - n.w / 2) + "\" y=\"" + num(c.y - n.h / 2) + "\" width=\"" + num(n.w) + "\" height=\"" + num(n.h) + "\" rx=\"2\" fill=\"" + th.text + "\"/>\n";
                break;
            case Kind::Note:
                body += "<rect x=\"" + num(c.x - n.w / 2) + "\" y=\"" + num(c.y - n.h / 2) + "\" width=\"" + num(n.w) + "\" height=\"" + num(n.h) + "\" rx=\"2\" ry=\"2\" fill=\"" +
                        th.note_fill + "\" stroke=\"" + th.note_border + "\" stroke-width=\"1\"/>\n";
                centered_text(body, th, n.title_lines, c.x, c.y, kEdgeFont, 400, th.note_text);
                break;
            case Kind::State: {
                body += "<rect x=\"" + num(c.x - n.w / 2) + "\" y=\"" + num(c.y - n.h / 2) + "\" width=\"" + num(n.w) + "\" height=\"" + num(n.h) + "\" rx=\"6\" ry=\"6\"" +
                        d.sheet.paint(n.name, th.surface, th.border) + "/>\n";
                double top = c.y - n.h / 2 + kPadY;
                double title_h = n.title_lines.size() * lh;
                centered_text(body, th, n.title_lines, c.x, top + title_h / 2, kNodeFont, kNodeWeight, d.sheet.text_color(n.name, th.text));
                if (!n.desc.empty()) {
                    double ly = top + title_h + 5;
                    body += "<line x1=\"" + num(c.x - n.w / 2) + "\" y1=\"" + num(ly) + "\" x2=\"" + num(c.x + n.w / 2) + "\" y2=\"" + num(ly) + "\" stroke=\"" + th.border +
                            "\" stroke-width=\"1\"/>\n";
                    centered_text(body, th, n.desc, c.x, ly + 5 + n.desc.size() * dlh / 2, kEdgeFont, 400, th.text_sec);
                }
                break;
            }
        }
        body += "</g>\n";
    }
    svg = svg_document(th, (x1 - x0) + 2 * kMargin, (y1 - y0) + 2 * kMargin, body);
    return true;
}

}  // namespace mermaid
