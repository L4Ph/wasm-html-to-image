#ifndef SATORU_MERMAID_LAYERED_H
#define SATORU_MERMAID_LAYERED_H

// Layered ("Sugiyama") graph layout with orthogonal edges, shared by the flowchart, state, class and ER
// diagrams: cycle removal, longest-path layers, dummy nodes for long edges, barycentre ordering, and a
// breadth assignment that pulls every node toward its neighbours.

#include <vector>

#include "mermaid/mermaid_internal.h"

namespace mermaid {

enum class Direction { TD, LR, BT, RL };

struct LayoutNode {
    double w = 0, h = 0;
    /// Outline for edge anchors: 0 box, 1 diamond, 2 ellipse.
    int outline = 0;
    /// The innermost group (frame) the node belongs to, -1 for none. Members of a group are kept together and
    /// nodes outside it are kept out of its frame.
    int group = -1;
};

struct LayoutEdge {
    int from = 0, to = 0;
    double label_w = 0, label_h = 0;  // 0: no label
};

struct LayoutResult {
    std::vector<Pt> center;                  // per node
    std::vector<std::vector<Pt>> points;     // per edge, from `from` to `to`
    std::vector<Pt> label_center;            // per edge (valid when it has a label)
    double width = 0, height = 0;            // content box; the origin is its top left corner
};

/// `group_parent[g]` is the enclosing group of group `g` (-1 at the top level); empty when no node has a group.
/// `group_min_w[g]` (optional) is the least width of the frame of group `g`, e.g. for its title; used by top-down layouts.
LayoutResult layout_layered(const std::vector<LayoutNode>& nodes, const std::vector<LayoutEdge>& edges, Direction dir,
                            const std::vector<int>& group_parent = {}, const std::vector<double>& group_min_w = {});

}  // namespace mermaid

#endif  // SATORU_MERMAID_LAYERED_H
