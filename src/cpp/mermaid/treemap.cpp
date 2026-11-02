#include "mermaid/treemap.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <memory>

#include "mermaid/mermaid_internal.h"

namespace mermaid {
namespace {

using litehtml::svgutil::trim;

struct Item {
    std::string name;
    double value = 0;  // leaves: given; sections: the sum of the children
    bool leaf = false;
    int indent = 0;
    int branch = 0;  // index of the top level section it sits in
    std::vector<std::unique_ptr<Item>> kids;
    double x = 0, y = 0, w = 0, h = 0;
};

bool starts(const std::string& s, const char* p) { return s.compare(0, std::char_traits<char>::length(p), p) == 0; }

std::string unquote(std::string s) {
    s = trim(s);
    if (s.size() >= 2 && ((s.front() == '"' && s.back() == '"') || (s.front() == '\'' && s.back() == '\''))) s = s.substr(1, s.size() - 2);
    return s;
}

double total_of(Item& it) {
    if (it.leaf) return it.value;
    it.value = 0;
    for (auto& k : it.kids) it.value += total_of(*k);
    return it.value;
}

// Squarified layout of @p items (sorted by value, largest first) into the box.
void squarify(std::vector<Item*>& items, double x, double y, double w, double h) {
    double total = 0;
    for (Item* it : items) total += it->value;
    if (total <= 0 || w <= 0 || h <= 0) return;
    double scale = w * h / total;
    size_t start = 0;
    while (start < items.size()) {
        double side = std::min(w, h);
        size_t end = start;
        double sum = 0, best = 1e300;
        for (size_t k = start; k < items.size(); k++) {
            double s2 = sum + items[k]->value * scale, mn = 1e300, mx = 0;
            for (size_t j = start; j <= k; j++) {
                double a = items[j]->value * scale;
                mn = std::min(mn, a);
                mx = std::max(mx, a);
            }
            double worst = std::max(side * side * mx / (s2 * s2), s2 * s2 / (side * side * mn));
            if (k > start && worst > best) break;
            best = worst;
            sum = s2;
            end = k + 1;
        }
        double thick = sum / side;
        double pos = 0;
        for (size_t k = start; k < end; k++) {
            double len = items[k]->value * scale / thick;
            if (w >= h) {  // a column on the left
                items[k]->x = x;
                items[k]->y = y + pos;
                items[k]->w = thick;
                items[k]->h = len;
            } else {  // a row on top
                items[k]->x = x + pos;
                items[k]->y = y;
                items[k]->w = len;
                items[k]->h = thick;
            }
            pos += len;
        }
        if (w >= h) {
            x += thick;
            w -= thick;
        } else {
            y += thick;
            h -= thick;
        }
        start = end;
    }
}

constexpr double kHeader = 22, kPad = 4;

void place(Item& sec) {
    std::vector<Item*> items;
    for (auto& k : sec.kids)
        if (k->value > 0) items.push_back(k.get());
    std::sort(items.begin(), items.end(), [](Item* a, Item* b) { return a->value > b->value; });
    double top = sec.h > 2 * kHeader && sec.w > 40 ? kHeader : 0;
    squarify(items, sec.x + kPad, sec.y + top, sec.w - 2 * kPad, sec.h - top - kPad);
    for (Item* it : items)
        if (!it->leaf) place(*it);
}

std::string fmt(double v) {
    char buf[40];
    std::snprintf(buf, sizeof(buf), "%.2f", v);
    std::string s = buf;
    while (s.back() == '0') s.pop_back();
    if (s.back() == '.') s.pop_back();
    return s;
}

}  // namespace

bool render_treemap(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    Item root;
    root.indent = -1;
    std::string title;
    std::vector<Item*> stack{&root};
    bool first = true;
    size_t i = 0;
    while (i <= source.size()) {
        size_t e = source.find('\n', i);
        std::string raw = source.substr(i, e == std::string::npos ? std::string::npos : e - i);
        i = e == std::string::npos ? source.size() + 1 : e + 1;
        std::string line = trim(raw);
        if (line.empty() || starts(line, "%%")) continue;
        if (first) {
            first = false;
            continue;
        }
        if (starts(line, "title ")) {
            title = trim(line.substr(6));
            continue;
        }
        if (starts(line, "classDef ") || starts(line, "accTitle") || starts(line, "accDescr")) continue;
        int indent = 0;
        for (char c : raw) {
            if (c == ' ') indent++;
            else if (c == '\t') indent += 4;
            else break;
        }
        auto item = std::make_unique<Item>();
        item->indent = indent;
        size_t colon = line.rfind(':');
        size_t quote_end = line.rfind('"');
        if (colon != std::string::npos && (quote_end == std::string::npos || colon > quote_end)) {
            std::string v = trim(line.substr(colon + 1));
            size_t cls = v.find(":::");
            if (cls != std::string::npos) v = trim(v.substr(0, cls));
            char* end;
            double d = std::strtod(v.c_str(), &end);
            if (v.empty() || *end != 0) {
                error = "not a number: " + v;
                return false;
            }
            item->leaf = true;
            item->value = d;
            line = line.substr(0, colon);
        }
        size_t cls = line.find(":::");
        if (cls != std::string::npos) line = line.substr(0, cls);
        item->name = unquote(line);
        while (stack.size() > 1 && stack.back()->indent >= indent) stack.pop_back();
        if (stack.back()->leaf) {
            error = "a value item cannot have children: " + stack.back()->name;
            return false;
        }
        Item* parent = stack.back();
        Item* p = item.get();
        parent->kids.push_back(std::move(item));
        stack.push_back(p);
    }
    if (root.kids.empty()) {
        error = "a treemap needs at least one item";
        return false;
    }
    total_of(root);
    if (root.value <= 0) {
        error = "a treemap needs at least one positive value";
        return false;
    }

    Theme th = make_theme(options);
    Text text{options};
    const double W = 640, H = 420, pad = 12;
    double top = title.empty() ? pad : pad + 28;
    root.x = pad - kPad;
    root.y = top - kPad;
    root.w = W - 2 * pad + 2 * kPad;
    root.h = H - top - pad + 2 * kPad;
    // the root is not drawn: its children fill the area (a root with one section shows just that section)
    std::vector<Item*> top_items;
    for (auto& k : root.kids)
        if (k->value > 0) top_items.push_back(k.get());
    std::sort(top_items.begin(), top_items.end(), [](Item* a, Item* b) { return a->value > b->value; });
    squarify(top_items, pad, top + kHeader, W - 2 * pad, H - top - kHeader - pad);
    for (size_t k = 0; k < top_items.size(); k++) {
        std::vector<Item*> stackv{top_items[k]};
        while (!stackv.empty()) {
            Item* it = stackv.back();
            stackv.pop_back();
            it->branch = (int)k;
            for (auto& c : it->kids) {
                c->branch = (int)k;
                stackv.push_back(c.get());
            }
        }
        if (!top_items[k]->leaf) place(*top_items[k]);
    }

    std::string body;
    if (!title.empty()) centered_text(body, th, {title}, W / 2, pad + 8, 15, 600, th.text);
    // the root is a section too, headed by the grand total alone, as Mermaid draws it
    body += "<g class=\"section root\">\n<rect x=\"" + num(root.x) + "\" y=\"" + num(root.y) + "\" width=\"" + num(root.w) + "\" height=\"" + num(root.h) + "\" fill=\"" + th.surface +
            "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
    aligned_text(body, th, {fmt(root.value)}, root.x + root.w - 6, root.y + kPad + kHeader / 2, 11, 400, th.text_sec, "end");
    body += "</g>\n";
    // sections first (outer to inner), then leaves on top of them
    std::vector<Item*> order, leaves;
    std::vector<Item*> walk(top_items.begin(), top_items.end());
    while (!walk.empty()) {
        Item* it = walk.front();
        walk.erase(walk.begin());
        (it->leaf ? leaves : order).push_back(it);
        for (auto& c : it->kids)
            if (c->value > 0) walk.push_back(c.get());
    }
    for (Item* it : order) {
        body += "<g class=\"section\">\n<rect x=\"" + num(it->x) + "\" y=\"" + num(it->y) + "\" width=\"" + num(it->w) + "\" height=\"" + num(it->h) + "\" fill=\"" + th.surface +
                "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        if (it->h > 2 * kHeader && it->w > 40) {
            std::string label = it->name;
            if (text.width(label, 12, 600) > it->w - 12) label.clear();
            if (!label.empty()) {
                aligned_text(body, th, {label}, it->x + 6, it->y + kHeader / 2, 12, 600, th.text, "start");
                std::string value = fmt(it->value);  // a section is headed by its total too, as Mermaid draws it
                if (text.width(value, 11, 400) <= it->w - 12) aligned_text(body, th, {value}, it->x + it->w - 6, it->y + kHeader / 2, 11, 400, th.text_sec, "end");
            }
        }
        body += "</g>\n";
    }
    for (Item* it : leaves) {
        int pct = 10 + (it->branch % 5) * 7;
        body += "<g class=\"leaf\">\n<rect x=\"" + num(it->x) + "\" y=\"" + num(it->y) + "\" width=\"" + num(it->w) + "\" height=\"" + num(it->h) + "\" fill=\"" + mix(th.fg, th.bg, pct) +
                "\" stroke=\"" + th.bg + "\" stroke-width=\"1.5\"/>\n";
        std::string value = fmt(it->value);
        if (it->w > 24 && it->h > 18 && text.width(it->name, 12, 500) <= it->w - 10) {
            bool two = it->h > 38 && text.width(value, 11, 400) <= it->w - 10;
            aligned_text(body, th, {it->name}, it->x + 6, it->y + (two ? 13 : it->h / 2), 12, 500, th.text, "start");
            if (two) aligned_text(body, th, {value}, it->x + 6, it->y + 29, 11, 400, th.text_sec, "start");
        }
        body += "</g>\n";
    }
    svg = svg_document(th, W, H, body);
    return true;
}

}  // namespace mermaid
