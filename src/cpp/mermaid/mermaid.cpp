#include "mermaid/mermaid.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>

#include "mermaid/classdiagram.h"
#include "mermaid/erdiagram.h"
#include "mermaid/flowchart.h"
#include "mermaid/mermaid_internal.h"
#include "mermaid/gantt.h"
#include "mermaid/mindmap.h"
#include "mermaid/pie.h"
#include "mermaid/sequence.h"
#include "mermaid/state.h"
#include "mermaid/journey.h"
#include "mermaid/quadrant.h"
#include "mermaid/gitgraph.h"
#include "mermaid/kanban.h"
#include "mermaid/packet.h"
#include "mermaid/sankey.h"
#include "mermaid/requirement.h"
#include "mermaid/block.h"
#include "mermaid/treemap.h"
#include "mermaid/radar.h"
#include "mermaid/info.h"
#include "mermaid/architecture.h"
#include "mermaid/c4.h"
#include "mermaid/venn.h"
#include "mermaid/ishikawa.h"
#include "mermaid/treeview.h"
#include "mermaid/usecase.h"
#include "mermaid/eventmodeling.h"
#include "mermaid/railroad.h"
#include "mermaid/cynefin.h"
#include "mermaid/wardley.h"
#include "mermaid/timeline.h"
#include "mermaid/xychart.h"

namespace mermaid {

double estimate_text_width(const std::string& text, double size, int weight, bool mono) {
    if (mono) {
        double n = 0;
        for (size_t i = 0; i < text.size(); i++)
            if ((text[i] & 0xC0) != 0x80) n += (unsigned char)text[i] >= 0xE0 ? 2 : 1;  // a CJK character takes two cells
        return n * size * 0.6;
    }
    double em = 0;
    for (size_t i = 0; i < text.size();) {
        unsigned char c = (unsigned char)text[i];
        if (c < 0x80) {
            i++;
            if (c == ' ') em += 0.28;
            else if (std::string("iljI.,:;!|'`").find((char)c) != std::string::npos) em += 0.28;
            else if (std::string("ft()[]{}-/\\\"").find((char)c) != std::string::npos) em += 0.36;
            else if (std::string("mwMW@%").find((char)c) != std::string::npos) em += 0.85;
            else if (c >= 'A' && c <= 'Z') em += 0.66;
            else if (c >= '0' && c <= '9') em += 0.58;
            else em += 0.55;
        } else {
            // one code point; everything outside the Latin range counts as full width
            size_t len = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : 2;
            i += len;
            em += len == 2 ? 0.6 : 1.0;
        }
    }
    return em * size * (weight >= 600 ? 1.05 : 1.0);
}

namespace {

// `---` ... `---` at the very top; returns the text between the fences and removes the block from @p source.
std::string take_frontmatter(std::string& source) {
    size_t i = 0;
    while (i < source.size() && (source[i] == ' ' || source[i] == '\n' || source[i] == '\r' || source[i] == '\t')) i++;
    if (source.compare(i, 3, "---") != 0) return "";
    size_t eol = source.find('\n', i);
    if (eol == std::string::npos || !litehtml::svgutil::trim(source.substr(i + 3, eol - i - 3)).empty()) return "";
    size_t pos = eol + 1;
    while (pos <= source.size()) {
        size_t e = source.find('\n', pos);
        std::string line = litehtml::svgutil::trim(source.substr(pos, e == std::string::npos ? std::string::npos : e - pos));
        if (line == "---") {
            std::string body = source.substr(eol + 1, pos - eol - 1);
            source = e == std::string::npos ? "" : source.substr(e + 1);
            return body;
        }
        if (e == std::string::npos) break;
        pos = e + 1;
    }
    return "";
}

// The value of `key` in JSON-ish ("key": "v"), YAML-ish (key: v) or quoted-key text; empty when absent.
std::string find_value(const std::string& text, const std::string& key) {
    for (size_t at = text.find(key); at != std::string::npos; at = text.find(key, at + 1)) {
        size_t b = at, e = at + key.size();
        if (b > 0 && (std::isalnum((unsigned char)text[b - 1]) || text[b - 1] == '_')) continue;
        if (e < text.size() && text[e] == '"') e++;
        while (e < text.size() && text[e] == ' ') e++;
        if (e >= text.size() || text[e] != ':') continue;
        e++;
        while (e < text.size() && (text[e] == ' ' || text[e] == '"' || text[e] == '\'')) e++;
        size_t end = e;
        while (end < text.size() && text[end] != '"' && text[end] != '\'' && text[end] != ',' && text[end] != '}' && text[end] != '\n' && text[end] != '\r') end++;
        std::string v = litehtml::svgutil::trim(text.substr(e, end - e));
        if (!v.empty()) return v;
    }
    return "";
}

void apply_config(const std::string& cfg, Options& o) {
    apply_theme(find_value(cfg, "theme"), o);
    auto set = [&](const char* key, std::string& dst) {
        std::string v = find_value(cfg, key);
        if (!v.empty()) dst = v;
    };
    set("textColor", o.fg);
    set("primaryTextColor", o.fg);
    set("background", o.bg);
    set("primaryColor", o.surface);
    set("primaryBorderColor", o.border);
    set("lineColor", o.line);
    set("secondaryTextColor", o.muted);
    set("accentColor", o.accent);
    set("arrowheadColor", o.arrow);
    set("clusterBkg", o.group_fill);
    // the aliases and the other roles themeVariables can name
    set("mainBkg", o.surface);
    set("nodeBorder", o.border);
    set("nodeTextColor", o.fg);
    set("noteBkgColor", o.note_fill);
    set("noteBorderColor", o.note_border);
    set("noteTextColor", o.note_text);
    set("edgeLabelBackground", o.label_fill);
    set("actorBorder", o.actor_border);
    set("actorBkg", o.surface);
    // series colours: pie1..pie12 (pie chart) or cScale0..cScale11, in order
    std::string scale;
    for (int i = 0; i < 12; i++) {
        std::string v = find_value(cfg, ("pie" + std::to_string(i + 1)).c_str());
        if (v.empty()) v = find_value(cfg, ("cScale" + std::to_string(i)).c_str());
        if (v.empty()) break;
        scale += (scale.empty() ? "" : ",") + v;
    }
    if (!scale.empty()) o.scale = scale;
    // arrow heads follow the line (official themes) or the accent unless the config names them
    if (find_value(cfg, "arrowheadColor").empty()) {
        if (!find_value(cfg, "lineColor").empty() && !o.arrow.empty()) o.arrow = o.line;
        else if (!find_value(cfg, "accentColor").empty()) o.arrow.clear();
    }
}

// Markdown strings (`"`**bold** and *italic*`"`, Mermaid 11+): the text is drawn plain, one style per label, so the
// markers go and a line break becomes <br/>. Labels without a backtick are left alone.
std::string flatten_markdown_strings(const std::string& source) {
    if (source.find("\"`") == std::string::npos) return source;
    std::string out;
    size_t i = 0;
    while (i < source.size()) {
        size_t open = source.find("\"`", i);
        size_t close = open == std::string::npos ? std::string::npos : source.find("`\"", open + 2);
        if (close == std::string::npos) break;
        out += source.substr(i, open - i) + "\"";
        std::string body = source.substr(open + 2, close - open - 2), text;
        for (size_t k = 0; k < body.size(); k++) {
            char c = body[k];
            if (c == '\r') continue;
            if (c == '\n') {
                text += "<br/>";
                while (k + 1 < body.size() && (body[k + 1] == ' ' || body[k + 1] == '\t')) k++;  // indentation of the continuation line
            } else if (c == '*' || (c == '_' && k + 1 < body.size() && body[k + 1] == '_')) {
                while (k + 1 < body.size() && body[k + 1] == c) k++;  // **, ***, __: the marker only
                if (c == '_') continue;
            } else {
                text += c;
            }
        }
        // `*italic*` has lost its markers above; a lone * between words was a marker too
        out += text + "\"";
        i = close + 2;
    }
    return out + source.substr(i);
}

// Drops `%%{ ... }%%` directives (they may span lines) and returns their text.
std::string take_directives(std::string& source) {
    std::string found, out;
    size_t i = 0;
    while (i < source.size()) {
        size_t at = source.find("%%{", i);
        if (at == std::string::npos) break;
        size_t end = source.find("}%%", at);
        if (end == std::string::npos) break;
        out += source.substr(i, at - i);
        found += source.substr(at + 3, end - at - 3) + "\n";
        i = end + 3;
    }
    out += source.substr(i);
    source = out;
    return found;
}

}  // namespace

static bool render_once(const std::string& input, const Options& base, std::string& svg, std::string& error) {
    std::string source = input;
    Options options = base;
    std::string config = take_frontmatter(source) + "\n" + take_directives(source);
    source = flatten_markdown_strings(source);
    if (options.allow_directives) apply_config(config, options);
    // the first line that is not blank or a comment names the diagram
    size_t i = 0;
    std::string keyword;
    while (i < source.size()) {
        size_t e = source.find('\n', i);
        std::string line = litehtml::svgutil::trim(source.substr(i, e == std::string::npos ? std::string::npos : e - i));
        if (!line.empty() && line.compare(0, 2, "%%") != 0) {
            size_t sp = line.find_first_of(" \t;");
            keyword = line.substr(0, sp);
            break;
        }
        if (e == std::string::npos) break;
        i = e + 1;
    }
    if (keyword == "graph" || keyword == "flowchart" || keyword == "flowchart-elk" || keyword == "swimlane-beta" || keyword == "agentflow-beta") return render_flowchart(source, options, svg, error);
    if (keyword == "stateDiagram" || keyword == "stateDiagram-v2") return render_state(source, options, svg, error);
    if (keyword == "classDiagram" || keyword == "classDiagram-v2") return render_class(source, options, svg, error);
    if (keyword == "erDiagram") return render_er(source, options, svg, error);
    if (keyword == "xychart-beta" || keyword == "xychart") return render_xychart(source, options, svg, error);
    if (keyword == "journey") return render_journey(source, options, svg, error);
    if (keyword == "quadrantChart") return render_quadrant(source, options, svg, error);
    if (keyword == "gitGraph") return render_gitgraph(source, options, svg, error);
    if (keyword == "kanban") return render_kanban(source, options, svg, error);
    if (keyword == "packet-beta" || keyword == "packet") return render_packet(source, options, svg, error);
    if (keyword == "sankey-beta" || keyword == "sankey") return render_sankey(source, options, svg, error);
    if (keyword == "requirementDiagram") return render_requirement(source, options, svg, error);
    if (keyword == "block-beta" || keyword == "block") return render_block(source, options, svg, error);
    if (keyword == "treemap-beta" || keyword == "treemap") return render_treemap(source, options, svg, error);
    if (keyword == "radar-beta" || keyword == "radar") return render_radar(source, options, svg, error);
    if (keyword == "info") return render_info(source, options, svg, error);
    if (keyword == "architecture-beta" || keyword == "architecture") return render_architecture(source, options, svg, error);
    if (keyword == "C4Context" || keyword == "C4Container" || keyword == "C4Component" || keyword == "C4Dynamic" || keyword == "C4Deployment") return render_c4(source, options, svg, error);
    if (keyword == "venn-beta" || keyword == "venn") return render_venn(source, options, svg, error);
    if (keyword == "ishikawa-beta" || keyword == "ishikawa") return render_ishikawa(source, options, svg, error);
    if (keyword == "treeView-beta" || keyword == "treeView") return render_treeview(source, options, svg, error);
    if (keyword == "wardley-beta" || keyword == "wardley") return render_wardley(source, options, svg, error);
    if (keyword == "cynefin-beta" || keyword == "cynefin") return render_cynefin(source, options, svg, error);
    if (keyword == "railroad-ebnf-beta" || keyword == "railroad-abnf-beta" || keyword == "railroad-peg-beta" || keyword == "railroad-beta") return render_railroad(source, options, svg, error);
    if (keyword == "eventmodeling") return render_eventmodeling(source, options, svg, error);
    if (keyword == "usecase-beta" || keyword == "usecase") return render_usecase(source, options, svg, error);
    if (keyword == "timeline") return render_timeline(source, options, svg, error);
    if (keyword == "mindmap")return render_mindmap(source, options, svg, error);
    if (keyword == "gantt")return render_gantt(source, options, svg, error);
    if (keyword == "pie")return render_pie(source, options, svg, error);
    if (keyword == "sequenceDiagram") return render_sequence(source, options, svg, error);
    error = keyword.empty() ? "empty diagram" : "unsupported diagram type: " + keyword;
    return false;
}

namespace {

const char* const kKeywords[] = {"graph", "flowchart", "stateDiagram", "stateDiagram-v2", "classDiagram", "erDiagram", "xychart-beta", "xychart", "journey", "quadrantChart", "gitGraph", "kanban",
                                 "packet-beta", "sankey-beta", "requirementDiagram", "block-beta", "timeline", "mindmap", "gantt", "pie", "sequenceDiagram", "treemap-beta", "radar-beta", "info",
                                 "architecture-beta", "C4Context", "C4Container", "C4Component", "C4Dynamic", "C4Deployment", "venn-beta", "ishikawa-beta", "treeView-beta", "swimlane-beta", "agentflow-beta", "usecase-beta", "eventmodeling", "railroad-ebnf-beta", "cynefin-beta", "wardley-beta"};

std::string lower(std::string s) {
    for (char& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

size_t edit_distance(const std::string& a, const std::string& b) {
    std::vector<size_t> prev(b.size() + 1), cur(b.size() + 1);
    for (size_t j = 0; j <= b.size(); j++) prev[j] = j;
    for (size_t i = 1; i <= a.size(); i++) {
        cur[0] = i;
        for (size_t j = 1; j <= b.size(); j++) cur[j] = std::min({prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1)});
        std::swap(prev, cur);
    }
    return prev[b.size()];
}

/// The known keyword nearest to @p word: a different case counts as a match, otherwise at most two edits
/// (one for short words) and no tie. Empty when nothing fits.
std::string nearest_keyword(const std::string& word, bool allow_typos) {
    std::string lw = lower(word);
    for (const char* k : kKeywords)
        if (lower(k) == lw) return k;
    if (!allow_typos) return "";
    size_t limit = word.size() <= 5 ? 1 : 2, best = limit + 1;
    std::string found;
    bool tie = false;
    for (const char* k : kKeywords) {
        size_t d = edit_distance(lw, lower(k));
        if (d < best) best = d, found = k, tie = false;
        else if (d == best && found != k) tie = true;
    }
    return best <= limit && !tie ? found : "";
}

// Replaces the diagram keyword on the first meaningful line; false when there is none.
bool replace_keyword(std::string& source, const std::string& from, const std::string& to) {
    size_t i = 0;
    while (i < source.size()) {
        size_t e = source.find('\n', i);
        size_t end = e == std::string::npos ? source.size() : e;
        std::string line = litehtml::svgutil::trim(source.substr(i, end - i));
        if (!line.empty() && line.compare(0, 2, "%%") != 0 && line.compare(0, 3, "---") != 0) {
            size_t at = source.find(from, i);
            if (at == std::string::npos || at >= end) return false;
            source.replace(at, from.size(), to);
            return true;
        }
        if (e == std::string::npos) break;
        i = e + 1;
    }
    return false;
}

bool starts_with(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

// Drops the first line (after the keyword line) whose text is @p text.
bool drop_line(std::string& source, const std::string& text) {
    size_t i = 0;
    int n = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        size_t end = e == std::string::npos ? source.size() : e;
        std::string line = litehtml::svgutil::trim(source.substr(i, end - i));
        if (!line.empty() && line.compare(0, 2, "%%") != 0) n++;
        if (n > 1 && line == text) {
            source.erase(i, (e == std::string::npos ? source.size() : e + 1) - i);
            return true;
        }
        if (e == std::string::npos) break;
        i = e + 1;
    }
    return false;
}

}  // namespace

/// Removes `accTitle` / `accDescr` statements (`accDescr { ... }` may span lines) and returns their text.
static void take_accessibility(std::string& source, std::string& title, std::string& descr) {
    using litehtml::svgutil::trim;
    auto keyword = [](const std::string& line, const char* word) {
        size_t n = std::char_traits<char>::length(word);
        return line.compare(0, n, word) == 0 && (line.size() == n || line[n] == ':' || line[n] == ' ' || line[n] == '{');
    };
    std::string out;
    size_t i = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        size_t end = e == std::string::npos ? source.size() : e;
        std::string raw = source.substr(i, end - i), line = trim(raw);
        i = e == std::string::npos ? source.size() + 1 : e + 1;
        if (keyword(line, "accTitle")) {
            std::string v = trim(line.substr(8));
            if (!v.empty() && v[0] == ':') v = trim(v.substr(1));
            title = v;
            continue;
        }
        if (keyword(line, "accDescr")) {
            std::string v = trim(line.substr(8));
            if (!v.empty() && v[0] == ':') {
                descr = trim(v.substr(1));
            } else if (!v.empty() && v[0] == '{') {
                v = trim(v.substr(1));
                std::string text;
                bool closed = false;
                for (;;) {
                    size_t brace = v.find('}');
                    if (brace != std::string::npos) {
                        v = trim(v.substr(0, brace));
                        closed = true;
                    }
                    if (!v.empty()) text += (text.empty() ? "" : "\n") + v;
                    if (closed || i > source.size()) break;
                    size_t e2 = source.find('\n', i);
                    v = trim(source.substr(i, e2 == std::string::npos ? std::string::npos : e2 - i));
                    i = e2 == std::string::npos ? source.size() + 1 : e2 + 1;
                }
                descr = text;
            }
            continue;
        }
        out += raw;
        if (e != std::string::npos) out += '\n';
    }
    source = out;
}

// A frontmatter `title:` is drawn above the diagram, as Mermaid draws it: the canvas grows by a band, the
// drawing shifts down into it, and the title sits centred in the band.
void add_title_band(std::string& svg, const std::string& title, const Options& options) {
    size_t vb = svg.find("viewBox=\"0 0 ");
    if (vb == std::string::npos) return;
    size_t vs = vb + 13, ve = svg.find('"', vs);
    if (ve == std::string::npos) return;
    char* e1 = nullptr;
    double w = std::strtod(svg.c_str() + vs, &e1);
    double h = e1 ? std::strtod(e1, nullptr) : 0;
    if (w <= 0 || h <= 0) return;
    constexpr double kBand = 36;
    svg.replace(vs, ve - vs, num(w) + " " + num(h + kBand));
    size_t ha = svg.find("height=\"", ve);
    if (ha != std::string::npos) {
        size_t hs = ha + 8, he = svg.find('"', hs);
        if (he != std::string::npos) svg.replace(hs, he - hs, num(h + kBand));
    }
    size_t root_end = svg.find('>');
    if (root_end == std::string::npos) return;
    size_t at = root_end + 1;
    if (svg.compare(at + 1, 5, "<rect") == 0) {  // a painted background comes first (on its own line) and grows too
        size_t re = svg.find("/>", at);
        if (re == std::string::npos) return;
        size_t bh = svg.find("height=\"", at);
        if (bh != std::string::npos && bh < re) {
            size_t bs = bh + 8, be = svg.find('"', bs);
            if (be != std::string::npos && be < re) svg.replace(bs, be - bs, num(h + kBand));
        }
        at = svg.find("/>", at) + 2;
    }
    svg.insert(at, "\n<text x=\"" + num(w / 2) + "\" y=\"" + num(kBand / 2 + 6) + "\" text-anchor=\"middle\" font-size=\"16\" font-weight=\"600\" font-family=\"" +
                       esc(options.font_family) + "\" fill=\"" + esc(options.fg) + "\">" + esc(title) + "</text>\n<g transform=\"translate(0 " + num(kBand) + ")\">\n");
    size_t close = svg.rfind("</svg>");
    if (close != std::string::npos) svg.insert(close, "</g>\n");
}

bool render(const std::string& input, const Options& options, std::string& svg, std::string& error, std::vector<std::string>* warnings) {
    if (options.max_source_bytes && input.size() > options.max_source_bytes) {
        error = "the diagram source is too large (" + std::to_string(input.size()) + " bytes; the limit is " + std::to_string(options.max_source_bytes) + ")";
        return false;
    }
    if (options.max_lines) {
        size_t lines = 0;
        for (size_t i = 0; i < input.size();) {
            size_t e = input.find('\n', i);
            std::string line = litehtml::svgutil::trim(input.substr(i, e == std::string::npos ? std::string::npos : e - i));
            if (!line.empty() && line.compare(0, 2, "%%") != 0) lines++;
            if (e == std::string::npos) break;
            i = e + 1;
        }
        if (lines > options.max_lines) {
            error = "the diagram has too many lines (" + std::to_string(lines) + "; the limit is " + std::to_string(options.max_lines) + ")";
            return false;
        }
    }
    std::string source = input;
    std::string acc_title, acc_descr;
    take_accessibility(source, acc_title, acc_descr);
    if (options.mode != Options::Mode::Strict) {
        if (source.compare(0, 3, "\xEF\xBB\xBF") == 0) source.erase(0, 3);
        std::string out;
        for (char c : source)
            if (c != '\r') out += c;
        source = out;
    }
    std::vector<std::string> notes;
    bool tried_close = false;
    for (int round = 0; round < 40; round++) {
        if (render_once(source, options, svg, error)) {
            std::string fm_src = source, fm_title = find_value(take_frontmatter(fm_src), "title");
            if (!fm_title.empty()) add_title_band(svg, fm_title, options);
            size_t root_end = svg.find('>');
            if ((!acc_title.empty() || !acc_descr.empty()) && root_end != std::string::npos) {
                std::string text;
                if (!acc_title.empty()) text += "<title>" + esc(acc_title) + "</title>\n";
                if (!acc_descr.empty()) text += "<desc>" + esc(acc_descr) + "</desc>\n";
                svg.insert(root_end + 1, "\n" + text);
            }
            if (!notes.empty()) {
                std::string comment = "<!-- recovered:";
                for (auto& n : notes) {
                    std::string t = n;
                    for (size_t p = t.find("--"); p != std::string::npos; p = t.find("--", p + 1)) t.replace(p, 2, "- ");
                    comment += " " + t + ";";
                }
                comment += " -->\n";
                size_t tag = svg.find('>');
                if (tag != std::string::npos) svg.insert(tag + 1, "\n" + comment);
                if (warnings) *warnings = notes;
            }
            return true;
        }
        if (starts_with(error, "unsupported diagram type: ")) {
            std::string word = error.substr(26), fix = nearest_keyword(word, options.mode == Options::Mode::Recover);
            if (!fix.empty() && options.mode != Options::Mode::Strict && replace_keyword(source, word, fix)) {
                notes.push_back("`" + word + "` read as `" + fix + "`");
                continue;
            }
            std::string hint = nearest_keyword(word, true);
            if (!hint.empty()) error += " (did you mean `" + hint + "`?)";
            return false;
        }
        if (options.mode == Options::Mode::Strict) return false;
        if (!tried_close) {
            tried_close = true;
            bool closed = false;
            for (const char* closer : {"end", "}"}) {
                std::string trial = source;
                for (int n = 1; n <= 3 && !closed; n++) {
                    trial += std::string("\n") + closer;
                    std::string t_svg, t_err;
                    if (render_once(trial, options, t_svg, t_err)) {
                        source = trial;
                        notes.push_back("added " + std::to_string(n) + " missing `" + closer + "`");
                        closed = true;
                    }
                }
                if (closed) break;
            }
            if (closed) continue;
        }
        if (options.mode == Options::Mode::Recover) {
            static const char* const kLinePrefixes[] = {"unrecognised line: ", "cannot parse: ", "unknown element in: ", "unknown service in: ", "an edge is `a:R -- L:b`: "};
            bool dropped = false;
            for (const char* p : kLinePrefixes) {
                if (!starts_with(error, p)) continue;
                std::string line = error.substr(std::char_traits<char>::length(p));
                if (drop_line(source, line)) {
                    notes.push_back("skipped `" + line + "`");
                    dropped = true;
                }
                break;
            }
            if (dropped) {
                tried_close = false;
                continue;
            }
        }
        return false;
    }
    return false;
}

namespace {

struct Preset {
    const char* name;
    const char* fg;
    const char* bg;
    const char* border;
    const char* surface;
    const char* accent;  // empty: derived from fg and bg
    const char* line;
    // the rest only for the themes that follow the official Mermaid colours; empty: derived
    const char* arrow = "";
    const char* group_fill = "";
    const char* group_header = "";
    const char* label_fill = "";
    const char* note_fill = "";
    const char* note_border = "";
    const char* note_text = "";
    const char* scale = "";
    const char* scale_stroke = "";
    const char* plot = "";
    const char* muted = "";  // secondary text; the official themes use the text colour
    const char* composite_fill = "";
    const char* composite_header = "";
    const char* actor_border = "";
    const char* domains = "";
    const char* evolution = "";
    const char* component_fill = "";
    const char* cliff = "";
    const char* label_color = "";
};

const Preset kPresets[] = {
    // light, dark, forest and neutral are the official default, dark, forest and neutral themes, measured from
    // the colours mermaid 12.2 draws (see doc/design/mermaid-theme-parity.md); the others are this engine's own.
    {"light", "#333333", "#ffffff", "#9370db", "#ececff", "", "#333333", "#333333", "#ffffde", "#ffffde", "#f4f4f4", "#fff5ad", "#aaaa33", "#000000", "#ececff,#ffffde,#b5ff20,#b9b9ff,#ffff45,#d7ff86,#ff86ff,#20ffff,#ff2020,#ff20ff,#20ff90,#ff5353", "#000000", "#ececff,#8493a6,#ffc3a0,#dcdde1,#b8e994,#d1a36f,#c3cde6,#ffb6c1,#496078,#f8f3e3", "#333333", "#ffffff", "#ececff", "#9370db", "#E8F5E9,#E3F2FD,#FBE9E7,#FFF8E1,#F3E5F5", "#dc3545", "#ffffff", "#8B0000", "#131300"},
    {"dark", "#cccccc", "#333333", "#cccccc", "#1f2020", "", "#d3d3d3", "#d3d3d3", "#474949", "#474949", "#464646", "#474949", "#2f2f2f", "#b8b6b6", "#0b0000,#4d1037,#3f5258,#4f2f1b,#6e0a0a,#3b0048,#995a01,#154706,#161722,#00296f,#01629c,#cccccc", "#000000", "#3498db,#2ecc71,#e74c3c,#f1c40f,#bdc3c7,#ffffff,#34495e,#9b59b6,#1abc9c,#e67e22", "#cccccc", "#333333", "#1f2020", "#cccccc", "#1B5E20,#0D47A1,#BF360C,#F57F17,#4A148C", "#ff6b6b", "#1f2020", "#FF6B6B", "#e0dfdf"},
    {"neutral", "#000000", "#ffffff", "#d5d5d5", "#eeeeee", "", "#666666", "#666666", "#fcfcfc", "#fcfcfc", "#ffffff", "#666666", "#999999", "#ffffff", "#f4f4f4,#555555,#bbbbbb,#777777,#999999,#dddddd,#ffffff,#dddddd,#bbbbbb,#999999,#777777,#555555", "#000000", "#eeeeee,#6bb8e4,#8acb88,#c7acd6,#e8dcc2,#ffb2a8,#fff380,#7e8d91,#ffd8b1,#faf3e0", "#000000", "#ffffff", "#eeeeee", "#d4d4d4", "#E8F5E9,#E3F2FD,#FBE9E7,#FFF8E1,#F3E5F5", "#dc3545", "#ffffff", "#8B0000", "#111111"},
    {"forest", "#000000", "#ffffff", "#abb594", "#cde498", "", "#000000", "#000000", "#cdffb2", "#cdffb2", "#f4f4f4", "#fff5ad", "#6eaa49", "#000000", "#cde498,#cdffb2,#e1efc0,#8cb42f,#6aff19,#33b42f,#70d990,#d99070,#98cde4,#1a6330,#63301a,#1a4d63", "#000000", "#cde498,#ff6b6b,#a0d2db,#d7bde2,#f0f0f0,#ffc3a0,#7fd8be,#ff9a8b,#faf3e0,#fff176", "#000000", "#ffffff", "#cde498", "#a6cf47", "#C8E6C9,#DCEDC8,#FFE0B2,#FFF9C4,#D7CCC8", "#dc3545", "#ffffff", "#8B4513", "#321b67"},
    {"nord", "#eceff4", "#2e3440", "#4c566a", "#3b4252", "#88c0d0", "#81a1c1"},
    {"dracula", "#f8f8f2", "#282a36", "#44475a", "#343746", "#bd93f9", "#6272a4"},
    {"solarized-light", "#586e75", "#fdf6e3", "#d3cbb7", "#eee8d5", "#268bd2", "#93a1a1"},
    {"solarized-dark", "#93a1a1", "#002b36", "#0f4b5b", "#073642", "#2aa198", "#586e75"},
    {"rose-pine", "#e0def4", "#191724", "#403d52", "#1f1d2e", "#c4a7e7", "#6e6a86"},
    {"sepia", "#433422", "#f4ecd8", "#d6c7a1", "#ebe0c4", "#b45f06", "#8a7a5c"},
};

}  // namespace

std::vector<std::string> theme_names() {
    std::vector<std::string> out;
    for (const Preset& p : kPresets) out.push_back(p.name);
    return out;
}

bool apply_theme(const std::string& name, Options& o) {
    std::string key;
    for (char c : name) key += c == '_' ? '-' : (char)std::tolower((unsigned char)c);
    if (key == "default" || key == "base") key = "light";
    for (const Preset& p : kPresets) {
        if (key != p.name) continue;
        o.fg = p.fg;
        o.bg = p.bg;
        o.border = p.border;
        o.surface = p.surface;
        o.accent = p.accent;
        o.line = p.line;
        o.domains = p.domains;
        o.evolution = p.evolution;
        o.cliff = p.cliff;
        o.label_color = p.label_color;
        o.component_fill = p.component_fill;
        o.arrow = p.arrow;
        o.group_fill = p.group_fill;
        o.group_header = p.group_header;
        o.label_fill = p.label_fill;
        o.note_fill = p.note_fill;
        o.note_border = p.note_border;
        o.note_text = p.note_text;
        o.scale = p.scale;
        o.scale_stroke = p.scale_stroke;
        o.plot = p.plot;
        o.muted = p.muted;
        o.composite_fill = p.composite_fill;
        o.composite_header = p.composite_header;
        o.actor_border = p.actor_border;
        return true;
    }
    return false;
}

}  // namespace mermaid
