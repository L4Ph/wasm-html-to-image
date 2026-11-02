#include "mermaid/treeview.h"

#include <algorithm>

#include "mermaid/indent_tree.h"

namespace mermaid {
namespace {

struct Row {
    const TreeNode* node;
    int depth;
    double y;
    int parent_row;
    bool synth = false;  // the "/" root a forest of top-level items hangs from
};

void collect(const TreeNode& n, int depth, int parent, std::vector<Row>& rows, double row_h) {
    for (auto& k : n.kids) {
        int me = (int)rows.size();
        rows.push_back({k.get(), depth, 0, parent});
        rows.back().y = me * row_h;
        collect(*k, depth + 1, me, rows, row_h);
    }
}

}  // namespace

bool render_treeview(const std::string& source, const Options& options, std::string& svg, std::string& error) {
    TreeNode root;
    if (!parse_indent_tree(source, root, error)) return false;
    const double kRow = 26, kStep = 24, pad = 20, kFont = 13;
    std::vector<Row> rows;
    collect(root, 0, -1, rows, kRow);
    if (rows.empty()) {
        error = "a tree view needs at least one item";
        return false;
    }
    if (root.kids.size() > 1) {  // several top-level items hang from a root drawn as "/", as Mermaid draws it
        for (auto& r : rows) {
            r.depth += 1;
            r.parent_row = r.parent_row < 0 ? 0 : r.parent_row + 1;
            r.y += kRow;
        }
        rows.insert(rows.begin(), Row{nullptr, 0, 0, -1, true});
    }
    Theme th = make_theme(options);
    Text text{options};
    double w = 0;
    for (auto& r : rows) w = std::max(w, pad + r.depth * kStep + 28 + text.width(r.synth ? "/" : r.node->text, kFont, 400));
    std::string body;
    // connectors first, so icons and text sit on top
    for (size_t k = 0; k < rows.size(); k++) {
        const Row& r = rows[k];
        if (r.parent_row < 0) continue;
        double px = pad + (r.depth - 1) * kStep + 8, cy = pad + r.y + kRow / 2, py = pad + rows[r.parent_row].y + kRow / 2 + 8;
        double ty = cy;
        body += "<line x1=\"" + num(px) + "\" y1=\"" + num(py) + "\" x2=\"" + num(px) + "\" y2=\"" + num(ty) + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
        body += "<line x1=\"" + num(px) + "\" y1=\"" + num(ty) + "\" x2=\"" + num(px + kStep - 8) + "\" y2=\"" + num(ty) + "\" stroke=\"" + th.border + "\" stroke-width=\"1\"/>\n";
    }
    for (auto& r : rows) {
        double x = pad + r.depth * kStep, cy = pad + r.y + kRow / 2;
        bool dir = r.synth || !r.node->kids.empty();
        if (dir) {
            body += "<path d=\"M" + num(x) + "," + num(cy - 5) + " h5 l2,2 h7 v9 h-14 z\" fill=\"" + th.surface + "\" stroke=\"" + th.text_sec + "\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>\n";
        } else {
            body += "<path d=\"M" + num(x + 1) + "," + num(cy - 7) + " h8 l4,4 v10 h-12 z\" fill=\"" + th.surface + "\" stroke=\"" + th.text_sec + "\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>\n";
        }
        aligned_text(body, th, {r.synth ? "/" : r.node->text}, x + 22, cy, kFont, dir ? 600 : 400, th.text, "start");
    }
    svg = svg_document(th, w + pad, rows.size() * kRow + 2 * pad, body);
    return true;
}

}  // namespace mermaid
