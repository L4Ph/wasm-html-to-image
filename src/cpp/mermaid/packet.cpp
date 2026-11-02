#include "mermaid/packet.h"

#include <algorithm>
#include <cstdlib>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

struct Field {
    int start, end;  // inclusive bit numbers
    std::string label;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

}  // namespace

bool render_packet(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    using namespace metrics;
    std::string title;
    std::vector<Field> fields;
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
        if (starts(line, "title ")) {
            title = trim(line.substr(6));
            continue;
        }
        size_t colon = line.find(':');
        if (colon == std::string::npos) {
            error = "a field is `start-end: \"label\"`: " + line;
            return false;
        }
        std::string range = trim(line.substr(0, colon)), label = trim(line.substr(colon + 1));
        if (label.size() >= 2 && label.front() == '"' && label.back() == '"') label = label.substr(1, label.size() - 2);
        if (!range.empty() && range[0] == '+') {  // `+16: "label"`: the next 16 bits
            char* end;
            long width = std::strtol(range.c_str() + 1, &end, 10);
            if (end == range.c_str() + 1 || *end != 0 || width < 1) {
                error = "`+n` takes a number of bits above zero: " + line;
                return false;
            }
            int from = fields.empty() ? 0 : fields.back().end + 1;
            fields.push_back({from, from + (int)width - 1, label});
            continue;
        }
        size_t dash = range.find('-');
        char *e1, *e2;
        long a = std::strtol(range.c_str(), &e1, 10), b = dash == std::string::npos ? a : std::strtol(range.c_str() + dash + 1, &e2, 10);
        bool ok = e1 != range.c_str() && (dash == std::string::npos ? *e1 == 0 : (e1 == range.c_str() + dash && *e2 == 0 && e2 != range.c_str() + dash + 1));
        if (!ok || a < 0 || b < a) {
            error = "the bits of a field are `n` or `start-end`: " + line;
            return false;
        }
        int expected = fields.empty() ? 0 : fields.back().end + 1;
        if (a != expected) {
            error = "fields must follow each other without gaps: bit " + std::to_string(expected) + " comes next, not " + std::to_string(a);
            return false;
        }
        fields.push_back({(int)a, (int)b, label});
    }
    if (fields.empty()) {
        error = "a packet needs at least one field";
        return false;
    }

    Theme th = make_theme(options);
    Text text{options};
    const int kBits = 32;
    const double kBitW = 18, kRowH = 40, kNumH = 16;
    double left = kMargin, top = kMargin + (title.empty() ? 0 : 30);
    int last_bit = fields.back().end;
    int rows = last_bit / kBits + 1;
    double W = left + kBits * kBitW + kMargin, H = top + rows * (kRowH + kNumH) + kMargin;
    std::string body;
    if (!title.empty()) centered_text(body, th, {title}, W / 2, kMargin, 16, 600, th.text);
    static const char* kTints[] = {"#4e79a7", "#f28e2b", "#59a14f", "#b07aa1", "#76b7b2", "#e15759"};
    for (size_t f = 0; f < fields.size(); f++) {
        // a field that crosses the end of a row continues on the next one
        int a = fields[f].start;
        while (a <= fields[f].end) {
            int row = a / kBits, b = std::min(fields[f].end, (row + 1) * kBits - 1);
            double x = left + (a % kBits) * kBitW, w = (b - a + 1) * kBitW, y = top + row * (kRowH + kNumH) + kNumH;
            body += "<g class=\"field\">\n<rect x=\"" + num(x) + "\" y=\"" + num(y) + "\" width=\"" + num(w) + "\" height=\"" + num(kRowH) + "\" fill=\"" + mix(kTints[f % 6], th.bg, 18) + "\" stroke=\"" +
                    kTints[f % 6] + "\" stroke-width=\"1\"/>\n";
            // the label is drawn whole, as Mermaid draws it: a field too narrow for it lets it spill, not truncate
            centered_text(body, th, {fields[f].label}, x + w / 2, y + kRowH / 2, 12, 500, th.text);
            body += "</g>\n";
            // the first and last bit number of this piece
            aligned_text(body, th, {std::to_string(a)}, x + 1, y - 8, 9.5, 400, th.text_sec, "start");
            if (b != a) aligned_text(body, th, {std::to_string(b)}, x + w - 1, y - 8, 9.5, 400, th.text_sec, "end");
            a = b + 1;
        }
    }
    svg = svg_document(th, W, H, body);
    return true;
}

}  // namespace mermaid
