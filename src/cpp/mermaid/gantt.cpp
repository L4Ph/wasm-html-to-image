#include "mermaid/gantt.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <map>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

struct Task {
    std::string name, id, section;
    bool done = false, active = false, crit = false, milestone = false;
    bool vert = false;  // a vertical marker at its start date, not a row
    // as written: a start date, "after ids", or nothing (the previous task's end); a duration or an end date
    bool has_start = false, has_end = false;
    double start = 0, end = 0, duration = 1;
    std::vector<std::string> after;
    std::string until;  // `until id`: the end is the start of that task
};

struct Chart {
    std::string title, axis_format = "%Y-%m-%d";
    std::vector<Task> tasks;
    std::vector<std::string> sections;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

/// Days since 1970-01-01 of a civil date (proleptic Gregorian).
double days_from_civil(int y, int m, int d) {
    y -= m <= 2;
    int era = (y >= 0 ? y : y - 399) / 400;
    int yoe = y - era * 400;
    int doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + doe - 719468;
}

void civil_from_days(double z, int& y, int& m, int& d) {
    long zz = (long)std::floor(z) + 719468;
    long era = (zz >= 0 ? zz : zz - 146096) / 146097;
    long doe = zz - era * 146097;
    long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    y = (int)(yoe + era * 400);
    long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    long mp = (5 * doy + 2) / 153;
    d = (int)(doy - (153 * mp + 2) / 5 + 1);
    m = (int)(mp < 10 ? mp + 3 : mp - 9);
    y += m <= 2;
}

/// `YYYY-MM-DD`
bool parse_date(const std::string& s, double& out) {
    int y, m, d;
    char rest;
    if (std::sscanf(s.c_str(), "%d-%d-%d%c", &y, &m, &d, &rest) != 3 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    out = days_from_civil(y, m, d);
    return true;
}

/// `30d`, `2w`, `12h`, `1M`, `1y` in days.
bool parse_duration(const std::string& s, double& out) {
    char* end;
    double v = std::strtod(s.c_str(), &end);
    if (end == s.c_str() || *end == 0 || *(end + 1) != 0) return false;
    switch (*end) {
        case 'd': out = v; return true;
        case 'w': out = v * 7; return true;
        case 'h': out = v / 24; return true;
        case 'M': out = v * 30; return true;
        case 'y': out = v * 365; return true;
        default: return false;
    }
}

std::vector<std::string> split_commas(const std::string& s) {
    std::vector<std::string> out;
    std::string cur;
    for (char c : s) {
        if (c == ',') out.push_back(trim(cur)), cur.clear();
        else cur += c;
    }
    out.push_back(trim(cur));
    return out;
}

bool parse(const std::string& source, Chart& c, std::string& error) {
    bool first = true;
    std::string section;
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
        if (starts(line, "title ")) c.title = trim(line.substr(6));
        else if (starts(line, "dateFormat") || starts(line, "excludes") || starts(line, "includes") || starts(line, "todayMarker") || starts(line, "tickInterval") ||
                 starts(line, "weekday") || starts(line, "inclusiveEndDates") || starts(line, "topAxis") || starts(line, "click ") || starts(line, "accTitle") ||
                 starts(line, "accDescr")) {
            continue;
        } else if (starts(line, "axisFormat ")) c.axis_format = trim(line.substr(11));
        else if (starts(line, "section ")) {
            section = trim(line.substr(8));
            c.sections.push_back(section);
        } else {
            size_t colon = line.find(':');
            if (colon == std::string::npos) {
                error = "unrecognised line: " + line;
                return false;
            }
            Task t;
            t.name = trim(line.substr(0, colon));
            t.section = section;
            auto parts = split_commas(line.substr(colon + 1));
            // tags first, then an optional id, then the start, then the length
            size_t k = 0;
            for (; k < parts.size(); k++) {
                const std::string& p = parts[k];
                if (p == "done") t.done = true;
                else if (p == "active") t.active = true;
                else if (p == "crit") t.crit = true;
                else if (p == "milestone") t.milestone = true;
                else if (p == "vert") t.vert = true;
                else break;
            }
            std::vector<std::string> rest(parts.begin() + k, parts.end());
            double v;
            // an id is a leading item that is neither a date, an `after` clause nor a duration
            if (rest.size() >= 2 && !parse_date(rest[0], v) && !starts(rest[0], "after ") && !parse_duration(rest[0], v)) {
                t.id = rest[0];
                rest.erase(rest.begin());
            }
            if (rest.empty()) {
                error = "a task needs a length: " + line;
                return false;
            }
            size_t at = 0;
            if (rest.size() >= 2) {
                if (parse_date(rest[0], v)) t.has_start = true, t.start = v;
                else if (starts(rest[0], "after ")) {
                    std::string ids = trim(rest[0].substr(6));
                    size_t p = 0;
                    while (p < ids.size()) {
                        size_t sp = ids.find(' ', p);
                        t.after.push_back(ids.substr(p, sp == std::string::npos ? std::string::npos : sp - p));
                        if (sp == std::string::npos) break;
                        p = sp + 1;
                    }
                } else {
                    error = "cannot read the start of a task: " + rest[0];
                    return false;
                }
                at = 1;
            }
            if (parse_date(rest[at], v)) t.has_end = true, t.end = v;
            else if (starts(rest[at], "until ")) t.until = trim(rest[at].substr(6));
            else if (!parse_duration(rest[at], t.duration)) {
                error = "cannot read the length of a task: " + rest[at];
                return false;
            }
            c.tasks.push_back(t);
        }
    }
    if (c.tasks.empty()) {
        error = "a gantt chart needs at least one task";
        return false;
    }
    return true;
}

/// `%Y`, `%y`, `%m`, `%d`, `%b`, `%e` of a day number.
std::string format_date(double day, const std::string& fmt) {
    static const char* kMonths[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    int y, m, d;
    civil_from_days(day, y, m, d);
    std::string out;
    char buf[16];
    for (size_t i = 0; i < fmt.size(); i++) {
        if (fmt[i] != '%' || i + 1 >= fmt.size()) {
            out += fmt[i];
            continue;
        }
        char f = fmt[++i];
        if (f == 'Y') std::snprintf(buf, sizeof(buf), "%04d", y), out += buf;
        else if (f == 'y') std::snprintf(buf, sizeof(buf), "%02d", y % 100), out += buf;
        else if (f == 'm') std::snprintf(buf, sizeof(buf), "%02d", m), out += buf;
        else if (f == 'd') std::snprintf(buf, sizeof(buf), "%02d", d), out += buf;
        else if (f == 'e') std::snprintf(buf, sizeof(buf), "%d", d), out += buf;
        else if (f == 'b') out += kMonths[m - 1];
        else out += std::string("%") + f;
    }
    return out;
}

}  // namespace

bool render_gantt(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    Chart c;
    if (!parse(source, c, error)) return false;

    // resolve starts and ends in order: `after x` takes the latest end of x, nothing takes the previous task's end
    std::map<std::string, size_t> by_id;
    double prev_end = 0;
    bool have_prev = false;
    for (size_t k = 0; k < c.tasks.size(); k++) {
        Task& t = c.tasks[k];
        if (!t.has_start) {
            double s = 0;
            bool found = false;
            for (auto& id : t.after) {
                auto it = by_id.find(id);
                if (it == by_id.end()) {
                    error = "unknown task id: " + id;
                    return false;
                }
                s = found ? std::max(s, c.tasks[it->second].end) : c.tasks[it->second].end;
                found = true;
            }
            if (!found) {
                if (!have_prev) {
                    error = "the first task needs a start date";
                    return false;
                }
                s = prev_end;
            }
            t.start = s;
        }
        if (!t.has_end) t.end = t.start + t.duration;
        if (t.end < t.start) t.end = t.start;
        if (!t.id.empty()) by_id[t.id] = k;
        prev_end = t.end;
        have_prev = true;
    }

    for (Task& t : c.tasks) {
        if (t.until.empty()) continue;
        auto it = by_id.find(t.until);
        if (it == by_id.end()) {
            error = "unknown task id: " + t.until;
            return false;
        }
        t.end = std::max(t.start, c.tasks[it->second].start);
    }

    Theme th = make_theme(options);
    Text text{options};
    double lo = c.tasks[0].start, hi = c.tasks[0].end;
    for (auto& t : c.tasks) lo = std::min(lo, t.start), hi = std::max(hi, std::max(t.end, t.start + (t.milestone ? 1 : 0)));
    if (hi - lo < 1) hi = lo + 1;

    constexpr double kRow = 30, kFont = 12, kBar = 18, kChartW = 560, kPad = 20;
    double name_w = 0;
    for (auto& t : c.tasks) name_w = std::max(name_w, text.width(t.name, kFont, 400));
    for (auto& s : c.sections) name_w = std::max(name_w, text.width(s, kFont, 600));
    double left = kPad + std::min(name_w, 220.0) + 16;
    double top = (c.title.empty() ? kPad : kPad + 30) + 22;
    // one row per task, plus a header row at the start of each section
    size_t rows = c.tasks.size();
    std::string last_section = "\x01";
    bool any_vert = false;
    for (auto& t : c.tasks) {
        if (t.vert) {
            rows--, any_vert = true;
            continue;
        }
        if (t.section != last_section) {
            if (!t.section.empty()) rows++;
            last_section = t.section;
        }
    }
    double H = top + rows * kRow + kPad + (any_vert ? 14 : 0);
    double W = left + kChartW + kPad;
    auto X = [&](double day) { return left + kChartW * (day - lo) / (hi - lo); };

    std::string body;
    if (!c.title.empty()) centered_text(body, th, {c.title}, W / 2, kPad + 6, 15, 600, th.text);

    // ticks
    static const double kSteps[] = {1, 2, 5, 7, 14, 30, 60, 90, 180, 365, 730};
    double step = 730;
    for (double s : kSteps)
        if ((hi - lo) / s <= 10) {
            step = s;
            break;
        }
    std::string grid, labels;
    for (double d = lo; d <= hi + 1e-9; d += step) {
        grid += "<line x1=\"" + num(X(d)) + "\" y1=\"" + num(top - 6) + "\" x2=\"" + num(X(d)) + "\" y2=\"" + num(H - kPad) + "\" stroke=\"" + th.inner_stroke + "\" stroke-width=\"1\"/>\n";
        centered_text(labels, th, {format_date(d, c.axis_format)}, X(d), top - 14, 10.5, 400, th.text_sec);
    }

    std::string bands, bars, names;
    double y = top;
    last_section = "\x01";
    size_t band = 0;
    const std::string normal = mix(th.fg, th.bg, 45), done_fill = mix(th.fg, th.bg, 18);
    std::string markers;
    for (auto& t : c.tasks) {
        if (t.vert) {  // a dashed line down the chart, its name under it
            double x = X(t.start);
            markers += "<line class=\"marker\" x1=\"" + num(x) + "\" y1=\"" + num(top - 6) + "\" x2=\"" + num(x) + "\" y2=\"" + num(H - kPad) + "\" stroke=\"" + th.accent +
                       "\" stroke-width=\"1.5\" stroke-dasharray=\"4 3\"/>\n";
            centered_text(markers, th, {t.name}, x, H - kPad + 10, 10.5, 600, th.text);
            continue;
        }
        if (t.section != last_section) {
            last_section = t.section;
            if (!t.section.empty()) {
                bands += "<rect x=\"" + num(kPad) + "\" y=\"" + num(y) + "\" width=\"" + num(W - 2 * kPad) + "\" height=\"" + num(kRow) + "\" fill=\"" + th.group_hdr + "\"/>\n";
                aligned_text(names, th, {t.section}, kPad + 6, y + kRow / 2, kFont, 600, th.text, "start");
                y += kRow;
                band = 0;
            }
        }
        if (band++ % 2 == 1) bands += "<rect x=\"" + num(kPad) + "\" y=\"" + num(y) + "\" width=\"" + num(W - 2 * kPad) + "\" height=\"" + num(kRow) + "\" fill=\"" + th.group_hdr + "\" fill-opacity=\"0.5\"/>\n";
        double cy = y + kRow / 2;
        aligned_text(names, th, {t.name}, left - 12, cy, kFont, 400, th.text, "end");
        std::string fill = t.crit ? "#e5484d" : t.done ? done_fill : t.active ? th.accent : normal;
        std::string stroke = t.crit ? "#b3261e" : th.border;
        if (t.milestone) {
            double x = X(t.start);
            bars += "<polygon points=\"" + num(x) + "," + num(cy - 10) + " " + num(x + 10) + "," + num(cy) + " " + num(x) + "," + num(cy + 10) + " " + num(x - 10) + "," + num(cy) + "\" fill=\"" +
                    fill + "\" stroke=\"" + stroke + "\" stroke-width=\"1\"/>\n";
        } else {
            double x0 = X(t.start), w = std::max(3.0, X(t.end) - x0);
            bars += "<rect class=\"task\" x=\"" + num(x0) + "\" y=\"" + num(cy - kBar / 2) + "\" width=\"" + num(w) + "\" height=\"" + num(kBar) + "\" rx=\"3\" fill=\"" + fill + "\" stroke=\"" + stroke +
                    "\" stroke-width=\"1\"/>\n";
        }
        y += kRow;
    }
    // the chart's own frame
    body += bands + grid + labels + bars + markers + names;
    svg = svg_document(th, W, H, body);
    return true;
}

}  // namespace mermaid
