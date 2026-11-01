#include "mermaid/quadrant.h"

#include <algorithm>
#include <cstdlib>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

struct Point {
    std::string name;
    double x, y;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

/// A label may be written in double quotes (`x-axis "Low" --> "High"`, `"Dark Mode": [0.2, 0.7]`); the quotes are not part of it.
std::string unquote(const std::string& s) {
    std::string t = trim(s);
    return t.size() >= 2 && t.front() == '"' && t.back() == '"' ? trim(t.substr(1, t.size() - 2)) : t;
}

/// `Low --> High` (or just one label) into its two ends.
void ends_of(const std::string& text, std::string& lo, std::string& hi) {
    size_t arrow = text.find("-->");
    if (arrow == std::string::npos) {
        lo = unquote(text);
        hi.clear();
    } else {
        lo = unquote(text.substr(0, arrow));
        hi = unquote(text.substr(arrow + 3));
    }
}

}  // namespace

bool render_quadrant(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    std::string title, x_lo, x_hi, y_lo, y_hi, quad[4];
    std::vector<Point> points;
    bool first = true;
    size_t i = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        std::string line = trim(source.substr(i, e == std::string::npos ? std::string::npos : e - i));
        i = e == std::string::npos ? source.size() + 1 : e + 1;
        if (line.empty() || starts(line, "%%")) continue;
        if (first) {
            first = false;
            continue;
        }
        if (starts(line, "title ")) title = unquote(line.substr(6));
        else if (starts(line, "x-axis ")) ends_of(line.substr(7), x_lo, x_hi);
        else if (starts(line, "y-axis ")) ends_of(line.substr(7), y_lo, y_hi);
        else if (starts(line, "classDef ")) continue;
        else if (starts(line, "quadrant-") && line.size() > 10 && line[9] >= '1' && line[9] <= '4') quad[line[9] - '1'] = unquote(line.substr(10));
        else {
            size_t open = line.find('['), close = line.rfind(']'), colon = line.rfind(':', open);
            if (open == std::string::npos || close == std::string::npos || colon == std::string::npos || colon > open) {
                error = "unrecognised line: " + line;
                return false;
            }
            std::string inner = line.substr(open + 1, close - open - 1);
            size_t comma = inner.find(',');
            char *e1, *e2;
            std::string a = trim(inner.substr(0, comma)), b = comma == std::string::npos ? "" : trim(inner.substr(comma + 1));
            double x = std::strtod(a.c_str(), &e1), y = std::strtod(b.c_str(), &e2);
            if (comma == std::string::npos || a.empty() || b.empty() || *e1 || *e2 || x < 0 || x > 1 || y < 0 || y > 1) {
                error = "a point is `name: [x, y]` with both between 0 and 1: " + line;
                return false;
            }
            std::string pname = trim(line.substr(0, colon));
            if (size_t cls = pname.find(":::"); cls != std::string::npos) pname = trim(pname.substr(0, cls));
            pname = unquote(pname);
            points.push_back({pname, x, y});
        }
    }
    Theme th = make_theme(options);
    Text text{options};
    const double S = 400, kLabel = 12;
    double left = kMargin + (y_lo.empty() && y_hi.empty() ? 0 : 22), top = kMargin + (title.empty() ? 0 : 30);
    double W = left + S + kMargin, H = top + S + (x_lo.empty() && x_hi.empty() ? 0 : 26) + kMargin;
    std::string body;
    if (!title.empty()) centered_text(body, th, {title}, left + S / 2, kMargin, 16, 600, th.text);
    // quadrants: 1 top right, 2 top left, 3 bottom left, 4 bottom right
    const double qx[4] = {S / 2, 0, 0, S / 2}, qy[4] = {0, 0, S / 2, S / 2};
    const int tint[4] = {10, 6, 10, 6};
    // what a point's label must not cover: the quadrant titles, the points, and the labels already placed
    struct Box {
        double x0, y0, x1, y1;
    };
    std::vector<Box> taken;
    for (int q = 0; q < 4; q++) {
        body += "<rect x=\"" + num(left + qx[q]) + "\" y=\"" + num(top + qy[q]) + "\" width=\"" + num(S / 2) + "\" height=\"" + num(S / 2) + "\" fill=\"" + mix(th.fg, th.bg, tint[q]) + "\"/>\n";
        if (!quad[q].empty()) {
            centered_text(body, th, {quad[q]}, left + qx[q] + S / 4, top + qy[q] + 18, 13, 600, th.text_sec);
            double w = text.width(quad[q], 13, 600);
            taken.push_back({left + qx[q] + S / 4 - w / 2, top + qy[q] + 5, left + qx[q] + S / 4 + w / 2, top + qy[q] + 23});
        }
    }
    body += "<rect x=\"" + num(left) + "\" y=\"" + num(top) + "\" width=\"" + num(S) + "\" height=\"" + num(S) + "\" fill=\"none\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
    body += "<line x1=\"" + num(left + S / 2) + "\" y1=\"" + num(top) + "\" x2=\"" + num(left + S / 2) + "\" y2=\"" + num(top + S) + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
    body += "<line x1=\"" + num(left) + "\" y1=\"" + num(top + S / 2) + "\" x2=\"" + num(left + S) + "\" y2=\"" + num(top + S / 2) + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
    // axis labels
    double ly = top + S + 16;
    if (!x_lo.empty()) aligned_text(body, th, {x_lo}, left, ly, kLabel, 500, th.text, "start");
    if (!x_hi.empty()) aligned_text(body, th, {x_hi}, left + S, ly, kLabel, 500, th.text, "end");
    auto vertical = [&](const std::string& s, double cy, const char* anchor) {
        if (s.empty()) return;
        double cx = left - 12;
        body += "<text transform=\"rotate(-90 " + num(cx) + " " + num(cy) + ")\" x=\"" + num(cx) + "\" y=\"" + num(cy + kLabel * 0.35) + "\" text-anchor=\"" + anchor + "\" font-size=\"" + num(kLabel) +
                "\" font-weight=\"500\" font-family=\"" + esc(th.font) + "\" fill=\"" + th.text + "\">" + esc(s) + "</text>\n";
    };
    vertical(y_lo, top + S, "start");
    vertical(y_hi, top, "end");
    // points: y grows upward. A label goes under its point, as in Mermaid; where that would cover something it goes beside or over
    // the point instead
    for (auto& p : points) taken.push_back({left + p.x * S - 6, top + (1 - p.y) * S - 6, left + p.x * S + 6, top + (1 - p.y) * S + 6});
    for (auto& p : points) {
        double cx = left + p.x * S, cy = top + (1 - p.y) * S;
        body += "<g class=\"point\">\n<circle cx=\"" + num(cx) + "\" cy=\"" + num(cy) + "\" r=\"6\" fill=\"" + th.accent + "\" stroke=\"" + th.bg + "\" stroke-width=\"1.5\"/>\n";
        const double w = text.width(p.name, kLabel, 400), h = kLabel + 2;
        // anchor point of the text (its baseline middle), and which way it runs
        struct Spot {
            double x, y;
            const char* anchor;
        };
        const Spot spots[] = {{cx, cy + 20, "middle"}, {cx + 10, cy + 4, "start"}, {cx - 10, cy + 4, "end"}, {cx, cy - 12, "middle"}, {cx + 10, cy + 20, "start"}, {cx - 10, cy + 20, "end"}};
        auto box_of = [&](const Spot& sp) {
            double x0 = sp.anchor[0] == 'm' ? sp.x - w / 2 : sp.anchor[0] == 's' ? sp.x : sp.x - w;
            return Box{x0, sp.y - kLabel + 1, x0 + w, sp.y - kLabel + 1 + h};
        };
        auto fits = [&](const Box& b) {
            if (b.x0 < left - 2 || b.x1 > left + S + 2 || b.y0 < top - 2 || b.y1 > top + S + 2) return false;
            for (const Box& t : taken)
                if (std::min(b.x1, t.x1) - std::max(b.x0, t.x0) > 0 && std::min(b.y1, t.y1) - std::max(b.y0, t.y0) > 0) return false;
            return true;
        };
        const Spot* at = &spots[0];
        for (const Spot& sp : spots)
            if (fits(box_of(sp))) {
                at = &sp;
                break;
            }
        // the first spot is kept when none is free; the box of the one chosen is taken either way
        Box placed = box_of(*at);
        // inside the chart sideways: a label that runs past the right or left edge is pulled in
        double shift = 0;
        if (placed.x1 > left + S) shift = left + S - placed.x1;
        else if (placed.x0 < left) shift = left - placed.x0;
        aligned_text(body, th, {p.name}, at->x + shift, at->y, kLabel, 400, th.text, at->anchor);
        placed.x0 += shift, placed.x1 += shift;
        taken.push_back(placed);
        body += "</g>\n";
    }
    svg = svg_document(th, W, H, body);
    return true;
}

}  // namespace mermaid
