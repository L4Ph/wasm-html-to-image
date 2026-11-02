#include "mermaid/pie.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

constexpr double kPi = 3.14159265358979323846;

using litehtml::svgutil::trim;

struct Slice {
    std::string label;
    double value;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

std::string unquote(std::string s) {
    s = trim(s);
    if (s.size() >= 2 && s.front() == '"' && s.back() == '"') s = s.substr(1, s.size() - 2);
    return s;
}

/// The percentage as text: rounded to a whole number, as Mermaid draws it.
std::string percent(double v) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.0f", v);
    return std::string(buf) + "%";
}

}  // namespace

bool render_pie(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    std::string title;
    bool show_data = false, first = true;
    std::vector<Slice> slices;
    size_t i = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        std::string line = trim(source.substr(i, e == std::string::npos ? std::string::npos : e - i));
        i = e == std::string::npos ? source.size() + 1 : e + 1;
        if (line.empty() || starts(line, "%%")) continue;
        if (first) {
            first = false;
            show_data = line.find("showData") != std::string::npos;
            size_t t = line.find("title ");  // `pie title Pets`
            if (t != std::string::npos) title = trim(line.substr(t + 6));
            continue;
        }
        if (starts(line, "title ") || line == "title") {
            title = trim(line.substr(5));
            continue;
        }
        if (line == "showData") {
            show_data = true;
            continue;
        }
        size_t colon = line.rfind(':');
        if (colon == std::string::npos) {
            error = "unrecognised line: " + line;
            return false;
        }
        std::string num_text = trim(line.substr(colon + 1));
        char* end;
        double v = std::strtod(num_text.c_str(), &end);
        if (num_text.empty() || *end != 0 || v < 0) {
            error = "not a positive number: " + num_text;
            return false;
        }
        slices.push_back({unquote(line.substr(0, colon)), v});
    }
    double total = 0;
    for (auto& s : slices) total += s.value;
    if (slices.empty() || total <= 0) {
        error = "a pie chart needs at least one slice with a value";
        return false;
    }

    Theme th = make_theme(options);
    Text text{options};
    const double R = 110, pad = 24, kLegend = 12, kRow = 22;
    double legend_w = 0;
    std::vector<std::string> legend;
    for (auto& s : slices) {
        std::string l = s.label + (show_data ? " [" + num(s.value) + "]" : "");
        legend_w = std::max(legend_w, text.width(l, kLegend, 400));
        legend.push_back(l);
    }
    double top = title.empty() ? pad : pad + 30;
    double cx = pad + R, cy = top + R;
    double lx = cx + R + 36;
    double W = std::max(lx + 18 + legend_w + pad, 2 * pad + 2 * R + (title.empty() ? 0.0 : text.width(title, 15, 600)));
    double H = top + 2 * R + pad;
    H = std::max(H, top + slices.size() * kRow + pad);

    const bool scaled = !th.scale.empty();  // the official look: translucent slices on a scale of colours
    auto shade = [&](size_t k) {
        if (scaled) return th.scale[k % th.scale.size()];
        size_t n = slices.size();
        int pct = n <= 1 ? 80 : 88 - (int)(70.0 * k / (n - 1));
        return mix(th.fg, th.bg, pct);
    };
    std::string body;
    if (!title.empty()) centered_text(body, th, {title}, W / 2, pad + 6, 15, 600, th.text);
    double angle = -kPi / 2;
    for (size_t k = 0; k < slices.size(); k++) {
        double frac = slices[k].value / total, a1 = angle + frac * 2 * kPi;
        std::string fill = shade(k);
        if (frac >= 0.9999) {
            body += "<circle cx=\"" + num(cx) + "\" cy=\"" + num(cy) + "\" r=\"" + num(R) + "\" fill=\"" + fill + "\"" + (scaled ? " fill-opacity=\"0.7\"" : "") + " stroke=\"" + th.scale_stroke + "\" stroke-width=\"2\"/>\n";
        } else if (frac > 0) {
            double x0 = cx + R * std::cos(angle), y0 = cy + R * std::sin(angle), x1 = cx + R * std::cos(a1), y1 = cy + R * std::sin(a1);
            body += "<path class=\"slice\" d=\"M" + num(cx) + "," + num(cy) + " L" + num(x0) + "," + num(y0) + " A" + num(R) + "," + num(R) + " 0 " + (frac > 0.5 ? "1" : "0") + " 1 " +
                    num(x1) + "," + num(y1) + " Z\" fill=\"" + fill + "\"" + (scaled ? " fill-opacity=\"0.7\"" : "") + " stroke=\"" + th.scale_stroke + "\" stroke-width=\"2\" stroke-linejoin=\"round\"/>\n";
        }
        if (frac > 0) {  // every slice is labelled, however thin, as Mermaid draws it
            double mid = (angle + a1) / 2;
            int pct_shade = slices.size() <= 1 ? 80 : 88 - (int)(70.0 * k / (slices.size() - 1));
            centered_text(body, th, {percent(frac * 100)}, cx + R * 0.66 * std::cos(mid), cy + R * 0.66 * std::sin(mid), 11, 600, scaled ? th.text : pct_shade > 50 ? th.bg : th.fg);
        }
        angle = a1;
    }
    if (scaled) body += "<circle cx=\"" + num(cx) + "\" cy=\"" + num(cy) + "\" r=\"" + num(R + 1) + "\" fill=\"none\" stroke=\"" + th.scale_stroke + "\" stroke-width=\"2\"/>\n";
    for (size_t k = 0; k < slices.size(); k++) {
        double y = top + 8 + k * kRow;
        body += "<rect x=\"" + num(lx) + "\" y=\"" + num(y) + "\" width=\"12\" height=\"12\" rx=\"2\" fill=\"" + shade(k) + "\" stroke=\"" + (scaled ? shade(k) : th.border) + "\" stroke-width=\"1\"/>\n";
        aligned_text(body, th, {legend[k]}, lx + 20, y + 6, kLegend, 400, th.text, "start");
    }
    svg = svg_document(th, W, H, body);
    return true;
}

}  // namespace mermaid
