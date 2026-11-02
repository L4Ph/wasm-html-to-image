#include "mermaid/cynefin.h"

#include <algorithm>
#include <cmath>
#include <map>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

constexpr double kPi = 3.14159265358979323846;

enum Domain { Complex, Complicated, Chaotic, Clear, Confusion, kDomains };

struct DomainInfo {
    const char* keyword;
    const char* title;
    const char* sense;     // how to act in the domain
    const char* practice;  // the kind of practice it gives
    int tint;              // percent of the accent over the background
};

const DomainInfo kInfo[kDomains] = {
    {"complex", "Complex", "Probe → Sense → Respond", "Emergent Practices", 14},
    {"complicated", "Complicated", "Sense → Analyse → Respond", "Good Practices", 9},
    {"chaotic", "Chaotic", "Act → Sense → Respond", "Novel Practices", 18},
    {"clear", "Clear", "Sense → Categorise → Respond", "Best Practices", 5},
    {"confusion", "Confusion", "Disorder", "", 12},
};

/// The official themes give each domain a colour of its own, drawn at 40% over the background.
std::string domain_fill(const Theme& th, int d) {
    if (d < (int)th.domains.size()) return th.domains[d];
    return mix(d == Confusion ? th.fg : th.accent, th.bg, kInfo[d].tint);
}

std::string domain_opacity(const Theme& th) { return th.domains.size() == kDomains ? " fill-opacity=\"0.4\"" : ""; }

struct Transition {
    int from, to;
    std::string label;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

int domain_of(const std::string& word) {
    for (int d = 0; d < kDomains; d++)
        if (word == kInfo[d].keyword) return d;
    return -1;
}

/// `"text"` or bare text into its content.
std::string unquote(std::string s) {
    s = trim(s);
    if (s.size() >= 2 && s.front() == '"' && s.back() == '"') s = s.substr(1, s.size() - 2);
    return s;
}

/// A wavy line from a to b: the same wave every time, so the picture is stable.
std::string wavy(Pt a, Pt b, double amp, int waves, double phase) {
    const int kSteps = 48;
    double dx = b.x - a.x, dy = b.y - a.y, len = std::sqrt(dx * dx + dy * dy);
    double nx = -dy / len, ny = dx / len;
    std::string d;
    for (int i = 0; i <= kSteps; i++) {
        double t = (double)i / kSteps, off = amp * std::sin(2 * kPi * waves * t + phase) * std::sin(kPi * t);
        d += std::string(i == 0 ? "M" : "L") + num(a.x + dx * t + nx * off) + " " + num(a.y + dy * t + ny * off) + " ";
    }
    return d;
}

}  // namespace

bool render_cynefin(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    std::string title;
    std::vector<std::string> items[kDomains];
    bool declared[kDomains] = {false, false, false, false, false};
    std::vector<Transition> transitions;
    int current = -1;
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
        if (starts(line, "title ")) {
            title = trim(line.substr(6));
        } else if (starts(line, "accTitle") || starts(line, "accDescr")) {
            continue;
        } else if (int d = domain_of(line); d >= 0) {
            declared[d] = true;
            current = d;
        } else if (line[0] == '"') {
            if (current < 0) {
                error = "an item belongs under a domain (complex, complicated, clear, chaotic, confusion): " + line;
                return false;
            }
            if (line.size() < 2 || line.back() != '"') {
                error = "an item is a quoted label: " + line;
                return false;
            }
            items[current].push_back(line.substr(1, line.size() - 2));
        } else if (size_t arrow = line.find("-->"); arrow != std::string::npos) {
            std::string from = trim(line.substr(0, arrow)), to = trim(line.substr(arrow + 3)), label;
            size_t colon = to.find(':');
            if (colon != std::string::npos) {
                label = unquote(to.substr(colon + 1));
                to = trim(to.substr(0, colon));
            }
            int a = domain_of(from), b = domain_of(to);
            if (a < 0 || b < 0) {
                error = "a transition is `domain --> domain : \"label\"` between the five domains: " + line;
                return false;
            }
            if (a != b) transitions.push_back({a, b, label});
        } else {
            error = "unrecognised line: " + line;
            return false;
        }
    }

    Theme th = make_theme(options);
    Text text{options};
    const double W = 800, H = 600, pad = 40;
    const double top = pad + (title.empty() ? 0 : 34), left = pad, right = W - pad, bottom = H - pad;
    const double mx = (left + right) / 2, my = (top + bottom) / 2;
    const double amp = 8;
    std::string body;
    if (!title.empty()) centered_text(body, th, {title}, W / 2, pad, 18, 600, th.text);

    // the four domains: complex and complicated above, chaotic and clear below
    struct Box {
        double x0, y0, x1, y1;
    } box[4] = {{left, top, mx, my}, {mx, top, right, my}, {left, my, mx, bottom}, {mx, my, right, bottom}};
    for (int d = 0; d < 4; d++) {
        const Box& b = box[d];
        body += "<rect x=\"" + num(b.x0) + "\" y=\"" + num(b.y0) + "\" width=\"" + num(b.x1 - b.x0) + "\" height=\"" + num(b.y1 - b.y0) + "\" fill=\"" + domain_fill(th, d) + "\"" + domain_opacity(th) + "/>\n";
    }
    // the boundaries between them wave; the one between clear and chaotic is the cliff
    const std::string boundary = th.line;
    auto joined = [](std::string d) {
        d[0] = 'L';  // continue the previous piece instead of starting a new one
        return d;
    };
    body += "<path d=\"" + wavy({mx, top}, {mx, my}, amp, 3, 0.6) + joined(wavy({mx, my}, {mx, bottom}, amp, 3, 2.1)) + "\" fill=\"none\" stroke=\"" + boundary + "\" stroke-width=\"2\"/>\n";
    body += "<path d=\"" + wavy({left, my}, {mx, my}, amp, 3, 1.3) + joined(wavy({mx, my}, {right, my}, amp, 3, 3.4)) + "\" fill=\"none\" stroke=\"" + boundary + "\" stroke-width=\"2\"/>\n";
    // the cliff: the lower half of the vertical boundary, where clear falls into chaotic
    body += "<path d=\"" + wavy({mx, my}, {mx, bottom}, amp, 3, 2.1) + "\" fill=\"none\" stroke=\"" + th.cliff + "\" stroke-width=\"4\"/>\n";
    body += "<rect x=\"" + num(left) + "\" y=\"" + num(top) + "\" width=\"" + num(right - left) + "\" height=\"" + num(bottom - top) + "\" fill=\"none\" stroke=\"" + boundary + "\" stroke-width=\"1\"/>\n";

    // domain titles, how to act there, and the items as badges
    auto badge = [&](double cx, double y, const std::string& label, double max_w) {
        double w = std::min(max_w, text.width(label, 12, 500) + 20);
        body += "<rect x=\"" + num(cx - w / 2) + "\" y=\"" + num(y) + "\" width=\"" + num(w) + "\" height=\"24\" rx=\"12\" fill=\"" + th.bg + "\" stroke=\"" + th.line + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, {label}, cx, y + 12, 12, 500, th.text);
    };
    for (int d = 0; d < 4; d++) {
        const Box& b = box[d];
        double cx = (b.x0 + b.x1) / 2, y = b.y0 + (d < 2 ? 24 : 24 + 62);  // the lower domains start below the confusion ellipse
        centered_text(body, th, {kInfo[d].title}, cx, y, 15, 700, th.text);
        y += 20;
        centered_text(body, th, {kInfo[d].sense}, cx, y, 11, 400, th.text_sec);
        y += 15;
        centered_text(body, th, {kInfo[d].practice}, cx, y, 11, 400, th.text_sec);
        y += 20;
        // the items stay clear of the confusion ellipse in the middle
        double max_w = (b.x1 - b.x0) - 30;
        double room = d < 2 ? b.y1 - 62 : b.y1 - 14;
        for (auto& it : items[d]) {
            if (y + 24 > room) break;
            badge(cx, y, it, max_w);
            y += 30;
        }
    }

    // confusion: an ellipse over the junction
    {
        double rx = 92, ry = 56;
        body += "<ellipse cx=\"" + num(mx) + "\" cy=\"" + num(my) + "\" rx=\"" + num(rx) + "\" ry=\"" + num(ry) + "\" fill=\"" + domain_fill(th, Confusion) + "\"" + domain_opacity(th) + " stroke=\"" + boundary + "\" stroke-width=\"2\"/>\n";
        double y = items[Confusion].empty() ? my - 9 : my - 26;
        centered_text(body, th, {kInfo[Confusion].title}, mx, y, 14, 700, th.text);
        centered_text(body, th, {kInfo[Confusion].sense}, mx, y + 18, 11, 400, th.text_sec);  // the centre is Disorder
        double iy = y + 30;
        size_t shown = std::min<size_t>(items[Confusion].size(), 3);
        for (size_t k = 0; k < shown; k++) {
            badge(mx, iy, items[Confusion][k], 2 * rx - 36);
            iy += 26;
            if (iy > my + ry - 12) break;
        }
        if (items[Confusion].size() > 3) centered_text(body, th, {"+" + std::to_string(items[Confusion].size() - 3) + " more"}, mx, std::min(iy + 8, my + ry - 8), 10, 400, th.text_sec);
    }

    // transitions: a curved arrow from one domain toward another
    for (auto& t : transitions) {
        auto centre = [&](int d) {
            if (d == Confusion) return Pt{mx, my};
            const Box& b = box[d];
            return Pt{(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2};
        };
        Pt a = centre(t.from), b = centre(t.to);
        double dx = b.x - a.x, dy = b.y - a.y, len = std::sqrt(dx * dx + dy * dy);
        if (len < 1) continue;
        double ux = dx / len, uy = dy / len;
        // leave and arrive near the border, on the side that faces the other domain
        Pt p{a.x + dx * 0.24, a.y + dy * 0.24}, q{a.x + dx * 0.76, a.y + dy * 0.76};
        double bend = 26;
        Pt c{(p.x + q.x) / 2 - uy * bend, (p.y + q.y) / 2 + ux * bend};
        std::string color = th.arrow;
        body += "<path d=\"M" + num(p.x) + " " + num(p.y) + " Q" + num(c.x) + " " + num(c.y) + " " + num(q.x) + " " + num(q.y) + "\" fill=\"none\" stroke=\"" + color + "\" stroke-width=\"2\"/>\n";
        double hx = q.x - c.x, hy = q.y - c.y, hl = std::sqrt(hx * hx + hy * hy);
        hx /= hl;
        hy /= hl;
        Pt base{q.x - hx * kArrowW, q.y - hy * kArrowW};
        body += "<polygon points=\"" + num(q.x) + "," + num(q.y) + " " + num(base.x - hy * kArrowH * 0.6) + "," + num(base.y + hx * kArrowH * 0.6) + " " + num(base.x + hy * kArrowH * 0.6) + "," + num(base.y - hx * kArrowH * 0.6) + "\" fill=\"" + color + "\"/>\n";
        if (!t.label.empty()) {
            Pt m{(p.x + 2 * c.x + q.x) / 4, (p.y + 2 * c.y + q.y) / 4};
            double w = text.width(t.label, 11, 500) + 12;
            body += "<rect x=\"" + num(m.x - w / 2) + "\" y=\"" + num(m.y - 9) + "\" width=\"" + num(w) + "\" height=\"18\" rx=\"4\" fill=\"" + th.bg + "\" stroke=\"" + th.inner_stroke + "\" stroke-width=\"1\"/>\n";
            centered_text(body, th, {t.label}, m.x, m.y, 11, 500, th.text);
        }
    }

    svg = svg_document(th, W, H, body);
    return true;
}

}  // namespace mermaid
