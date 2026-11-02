#include "mermaid/wardley.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <map>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

struct Node {
    std::string name;
    double vis = 0, evo = 0;
    bool anchor = false, inertia = false;
    std::string sourcing;  // build, buy, outsource, market, or empty
    bool has_offset = false;
    double dx = 0, dy = 0;  // label offset (px)
};

struct Link {
    std::string from, to;
    enum Kind { Plain, Dashed, Flow } kind = Plain;
    bool arrow_to = false, arrow_from = false;
    std::string label;
};

struct Evolve {
    std::string name;
    double target = 0;
};

struct Pipeline {
    std::string parent;
    std::vector<std::pair<std::string, double>> children;
};

struct Marker {  // note, accelerator or deaccelerator
    std::string text;
    double vis = 0, evo = 0;
    int kind = 0;  // 0 note, 1 accelerator, 2 deaccelerator
};

struct Annotation {
    int number = 0;
    double vis = 0, evo = 0;
    std::string text;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

bool is_space(char c) { return c == ' ' || c == '\t'; }

std::string unquote(std::string s) {
    s = trim(s);
    if (s.size() >= 2 && s.front() == '"' && s.back() == '"') s = s.substr(1, s.size() - 2);
    return s;
}

/// A name at the start of `s`: quoted, or up to the first ` [` / ` (` / end. `rest` gets what follows.
bool take_name(const std::string& s, std::string& name, std::string& rest) {
    std::string t = trim(s);
    if (t.empty()) return false;
    if (t[0] == '"') {
        size_t close = t.find('"', 1);
        if (close == std::string::npos) return false;
        name = t.substr(1, close - 1);
        rest = trim(t.substr(close + 1));
        return true;
    }
    size_t end = t.size();
    for (size_t i = 0; i < t.size(); i++) {
        if ((t[i] == '[' || t[i] == '(') && i > 0 && is_space(t[i - 1])) {
            end = i;
            break;
        }
    }
    name = trim(t.substr(0, end));
    rest = trim(t.substr(end));
    return !name.empty();
}

/// `[a, b]` or `[a]` at the start of `s` into `v` (1 or 2 numbers). `rest` gets what follows.
bool take_numbers(const std::string& s, std::vector<double>& v, std::string& rest) {
    std::string t = trim(s);
    if (t.empty() || t[0] != '[') return false;
    size_t close = t.find(']');
    if (close == std::string::npos) return false;
    v.clear();
    std::string inner = t.substr(1, close - 1);
    size_t at = 0;
    while (at <= inner.size()) {
        size_t comma = inner.find(',', at);
        std::string part = trim(inner.substr(at, comma == std::string::npos ? std::string::npos : comma - at));
        char* e = nullptr;
        double d = std::strtod(part.c_str(), &e);
        if (part.empty() || *e) return false;
        v.push_back(d);
        if (comma == std::string::npos) break;
        at = comma + 1;
    }
    rest = trim(t.substr(close + 1));
    return !v.empty();
}

/// The arrow of a link line: where it is, how long, and what it means.
struct Arrow {
    size_t at = std::string::npos, len = 0;
    Link::Kind kind = Link::Plain;
    bool to = false, from = false;
    std::string label;
};

Arrow find_arrow(const std::string& line) {
    Arrow best;
    auto consider = [&](size_t at, size_t len, Link::Kind kind, bool to, bool from, const std::string& label = "") {
        if (at == std::string::npos) return;
        if (best.at == std::string::npos || at < best.at || (at == best.at && len > best.len)) best = {at, len, kind, to, from, label};
    };
    size_t q = line.find("+'");
    if (q != std::string::npos) {
        size_t close = line.find("'>", q + 2);
        if (close != std::string::npos) consider(q, close + 2 - q, Link::Flow, true, false, line.substr(q + 2, close - q - 2));
    }
    consider(line.find("+<>"), 3, Link::Flow, true, true);
    consider(line.find("+>"), 2, Link::Flow, true, false);
    consider(line.find("+<"), 2, Link::Flow, false, true);
    consider(line.find("-.->"), 4, Link::Dashed, true, false);
    consider(line.find("-->"), 3, Link::Plain, false, false);
    consider(line.find("->"), 2, Link::Plain, false, false);
    return best;
}

}  // namespace

bool render_wardley(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    std::string title;
    double W = 1100, H = 600;
    std::vector<Node> nodes;
    std::map<std::string, size_t> index;
    std::vector<Link> links;
    std::vector<Evolve> evolves;
    std::vector<Pipeline> pipelines;
    std::vector<Marker> markers;
    std::vector<Annotation> annotations;
    bool has_annotation_box = false;
    double box_vis = 0, box_evo = 0;
    std::vector<std::string> stages = {"Genesis", "Custom Built", "Product", "Commodity"};
    std::vector<double> bounds = {0.25, 0.5, 0.75, 1.0};
    bool in_pipeline = false;
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
        std::string rest, name;
        std::vector<double> nums;
        if (in_pipeline) {
            if (line == "}") {
                in_pipeline = false;
                continue;
            }
            if (starts(line, "component ")) {
                if (!take_name(line.substr(10), name, rest) || !take_numbers(rest, nums, rest) || nums.size() != 1) {
                    error = "a pipeline child is `component Name [evolution]`: " + line;
                    return false;
                }
                pipelines.back().children.push_back({name, nums[0]});
                continue;
            }
            error = "only `component` lines belong inside a pipeline: " + line;
            return false;
        }
        if (starts(line, "title ")) {
            title = trim(line.substr(6));
        } else if (starts(line, "size ")) {
            if (!take_numbers(line.substr(5), nums, rest) || nums.size() != 2 || nums[0] < 200 || nums[1] < 150) {
                error = "size is `size [width, height]`: " + line;
                return false;
            }
            W = nums[0];
            H = nums[1];
        } else if (starts(line, "component ") || starts(line, "anchor ")) {
            bool anchor = starts(line, "anchor ");
            if (!take_name(line.substr(anchor ? 7 : 10), name, rest) || !take_numbers(rest, nums, rest) || nums.size() != 2) {
                error = std::string(anchor ? "an anchor" : "a component") + " is `Name [visibility, evolution]`: " + line;
                return false;
            }
            Node n;
            n.name = name;
            n.vis = std::min(1.0, std::max(0.0, nums[0]));
            n.evo = std::min(1.0, std::max(0.0, nums[1]));
            n.anchor = anchor;
            while (!rest.empty()) {
                if (starts(rest, "label")) {
                    if (!take_numbers(rest.substr(5), nums, rest) || nums.size() != 2) {
                        error = "a label offset is `label [x, y]`: " + line;
                        return false;
                    }
                    n.has_offset = true;
                    n.dx = nums[0];
                    n.dy = nums[1];
                } else if (rest[0] == '(') {
                    size_t close = rest.find(')');
                    if (close == std::string::npos) {
                        error = "an unclosed decorator: " + line;
                        return false;
                    }
                    std::string d = trim(rest.substr(1, close - 1));
                    if (d == "inertia") n.inertia = true;
                    else if (d == "build" || d == "buy" || d == "outsource" || d == "market") n.sourcing = d;
                    else {
                        error = "unknown decorator `" + d + "`: " + line;
                        return false;
                    }
                    rest = trim(rest.substr(close + 1));
                } else {
                    error = "unrecognised text after the coordinates: " + line;
                    return false;
                }
            }
            index[n.name] = nodes.size();
            nodes.push_back(n);
        } else if (starts(line, "pipeline ")) {
            std::string head = trim(line.substr(9));
            if (head.empty() || head.back() != '{' || !take_name(head.substr(0, head.size() - 1), name, rest) || !rest.empty()) {
                error = "a pipeline is `pipeline Name {`: " + line;
                return false;
            }
            pipelines.push_back({name, {}});
            in_pipeline = true;
        } else if (starts(line, "evolve ")) {
            std::string t = trim(line.substr(7));
            size_t sp = t.rfind(' ');
            char* e2 = nullptr;
            double target = sp == std::string::npos ? 0 : std::strtod(t.c_str() + sp + 1, &e2);
            if (sp == std::string::npos || *e2) {
                error = "evolve is `evolve Name target`: " + line;
                return false;
            }
            evolves.push_back({unquote(t.substr(0, sp)), std::min(1.0, std::max(0.0, target))});
        } else if (starts(line, "evolution ")) {
            std::vector<std::string> st;
            std::vector<double> ends;
            std::string t = line.substr(10);
            size_t at = 0;
            bool any_end = false;
            while (at <= t.size()) {
                size_t arrow = t.find("->", at);
                std::string part = trim(t.substr(at, arrow == std::string::npos ? std::string::npos : arrow - at));
                double end = -1;
                size_t amp = part.rfind('@');
                if (amp != std::string::npos) {
                    char* e2 = nullptr;
                    end = std::strtod(part.c_str() + amp + 1, &e2);
                    if (*e2 || end <= 0 || end > 1) {
                        error = "a stage width is `Name@0.25` with a value above 0 up to 1: " + line;
                        return false;
                    }
                    part = trim(part.substr(0, amp));
                    any_end = true;
                }
                if (part.empty()) {
                    error = "evolution is `evolution A -> B -> C`: " + line;
                    return false;
                }
                st.push_back(part);
                ends.push_back(end);
                if (arrow == std::string::npos) break;
                at = arrow + 2;
            }
            if (st.size() < 2) {
                error = "evolution needs at least two stages: " + line;
                return false;
            }
            stages = st;
            bounds.clear();
            double prev = 0;
            for (size_t k = 0; k < st.size(); k++) {
                double b = ends[k] > 0 ? ends[k] : (any_end ? std::min(1.0, prev + (1.0 - prev) / (double)(st.size() - k)) : (double)(k + 1) / st.size());
                bounds.push_back(b);
                prev = b;
            }
        } else if (starts(line, "note ") || starts(line, "accelerator ") || starts(line, "deaccelerator ")) {
            int kind = starts(line, "note ") ? 0 : starts(line, "accelerator ") ? 1 : 2;
            size_t skip = kind == 0 ? 5 : kind == 1 ? 12 : 14;
            if (!take_name(line.substr(skip), name, rest) || !take_numbers(rest, nums, rest) || nums.size() != 2) {
                error = "expected `text [visibility, evolution]`: " + line;
                return false;
            }
            markers.push_back({name, nums[0], nums[1], kind});
        } else if (starts(line, "annotations ")) {
            if (!take_numbers(line.substr(12), nums, rest) || nums.size() != 2) {
                error = "annotations is `annotations [x, y]`: " + line;
                return false;
            }
            has_annotation_box = true;
            box_vis = nums[0];
            box_evo = nums[1];
        } else if (starts(line, "annotation ")) {
            std::string t = trim(line.substr(11));
            char* e2 = nullptr;
            long number = std::strtol(t.c_str(), &e2, 10);
            std::string tail = trim(std::string(e2));
            if (tail.empty() || tail[0] != ',' || !take_numbers(tail.substr(1), nums, rest) || nums.size() != 2 || !take_name(rest, name, rest)) {
                error = "an annotation is `annotation N,[x, y] \"text\"`: " + line;
                return false;
            }
            annotations.push_back({(int)number, nums[0], nums[1], name});
        } else {
            Arrow a = find_arrow(line);
            size_t trend = line.find("-.-");
            if (a.at == std::string::npos || (trend != std::string::npos && trend < a.at && starts(trim(line.substr(trend + 3)), "("))) {
                error = "unrecognised line: " + line;
                return false;
            }
            std::string left = unquote(line.substr(0, a.at)), right = trim(line.substr(a.at + a.len)), label = a.label;
            size_t semi = right.find(';');
            if (semi != std::string::npos) {
                label = trim(right.substr(semi + 1));
                right = trim(right.substr(0, semi));
            }
            right = unquote(right);
            if (left.empty() || right.empty()) {
                error = "a link is `A -> B`: " + line;
                return false;
            }
            Link l;
            l.from = left;
            l.to = right;
            l.kind = a.kind;
            l.arrow_to = a.to;
            l.arrow_from = a.from;
            l.label = label;
            links.push_back(l);
        }
    }
    if (in_pipeline) {
        error = "a pipeline is not closed with `}`";
        return false;
    }
    if (nodes.empty()) {
        error = "no components";
        return false;
    }

    Theme th = make_theme(options);
    Text text{options};
    const double left = 70, right = 40, top = title.empty() ? 30 : 56, bottom = 78;
    const double pw = W - left - right, ph = H - top - bottom;
    auto X = [&](double evo) { return left + evo * pw; };
    auto Y = [&](double vis) { return top + (1 - vis) * ph; };
    std::string body;
    if (!title.empty()) centered_text(body, th, {title}, W / 2, 26, 18, 600, th.label);

    // axes and stage dividers
    const std::string axis = th.line;
    body += "<rect x=\"" + num(left) + "\" y=\"" + num(top) + "\" width=\"" + num(pw) + "\" height=\"" + num(ph) + "\" fill=\"none\" stroke=\"" + axis + "\" stroke-width=\"1\"/>\n";
    double from = 0;
    for (size_t k = 0; k < stages.size(); k++) {
        double to = bounds[k];
        if (k + 1 < stages.size())
            body += dashed_line(X(to), top, X(to), top + ph, axis, 1, "4 4");
        std::vector<std::string> parts;
        std::string label = stages[k];
        size_t at = 0;
        while (true) {
            size_t sl = label.find(" / ", at);
            parts.push_back(trim(label.substr(at, sl == std::string::npos ? std::string::npos : sl - at)));
            if (sl == std::string::npos) break;
            at = sl + 3;
        }
        centered_text(body, th, parts, X((from + to) / 2), top + ph + 18 + (parts.size() > 1 ? 7 : 0), 12, 500, th.text_sec);
        from = to;
    }
    centered_text(body, th, {"Evolution"}, left + pw / 2, top + ph + 56, 12, 600, th.label);
    {
        double cx = 22, cy = top + ph / 2;
        body += "<text transform=\"rotate(-90 " + num(cx) + " " + num(cy) + ")\" x=\"" + num(cx) + "\" y=\"" + num(cy + 4) + "\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"600\" font-family=\"" + esc(th.font) + "\" fill=\"" + th.text +
                "\">Visibility</text>\n";
    }

    auto arrow_head = [&](std::string& out, Pt tip, Pt from_pt, const std::string& color) {
        double dx = tip.x - from_pt.x, dy = tip.y - from_pt.y, len = std::sqrt(dx * dx + dy * dy);
        if (len < 1e-6) return;
        dx /= len;
        dy /= len;
        Pt b{tip.x - dx * kArrowW, tip.y - dy * kArrowW};
        out += "<polygon points=\"" + num(tip.x) + "," + num(tip.y) + " " + num(b.x - dy * kArrowH * 0.6) + "," + num(b.y + dx * kArrowH * 0.6) + " " + num(b.x + dy * kArrowH * 0.6) + "," + num(b.y - dx * kArrowH * 0.6) + "\" fill=\"" + color + "\"/>\n";
    };
    const double kR = 6;
    auto center = [&](const Node& n) { return Pt{X(n.evo), Y(n.vis)}; };

    // pipelines first: they sit behind the components
    for (auto& p : pipelines) {
        auto it = index.find(p.parent);
        if (it == index.end() || p.children.empty()) continue;
        const Node& parent = nodes[it->second];
        double lo = 1, hi = 0;
        for (auto& c : p.children) {
            lo = std::min(lo, c.second);
            hi = std::max(hi, c.second);
        }
        double y = Y(parent.vis) + 30;
        body += "<rect x=\"" + num(X(lo) - 14) + "\" y=\"" + num(y - 14) + "\" width=\"" + num(X(hi) - X(lo) + 28) + "\" height=\"28\" fill=\"none\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"/>\n";
        for (auto& c : p.children) {
            body += "<rect x=\"" + num(X(c.second) - 4) + "\" y=\"" + num(y - 4) + "\" width=\"8\" height=\"8\" fill=\"" + th.component_fill + "\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"/>\n";
            aligned_text(body, th, {c.first}, X(c.second), y + 25, 11, 400, th.label, "middle");
        }
    }

    // links
    for (auto& l : links) {
        auto a = index.find(l.from), b = index.find(l.to);
        if (a == index.end() || b == index.end()) continue;
        Pt p = center(nodes[a->second]), q = center(nodes[b->second]);
        double dx = q.x - p.x, dy = q.y - p.y, len = std::sqrt(dx * dx + dy * dy);
        if (len < 1e-6) continue;
        double ux = dx / len, uy = dy / len;
        Pt p2{p.x + ux * kR, p.y + uy * kR}, q2{q.x - ux * kR, q.y - uy * kR};
        std::string color = l.kind == Link::Flow ? th.arrow : th.line;
        if (l.kind == Link::Dashed)
            body += dashed_line(p2.x, p2.y, q2.x, q2.y, color, 1.2, "5 4");
        else
            body += "<line x1=\"" + num(p2.x) + "\" y1=\"" + num(p2.y) + "\" x2=\"" + num(q2.x) + "\" y2=\"" + num(q2.y) + "\" stroke=\"" + color + "\" stroke-width=\"" + (l.kind == Link::Flow ? "2" : "1.2") + "\"/>\n";
        if (l.arrow_to) arrow_head(body, q2, p2, color);
        if (l.arrow_from) arrow_head(body, p2, q2, color);
        if (!l.label.empty()) centered_text(body, th, {l.label}, (p.x + q.x) / 2, (p.y + q.y) / 2 - 8, 11, 400, th.text_sec);
    }

    // evolve arrows
    for (auto& ev : evolves) {
        auto it = index.find(ev.name);
        if (it == index.end()) continue;
        Pt p = center(nodes[it->second]);
        double tx = X(ev.target);
        if (std::abs(tx - p.x) < kR) continue;
        double dir = tx > p.x ? 1 : -1;
        body += dashed_line(p.x + dir * kR, p.y, tx - dir * kR, p.y, th.evolution, 1.5, "5 4");
        arrow_head(body, {tx - dir * kR, p.y}, {p.x, p.y}, th.evolution);
        body += "<circle cx=\"" + num(tx) + "\" cy=\"" + num(p.y) + "\" r=\"" + num(kR) + "\" fill=\"none\" stroke=\"#d9534f\" stroke-width=\"1.5\"/>\n";
    }

    // components
    for (auto& n : nodes) {
        Pt c = center(n);
        body += "<circle cx=\"" + num(c.x) + "\" cy=\"" + num(c.y) + "\" r=\"" + num(kR) + "\" fill=\"" + th.component_fill + "\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"/>\n";
        const std::string ring = "fill=\"none\" stroke=\"" + th.line + "\" stroke-width=\"1.2\"";
        if (n.sourcing == "build") {
            double r = 12;
            body += "<polygon points=\"" + num(c.x) + "," + num(c.y - r) + " " + num(c.x + r) + "," + num(c.y + r * 0.8) + " " + num(c.x - r) + "," + num(c.y + r * 0.8) + "\" " + ring + "/>\n";
        } else if (n.sourcing == "buy") {
            double r = 12;
            body += "<polygon points=\"" + num(c.x) + "," + num(c.y - r) + " " + num(c.x + r) + "," + num(c.y) + " " + num(c.x) + "," + num(c.y + r) + " " + num(c.x - r) + "," + num(c.y) + "\" " + ring + "/>\n";
        } else if (n.sourcing == "outsource") {
            body += "<rect x=\"" + num(c.x - 11) + "\" y=\"" + num(c.y - 11) + "\" width=\"22\" height=\"22\" " + ring + "/>\n";
        } else if (n.sourcing == "market") {
            body += "<circle cx=\"" + num(c.x) + "\" cy=\"" + num(c.y) + "\" r=\"12\" " + ring + "/>\n";
        }
        if (n.inertia) body += "<line x1=\"" + num(c.x + 18) + "\" y1=\"" + num(c.y - 9) + "\" x2=\"" + num(c.x + 18) + "\" y2=\"" + num(c.y + 9) + "\" stroke=\"" + th.line + "\" stroke-width=\"3\"/>\n";
        double pad = n.sourcing.empty() && !n.inertia ? 0 : 8;
        double lx = c.x + (n.has_offset ? n.dx : 10 + pad);
        double ly = c.y + (n.has_offset ? n.dy : -12);
        bool flip = !n.has_offset && lx + text.width(n.name, 12, n.anchor ? 700 : 400) > W - 10;
        aligned_text(body, th, {n.name}, flip ? c.x - 10 - pad : lx, ly, 12, n.anchor ? 700 : 400, th.label, flip ? "end" : "start");
    }

    // notes and forces
    for (auto& m : markers) {
        double x = X(m.evo), y = Y(m.vis);
        if (m.kind == 0) {
            aligned_text(body, th, {m.text}, x, y, 11, 400, th.text_sec, "start");
        } else {
            std::string color = m.kind == 1 ? "#2f9e5f" : th.evolution;
            double w = 26, h = 10, dir = m.kind == 1 ? 1 : -1;
            body += "<polygon points=\"" + num(x) + "," + num(y - h) + " " + num(x + dir * w) + "," + num(y - h) + " " + num(x + dir * w) + "," + num(y - h - 6) + " " + num(x + dir * (w + 14)) + "," + num(y) + " " + num(x + dir * w) + "," +
                    num(y + h + 6) + " " + num(x + dir * w) + "," + num(y + h) + " " + num(x) + "," + num(y + h) + "\" fill=\"" + color + "\" fill-opacity=\"0.35\" stroke=\"" + color + "\" stroke-width=\"1.2\"/>\n";
            aligned_text(body, th, {m.text}, x + dir * (w + 20), y, 11, 500, th.label, dir > 0 ? "start" : "end");
        }
    }

    // numbered annotations and their key
    for (auto& a : annotations) {
        double x = X(a.evo), y = Y(a.vis);
        body += "<circle cx=\"" + num(x) + "\" cy=\"" + num(y) + "\" r=\"9\" fill=\"" + th.component_fill + "\" stroke=\"" + th.line + "\" stroke-width=\"1.2\"/>\n";
        centered_text(body, th, {std::to_string(a.number)}, x, y, 10, 600, th.label);
    }
    if (!annotations.empty()) {
        double bx = has_annotation_box ? X(box_evo) : left + 12, by = has_annotation_box ? Y(box_vis) : top + 12;
        double bw = 0;
        for (auto& a : annotations) bw = std::max(bw, text.width(std::to_string(a.number) + ". " + a.text, 11, 400));
        double bh = (double)annotations.size() * 16 + 12;
        body += "<rect x=\"" + num(bx) + "\" y=\"" + num(by) + "\" width=\"" + num(bw + 20) + "\" height=\"" + num(bh) + "\" fill=\"" + th.surface + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        for (size_t k = 0; k < annotations.size(); k++)
            aligned_text(body, th, {std::to_string(annotations[k].number) + ". " + annotations[k].text}, bx + 10, by + 14 + 16 * k, 11, 400, th.label, "start");
    }

    svg = svg_document(th, W, H, body);
    return true;
}

}  // namespace mermaid
