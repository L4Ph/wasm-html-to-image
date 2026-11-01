#include "mermaid/mindmap.h"

#include <algorithm>
#include <cmath>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

enum class Shape { Default, Square, Rounded, Circle, Hexagon };

struct Node {
    std::string text;
    Shape shape = Shape::Default;
    int indent = 0;
    int parent = -1;
    std::vector<int> children;
    std::vector<std::string> lines;
    double w = 0, h = 0;
    double span = 0;      // height the node and its subtree take
    double x = 0, y = 0;  // centre
    int side = 1;         // 1 right of the root, -1 left
    int branch = 0;       // index of the top level branch, for the colour
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

std::string unquote(std::string s) {
    s = trim(s);
    if (s.size() >= 2 && ((s.front() == '"' && s.back() == '"') || (s.front() == '`' && s.back() == '`'))) s = s.substr(1, s.size() - 2);
    if (s.size() >= 2 && s.front() == '"' && s.back() == '"') s = s.substr(1, s.size() - 2);
    return s;
}

/// `id((text))`, `id(text)`, `id[text]`, `id{{text}}`, `id))text((`, `id)text(`, or just `text`.
void parse_label(const std::string& raw, Node& n) {
    std::string s = trim(raw);
    struct Form {
        const char* open;
        const char* close;
        Shape shape;
    };
    static const Form forms[] = {{"((", "))", Shape::Circle}, {"))", "((", Shape::Rounded}, {"{{", "}}", Shape::Hexagon},
                                 {"(", ")", Shape::Rounded}, {")", "(", Shape::Rounded}, {"[", "]", Shape::Square}};
    size_t best = std::string::npos;
    const Form* form = nullptr;
    for (auto& f : forms) {
        size_t p = s.find(f.open);
        if (p == std::string::npos) continue;
        if (best == std::string::npos || p < best) best = p, form = &f;
    }
    if (form && best != std::string::npos) {
        size_t open_len = std::char_traits<char>::length(form->open), close_len = std::char_traits<char>::length(form->close);
        size_t end = s.rfind(form->close);
        if (end != std::string::npos && end >= best + open_len) {
            n.text = unquote(s.substr(best + open_len, end - best - open_len));
            n.shape = form->shape;
            (void)close_len;
            return;
        }
    }
    n.text = unquote(s);
}

bool parse(const std::string& source, std::vector<Node>& nodes, std::string& error) {
    bool first = true;
    std::vector<int> stack;
    size_t i = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        std::string raw = source.substr(i, e == std::string::npos ? std::string::npos : e - i);
        i = e == std::string::npos ? source.size() + 1 : e + 1;
        if (!raw.empty() && raw.back() == '\r') raw.pop_back();
        std::string line = trim(raw);
        if (line.empty() || starts(line, "%%")) continue;
        if (first) {
            first = false;
            continue;
        }
        if (starts(line, "::icon") || starts(line, ":::")) continue;  // decorations are ignored
        int indent = 0;
        for (char c : raw) {
            if (c == ' ') indent++;
            else if (c == '\t') indent += 4;
            else break;
        }
        Node n;
        n.indent = indent;
        parse_label(line, n);
        while (!stack.empty() && nodes[stack.back()].indent >= indent) stack.pop_back();
        if (stack.empty() && !nodes.empty()) {
            error = "a mindmap has one root node: " + line;
            return false;
        }
        n.parent = stack.empty() ? -1 : stack.back();
        nodes.push_back(n);
        int id = (int)nodes.size() - 1;
        if (n.parent >= 0) nodes[n.parent].children.push_back(id);
        stack.push_back(id);
    }
    if (nodes.empty()) {
        error = "empty mindmap";
        return false;
    }
    return true;
}

}  // namespace

bool render_mindmap(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    std::vector<Node> nodes;
    if (!parse(source, nodes, error)) return false;
    Theme th = make_theme(options);
    Text text{options};

    const double kHGap = 56, kVGap = 12;
    for (size_t k = 0; k < nodes.size(); k++) {
        Node& n = nodes[k];
        bool root = k == 0;
        double size = root ? 15 : 13;
        int weight = root ? 600 : 500;
        n.lines = wrap_lines(text, split_lines(n.text), size, weight, kWrapWidth);
        double w = text.block_width(n.lines, size, weight) + (root ? 40 : 28);
        double h = n.lines.size() * size * kLineHeight + (root ? 24 : 16);
        if (n.shape == Shape::Circle || (root && n.shape == Shape::Default)) w = std::max(w, h * 1.3);
        if (n.shape == Shape::Circle) h = std::max(h, w * 0.6);
        n.w = w;
        n.h = h;
    }
    // heights of the subtrees, children first (parents come before their children in the list)
    for (int k = (int)nodes.size() - 1; k >= 0; k--) {
        Node& n = nodes[k];
        double kids = 0;
        for (int c : n.children) kids += nodes[c].span;
        if (!n.children.empty()) kids += kVGap * (n.children.size() - 1);
        n.span = std::max(n.h, kids);
    }
    // the top level branches go to the side that is lighter so far
    double side_total[2] = {0, 0};
    for (size_t b = 0; b < nodes[0].children.size(); b++) {
        Node& c = nodes[nodes[0].children[b]];
        int s = side_total[0] <= side_total[1] ? 0 : 1;
        c.side = s == 0 ? 1 : -1;
        c.branch = (int)b;
        side_total[s] += c.span + kVGap;
    }
    for (size_t k = 1; k < nodes.size(); k++) {
        Node& n = nodes[k];
        if (n.parent > 0) n.side = nodes[n.parent].side, n.branch = nodes[n.parent].branch;
    }
    // positions: each side is stacked around the root's height, columns follow their parents outward
    nodes[0].x = nodes[0].y = 0;
    for (int side : {1, -1}) {
        std::vector<int> tops;
        for (int c : nodes[0].children)
            if (nodes[c].side == side) tops.push_back(c);
        double total = 0;
        for (int c : tops) total += nodes[c].span;
        if (!tops.empty()) total += kVGap * (tops.size() - 1);
        double y = -total / 2;
        // an explicit stack: (node, top of its span)
        std::vector<std::pair<int, double>> work;
        for (int c : tops) {
            work.push_back({c, y});
            y += nodes[c].span + kVGap;
        }
        while (!work.empty()) {
            auto [id, top] = work.back();
            work.pop_back();
            Node& n = nodes[id];
            const Node& p = nodes[n.parent];
            n.y = top + n.span / 2;
            n.x = p.x + side * (p.w / 2 + kHGap + n.w / 2);
            double kids = 0;
            for (int c : n.children) kids += nodes[c].span;
            if (!n.children.empty()) kids += kVGap * (n.children.size() - 1);
            double cy = n.y - kids / 2;
            for (int c : n.children) {
                work.push_back({c, cy});
                cy += nodes[c].span + kVGap;
            }
        }
    }
    double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    for (const Node& n : nodes) {
        x0 = std::min(x0, n.x - n.w / 2);
        x1 = std::max(x1, n.x + n.w / 2);
        y0 = std::min(y0, n.y - n.h / 2);
        y1 = std::max(y1, n.y + n.h / 2);
    }
    const double ox = kMargin - x0, oy = kMargin - y0;

    static const char* kBranch[] = {"#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#b07aa1", "#edc948", "#9c755f"};
    auto color_of = [&](int branch) { return std::string(kBranch[branch % 8]); };

    std::string lines, shapes;
    for (size_t k = 0; k < nodes.size(); k++) {
        const Node& n = nodes[k];
        double cx = n.x + ox, cy = n.y + oy;
        if (k > 0) {
            const Node& p = nodes[n.parent];
            double px = p.x + ox + n.side * p.w / 2, py = p.y + oy, qx = cx - n.side * n.w / 2, qy = cy, mx = (px + qx) / 2;
            int depth = 0;
            for (int a = (int)k; nodes[a].parent >= 0; a = nodes[a].parent) depth++;
            lines += "<path class=\"edge\" d=\"M" + num(px) + "," + num(py) + " C" + num(mx) + "," + num(py) + " " + num(mx) + "," + num(qy) + " " + num(qx) + "," + num(qy) +
                     "\" fill=\"none\" stroke=\"" + color_of(n.branch) + "\" stroke-width=\"" + num(std::max(1.5, 4.5 - depth * 1.2)) + "\" stroke-linecap=\"round\"/>\n";
        }
        std::string fill, stroke, ink;
        if (k == 0) fill = th.text, stroke = th.text, ink = th.bg;
        else fill = mix(color_of(n.branch), th.bg, 22), stroke = color_of(n.branch), ink = th.text;
        double l = cx - n.w / 2, t = cy - n.h / 2;
        shapes += "<g class=\"node\">\n";
        std::string style = " fill=\"" + fill + "\" stroke=\"" + stroke + "\" stroke-width=\"1.5\"";
        if (n.shape == Shape::Circle || (k == 0 && n.shape == Shape::Default)) {
            shapes += "<ellipse cx=\"" + num(cx) + "\" cy=\"" + num(cy) + "\" rx=\"" + num(n.w / 2) + "\" ry=\"" + num(n.h / 2) + "\"" + style + "/>\n";
        } else if (n.shape == Shape::Hexagon) {
            double q = n.h / 2;
            shapes += "<polygon points=\"" + num(l + q) + "," + num(t) + " " + num(l + n.w - q) + "," + num(t) + " " + num(l + n.w) + "," + num(cy) + " " + num(l + n.w - q) + "," + num(t + n.h) + " " +
                      num(l + q) + "," + num(t + n.h) + " " + num(l) + "," + num(cy) + "\"" + style + "/>\n";
        } else {
            double rx = n.shape == Shape::Square ? 2 : (n.shape == Shape::Rounded ? n.h / 2 : 8);
            shapes += "<rect x=\"" + num(l) + "\" y=\"" + num(t) + "\" width=\"" + num(n.w) + "\" height=\"" + num(n.h) + "\" rx=\"" + num(rx) + "\"" + style + "/>\n";
        }
        centered_text(shapes, th, n.lines, cx, cy, k == 0 ? 15 : 13, k == 0 ? 600 : 500, ink);
        shapes += "</g>\n";
    }
    svg = svg_document(th, (x1 - x0) + 2 * kMargin, (y1 - y0) + 2 * kMargin, lines + shapes);
    return true;
}

}  // namespace mermaid
