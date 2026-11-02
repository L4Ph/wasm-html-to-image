#include "mermaid/requirement.h"

#include <algorithm>
#include <cmath>
#include <map>

#include "mermaid/layered.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

struct Item {
    std::string name, stereotype;
    std::vector<std::pair<std::string, std::string>> fields;  // label, value
    std::vector<std::string> rows;  // the fields as drawn, a long one broken over several rows
    double w = 0, h = 0, head_h = 0;
};

struct Relation {
    int from, to;
    std::string kind;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

std::string unquote(std::string s) {
    s = trim(s);
    if (s.size() >= 2 && s.front() == '"' && s.back() == '"') s = s.substr(1, s.size() - 2);
    return s;
}

std::string capitalise(std::string s) {
    if (!s.empty()) s[0] = (char)std::toupper((unsigned char)s[0]);
    return s;
}

}  // namespace

bool render_requirement(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    std::vector<Item> items;
    std::vector<Relation> rels;
    std::map<std::string, int> index;
    static const char* kKinds[] = {"requirement", "functionalRequirement", "performanceRequirement", "interfaceRequirement", "physicalRequirement", "designConstraint", "element"};
    static const char* kLabels[] = {"Requirement", "Functional Requirement", "Performance Requirement", "Interface Requirement", "Physical Requirement", "Design Constraint", "Element"};
    int open = -1;
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
        if (open >= 0) {
            if (line == "}") {
                open = -1;
                continue;
            }
            size_t colon = line.find(':');
            if (colon == std::string::npos) {
                error = "a field is `key: value`: " + line;
                return false;
            }
            std::string key = trim(line.substr(0, colon)), value = unquote(line.substr(colon + 1));
            std::string label = key == "verifymethod" ? "Verification" : key == "docref" ? "Doc Ref" : key == "id" ? "ID" : capitalise(key);
            items[open].fields.push_back({label, capitalise(key == "risk" || key == "verifymethod" ? value : value)});
            if (key == "text" || key == "id" || key == "type" || key == "docref") items[open].fields.back().second = value;
            continue;
        }
        bool declared = false;
        for (size_t k = 0; k < 7; k++) {
            std::string kw = std::string(kKinds[k]) + " ";
            if (!starts(line, kw.c_str())) continue;
            std::string rest = trim(line.substr(kw.size()));
            if (rest.empty() || rest.back() != '{') {
                error = "expected `{` after the name: " + line;
                return false;
            }
            Item it;
            it.name = unquote(trim(rest.substr(0, rest.size() - 1)));
            it.stereotype = std::string("<<") + kLabels[k] + ">>";
            items.push_back(it);
            index[it.name] = (int)items.size() - 1;
            open = (int)items.size() - 1;
            declared = true;
            break;
        }
        if (declared) continue;
        // `a - kind -> b` or `b <- kind - a`
        size_t fwd = line.find(" - "), back = line.find(" <- ");
        if (fwd != std::string::npos && line.find(" -> ", fwd) != std::string::npos) {
            size_t arrow = line.find(" -> ", fwd);
            std::string a = trim(line.substr(0, fwd)), kind = trim(line.substr(fwd + 3, arrow - fwd - 3)), b = trim(line.substr(arrow + 4));
            if (!index.count(a) || !index.count(b)) {
                error = "unknown item in: " + line;
                return false;
            }
            rels.push_back({index[a], index[b], kind});
        } else if (back != std::string::npos && line.find(" - ", back + 4) != std::string::npos) {
            size_t dash = line.find(" - ", back + 4);
            std::string b = trim(line.substr(0, back)), kind = trim(line.substr(back + 4, dash - back - 4)), a = trim(line.substr(dash + 3));
            if (!index.count(a) || !index.count(b)) {
                error = "unknown item in: " + line;
                return false;
            }
            rels.push_back({index[a], index[b], kind});
        } else {
            // without spaces: `a-kind->b` or `b<-kind-a`
            size_t fa = line.find("->"), fd = line.find('-'), ba = line.find("<-");
            std::string a, b, kind;
            if (fa != std::string::npos && fd != std::string::npos && fd < fa && (ba == std::string::npos || ba > fd)) {
                a = trim(line.substr(0, fd));
                kind = trim(line.substr(fd + 1, fa - fd - 1));
                b = trim(line.substr(fa + 2));
            } else if (ba != std::string::npos && line.find('-', ba + 2) != std::string::npos) {
                size_t dash = line.find('-', ba + 2);
                b = trim(line.substr(0, ba));
                kind = trim(line.substr(ba + 2, dash - ba - 2));
                a = trim(line.substr(dash + 1));
            }
            if (a.empty() || b.empty() || kind.empty()) {
                error = "unrecognised line: " + line;
                return false;
            }
            if (!index.count(a) || !index.count(b)) {
                error = "unknown item in: " + line;
                return false;
            }
            rels.push_back({index[a], index[b], kind});
        }
    }
    if (open >= 0) {
        error = "unclosed block";
        return false;
    }
    if (items.empty()) {
        error = "a requirement diagram needs at least one item";
        return false;
    }

    Theme th = make_theme(options);
    Text text{options};
    const double kRow = 18, kPad = 12, kHead = 44;
    std::vector<LayoutNode> ln(items.size());
    for (size_t k = 0; k < items.size(); k++) {
        Item& it = items[k];
        double w = std::max(text.width(it.name, 13, 600), text.width(it.stereotype, 11, 400));
        // a long field (a requirement's text) breaks over rows instead of making the box as wide as the sentence
        for (auto& f : it.fields)
            for (const std::string& row : wrap_lines(text, {f.first + ": " + f.second}, 12, 400, kWrapWidth)) it.rows.push_back(row);
        for (const std::string& row : it.rows) w = std::max(w, text.width(row, 12, 400));
        it.w = std::max(150.0, w + 2 * kPad);
        it.head_h = kHead;
        it.h = kHead + (it.rows.empty() ? 8 : it.rows.size() * kRow + 12);
        ln[k].w = it.w;
        ln[k].h = it.h;
    }
    std::vector<LayoutEdge> le(rels.size());
    for (size_t k = 0; k < rels.size(); k++) {
        le[k].from = rels[k].from;
        le[k].to = rels[k].to;
        le[k].label_w = text.width("<<" + rels[k].kind + ">>", kEdgeFont, kEdgeWeight) + 16;
        le[k].label_h = kEdgeFont * kLineHeight + 12;
    }
    LayoutResult lay = layout_layered(ln, le, Direction::TD);
    const double ox = kMargin, oy = kMargin;
    auto at = [&](Pt p) { return Pt{p.x + ox, p.y + oy}; };
    std::string body;
    for (size_t k = 0; k < rels.size(); k++) {
        if (lay.points[k].size() < 2) continue;
        std::vector<Pt> pts;
        std::string list;
        for (const Pt& p : lay.points[k]) {
            pts.push_back(at(p));
            list += (list.empty() ? "" : " ") + num(pts.back().x) + "," + num(pts.back().y);
        }
        body += "<polyline class=\"edge\" points=\"" + list + "\" fill=\"none\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"" + (rels[k].kind == "contains" ? "" : " stroke-dasharray=\"6 4\"") +
                " stroke-linejoin=\"round\"/>\n";
        Pt tip = pts.back(), from = pts[pts.size() - 2];
        double dx = tip.x - from.x, dy = tip.y - from.y, len = std::sqrt(dx * dx + dy * dy);
        if (len > 0.001) {
            dx /= len;
            dy /= len;
            double nx = -dy * 5, ny = dx * 5;
            body += "<polygon points=\"" + num(tip.x) + "," + num(tip.y) + " " + num(tip.x - dx * 9 + nx) + "," + num(tip.y - dy * 9 + ny) + " " + num(tip.x - dx * 9 - nx) + "," + num(tip.y - dy * 9 - ny) +
                    "\" fill=\"" + th.arrow + "\"/>\n";
        }
    }
    for (size_t k = 0; k < rels.size(); k++) {
        Pt c = at(lay.label_center[k]);
        body += "<g class=\"edge-label\">\n<rect x=\"" + num(c.x - le[k].label_w / 2) + "\" y=\"" + num(c.y - le[k].label_h / 2) + "\" width=\"" + num(le[k].label_w) + "\" height=\"" + num(le[k].label_h) +
                "\" rx=\"2\" fill=\"" + th.label_bg + "\" stroke=\"" + th.label_stroke + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, {"<<" + rels[k].kind + ">>"}, c.x, c.y, kEdgeFont, kEdgeWeight, th.text_sec);
        body += "</g>\n";
    }
    for (size_t k = 0; k < items.size(); k++) {
        const Item& it = items[k];
        Pt p = at(lay.center[k]);
        double x = p.x - it.w / 2, y = p.y - it.h / 2;
        body += "<g class=\"node\">\n<rect x=\"" + num(x) + "\" y=\"" + num(y) + "\" width=\"" + num(it.w) + "\" height=\"" + num(it.h) + "\" fill=\"" + th.surface + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        body += "<rect x=\"" + num(x) + "\" y=\"" + num(y) + "\" width=\"" + num(it.w) + "\" height=\"" + num(it.head_h) + "\" fill=\"" + th.group_hdr + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, {it.stereotype}, p.x, y + 14, 11, 400, th.text_sec);
        centered_text(body, th, {it.name}, p.x, y + 31, 13, 600, th.text);
        for (size_t f = 0; f < it.rows.size(); f++)
            aligned_text(body, th, {it.rows[f]}, x + kPad, y + it.head_h + 10 + f * kRow + kRow / 2, 12, 400, th.text, "start");
        body += "</g>\n";
    }
    svg = svg_document(th, lay.width + 2 * kMargin, lay.height + 2 * kMargin, body);
    return true;
}

}  // namespace mermaid
