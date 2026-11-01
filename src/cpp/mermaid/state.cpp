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

enum class Kind { State, Start, End, Choice, Fork };

struct Node {
    std::string name;
    std::vector<std::string> desc;
    Kind kind = Kind::State;
    int group = -1;
    double w = 0, h = 0;
    std::vector<std::string> title_lines;
};

struct Group {
    std::string title;
    int parent = -1;
};

struct Edge {
    int from, to;  // node index, or -(group + 2) for a composite state
    std::string label;
};

struct Doc {
    std::vector<Node> nodes;
    std::vector<Group> groups;
    std::vector<Edge> edges;
    std::map<std::string, int> index;      // key -> node
    std::map<std::string, int> composite;  // id -> group
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

bool parse(const std::string& source, Doc& d, std::string& error) {
    std::vector<int> scopes;
    bool first = true, in_note = false;
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
            if (line == "end note") in_note = false;
            continue;
        }
        int scope = scopes.empty() ? -1 : scopes.back();
        if (starts(line, "note ")) {
            if (line.find(':') == std::string::npos) in_note = true;
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
                g.parent = scope;
                d.groups.push_back(g);
                d.composite[id] = (int)d.groups.size() - 1;
                scopes.push_back((int)d.groups.size() - 1);
            } else {
                int n = node_for(d, id, scope, false);
                if (n >= 0) {
                    if (!name.empty()) d.nodes[n].name = name;
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
            int n = node_for(d, line.substr(0, colon), scope, false);
            if (n >= 0) d.nodes[n].desc.push_back(trim(line.substr(colon + 1)));
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
        if (!inside(d, d.nodes[k].group, g)) continue;
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
            case Kind::State: {
                n.title_lines = split_lines(n.name);
                double w = text.block_width(n.title_lines, kNodeFont, kNodeWeight);
                double h = n.title_lines.size() * lh;
                if (!n.desc.empty()) {
                    w = std::max(w, text.block_width(n.desc, kEdgeFont, 400));
                    h += 10 + n.desc.size() * dlh;
                }
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
    for (const Group& gr : d.groups) group_parent.push_back(gr.parent);
    LayoutResult lay = layout_layered(ln, le, d.dir, group_parent);

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
        if (d.groups[gi].parent >= 0) grow(frames[d.groups[gi].parent], f.x0, f.y0, f.x1, f.y1);
    }
    double x0 = 0, y0 = 0, x1 = lay.width, y1 = lay.height;
    for (const Frame& f : frames)
        if (f.used) x0 = std::min(x0, f.x0), y0 = std::min(y0, f.y0), x1 = std::max(x1, f.x1), y1 = std::max(y1, f.y1);
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
