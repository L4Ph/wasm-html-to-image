#include "mermaid/sequence.h"

#include <algorithm>
#include <cctype>
#include <limits>
#include <map>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

enum class Ev { Message, Note, BlockStart, BlockElse, BlockEnd, Activate, Deactivate };

enum Head { kNone = 0, kArrow = 1, kCross = 2, kAsync = 3 };

struct Event {
    Ev kind = Ev::Message;
    int a = -1, b = -1;
    std::string text, label;
    std::string num;  // the autonumber, drawn apart from the text
    bool dashed = false;
    int head = kNone;
    int act = 0;   // +1: the message activates its target, -1: it deactivates its sender
    int side = 0;  // notes: -1 left of, 0 over, 1 right of
};

struct Participant {
    std::string id, name;
};

struct BoxGroup {
    std::string label;
    int first = 0, last = 0;  // participant indices
};

struct Doc {
    std::vector<Participant> ps;
    std::vector<Event> ev;
    std::vector<BoxGroup> boxes;
    std::vector<std::pair<int, std::string>> links;  // actor link-menu entries (participant, label)
};

std::string lower(std::string s) {
    for (auto& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

/// True when `line` starts with the word `w` (case-insensitive) followed by a space or the end.
bool word(const std::string& line, const char* w, std::string& rest) {
    size_t n = std::char_traits<char>::length(w);
    if (line.size() < n || lower(line.substr(0, n)) != w) return false;
    if (line.size() > n && line[n] != ' ' && line[n] != '\t') return false;
    rest = trim(line.substr(n));
    return true;
}

/// A leading colour (`Purple`, `rgb(1,2,3)`, `#fa0`, `transparent`) of a `box` line is dropped: the frame uses the theme.
std::string without_colour(const std::string& s) {
    static const char* names[] = {"aqua", "black", "blue", "fuchsia", "gray", "grey", "green", "lime", "maroon", "navy", "olive", "orange", "purple", "red", "silver", "teal", "white", "yellow", "pink", "transparent"};
    std::string head = lower(s.substr(0, s.find(' ')));
    if (head.compare(0, 4, "rgb(") == 0 || head.compare(0, 5, "rgba(") == 0 || head.compare(0, 4, "hsl(") == 0) {
        size_t close = s.find(')');
        return close == std::string::npos ? "" : trim(s.substr(close + 1));
    }
    bool colour = head.compare(0, 1, "#") == 0;
    for (const char* n : names)
        if (head == n) colour = true;
    if (!colour) return s;
    size_t sp = s.find(' ');
    return sp == std::string::npos ? "" : trim(s.substr(sp + 1));
}

int find_or_add(Doc& d, const std::string& id) {
    for (size_t i = 0; i < d.ps.size(); i++)
        if (d.ps[i].id == id) return (int)i;
    d.ps.push_back({id, id});
    return (int)d.ps.size() - 1;
}

struct ArrowTok {
    const char* tok;
    bool dashed;
    int head;
};
const ArrowTok kArrows[] = {{"-->>", true, kArrow}, {"->>", false, kArrow}, {"--x", true, kCross}, {"-x", false, kCross},
                            {"--)", true, kAsync},  {"-)", false, kAsync},   {"-->", true, kNone},   {"->", false, kNone}};

bool parse(const std::string& text, Doc& d, std::string& error) {
    // `sequenceDiagram; A->>B: hi` has its first statement on the header line
    std::string source = text;
    for (size_t at = 0; at < source.size();) {
        size_t e = source.find('\n', at);
        std::string head = trim(source.substr(at, e == std::string::npos ? std::string::npos : e - at));
        if (head.empty() || head.compare(0, 2, "%%") == 0) {
            if (e == std::string::npos) break;
            at = e + 1;
            continue;
        }
        size_t semi = head.find(';');
        if (head.compare(0, 15, "sequenceDiagram") == 0 && semi == 15 && !trim(head.substr(semi + 1)).empty())
            source = source.substr(0, at) + "sequenceDiagram\n" + trim(head.substr(semi + 1)) + (e == std::string::npos ? "" : source.substr(e));
        break;
    }
    bool autonumber = false, in_box = false;
    int counter = 1, step = 1, depth = 0, box_first = 0;
    std::string box_label;
    bool first = true;
    size_t i = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        std::string line = trim(source.substr(i, e == std::string::npos ? std::string::npos : e - i));
        i = e == std::string::npos ? source.size() + 1 : e + 1;
        if (!line.empty() && line.back() == ';') line = trim(line.substr(0, line.size() - 1));
        if (line.empty() || line.compare(0, 2, "%%") == 0) continue;
        if (first) {
            first = false;  // the `sequenceDiagram` line
            continue;
        }
        std::string rest;
        // `create participant X` / `create actor X as Y` declare the participant (it is drawn at the top like any other)
        if (word(line, "create", rest)) {
            std::string r2;
            if (word(rest, "participant", r2) || word(rest, "actor", r2)) line = "participant " + r2;
        }
        // `destroy X` needs no drawing; `link`/`links` feed the actor menus drawn under the actor boxes
        if (word(line, "destroy", rest)) {
            find_or_add(d, rest);
            continue;
        }
        {
            std::string lr;
            bool plural = word(line, "links", lr);
            if (plural || word(line, "link", lr)) {  // `link A: Label @ url`, or `links A: {"Label": "url", ...}`
                size_t colon = lr.find(':');
                int pi = find_or_add(d, trim(lr.substr(0, colon)));
                std::string tail = colon == std::string::npos ? "" : trim(lr.substr(colon + 1));
                if (plural) {  // the JSON form: every quoted key is a menu label
                    for (size_t q = tail.find('"'); q != std::string::npos;) {
                        size_t q2 = tail.find('"', q + 1);
                        if (q2 == std::string::npos) break;
                        size_t after = tail.find_first_not_of(" \t", q2 + 1);
                        if (after != std::string::npos && tail[after] == ':') {
                            std::string label = tail.substr(q + 1, q2 - q - 1);
                            if (!label.empty()) d.links.push_back({pi, label});
                        }
                        q = tail.find('"', q2 + 1);
                    }
                } else {
                    size_t at = tail.find(" @ ");
                    std::string label = trim(at == std::string::npos ? tail : tail.substr(0, at));
                    if (!label.empty()) d.links.push_back({pi, label});
                }
                continue;
            }
        }
        if (word(line, "box", rest)) {
            in_box = true;
            box_first = (int)d.ps.size();
            box_label = without_colour(rest);
            continue;
        }
        if (in_box && depth == 0 && word(line, "end", rest) && rest.empty()) {
            in_box = false;
            if ((int)d.ps.size() > box_first) d.boxes.push_back({box_label, box_first, (int)d.ps.size() - 1});
            continue;
        }
        if (word(line, "participant", rest) || word(line, "actor", rest)) {
            std::string id = rest, name = rest;
            size_t as = lower(rest).find(" as ");
            if (as != std::string::npos) {
                id = trim(rest.substr(0, as));
                name = trim(rest.substr(as + 4));
            }
            int p = find_or_add(d, id);
            d.ps[p].name = name;
            continue;
        }
        if (word(line, "autonumber", rest)) {
            autonumber = true;
            // `autonumber`, `autonumber 10`, `autonumber 10 5`: an optional start and step
            std::vector<int> args;
            for (size_t p = 0; p < rest.size();) {
                size_t sp = rest.find(' ', p);
                std::string tok = trim(rest.substr(p, sp == std::string::npos ? std::string::npos : sp - p));
                if (!tok.empty() && tok.find_first_not_of("0123456789-") == std::string::npos) args.push_back(std::stoi(tok));
                if (sp == std::string::npos) break;
                p = sp + 1;
            }
            if (!args.empty()) counter = args[0];
            if (args.size() > 1) step = args[1];
            continue;
        }
        if (word(line, "activate", rest) || word(line, "deactivate", rest)) {
            Event ev;
            ev.kind = lower(line).compare(0, 2, "de") == 0 ? Ev::Deactivate : Ev::Activate;
            ev.a = find_or_add(d, rest);
            d.ev.push_back(ev);
            continue;
        }
        if (word(line, "note", rest)) {
            Event ev;
            ev.kind = Ev::Note;
            std::string who;
            std::string l = lower(rest);
            if (l.compare(0, 8, "left of ") == 0) ev.side = -1, who = rest.substr(8);
            else if (l.compare(0, 9, "right of ") == 0) ev.side = 1, who = rest.substr(9);
            else if (l.compare(0, 5, "over ") == 0) who = rest.substr(5);
            else {
                error = "invalid note: " + line;
                return false;
            }
            size_t colon = who.find(':');
            if (colon == std::string::npos) {
                error = "a note needs ':' text: " + line;
                return false;
            }
            ev.text = trim(who.substr(colon + 1));
            who = who.substr(0, colon);
            size_t comma = who.find(',');
            ev.a = find_or_add(d, trim(who.substr(0, comma)));
            ev.b = comma == std::string::npos ? ev.a : find_or_add(d, trim(who.substr(comma + 1)));
            d.ev.push_back(ev);
            continue;
        }
        bool block = false;
        for (const char* k : {"loop", "alt", "opt", "par", "critical", "break", "rect"})
            if (word(line, k, rest)) {
                Event ev;
                ev.kind = Ev::BlockStart;
                ev.text = k;
                ev.label = rest;
                d.ev.push_back(ev);
                depth++;
                block = true;
                break;
            }
        if (block) continue;
        bool divider = false;
        for (const char* k : {"else", "and", "option"})
            if (word(line, k, rest)) {
                if (depth == 0) {
                    error = std::string("'") + k + "' outside a block";
                    return false;
                }
                Event ev;
                ev.kind = Ev::BlockElse;
                ev.label = rest;
                d.ev.push_back(ev);
                divider = true;
                break;
            }
        if (divider) continue;
        if (word(line, "end", rest) && rest.empty()) {
            if (depth == 0) {
                error = "'end' without a block";
                return false;
            }
            depth--;
            Event ev;
            ev.kind = Ev::BlockEnd;
            d.ev.push_back(ev);
            continue;
        }
        // a message: FROM <arrow> [+|-]TO : text
        size_t best = std::string::npos;
        const ArrowTok* at = nullptr;
        for (auto& a : kArrows) {
            size_t p = line.find(a.tok);
            if (p == std::string::npos) continue;
            if (best == std::string::npos || p < best || (p == best && std::char_traits<char>::length(a.tok) > std::char_traits<char>::length(at->tok))) {
                best = p;
                at = &a;
            }
        }
        if (!at || best == 0) {
            error = "unrecognised line: " + line;
            return false;
        }
        Event ev;
        ev.dashed = at->dashed;
        ev.head = at->head;
        std::string from = trim(line.substr(0, best));
        std::string right = line.substr(best + std::char_traits<char>::length(at->tok));
        size_t colon = right.find(':');
        std::string to = trim(right.substr(0, colon));
        if (colon != std::string::npos) ev.text = trim(right.substr(colon + 1));
        if (!to.empty() && to[0] == '+') ev.act = 1, to = trim(to.substr(1));
        else if (!to.empty() && to[0] == '-') ev.act = -1, to = trim(to.substr(1));
        if (from.empty() || to.empty()) {
            error = "a message needs a sender and a receiver: " + line;
            return false;
        }
        ev.a = find_or_add(d, from);
        ev.b = find_or_add(d, to);
        if (autonumber) {
            ev.num = std::to_string(counter);
            counter += step;
        }
        d.ev.push_back(ev);
    }
    while (depth-- > 0) {
        Event ev;
        ev.kind = Ev::BlockEnd;
        d.ev.push_back(ev);
    }
    return true;
}

constexpr double kMsgFont = 12;
constexpr double kBlockFont = 11;
constexpr double kBarW = 8;

std::string rect(double x, double y, double w, double h, const std::string& fill, const std::string& stroke, double rx = 0,
                 const char* extra = "") {
    return "<rect x=\"" + num(x) + "\" y=\"" + num(y) + "\" width=\"" + num(w) + "\" height=\"" + num(h) + "\" rx=\"" + num(rx) + "\" fill=\"" +
           fill + "\" stroke=\"" + stroke + "\" stroke-width=\"1\"" + extra + "/>\n";
}

std::string line_el(double x1, double y1, double x2, double y2, const std::string& stroke, double sw, const char* extra = "") {
    return "<line x1=\"" + num(x1) + "\" y1=\"" + num(y1) + "\" x2=\"" + num(x2) + "\" y2=\"" + num(y2) + "\" stroke=\"" + stroke +
           "\" stroke-width=\"" + num(sw) + "\"" + extra + "/>\n";
}

struct OpenBlock {
    std::string kind, label;
    double top = 0;
    double lx = std::numeric_limits<double>::infinity(), rx = -std::numeric_limits<double>::infinity();
    std::vector<std::pair<double, std::string>> dividers;
};

struct Bar {
    int p, level;
    double y0, y1;
};

}  // namespace

bool render_sequence(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    Doc d;
    if (!parse(source, d, error)) return false;
    if (d.ps.empty()) {
        error = "empty sequence diagram";
        return false;
    }
    Theme th = make_theme(options);
    Text tx{options};
    const size_t n = d.ps.size();
    const double lh = kMsgFont * metrics::kLineHeight;

    // participant boxes
    std::vector<std::vector<std::string>> names(n);
    std::vector<double> w(n);
    double hh = 0;
    for (size_t k = 0; k < n; k++) {
        names[k] = split_lines(d.ps[k].name);
        w[k] = std::max(70.0, tx.block_width(names[k], metrics::kNodeFont, metrics::kNodeWeight) + 2 * metrics::kPadX);
        hh = std::max(hh, names[k].size() * metrics::kNodeFont * metrics::kLineHeight + 2 * metrics::kPadY);
    }

    // the room between two lifelines grows until the labels between them fit
    std::vector<double> gap(n > 1 ? n - 1 : 0);
    for (size_t k = 0; k + 1 < n; k++) gap[k] = std::max(100.0, (w[k] + w[k + 1]) / 2 + 20);
    auto span = [&](size_t lo, size_t hi) {
        double s = 0;
        for (size_t k = lo; k < hi; k++) s += gap[k];
        return s;
    };
    for (auto& e : d.ev) {
        if (e.kind != Ev::Message && e.kind != Ev::Note) continue;
        double lw = tx.block_width(split_lines(e.text), kMsgFont, 400);
        size_t lo = (size_t)std::min(e.a, e.b), hi = (size_t)std::max(e.a, e.b);
        if (e.kind == Ev::Message) {
            if (lo == hi) {
                if (lo + 1 < n) gap[lo] = std::max(gap[lo], 40 + lw + w[lo + 1] / 2 + 10);
            } else if (span(lo, hi) < lw + 30) {
                gap[hi - 1] += lw + 30 - span(lo, hi);
            }
            continue;
        }
        double nw = std::max(60.0, lw + 20);
        if (e.side == 0 && lo != hi) {
            if (span(lo, hi) + 20 < nw) gap[hi - 1] += nw - 20 - span(lo, hi);
        } else if (e.side < 0 && lo > 0) {
            gap[lo - 1] = std::max(gap[lo - 1], nw + 10 + w[lo - 1] / 2);
        } else if (e.side > 0 && lo + 1 < n) {
            gap[lo] = std::max(gap[lo], nw + 10 + w[lo + 1] / 2);
        }
    }
    std::vector<double> cx(n, 0);
    for (size_t k = 1; k < n; k++) cx[k] = cx[k - 1] + gap[k - 1];

    double minx = std::numeric_limits<double>::infinity(), maxx = -minx;
    auto ext = [&](double a, double b) {
        minx = std::min(minx, std::min(a, b));
        maxx = std::max(maxx, std::max(a, b));
    };
    for (size_t k = 0; k < n; k++) ext(cx[k] - w[k] / 2, cx[k] + w[k] / 2);

    std::string frames, msgs;
    std::vector<OpenBlock> blocks;
    std::vector<std::vector<double>> open(n);  // start y of each running activation
    std::vector<Bar> bars;
    auto touch = [&](double a, double b) {
        ext(a, b);
        if (!blocks.empty()) {
            blocks.back().lx = std::min(blocks.back().lx, a - 20);
            blocks.back().rx = std::max(blocks.back().rx, b + 20);
        }
    };
    auto activate = [&](int p, double y) { open[p].push_back(y); };
    auto deactivate = [&](int p, double y) {
        if (open[p].empty()) return;
        bars.push_back({p, (int)open[p].size() - 1, open[p].back(), y});
        open[p].pop_back();
    };

    const double box_top = d.boxes.empty() ? 0 : 26;  // room above the headers for the box titles
    double y = hh + 24;
    for (auto& e : d.ev) {
        switch (e.kind) {
            case Ev::Activate: activate(e.a, y - 14); break;
            case Ev::Deactivate: deactivate(e.a, y - 14); break;
            case Ev::Message: {
                auto lines = split_lines(e.text);
                double labelh = lines.size() * lh;
                std::string dash = e.dashed ? " stroke-dasharray=\"6 4\"" : "";
                double yline;
                if (e.a == e.b) {
                    double x = cx[e.a], top = y + 8, bottom = top + 22, lw = tx.block_width(lines, kMsgFont, 400);
                    touch(x, x + 40 + lw);
                    msgs += "<polyline class=\"message\" points=\"" + num(x) + "," + num(top) + " " + num(x + 30) + "," + num(top) + " " + num(x + 30) + "," +
                            num(bottom) + " " + num(x + 7) + "," + num(bottom) + "\" fill=\"none\" stroke=\"" + th.line + "\" stroke-width=\"1.5\"" +
                            dash + "/>\n";
                    msgs += "<polygon points=\"" + num(x) + "," + num(bottom) + " " + num(x + 8) + "," + num(bottom - 4) + " " + num(x + 8) +
                            "," + num(bottom + 4) + "\" fill=\"" + th.arrow + "\"/>\n";
                    aligned_text(msgs, th, lines, x + 38, top + 11, kMsgFont, 400, th.text, "start");
                    yline = bottom;
                    y = bottom + 14 + std::max(0.0, labelh - 22);
                } else {
                    double x1 = cx[e.a], x2 = cx[e.b], dir = x2 > x1 ? 1 : -1;
                    yline = y + labelh + 8;
                    touch(std::min(x1, x2), std::max(x1, x2));
                    double stop = e.head == kArrow ? x2 - dir * metrics::kArrowW : x2;
                    msgs += line_el(x1, yline, stop, yline, th.line, 1.5, (" class=\"message\"" + dash).c_str());
                    if (e.head == kArrow) {
                        msgs += "<polygon points=\"" + num(x2) + "," + num(yline) + " " + num(x2 - dir * metrics::kArrowW) + "," +
                                num(yline - metrics::kArrowH) + " " + num(x2 - dir * metrics::kArrowW) + "," + num(yline + metrics::kArrowH) +
                                "\" fill=\"" + th.arrow + "\"/>\n";
                    } else if (e.head == kCross) {
                        msgs += line_el(x2 - 5, yline - 5, x2 + 5, yline + 5, th.arrow, 1.5);
                        msgs += line_el(x2 - 5, yline + 5, x2 + 5, yline - 5, th.arrow, 1.5);
                    } else if (e.head == kAsync) {
                        msgs += "<polyline points=\"" + num(x2 - dir * 8) + "," + num(yline - 5) + " " + num(x2) + "," + num(yline) + " " +
                                num(x2 - dir * 8) + "," + num(yline + 5) + "\" fill=\"none\" stroke=\"" + th.arrow + "\" stroke-width=\"1.5\"/>\n";
                    }
                    centered_text(msgs, th, lines, (x1 + x2) / 2, y + labelh / 2 + 2, kMsgFont, 400, th.text);
                    y = yline + 14;
                }
                if (!e.num.empty())  // the sequence number sits under the line, on the sender's lifeline
                    centered_text(msgs, th, {e.num}, cx[e.a], yline + 10, kMsgFont, 400, th.text);
                if (e.act > 0) activate(e.b, yline);
                else if (e.act < 0) deactivate(e.a, yline);
                break;
            }
            case Ev::Note: {
                auto lines = split_lines(e.text);
                double lw = tx.block_width(lines, kMsgFont, 400), nw = std::max(60.0, lw + 20), nh = lines.size() * lh + 12;
                size_t lo = (size_t)std::min(e.a, e.b), hi = (size_t)std::max(e.a, e.b);
                double x0, x1;
                if (e.side < 0) x1 = cx[lo] - 10, x0 = x1 - nw;
                else if (e.side > 0) x0 = cx[lo] + 10, x1 = x0 + nw;
                else if (lo == hi) x0 = cx[lo] - nw / 2, x1 = x0 + nw;
                else x0 = std::min(cx[lo] - 10, (cx[lo] + cx[hi]) / 2 - nw / 2), x1 = std::max(cx[hi] + 10, (cx[lo] + cx[hi]) / 2 + nw / 2);
                touch(x0, x1);
                msgs += rect(x0, y, x1 - x0, nh, th.note_fill, th.note_border, 2);
                centered_text(msgs, th, lines, (x0 + x1) / 2, y + nh / 2, kMsgFont, 400, th.note_text);
                y += nh + 10;
                break;
            }
            case Ev::BlockStart: {
                OpenBlock b;
                b.kind = e.text;
                b.label = e.label;
                b.top = y;
                blocks.push_back(b);
                y += 28;
                break;
            }
            case Ev::BlockElse:
                if (!blocks.empty()) {
                    blocks.back().dividers.push_back({y, e.label});
                    y += 26;
                }
                break;
            case Ev::BlockEnd: {
                if (blocks.empty()) break;
                OpenBlock b = blocks.back();
                blocks.pop_back();
                if (b.lx > b.rx) b.lx = cx[0] - 20, b.rx = cx[n - 1] + 20;
                y += 4;
                ext(b.lx, b.rx);
                if (!blocks.empty()) {
                    blocks.back().lx = std::min(blocks.back().lx, b.lx - 8);
                    blocks.back().rx = std::max(blocks.back().rx, b.rx + 8);
                }
                if (b.kind == "rect") {
                    y += 6;
                    break;
                }
                frames += rect(b.lx, b.top, b.rx - b.lx, y - b.top, "none", th.border, 2);
                double tagw = std::max(40.0, tx.width(b.kind, kBlockFont, 600) + 16);
                frames += rect(b.lx, b.top, tagw, 20, th.group_hdr, th.border, 2);
                centered_text(frames, th, {b.kind}, b.lx + tagw / 2, b.top + 10, kBlockFont, 600, th.text);
                if (!b.label.empty()) aligned_text(frames, th, {"[" + b.label + "]"}, b.lx + tagw + 10, b.top + 10, kBlockFont, 400, th.text_sec, "start");
                for (auto& dv : b.dividers) {
                    frames += line_el(b.lx, dv.first, b.rx, dv.first, th.border, 1, " stroke-dasharray=\"5 4\"");
                    if (!dv.second.empty())
                        centered_text(frames, th, {"[" + dv.second + "]"}, (b.lx + b.rx) / 2, dv.first + 13, kBlockFont, 400, th.text_sec);
                }
                y += 10;
                break;
            }
        }
    }
    double bottom = y + 10;
    for (size_t k = 0; k < n; k++)
        while (!open[k].empty()) deactivate((int)k, bottom);

    std::string lifelines, bars_svg, boxes;
    for (size_t k = 0; k < n; k++) {
        lifelines += line_el(cx[k], hh, cx[k], bottom, th.border, 1, " class=\"lifeline\" stroke-dasharray=\"4 4\"");
        for (double top : {0.0, bottom}) {
            boxes += rect(cx[k] - w[k] / 2, top, w[k], hh, th.surface, th.actor_border, 4);
            centered_text(boxes, th, names[k], cx[k], top + hh / 2, metrics::kNodeFont, metrics::kNodeWeight, th.text);
        }
    }
    for (auto& b : bars) bars_svg += rect(cx[b.p] - kBarW / 2 + b.level * 4, b.y0, kBarW, std::max(4.0, b.y1 - b.y0), th.group_hdr, th.border);

    const double margin = 24;
    std::string groups;
    for (const BoxGroup& b : d.boxes) {
        double x0 = cx[b.first] - w[b.first] / 2 - 10, x1 = cx[b.last] + w[b.last] / 2 + 10;
        // a frame wide enough for its title, grown on both sides
        if (!b.label.empty()) {
            const double need = std::ceil(tx.block_width({b.label}, metrics::kNodeFont, 600)) + 24;
            if (x1 - x0 < need) x0 -= (need - (x1 - x0)) / 2, x1 = x0 + need;
        }
        ext(x0, x1);
        groups += rect(x0, -box_top, x1 - x0, bottom + hh + box_top + 8, mix(th.fg, th.bg, 5), th.border, 6);
        if (!b.label.empty()) centered_text(groups, th, {b.label}, (x0 + x1) / 2, -box_top / 2 - 2, metrics::kNodeFont, 600, th.text);
    }
    std::string menus;  // actor link menus hang under the top actor boxes, over the messages, as Mermaid draws them
    {
        std::map<int, int> row;
        for (auto& [pi, label] : d.links)
            aligned_text(menus, th, {label}, cx[pi] - w[pi] / 2, hh + 40 + row[pi]++ * 17, 14, 400, th.text, "start");
    }
    std::string body = "<g transform=\"translate(" + num(margin - minx) + "," + num(margin + box_top) + ")\">\n" + groups + lifelines + frames + bars_svg + msgs + boxes + menus + "</g>\n";
    svg = svg_document(th, maxx - minx + 2 * margin, bottom + hh + 2 * margin + box_top + (d.boxes.empty() ? 0 : 8), body);
    return true;
}

}  // namespace mermaid
