#include "mermaid/classdiagram.h"

#include <algorithm>
#include <cmath>
#include <map>

#include "mermaid/layered.h"
#include "mermaid/nodestyle.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

enum Mark { kNoMark = 0, kTriangle, kDiamondFilled, kDiamondHollow, kArrow };

struct Member {
    std::string text;
    bool statik = false, abstrakt = false;  // the `$` and `*` classifiers
};

struct Class {
    std::string name, display, annotation;
    std::vector<Member> attrs, methods;
    double w = 0, h = 0, head_h = 0, attrs_h = 0;
    int ns = -1;  // the `namespace` it was declared in
};

struct Relation {
    int a, b;  // as written
    Mark ma, mb;
    bool dashed;
    std::string label, card_a, card_b;
};

struct Doc {
    std::vector<Class> classes;
    std::vector<Relation> rels;
    std::vector<std::string> namespaces;
    struct Note {
        std::string text;
        int target = -1;  // the class it is for, or -1 for a note of its own
    };
    std::vector<Note> notes;
    int cur_ns = -1;  // while parsing: the namespace block that is open
    std::map<std::string, int> index;
    Direction dir = Direction::TD;
    StyleSheet sheet;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

std::string clean_name(std::string n) {
    n = trim(n);
    size_t p = n.find(":::");
    if (p != std::string::npos) n = trim(n.substr(0, p));
    p = n.find('~');  // generics: Box~T~
    if (p != std::string::npos) n = trim(n.substr(0, p));
    p = n.find("[\"");  // a label: Box["the label"]
    if (p != std::string::npos) n = trim(n.substr(0, p));
    if (n.size() >= 2 && n.front() == '`' && n.back() == '`') n = n.substr(1, n.size() - 2);
    return n;
}

// How the class is headed: a ["label"] is the heading; otherwise generics `Box~T~` read `Box<T>`, as Mermaid draws them.
std::string display_name(const std::string& raw, const std::string& name) {
    size_t br = raw.find("[\"");
    if (br != std::string::npos) {
        size_t q = raw.find("\"]", br + 2);
        if (q != std::string::npos) return raw.substr(br + 2, q - br - 2);
    }
    size_t t1 = raw.find('~'), t2 = t1 == std::string::npos ? std::string::npos : raw.find('~', t1 + 1);
    if (t1 != std::string::npos && t2 != std::string::npos && t2 > t1 + 1) return name + "<" + raw.substr(t1 + 1, t2 - t1 - 1) + ">";
    return name;
}

// `<<interface>>` is drawn with guillemets, as Mermaid draws it.
std::string stereotype(const std::string& m) {
    if (m.size() > 4 && starts(m, "<<") && m.compare(m.size() - 2, 2, ">>") == 0) return "«" + m.substr(2, m.size() - 4) + "»";
    return m;
}

// Generics in a member's type: `List~int~` reads `List<int>`, as Mermaid draws it.
std::string angle_generics(std::string m) {
    std::string out;
    for (size_t i = 0; i < m.size();) {
        size_t t1 = m.find('~', i);
        size_t t2 = t1 == std::string::npos ? std::string::npos : m.find('~', t1 + 1);
        if (t1 == std::string::npos || t2 == std::string::npos) {
            out += m.substr(i);
            break;
        }
        out += m.substr(i, t1 - i) + "<" + m.substr(t1 + 1, t2 - t1 - 1) + ">";
        i = t2 + 1;
    }
    return out;
}

int class_for(Doc& d, const std::string& raw) {
    std::string name = clean_name(raw);
    size_t cls_at = raw.find(":::");
    if (cls_at != std::string::npos) d.sheet.use(name, trim(raw.substr(cls_at + 3)));
    std::string display = display_name(raw, name);
    auto it = d.index.find(name);
    if (it != d.index.end()) {
        if (display != name) d.classes[it->second].display = display;  // a later declaration may name the label or generics
        return it->second;
    }
    Class c;
    c.name = name;
    c.display = display;
    c.ns = d.cur_ns;
    d.classes.push_back(c);
    return d.index[name] = (int)d.classes.size() - 1;
}

void add_member(Class& c, const std::string& raw) {
    std::string m = trim(raw);
    if (m.empty()) return;
    if (starts(m, "<<") && m.size() > 4 && m.compare(m.size() - 2, 2, ">>") == 0) {
        c.annotation = stereotype(m);
        return;
    }
    m = angle_generics(m);
    Member mem;
    bool method = m.find('(') != std::string::npos;
    size_t close = method ? m.find(')', m.find('(')) : std::string::npos;
    // the classifier, `*` for abstract and `$` for static: right after a method's parameters, or at the very end
    char mark = 0;
    if (close != std::string::npos && close + 1 < m.size() && (m[close + 1] == '$' || m[close + 1] == '*')) {
        mark = m[close + 1];
        m.erase(close + 1, 1);
    } else if (!m.empty() && (m.back() == '$' || m.back() == '*')) {
        mark = m.back();
        m = trim(m.substr(0, m.size() - 1));
    }
    mem.statik = mark == '$';
    mem.abstrakt = mark == '*';
    if (method) {  // a return type after the parameters reads `name(params) : Type`, as Mermaid draws it
        size_t cp = m.find(')', m.find('('));
        if (cp != std::string::npos) {
            std::string rest = trim(m.substr(cp + 1));
            if (!rest.empty() && rest[0] != ':') m = trim(m.substr(0, cp + 1)) + " : " + rest;
        }
    }
    mem.text = m;
    (method ? c.methods : c.attrs).push_back(mem);
}

// One member row: like aligned_text, with the classifier's styling (abstract italic, static underlined).
void member_text(std::string& out, const Theme& th, const Member& m, double x, double cy, double size, const std::string& fill) {
    out += "<text x=\"" + num(x) + "\" y=\"" + num(cy + size * 0.35) + "\" text-anchor=\"start\" font-size=\"" + num(size) +
           "\" font-weight=\"400\" font-family=\"" + esc(th.font) + "\" fill=\"" + fill + "\"";
    if (m.abstrakt) out += " font-style=\"italic\"";
    if (m.statik) out += " text-decoration=\"underline\"";
    out += ">" + text_content(m.text) + "</text>\n";
}

struct Op {
    const char* tok;
    Mark ma, mb;
    bool dashed;
};
const Op kOps[] = {{"<|--", kTriangle, kNoMark, false}, {"--|>", kNoMark, kTriangle, false}, {"<|..", kTriangle, kNoMark, true},
                   {"..|>", kNoMark, kTriangle, true},  {"*--", kDiamondFilled, kNoMark, false}, {"--*", kNoMark, kDiamondFilled, false},
                   {"o--", kDiamondHollow, kNoMark, false}, {"--o", kNoMark, kDiamondHollow, false}, {"<--", kArrow, kNoMark, false},
                   {"-->", kNoMark, kArrow, false},     {"<..", kArrow, kNoMark, true},         {"..>", kNoMark, kArrow, true},
                   {"--", kNoMark, kNoMark, false},     {"..", kNoMark, kNoMark, true},
                   // a lollipop (interface) end is drawn as a plain end
                   {"()--", kNoMark, kNoMark, false},   {"--()", kNoMark, kNoMark, false}, {"()..", kNoMark, kNoMark, true},
                   {"..()", kNoMark, kNoMark, true}};

bool parse_relation(Doc& d, const std::string& line, bool& matched, std::string& error) {
    size_t best = std::string::npos;
    const Op* op = nullptr;
    // `A <|-- B` first; when no operator stands between spaces, `A<|--B` (not for `o--` and `--o`, which a name could run into)
    for (int pass = 0; pass < 2 && !op; pass++) {
        for (auto& o : kOps) {
            size_t n = std::char_traits<char>::length(o.tok);
            if (pass == 1 && (o.tok[0] == 'o' || o.tok[n - 1] == 'o')) continue;
            for (size_t p = line.find(o.tok); p != std::string::npos; p = line.find(o.tok, p + 1)) {
                bool before = pass == 1 ? p > 0 && line.find(':') >= p : p > 0 && (line[p - 1] == ' ' || line[p - 1] == '"');
                bool after = pass == 1 ? p + n < line.size() : p + n < line.size() && (line[p + n] == ' ' || line[p + n] == '"');
                if (!before || !after) continue;
                if (best == std::string::npos || p < best || (p == best && n > std::char_traits<char>::length(op->tok))) {
                    best = p;
                    op = &o;
                }
                break;
            }
        }
    }
    matched = op != nullptr;
    if (!op) return true;
    std::string left = trim(line.substr(0, best)), right = trim(line.substr(best + std::char_traits<char>::length(op->tok))), label;
    Relation r;
    r.ma = op->ma;
    r.mb = op->mb;
    r.dashed = op->dashed;
    if (!left.empty() && left.back() == '"') {
        size_t q = left.rfind('"', left.size() - 2);
        if (q != std::string::npos) {
            r.card_a = left.substr(q + 1, left.size() - q - 2);
            left = trim(left.substr(0, q));
        }
    }
    if (!right.empty() && right[0] == '"') {
        size_t q = right.find('"', 1);
        if (q != std::string::npos) {
            r.card_b = right.substr(1, q - 1);
            right = trim(right.substr(q + 1));
        }
    }
    size_t colon = right.find(':');
    if (colon != std::string::npos) {
        label = trim(right.substr(colon + 1));
        right = trim(right.substr(0, colon));
    }
    if (left.empty() || right.empty()) {
        error = "a relation needs two classes: " + line;
        return false;
    }
    r.a = class_for(d, left);
    r.b = class_for(d, right);
    r.label = label;
    d.rels.push_back(r);
    return true;
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
            else add_member(d.classes[open], line);
            continue;
        }
        if (starts(line, "direction ")) {
            std::string v = trim(line.substr(10));
            d.dir = v == "LR" ? Direction::LR : v == "RL" ? Direction::RL : v == "BT" ? Direction::BT : Direction::TD;
            continue;
        }
        if (d.sheet.take(line, false)) continue;
        if (starts(line, "namespace ")) {  // `namespace Name {`: the classes declared up to its `}` are framed together
            std::string name = trim(line.substr(10));
            if (!name.empty() && name.back() == '{') name = trim(name.substr(0, name.size() - 1));
            if (name.size() >= 2 && name.front() == '`' && name.back() == '`') name = name.substr(1, name.size() - 2);
            d.namespaces.push_back(name);
            d.cur_ns = (int)d.namespaces.size() - 1;
            continue;
        }
        if (line == "}" && d.cur_ns >= 0) {
            d.cur_ns = -1;
            continue;
        }
        if (starts(line, "note ")) {  // `note for A "text"` or `note "text"`; `\n` in the text is a line break
            std::string rest = trim(line.substr(5));
            int target = -1;
            if (starts(rest, "for ")) {
                rest = trim(rest.substr(4));
                size_t q = rest.find('"');
                if (q != std::string::npos) {
                    target = class_for(d, rest.substr(0, q));
                    rest = rest.substr(q);
                }
            }
            if (rest.size() >= 2 && rest.front() == '"' && rest.back() == '"') {
                std::string text;
                for (size_t p = 1; p + 1 < rest.size(); p++) {
                    if (rest[p] == '\\' && rest[p + 1] == 'n') text += '\n', p++;
                    else text += rest[p];
                }
                d.notes.push_back({text, target});
            }
            continue;
        }
        if (starts(line, "note") || starts(line, "style ") || starts(line, "classDef ") || starts(line, "cssClass ") || starts(line, "click ") ||
            starts(line, "link ") || starts(line, "callback ") || starts(line, "title ") || line == "}")
            continue;
        if (starts(line, "class ")) {
            std::string rest = trim(line.substr(6));
            bool brace = !rest.empty() && rest.back() == '{';
            if (brace) rest = trim(rest.substr(0, rest.size() - 1));
            // the name spec runs to the first space outside a ["..."] label (a label may itself hold spaces)
            size_t end = rest.size();
            for (size_t k = 0; k < rest.size(); k++) {
                if (rest.compare(k, 2, "[\"") == 0) {
                    size_t q = rest.find("\"]", k + 2);
                    if (q != std::string::npos) {
                        k = q + 1;
                        continue;
                    }
                }
                if (rest[k] == ' ') {
                    end = k;
                    break;
                }
            }
            int c = class_for(d, rest.substr(0, end));
            if (brace) open = c;
            continue;
        }
        if (starts(line, "<<")) {  // `<<interface>> Name`
            size_t close = line.find(">>");
            if (close != std::string::npos) {
                int c = class_for(d, line.substr(close + 2));
                d.classes[c].annotation = stereotype(line.substr(0, close + 2));
                continue;
            }
        }
        bool matched = false;
        if (!parse_relation(d, line, matched, error)) return false;
        if (matched) continue;
        size_t colon = line.find(':');  // `Name : member`
        if (colon != std::string::npos) {
            add_member(d.classes[class_for(d, line.substr(0, colon))], line.substr(colon + 1));
            continue;
        }
        error = "unrecognised line: " + line;
        return false;
    }
    if (open >= 0) {
        error = "unclosed class block";
        return false;
    }
    return true;
}

constexpr double kRow = 18, kHead = 28, kAnnot = 16, kSection = 8, kTextPad = 12;

struct Dir2 {
    double x, y;
};

Dir2 unit(Pt from, Pt to) {
    double dx = to.x - from.x, dy = to.y - from.y, len = std::sqrt(dx * dx + dy * dy);
    return len < 0.001 ? Dir2{0, 1} : Dir2{dx / len, dy / len};
}

double mark_length(Mark m) { return m == kTriangle ? 12 : (m == kDiamondFilled || m == kDiamondHollow) ? 16 : m == kArrow ? 0 : 0; }

void draw_mark(std::string& out, Mark m, Pt tip, Dir2 d, const Theme& th) {
    // d points from the line toward the tip (into the class)
    double nx = -d.y, ny = d.x;
    auto P = [&](double along, double side) { return Pt{tip.x - d.x * along + nx * side, tip.y - d.y * along + ny * side}; };
    auto pt = [&](Pt p) { return num(p.x) + "," + num(p.y); };
    if (m == kTriangle) {
        out += "<polygon points=\"" + pt(tip) + " " + pt(P(12, 6)) + " " + pt(P(12, -6)) + "\" fill=\"" + th.bg + "\" stroke=\"" + th.line + "\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/>\n";
    } else if (m == kDiamondFilled || m == kDiamondHollow) {
        out += "<polygon points=\"" + pt(tip) + " " + pt(P(8, 5)) + " " + pt(P(16, 0)) + " " + pt(P(8, -5)) + "\" fill=\"" +
               (m == kDiamondFilled ? th.line : th.bg) + "\" stroke=\"" + th.line + "\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/>\n";
    } else if (m == kArrow) {
        out += "<polyline points=\"" + pt(P(9, 5)) + " " + pt(tip) + " " + pt(P(9, -5)) + "\" fill=\"none\" stroke=\"" + th.line + "\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/>\n";
    }
}

}  // namespace

bool render_class(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    Doc d;
    if (!parse(source, d, error)) return false;
    if (d.classes.empty()) {
        error = "empty diagram";
        return false;
    }
    Theme th = make_theme(options);
    Text text{options};

    std::vector<LayoutNode> ln(d.classes.size());
    for (size_t k = 0; k < d.classes.size(); k++) {
        Class& c = d.classes[k];
        double w = text.width(c.display, kNodeFont, 600);
        if (!c.annotation.empty()) w = std::max(w, text.width(c.annotation, kEdgeFont, 400));
        for (auto& m : c.attrs) w = std::max(w, text.width(m.text, kEdgeFont + 1, 400));
        for (auto& m : c.methods) w = std::max(w, text.width(m.text, kEdgeFont + 1, 400));
        c.w = std::max(80.0, w + 2 * kTextPad);
        c.head_h = kHead + (c.annotation.empty() ? 0 : kAnnot);
        c.attrs_h = c.attrs.empty() ? kSection : c.attrs.size() * kRow + kSection;
        c.h = c.head_h + c.attrs_h + (c.methods.empty() ? kSection : c.methods.size() * kRow + kSection);
        ln[k].w = c.w;
        ln[k].h = c.h;
    }
    // the marked end of a relation is the parent: it goes first so it is laid out above (or left of) the other
    std::vector<LayoutEdge> le(d.rels.size());
    std::vector<bool> flipped(d.rels.size(), false);
    std::vector<std::vector<std::string>> label_lines(d.rels.size());
    for (size_t k = 0; k < d.rels.size(); k++) {
        const Relation& r = d.rels[k];
        flipped[k] = r.ma == kNoMark && r.mb != kNoMark;
        le[k].from = flipped[k] ? r.b : r.a;
        le[k].to = flipped[k] ? r.a : r.b;
        if (!r.label.empty()) {
            label_lines[k] = wrap_lines(text, split_lines(r.label), kEdgeFont, kEdgeWeight, kWrapWidth);
            le[k].label_w = text.block_width(label_lines[k], kEdgeFont, kEdgeWeight) + 16;
            le[k].label_h = label_lines[k].size() * kEdgeFont * kLineHeight + 16;
        }
    }
    std::vector<int> group_parent(d.namespaces.size(), -1);
    std::vector<double> group_min_w;  // a frame is wide enough for its title
    for (const std::string& n : d.namespaces) group_min_w.push_back(std::ceil(text.width(n, kGroupFont, kGroupWeight)) + 24 + 4);
    for (size_t k = 0; k < d.classes.size(); k++) ln[k].group = d.classes[k].ns;
    // notes: a node each, after the classes, joined to their class by a dotted link (edges after the relations)
    const size_t n_classes = d.classes.size(), n_rels = d.rels.size();
    std::vector<std::vector<std::string>> note_lines(d.notes.size());
    std::vector<int> note_edge(d.notes.size(), -1);  // the layout edge of a note's link
    for (size_t k = 0; k < d.notes.size(); k++) {
        note_lines[k] = wrap_lines(text, split_lines(d.notes[k].text), kEdgeFont, 400, kWrapWidth);
        LayoutNode nn;
        nn.w = std::max(40.0, text.block_width(note_lines[k], kEdgeFont, 400) + 20);
        nn.h = note_lines[k].size() * (kEdgeFont * kLineHeight + 2) + 16;
        nn.group = d.notes[k].target >= 0 ? d.classes[d.notes[k].target].ns : -1;
        ln.push_back(nn);
        if (d.notes[k].target >= 0) {
            LayoutEdge ne;
            ne.from = d.notes[k].target;
            ne.to = (int)(n_classes + k);
            note_edge[k] = (int)le.size();
            le.push_back(ne);
        }
    }
    LayoutResult lay = layout_layered(ln, le, d.dir, group_parent, group_min_w);

    // namespace frames, around the classes declared in them
    struct Frame {
        double x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        bool used = false;
    };
    constexpr double kFramePad = 16, kHeader = 26;
    std::vector<Frame> frames(d.namespaces.size());
    for (size_t k = 0; k < d.classes.size(); k++) {
        int g = d.classes[k].ns;
        if (g < 0) continue;
        double x0 = lay.center[k].x - d.classes[k].w / 2, y0 = lay.center[k].y - d.classes[k].h / 2, x1 = lay.center[k].x + d.classes[k].w / 2, y1 = lay.center[k].y + d.classes[k].h / 2;
        Frame& f = frames[g];
        f = f.used ? Frame{std::min(f.x0, x0), std::min(f.y0, y0), std::max(f.x1, x1), std::max(f.y1, y1), true} : Frame{x0, y0, x1, y1, true};
    }
    for (size_t k = 0; k < d.notes.size(); k++) {
        int g = ln[n_classes + k].group;
        if (g < 0) continue;
        const size_t at_k = n_classes + k;
        double x0 = lay.center[at_k].x - ln[at_k].w / 2, y0 = lay.center[at_k].y - ln[at_k].h / 2, x1 = lay.center[at_k].x + ln[at_k].w / 2, y1 = lay.center[at_k].y + ln[at_k].h / 2;
        Frame& f = frames[g];
        f = f.used ? Frame{std::min(f.x0, x0), std::min(f.y0, y0), std::max(f.x1, x1), std::max(f.y1, y1), true} : Frame{x0, y0, x1, y1, true};
    }
    double bx0 = 0, by0 = 0, bx1 = lay.width, by1 = lay.height;
    for (size_t g = 0; g < frames.size(); g++) {
        Frame& f = frames[g];
        if (!f.used) continue;
        f = {f.x0 - kFramePad, f.y0 - kFramePad - kHeader, f.x1 + kFramePad, f.y1 + kFramePad, true};
        f.x1 = std::max(f.x1, f.x0 + group_min_w[g]);
        bx0 = std::min(bx0, f.x0), by0 = std::min(by0, f.y0), bx1 = std::max(bx1, f.x1), by1 = std::max(by1, f.y1);
    }
    const double ox = kMargin - bx0, oy = kMargin - by0;
    auto at = [&](Pt p) { return Pt{p.x + ox, p.y + oy}; };

    std::string body;
    for (size_t g = 0; g < frames.size(); g++) {
        const Frame& f = frames[g];
        if (!f.used) continue;
        body += "<g class=\"namespace\">\n<rect x=\"" + num(f.x0 + ox) + "\" y=\"" + num(f.y0 + oy) + "\" width=\"" + num(f.x1 - f.x0) + "\" height=\"" + num(f.y1 - f.y0) +
                "\" rx=\"5\" ry=\"5\" fill=\"" + th.composite_fill + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        if (!th.composite_header.empty())
            body += "<rect x=\"" + num(f.x0 + ox) + "\" y=\"" + num(f.y0 + oy) + "\" width=\"" + num(f.x1 - f.x0) + "\" height=\"" + num(kHeader) + "\" rx=\"5\" ry=\"5\" fill=\"" + th.composite_header + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        body += "<text x=\"" + num(f.x0 + ox + 12) + "\" y=\"" + num(f.y0 + oy + kHeader / 2 + kGroupFont * 0.35) + "\" font-size=\"" + num(kGroupFont) + "\" font-weight=\"" +
                std::to_string(kGroupWeight) + "\" font-family=\"" + esc(th.font) + "\" fill=\"" + th.text + "\">" + esc(d.namespaces[g]) + "</text>\n";
        body += "<line x1=\"" + num(f.x0 + ox) + "\" y1=\"" + num(f.y0 + oy + kHeader) + "\" x2=\"" + num(f.x1 + ox) + "\" y2=\"" + num(f.y0 + oy + kHeader) + "\" stroke=\"" + th.border +
                "\" stroke-width=\"1\"/>\n</g>\n";
    }
    for (size_t k = 0; k < d.rels.size(); k++) {
        const Relation& r = d.rels[k];
        if (lay.points[k].size() < 2) continue;
        std::vector<Pt> pts;
        for (const Pt& p : lay.points[k]) pts.push_back(at(p));
        Mark m_from = flipped[k] ? r.mb : r.ma, m_to = flipped[k] ? r.ma : r.mb;
        const std::string& card_from = flipped[k] ? r.card_b : r.card_a;
        const std::string& card_to = flipped[k] ? r.card_a : r.card_b;
        Pt tip_from = pts.front(), tip_to = pts.back();
        Dir2 d_from = unit(pts[1], pts[0]), d_to = unit(pts[pts.size() - 2], pts.back());
        pts.front() = {tip_from.x - d_from.x * mark_length(m_from), tip_from.y - d_from.y * mark_length(m_from)};
        pts.back() = {tip_to.x - d_to.x * mark_length(m_to), tip_to.y - d_to.y * mark_length(m_to)};
        std::string list;
        for (const Pt& p : pts) list += (list.empty() ? "" : " ") + num(p.x) + "," + num(p.y);
        body += "<polyline class=\"edge\" points=\"" + list + "\" fill=\"none\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"" +
                (r.dashed ? " stroke-dasharray=\"5 4\"" : "") + " stroke-linejoin=\"round\"/>\n";
        draw_mark(body, m_from, tip_from, d_from, th);
        draw_mark(body, m_to, tip_to, d_to, th);
        auto card = [&](const std::string& s, Pt tip, Dir2 dd, Mark mk) {
            double along = mark_length(mk) + 12;
            if (s.empty()) return;
            double nx = -dd.y, ny = dd.x;
            body += "<text x=\"" + num(tip.x - dd.x * along + nx * 11) + "\" y=\"" + num(tip.y - dd.y * along + ny * 11 + 4) + "\" text-anchor=\"middle\" font-size=\"" +
                    num(kEdgeFont) + "\" font-family=\"" + esc(th.font) + "\" fill=\"" + th.text_sec + "\">" + esc(s) + "</text>\n";
        };
        card(card_from, tip_from, d_from, m_from);
        card(card_to, tip_to, d_to, m_to);
    }
    for (size_t k = 0; k < d.rels.size(); k++) {
        if (label_lines[k].empty()) continue;
        Pt c = at(lay.label_center[k]);
        body += "<g class=\"edge-label\">\n<rect x=\"" + num(c.x - le[k].label_w / 2) + "\" y=\"" + num(c.y - le[k].label_h / 2) + "\" width=\"" + num(le[k].label_w) + "\" height=\"" +
                num(le[k].label_h) + "\" rx=\"2\" ry=\"2\" fill=\"" + th.label_bg + "\" stroke=\"" + th.label_stroke + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, label_lines[k], c.x, c.y, kEdgeFont, kEdgeWeight, th.text_sec);
        body += "</g>\n";
    }
    for (size_t k = 0; k < d.notes.size(); k++) {
        if (note_edge[k] >= 0 && lay.points[note_edge[k]].size() >= 2) {
            std::string list;
            for (const Pt& p : lay.points[note_edge[k]]) list += (list.empty() ? "" : " ") + num(at(p).x) + "," + num(at(p).y);
            body += "<polyline class=\"edge note-link\" points=\"" + list + "\" fill=\"none\" stroke=\"" + th.note_border + "\" stroke-width=\"1\" stroke-dasharray=\"3 3\" stroke-linejoin=\"round\"/>\n";
        }
        const size_t at_k = n_classes + k;
        Pt p = at(lay.center[at_k]);
        body += "<g class=\"note\">\n<rect x=\"" + num(p.x - ln[at_k].w / 2) + "\" y=\"" + num(p.y - ln[at_k].h / 2) + "\" width=\"" + num(ln[at_k].w) + "\" height=\"" + num(ln[at_k].h) +
                "\" rx=\"2\" ry=\"2\" fill=\"" + th.note_fill + "\" stroke=\"" + th.note_border + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, note_lines[k], p.x, p.y, kEdgeFont, 400, th.note_text);
        body += "</g>\n";
    }
    for (size_t k = 0; k < d.classes.size(); k++) {
        const Class& c = d.classes[k];
        Pt p = at(lay.center[k]);
        double x = p.x - c.w / 2, y = p.y - c.h / 2;
        body += "<g class=\"node\">\n<rect x=\"" + num(x) + "\" y=\"" + num(y) + "\" width=\"" + num(c.w) + "\" height=\"" + num(c.h) + "\"" + d.sheet.paint(c.name, th.surface, th.border) + "/>\n";
        body += "<rect x=\"" + num(x) + "\" y=\"" + num(y) + "\" width=\"" + num(c.w) + "\" height=\"" + num(c.head_h) + "\" fill=\"" + th.group_hdr + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        double ty = y + c.head_h / 2;
        if (!c.annotation.empty()) {
            centered_text(body, th, {c.annotation}, p.x, y + 4 + kAnnot / 2 + 2, kEdgeFont, 400, th.text_sec);
            ty = y + kAnnot + kHead / 2;
        }
        centered_text(body, th, {c.display}, p.x, ty, kNodeFont, 600, th.text);
        double ay = y + c.head_h;
        for (size_t m = 0; m < c.attrs.size(); m++)
            member_text(body, th, c.attrs[m], x + kTextPad, ay + kSection / 2 + m * kRow + kRow / 2, kEdgeFont + 1, th.text);
        double my = ay + c.attrs_h;
        body += "<line x1=\"" + num(x) + "\" y1=\"" + num(my) + "\" x2=\"" + num(x + c.w) + "\" y2=\"" + num(my) + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        for (size_t m = 0; m < c.methods.size(); m++)
            member_text(body, th, c.methods[m], x + kTextPad, my + kSection / 2 + m * kRow + kRow / 2, kEdgeFont + 1, th.text);
        body += "</g>\n";
    }
    svg = svg_document(th, bx1 - bx0 + 2 * kMargin, by1 - by0 + 2 * kMargin, body);
    return true;
}

}  // namespace mermaid
