#include "mermaid/railroad.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <memory>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

constexpr int kInf = -1;

/// One piece of a grammar: what is drawn is the same for every dialect.
struct Node {
    enum Kind { Empty, Terminal, NonTerminal, Special, Seq, Choice, Optional, Repeat } kind = Empty;
    std::string text;
    std::vector<Node> kids;
    int min = 0, max = kInf;  // Repeat
    // layout, filled by measure()
    double w = 0, up = 0, down = 0;
    std::vector<double> offset;  // Choice: baseline of each alternative below the node's own
};

Node leaf(Node::Kind kind, const std::string& text) {
    Node n;
    n.kind = kind;
    n.text = text;
    return n;
}

Node group(Node::Kind kind, std::vector<Node> kids) {
    if (kids.size() == 1 && (kind == Node::Seq || kind == Node::Choice)) return std::move(kids[0]);
    Node n;
    n.kind = kids.empty() ? Node::Empty : kind;
    n.kids = std::move(kids);
    return n;
}

Node wrap(Node::Kind kind, Node inner, int min = 0, int max = kInf) {
    Node n;
    n.kind = kind;
    n.min = min;
    n.max = max;
    n.kids.push_back(std::move(inner));
    return n;
}

/// `min`..`max` repetitions of `inner` as the simplest drawing that says it.
Node repeat_of(Node inner, int min, int max) {
    if (min == 1 && max == 1) return inner;
    if (min == 0 && max == 1) return wrap(Node::Optional, std::move(inner));
    return wrap(Node::Repeat, std::move(inner), min, max);
}

struct Rule {
    std::string name;
    Node body;
};

// ---------------------------------------------------------------------------------------------- tokens

struct Token {
    enum Type { End, Ident, String, Number, Punct, Prose, Class } type = End;
    std::string text;
    bool space_before = false;
};

enum class Dialect { Ebnf, Abnf, Peg, Ir };

bool ident_start(char c) { return std::isalpha((unsigned char)c) || c == '_'; }
bool ident_char(char c, Dialect d) { return std::isalnum((unsigned char)c) || c == '_' || (d == Dialect::Abnf && c == '-'); }

bool tokenize(const std::string& src, Dialect d, std::vector<Token>& out, std::string& error) {
    size_t i = 0;
    bool space = false;
    auto push = [&](Token::Type t, std::string text) {
        out.push_back({t, std::move(text), space});
        space = false;
    };
    while (i < src.size()) {
        char c = src[i];
        if (std::isspace((unsigned char)c)) {
            space = true;
            i++;
            continue;
        }
        if (d == Dialect::Peg && c == '#') {  // comment to the end of the line
            while (i < src.size() && src[i] != '\n') i++;
            space = true;
            continue;
        }
        if (d == Dialect::Ebnf && src.compare(i, 2, "/*") == 0) {
            size_t end = src.find("*/", i + 2);
            if (end == std::string::npos) {
                error = "an unclosed /* comment";
                return false;
            }
            i = end + 2;
            space = true;
            continue;
        }
        if (d == Dialect::Ebnf && src.compare(i, 2, "(*") == 0) {
            size_t end = src.find("*)", i + 2);
            if (end == std::string::npos) {
                error = "an unclosed (* comment";
                return false;
            }
            i = end + 2;
            space = true;
            continue;
        }
        if (c == '"' || (c == '\'' && d != Dialect::Abnf && d != Dialect::Ir)) {
            size_t end = i + 1;
            while (end < src.size() && src[end] != c) {
                if (src[end] == '\\' && end + 1 < src.size()) end++;
                end++;
            }
            if (end >= src.size()) {
                error = "an unclosed string";
                return false;
            }
            std::string text;
            for (size_t k = i + 1; k < end; k++) {
                if (src[k] == '\\' && k + 1 < end) k++;
                text += src[k];
            }
            push(Token::String, text);
            i = end + 1;
            continue;
        }
        if (d == Dialect::Abnf && c == '%') {  // %x41, %d65, %b1000001, ranges and concatenations
            size_t end = i + 1;
            while (end < src.size() && (std::isalnum((unsigned char)src[end]) || src[end] == '-' || src[end] == '.')) end++;
            push(Token::Number, src.substr(i, end - i));
            i = end;
            continue;
        }
        if (d == Dialect::Abnf && c == '<') {  // prose
            size_t end = src.find('>', i);
            if (end == std::string::npos) {
                error = "an unclosed <prose>";
                return false;
            }
            push(Token::Prose, src.substr(i + 1, end - i - 1));
            i = end + 1;
            continue;
        }
        if (d == Dialect::Peg && c == '[') {  // a character class is one piece
            size_t end = i + 1;
            while (end < src.size() && src[end] != ']') {
                if (src[end] == '\\') end++;
                end++;
            }
            if (end >= src.size()) {
                error = "an unclosed [class]";
                return false;
            }
            push(Token::Class, src.substr(i, end - i + 1));
            i = end + 1;
            continue;
        }
        if (ident_start(c)) {
            size_t end = i + 1;
            while (end < src.size() && ident_char(src[end], d)) end++;
            push(Token::Ident, src.substr(i, end - i));
            i = end;
            continue;
        }
        if (std::isdigit((unsigned char)c)) {
            size_t end = i + 1;
            while (end < src.size() && std::isdigit((unsigned char)src[end])) end++;
            push(Token::Number, src.substr(i, end - i));
            i = end;
            continue;
        }
        if (d == Dialect::Ebnf && src.compare(i, 3, "::=") == 0) {
            push(Token::Punct, "::=");
            i += 3;
            continue;
        }
        if (d == Dialect::Peg && src.compare(i, 2, "<-") == 0) {
            push(Token::Punct, "<-");
            i += 2;
            continue;
        }
        if (d == Dialect::Abnf && src.compare(i, 2, "=/") == 0) {
            push(Token::Punct, "=/");
            i += 2;
            continue;
        }
        if (std::string("=|/,;()[]{}?*+-&!.").find(c) != std::string::npos) {
            push(Token::Punct, std::string(1, c));
            i++;
            // ABNF: after `;` the rest of the line is a comment unless the next thing is a new rule
            if (d == Dialect::Abnf && c == ';') {
                size_t eol = src.find('\n', i);
                std::string rest = trim(src.substr(i, eol == std::string::npos ? std::string::npos : eol - i));
                size_t k = 0;
                while (k < rest.size() && (std::isalnum((unsigned char)rest[k]) || rest[k] == '-' || rest[k] == '_')) k++;
                bool is_rule = k > 0 && trim(rest.substr(k)).compare(0, 1, "=") == 0;
                if (!rest.empty() && !is_rule) i = eol == std::string::npos ? src.size() : eol;
            }
            continue;
        }
        error = std::string("unexpected character `") + c + "`";
        return false;
    }
    out.push_back({Token::End, "", true});
    return true;
}

// ---------------------------------------------------------------------------------------------- parsing

struct Parser {
    Dialect dialect;
    std::vector<Token> toks;
    size_t at = 0;
    std::string error;

    const Token& peek(size_t ahead = 0) const { return toks[std::min(at + ahead, toks.size() - 1)]; }
    bool is(const char* p, size_t ahead = 0) const { return peek(ahead).type == Token::Punct && peek(ahead).text == p; }
    bool at_end() const { return peek().type == Token::End; }
    bool fail(const std::string& m) {
        if (error.empty()) error = m + (at_end() ? " at the end of the grammar" : " near `" + peek().text + "`");
        return false;
    }

    /// A new rule starts here: `name =`, `name ::=`, `name <-` or `name =/`.
    bool rule_start(size_t ahead = 0) const {
        if (peek(ahead).type != Token::Ident) return false;
        const Token& n = peek(ahead + 1);
        return n.type == Token::Punct && (n.text == "=" || n.text == "::=" || n.text == "<-" || n.text == "=/");
    }

    bool parse_all(std::vector<Rule>& rules) {
        while (!at_end()) {
            if (is(";")) {
                at++;
                continue;
            }
            if (peek().type != Token::Ident || !rule_start()) return fail("expected a rule `name = definition ;`");
            Rule r;
            r.name = peek().text;
            at++;
            std::string op = peek().text;
            at++;
            Node body;
            if (!(dialect == Dialect::Ir ? ir_expr(body) : alternation(body))) return false;
            if (is(";")) at++;
            else if (!at_end() && !rule_start()) return fail("expected `;` after the rule");
            auto same = std::find_if(rules.begin(), rules.end(), [&](const Rule& x) { return x.name == r.name; });
            if (op == "=/" && same != rules.end()) {  // ABNF: more alternatives for a rule
                std::vector<Node> alts;
                if (same->body.kind == Node::Choice) alts = std::move(same->body.kids);
                else alts.push_back(std::move(same->body));
                alts.push_back(std::move(body));
                same->body = group(Node::Choice, std::move(alts));
            } else {
                r.body = std::move(body);
                rules.push_back(std::move(r));
            }
        }
        return true;
    }

    bool seq_end() const {
        if (at_end() || is(";") || is("|") || is(")") || is("]") || is("}")) return true;
        if (dialect != Dialect::Ebnf && is("/")) return true;
        return rule_start();
    }

    bool alternation(Node& out) {
        std::vector<Node> alts;
        while (true) {
            Node s;
            if (!sequence(s)) return false;
            alts.push_back(std::move(s));
            if (is("|") || (dialect != Dialect::Ebnf && is("/"))) {
                at++;
                continue;
            }
            break;
        }
        out = group(Node::Choice, std::move(alts));
        return true;
    }

    bool sequence(Node& out) {
        std::vector<Node> items;
        while (!seq_end()) {
            if (dialect == Dialect::Ebnf && is(",")) {
                at++;
                continue;
            }
            Node t;
            if (!term(t)) return false;
            items.push_back(std::move(t));
        }
        out = items.empty() ? Node() : group(Node::Seq, std::move(items));
        return true;
    }

    bool term(Node& out) {
        if (!factor(out)) return false;
        if (dialect == Dialect::Ebnf && is("-")) {  // exception: A - B
            at++;
            Node b;
            if (!factor(b)) return false;
            std::vector<Node> parts;
            parts.push_back(std::move(out));
            parts.push_back(leaf(Node::Special, "except"));
            parts.push_back(std::move(b));
            out = group(Node::Seq, std::move(parts));
        }
        return true;
    }

    bool factor(Node& out) {
        if (dialect == Dialect::Abnf) return abnf_repetition(out);
        bool and_pred = false, not_pred = false;
        if (dialect == Dialect::Peg && (is("&") || is("!"))) {
            and_pred = is("&");
            not_pred = !and_pred;
            at++;
        }
        Node p;
        if (!primary(p)) return false;
        while ((is("?") || is("*") || is("+")) && !peek().space_before) {
            const std::string s = peek().text;
            at++;
            p = s == "?" ? wrap(Node::Optional, std::move(p)) : s == "*" ? repeat_of(std::move(p), 0, kInf) : repeat_of(std::move(p), 1, kInf);
        }
        if (and_pred || not_pred) {
            std::vector<Node> parts;
            parts.push_back(leaf(Node::Special, and_pred ? "and" : "not"));
            parts.push_back(std::move(p));
            p = group(Node::Seq, std::move(parts));
        }
        out = std::move(p);
        return true;
    }

    bool abnf_repetition(Node& out) {
        int min = 1, max = 1;
        bool star = false;
        if (peek().type == Token::Number && peek().text[0] != '%') {
            min = max = std::atoi(peek().text.c_str());
            at++;
        }
        if (is("*")) {
            star = true;
            at++;
            if (min == max && toks[at - 2].type != Token::Number) min = 0;  // `*A`
            max = kInf;
            if (peek().type == Token::Number && peek().text[0] != '%') {
                max = std::atoi(peek().text.c_str());
                at++;
            }
        }
        (void)star;
        Node p;
        if (!primary(p)) return false;
        out = repeat_of(std::move(p), min, max);
        return true;
    }

    bool primary(Node& out) {
        const Token t = peek();
        switch (t.type) {
            case Token::String:
                at++;
                out = leaf(Node::Terminal, t.text);
                return true;
            case Token::Number:  // an ABNF numeric value (`%x41`, `%x30-39`)
                if (t.text[0] != '%') return fail("a number is only a repeat count before an element");
                at++;
                out = leaf(Node::Terminal, t.text);
                return true;
            case Token::Prose:
                at++;
                out = leaf(Node::Special, t.text);
                return true;
            case Token::Class:
                at++;
                out = leaf(Node::Terminal, t.text);
                return true;
            case Token::Ident:
                if (rule_start()) return fail("expected an element");
                at++;
                out = leaf(Node::NonTerminal, t.text);
                return true;
            case Token::Punct:
                if (t.text == "(") {
                    at++;
                    if (!alternation(out)) return false;
                    if (!is(")")) return fail("expected `)`");
                    at++;
                    return true;
                }
                if (t.text == "[" && dialect != Dialect::Peg) {
                    at++;
                    Node inner;
                    if (!alternation(inner)) return false;
                    if (!is("]")) return fail("expected `]`");
                    at++;
                    out = wrap(Node::Optional, std::move(inner));
                    return true;
                }
                if (t.text == "{" && dialect == Dialect::Ebnf) {
                    at++;
                    Node inner;
                    if (!alternation(inner)) return false;
                    if (!is("}")) return fail("expected `}`");
                    at++;
                    out = repeat_of(std::move(inner), 0, kInf);
                    return true;
                }
                if (t.text == "?" && dialect == Dialect::Ebnf) {  // ISO special sequence: ? text ?
                    at++;
                    std::string text;
                    while (!at_end() && !is("?")) {
                        text += (text.empty() ? "" : " ") + peek().text;
                        at++;
                    }
                    if (!is("?")) return fail("an unclosed special sequence `? ... ?`");
                    at++;
                    out = leaf(Node::Special, text);
                    return true;
                }
                if (t.text == "." && dialect == Dialect::Peg) {
                    at++;
                    out = leaf(Node::Special, "any character");
                    return true;
                }
                return fail("expected an element");
            default:
                return fail("expected an element");
        }
    }

    // the intermediate representation: explicit constructors
    bool ir_expr(Node& out) {
        const Token t = peek();
        if (t.type != Token::Ident) return fail("expected a constructor such as terminal(\"x\")");
        const std::string fn = t.text;
        at++;
        if (!is("(")) return fail("expected `(` after " + fn);
        at++;
        if (fn == "terminal" || fn == "nonterminal" || fn == "special") {
            if (peek().type != Token::String) return fail(fn + " takes a string");
            out = leaf(fn == "terminal" ? Node::Terminal : fn == "nonterminal" ? Node::NonTerminal : Node::Special, peek().text);
            at++;
        } else if (fn == "sequence" || fn == "choice") {
            std::vector<Node> kids;
            while (!is(")")) {
                Node k;
                if (!ir_expr(k)) return false;
                kids.push_back(std::move(k));
                if (is(",")) at++;
                else if (!is(")")) return fail("expected `,` or `)`");
            }
            out = group(fn == "sequence" ? Node::Seq : Node::Choice, std::move(kids));
        } else if (fn == "optional" || fn == "zeroOrMore" || fn == "oneOrMore") {
            Node k;
            if (!ir_expr(k)) return false;
            out = fn == "optional" ? wrap(Node::Optional, std::move(k)) : repeat_of(std::move(k), fn == "zeroOrMore" ? 0 : 1, kInf);
        } else {
            return fail("unknown constructor `" + fn + "`");
        }
        if (!is(")")) return fail("expected `)`");
        at++;
        return true;
    }
};

// ---------------------------------------------------------------------------------------------- layout

constexpr double kBoxH = 28, kPad = 12, kGap = 18, kR = 8, kVGap = 12, kFont = 13;

struct Measurer {
    const Text& text;

    void run(Node& n) {
        for (auto& k : n.kids) run(k);
        switch (n.kind) {
            case Node::Empty:
                n.w = 12;
                n.up = n.down = 0;
                break;
            case Node::Terminal:
            case Node::NonTerminal:
            case Node::Special:
                n.w = text.width(n.text, kFont, n.kind == Node::NonTerminal ? 600 : 500, n.kind == Node::Terminal) + 2 * kPad;
                n.up = n.down = kBoxH / 2;
                break;
            case Node::Seq:
                n.w = 0;
                n.up = n.down = 0;
                for (size_t i = 0; i < n.kids.size(); i++) {
                    n.w += n.kids[i].w + (i ? kGap : 0);
                    n.up = std::max(n.up, n.kids[i].up);
                    n.down = std::max(n.down, n.kids[i].down);
                }
                break;
            case Node::Choice: {
                double inner = 0;
                for (auto& k : n.kids) inner = std::max(inner, k.w);
                n.w = inner + 4 * kR;
                n.offset.assign(n.kids.size(), 0);
                for (size_t i = 1; i < n.kids.size(); i++) n.offset[i] = n.offset[i - 1] + n.kids[i - 1].down + kVGap + n.kids[i].up;
                n.up = n.kids[0].up;
                n.down = n.offset.back() + n.kids.back().down;
                break;
            }
            case Node::Optional:
                n.w = n.kids[0].w + 4 * kR;
                n.up = n.kids[0].up + kVGap + 2;
                n.down = n.kids[0].down;
                break;
            case Node::Repeat: {
                n.w = n.kids[0].w + 4 * kR;
                bool skip = n.min == 0;
                n.up = skip ? n.kids[0].up + kVGap + 2 : n.kids[0].up;
                n.down = n.kids[0].down + kVGap + 2 + (n.min > 1 || n.max != kInf ? 14 : 0);
                break;
            }
        }
    }
};

struct Painter {
    const Theme& th;
    const Text& text;
    std::string out;
    std::string line;  // stroke attributes of every connecting line

    void path(const std::string& d) { out += "<path d=\"" + d + "\" fill=\"none\" " + line + "/>\n"; }

    static std::string P(double x, double y) { return num(x) + " " + num(y); }

    void hline(double x0, double x1, double y) { path("M" + P(x0, y) + " L" + P(x1, y)); }

    /// From (x0, y) to a branch at `dy` (below when positive) that starts at x0 + 2r: a rounded step.
    std::string step(double x0, double y, double dy, bool going_out) {
        double s = dy > 0 ? 1 : -1;
        if (going_out) return "M" + P(x0, y) + " Q" + P(x0 + kR, y) + " " + P(x0 + kR, y + s * kR) + " L" + P(x0 + kR, y + dy - s * kR) + " Q" + P(x0 + kR, y + dy) + " " + P(x0 + 2 * kR, y + dy);
        return "M" + P(x0, y + dy) + " Q" + P(x0 + kR, y + dy) + " " + P(x0 + kR, y + dy - s * kR) + " L" + P(x0 + kR, y + s * kR) + " Q" + P(x0 + kR, y) + " " + P(x0 + 2 * kR, y);
    }

    void draw(const Node& n, double x, double y) {
        switch (n.kind) {
            case Node::Empty:
                hline(x, x + n.w, y);
                break;
            case Node::Terminal:
            case Node::NonTerminal:
            case Node::Special: {
                hline(x, x + n.w, y);
                bool term = n.kind == Node::Terminal, spec = n.kind == Node::Special;
                out += "<rect x=\"" + num(x) + "\" y=\"" + num(y - kBoxH / 2) + "\" width=\"" + num(n.w) + "\" height=\"" + num(kBoxH) + "\" rx=\"" + (term ? num(kBoxH / 2) : spec ? "6" : "3") + "\" fill=\"" +
                       (term ? th.surface : th.group_fill) + "\" stroke=\"" + th.line + "\" stroke-width=\"" + (term ? "1.2" : "1.5") + "\"" + (spec ? " stroke-dasharray=\"4 3\"" : "") + "/>\n";
                centered_text(out, th, {n.text}, x + n.w / 2, y, kFont, n.kind == Node::NonTerminal ? 600 : 500, th.label, term);
                break;
            }
            case Node::Seq: {
                double cx = x;
                for (size_t i = 0; i < n.kids.size(); i++) {
                    if (i) {
                        hline(cx, cx + kGap, y);
                        cx += kGap;
                    }
                    draw(n.kids[i], cx, y);
                    cx += n.kids[i].w;
                }
                break;
            }
            case Node::Choice:
                for (size_t i = 0; i < n.kids.size(); i++) {
                    const Node& k = n.kids[i];
                    double ky = y + n.offset[i], inner = n.w - 4 * kR, kx = x + 2 * kR + (inner - k.w) / 2;
                    if (i) {
                        path(step(x, y, n.offset[i], true));
                        path(step(x + n.w - 2 * kR, y, n.offset[i], false));
                    }
                    hline(i ? x + 2 * kR : x, kx, ky);
                    hline(kx + k.w, i ? x + n.w - 2 * kR : x + n.w, ky);
                    draw(k, kx, ky);
                }
                break;
            case Node::Optional:
            case Node::Repeat: {
                const Node& k = n.kids[0];
                double inner = n.w - 4 * kR;
                hline(x, x + 2 * kR, y);
                hline(x + n.w - 2 * kR, x + n.w, y);
                draw(k, x + 2 * kR, y);
                bool skip = n.kind == Node::Optional || n.min == 0;
                if (skip) {  // the way past it, above
                    double dy = -(k.up + kVGap);
                    path(step(x, y, dy, true));
                    path(step(x + n.w - 2 * kR, y, dy, false));
                    hline(x + 2 * kR, x + n.w - 2 * kR, y + dy);
                }
                if (n.kind == Node::Repeat) {  // the way back, below
                    double dy = k.down + kVGap;
                    double xl = x + 2 * kR, xr = x + n.w - 2 * kR;
                    path("M" + P(xr, y) + " Q" + P(xr + kR, y) + " " + P(xr + kR, y + kR) + " L" + P(xr + kR, y + dy - kR) + " Q" + P(xr + kR, y + dy) + " " + P(xr, y + dy) + " L" + P(xl, y + dy) + " Q" +
                         P(xl - kR, y + dy) + " " + P(xl - kR, y + dy - kR) + " L" + P(xl - kR, y + kR) + " Q" + P(xl - kR, y) + " " + P(xl, y));
                    (void)inner;
                    if (n.min > 1 || n.max != kInf) {
                        std::string label = n.max == kInf ? std::to_string(n.min) + "+ times" : n.min == n.max ? std::to_string(n.min) + " times" : std::to_string(n.min) + "-" + std::to_string(n.max) + " times";
                        centered_text(out, th, {label}, x + n.w / 2, y + dy + 11, 10, 400, th.text_sec);
                    }
                }
                break;
            }
        }
    }
};

}  // namespace

bool render_railroad(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    // the header names the dialect; `title` and the accessibility lines come before the first rule
    std::string title, body_src, header;
    bool first = true;
    {
        size_t i = 0;
        while (i <= source.size()) {
            size_t e = source.find('\n', i);
            std::string line = trim(source.substr(i, e == std::string::npos ? std::string::npos : e - i));
            i = e == std::string::npos ? source.size() + 1 : e + 1;
            if (line.empty() || line.compare(0, 2, "%%") == 0) continue;
            if (first) {
                header = line.substr(0, line.find_first_of(" \t"));
                first = false;
                continue;
            }
            if (line.compare(0, 8, "accTitle") == 0 || line.compare(0, 8, "accDescr") == 0) continue;
            if (line.compare(0, 6, "title ") == 0) {
                std::string rest = trim(line.substr(6));
                if (!(rest.compare(0, 1, "=") == 0 || rest.compare(0, 2, "<-") == 0 || rest.compare(0, 3, "::=") == 0)) {
                    if (rest.size() >= 2 && rest.front() == '"' && rest.back() == '"') rest = rest.substr(1, rest.size() - 2);
                    title = rest;
                    continue;
                }
            }
            body_src += line + "\n";
        }
    }
    Dialect dialect = header == "railroad-ebnf-beta" ? Dialect::Ebnf : header == "railroad-abnf-beta" ? Dialect::Abnf : header == "railroad-peg-beta" ? Dialect::Peg : Dialect::Ir;

    Parser parser;
    parser.dialect = dialect;
    std::string tok_error;
    if (!tokenize(body_src, dialect, parser.toks, tok_error)) {
        error = tok_error;
        return false;
    }
    std::vector<Rule> rules;
    if (!parser.parse_all(rules)) {
        error = parser.error;
        return false;
    }
    if (rules.empty()) {
        error = "no rules";
        return false;
    }

    Theme th = make_theme(options);
    Text text{options};
    Measurer measure{text};
    for (auto& r : rules) measure.run(r.body);

    Painter p{th, text, "", "stroke=\"" + th.line + "\" stroke-width=\"1.5\""};
    const double kEnd = 16;  // the start and end markers and the lines to them
    double top = kMargin, y = top, maxw = 0;  // Mermaid draws no title on a railroad diagram (the parsed title only takes the line)
    std::string rule_art;
    for (auto& r : rules) {
        double w = kEnd * 2 + r.body.w + 2 * 8;
        maxw = std::max(maxw, w);
        aligned_text(p.out, th, {r.name + " ="}, kMargin, y + 8, 14, 700, th.label, "start");
        double base = y + 24 + r.body.up;
        // start marker, the diagram, end marker
        p.out += "<circle cx=\"" + num(kMargin + 4) + "\" cy=\"" + num(base) + "\" r=\"4\" fill=\"" + th.line + "\"/>\n";
        p.hline(kMargin + 8, kMargin + 8 + kEnd, base);
        p.draw(r.body, kMargin + 8 + kEnd, base);
        double ex = kMargin + 8 + kEnd + r.body.w;
        p.hline(ex, ex + kEnd, base);
        p.out += "<circle cx=\"" + num(ex + kEnd + 4) + "\" cy=\"" + num(base) + "\" r=\"4\" fill=\"" + th.bg + "\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"/>\n";
        y = base + r.body.down + 36;
    }
    double W = maxw + 2 * kMargin, H = y - 36 + kMargin;
    std::string body;
    body += p.out;
    svg = svg_document(th, W, H, body);
    return true;
}

}  // namespace mermaid
