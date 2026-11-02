#include "mermaid/flowchart.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>

#include "mermaid/frame_clear.h"
#include "mermaid/layered.h"
#include "mermaid/swimlane.h"

namespace mermaid {

namespace {

using litehtml::svgutil::trim;

enum class Shape { Rect, Rounded, Stadium, Subroutine, Cylinder, Circle, DoubleCircle, Diamond, Hexagon, Asymmetric, Trapezoid, TrapezoidAlt, Parallel, ParallelAlt };

struct Style {
    std::string fill, stroke, color, stroke_width, dash;
};

struct Node {
    std::string id, label;
    Shape shape = Shape::Rect;
    Style style;
    int group = -1;
    bool phantom = false;  // stands in for an empty subgraph: sized to its frame, drawn as nothing
    bool parked = false;   // an empty subgraph: kept out of the layout and set beside the drawing or beside its parent's frame, its edges drawn straight
    double w = 0, h = 0;
    std::vector<std::string> lines;
    std::string href, tooltip, target;  // from `click`: the node is drawn inside a link
};

enum class Kind { Solid, Dotted, Thick, Invisible };

struct Edge {
    int from = 0, to = 0;
    std::string label;
    Kind kind = Kind::Solid;
    bool arrow_end = true, arrow_start = false;
    std::string stroke, stroke_width;
};

struct Group {
    std::string id, title;
    int parent = -1;
    std::vector<int> nodes;
};

struct Graph {
    Direction dir = Direction::TD;
    std::vector<Node> nodes;
    std::vector<Edge> edges;
    std::vector<Group> groups;
    std::map<std::string, int> index;
    std::map<std::string, Style> classes;
    std::vector<std::pair<int, std::string>> class_use;  // node, class name
    std::map<int, Style> link_styles;                    // edge index, -1 = default
    std::map<int, std::string> link_stroke;
    bool swimlane = false;  // `swimlane-beta`: the top-level subgraphs are lanes
};

bool is_id_char(unsigned char c) { return std::isalnum(c) || c == '_' || c >= 0x80; }

Style parse_style(const std::string& decl) {
    Style s;
    size_t i = 0;
    while (i < decl.size()) {
        size_t e = decl.find(',', i);
        std::string part = trim(decl.substr(i, e == std::string::npos ? std::string::npos : e - i));
        size_t c = part.find(':');
        if (c != std::string::npos) {
            std::string k = trim(part.substr(0, c)), v = trim(part.substr(c + 1));
            if (k == "fill") s.fill = v;
            else if (k == "stroke") s.stroke = v;
            else if (k == "color") s.color = v;
            else if (k == "stroke-width") s.stroke_width = v;
            else if (k == "stroke-dasharray") s.dash = v;
        }
        if (e == std::string::npos) break;
        i = e + 1;
    }
    return s;
}

std::string px(const std::string& v) {
    return v.size() > 2 && v.compare(v.size() - 2, 2, "px") == 0 ? v.substr(0, v.size() - 2) : v;
}

struct Parser {
    Graph g;
    std::string error;
    std::vector<int> group_stack;

    int node_index(const std::string& id) {
        auto it = g.index.find(id);
        if (it != g.index.end()) return it->second;
        Node n;
        n.id = id;
        n.label = id;
        g.nodes.push_back(n);
        int idx = (int)g.nodes.size() - 1;
        g.index[id] = idx;
        return idx;
    }

    static bool closer_at(const std::string& s, size_t i, const std::string& closer) { return s.compare(i, closer.size(), closer) == 0; }

    // `A`, `A[text]`, `A((text))`, `A{text}` ... `A:::cls`. Returns the node index or -1.
    int parse_node(const std::string& s, size_t& i) {
        while (i < s.size() && s[i] == ' ') i++;
        size_t b = i;
        while (i < s.size() && is_id_char((unsigned char)s[i])) i++;
        if (i == b) return -1;
        std::string id = s.substr(b, i - b);
        struct Open {
            const char* open;
            std::vector<const char*> close;
            Shape shape;
        };
        static const Open opens[] = {
            {"(((", {")))"}, Shape::DoubleCircle}, {"((", {"))"}, Shape::Circle},      {"([", {"])"}, Shape::Stadium},
            {"(", {")"}, Shape::Rounded},          {"[[", {"]]"}, Shape::Subroutine}, {"[(", {")]"}, Shape::Cylinder},
            {"[/", {"\\]"}, Shape::Trapezoid},     {"[\\", {"/]"}, Shape::TrapezoidAlt},
            {"[", {"]"}, Shape::Rect},             {"{{", {"}}"}, Shape::Hexagon},     {"{", {"}"}, Shape::Diamond},
            {">", {"]"}, Shape::Asymmetric},
        };
        bool has_shape = false;
        Shape shape = Shape::Rect;
        std::string label;
        for (const Open& o : opens) {
            bool parallelogram = false;
            size_t ol = std::strlen(o.open);
            if (s.compare(i, ol, o.open) != 0) continue;
            size_t t = i + ol;
            std::string text;
            size_t end = std::string::npos;
            size_t close_len = 0;
            while (t < s.size() && s[t] == ' ') t++;
            if (t < s.size() && s[t] == '"') {
                size_t q = s.find('"', t + 1);
                if (q == std::string::npos) continue;
                text = s.substr(t + 1, q - t - 1);
                size_t k = q + 1;
                while (k < s.size() && s[k] == ' ') k++;
                for (const char* c : o.close)
                    if (closer_at(s, k, c)) {
                        end = k;
                        close_len = std::strlen(c);
                        break;
                    }
            } else {
                // the text runs to the first closer (the shape's own, or the other slash of a parallelogram)
                std::vector<std::string> closers(o.close.begin(), o.close.end());
                if (!std::strcmp(o.open, "[/")) closers.push_back("/]");
                if (!std::strcmp(o.open, "[\\")) closers.push_back("\\]");
                size_t best = std::string::npos;
                for (const std::string& c : closers) {
                    size_t f = s.find(c, t);
                    if (f != std::string::npos && f < best) {
                        best = f;
                        close_len = c.size();
                    }
                }
                if (best == std::string::npos) continue;
                end = best;
                text = s.substr(t, end - t);
                // `[/text/]` and `[\text\]` are parallelograms: drawn as a plain box
                if (!std::strcmp(o.open, "[/") && s.compare(end, 2, "/]") == 0) parallelogram = true;
                if (!std::strcmp(o.open, "[\\") && s.compare(end, 2, "\\]") == 0) parallelogram = true;
            }
            if (end == std::string::npos) continue;
            shape = parallelogram ? (o.open[1] == '/' ? Shape::Parallel : Shape::ParallelAlt) : o.shape;
            has_shape = true;
            label = trim(text);
            i = end + close_len;
            break;
        }
        int idx = node_index(id);
        if (has_shape) {
            g.nodes[idx].label = label;
            g.nodes[idx].shape = shape;
        }
        if (s.compare(i, 3, ":::") == 0) {
            size_t c = i + 3, e = c;
            while (e < s.size() && is_id_char((unsigned char)s[e])) e++;
            g.class_use.push_back({idx, s.substr(c, e - c)});
            i = e;
        }
        if (!group_stack.empty() && g.nodes[idx].group < 0) {
            g.nodes[idx].group = group_stack.back();
            g.groups[group_stack.back()].nodes.push_back(idx);
        }
        return idx;
    }

    struct Link {
        Kind kind = Kind::Solid;
        bool arrow_end = false, arrow_start = false;
        std::string label;
    };

    // The connector after a node: `-->`, `---`, `-.->`, `==>`, `--x`, `<-->`, `-- text -->`, `-->|text|` ...
    bool parse_link(const std::string& s, size_t& i, Link& link) {
        size_t before = i;
        while (i < s.size() && s[i] == ' ') i++;
        size_t j = i;
        if (j >= s.size()) return false;
        if (s[j] == '<') {
            link.arrow_start = true;
            j++;
        } else if ((s[j] == 'o' || s[j] == 'x') && j > before && j + 1 < s.size() && (s[j + 1] == '-' || s[j + 1] == '=')) {
            // `A o--o B` / `A x--x B`: a circle or cross at the start (after a space, so it is not part of a name)
            link.arrow_start = true;
            j++;
        }
        if (!link.arrow_start && j > before) {
            // an edge id: `A e1@--> B`
            size_t p = j;
            while (p < s.size() && is_id_char((unsigned char)s[p])) p++;
            if (p > j && p + 1 < s.size() && s[p] == '@' && (s[p + 1] == '-' || s[p + 1] == '=' || s[p + 1] == '~')) j = p + 1;
        }
        char c = j < s.size() ? s[j] : 0;
        if (c != '-' && c != '=' && c != '~') return false;
        auto arrow = [&](size_t& k) {
            if (k < s.size() && (s[k] == '>' || s[k] == 'x' || s[k] == 'o')) {
                // as in Mermaid, `--xB` and `--oB` are a cross / circle end followed by the node B
                link.arrow_end = true;
                k++;
            }
        };
        if (c == '~') {
            size_t k = j;
            while (k < s.size() && s[k] == '~') k++;
            if (k - j < 3) return false;
            link.kind = Kind::Invisible;
            i = k;
        } else if (c == '-' && j + 1 < s.size() && s[j + 1] == '.') {
            // dotted: -.-  -.->  -. text .->
            size_t k = j + 2;
            if (k < s.size() && s[k] != '.' && s[k] != '-') {  // `-. text .->`, `-.text.->`
                size_t e = s.find(".-", k);
                if (e == std::string::npos) return false;
                std::string text = trim(s.substr(k, e - k));
                if (text.size() >= 2 && text.front() == '"' && text.back() == '"') text = text.substr(1, text.size() - 2);
                link.label = text;
                k = e;
            }
            while (k < s.size() && s[k] == '.') k++;
            if (k >= s.size() || s[k] != '-') return false;
            k++;
            link.kind = Kind::Dotted;
            arrow(k);
            i = k;
        } else {
            size_t k = j;
            while (k < s.size() && s[k] == c) k++;
            size_t run = k - j;
            size_t after_run = k;
            arrow(k);
            if (run >= 3 || (run == 2 && link.arrow_end)) {
                // `---`, `----`, `===`, `-->`, `--->`, `==>`: an open link or an arrow; a label comes as `|text|`
            } else if (run == 2 && after_run < s.size()) {
                // `-- text -->`, `--text-->`, `--"text"-->`: text up to the closing run of the same character
                k = after_run;
                size_t e = k;
                while (e < s.size() && s[e] == ' ') e++;
                size_t search = e;
                if (e < s.size() && s[e] == '"') {  // a quoted label may hold the closing characters
                    size_t q = s.find('"', e + 1);
                    if (q != std::string::npos) search = q + 1;
                }
                size_t f = s.find(std::string(2, c), search);
                if (f == std::string::npos) return false;
                std::string text = trim(s.substr(k, f - k));
                if (text.size() >= 2 && text.front() == '"' && text.back() == '"') text = text.substr(1, text.size() - 2);
                link.label = text;
                k = f;
                while (k < s.size() && s[k] == c) k++;
                arrow(k);
            } else {
                return false;
            }
            link.kind = c == '=' ? Kind::Thick : Kind::Solid;
            i = k;
        }
        if (link.label.empty()) {
            size_t p = i;
            while (p < s.size() && s[p] == ' ') p++;
            if (p < s.size() && s[p] == '|') {
                size_t from = p + 1;
                while (from < s.size() && s[from] == ' ') from++;
                if (from < s.size() && s[from] == '"') {  // a quoted label may hold `|`
                    size_t cq = s.find('"', from + 1);
                    if (cq != std::string::npos) from = cq + 1;
                }
                size_t q = s.find('|', from);
                if (q != std::string::npos) {
                    std::string text = trim(s.substr(p + 1, q - p - 1));
                    if (text.size() >= 2 && text.front() == '"' && text.back() == '"') text = text.substr(1, text.size() - 2);
                    link.label = text;
                    i = q + 1;
                }
            }
        }
        return true;
    }

    bool parse_chain(const std::string& s) {
        size_t i = 0;
        std::vector<int> left;
        auto group = [&](std::vector<int>& out) {
            out.clear();
            for (;;) {
                int n = parse_node(s, i);
                if (n < 0) return false;
                out.push_back(n);
                size_t k = i;
                while (k < s.size() && s[k] == ' ') k++;
                if (k < s.size() && s[k] == '&') {
                    i = k + 1;
                    continue;
                }
                return true;
            }
        };
        if (!group(left)) return false;
        for (;;) {
            Link link;
            size_t save = i;
            if (!parse_link(s, i, link)) {
                i = save;
                break;
            }
            std::vector<int> right;
            if (!group(right)) return false;
            for (int a : left)
                for (int b : right) {
                    Edge e;
                    e.from = a;
                    e.to = b;
                    e.label = link.label;
                    e.kind = link.kind;
                    e.arrow_end = link.kind != Kind::Invisible && link.arrow_end;
                    e.arrow_start = link.arrow_start;
                    g.edges.push_back(e);
                }
            left = right;
        }
        while (i < s.size() && s[i] == ' ') i++;
        return i >= s.size();
    }

    /// `click ID "url" ["tooltip"] [target]` or `click ID href "url" ...`; `call` / callback forms need script and are skipped.
    void take_click(const std::string& rest) {
        std::vector<std::pair<std::string, bool>> tok;  // text, was quoted
        for (size_t i = 0; i < rest.size();) {
            if (rest[i] == ' ' || rest[i] == '\t') {
                i++;
            } else if (rest[i] == '"') {
                size_t e = rest.find('"', i + 1);
                if (e == std::string::npos) e = rest.size();
                tok.push_back({rest.substr(i + 1, e - i - 1), true});
                i = e + 1;
            } else {
                size_t e = rest.find_first_of(" \t", i);
                if (e == std::string::npos) e = rest.size();
                tok.push_back({rest.substr(i, e - i), false});
                i = e;
            }
        }
        if (tok.size() < 2) return;
        auto it = g.index.find(tok[0].first);
        if (it == g.index.end()) return;
        size_t k = 1;
        if (!tok[k].second && tok[k].first == "href") k++;
        if (k >= tok.size() || !tok[k].second) return;
        std::string url = tok[k++].first, low;
        for (char ch : url) low += (char)std::tolower((unsigned char)ch);
        if (url.empty() || low.compare(0, 11, "javascript:") == 0 || low.compare(0, 5, "data:") == 0 || low.compare(0, 9, "vbscript:") == 0) return;
        Node& n = g.nodes[it->second];
        n.href = url;
        if (k < tok.size() && tok[k].second) n.tooltip = tok[k++].first;
        if (k < tok.size() && !tok[k].second && (tok[k].first == "_blank" || tok[k].first == "_self" || tok[k].first == "_parent" || tok[k].first == "_top"))
            n.target = tok[k].first;
    }

    bool parse_statement(const std::string& line) {
        std::string s = trim(line);
        if (s.empty()) return true;
        auto starts = [&](const char* kw) {
            size_t l = std::strlen(kw);
            return s.compare(0, l, kw) == 0 && (s.size() == l || s[l] == ' ');
        };
        if (starts("subgraph")) {
            std::string rest = trim(s.substr(8));
            Group gr;
            size_t br = rest.find('[');
            if (br != std::string::npos && rest.back() == ']') {
                gr.id = trim(rest.substr(0, br));
                gr.title = trim(rest.substr(br + 1, rest.size() - br - 2));
            } else {
                gr.id = rest;
                gr.title = rest;
            }
            if (gr.title.size() >= 2 && gr.title.front() == '"' && gr.title.back() == '"') gr.title = gr.title.substr(1, gr.title.size() - 2);
            if (gr.id.size() >= 2 && gr.id.front() == '"') gr.id = gr.title;
            gr.parent = group_stack.empty() ? -1 : group_stack.back();
            g.groups.push_back(gr);
            group_stack.push_back((int)g.groups.size() - 1);
            return true;
        }
        if (s == "end") {
            if (!group_stack.empty()) group_stack.pop_back();
            return true;
        }
        if (starts("click")) {
            take_click(s.substr(5));
            return true;
        }
        if (starts("direction") || starts("accTitle") || starts("accDescr") || starts("title")) return true;
        if (starts("classDef")) {
            std::string rest = trim(s.substr(8));
            size_t sp = rest.find(' ');
            if (sp == std::string::npos) return true;
            Style st = parse_style(rest.substr(sp + 1));
            std::string names = rest.substr(0, sp);
            size_t k = 0;
            while (k <= names.size()) {
                size_t e = names.find(',', k);
                g.classes[trim(names.substr(k, e == std::string::npos ? std::string::npos : e - k))] = st;
                if (e == std::string::npos) break;
                k = e + 1;
            }
            return true;
        }
        if (starts("class")) {
            std::string rest = trim(s.substr(5));
            size_t sp = rest.rfind(' ');
            if (sp == std::string::npos) return true;
            std::string names = rest.substr(0, sp), cls = trim(rest.substr(sp + 1));
            size_t k = 0;
            while (k <= names.size()) {
                size_t e = names.find(',', k);
                std::string id = trim(names.substr(k, e == std::string::npos ? std::string::npos : e - k));
                auto it = g.index.find(id);
                if (it != g.index.end()) g.class_use.push_back({it->second, cls});
                if (e == std::string::npos) break;
                k = e + 1;
            }
            return true;
        }
        if (starts("style")) {
            std::string rest = trim(s.substr(5));
            size_t sp = rest.find(' ');
            if (sp == std::string::npos) return true;
            auto it = g.index.find(rest.substr(0, sp));
            if (it == g.index.end()) return true;
            Style st = parse_style(rest.substr(sp + 1));
            Style& dst = g.nodes[it->second].style;
            if (!st.fill.empty()) dst.fill = st.fill;
            if (!st.stroke.empty()) dst.stroke = st.stroke;
            if (!st.color.empty()) dst.color = st.color;
            if (!st.stroke_width.empty()) dst.stroke_width = st.stroke_width;
            if (!st.dash.empty()) dst.dash = st.dash;
            return true;
        }
        if (starts("linkStyle")) {
            std::string rest = trim(s.substr(9));
            size_t sp = rest.find(' ');
            if (sp == std::string::npos) return true;
            std::string which = rest.substr(0, sp);
            Style st = parse_style(rest.substr(sp + 1));
            size_t k = 0;
            while (k <= which.size()) {
                size_t e = which.find(',', k);
                std::string tok = trim(which.substr(k, e == std::string::npos ? std::string::npos : e - k));
                int idx = tok == "default" ? -1 : std::atoi(tok.c_str());
                g.link_styles[idx] = st;
                if (e == std::string::npos) break;
                k = e + 1;
            }
            return true;
        }
        return parse_chain(s);
    }
};

/// `A@{ shape: diamond, label: "x" }` (Mermaid's node-metadata form) as the node written in bracket syntax. Metadata that names no
/// shape or label (`e1@{ animate: true }`, an edge's) is dropped.
std::string expand_node_meta(const std::string& line) {
    std::string out = line;
    for (size_t at = out.find("@{"); at != std::string::npos; at = out.find("@{")) {
        size_t id_begin = at;
        while (id_begin > 0 && is_id_char((unsigned char)out[id_begin - 1])) id_begin--;
        size_t close = out.size();
        bool quote = false;
        for (size_t k = at + 2; k < out.size(); k++) {
            if (out[k] == '"') quote = !quote;
            else if (out[k] == '}' && !quote) {
                close = k;
                break;
            }
        }
        std::string id = out.substr(id_begin, at - id_begin), body = out.substr(at + 2, close - at - 2);
        auto value = [&](const char* key) {
            size_t p = body.find(std::string(key) + ":");
            if (p == std::string::npos) return std::string();
            p += std::strlen(key) + 1;
            while (p < body.size() && body[p] == ' ') p++;
            size_t e = p;
            if (p < body.size() && body[p] == '"') {
                e = body.find('"', p + 1);
                return e == std::string::npos ? body.substr(p + 1) : body.substr(p + 1, e - p - 1);
            }
            e = body.find(',', p);
            return trim(body.substr(p, e == std::string::npos ? std::string::npos : e - p));
        };
        std::string shape = value("shape"), label = value("label");
        std::string node;
        if (!id.empty() && (!shape.empty() || !label.empty())) {
            if (label.empty()) label = id;
            label = "\"" + label + "\"";
            if (shape == "rounded" || shape == "event" || shape == "round") node = id + "(" + label + ")";
            else if (shape == "stadium" || shape == "terminal" || shape == "pill") node = id + "([" + label + "])";
            else if (shape == "fr-rect" || shape == "subroutine" || shape == "subproc" || shape == "framed-rectangle") node = id + "[[" + label + "]]";
            else if (shape == "cyl" || shape == "cylinder" || shape == "database" || shape == "db") node = id + "[(" + label + ")]";
            else if (shape == "circle" || shape == "circ") node = id + "((" + label + "))";
            else if (shape == "diam" || shape == "diamond" || shape == "decision" || shape == "question") node = id + "{" + label + "}";
            else if (shape == "hex" || shape == "hexagon" || shape == "prepare") node = id + "{{" + label + "}}";
            else if (shape == "lean-r" || shape == "lean-right" || shape == "in-out") node = id + "[/" + label + "/]";
            else if (shape == "lean-l" || shape == "lean-left" || shape == "out-in") node = id + "[\\" + label + "\\]";
            else if (shape == "trap-b" || shape == "trapezoid-bottom" || shape == "priority") node = id + "[/" + label + "\\]";
            else if (shape == "trap-t" || shape == "trapezoid-top" || shape == "manual") node = id + "[\\" + label + "/]";
            else node = id + "[" + label + "]";  // rect and every shape without a counterpart here
        } else {
            // a statement of nothing but `e1@{ animate: true }` is an edge's metadata, not a node
            bool alone = trim(out.substr(0, id_begin)).empty() && trim(out.substr(close < out.size() ? close + 1 : out.size())).empty();
            node = alone ? "" : id;
        }
        size_t end = close < out.size() ? close + 1 : out.size();
        out = out.substr(0, id_begin) + node + out.substr(end);
        if (node.empty()) break;
    }
    return out;
}

/// An `agentflow-beta` statement as flowchart syntax: `flow` is a subgraph, `global` a block that draws nothing, `connector` a node,
/// `@{ shape: ... }` picks the node's shape, and a metadata line alone (`id@{ ... }`) says nothing the picture needs.
/// An empty result means there is nothing to parse.
std::string agentflow_statement(const std::string& line, std::vector<char>& blocks) {
    std::string s = trim(line);
    auto starts_with = [&](const char* kw) {
        size_t l = std::strlen(kw);
        return s.compare(0, l, kw) == 0 && s.size() > l && s[l] == ' ';
    };
    if (starts_with("flow")) {
        blocks.push_back('f');
        return "subgraph " + trim(s.substr(5));
    }
    if (s == "global") {
        blocks.push_back('g');
        return "";
    }
    if (s == "end") {
        char top = blocks.empty() ? 'f' : blocks.back();
        if (!blocks.empty()) blocks.pop_back();
        return top == 'g' ? "" : "end";
    }
    if (starts_with("connector")) s = trim(s.substr(10));
    size_t meta = s.find("@{");
    if (meta == std::string::npos) return s;
    std::string head = trim(s.substr(0, meta)), body = s.substr(meta + 2);
    size_t close = body.rfind('}');
    body = close == std::string::npos ? body : body.substr(0, close);
    if (head.find_first_of("[({") == std::string::npos) return "";  // `id@{ ... }` on its own line
    // the shape key, then the node written in the flowchart shape that matches it
    std::string shape;
    size_t at = body.find("shape:");
    if (at != std::string::npos) {
        size_t end = body.find(',', at);
        shape = trim(body.substr(at + 6, end == std::string::npos ? std::string::npos : end - at - 6));
        if (shape.size() >= 2 && shape.front() == '"' && shape.back() == '"') shape = shape.substr(1, shape.size() - 2);
    }
    size_t open = head.find('[');
    if (open == std::string::npos || head.back() != ']') return head;
    std::string id = head.substr(0, open), label = head.substr(open + 1, head.size() - open - 2);
    if (shape == "task" || shape == "roundedRect" || shape == "rounded") return id + "(" + label + ")";
    if (shape == "tool" || shape == "subroutine" || shape == "fr-rect") return id + "[[" + label + "]]";
    if (shape == "input" || shape == "lean-right") {  // the parallelogram form takes the text bare
        std::string bare = trim(label);
        if (bare.size() >= 2 && bare.front() == '"' && bare.back() == '"') bare = bare.substr(1, bare.size() - 2);
        return id + "[/" + bare + "/]";
    }
    if (shape == "decision" || shape == "diamond") return id + "{" + label + "}";
    if (shape == "action" || shape == "hexagon") return id + "{{" + label + "}}";
    if (shape == "stadium" || shape == "terminal") return id + "([" + label + "])";
    if (shape == "circle") return id + "((" + label + "))";
    if (shape == "cylinder" || shape == "database") return id + "[(" + label + ")]";
    return head;
}

bool parse(const std::string& source, Graph& g, std::string& error) {
    Parser p;
    bool agentflow = false;
    std::vector<char> blocks;
    std::vector<std::string> lines;
    std::string cur;
    bool in_quote = false;
    int depth = 0;  // inside a node's brackets a `;` is text
    for (size_t at = 0; at < source.size(); at++) {
        char c = source[at];
        if (c == '"') in_quote = !in_quote;
        if (!in_quote) {
            if (c == '[' || c == '(' || c == '{') depth++;
            else if ((c == ']' || c == ')' || c == '}') && depth > 0) depth--;
        }
        if (c == '\n') depth = 0;
        if (c == '\n' && in_quote) {
            // a line break inside a quoted label is a line break of the label, unless the quote is never closed
            size_t close = source.find('"', at);
            if (close != std::string::npos && source.find("\n\n", at) > close) {
                cur += "<br/>";
                continue;
            }
            in_quote = false;
        }
        if (c == '\n' || (c == ';' && !in_quote && depth == 0)) {
            lines.push_back(cur);
            cur.clear();
        } else if (c != '\r') {
            cur += c;
        }
    }
    lines.push_back(cur);

    bool header = false;
    for (std::string line : lines) {
        size_t cm = std::string::npos;
        for (size_t k = 0, quotes = 0; k + 1 < line.size(); k++) {  // a `%%` inside a quoted label is text
            if (line[k] == '"') quotes++;
            else if (line[k] == '%' && line[k + 1] == '%' && quotes % 2 == 0) {
                cm = k;
                break;
            }
        }
        if (cm != std::string::npos) line = line.substr(0, cm);
        line = trim(line);
        if (line.empty()) continue;
        if (!header) {
            size_t sp = line.find(' ');
            std::string kw = line.substr(0, sp);
            if (kw != "graph" && kw != "flowchart" && kw != "flowchart-elk" && kw != "swimlane-beta" && kw != "agentflow-beta") {
                error = "not a flowchart: " + kw;
                return false;
            }
            p.g.swimlane = kw == "swimlane-beta";
            agentflow = kw == "agentflow-beta";
            std::string d = sp == std::string::npos ? "TD" : trim(line.substr(sp + 1));
            if (d == "LR") p.g.dir = Direction::LR;
            else if (d == "RL") p.g.dir = Direction::RL;
            else if (d == "BT") p.g.dir = Direction::BT;
            else p.g.dir = Direction::TD;
            header = true;
            continue;
        }
        if (agentflow) {
            line = agentflow_statement(line, blocks);
            if (line.empty()) continue;
        } else if (line.find("@{") != std::string::npos) {
            line = trim(expand_node_meta(line));
            if (line.empty()) continue;
        }
        if (!p.parse_statement(line)) {
            error = "cannot parse: " + line;
            return false;
        }
    }
    if (!header) {
        error = "empty diagram";
        return false;
    }
    for (auto& [idx, cls] : p.g.class_use) {
        auto it = p.g.classes.find(cls);
        if (it == p.g.classes.end()) continue;
        Style& dst = p.g.nodes[idx].style;
        const Style& st = it->second;
        if (dst.fill.empty()) dst.fill = st.fill;
        if (dst.stroke.empty()) dst.stroke = st.stroke;
        if (dst.color.empty()) dst.color = st.color;
        if (dst.stroke_width.empty()) dst.stroke_width = st.stroke_width;
        if (dst.dash.empty()) dst.dash = st.dash;
    }
    if (!agentflow) {
        // An empty subgraph still draws its frame and title: a hidden node (the one an edge to it made, if any) holds the place.
        Graph& gr = p.g;
        std::vector<char> has_child(gr.groups.size(), 0);
        for (const Group& grp : gr.groups)
            if (grp.parent >= 0) has_child[grp.parent] = 1;
        for (size_t gi = 0; gi < gr.groups.size(); gi++) {
            if (!gr.groups[gi].nodes.empty() || has_child[gi]) continue;
            auto it = gr.index.find(gr.groups[gi].id);
            int v;
            bool fresh = it == gr.index.end();
            if (!fresh) {
                v = it->second;
            } else {
                Node n;
                n.id = gr.groups[gi].id;
                gr.nodes.push_back(n);
                v = (int)gr.nodes.size() - 1;
            }
            gr.nodes[v].phantom = true;
            gr.nodes[v].parked = !gr.swimlane;
            gr.nodes[v].label = gr.groups[gi].title;
            gr.nodes[v].group = (int)gi;
            gr.groups[gi].nodes.push_back(v);
        }
    }
    if (agentflow) {
        // An edge to a container (`researcher --> designer`) made a node of that name: send it to the container's first member
        // (as a target) or last member (as a source) instead, and drop the placeholder.
        Graph& gr = p.g;
        const int n = (int)gr.nodes.size();
        std::vector<int> first(n, -1), last(n, -1);
        std::vector<char> phantom(n, 0);
        for (size_t gi = 0; gi < gr.groups.size(); gi++) {
            auto it = gr.index.find(gr.groups[gi].id);
            if (it == gr.index.end()) continue;
            int ph = it->second;
            for (int v = 0; v < n; v++) {
                if (v == ph) continue;
                for (int a = gr.nodes[v].group; a >= 0; a = gr.groups[a].parent)
                    if (a == (int)gi) {
                        if (first[ph] < 0) first[ph] = v;
                        last[ph] = v;
                        break;
                    }
            }
            if (first[ph] >= 0) phantom[ph] = 1;
        }
        std::vector<int> remap(n, -1);
        int kept = 0;
        for (int v = 0; v < n; v++)
            if (!phantom[v]) remap[v] = kept++;
        for (Edge& e : gr.edges) {
            if (phantom[e.from]) e.from = last[e.from];
            if (phantom[e.to]) e.to = first[e.to];
            e.from = remap[e.from];
            e.to = remap[e.to];
        }
        std::vector<Node> nodes;
        for (int v = 0; v < n; v++)
            if (!phantom[v]) nodes.push_back(gr.nodes[v]);
        gr.nodes = std::move(nodes);
        gr.index.clear();
        for (size_t v = 0; v < gr.nodes.size(); v++) gr.index[gr.nodes[v].id] = (int)v;
        for (Group& grp : gr.groups) {
            std::vector<int> members;
            for (int v : grp.nodes)
                if (v >= 0 && v < n && remap[v] >= 0) members.push_back(remap[v]);
            grp.nodes = std::move(members);
        }
    }
    g = std::move(p.g);
    return true;
}

// ── sizes ──

void size_nodes(Graph& g, const Text& text) {
    using namespace metrics;
    for (Node& n : g.nodes) {
        n.lines = wrap_lines(text, split_lines(n.label), kNodeFont, kNodeWeight, kWrapWidth);
        if (n.phantom) {  // wide enough that its frame holds the subgraph's title
            n.w = std::max(60.0, std::ceil(text.block_width({n.label}, kGroupFont, kGroupWeight)) - 8);
            n.h = 24;
            continue;
        }
        double tw = text.block_width(n.lines, kNodeFont, kNodeWeight);
        double th = n.lines.size() * kNodeFont * kLineHeight;
        double w = tw + 2 * kPadX, h = th + 2 * kPadY;
        switch (n.shape) {
            case Shape::Diamond: {
                // the label has to fit the rhombus: tw / w + th / h <= 1
                w = std::max(w + 24, std::max(tw, th) + 62);
                h = std::max(w * 0.75, th * 2.2);
                break;
            }
            case Shape::Circle:
            case Shape::DoubleCircle: {
                double d = std::max(w, h) + (n.shape == Shape::DoubleCircle ? 12 : 4);
                w = h = d;
                break;
            }
            case Shape::Stadium: w += h / 2; break;
            case Shape::Subroutine: w += 16; break;
            case Shape::Cylinder: h += 16; break;
            case Shape::Hexagon: w += h * 0.6; break;
            case Shape::Asymmetric: w += 14; break;
            case Shape::Trapezoid:
            case Shape::TrapezoidAlt:
            case Shape::Parallel:
            case Shape::ParallelAlt: w += 28; break;
            default: break;
        }
        n.w = std::ceil(w * 100) / 100;
        n.h = std::ceil(h * 100) / 100;
    }
}

// ── drawing ──

std::string stroke_attrs(const std::string& color, const std::string& width, const std::string& dash) {
    std::string s = " stroke=\"" + color + "\" stroke-width=\"" + width + "\"";
    if (!dash.empty()) s += " stroke-dasharray=\"" + dash + "\"";
    return s;
}

void draw_node(std::string& out, const Theme& th, const Node& n, Pt c) {
    using namespace metrics;
    std::string fill = n.style.fill.empty() ? th.surface : n.style.fill;
    std::string stroke = n.style.stroke.empty() ? th.border : n.style.stroke;
    std::string sw = n.style.stroke_width.empty() ? num(kInnerStroke) : px(n.style.stroke_width);
    std::string st = " fill=\"" + fill + "\"" + stroke_attrs(stroke, sw, n.style.dash);
    double l = c.x - n.w / 2, r = c.x + n.w / 2, t = c.y - n.h / 2, b = c.y + n.h / 2;
    auto pts = [&](std::initializer_list<Pt> p) {
        std::string s;
        for (const Pt& q : p) s += (s.empty() ? "" : " ") + num(q.x) + "," + num(q.y);
        return s;
    };
    if (!n.href.empty())
        out += "<a href=\"" + esc(n.href) + "\"" + (n.target.empty() ? "" : " target=\"" + n.target + "\"") +
               (n.tooltip.empty() ? "" : " title=\"" + esc(n.tooltip) + "\"") + ">\n";
    out += "<g class=\"node\">\n";
    switch (n.shape) {
        case Shape::Rect:
            out += "<rect x=\"" + num(l) + "\" y=\"" + num(t) + "\" width=\"" + num(n.w) + "\" height=\"" + num(n.h) + "\"" + st + "/>\n";
            break;
        case Shape::Rounded:
            out += "<rect x=\"" + num(l) + "\" y=\"" + num(t) + "\" width=\"" + num(n.w) + "\" height=\"" + num(n.h) + "\" rx=\"6\" ry=\"6\"" + st + "/>\n";
            break;
        case Shape::Stadium:
            out += "<rect x=\"" + num(l) + "\" y=\"" + num(t) + "\" width=\"" + num(n.w) + "\" height=\"" + num(n.h) + "\" rx=\"" + num(n.h / 2) + "\" ry=\"" + num(n.h / 2) + "\"" + st + "/>\n";
            break;
        case Shape::Subroutine:
            out += "<rect x=\"" + num(l) + "\" y=\"" + num(t) + "\" width=\"" + num(n.w) + "\" height=\"" + num(n.h) + "\"" + st + "/>\n";
            for (double x : {l + 8, r - 8})
                out += "<line x1=\"" + num(x) + "\" y1=\"" + num(t) + "\" x2=\"" + num(x) + "\" y2=\"" + num(b) + "\"" + stroke_attrs(stroke, sw, "") + "/>\n";
            break;
        case Shape::Circle:
            out += "<circle cx=\"" + num(c.x) + "\" cy=\"" + num(c.y) + "\" r=\"" + num(n.w / 2) + "\"" + st + "/>\n";
            break;
        case Shape::DoubleCircle:
            out += "<circle cx=\"" + num(c.x) + "\" cy=\"" + num(c.y) + "\" r=\"" + num(n.w / 2) + "\"" + st + "/>\n";
            out += "<circle cx=\"" + num(c.x) + "\" cy=\"" + num(c.y) + "\" r=\"" + num(n.w / 2 - 4) + "\" fill=\"none\"" + stroke_attrs(stroke, sw, "") + "/>\n";
            break;
        case Shape::Diamond:
            out += "<polygon points=\"" + pts({{c.x, t}, {r, c.y}, {c.x, b}, {l, c.y}}) + "\"" + st + "/>\n";
            break;
        case Shape::Hexagon: {
            double k = n.h * 0.3;
            out += "<polygon points=\"" + pts({{l + k, t}, {r - k, t}, {r, c.y}, {r - k, b}, {l + k, b}, {l, c.y}}) + "\"" + st + "/>\n";
            break;
        }
        case Shape::Asymmetric:
            out += "<polygon points=\"" + pts({{l, t}, {r, t}, {r, b}, {l, b}, {l + 12, c.y}}) + "\"" + st + "/>\n";
            break;
        case Shape::Trapezoid:
            out += "<polygon points=\"" + pts({{l + 14, t}, {r - 14, t}, {r, b}, {l, b}}) + "\"" + st + "/>\n";
            break;
        case Shape::TrapezoidAlt:
            out += "<polygon points=\"" + pts({{l, t}, {r, t}, {r - 14, b}, {l + 14, b}}) + "\"" + st + "/>\n";
            break;
        case Shape::Parallel:
            out += "<polygon points=\"" + pts({{l + 14, t}, {r, t}, {r - 14, b}, {l, b}}) + "\"" + st + "/>\n";
            break;
        case Shape::ParallelAlt:
            out += "<polygon points=\"" + pts({{l, t}, {r - 14, t}, {r, b}, {l + 14, b}}) + "\"" + st + "/>\n";
            break;
        case Shape::Cylinder: {
            double ry = std::min(10.0, n.h * 0.14), rx = n.w / 2;
            std::string d = "M" + num(l) + "," + num(t + ry) + " A" + num(rx) + "," + num(ry) + " 0 0 1 " + num(r) + "," + num(t + ry) + " L" + num(r) + "," +
                            num(b - ry) + " A" + num(rx) + "," + num(ry) + " 0 0 1 " + num(l) + "," + num(b - ry) + " Z";
            out += "<path d=\"" + d + "\"" + st + "/>\n";
            out += "<path d=\"M" + num(l) + "," + num(t + ry) + " A" + num(rx) + "," + num(ry) + " 0 0 0 " + num(r) + "," + num(t + ry) + "\" fill=\"none\"" +
                   stroke_attrs(stroke, sw, "") + "/>\n";
            break;
        }
    }
    double cy = n.shape == Shape::Cylinder ? c.y + n.h * 0.07 : c.y;
    centered_text(out, th, n.lines, c.x, cy, kNodeFont, kNodeWeight, n.style.color.empty() ? th.text : n.style.color);
    out += "</g>\n";
    if (!n.href.empty()) out += "</a>\n";
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

bool render_flowchart(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    Graph g;
    if (!parse(source, g, error)) return false;
    if (g.nodes.empty()) {
        error = "empty diagram";
        return false;
    }
    Theme th = make_theme(options);
    Text text{options};
    size_nodes(g, text);

    // parked nodes (the empty subgraphs nothing points to) take no part in the layout; slot[] maps a node to its layout row
    std::vector<int> slot(g.nodes.size(), -1);
    std::vector<LayoutNode> ln;
    for (size_t i = 0; i < g.nodes.size(); i++) {
        if (g.nodes[i].parked) continue;
        slot[i] = (int)ln.size();
        LayoutNode n;
        n.w = g.nodes[i].w;
        n.h = g.nodes[i].h;
        n.group = g.nodes[i].group;
        Shape s = g.nodes[i].shape;
        n.outline = s == Shape::Diamond ? 1 : (s == Shape::Circle || s == Shape::DoubleCircle ? 2 : 0);
        ln.push_back(n);
    }
    std::vector<LayoutEdge> le(g.edges.size());
    std::vector<std::vector<std::string>> label_lines(g.edges.size());
    for (size_t i = 0; i < g.edges.size(); i++) {
        le[i].from = slot[g.edges[i].from];
        le[i].to = slot[g.edges[i].to];
        if (!g.edges[i].label.empty()) {
            label_lines[i] = wrap_lines(text, split_lines(g.edges[i].label), kEdgeFont, kEdgeWeight, kWrapWidth);
            le[i].label_w = text.block_width(label_lines[i], kEdgeFont, kEdgeWeight) + 16;
            le[i].label_h = label_lines[i].size() * kEdgeFont * kLineHeight + 16;
        }
    }
    std::vector<int> group_parent;
    std::vector<double> group_min_w;  // a frame is wide enough for its title (the drawing widens it the same way)
    for (const Group& gr : g.groups) {
        group_parent.push_back(gr.parent);
        group_min_w.push_back(std::ceil(text.width(gr.title, kGroupFont, kGroupWeight)) + 24 + 4);
    }
    LayoutResult lay;
    SwimResult swim;
    std::vector<std::string> lane_titles;
    if (g.swimlane) {
        // a node's lane is the top-level subgraph it sits in; nodes outside any subgraph share a lane of their own at the end
        std::vector<int> lane_of_group(g.groups.size(), -1);
        for (size_t gi = 0; gi < g.groups.size(); gi++)
            if (g.groups[gi].parent < 0) {
                lane_of_group[gi] = (int)lane_titles.size();
                lane_titles.push_back(g.groups[gi].title);
            }
        std::vector<SwimNode> sn(g.nodes.size());
        int loose = -1;
        for (size_t i = 0; i < g.nodes.size(); i++) {
            sn[i].w = g.nodes[i].w;
            sn[i].h = g.nodes[i].h;
            int gi = g.nodes[i].group;
            while (gi >= 0 && g.groups[gi].parent >= 0) gi = g.groups[gi].parent;
            if (gi >= 0) {
                sn[i].lane = lane_of_group[gi];
            } else {
                if (loose < 0) {
                    loose = (int)lane_titles.size();
                    lane_titles.push_back("");
                }
                sn[i].lane = loose;
            }
        }
        swim = layout_swimlane(sn, le, (int)lane_titles.size(), g.dir, 30, 120);
        lay = swim.lay;
    } else {
        std::vector<LayoutEdge> le_in;  // the edges the layout sees: those between nodes it knows
        std::vector<int> le_at;
        for (size_t i = 0; i < le.size(); i++)
            if (le[i].from >= 0 && le[i].to >= 0) le_in.push_back(le[i]), le_at.push_back((int)i);
        LayoutResult in = layout_layered(ln, le_in, g.dir, group_parent, group_min_w);
        lay = in;
        lay.points.assign(le.size(), {});
        lay.label_center.assign(le.size(), Pt{0, 0});
        for (size_t k = 0; k < le_at.size(); k++) {
            lay.points[le_at[k]] = in.points[k];
            lay.label_center[le_at[k]] = in.label_center[k];
        }
        // back to node numbering; each parked frame is set after the drawing, across the layers (beside it for top-down, below it for left-right)
        std::vector<Pt> center(g.nodes.size());
        const bool across_x = g.dir == Direction::TD || g.dir == Direction::BT;
        double next = across_x ? lay.width : lay.height;
        for (size_t i = 0; i < g.nodes.size(); i++)
            if (slot[i] >= 0) center[i] = lay.center[slot[i]];
        std::vector<char> placed(g.nodes.size(), 0);
        for (size_t i = 0; i < g.nodes.size(); i++) placed[i] = slot[i] >= 0;
        constexpr double kPad = 16, kHead = 26, kGap = 32, kNear = 12;
        // the number of frames between a node and `anchor` (the node's own group counts, the anchor itself too), or -1 if it is not inside it
        auto frames_up_to = [&](int v, int anchor) {
            int k = 0;
            for (int a = g.nodes[v].group; a >= 0; a = g.groups[a].parent) {
                k++;
                if (a == anchor) return k;
            }
            return -1;
        };
        for (size_t i = 0; i < g.nodes.size(); i++) {
            if (slot[i] >= 0) continue;
            const Node& n = g.nodes[i];
            // the nearest enclosing subgraph that has a member in the drawing already
            int anchor = -1;
            for (int a = g.groups[n.group].parent; a >= 0 && anchor < 0; a = g.groups[a].parent)
                for (size_t v = 0; v < g.nodes.size(); v++)
                    if (placed[v] && frames_up_to((int)v, a) > 0) {
                        anchor = a;
                        break;
                    }
            if (anchor < 0) {  // in no frame: beside the whole drawing, past every frame that is drawn there
                double edge = next;
                for (size_t v = 0; v < g.nodes.size(); v++) {
                    if (!placed[v]) continue;
                    int depth = 0;
                    for (int a = g.nodes[v].group; a >= 0; a = g.groups[a].parent) depth++;
                    edge = std::max(edge, across_x ? center[v].x + g.nodes[v].w / 2 + depth * kPad : center[v].y + g.nodes[v].h / 2 + depth * kPad);
                }
                if (across_x) {
                    center[i] = {edge + kGap + kPad + n.w / 2, kHead + kPad + n.h / 2};
                    next = edge + kGap + n.w + 2 * kPad;
                } else {
                    center[i] = {kPad + n.w / 2, edge + kGap + kHead + kPad + n.h / 2};
                    next = edge + kGap + n.h + 2 * kPad + kHead;
                }
                placed[i] = 1;
                continue;
            }
            // inside the anchor's frame: beside its members (right of them top-down, below them left-right), and everything that
            // lay past the frame on that side moves over to make room
            double inner_lo_x = 1e18, inner_lo_y = 1e18, inner_hi_x = -1e18, inner_hi_y = -1e18;
            for (size_t v = 0; v < g.nodes.size(); v++) {
                int k = placed[v] ? frames_up_to((int)v, anchor) : -1;
                if (k < 0) continue;
                double nest = (k - 1) * kPad, head = (k - 1) * (kPad + kHead);
                inner_lo_x = std::min(inner_lo_x, center[v].x - g.nodes[v].w / 2 - nest);
                inner_hi_x = std::max(inner_hi_x, center[v].x + g.nodes[v].w / 2 + nest);
                inner_lo_y = std::min(inner_lo_y, center[v].y - g.nodes[v].h / 2 - head);
                inner_hi_y = std::max(inner_hi_y, center[v].y + g.nodes[v].h / 2 + nest);
            }
            const double fw = n.w + 2 * kPad, fh = n.h + 2 * kPad + kHead;
            double cut = across_x ? inner_hi_x + kPad : inner_hi_y + kPad, shift = (across_x ? fw : fh) + kNear;
            auto moves = [&](double at) { return at >= cut - 1e-6; };
            for (size_t v = 0; v < g.nodes.size(); v++)
                if (placed[v] && frames_up_to((int)v, anchor) < 0 && moves(across_x ? center[v].x : center[v].y)) (across_x ? center[v].x : center[v].y) += shift;
            for (auto& pts : lay.points)
                for (Pt& p : pts)
                    if (moves(across_x ? p.x : p.y)) (across_x ? p.x : p.y) += shift;
            for (Pt& p : lay.label_center)
                if (moves(across_x ? p.x : p.y)) (across_x ? p.x : p.y) += shift;
            (across_x ? lay.width : lay.height) += shift;
            // the new frame may also be longer than the members along the other axis: whatever lies past the anchor's frame there moves too
            double over = across_x ? inner_lo_y + fh - inner_hi_y : inner_lo_x + fw - inner_hi_x;
            if (over > 0) {
                const double cut2 = (across_x ? inner_hi_y : inner_hi_x) + kPad;
                auto moves2 = [&](double at) { return at >= cut2 - 1e-6; };
                for (size_t v = 0; v < g.nodes.size(); v++)
                    if (placed[v] && frames_up_to((int)v, anchor) < 0 && moves2(across_x ? center[v].y : center[v].x)) (across_x ? center[v].y : center[v].x) += over;
                for (auto& pts : lay.points)
                    for (Pt& p : pts)
                        if (moves2(across_x ? p.y : p.x)) (across_x ? p.y : p.x) += over;
                for (Pt& p : lay.label_center)
                    if (moves2(across_x ? p.y : p.x)) (across_x ? p.y : p.x) += over;
                (across_x ? lay.height : lay.width) += over;
            }
            if (across_x) center[i] = {inner_hi_x + kNear + kPad + n.w / 2, inner_lo_y + kHead + kPad + n.h / 2};
            else center[i] = {inner_lo_x + kPad + n.w / 2, inner_hi_y + kNear + kHead + kPad + n.h / 2};
            // level with the node it is connected to when the members' frame is long enough along that axis, so the edge runs
            // straight across instead of slanting from the corner
            for (const Edge& e : g.edges) {
                int other = e.from == (int)i ? e.to : e.to == (int)i ? e.from : -1;
                if (other < 0 || other == (int)i || !placed[other] || frames_up_to(other, anchor) < 0) continue;
                if (across_x) {
                    double lo_c = inner_lo_y + kHead + kPad + n.h / 2, hi_c = inner_hi_y - kPad - n.h / 2;
                    if (hi_c > lo_c) center[i].y = std::max(lo_c, std::min(hi_c, center[other].y));
                } else {
                    double lo_c = inner_lo_x + kPad + n.w / 2, hi_c = inner_hi_x - kPad - n.w / 2;
                    if (hi_c > lo_c) center[i].x = std::max(lo_c, std::min(hi_c, center[other].x));
                }
                break;
            }
            placed[i] = 1;
        }
        lay.center = center;
        // an edge to a parked frame runs straight between the two, from the border of one box to the border of the other
        auto box = [&](int v) {
            const Node& n = g.nodes[v];
            const bool frame = n.parked;
            struct R { double x0, y0, x1, y1; } r{center[v].x - n.w / 2, center[v].y - n.h / 2, center[v].x + n.w / 2, center[v].y + n.h / 2};
            if (frame) r = {r.x0 - 16, r.y0 - 16 - 26, r.x1 + 16, r.y1 + 16};
            return r;
        };
        auto edge_of = [&](int v, Pt toward) {  // where the line from v's centre to `toward` leaves v's box
            auto r = box(v);
            double dx = toward.x - center[v].x, dy = toward.y - center[v].y;
            double t = 1e18;
            if (dx > 1e-9) t = std::min(t, (r.x1 - center[v].x) / dx);
            if (dx < -1e-9) t = std::min(t, (r.x0 - center[v].x) / dx);
            if (dy > 1e-9) t = std::min(t, (r.y1 - center[v].y) / dy);
            if (dy < -1e-9) t = std::min(t, (r.y0 - center[v].y) / dy);
            t = std::min(t, 1.0);
            return Pt{center[v].x + dx * t, center[v].y + dy * t};
        };
        for (size_t i = 0; i < g.edges.size(); i++) {
            int a = g.edges[i].from, b = g.edges[i].to;
            if (!g.nodes[a].parked && !g.nodes[b].parked) continue;
            if (a == b) continue;
            Pt p = edge_of(a, center[b]), q = edge_of(b, center[a]);
            lay.points[i] = {p, q};
            lay.label_center[i] = {(p.x + q.x) / 2, (p.y + q.y) / 2};
        }
    }

    // subgraph frames around their members (children first so a parent covers them)
    struct Frame {
        double x0, y0, x1, y1;
        bool used = false;
    };
    std::vector<Frame> frames(g.groups.size());
    auto grow = [&](Frame& f, double x0, double y0, double x1, double y1) {
        if (!f.used) f = {x0, y0, x1, y1, true};
        else f = {std::min(f.x0, x0), std::min(f.y0, y0), std::max(f.x1, x1), std::max(f.y1, y1), true};
    };
    constexpr double kFramePad = 16, kHeader = 26;
    for (size_t gi = 0; gi < g.groups.size(); gi++)
        for (int v : g.groups[gi].nodes)
            grow(frames[gi], lay.center[v].x - g.nodes[v].w / 2, lay.center[v].y - g.nodes[v].h / 2, lay.center[v].x + g.nodes[v].w / 2,
                 lay.center[v].y + g.nodes[v].h / 2);
    for (int gi = (int)g.groups.size() - 1; gi >= 0; gi--) {
        if (!frames[gi].used) continue;
        Frame& f = frames[gi];
        f = {f.x0 - kFramePad, f.y0 - kFramePad - kHeader, f.x1 + kFramePad, f.y1 + kFramePad, true};
        if (!g.swimlane) f.x1 = std::max(f.x1, f.x0 + std::ceil(text.width(g.groups[gi].title, kGroupFont, kGroupWeight)) + 24);  // the title fits in its bar
        int p = g.groups[gi].parent;
        if (p >= 0) grow(frames[p], f.x0, f.y0, f.x1, f.y1);
    }
    if (g.swimlane)
        for (Frame& f : frames) f.used = false;  // the lanes are drawn instead of the subgraph frames
    // the drawing's box: the layout plus the frames, with a margin
    double x0 = 0, y0 = 0, x1 = lay.width, y1 = lay.height;
    for (const Frame& f : frames)
        if (f.used) {
            x0 = std::min(x0, f.x0);
            y0 = std::min(y0, f.y0);
            x1 = std::max(x1, f.x1);
            y1 = std::max(y1, f.y1);
        }
    const double ox = kMargin - x0, oy = kMargin - y0;
    auto at = [&](Pt p) { return Pt{p.x + ox, p.y + oy}; };

    std::string body;
    for (size_t gi = 0; gi < g.groups.size(); gi++) {
        const Frame& f = frames[gi];
        if (!f.used) continue;
        body += "<g class=\"subgraph\">\n<rect x=\"" + num(f.x0 + ox) + "\" y=\"" + num(f.y0 + oy) + "\" width=\"" + num(f.x1 - f.x0) + "\" height=\"" + num(f.y1 - f.y0) +
                "\" rx=\"2\" ry=\"2\" fill=\"" + th.group_fill + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        body += "<rect x=\"" + num(f.x0 + ox) + "\" y=\"" + num(f.y0 + oy) + "\" width=\"" + num(f.x1 - f.x0) + "\" height=\"" + num(kHeader) +
                "\" rx=\"2\" ry=\"2\" fill=\"" + th.cluster_hdr + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        body += "<text x=\"" + num(f.x0 + ox + 12) + "\" y=\"" + num(f.y0 + oy + kHeader / 2 + kGroupFont * 0.35) + "\" font-size=\"" + num(kGroupFont) +
                "\" font-weight=\"" + std::to_string(kGroupWeight) + "\" font-family=\"" + esc(th.font) + "\" fill=\"" + th.text + "\">" + esc(g.groups[gi].title) + "</text>\n</g>\n";
    }
    for (size_t li = 0; li < swim.lanes.size(); li++) {
        const SwimLane& lane = swim.lanes[li];
        double lx = lane.x0 + ox, ly = lane.y0 + oy, lw = lane.x1 - lane.x0, lh = lane.y1 - lane.y0;
        body += "<g class=\"lane\">\n<rect x=\"" + num(lx) + "\" y=\"" + num(ly) + "\" width=\"" + num(lw) + "\" height=\"" + num(lh) + "\" fill=\"" + th.group_fill + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        double hw = swim.lanes_are_columns ? lw : lane.header, hh = swim.lanes_are_columns ? lane.header : lh;
        body += "<rect x=\"" + num(lx) + "\" y=\"" + num(ly) + "\" width=\"" + num(hw) + "\" height=\"" + num(hh) + "\" fill=\"" + th.cluster_hdr + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, split_lines(lane_titles[li]), lx + hw / 2, ly + hh / 2, kGroupFont, kGroupWeight, th.text);
        body += "</g>\n";
    }
    if (!g.swimlane) clear_frame_borders(lay.points, lay.label_center, le, frames);
    // edges
    for (size_t i = 0; i < g.edges.size(); i++) {
        const Edge& e = g.edges[i];
        if (e.kind == Kind::Invisible || lay.points[i].size() < 2) continue;
        std::string color = th.line, width = e.kind == Kind::Thick ? "2.5" : num(kStroke), dash = e.kind == Kind::Dotted ? "4 4" : "";
        for (int key : {-1, (int)i}) {
            auto it = g.link_styles.find(key);
            if (it == g.link_styles.end()) continue;
            if (!it->second.stroke.empty()) color = it->second.stroke;
            if (!it->second.stroke_width.empty()) width = px(it->second.stroke_width);
        }
        std::vector<Pt> pts;
        for (const Pt& p : lay.points[i]) pts.push_back(at(p));
        std::string list;
        for (const Pt& p : pts) list += (list.empty() ? "" : " ") + num(p.x) + "," + num(p.y);
        if (g.swimlane && pts.size() > 2) {
            // the official swimlane edges bend with rounded corners
            std::string d = "M" + num(pts[0].x) + " " + num(pts[0].y);
            for (size_t k = 1; k + 1 < pts.size(); k++) {
                double ax = pts[k].x - pts[k - 1].x, ay = pts[k].y - pts[k - 1].y, bx = pts[k + 1].x - pts[k].x, by = pts[k + 1].y - pts[k].y;
                double la = std::sqrt(ax * ax + ay * ay), lb = std::sqrt(bx * bx + by * by);
                if (la < 1e-6 || lb < 1e-6) continue;
                double rr = std::min(8.0, std::min(la, lb) / 2);
                d += " L" + num(pts[k].x - ax / la * rr) + " " + num(pts[k].y - ay / la * rr) + " Q" + num(pts[k].x) + " " + num(pts[k].y) + " " + num(pts[k].x + bx / lb * rr) + " " + num(pts[k].y + by / lb * rr);
            }
            d += " L" + num(pts.back().x) + " " + num(pts.back().y);
            body += "<path class=\"edge\" d=\"" + d + "\" fill=\"none\"" + stroke_attrs(color, width, dash) + " stroke-linejoin=\"round\"/>\n";
        } else {
            body += "<polyline class=\"edge\" points=\"" + list + "\" fill=\"none\"" + stroke_attrs(color, width, dash) + " stroke-linejoin=\"round\"/>\n";
        }
        if (e.arrow_end) draw_arrow(body, pts.back(), pts[pts.size() - 2], color == th.line ? th.arrow : color);
        if (e.arrow_start) draw_arrow(body, pts.front(), pts[1], color == th.line ? th.arrow : color);
    }
    for (size_t i = 0; i < g.edges.size(); i++) {
        if (label_lines[i].empty() || g.edges[i].kind == Kind::Invisible) continue;
        Pt c = at(lay.label_center[i]);
        body += "<g class=\"edge-label\">\n<rect x=\"" + num(c.x - le[i].label_w / 2) + "\" y=\"" + num(c.y - le[i].label_h / 2) + "\" width=\"" + num(le[i].label_w) +
                "\" height=\"" + num(le[i].label_h) + "\" rx=\"2\" ry=\"2\" fill=\"" + th.label_bg + "\" stroke=\"" + th.label_stroke + "\" stroke-width=\"1\"/>\n";
        centered_text(body, th, label_lines[i], c.x, c.y, kEdgeFont, kEdgeWeight, th.text_sec);
        body += "</g>\n";
    }
    for (size_t i = 0; i < g.nodes.size(); i++)
        if (!g.nodes[i].phantom) draw_node(body, th, g.nodes[i], at(lay.center[i]));

    svg = svg_document(th, (x1 - x0) + 2 * kMargin, (y1 - y0) + 2 * kMargin, body);
    return true;
}

}  // namespace mermaid
