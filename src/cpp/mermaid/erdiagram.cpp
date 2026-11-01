#include "mermaid/erdiagram.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>

#include "mermaid/layered.h"
#include "mermaid/nodestyle.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

enum Card { kOne, kZeroOne, kOneMany, kZeroMany };

struct Attr {
    std::string type, name, keys, comment;
};

struct Entity {
    std::string id, title;
    std::vector<Attr> attrs;
    double w = 0, h = 0;
    double type_w = 0, name_w = 0, key_w = 0;
};

struct Relation {
    int a, b;
    Card ca, cb;
    bool dashed;
    std::string label;
};

struct Doc {
    std::vector<Entity> entities;
    std::vector<Relation> rels;
    std::map<std::string, int> index;
    Direction dir = Direction::TD;
    StyleSheet sheet;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

std::string unquote(std::string s) {
    s = trim(s);
    if (s.size() >= 2 && s.front() == '"' && s.back() == '"') s = s.substr(1, s.size() - 2);
    return s;
}

int entity_for(Doc& d, const std::string& raw) {
    std::string id = trim(raw), title = id;
    size_t br = id.find('[');  // ID["Alias"]
    if (br != std::string::npos && id.back() == ']') {
        title = unquote(id.substr(br + 1, id.size() - br - 2));
        id = trim(id.substr(0, br));
    }
    auto it = d.index.find(id);
    if (it != d.index.end()) {
        if (title != id) d.entities[it->second].title = title;
        return it->second;
    }
    Entity e;
    e.id = id;
    e.title = title;
    d.entities.push_back(e);
    return d.index[id] = (int)d.entities.size() - 1;
}

bool add_attr(Entity& e, const std::string& raw) {
    std::string line = trim(raw);
    if (line.empty()) return true;
    Attr a;
    size_t q = line.find('"');
    if (q != std::string::npos) {
        a.comment = unquote(line.substr(q));
        line = trim(line.substr(0, q));
    }
    std::vector<std::string> tok;
    for (size_t i = 0; i < line.size();) {
        while (i < line.size() && (line[i] == ' ' || line[i] == '\t')) i++;
        size_t j = i;
        while (j < line.size() && line[j] != ' ' && line[j] != '\t') j++;
        if (j > i) tok.push_back(line.substr(i, j - i));
        i = j;
    }
    if (tok.size() < 2) return false;
    a.type = tok[0];
    a.name = tok[1];
    for (size_t k = 2; k < tok.size(); k++) a.keys += (a.keys.empty() ? "" : ",") + tok[k];
    e.attrs.push_back(a);
    return true;
}

bool left_card(const std::string& t, Card& c) {
    if (t == "||") c = kOne;
    else if (t == "|o") c = kZeroOne;
    else if (t == "}|") c = kOneMany;
    else if (t == "}o") c = kZeroMany;
    else return false;
    return true;
}

bool right_card(const std::string& t, Card& c) {
    if (t == "||") c = kOne;
    else if (t == "o|") c = kZeroOne;
    else if (t == "|{") c = kOneMany;
    else if (t == "o{") c = kZeroMany;
    else return false;
    return true;
}

// The relationship written in words: `A one to many B : label`, `A zero or more optionally to one or more B`.
bool word_card(std::string t, Card& c) {
    for (char& ch : t) ch = (char)std::tolower((unsigned char)ch);
    if (t == "one or zero" || t == "zero or one") c = kZeroOne;
    else if (t == "one or more" || t == "one or many" || t == "1+" || t == "many(1)") c = kOneMany;
    else if (t == "zero or more" || t == "zero or many" || t == "0+" || t == "many(0)" || t == "many") c = kZeroMany;
    else if (t == "one" || t == "only one" || t == "1") c = kOne;
    else return false;
    return true;
}

bool parse_worded_relation(const std::string& line, Relation& r, std::string& left, std::string& right, std::string& label) {
    std::string head = line;
    size_t colon = line.find(':');
    if (colon != std::string::npos) {
        head = trim(line.substr(0, colon));
        label = unquote(line.substr(colon + 1));
    }
    std::vector<std::string> tok;
    for (size_t i = 0; i < head.size();) {
        while (i < head.size() && (head[i] == ' ' || head[i] == '	')) i++;
        size_t j = i;
        while (j < head.size() && head[j] != ' ' && head[j] != '	') j++;
        if (j > i) tok.push_back(head.substr(i, j - i));
        i = j;
    }
    for (size_t k = 2; k + 2 < tok.size(); k++) {
        bool optional = tok[k] == "to" && tok[k - 1] == "optionally";
        if (tok[k] != "to") continue;
        size_t from = optional ? k - 1 : k;
        std::string a, b;
        for (size_t m = 1; m < from; m++) a += (a.empty() ? "" : " ") + tok[m];
        for (size_t m = k + 1; m + 1 < tok.size(); m++) b += (b.empty() ? "" : " ") + tok[m];
        if (!word_card(a, r.ca) || !word_card(b, r.cb)) continue;
        r.dashed = optional;
        left = tok[0];
        right = tok.back();
        return true;
    }
    return false;
}

bool parse(const std::string& source, Doc& d, std::string& error) {
    bool first = true;
    int open = -1;
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
        if (open >= 0) {
            if (line == "}") open = -1;
            else if (!add_attr(d.entities[open], line)) {
                error = "an attribute needs a type and a name: " + line;
                return false;
            }
            continue;
        }
        if (starts(line, "direction ")) {
            std::string v = trim(line.substr(10));
            d.dir = v == "LR" ? Direction::LR : v == "RL" ? Direction::RL : v == "BT" ? Direction::BT : Direction::TD;
            continue;
        }
        if (d.sheet.take(line)) continue;
        if (starts(line, "title ") || starts(line, "style ") || starts(line, "classDef ") || starts(line, "class ")) continue;
        if (line.back() == '{') {
            open = entity_for(d, line.substr(0, line.size() - 1));
            continue;
        }
        {
            Relation r;
            std::string left, right, label;
            if (parse_worded_relation(line, r, left, right, label)) {
                r.a = entity_for(d, left);
                r.b = entity_for(d, right);
                r.label = label;
                d.rels.push_back(r);
                continue;
            }
        }
        size_t p = line.find("--");
        bool dashed = false;
        size_t dots = line.find("..");
        if (p == std::string::npos || (dots != std::string::npos && dots < p)) p = dots, dashed = true;
        if (p != std::string::npos && p >= 2 && p + 4 <= line.size()) {
            Relation r;
            r.dashed = dashed;
            if (!left_card(line.substr(p - 2, 2), r.ca) || !right_card(line.substr(p + 2, 2), r.cb)) {
                error = "unknown relationship: " + line;
                return false;
            }
            std::string left = trim(line.substr(0, p - 2)), right = trim(line.substr(p + 4)), label;
            size_t colon = right.find(':');
            if (colon != std::string::npos) {
                label = unquote(right.substr(colon + 1));
                right = trim(right.substr(0, colon));
            }
            if (left.empty() || right.empty()) {
                error = "a relationship needs two entities: " + line;
                return false;
            }
            r.a = entity_for(d, left);
            r.b = entity_for(d, right);
            r.label = label;
            d.rels.push_back(r);
            continue;
        }
        entity_for(d, line);  // a bare entity name
    }
    if (open >= 0) {
        error = "unclosed entity block";
        return false;
    }
    return true;
}

constexpr double kHead = 30, kRow = 22, kCellPad = 10;

struct Dir2 {
    double x, y;
};

Dir2 unit(Pt from, Pt to) {
    double dx = to.x - from.x, dy = to.y - from.y, len = std::sqrt(dx * dx + dy * dy);
    return len < 0.001 ? Dir2{0, 1} : Dir2{dx / len, dy / len};
}

/// Crow's-foot marks at `tip`; d points from the line into the entity.
void draw_card(std::string& out, Card c, Pt tip, Dir2 d, const Theme& th) {
    double nx = -d.y, ny = d.x;
    auto at = [&](double along, double side) { return Pt{tip.x - d.x * along + nx * side, tip.y - d.y * along + ny * side}; };
    auto seg = [&](Pt a, Pt b) {
        out += "<line x1=\"" + num(a.x) + "\" y1=\"" + num(a.y) + "\" x2=\"" + num(b.x) + "\" y2=\"" + num(b.y) + "\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"/>\n";
    };
    auto bar = [&](double along) { seg(at(along, -6), at(along, 6)); };
    auto circle = [&](double along) {
        Pt p = at(along, 0);
        out += "<circle cx=\"" + num(p.x) + "\" cy=\"" + num(p.y) + "\" r=\"4\" fill=\"" + th.bg + "\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"/>\n";
    };
    auto foot = [&]() {
        seg(at(12, 0), at(0, -6));
        seg(at(12, 0), at(0, 0));
        seg(at(12, 0), at(0, 6));
    };
    switch (c) {
        case kOne: bar(8), bar(13); break;
        case kZeroOne: bar(8), circle(16); break;
        case kOneMany: foot(), bar(16); break;
        case kZeroMany: foot(), circle(18); break;
    }
}

}  // namespace

bool render_er(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    Doc d;
    if (!parse(source, d, error)) return false;
    if (d.entities.empty()) {
        error = "empty diagram";
        return false;
    }
    Theme th = make_theme(options);
    Text text{options};
    constexpr double kAttrFont = 12;

    std::vector<LayoutNode> ln(d.entities.size());
    for (size_t k = 0; k < d.entities.size(); k++) {
        Entity& e = d.entities[k];
        for (auto& a : e.attrs) {
            e.type_w = std::max(e.type_w, text.width(a.type, kAttrFont, 400));
            e.name_w = std::max(e.name_w, text.width(a.name, kAttrFont, 500));
            e.key_w = std::max(e.key_w, text.width(a.keys, kAttrFont - 1, 600));
        }
        double cols = e.type_w + e.name_w + e.key_w + (e.key_w > 0 ? 3 : 2) * kCellPad * 1.0 + kCellPad;
        e.w = std::max(std::max(100.0, text.width(e.title, kNodeFont, 600) + 2 * kPadX), cols);
        e.h = kHead + (e.attrs.empty() ? 8 : e.attrs.size() * kRow + 6);
        ln[k].w = e.w;
        ln[k].h = e.h;
    }
    std::vector<LayoutEdge> le(d.rels.size());
    std::vector<std::vector<std::string>> label_lines(d.rels.size());
    for (size_t k = 0; k < d.rels.size(); k++) {
        le[k].from = d.rels[k].a;
        le[k].to = d.rels[k].b;
        if (!d.rels[k].label.empty()) {
            label_lines[k] = wrap_lines(text, split_lines(d.rels[k].label), kEdgeFont, kEdgeWeight, kWrapWidth);
            le[k].label_w = text.block_width(label_lines[k], kEdgeFont, kEdgeWeight) + 16;
            le[k].label_h = label_lines[k].size() * kEdgeFont * kLineHeight + 16;
        }
    }
    LayoutResult lay = layout_layered(ln, le, d.dir);
    const double ox = kMargin, oy = kMargin;
    auto at = [&](Pt p) { return Pt{p.x + ox, p.y + oy}; };

    std::string body;
    for (size_t k = 0; k < d.rels.size(); k++) {
        const Relation& r = d.rels[k];
        if (lay.points[k].size() < 2) continue;
        std::vector<Pt> pts;
        std::string list;
        for (const Pt& p : lay.points[k]) {
            pts.push_back(at(p));
            list += (list.empty() ? "" : " ") + num(pts.back().x) + "," + num(pts.back().y);
        }
        body += "<polyline class=\"edge\" points=\"" + list + "\" fill=\"none\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"" + (r.dashed ? " stroke-dasharray=\"5 4\"" : "") +
                " stroke-linejoin=\"round\"/>\n";
        draw_card(body, r.ca, pts.front(), unit(pts[1], pts[0]), th);
        draw_card(body, r.cb, pts.back(), unit(pts[pts.size() - 2], pts.back()), th);
    }
    for (size_t k = 0; k < d.rels.size(); k++) {
        if (label_lines[k].empty()) continue;
        Pt c = at(lay.label_center[k]);
        body += "<g class=\"edge-label\">\n<rect x=\"" + num(c.x - le[k].label_w / 2) + "\" y=\"" + num(c.y - le[k].label_h / 2) + "\" width=\"" + num(le[k].label_w) + "\" height=\"" +
                num(le[k].label_h) + "\" rx=\"2\" ry=\"2\" fill=\"" + th.label_bg + "\" stroke=\"" + th.label_stroke + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, label_lines[k], c.x, c.y, kEdgeFont, kEdgeWeight, th.text_sec);
        body += "</g>\n";
    }
    for (size_t k = 0; k < d.entities.size(); k++) {
        const Entity& e = d.entities[k];
        Pt p = at(lay.center[k]);
        double x = p.x - e.w / 2, y = p.y - e.h / 2;
        body += "<g class=\"node\">\n<rect x=\"" + num(x) + "\" y=\"" + num(y) + "\" width=\"" + num(e.w) + "\" height=\"" + num(e.h) + "\"" + d.sheet.paint(e.id, th.surface, th.border) + "/>\n";
        body += "<rect x=\"" + num(x) + "\" y=\"" + num(y) + "\" width=\"" + num(e.w) + "\" height=\"" + num(kHead) + "\" fill=\"" + th.group_hdr + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, {e.title}, p.x, y + kHead / 2, kNodeFont, 600, th.text);
        double type_x = x + kCellPad, name_x = type_x + e.type_w + kCellPad, key_x = x + e.w - kCellPad;
        for (size_t m = 0; m < e.attrs.size(); m++) {
            const Attr& a = e.attrs[m];
            double cy = y + kHead + 3 + m * kRow + kRow / 2;
            if (m % 2 == 1) body += "<rect x=\"" + num(x + 0.5) + "\" y=\"" + num(cy - kRow / 2) + "\" width=\"" + num(e.w - 1) + "\" height=\"" + num(kRow) + "\" fill=\"" + th.group_hdr + "\"/>\n";
            aligned_text(body, th, {a.type}, type_x, cy, kAttrFont, 400, th.text_sec, "start");
            aligned_text(body, th, {a.name}, name_x, cy, kAttrFont, 500, th.text, "start");
            if (!a.keys.empty()) aligned_text(body, th, {a.keys}, key_x, cy, kAttrFont - 1, 600, th.text_sec, "end");
        }
        body += "</g>\n";
    }
    svg = svg_document(th, lay.width + 2 * kMargin, lay.height + 2 * kMargin, body);
    return true;
}

}  // namespace mermaid
