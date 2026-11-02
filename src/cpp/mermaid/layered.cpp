#include "mermaid/layered.h"

#include <algorithm>
#include <cmath>
#include <functional>

namespace mermaid {

namespace {

constexpr double kNodeSep = 28;    // between two nodes of a layer
constexpr double kDummySep = 14;   // beside a bend point of a long edge
constexpr double kLayerGap = 48;   // between two layers
constexpr double kLabelGap = 12;   // extra room around an edge label
constexpr double kFrameGap = 20;   // between a group's frame and what is outside it, per frame boundary
constexpr double kFramePad = 18;   // breadth room kept around the members of a group
constexpr double kFrameHeader = 26;  // the title bar of a frame

// A node of the layered graph: a real node or a bend point ("dummy") of an edge that spans layers.
struct LN {
    int node = -1;  // index into the input nodes, -1 for a dummy
    int group = -1; // innermost group (a dummy takes the innermost group both ends of its edge share)
    double bw = 0;  // size along the layer (breadth)
    double dp = 0;  // size across the layers (depth)
    int layer = 0;
    double b = 0;   // breadth coordinate of the centre
    std::vector<int> up, down;
};

struct Chain {
    int edge = 0;
    bool reversed = false;      // the edge runs against the layer order (it closes a cycle)
    std::vector<int> ln;        // layered nodes from the lower layer to the higher one
    double port_from = 0, port_to = 0;  // breadth offset of the anchors on the first / last node
};

double sep(const LN& a, const LN& b) {
    bool ra = a.node >= 0, rb = b.node >= 0;
    double gap = ra && rb ? kNodeSep : (ra || rb ? (kNodeSep + kDummySep) / 2 : kDummySep);
    return (a.bw + b.bw) / 2 + gap;
}

}  // namespace

LayoutResult layout_layered(const std::vector<LayoutNode>& nodes, const std::vector<LayoutEdge>& edges, Direction dir,
                            const std::vector<int>& group_parent, const std::vector<double>& group_min_w) {
    const int n = (int)nodes.size();
    const bool horiz = dir == Direction::LR || dir == Direction::RL;
    LayoutResult res;
    res.center.assign(n, {});
    res.points.assign(edges.size(), {});
    res.label_center.assign(edges.size(), {});
    if (n == 0) return res;

    // ── 1. cycles: a depth-first search marks the edges that point back up the tree ──
    std::vector<std::vector<std::pair<int, int>>> out(n);  // (to, edge)
    for (size_t e = 0; e < edges.size(); e++)
        if (edges[e].from != edges[e].to) out[edges[e].from].push_back({edges[e].to, (int)e});
    std::vector<int> color(n, 0), post;
    std::vector<char> back(edges.size(), 0);
    std::function<void(int)> dfs = [&](int v) {
        color[v] = 1;
        for (auto [to, e] : out[v]) {
            if (color[to] == 1) back[e] = 1;
            else if (color[to] == 0) dfs(to);
        }
        color[v] = 2;
        post.push_back(v);
    };
    for (int v = 0; v < n; v++)
        if (color[v] == 0) dfs(v);

    // ── 2. layers: the longest path from a source ──
    std::vector<int> layer(n, 0);
    for (int i = n - 1; i >= 0; i--) {
        int v = post[i];
        for (auto [to, e] : out[v])
            if (!back[e]) layer[to] = std::max(layer[to], layer[v] + 1);
    }
    int max_layer = 0;
    for (int v = 0; v < n; v++) max_layer = std::max(max_layer, layer[v]);

    // groups: the chain of enclosing groups of a group (innermost first), and the deepest group two groups share
    const int ngroups = (int)group_parent.size();
    // computed once: the group code asks for a chain millions of times on a big graph, and a vector built each time is what a
    // wasm build spends its time on
    std::vector<std::vector<int>> chain_table(ngroups);
    for (int g0 = 0; g0 < ngroups; g0++)
        for (int g = g0; g >= 0 && g < ngroups; g = group_parent[g]) chain_table[g0].push_back(g);
    const std::vector<int> no_chain;
    auto chain_of = [&](int g) -> const std::vector<int>& { return g >= 0 && g < ngroups ? chain_table[g] : no_chain; };
    auto common_group = [&](int a, int b) {
        const auto& ca = chain_of(a), &cb = chain_of(b);
        for (int g : ca)
            if (std::find(cb.begin(), cb.end(), g) != cb.end()) return g;
        return -1;
    };

    // ── 3. layered nodes and edge chains ──
    std::vector<LN> ln(n);
    for (int v = 0; v < n; v++) {
        ln[v].node = v;
        ln[v].bw = horiz ? nodes[v].h : nodes[v].w;
        ln[v].dp = horiz ? nodes[v].w : nodes[v].h;
        ln[v].layer = layer[v];
        ln[v].group = nodes[v].group;
    }
    std::vector<Chain> chains;
    std::vector<double> label_extra(max_layer + 1, 0);  // per layer: room the labels below it need
    for (size_t e = 0; e < edges.size(); e++) {
        int a = edges[e].from, b = edges[e].to;
        if (a == b) continue;
        Chain c;
        c.edge = (int)e;
        c.reversed = back[e] != 0;
        if (c.reversed) std::swap(a, b);
        c.ln.push_back(a);
        int prev = a;
        for (int l = layer[a] + 1; l < layer[b]; l++) {
            LN d;
            d.layer = l;
            d.group = common_group(nodes[edges[e].from].group, nodes[edges[e].to].group);
            ln.push_back(d);
            int id = (int)ln.size() - 1;
            ln[prev].down.push_back(id);
            ln[id].up.push_back(prev);
            c.ln.push_back(id);
            prev = id;
        }
        ln[prev].down.push_back(b);
        ln[b].up.push_back(prev);
        c.ln.push_back(b);
        double lab = horiz ? edges[e].label_w : edges[e].label_h;
        if (lab > 0) label_extra[layer[a]] = std::max(label_extra[layer[a]], lab);
        chains.push_back(std::move(c));
    }

    // room between two neighbours: the node gap, plus one frame gap for every frame that holds only one of them
    auto sep = [&](const LN& a, const LN& b) {
        double gap = ::mermaid::sep(a, b);
        if (ngroups == 0 || a.group == b.group) return gap;
        const auto& ca = chain_of(a.group), &cb = chain_of(b.group);
        int diff = 0;
        for (int g : ca) diff += std::find(cb.begin(), cb.end(), g) == cb.end();
        int starting = 0;  // frames that begin at b: in a left-right graph their title bar sits on b's near side
        for (int g : cb) starting += std::find(ca.begin(), ca.end(), g) == ca.end();
        diff += starting;
        return gap + diff * kFrameGap + (horiz ? starting * kFrameHeader : 0);
    };

    // ── 4. order within the layers: barycentre sweeps, keeping the best ordering seen ──
    std::vector<std::vector<int>> L(max_layer + 1);
    for (int i = 0; i < (int)ln.size(); i++) L[ln[i].layer].push_back(i);
    std::vector<int> pos(ln.size(), 0);
    auto refresh = [&]() {
        for (auto& row : L)
            for (int i = 0; i < (int)row.size(); i++) pos[row[i]] = i;
    };
    // crossings between two adjacent layers = inversions among the edges ordered by their upper end: O(E log N) per layer
    auto crossings = [&]() {
        long total = 0;
        std::vector<int> tree;
        for (int l = 0; l < max_layer; l++) {
            std::vector<std::pair<int, int>> segs;
            for (int u : L[l])
                for (int w : ln[u].down) segs.push_back({pos[u], pos[w]});
            if (segs.size() < 2) continue;
            std::sort(segs.begin(), segs.end());
            int width = (int)L[l + 1].size() + 1;
            tree.assign(width + 1, 0);
            size_t inserted = 0;
            for (size_t i = 0; i < segs.size();) {
                size_t j = i;
                while (j < segs.size() && segs[j].first == segs[i].first) j++;  // edges from one node never cross each other
                for (size_t k = i; k < j; k++) {
                    int below = 0;  // inserted edges whose lower end is at or before this one
                    for (int x = segs[k].second + 1; x > 0; x -= x & -x) below += tree[x];
                    total += (long)inserted - below;
                }
                for (size_t k = i; k < j; k++)
                    for (int x = segs[k].second + 1; x <= width; x += x & -x) tree[x]++;
                inserted += j - i;
                i = j;
            }
        }
        return total;
    };
    refresh();
    // members of a group stay together in every layer: rows are re-sorted by (group position, ..., own position)
    // A group's place is its members' mean place over every row (as a fraction of the row), so two groups keep the same
    // order in all the rows they share; a mean taken per row could flip them between rows, and no frame placement can then
    // keep both groups' frames apart. gsum[g] is kept up to date as rows change (retally), so a row costs only its own size.
    std::vector<double> gsum(ngroups, 0);
    std::vector<int> gcnt(ngroups, 0);
    for (size_t r = 0; r < L.size() && ngroups > 0; r++) {
        const double scale = L[r].size() > 1 ? 1.0 / (double)(L[r].size() - 1) : 0;
        for (size_t i = 0; i < L[r].size(); i++)
            for (int g : chain_of(ln[L[r][i]].group)) gsum[g] += (double)pos[L[r][i]] * scale, gcnt[g]++;
    }
    auto retally = [&](int l) {  // row l is in a new order: move its share of gsum and the positions with it
        const double scale = L[l].size() > 1 ? 1.0 / (double)(L[l].size() - 1) : 0;
        for (size_t i = 0; i < L[l].size(); i++) {
            int v = L[l][i];
            if (pos[v] != (int)i)
                for (int g : chain_of(ln[v].group)) gsum[g] += ((double)i - (double)pos[v]) * scale;
            pos[v] = (int)i;
        }
    };
    auto cluster = [&](int l, const std::vector<double>* frozen = nullptr) {
        if (ngroups == 0) return;
        auto& row = L[l];
        retally(l);
        const std::vector<double>& sum = frozen ? *frozen : gsum;
        const std::vector<int>& cnt = gcnt;
        const double rs = row.size() > 1 ? 1.0 / (double)(row.size() - 1) : 0;
        std::vector<std::pair<std::vector<double>, int>> keyed;
        for (size_t i = 0; i < row.size(); i++) {
            auto ch = chain_of(ln[row[i]].group);
            std::reverse(ch.begin(), ch.end());
            std::vector<double> key;
            for (int g : ch) key.push_back(sum[g] / cnt[g]), key.push_back((double)g);
            key.push_back((double)i * rs);  // the same unit as a group's mean place
            keyed.push_back({key, row[i]});
        }
        std::stable_sort(keyed.begin(), keyed.end(), [](const auto& x, const auto& y) { return x.first < y.first; });
        for (size_t i = 0; i < keyed.size(); i++) row[i] = keyed[i].second;
        retally(l);
    };
    for (int l = 0; l <= max_layer; l++) cluster(l);
    refresh();
    long best = crossings();
    auto best_L = L;
    auto sweep = [&](int l, bool use_up) {
        std::vector<std::pair<double, int>> keyed;
        for (int v : L[l]) {
            const auto& nb = use_up ? ln[v].up : ln[v].down;
            double key = pos[v];
            if (!nb.empty()) {
                double s = 0;
                for (int w : nb) s += pos[w];
                key = s / nb.size();
            }
            keyed.push_back({key, v});
        }
        std::stable_sort(keyed.begin(), keyed.end(), [](auto& x, auto& y) { return x.first < y.first; });
        for (size_t i = 0; i < keyed.size(); i++) L[l][i] = keyed[i].second;
        cluster(l);
        for (size_t i = 0; i < L[l].size(); i++) pos[L[l][i]] = (int)i;  // only this row moved
    };
    // a big graph (long edges become many dummy nodes) gives up sooner when the sweeps stop paying off
    const bool big = ln.size() > 3000;
    int stale = 0;
    for (int iter = 0; iter < 24 && best > 0; iter++) {
        if (iter % 2 == 0)
            for (int l = 1; l <= max_layer; l++) sweep(l, true);
        else
            for (int l = max_layer - 1; l >= 0; l--) sweep(l, false);
        long c = crossings();
        if (c < best) {
            best = c;
            best_L = L;
            stale = 0;
        } else if (big && ++stale >= 4) {
            break;
        }
    }
    L = best_L;
    refresh();
    if (ngroups > 0) {
        // The rows were clustered at different moments, by group places that kept changing, so two groups can stand in
        // opposite order in two rows. One last clustering with the places fixed puts them in the same order everywhere.
        std::fill(gsum.begin(), gsum.end(), 0.0);
        for (size_t r = 0; r < L.size(); r++) {
            const double scale = L[r].size() > 1 ? 1.0 / (double)(L[r].size() - 1) : 0;
            for (size_t i = 0; i < L[r].size(); i++)
                for (int g : chain_of(ln[L[r][i]].group)) gsum[g] += (double)pos[L[r][i]] * scale;
        }
        const std::vector<double> fixed = gsum;
        for (int l = 0; l <= max_layer; l++) cluster(l, &fixed);
        refresh();
    }

    // ── 5. breadth: pack each layer, then pull nodes toward their neighbours ──
    for (auto& row : L) {
        double x = 0;
        for (size_t i = 0; i < row.size(); i++) {
            if (i) x += sep(ln[row[i - 1]], ln[row[i]]);
            ln[row[i]].b = x;
        }
    }
    auto place_row = [&](std::vector<int>& row, const std::vector<double>& desired) {
        size_t m = row.size();
        std::vector<double> fwd(m), bwd(m);
        for (size_t i = 0; i < m; i++) fwd[i] = i ? std::max(desired[i], fwd[i - 1] + sep(ln[row[i - 1]], ln[row[i]])) : desired[i];
        for (size_t i = m; i-- > 0;) bwd[i] = i + 1 < m ? std::min(desired[i], bwd[i + 1] - sep(ln[row[i]], ln[row[i + 1]])) : desired[i];
        for (size_t i = 0; i < m; i++) ln[row[i]].b = (fwd[i] + bwd[i]) / 2;
    };
    for (int it = 0; it < 24; it++) {
        int mode = it % 3;  // 0: toward the layer above, 1: below, 2: both
        auto pass = [&](int l) {
            auto& row = L[l];
            std::vector<double> desired(row.size());
            for (size_t i = 0; i < row.size(); i++) {
                const LN& v = ln[row[i]];
                double s = 0;
                int cnt = 0;
                if (mode != 1)
                    for (int w : v.up) s += ln[w].b, cnt++;
                if (mode != 0)
                    for (int w : v.down) s += ln[w].b, cnt++;
                desired[i] = cnt ? s / cnt : v.b;
            }
            place_row(row, desired);
        };
        if (mode == 1)
            for (int l = max_layer; l >= 0; l--) pass(l);
        else
            for (int l = 0; l <= max_layer; l++) pass(l);
    }
    // groups: the layers each one spans, and a push that keeps every node that is not a member out of its frame
    std::vector<int> gmin(ngroups, 1 << 30), gmax(ngroups, -1);
    for (const LN& v : ln)
        for (int g : chain_of(v.group)) gmin[g] = std::min(gmin[g], v.layer), gmax[g] = std::max(gmax[g], v.layer);
    // the box of every group along the breadth axis: its members with the padding of each frame, and wide enough for its title
    // (group_min_w, top-down graphs only: in left-right ones the title runs along the layers)
    auto bounds = [&](std::vector<double>& glo, std::vector<double>& ghi) {
        const double lo_pad = kFramePad + (horiz ? kFrameHeader : 0), hi_pad = kFramePad;
        glo.assign(ngroups, 1e18);
        ghi.assign(ngroups, -1e18);
        for (const LN& v : ln) {
            int depth = 0;
            for (int g : chain_of(v.group)) {
                glo[g] = std::min(glo[g], v.b - v.bw / 2 - lo_pad - depth * lo_pad);
                ghi[g] = std::max(ghi[g], v.b + v.bw / 2 + hi_pad + depth * hi_pad);
                depth++;
            }
        }
        if (horiz || (int)group_min_w.size() < ngroups) return;
        std::vector<int> inner_first(ngroups);
        for (int g = 0; g < ngroups; g++) inner_first[g] = g;
        std::stable_sort(inner_first.begin(), inner_first.end(), [&](int a, int b) { return chain_of(a).size() > chain_of(b).size(); });
        for (int g : inner_first) {
            if (gmax[g] < 0) continue;
            ghi[g] = std::max(ghi[g], glo[g] + group_min_w[g]);
            int par = group_parent[g];
            if (par >= 0 && gmax[par] >= 0) ghi[par] = std::max(ghi[par], ghi[g] + hi_pad);
        }
    };
    if (ngroups > 0) {
        const double pad_lo = kFramePad + (horiz ? kFrameHeader : 0), pad_hi = kFramePad;
        std::vector<int> order(ngroups);
        for (int g = 0; g < ngroups; g++) order[g] = g;
        std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return chain_of(a).size() > chain_of(b).size(); });
        auto member = [&](const LN& v, int g) {
            const auto& c = chain_of(v.group);
            return std::find(c.begin(), c.end(), g) != c.end();
        };
        // A push moves part of one row, so a frame can stretch over the rows it was not pushed in and ask for more room on the
        // next pass; on some graphs that doubles every pass. Nothing legitimate is wider than every node side by side, so a
        // pass that goes past that is undone and the pushing stops (some frames then overlap, which beats a drawing a million wide).
        double room = 500;
        for (const LN& v : ln) room += 2 * (v.bw + kFrameGap + 2 * kFramePad);
        for (int pass = 0; pass < 40; pass++) {
            bool moved = false;
            std::vector<double> before(ln.size());
            for (size_t i = 0; i < ln.size(); i++) before[i] = ln[i].b;
            for (int g : order) {
                if (gmax[g] < 0) continue;
                std::vector<double> blo, bhi;
                bounds(blo, bhi);
                double lo = blo[g], hi = bhi[g];
                for (int l = gmin[g]; l <= gmax[g]; l++) {
                    auto& row = L[l];
                    int first = -1;
                    for (int i = 0; i < (int)row.size(); i++)
                        if (member(ln[row[i]], g)) {
                            first = i;
                            break;
                        }
                    for (int i = 0; i < (int)row.size(); i++) {
                        const LN& x = ln[row[i]];
                        if (member(x, g)) continue;
                        double xl = x.b - x.bw / 2, xh = x.b + x.bw / 2;
                        // a node in another group (not one that encloses g) brings that group's frame padding along
                        if (x.group >= 0) {
                            const auto& enclosing = chain_of(g);
                            if (std::find(enclosing.begin(), enclosing.end(), x.group) == enclosing.end()) xl -= kFramePad, xh += kFramePad;
                        }
                        if (xh <= lo || xl >= hi) continue;
                        bool left = first >= 0 ? i < first : x.b < (lo + hi) / 2;
                        // the group x belongs to (outermost one that does not enclose g) moves as a whole: its members in the other
                        // rows go the same way, or its frame would stretch from the old place to the new one and still meet g's
                        int other = -1;
                        if (x.group >= 0) {
                            const auto& enclosing = chain_of(g), &cx = chain_of(x.group);
                            for (auto it = cx.rbegin(); it != cx.rend(); ++it)
                                if (std::find(enclosing.begin(), enclosing.end(), *it) == enclosing.end()) {
                                    other = *it;
                                    break;
                                }
                        }
                        std::vector<char> shifted(ln.size(), 0);
                        double d;
                        if (left) {
                            d = xh - lo + kFrameGap / 2;
                            for (int j = 0; j <= i; j++) ln[row[j]].b -= d, shifted[row[j]] = 1;
                        } else {
                            d = hi - xl + kFrameGap / 2;
                            for (int j = i; j < (int)row.size(); j++) ln[row[j]].b += d, shifted[row[j]] = 1;
                        }
                        if (other >= 0) {
                            for (size_t v = 0; v < ln.size(); v++)
                                if (!shifted[v] && member(ln[v], other)) ln[v].b += left ? -d : d;
                            for (size_t r = 0; r < L.size(); r++) {  // a member that moved into a neighbour pushes it on
                                auto& rw = L[r];
                                if (left)
                                    for (size_t j = rw.size(); j-- > 1;) ln[rw[j - 1]].b = std::min(ln[rw[j - 1]].b, ln[rw[j]].b - sep(ln[rw[j - 1]], ln[rw[j]]));
                                else
                                    for (size_t j = 1; j < rw.size(); j++) ln[rw[j]].b = std::max(ln[rw[j]].b, ln[rw[j - 1]].b + sep(ln[rw[j - 1]], ln[rw[j]]));
                            }
                        }
                        moved = true;
                        break;  // the row changed: look at it again on the next pass
                    }
                }
            }
            // two groups that do not enclose one another and share a layer have frames that may not overlap, whatever the
            // nodes in the rows say: a frame is the box of all its members, and one can pass over a place the other only
            // reaches in a different row. The one on the right moves, with all its members.
            {
                std::vector<double> glo, ghi;
                bounds(glo, ghi);
                for (int g = 0; g < ngroups; g++) {
                    if (gmax[g] < 0) continue;
                    for (int h = g + 1; h < ngroups; h++) {
                        if (gmax[h] < 0 || gmax[g] < gmin[h] || gmax[h] < gmin[g]) continue;
                        const auto& cg = chain_of(g), &ch = chain_of(h);
                        if (std::find(cg.begin(), cg.end(), h) != cg.end() || std::find(ch.begin(), ch.end(), g) != ch.end()) continue;
                        if (ghi[g] <= glo[h] || ghi[h] <= glo[g]) continue;
                        // which one is on the right: the order they have in a row both are in (the clustering keeps it the same in
                        // every row, and the pushes above decide by it); their centres only when no row holds both
                        int right = (glo[g] + ghi[g]) / 2 > (glo[h] + ghi[h]) / 2 ? g : h;
                        for (int l = std::max(gmin[g], gmin[h]); l <= std::min(gmax[g], gmax[h]); l++) {
                            int first_g = -1, first_h = -1;
                            for (int i = 0; i < (int)L[l].size(); i++) {
                                if (first_g < 0 && member(ln[L[l][i]], g)) first_g = i;
                                if (first_h < 0 && member(ln[L[l][i]], h)) first_h = i;
                            }
                            if (first_g >= 0 && first_h >= 0) {
                                right = first_g > first_h ? g : h;
                                break;
                            }
                        }
                        const int leftg = right == g ? h : g;
                        double d = ghi[leftg] - glo[right] + kFrameGap / 2;
                        std::vector<double> keep(ln.size());
                        for (size_t k = 0; k < ln.size(); k++) keep[k] = ln[k].b;
                        const double was_hi = ghi[leftg], was_lo = glo[leftg];
                        for (LN& v : ln)
                            if (member(v, right)) v.b += d;
                        for (auto& rw : L)
                            for (size_t j = 1; j < rw.size(); j++) ln[rw[j]].b = std::max(ln[rw[j]].b, ln[rw[j - 1]].b + sep(ln[rw[j - 1]], ln[rw[j]]));
                        bounds(glo, ghi);
                        if (ghi[leftg] > was_hi + 1e-6 || glo[leftg] < was_lo - 1e-6) {  // the push dragged the other group along: undo it
                            for (size_t k = 0; k < ln.size(); k++) ln[k].b = keep[k];
                            bounds(glo, ghi);
                            continue;
                        }
                        moved = true;
                    }
                }
            }
            double lo_b = 1e18, hi_b = -1e18;
            for (const LN& v : ln) lo_b = std::min(lo_b, v.b - v.bw / 2), hi_b = std::max(hi_b, v.b + v.bw / 2);
            if (hi_b - lo_b > room) {
                for (size_t i = 0; i < ln.size(); i++) ln[i].b = before[i];
                break;
            }
            if (!moved) break;
        }
    }
    // The pushes can undo each other (one moves a frame right to clear its neighbour, another moves it back left to clear a third),
    // and stop with two frames still overlapping. Settle that by moving only to the right: of two overlapping frames the one
    // that comes later in a row they share goes right, with its members, and so does whatever that pushes along. Positions only
    // grow, so this ends; if the drawing then gets wider than every node side by side, it is undone.
    auto settle_frames = [&]() {
        if (ngroups > 1) {
            std::vector<double> before_settle(ln.size());
            for (size_t i = 0; i < ln.size(); i++) before_settle[i] = ln[i].b;
            auto in_group = [&](const LN& v, int g) {
                const auto& c = chain_of(v.group);
                return std::find(c.begin(), c.end(), g) != c.end();
            };
            std::vector<double> glo, ghi;
            for (int round = 0; round < 60; round++) {
                bounds(glo, ghi);
                bool any = false;
                for (int g = 0; g < ngroups && !any; g++) {
                    if (gmax[g] < 0) continue;
                    for (int h = g + 1; h < ngroups && !any; h++) {
                        if (gmax[h] < 0 || gmax[g] < gmin[h] || gmax[h] < gmin[g]) continue;
                        const auto& cg = chain_of(g);
                        const auto& ch = chain_of(h);
                        if (std::find(cg.begin(), cg.end(), h) != cg.end() || std::find(ch.begin(), ch.end(), g) != ch.end()) continue;
                        if (ghi[g] <= glo[h] || ghi[h] <= glo[g]) continue;
                        int right = (glo[g] + ghi[g]) / 2 > (glo[h] + ghi[h]) / 2 ? g : h;
                        for (int l = std::max(gmin[g], gmin[h]); l <= std::min(gmax[g], gmax[h]); l++) {
                            int first_g = -1, first_h = -1;
                            for (int i = 0; i < (int)L[l].size(); i++) {
                                if (first_g < 0 && in_group(ln[L[l][i]], g)) first_g = i;
                                if (first_h < 0 && in_group(ln[L[l][i]], h)) first_h = i;
                            }
                            if (first_g >= 0 && first_h >= 0) {
                                right = first_g > first_h ? g : h;
                                break;
                            }
                        }
                        const int left = right == g ? h : g;
                        const double d = ghi[left] - glo[right] + kFrameGap / 2;
                        for (LN& v : ln)
                            if (in_group(v, right)) v.b += d;
                        for (auto& rw : L)
                            for (size_t j = 1; j < rw.size(); j++) ln[rw[j]].b = std::max(ln[rw[j]].b, ln[rw[j - 1]].b + sep(ln[rw[j - 1]], ln[rw[j]]));
                        any = true;
                    }
                }
                if (!any) break;
            }
            double lo_b = 1e18, hi_b = -1e18;
            for (const LN& v : ln) lo_b = std::min(lo_b, v.b - v.bw / 2), hi_b = std::max(hi_b, v.b + v.bw / 2);
            double room_all = 500;
            for (const LN& v : ln) room_all += 2 * (v.bw + kFrameGap + 2 * kFramePad);
            if (hi_b - lo_b > 2 * room_all)
                for (size_t i = 0; i < ln.size(); i++) ln[i].b = before_settle[i];
        }
    };
    settle_frames();
    auto violations = [&]() {
        std::vector<double> glo, ghi;
        bounds(glo, ghi);
        int bad = 0;
        for (int g = 0; g < ngroups; g++) {
            if (gmax[g] < 0) continue;
            const auto& cg = chain_of(g);
            for (int h = g + 1; h < ngroups; h++) {
                if (gmax[h] < 0 || gmax[g] < gmin[h] || gmax[h] < gmin[g]) continue;
                const auto& ch = chain_of(h);
                if (std::find(cg.begin(), cg.end(), h) != cg.end() || std::find(ch.begin(), ch.end(), g) != ch.end()) continue;
                if (ghi[g] > glo[h] && ghi[h] > glo[g]) bad++;
            }
            for (const LN& x : ln) {
                if (x.layer < gmin[g] || x.layer > gmax[g]) continue;
                const auto& cx = chain_of(x.group);
                if (std::find(cx.begin(), cx.end(), g) != cx.end()) continue;
                if (x.b + x.bw / 2 > glo[g] && x.b - x.bw / 2 < ghi[g]) bad++;
            }
        }
        return bad;
    };
    // how many pairs of frames side by side meet, so that a move which makes the frame of the moved node meet another is refused
    auto frames_meeting = [&]() {
        std::vector<double> flo, fhi;
        bounds(flo, fhi);
        int meet = 0;
        for (int g = 0; g < ngroups; g++) {
            if (gmax[g] < 0) continue;
            const auto& cg = chain_of(g);
            for (int h = g + 1; h < ngroups; h++) {
                if (gmax[h] < 0 || gmax[g] < gmin[h] || gmax[h] < gmin[g]) continue;
                const auto& ch = chain_of(h);
                if (std::find(cg.begin(), cg.end(), h) != cg.end() || std::find(ch.begin(), ch.end(), g) != ch.end()) continue;
                if (fhi[g] > flo[h] && fhi[h] > flo[g]) meet++;
            }
        }
        return meet;
    };
    // The pushes left some nodes far from their neighbours (a frame went right, the nodes it left behind stayed). Move a node
    // toward the middle of its neighbours when that breaks no frame rule; a few passes, only for graphs small enough to check.
    if (ngroups > 0 && (double)ln.size() * ln.size() * (ngroups + 1) < 3e7) {
        const double pad_lo = kFramePad + (horiz ? kFrameHeader : 0), pad_hi = kFramePad;
        int bad = violations();
        for (int pass = 0; pass < 12; pass++) {
            bool moved = false;
            for (auto& rw : L)
                for (size_t j = 0; j < rw.size(); j++) {
                    LN& v = ln[rw[j]];
                    double sum = 0;
                    int cnt = 0;
                    for (int w : v.up) sum += ln[w].b, cnt++;
                    for (int w : v.down) sum += ln[w].b, cnt++;
                    if (!cnt) continue;
                    double lo = j ? ln[rw[j - 1]].b + sep(ln[rw[j - 1]], v) : -1e18;
                    double hi = j + 1 < rw.size() ? ln[rw[j + 1]].b - sep(v, ln[rw[j + 1]]) : 1e18;
                    double to = std::max(lo, std::min(hi, sum / cnt));
                    if (std::abs(to - v.b) < 1.0) continue;
                    double was = v.b;
                    v.b = to;
                    int now = violations();
                    if (now > bad) v.b = was;
                    else bad = now, moved = true;
                }
            if (!moved) break;
        }
    }
    // Moving nodes one at a time can leave two frames meeting that only a move of a whole frame clears.
    settle_frames();
    // A node with no edge has nothing to line up with, but every push of a group in its row moved it along; draw it back
    // up to its left neighbour, as long as that does not put it inside the frame of a group that spans its layer.
    if (ngroups > 0) {
        std::vector<double> glo(ngroups, 1e18), ghi(ngroups, -1e18);
        for (const LN& v : ln)
            for (int g : chain_of(v.group)) glo[g] = std::min(glo[g], v.b - v.bw / 2 - kFramePad), ghi[g] = std::max(ghi[g], v.b + v.bw / 2 + kFramePad);
        if (!horiz && (int)group_min_w.size() >= ngroups)
            for (int g = 0; g < ngroups; g++)
                if (gmax[g] >= 0) ghi[g] = std::max(ghi[g], glo[g] + group_min_w[g]);
        for (size_t l = 0; l < L.size(); l++) {
            auto& rw = L[l];
            for (size_t j = 1; j < rw.size(); j++) {
                LN& v = ln[rw[j]];
                if (!v.up.empty() || !v.down.empty()) continue;
                // a frame of v's that the left neighbour is not in brings its title bar along when it is on this side
                double bar = 0;
                if (horiz && v.group >= 0) {
                    const auto& cl = chain_of(ln[rw[j - 1]].group);
                    for (int g : chain_of(v.group))
                        if (std::find(cl.begin(), cl.end(), g) == cl.end()) bar += kFrameHeader;
                }
                double want = std::min(v.b, ln[rw[j - 1]].b + sep(ln[rw[j - 1]], v) + bar);
                // drawn back, a member must not go past the other members of its frames: the frame would grow to that side
                // and meet the frames over there
                for (int g : chain_of(v.group)) {
                    double edge = 1e18;
                    for (const LN& u : ln) {
                        const auto& cu = chain_of(u.group);
                        if (&u != &v && std::find(cu.begin(), cu.end(), g) != cu.end()) edge = std::min(edge, u.b - u.bw / 2);
                    }
                    want = edge > 1e17 ? v.b : std::max(want, edge + v.bw / 2);
                    // drawn back means to the left only: a member after it in the row would otherwise push it onto itself
                    want = std::min(want, v.b);
                }
                bool clear = true;
                const auto& own = chain_of(v.group);
                for (int g = 0; g < ngroups && clear; g++) {
                    if (gmax[g] < 0 || (int)l < gmin[g] || (int)l > gmax[g] || std::find(own.begin(), own.end(), g) != own.end()) continue;
                    if (want + v.bw / 2 > glo[g] && want - v.bw / 2 < ghi[g]) clear = false;
                }
                if (clear && want != v.b) {
                    const double was = v.b;
                    const int before = v.group >= 0 ? frames_meeting() : 0;
                    v.b = want;
                    if (v.group >= 0 && frames_meeting() > before) v.b = was;
                }
            }
        }
    }
    // The pushes that cleared the frames made room for them when they were still wide; once the nodes were drawn together a frame
    // can be left far to the right of the one before it. Move a whole frame, with its members, left as far as its rows allow when
    // that makes no frame rule worse and leaves the edges no longer.
    if (ngroups > 1 && (double)ln.size() * ln.size() * (ngroups + 1) < 3e7) {
        auto edge_cost = [&]() {
            double c = 0;
            for (const LN& v : ln)
                for (int w : v.down) c += std::abs(v.b - ln[w].b);
            return c;
        };
        auto in_chain = [&](const LN& v, int g) {
            const auto& c = chain_of(v.group);
            return std::find(c.begin(), c.end(), g) != c.end();
        };
        std::vector<double> glo, ghi;
        for (int round = 0; round < 3; round++) {
            bounds(glo, ghi);
            std::vector<int> order;
            for (int g = 0; g < ngroups; g++)
                if (gmax[g] >= 0) order.push_back(g);
            std::sort(order.begin(), order.end(), [&](int x, int y) { return glo[x] < glo[y]; });
            bool any = false;
            for (int g : order) {
                double room = 1e18;
                for (auto& rw : L)
                    for (size_t j = 0; j < rw.size(); j++) {
                        if (!in_chain(ln[rw[j]], g)) continue;
                        if (j == 0) continue;
                        const LN& prev = ln[rw[j - 1]];
                        if (in_chain(prev, g)) continue;
                        room = std::min(room, ln[rw[j]].b - prev.b - sep(prev, ln[rw[j]]));
                    }
                if (room < 1.0 || room > 1e17) continue;
                std::vector<double> was(ln.size());
                for (size_t i = 0; i < ln.size(); i++) was[i] = ln[i].b;
                const int bad_before = violations();
                const int meet_before = frames_meeting();
                const double cost_before = edge_cost();
                // the whole way may run into another frame: look for the farthest shift that is still allowed
                auto try_shift = [&](double d) {
                    for (size_t i = 0; i < ln.size(); i++)
                        if (in_chain(ln[i], g)) ln[i].b = was[i] - d;
                    return violations() <= bad_before && frames_meeting() <= meet_before && edge_cost() <= cost_before + 0.5;
                };
                double ok = 0, hi = room;
                if (try_shift(hi)) {
                    ok = hi;
                } else {
                    for (int step = 0; step < 8 && hi - ok >= 1.0; step++) {
                        const double mid = (ok + hi) / 2;
                        if (try_shift(mid)) ok = mid;
                        else hi = mid;
                    }
                }
                for (size_t i = 0; i < ln.size(); i++)
                    ln[i].b = in_chain(ln[i], g) ? was[i] - ok : was[i];
                if (ok >= 1.0) any = true;
            }
            if (!any) break;
        }
    }
    double min_b = 1e18;
    for (auto& v : ln) min_b = std::min(min_b, v.b - v.bw / 2);
    for (auto& v : ln) v.b -= min_b;
    double total_b = 0;
    for (auto& v : ln) total_b = std::max(total_b, v.b + v.bw / 2);

    // ── 6. depth: the layers one after the other, with room for the labels and the frame edges between them ──
    // a frame needs its title bar on the side that is the top of the picture, and a little room on the other
    std::vector<double> group_gap(max_layer + 1, 0);
    for (int g = 0; g < ngroups; g++) {
        if (gmax[g] < 0 || horiz) continue;
        double before = dir == Direction::BT ? 16 : kFrameHeader, after = dir == Direction::BT ? kFrameHeader : 16;
        if (gmin[g] > 0) group_gap[gmin[g] - 1] += before;
        if (gmax[g] < max_layer) group_gap[gmax[g]] += after;
    }
    std::vector<double> layer_dp(max_layer + 1, 0), layer_d(max_layer + 1, 0);
    for (auto& v : ln)
        if (v.node >= 0) layer_dp[v.layer] = std::max(layer_dp[v.layer], v.dp);
    // left-right: a frame runs along the layers, so its title needs them far enough apart; inner frames first, as they widen the outer ones
    if (horiz && (int)group_min_w.size() >= ngroups) {
        std::vector<int> order;
        for (int g = 0; g < ngroups; g++)
            if (gmax[g] >= 0) order.push_back(g);
        std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return chain_of(a).size() > chain_of(b).size(); });
        for (int g : order) {
            double have = 2 * kFramePad;
            for (int l = gmin[g]; l <= gmax[g]; l++) {
                have += layer_dp[l];
                if (l < gmax[g]) have += kLayerGap + (label_extra[l] > 0 ? label_extra[l] + kLabelGap : 0) + group_gap[l];
            }
            const double need = group_min_w[g] - have;
            if (need <= 0) continue;
            if (gmax[g] > gmin[g]) group_gap[gmin[g]] += need;
            else layer_dp[gmin[g]] += need;
        }
    }
    double cur = 0;
    for (int l = 0; l <= max_layer; l++) {
        layer_d[l] = cur + layer_dp[l] / 2;
        cur += layer_dp[l];
        if (l < max_layer) cur += kLayerGap + (label_extra[l] > 0 ? label_extra[l] + kLabelGap : 0) + group_gap[l];
    }
    const double total_d = cur;

    // ── 7. anchors: the edges that leave or enter the same side of a node share it ──
    auto outline_inset = [&](const LN& v, double off) {
        double half_b = v.bw / 2, half_d = v.dp / 2;
        if (half_b <= 0) return 0.0;
        double r = std::min(1.0, std::fabs(off) / half_b);
        switch (nodes[v.node].outline) {
            case 1: return half_d * r;                                  // diamond
            case 2: return half_d * (1 - std::sqrt(1 - r * r));         // ellipse
            default: return 0.0;
        }
    };
    struct PortRef {
        int chain;
        bool at_start;
        double other_b;
    };
    std::vector<std::vector<PortRef>> down_ports(ln.size()), up_ports(ln.size());
    for (size_t ci = 0; ci < chains.size(); ci++) {
        const Chain& c = chains[ci];
        int first = c.ln.front(), last = c.ln.back();
        down_ports[first].push_back({(int)ci, true, ln[c.ln[1]].b});
        up_ports[last].push_back({(int)ci, false, ln[c.ln[c.ln.size() - 2]].b});
    }
    auto assign = [&](int v, std::vector<PortRef>& ports) {
        if (ports.empty()) return;
        std::sort(ports.begin(), ports.end(), [](const PortRef& a, const PortRef& b) { return a.other_b < b.other_b; });
        size_t m = ports.size();
        double frac = nodes[ln[v].node].outline == 1 ? 0.4 : (nodes[ln[v].node].outline == 2 ? 0.5 : 0.7);
        double span = m > 1 ? std::min(ln[v].bw * frac, 18.0 * (m - 1)) : 0;
        for (size_t i = 0; i < m; i++) {
            double off = m > 1 ? -span / 2 + span * i / (m - 1) : 0;
            (ports[i].at_start ? chains[ports[i].chain].port_from : chains[ports[i].chain].port_to) = off;
        }
    };
    for (int v = 0; v < n; v++) {
        assign(v, down_ports[v]);
        assign(v, up_ports[v]);
    }

    // ── 8. edge points in (breadth, depth) space: orthogonal, bending half way between two layers ──
    struct Abs {
        double b, d;
    };
    std::vector<std::vector<Abs>> abs_pts(edges.size());
    std::vector<Abs> abs_label(edges.size(), {0, 0});
    for (const Chain& c : chains) {
        std::vector<Abs> way;
        const LN& s = ln[c.ln.front()];
        way.push_back({s.b + c.port_from, layer_d[s.layer] + s.dp / 2 - outline_inset(s, c.port_from)});
        for (size_t i = 1; i + 1 < c.ln.size(); i++) way.push_back({ln[c.ln[i]].b, layer_d[ln[c.ln[i]].layer]});
        const LN& t = ln[c.ln.back()];
        way.push_back({t.b + c.port_to, layer_d[t.layer] - t.dp / 2 + outline_inset(t, c.port_to)});

        std::vector<Abs> pts;
        for (size_t i = 0; i + 1 < way.size(); i++) {
            Abs p = way[i], q = way[i + 1];
            double mid = (p.d + q.d) / 2;
            if (i == 0) abs_label[c.edge] = std::fabs(p.b - q.b) > 0.5 ? Abs{(p.b + q.b) / 2, mid} : Abs{p.b, mid};
            pts.push_back(p);
            if (std::fabs(p.b - q.b) > 0.5) {
                pts.push_back({p.b, mid});
                pts.push_back({q.b, mid});
            }
        }
        pts.push_back(way.back());
        // drop repeated and collinear points
        std::vector<Abs> clean;
        for (const Abs& p : pts) {
            if (!clean.empty() && std::fabs(clean.back().b - p.b) < 0.01 && std::fabs(clean.back().d - p.d) < 0.01) continue;
            while (clean.size() >= 2) {
                const Abs& a = clean[clean.size() - 2];
                const Abs& b = clean.back();
                bool same_b = std::fabs(a.b - b.b) < 0.01 && std::fabs(b.b - p.b) < 0.01;
                bool same_d = std::fabs(a.d - b.d) < 0.01 && std::fabs(b.d - p.d) < 0.01;
                if (!same_b && !same_d) break;
                clean.pop_back();
            }
            clean.push_back(p);
        }
        if (c.reversed) std::reverse(clean.begin(), clean.end());
        abs_pts[c.edge] = std::move(clean);
    }

    // labels that sit in the same gap are pushed apart along the breadth so no two overlap
    {
        std::vector<size_t> order;
        for (size_t e = 0; e < edges.size(); e++)
            if (edges[e].label_w > 0) order.push_back(e);
        auto wb = [&](size_t e) { return horiz ? edges[e].label_h : edges[e].label_w; };
        auto hd = [&](size_t e) { return horiz ? edges[e].label_w : edges[e].label_h; };
        for (int pass = 0; pass < 8; pass++) {
            std::sort(order.begin(), order.end(), [&](size_t a, size_t b) { return abs_label[a].b < abs_label[b].b; });
            bool moved = false;
            for (size_t k = 1; k < order.size(); k++)
                for (size_t j = 0; j < k; j++) {
                    size_t a = order[j], b = order[k];
                    if (std::fabs(abs_label[a].d - abs_label[b].d) >= (hd(a) + hd(b)) / 2 + 2) continue;
                    double need = (wb(a) + wb(b)) / 2 + 4;
                    if (abs_label[b].b - abs_label[a].b >= need) continue;
                    abs_label[b].b = abs_label[a].b + need;
                    moved = true;
                }
            if (!moved) break;
        }
    }

    // ── 9. to the requested direction ──
    auto to_xy = [&](double b, double d) -> Pt {
        switch (dir) {
            case Direction::TD: return {b, d};
            case Direction::BT: return {b, total_d - d};
            case Direction::LR: return {d, b};
            default: return {total_d - d, b};
        }
    };
    for (int v = 0; v < n; v++) res.center[v] = to_xy(ln[v].b, layer_d[ln[v].layer]);
    for (size_t e = 0; e < edges.size(); e++) {
        for (const Abs& p : abs_pts[e]) res.points[e].push_back(to_xy(p.b, p.d));
        if (edges[e].label_w > 0) res.label_center[e] = to_xy(abs_label[e].b, abs_label[e].d);
    }
    // self loops leave and re-enter the right side
    for (size_t e = 0; e < edges.size(); e++) {
        if (edges[e].from != edges[e].to) continue;
        int v = edges[e].from;
        Pt c = res.center[v];
        double r = c.x + nodes[v].w / 2;
        res.points[e] = {{r, c.y - 7}, {r + 24, c.y - 7}, {r + 24, c.y + 7}, {r, c.y + 7}};
        if (edges[e].label_w > 0) res.label_center[e] = {r + 24 + edges[e].label_w / 2 + 4, c.y};
    }
    // labels: try the middle (and the quarter points) of every segment of the label's own edge, and keep the spot
    // that covers the least of the other edges, the nodes and the other labels
    {
        struct Box {
            double x0, y0, x1, y1;
        };
        auto hits = [](Pt a, Pt b, const Box& r) {  // Liang-Barsky: does the segment cross the box?
            double t0 = 0, t1 = 1, dx = b.x - a.x, dy = b.y - a.y;
            auto clip = [&](double p, double q) {
                if (std::fabs(p) < 1e-9) return q >= 0;
                double t = q / p;
                if (p < 0) {
                    if (t > t1) return false;
                    t0 = std::max(t0, t);
                } else {
                    if (t < t0) return false;
                    t1 = std::min(t1, t);
                }
                return true;
            };
            return clip(-dx, a.x - r.x0) && clip(dx, r.x1 - a.x) && clip(-dy, a.y - r.y0) && clip(dy, r.y1 - a.y);
        };
        auto overlap = [](const Box& a, const Box& b) { return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1; };
        auto box_of = [&](size_t e, Pt c) { return Box{c.x - edges[e].label_w / 2, c.y - edges[e].label_h / 2, c.x + edges[e].label_w / 2, c.y + edges[e].label_h / 2}; };
        // Every candidate spot is judged against all the edges, nodes and other labels. A grid keeps that to the ones near the
        // spot (a graph of a thousand labels would otherwise look at every segment a thousand times over).
        struct Seg {
            Pt a, b;
            size_t edge;
        };
        std::vector<Seg> segs;
        for (size_t f = 0; f < edges.size(); f++)
            for (size_t i = 0; i + 1 < res.points[f].size(); i++) segs.push_back({res.points[f][i], res.points[f][i + 1], f});
        double gx0 = 1e18, gy0 = 1e18, gx1 = -1e18, gy1 = -1e18;
        auto reach = [&](double x, double y) {
            gx0 = std::min(gx0, x), gy0 = std::min(gy0, y), gx1 = std::max(gx1, x), gy1 = std::max(gy1, y);
        };
        for (int v = 0; v < n; v++) reach(res.center[v].x - nodes[v].w / 2, res.center[v].y - nodes[v].h / 2), reach(res.center[v].x + nodes[v].w / 2, res.center[v].y + nodes[v].h / 2);
        for (const Seg& sg : segs) reach(sg.a.x, sg.a.y), reach(sg.b.x, sg.b.y);
        for (size_t e = 0; e < edges.size(); e++)
            if (edges[e].label_w > 0) {
                Box lb = box_of(e, res.label_center[e]);
                reach(lb.x0, lb.y0), reach(lb.x1, lb.y1);
            }
        const double margin = 200;  // a candidate spot lies on an edge, so near the others; spots outside the grid are clamped in
        gx0 -= margin, gy0 -= margin, gx1 += margin, gy1 += margin;
        double cell = 120;
        while (((gx1 - gx0) / cell + 1) * ((gy1 - gy0) / cell + 1) > 4e5) cell *= 2;
        const int gnx = (int)((gx1 - gx0) / cell) + 1, gny = (int)((gy1 - gy0) / cell) + 1;
        auto span = [&](double lo, double hi, double origin, int count, int& c0, int& c1) {
            c0 = std::max(0, std::min(count - 1, (int)std::floor((lo - origin) / cell)));
            c1 = std::max(0, std::min(count - 1, (int)std::floor((hi - origin) / cell)));
        };
        std::vector<std::vector<int>> seg_cells((size_t)gnx * gny), node_cells((size_t)gnx * gny), label_cells((size_t)gnx * gny);
        auto put = [&](std::vector<std::vector<int>>& g, double x0_, double y0_, double x1_, double y1_, int id) {
            int a0, a1, b0, b1;
            span(x0_, x1_, gx0, gnx, a0, a1);
            span(y0_, y1_, gy0, gny, b0, b1);
            for (int cy = b0; cy <= b1; cy++)
                for (int cx = a0; cx <= a1; cx++) g[(size_t)cy * gnx + cx].push_back(id);
        };
        auto take = [&](std::vector<std::vector<int>>& g, double x0_, double y0_, double x1_, double y1_, int id) {
            int a0, a1, b0, b1;
            span(x0_, x1_, gx0, gnx, a0, a1);
            span(y0_, y1_, gy0, gny, b0, b1);
            for (int cy = b0; cy <= b1; cy++)
                for (int cx = a0; cx <= a1; cx++) {
                    auto& v = g[(size_t)cy * gnx + cx];
                    v.erase(std::remove(v.begin(), v.end(), id), v.end());
                }
        };
        for (size_t k = 0; k < segs.size(); k++)
            put(seg_cells, std::min(segs[k].a.x, segs[k].b.x), std::min(segs[k].a.y, segs[k].b.y), std::max(segs[k].a.x, segs[k].b.x), std::max(segs[k].a.y, segs[k].b.y), (int)k);
        for (int v = 0; v < n; v++) put(node_cells, res.center[v].x - nodes[v].w / 2, res.center[v].y - nodes[v].h / 2, res.center[v].x + nodes[v].w / 2, res.center[v].y + nodes[v].h / 2, v);
        for (size_t f = 0; f < edges.size(); f++)
            if (edges[f].label_w > 0) {
                Box lb = box_of(f, res.label_center[f]);
                put(label_cells, lb.x0, lb.y0, lb.x1, lb.y1, (int)f);
            }
        std::vector<unsigned> seen_seg(segs.size(), 0), seen_node(n, 0), seen_label(edges.size(), 0);
        unsigned stamp = 0;
        auto cost = [&](size_t e, Pt c) {
            Box r = box_of(e, c);
            double total = 0;
            ++stamp;
            int a0, a1, b0, b1;
            span(r.x0, r.x1, gx0, gnx, a0, a1);
            span(r.y0, r.y1, gy0, gny, b0, b1);
            for (int cy = b0; cy <= b1; cy++)
                for (int cx = a0; cx <= a1; cx++) {
                    const size_t at = (size_t)cy * gnx + cx;
                    for (int k : seg_cells[at]) {
                        if (seen_seg[k] == stamp) continue;
                        seen_seg[k] = stamp;
                        if (segs[k].edge != e && hits(segs[k].a, segs[k].b, r)) total += 1;
                    }
                    for (int f : label_cells[at]) {
                        if (seen_label[f] == stamp) continue;
                        seen_label[f] = stamp;
                        if ((size_t)f != e && overlap(r, box_of(f, res.label_center[f]))) total += 10;
                    }
                    for (int v : node_cells[at]) {
                        if (seen_node[v] == stamp) continue;
                        seen_node[v] = stamp;
                        if (overlap(r, Box{res.center[v].x - nodes[v].w / 2, res.center[v].y - nodes[v].h / 2, res.center[v].x + nodes[v].w / 2, res.center[v].y + nodes[v].h / 2})) total += 10;
                    }
                }
            return total;
        };
        for (size_t e = 0; e < edges.size(); e++) {
            if (edges[e].label_w <= 0 || edges[e].from == edges[e].to || res.points[e].size() < 2) continue;
            Pt best = res.label_center[e];
            double best_cost = cost(e, best);
            for (size_t i = 0; i + 1 < res.points[e].size() && best_cost > 0; i++) {
                Pt a = res.points[e][i], b = res.points[e][i + 1];
                double len = std::fabs(a.x - b.x) + std::fabs(a.y - b.y);
                for (double t : {0.5, 0.25, 0.75}) {
                    if (t != 0.5 && len < 70) continue;
                    Pt c = {a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t};
                    double k = cost(e, c) + 0.001 * (std::fabs(c.x - res.label_center[e].x) + std::fabs(c.y - res.label_center[e].y));
                    if (k < best_cost) best_cost = k, best = c;
                }
            }
            if (best.x != res.label_center[e].x || best.y != res.label_center[e].y) {
                Box was = box_of(e, res.label_center[e]), now = box_of(e, best);
                take(label_cells, was.x0, was.y0, was.x1, was.y1, (int)e);
                put(label_cells, now.x0, now.y0, now.x1, now.y1, (int)e);
            }
            res.label_center[e] = best;
        }
    }
    (void)total_b;

    // ── 10. the content box, with the origin moved to its top left corner ──
    double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    auto grow = [&](double x, double y) {
        x0 = std::min(x0, x);
        y0 = std::min(y0, y);
        x1 = std::max(x1, x);
        y1 = std::max(y1, y);
    };
    for (int v = 0; v < n; v++) {
        grow(res.center[v].x - nodes[v].w / 2, res.center[v].y - nodes[v].h / 2);
        grow(res.center[v].x + nodes[v].w / 2, res.center[v].y + nodes[v].h / 2);
    }
    for (size_t e = 0; e < edges.size(); e++) {
        for (const Pt& p : res.points[e]) grow(p.x, p.y);
        if (edges[e].label_w > 0) {
            grow(res.label_center[e].x - edges[e].label_w / 2, res.label_center[e].y - edges[e].label_h / 2);
            grow(res.label_center[e].x + edges[e].label_w / 2, res.label_center[e].y + edges[e].label_h / 2);
        }
    }
    for (auto& c : res.center) c = {c.x - x0, c.y - y0};
    for (auto& pts : res.points)
        for (auto& p : pts) p = {p.x - x0, p.y - y0};
    for (auto& p : res.label_center) p = {p.x - x0, p.y - y0};
    res.width = x1 - x0;
    res.height = y1 - y0;
    return res;
}

}  // namespace mermaid
