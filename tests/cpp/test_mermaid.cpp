// tests/cpp/test_mermaid.cpp — host unit tests for src/cpp/mermaid (flowchart parser, layered layout, SVG).
// Standard library only; a minimal runner like the other tests here.

#include <algorithm>
#include <array>
#include <cstring>
#include <cmath>
#include <cstdio>
#include <string>

#include "mermaid/layered.h"
#include "mermaid/mermaid.h"

namespace {

int g_pass = 0;
int g_fail = 0;

void check(bool ok, const std::string& name) {
    if (ok) {
        ++g_pass;
    } else {
        ++g_fail;
        std::printf("FAIL %s\n", name.c_str());
    }
}

int count(const std::string& hay, const std::string& needle) {
    int n = 0;
    for (size_t p = hay.find(needle); p != std::string::npos; p = hay.find(needle, p + needle.size())) n++;
    return n;
}

bool render(const std::string& src, std::string& svg, std::string& err) {
    mermaid::Options o;
    return mermaid::render(src, o, svg, err);
}

std::string svg_of(const std::string& src) {
    std::string svg, err;
    if (!render(src, svg, err)) return "ERROR: " + err;
    return svg;
}

bool has(const std::string& hay, const std::string& needle) { return hay.find(needle) != std::string::npos; }

using mermaid::Direction;
using mermaid::LayoutEdge;
using mermaid::LayoutNode;

LayoutNode box(double w, double h) {
    LayoutNode n;
    n.w = w;
    n.h = h;
    return n;
}

LayoutEdge edge(int a, int b) {
    LayoutEdge e;
    e.from = a;
    e.to = b;
    return e;
}

}  // namespace

int main() {
    // --- parsing: edges and their variants ---
    check(count(svg_of("graph TD\nA-->B"), "class=\"edge\"") == 1, "edge/basic");
    check(count(svg_of("graph TD\nA-->B-->C"), "class=\"edge\"") == 2, "edge/chain");
    check(count(svg_of("graph TD\nA & B --> C & D"), "class=\"edge\"") == 4, "edge/groups");
    check(count(svg_of("graph TD\nA---B"), "<polygon") == 0, "edge/open_has_no_arrow");
    check(count(svg_of("graph TD\nA-->B"), "<polygon") == 1, "edge/arrow_head");
    check(count(svg_of("graph TD\nA<-->B"), "<polygon") == 2, "edge/both_arrows");
    // spaced open links and compact labels (issue 22)
    check(!has(svg_of("flowchart TD\n  A[あ] --- B[い]"), "ERROR") && count(svg_of("flowchart TD\n  A --- B"), "class=\"edge\"") == 1 && count(svg_of("flowchart TD\n  A --- B"), "<polygon") == 0, "edge/open_spaced");
    check(count(svg_of("flowchart TD\n  A ---- B"), "class=\"edge\"") == 1 && count(svg_of("flowchart TD\n  A === B"), "class=\"edge\"") == 1, "edge/long_and_thick_open");
    check(count(svg_of("flowchart TD\n  A --- B --- C --- D"), "class=\"node\"") == 4 && count(svg_of("flowchart TD\n  A --- B --- C --- D"), "class=\"edge\"") == 3, "edge/open_chain");
    check(count(svg_of("flowchart TD\n  A --- B --> C"), "class=\"node\"") == 3 && count(svg_of("flowchart TD\n  A --- B --> C"), "class=\"edge\"") == 2, "edge/open_then_arrow");
    check(count(svg_of("flowchart TD\n  A --- B & C"), "class=\"edge\"") == 2, "edge/open_group");
    // notation variants the official parser takes (differential test, packages/mermaid-compare/scripts/notation-diff.mjs)
    check(count(svg_of("flowchart TD\n  A--xB\n  C--oD"), "class=\"edge\"") == 2 && count(svg_of("flowchart TD\n  A--xB\n  C--oD"), "class=\"node\"") == 4, "edge/compact_cross_circle");
    check(has(svg_of("flowchart TD\n  A[\"a %% b\"] --> B"), "a %% b") && count(svg_of("flowchart TD\n  A -->|\"a | b\"| B"), "class=\"edge\"") == 1, "label/comment_and_bar_in_quotes");
    check(count(svg_of("flowchart TD\n  A[a;b] --> B; B --> C"), "class=\"node\"") == 3, "label/semicolon_in_brackets");
    check(count(svg_of("flowchart TD\n  A@{ shape: diamond, label: \"x\" } --> B\n  A e1@--> C\n  e1@{ animate: true }"), "class=\"node\"") == 3 &&
              count(svg_of("flowchart TD\n  A@{ shape: diamond, label: \"x\" } --> B\n  A e1@--> C\n  e1@{ animate: true }"), "class=\"edge\"") == 2,
          "node/meta_and_edge_id");
    check(count(svg_of("classDiagram\n  A<|--B\n  C()--D"), "<line") + count(svg_of("classDiagram\n  A<|--B\n  C()--D"), "<path") > 0 && !has(svg_of("classDiagram\n  A<|--B"), "ERROR"), "class/compact_relation");
    check(!has(svg_of("requirementDiagram\n  requirement r {\n    id: 1\n    text: t\n    risk: low\n    verifymethod: test\n  }\n  element e {\n    type: sim\n  }\n  e-satisfies->r"), "ERROR"), "requirement/compact_relation");
    check(!has(svg_of("usecase-beta\n  actor A\n  U\n  A-->U\n  A --- U"), "ERROR"), "usecase/compact_and_open");
    check(!has(svg_of("packet-beta\n  +16: \"a\"\n  +16: \"b\""), "ERROR"), "packet/plus_width");
    check(!has(svg_of("sequenceDiagram; A->>B: hi"), "ERROR"), "sequence/statement_on_header");
    check(!has(svg_of("block-beta\n  A[\"a --> b\"] B"), "ERROR"), "block/arrow_in_label");
    // an empty subgraph keeps its frame and title (issue 23)
    check(count(svg_of("flowchart TB\n  A --> B\n  subgraph S[\"EmptyBox\"]\n  end"), "class=\"subgraph\"") == 1 && has(svg_of("flowchart TB\n  A --> B\n  subgraph S[\"EmptyBox\"]\n  end"), ">EmptyBox<"), "subgraph/empty_keeps_title");
    check(count(svg_of("flowchart TB\n  A --> B\n  subgraph S[\"EmptyBox\"]\n  end\n  B -.-> S"), "class=\"node\"") == 2 && has(svg_of("flowchart TB\n  A --> B\n  subgraph S[\"EmptyBox\"]\n  end\n  B -.-> S"), ">EmptyBox<") && !has(svg_of("flowchart TB\n  A --> B\n  subgraph S[\"EmptyBox\"]\n  end\n  B -.-> S"), ">S<"), "subgraph/empty_referenced");
    check(count(svg_of("flowchart TB\n  subgraph P[\"Parent\"]\n    subgraph C[\"Child\"]\n    end\n  end"), "class=\"subgraph\"") == 2, "subgraph/only_empty_child");
    check(count(svg_of("stateDiagram-v2\n  A: a --> b\n  A --> B"), "class=\"edge\"") == 1 && count(svg_of("stateDiagram-v2\n  A: a --> b\n  A --> B"), "class=\"node\"") == 2, "state/description_with_arrow");
    {
        // issue 24: an empty top-level subgraph sits beside the drawing (the layout does not grow around it) and an edge to it stops at its border
        std::string plain = svg_of("flowchart TB\n  A --> B");
        std::string with_empty = svg_of("flowchart TB\n  A --> B\n  subgraph S[\"EmptyBox\"]\n  end\n  B -.-> S");
        auto width_of = [](const std::string& s) { return std::atof(s.c_str() + s.find("viewBox=\"0 0 ") + 13); };
        check(width_of(with_empty) < width_of(plain) + 200, "subgraph/empty_does_not_widen_layout");
        size_t frame = with_empty.find("class=\"subgraph\"");
        double fx = std::atof(with_empty.c_str() + with_empty.find("x=\"", frame) + 3);
        size_t dotted = with_empty.find("stroke-dasharray=\"4 4\"");
        size_t pts = with_empty.rfind("points=\"", dotted);
        std::string list = with_empty.substr(pts + 8, with_empty.find('"', pts + 8) - pts - 8);
        double end_x = std::atof(list.c_str() + list.rfind(' ') + 1);
        check(std::fabs(end_x - fx) < 1.0, "subgraph/empty_edge_stops_at_border");
    }
    {
        // two groups that the rows used to order differently grew the picture without bound
        std::string wide = svg_of("flowchart TB\nsubgraph G0[\"Group0\"]\n  n0\n  n5\n  n15\nend\nsubgraph G1[\"Group1\"]\n  n7\n  n10\nend\nn14 --> n9\nn10 --> n9\nn5 --> n3\nn15 --> n5\nn14 --> n3\nn14 --> n10");
        double w = std::atof(wide.c_str() + wide.find("viewBox=\"0 0 ") + 13);
        check(w > 100 && w < 1500, "layout/groups_ordered_alike_in_every_row");
    }
    {
        std::string worded = svg_of("erDiagram\n  A one to many B : has\n  A zero or more optionally to only one C");
        check(count(worded, "class=\"node\"") == 3 && count(worded, "class=\"edge\"") == 2, "er/worded_relationships");
        std::string seq = svg_of("sequenceDiagram\n  A->>B: hi\n  A->>A: self\n  Note over A: n");
        check(count(seq, "class=\"lifeline\"") == 2 && count(seq, "class=\"message\"") == 2, "sequence/countable_marks");
    }
    {
        // frames of groups that do not enclose one another stay apart, also where they only meet in rows holding none of the other's nodes
        auto frames_apart = [](const std::string& svg) {
            std::vector<std::array<double, 4>> fr;
            for (size_t at = svg.find("class=\"subgraph\""); at != std::string::npos; at = svg.find("class=\"subgraph\"", at + 1)) {
                auto num = [&](const char* key, size_t from) { return std::atof(svg.c_str() + svg.find(key, from) + std::strlen(key)); };
                size_t r = svg.find("<rect", at);
                double x = num("x=\"", r), y = num("y=\"", r), w = num("width=\"", r), h = num("height=\"", r);
                fr.push_back({x, y, x + w, y + h});
            }
            for (size_t i = 0; i < fr.size(); i++)
                for (size_t j = i + 1; j < fr.size(); j++)
                    if (std::min(fr[i][2], fr[j][2]) - std::max(fr[i][0], fr[j][0]) > 0.5 && std::min(fr[i][3], fr[j][3]) - std::max(fr[i][1], fr[j][1]) > 0.5) return false;
            return true;
        };
        check(frames_apart(svg_of("flowchart TB\nsubgraph G0[\"G0\"]\n  n2\nend\nsubgraph G1[\"G1\"]\n  n1\n  n3\nend\nn1 --> n3\nn2 --> n3\nn0 --> n2")), "layout/frames_apart_padding");
        check(frames_apart(svg_of("flowchart TB\nsubgraph G0[\"G0\"]\n  n2\n  n3\nend\nsubgraph G1[\"G1\"]\n  n0\n  n4\nend\nn3 --> n2\nn3 --> n1\nn3 --> n4\nn0 --> n2")), "layout/frames_apart_unit_mismatch");
        check(frames_apart(svg_of("flowchart TB\nsubgraph G0[\"G0\"]\n  n1\n  n2\nend\nsubgraph G1[\"G1\"]\n  n0\n  n3\n  n4\nend\nn1 --> n0\nn3 --> n4\nn2 --> n3\nn2 --> n1")), "layout/frames_apart_different_rows");
        // rows clustered at different moments used to leave two groups in opposite order, which stretched one frame across the other
        {
            std::string s = svg_of("flowchart TB\nsubgraph G0[\"G0\"]\n  n0\n  n2\nend\nsubgraph G1[\"G1\"]\n  n3\n  n4\n  n5\n  n7\nend\nn4 --> n1\nn2 --> n1\nn5 --> n4\nn7 --> n2\nn0 --> n3\nn5 --> n2\nn0 --> n4\nn1 --> n4\nn5 --> n3\nn6");
            check(frames_apart(s) && std::atof(s.c_str() + s.find("viewBox=\"0 0 ") + 13) < 900, "layout/frames_apart_opposite_row_orders");
        }
    }
    {
        // an empty subgraph inside another sits beside its parent's members, inside the parent's frame, and does not widen the layout
        std::string plain = svg_of("flowchart TB\n  subgraph P[\"P\"]\n    A --> B\n  end\n  X --> A");
        std::string nested = svg_of("flowchart TB\n  subgraph P[\"P\"]\n    A --> B\n    subgraph E[\"Empty\"]\n    end\n  end\n  X --> A");
        auto width_of = [](const std::string& s) { return std::atof(s.c_str() + s.find("viewBox=\"0 0 ") + 13); };
        check(count(nested, "class=\"subgraph\"") == 2 && has(nested, ">Empty<") && width_of(nested) < width_of(plain) + 160, "subgraph/empty_nested_beside_members");
    }
    {
        // a long label wraps (at 200 px, as Mermaid does) instead of making the node, the edge label or the whole picture wide
        std::string longtext(60, 'x');
        std::string words;
        for (int i = 0; i < 40; i++) words += "word ";
        auto width_of = [](const std::string& s) { return std::atof(s.c_str() + s.find("viewBox=\"0 0 ") + 13); };
        std::string jp;
        for (int i = 0; i < 80; i++) jp += "\xe3\x81\x82";  // あ x 80
        check(width_of(svg_of("flowchart TD\n  A[\"" + jp + "\"] --> B")) < 500, "wrap/flowchart_cjk_node");
        check(width_of(svg_of("flowchart TD\n  A[\"" + words + "\"] --> B")) < 500, "wrap/flowchart_words_node");
        check(width_of(svg_of("flowchart TD\n  A -->|" + words + "| B")) < 500, "wrap/flowchart_edge_label");
        check(width_of(svg_of("stateDiagram-v2\n  A --> B: " + words)) < 500 && width_of(svg_of("classDiagram\n  A --> B : " + words)) < 500 &&
                  width_of(svg_of("erDiagram\n  A ||--o{ B : \"" + words + "\"")) < 500,
              "wrap/edge_labels_of_state_class_er");
        check(width_of(svg_of("mindmap\n  root((r))\n    " + words)) < 700, "wrap/mindmap_node");
        check(width_of(svg_of("stateDiagram-v2\n  A: " + words + "\n  A --> B")) < 500, "wrap/state_description");
        check(width_of(svg_of("block-beta\n  columns 2\n  a[\"" + words + "\"] b")) < 700, "wrap/block_label");
    }
    {
        auto width_of = [](const std::string& s) { return std::atof(s.c_str() + s.find("viewBox=\"0 0 ") + 13); };
        // an edgeless member of a frame stays beside its neighbours instead of going to the far end of the row (was 1030)
        const std::string e4 =
            "flowchart TB\n  net((\"inet\"))\n  subgraph H[\"H\"]\n    subgraph D[\"D\"]\n      a[\"a\"]\n      b[\"b\"]\n      c[\"c\"]\n      d[\"d\"]\n    end\n"
            "    u[\"UTM\"]\n    subgraph PC[\"PC\"]\n      p1[\"P1\"]\n      p2[\"P2\"]\n    end\n    net --- u\n    u --- p2\n    u --- d\n  end\n";
        check(width_of(svg_of(e4)) < 800, "layout/edgeless_member_stays_near");
    }
    {
        std::string lab = svg_of("flowchart TD\n  A --\"Yes\"--> B\n  A --Maybe--> C\n  A -.near.-> D\n  A -- \"spaced\" --> E");
        check(!has(lab, "ERROR") && has(lab, ">Yes<") && has(lab, ">Maybe<") && has(lab, ">near<") && has(lab, ">spaced<") && !has(lab, "&quot;"), "edge/compact_and_quoted_labels");
    }
    {
        std::string nlq = svg_of("flowchart TD\n  A[\"a\nb\"] --> B");
        check(!has(nlq, "ERROR") && has(nlq, ">a<") && has(nlq, ">b<"), "node/newline_in_quotes");
    }
    check(has(svg_of("graph TD\nA-.->B"), "stroke-dasharray=\"4 4\""), "edge/dotted");
    check(has(svg_of("graph TD\nA==>B"), "stroke-width=\"2.5\""), "edge/thick");
    check(has(svg_of("graph TD\nA-->|yes|B"), ">yes<"), "edge/pipe_label");
    check(has(svg_of("graph TD\nA-- some text -->B"), ">some text<"), "edge/inline_label");
    check(count(svg_of("graph TD\nA~~~B"), "class=\"edge\"") == 0, "edge/invisible");
    check(count(svg_of("graph LR\nA-->B;B-->C"), "class=\"edge\"") == 2, "edge/semicolon");

    // --- nodes: shapes and labels ---
    check(has(svg_of("graph TD\nA((round))"), "<circle"), "shape/circle");
    check(has(svg_of("graph TD\nA{choice}"), "<polygon"), "shape/diamond");
    check(has(svg_of("graph TD\nA[(db)]"), "<path"), "shape/cylinder");
    check(has(svg_of("graph TD\nA([pill])"), "rx="), "shape/stadium");
    check(has(svg_of("graph TD\nA[\"quoted [text]\"]"), ">quoted [text]<"), "node/quoted_label");
    check(has(svg_of("graph TD\nA[line one<br/>line two]"), ">line two<"), "node/br_break");
    check(has(svg_of("graph TD\nA[a\xe6\x97\xa5\xe6\x9c\xac]-->B"), ">a\xe6\x97\xa5\xe6\x9c\xac<"), "node/cjk_label");
    check(count(svg_of("graph TD\nA[x] --> A"), "<g class=\"node\">") == 1, "node/redeclared_is_one_node");
    check(has(svg_of("graph TD\nA-->B\nstyle A fill:#ff0000"), "#ff0000"), "style/node_fill");
    check(has(svg_of("graph TD\nclassDef hot fill:#00ff00\nA:::hot-->B"), "#00ff00"), "style/class_def");
    check(has(svg_of("graph TD\nsubgraph one [First]\nA-->B\nend"), "class=\"subgraph\""), "subgraph/frame");
    check(has(svg_of("graph TD\nsubgraph one [First]\nA-->B\nend"), ">First<"), "subgraph/title");

    // --- frontmatter and init directives ---
    {
        std::string svg, err;
        mermaid::Options on;
        on.allow_directives = true;
        check(render("---\ntitle: T\n---\ngraph TD\nA-->B", svg, err), "front/skipped");
        check(render("%%{init: {\"theme\":\"dark\"}}%%\ngraph TD\nA-->B", svg, err) && !has(svg, "#1f2020"), "init/off_by_default");
        check(mermaid::render("%%{init: {\"theme\":\"dark\",\"themeVariables\":{\"primaryColor\":\"#123456\"}}}%%\ngraph TD\nA-->B", on, svg, err) && has(svg, "#123456"), "init/theme_variables");
        check(mermaid::render("---\nconfig:\n  theme: forest\n---\ngraph TD\nA-->B", on, svg, err) && has(svg, "#cde498"), "front/config_theme");
    }

    // --- classDef / class / style on the other box diagrams ---
    check(has(svg_of("stateDiagram-v2\nclassDef hot fill:#aa0001\nA --> B\nclass A hot"), "#aa0001"), "style/state_class");
    check(has(svg_of("stateDiagram-v2\nA:::hot --> B\nclassDef hot fill:#aa0002"), "#aa0002"), "style/state_triple_colon");
    check(has(svg_of("stateDiagram-v2\nA --> B\nstyle B stroke:#aa0003,stroke-width:3px"), "stroke-width=\"3\""), "style/state_direct");
    check(has(svg_of("classDiagram\nclass A\nclass B\nA --> B\nstyle A fill:#aa0004"), "#aa0004"), "style/class_style");
    check(has(svg_of("classDiagram\nclass A\nclassDef hot fill:#aa0005\ncssClass \"A\" hot"), "#aa0005"), "style/class_css_class");
    check(has(svg_of("erDiagram\nA ||--o{ B : has\nstyle A fill:#aa0006"), "#aa0006"), "style/er_style");
    check(has(svg_of("block-beta\ncolumns 2\na b\nstyle a fill:#aa0007"), "#aa0007"), "style/block_style");

    // --- treemap, radar, info ---
    {
        std::string tm = svg_of("treemap-beta\n\"A\"\n  \"a1\": 10\n  \"a2\": 30\n\"B\"\n  \"b1\": 20\n");
        check(count(tm, "class=\"leaf\"") == 3 && count(tm, "class=\"section\"") == 2, "treemap/items");
        check(has(tm, ">a2<"), "treemap/label");
        check(has(svg_of("treemap\n\"Only\": 5"), "class=\"leaf\""), "treemap/leaf_at_top");
        check(has(svg_of("treemap-beta\n\"A\": 1\n  \"b\": 2"), "ERROR"), "treemap/leaf_with_children");
        check(has(svg_of("treemap-beta\n\"A\"\n  \"b\": x"), "ERROR"), "treemap/bad_value");
        std::string rd = svg_of("radar-beta\naxis m[\"Math\"], s[\"Sci\"], e[\"Eng\"]\ncurve a[\"Alice\"]{85, 90, 80}\ncurve b[\"Bob\"]{s: 70, m: 75, e: 85}\nmax 100\ngraticule circle\nticks 4");
        check(count(rd, "class=\"curve\"") == 2 && count(rd, "<circle") == 4, "radar/curves_and_graticule");
        check(has(rd, ">Math<") && has(rd, ">Alice<"), "radar/labels");
        check(has(svg_of("radar-beta\naxis a, b\ncurve c{1,2}"), "ERROR"), "radar/needs_three_axes");
        check(has(svg_of("radar-beta\naxis a, b, c\ncurve c{1,2,3,4}"), "ERROR"), "radar/too_many_values");
        check(has(svg_of("info\nshowInfo"), ">v11<"), "info/banner");
    }

    // --- architecture ---
    {
        std::string ar = svg_of("architecture-beta\ngroup api(cloud)[API]\nservice db(database)[Database] in api\nservice server(server)[Server] in api\nservice gw(internet)[Gateway]\njunction j\ndb:L -- R:server\nserver:T -- B:j\ngw:R --> L:server");
        check(count(ar, "class=\"node\"") == 4 && count(ar, "class=\"group\"") == 1 && count(ar, "class=\"edge\"") == 3, "architecture/items");
        check(has(ar, ">Database<") && has(ar, ">API<"), "architecture/labels");
        check(count(ar, "<polygon") == 1, "architecture/one_arrow");
        check(!has(svg_of("architecture-beta\nservice a[A]\nservice b[B]\nservice c[C]\na:R -- L:b\nb:B -- T:c\nc{group}:R -- L:a"), "ERROR"), "architecture/group_flag_parses");
        check(has(svg_of("architecture-beta\nservice a[A]\na:R -- L:b"), "ERROR"), "architecture/unknown_service");
        check(has(svg_of("architecture-beta\nservice a[A] in nope"), "ERROR"), "architecture/unknown_group");
        check(has(svg_of("architecture-beta\nservice a[A]\nservice b[B]\na:X -- L:b"), "ERROR"), "architecture/bad_side");
        check(has(svg_of("architecture-beta\nservice a[A]\nservice b[B]"), "class=\"node\""), "architecture/no_edges");
    }

    // --- C4 ---
    {
        std::string c4 = svg_of("C4Context\ntitle Banking\nPerson(cust, \"Customer\", \"A customer, with a, comma\")\nEnterprise_Boundary(b0, \"Bank\") {\nSystem(sys, \"Internet Banking\", \"Lets customers pay\")\nSystemDb(db, \"Ledger\")\n}\nSystem_Ext(mail, \"Mail\")\nRel(cust, sys, \"Uses\", \"HTTPS\")\nRel(sys, db, \"Reads\")\nBiRel(sys, mail, \"Sends\")\nUpdateRelStyle(cust, sys, $textColor=\"red\")");
        check(count(c4, "class=\"node\"") == 4 && count(c4, "class=\"boundary\"") == 1 && count(c4, "class=\"edge\"") == 3, "c4/items");
        check(has(c4, ">Internet Banking<") && has(c4, ">[Person]<") && has(c4, ">[Software System]<") && has(c4, ">[HTTPS]<") && has(c4, ">Banking<"), "c4/labels");
        check(has(c4, "[Bank]") == false && has(c4, ">[ENTERPRISE]<"), "c4/boundary_type");
        check(has(svg_of("C4Container\nContainer(web, \"Web\", \"React\", \"UI\")\nContainerDb(d, \"DB\", \"Postgres\")\nRel(web, d, \"Reads\")"), ">[Container: React]<"), "c4/container_techn");
        check(has(svg_of("C4Dynamic\nContainer(a, \"A\")\nContainer(b, \"B\")\nRelIndex(1, a, b, \"call\")"), ">1: call<"), "c4/dynamic_index");
        check(has(svg_of("C4Context\nSystem(a, \"A\")\nRel(a, nope, \"x\")"), "ERROR"), "c4/unknown_element");
        check(has(svg_of("C4Context\nEnterprise_Boundary(b, \"B\") {\nSystem(a, \"A\")"), "ERROR"), "c4/unclosed_boundary");
        check(has(svg_of("C4Context\nWidget(a, \"A\")"), "ERROR"), "c4/unknown_kind");
    }

    // --- wardley ---
    {
        std::string tea = svg_of("wardley-beta\ntitle Tea Shop Value Chain\n\nanchor Business [0.95, 0.63]\ncomponent Cup of Tea [0.79, 0.61]\ncomponent Tea [0.63, 0.81]\ncomponent Hot Water [0.52, 0.80]\ncomponent Kettle [0.43, 0.35]\ncomponent Power [0.10, 0.70]\n\nBusiness -> Cup of Tea\nCup of Tea -> Tea\nCup of Tea -> Hot Water\nHot Water -> Kettle\nKettle -> Power\n\nevolve Kettle 0.62\nevolve Power 0.89\n\nnote \"Standardising power allows Kettles to evolve faster\" [0.30, 0.49]");
        check(has(tea, ">Tea Shop Value Chain<") && has(tea, ">Cup of Tea<") && has(tea, ">Genesis<") && has(tea, ">Commodity (+utility)<"), "wardley/labels");
        check(count(tea, "<line") == 5, "wardley/links");
        check(count(tea, "stroke=\"#d9534f\"") == 4, "wardley/evolve");
        check(has(tea, "Standardising power"), "wardley/note");
        std::string full = svg_of("wardley-beta\ntitle Software Platform Strategy\nsize [1100, 800]\n\nevolution Genesis@0.25 -> Custom@0.5 -> Product@0.75 -> Commodity@1.0\n\nanchor Customer [0.90, 0.95]\n\ncomponent \"Mobile App\" [0.80, 0.85] (build)\ncomponent \"Web App\" [0.75, 0.80] label [-60, 10] (build)\ncomponent \"API Gateway\" [0.70, 0.65] (buy)\ncomponent \"Auth Service\" [0.60, 0.55] (outsource)\ncomponent \"Database\" [0.50, 0.45] (buy) (inertia)\ncomponent \"Cloud Platform\" [0.30, 0.95] (market)\n\nCustomer -> \"Mobile App\"\n\"Mobile App\" -> \"API Gateway\"\n\"API Gateway\" -> \"Database\"\n\nevolve \"API Gateway\" 0.85\n\naccelerator \"Cloud Native\" [0.20, 0.85]\ndeaccelerator \"Legacy Data\" [0.45, 0.35]\n\nannotations [0.10, 0.20]\nannotation 1,[0.78, 0.82] \"User touchpoints\"\nannotation 2,[0.70, 0.60] \"Integration layer\"\n\nnote \"Build mobile-first experience\" [0.85, 0.90]");
        check(!has(full, "ERROR") && has(full, "height=\"800\"") && has(full, "1. User touchpoints") && has(full, ">Cloud Native<") && has(full, ">Legacy Data<"), "wardley/full");
        check(count(full, "stroke-width=\"3\"") == 1, "wardley/inertia");
        std::string pipe = svg_of("wardley-beta\ncomponent Database [0.40, 0.60]\n\npipeline Database {\n  component \"File System\" [0.25]\n  component \"SQL DB\" [0.50]\n}");
        check(has(pipe, ">File System<") && has(pipe, ">SQL DB<"), "wardley/pipeline");
        check(!has(svg_of("wardley-beta\ncomponent A [0.5, 0.5]\nA +'pays'> B"), ">pays<"), "wardley/unknown_end_is_skipped");
        check(has(svg_of("wardley-beta\ncomponent A [0.2, 0.2]\ncomponent B [0.6, 0.6]\nA +'pays'> B"), ">pays<"), "wardley/flow_label");
        check(has(svg_of("wardley-beta\ncomponent A"), "ERROR"), "wardley/missing_coordinates");
        check(has(svg_of("wardley-beta\npipeline A {\n  component B [0.1]"), "ERROR"), "wardley/unclosed_pipeline");
        check(has(svg_of("wardley-beta\nwidget"), "ERROR"), "wardley/unknown_line");
        check(has(svg_of("wardley-beta\ntitle Only"), "ERROR"), "wardley/empty");
    }

    // --- cynefin ---
    {
        std::string c = svg_of("cynefin-beta\n  title Incident Response\n\n  complex\n    \"Investigate root cause\"\n    \"Run chaos experiment\"\n\n  complicated\n    \"Analyze performance data\"\n\n  clear\n    \"Restart service\"\n\n  chaotic\n    \"Page on-call immediately\"\n\n  confusion\n    \"Unknown failure mode\"");
        check(has(c, ">Incident Response<") && has(c, ">Complex<") && has(c, ">Complicated<") && has(c, ">Clear<") && has(c, ">Chaotic<") && has(c, ">Confusion<"), "cynefin/domains");
        check(has(c, ">Investigate root cause<") && has(c, ">Page on-call immediately<") && has(c, ">Unknown failure mode<"), "cynefin/items");
        check(has(c, ">Probe - Sense - Respond<") && has(c, ">Best practice<"), "cynefin/descriptions");
        std::string t = svg_of("cynefin-beta\n  complex\n    \"a\"\n  clear\n  complex --> complicated : \"Pattern identified\"\n  clear --> chaotic : \"Complacency\"\n  complex --> complex : \"ignored\"");
        check(has(t, ">Pattern identified<") && has(t, ">Complacency<") && !has(t, ">ignored<"), "cynefin/transitions");
        check(!has(svg_of("cynefin-beta\n  title Cynefin Framework\n\n  complex\n  complicated\n  clear\n  chaotic"), "ERROR"), "cynefin/empty_domains");
        std::string many = svg_of("cynefin-beta\n  confusion\n    \"a\"\n    \"b\"\n    \"c\"\n    \"d\"\n    \"e\"");
        check(has(many, ">+2 more<"), "cynefin/confusion_overflow");
        check(has(svg_of("cynefin-beta\n  \"orphan\""), "ERROR"), "cynefin/item_without_domain");
        check(has(svg_of("cynefin-beta\n  complex\n  complex --> nowhere"), "ERROR"), "cynefin/unknown_domain");
        check(has(svg_of("cynefin-beta\n  hello"), "ERROR"), "cynefin/unknown_line");
    }

    // --- railroad ---
    {
        std::string json = svg_of("railroad-ebnf-beta\ntitle \"JSON Grammar\"\n\njson = element ;\nelement = object | array | string | number | \"true\" | \"false\" | \"null\" ;\nobject = \"{\" [ member ( \",\" member )* ] \"}\" ;\narray = \"[\" [ element ( \",\" element )* ] \"]\" ;\nmember = string \":\" element ;");
        check(!has(json, "ERROR") && has(json, ">JSON Grammar<") && has(json, ">json<") && has(json, ">object<") && has(json, ">true<") && has(json, ">null<"), "railroad/ebnf_json");
        check(count(json, "<circle") == 10, "railroad/start_and_end_markers");
        std::string iso = svg_of("railroad-ebnf-beta\nfile = { line } , [ \"end\" ] ;\nline = letter - \"x\" , ? any visible character ? ;\n(* a comment *) letter = \"a\" | \"b\" ;");
        check(has(iso, ">except<") && has(iso, ">any visible character<") && has(iso, ">end<") && !has(iso, "comment"), "railroad/ebnf_iso");
        check(!has(svg_of("railroad-ebnf-beta\na = b+ c* d? ; /* w3c */ b = \"b\" ; c = \"c\" ; d = \"d\" ;"), "ERROR"), "railroad/ebnf_w3c_suffixes");
        std::string abnf = svg_of("railroad-abnf-beta\ntitle \"Email Address\"\n\naddress = local-part \"@\" domain ;\nlocal-part = 1*( ALPHA / DIGIT / \".\" / \"-\" ) ;\ndomain = label *( \".\" label ) ;\nlabel = 1*( ALPHA / DIGIT / \"-\" ) ;");
        check(!has(abnf, "ERROR") && has(abnf, ">local-part<") && has(abnf, ">@<") && has(abnf, ">ALPHA<"), "railroad/abnf_email");
        std::string counts = svg_of("railroad-abnf-beta\nr = 3A 2*4B %x30-39 [ C ] ; ; a comment\ns = r =/ D ;");
        check(has(counts, "3 times") && has(counts, "2-4 times") && has(counts, ">%x30-39<"), "railroad/abnf_counts");
        check(has(svg_of("railroad-abnf-beta\nr = <free prose> ;"), ">free prose<"), "railroad/abnf_prose");
        std::string peg = svg_of("railroad-peg-beta\ntitle \"Calculator Grammar\"\n\nExpression <- Term ((\"+\" / \"-\") Term)* ;\nTerm <- Factor ((\"*\" / \"/\") Factor)* ;\nFactor <- Number / \"(\" Expression \")\" ;\nNumber <- Digit+ ;\nDigit <- \"0\" / \"1\" / \"2\" # a comment\n ;");
        check(!has(peg, "ERROR") && has(peg, ">Expression<") && has(peg, ">+<") && has(peg, ">Digit<") && !has(peg, "comment"), "railroad/peg_calculator");
        std::string pred = svg_of("railroad-peg-beta\nA <- !B &C . [a-z]+ ;");
        check(has(pred, ">not<") && has(pred, ">and<") && has(pred, ">any character<") && has(pred, ">[a-z]<"), "railroad/peg_predicates");
        std::string ir = svg_of("railroad-beta\ntitle Expression Grammar\n\nexpr = sequence(\n  nonterminal(\"term\"),\n  zeroOrMore(sequence(choice(terminal(\"+\"), terminal(\"-\")), nonterminal(\"term\")))\n) ;\nterm = oneOrMore(choice(nonterminal(\"digit\"), special(\"letter\"))) ;\nopt = optional(terminal(\"x\")) ;");
        check(!has(ir, "ERROR") && has(ir, ">Expression Grammar<") && has(ir, ">+<") && has(ir, ">letter<") && has(ir, ">x<"), "railroad/ir");
        check(has(svg_of("railroad-ebnf-beta\na = ( b ;"), "ERROR"), "railroad/unclosed_group");
        check(has(svg_of("railroad-ebnf-beta\na = \"x"), "ERROR"), "railroad/unclosed_string");
        check(has(svg_of("railroad-beta\na = widget(\"x\") ;"), "ERROR"), "railroad/unknown_constructor");
        check(has(svg_of("railroad-ebnf-beta\ntitle Nothing"), "ERROR"), "railroad/no_rules");
        check(has(svg_of("railroad-ebnf-beta\n= a ;"), "ERROR"), "railroad/missing_name");
    }

    // --- eventmodeling ---
    {
        std::string ex1 = svg_of("eventmodeling\n\ntf 01 ui CartUI\ntf 02 cmd AddItem [[AddItem01]]\ntf 03 evt ItemAdded [[ItemAdded]]\ntf 04 cmd AddItem [[AddItem02]]\ntf 05 evt ItemAdded [[ItemAdded]]\n\ndata AddItem01 {\n  description: 'john'\n  image: 'avatar_john'\n  price: 20.4\n}\n\ndata AddItem02 {\n  description: 'jack'\n  price: 12.5\n}\n\ndata ItemAdded {\n  description: string\n  price: number\n}");
        check(!has(ex1, "ERROR") && count(ex1, "class=\"frame ") == 5 && count(ex1, "class=\"relation\"") == 4, "eventmodeling/frames_and_inferred_relations");
        check(has(ex1, ">CartUI<") && has(ex1, ">UI / Automation<") && has(ex1, ">Command / Read Model<") && has(ex1, ">Events<"), "eventmodeling/lanes");
        check(has(ex1, ">description: 'john'<") && has(ex1, ">price: number<"), "eventmodeling/data_blocks");
        std::string ex2 = svg_of("eventmodeling\n\ntimeframe 01 ui CartUI\ntimeframe 02 command AddItem\ntimeframe 03 event ItemAdded\n\nresetframe 04 event External.InventoryChanged\ntimeframe 05 processor InventoryProcessor\ntimeframe 06 command ChangeInventory\ntimeframe 07 event Cart.InventoryChanged");
        check(!has(ex2, "ERROR") && count(ex2, "class=\"frame ") == 7 && count(ex2, "class=\"relation\"") == 5, "eventmodeling/reset_frame_stops_inference");
        check(has(ex2, ">External<") && has(ex2, ">Cart<") && has(ex2, ">InventoryChanged<"), "eventmodeling/namespaces_are_lanes");
        std::string ex3 = svg_of("eventmodeling\n\nrf 02 evt CartCreated\nrf 03 evt ItemAdded\nrf 04 evt ItemRemoved\nrf 05 evt CartCleared\ntf 01 rmo CartUI ->> 02 ->> 03 ->> 04 ->> 05");
        check(!has(ex3, "ERROR") && count(ex3, "class=\"relation\"") == 5, "eventmodeling/explicit_relations");
        std::string inl = svg_of("eventmodeling\ntf 01 cmd AddItem { description: string, price: number }");
        check(has(inl, ">description: string<") && has(inl, ">price: number<"), "eventmodeling/inline_data");
        check(has(svg_of("eventmodeling\ntf 01 ui A\ntf 01 ui B"), "ERROR"), "eventmodeling/duplicate_number");
        check(has(svg_of("eventmodeling\ntf 01 widget A"), "ERROR"), "eventmodeling/unknown_type");
        check(has(svg_of("eventmodeling\ntf 01 cmd A [[Nope]]"), "ERROR"), "eventmodeling/undefined_data");
        check(has(svg_of("eventmodeling\ntf 01 cmd A ->> 9"), "ERROR"), "eventmodeling/relation_to_nothing");
        check(has(svg_of("eventmodeling\nhello"), "ERROR"), "eventmodeling/unknown_line");
        check(has(svg_of("eventmodeling"), "ERROR"), "eventmodeling/empty");
    }

    // --- usecase ---
    {
        std::string ex1 = svg_of("usecase-beta\nCustomer --> Login\nactor Customer\nactor Admin(\"Main administrator\")\nLogin(\"Sign in\")\nReport[Generate report]\n\"Reset password\"\nAdmin --> Report");
        check(!has(ex1, "ERROR") && count(ex1, "class=\"actor\"") == 2 && count(ex1, "<ellipse") == 2 && has(ex1, ">Main administrator<") && has(ex1, ">Sign in<") && has(ex1, ">Generate report<") && has(ex1, ">Reset password<"), "usecase/actors_and_use_cases");
        check(count(ex1, "class=\"usecase\"") == 3 && count(ex1, "class=\"edge\"") == 2, "usecase/shapes_and_edges");
        std::string ex2 = svg_of("usecase-beta\nactor Admin\nactor Person\nCheckout\nPayment\nApplyCoupon\nAdmin --|> Person\nCheckout ..> : include Payment\nApplyCoupon ..> : extend Checkout\nApplyCoupon --|> Checkout");
        const std::string lq = "\xC2\xAB", rq = "\xC2\xBB";  // the guillemets of a stereotype
        check(!has(ex2, "ERROR") && has(ex2, ">" + lq + "include" + rq + "<") && has(ex2, ">" + lq + "extend" + rq + "<") && count(ex2, "class=\"edge\"") == 4, "usecase/include_extend_generalization");
        check(count(ex2, "stroke-dasharray=\"5 4\"") == 2, "usecase/dashed_relations");
        std::string ex3 = svg_of("usecase-beta\ndirection LR\naccTitle: Online ordering use cases\naccDescr {\n  A customer places an order through the storefront.\n  Staff review the order and inspect its data.\n}\nactor Customer(\"Customer\")\nactor Staff(\"Order staff\")@{ type: hollow, business: true } <<Employee>>\nsystemBoundary ordering[\"Ordering System\"]@{ type: package }:::system\n  Browse(\"Browse products\")\n  Checkout(\"Checkout\") <<Core>>:::critical\n  Payment(\"Process payment\")\n  Review[Review order]\nend\njson OrderData@{\n  \"status\": \"pending\",\n  \"items\": [{ \"name\": \"Book\", \"quantity\": 1 }],\n  \"total\": 29.95\n}:::data\nnote for Checkout \"`Validates the **cart** before payment`\"\nCustomer starts@-- \"places order\" ---> Checkout\nCustomer --> Browse\nCheckout pays@..> : include Payment\nStaff --> Review\nReview --> OrderData\nclassDef system stroke:#c8a02a,stroke-width:2px\nclassDef critical stroke:#c33,stroke-width:3px\nclassDef data stroke:#3572a5\nstarts@{ animation: fast }\nstyle pays stroke:#6b46c1,stroke-width:2px");
        check(!has(ex3, "ERROR") && has(ex3, ">Ordering System<") && has(ex3, ">" + lq + "Core" + rq + "<") && has(ex3, ">" + lq + "Employee" + rq + "<") && has(ex3, ">places order<"), "usecase/complete_example");
        check(has(ex3, ">items[0].name<") && has(ex3, ">Book<") && has(ex3, ">29.95<") && count(ex3, "class=\"json\"") == 1, "usecase/json_table");
        check(has(ex3, "stroke=\"#c33\"") && has(ex3, "stroke=\"#6b46c1\"") && has(ex3, "stroke=\"#c8a02a\""), "usecase/styles");
        check(count(ex3, "class=\"note\"") == 1 && has(ex3, "Validates the cart before payment") && count(ex3, "class=\"note-link\"") == 1, "usecase/note");
        check(count(svg_of("usecase-beta\nA --o B\nB x-- C\nC <-- D\nD -- E"), "<circle") >= 1, "usecase/end_marks");
        check(has(svg_of("usecase-beta\nactor A\nsystemBoundary b\n  actor B\n  systemBoundary c\n  end\nend"), "ERROR"), "usecase/nested_boundary");
        check(has(svg_of("usecase-beta\nsystemBoundary b\n  A"), "ERROR"), "usecase/unclosed_boundary");
        check(has(svg_of("usecase-beta\nactor A@{ fillColor: red }"), "ERROR"), "usecase/unknown_actor_key");
        check(has(svg_of("usecase-beta\nA --> B -> C"), "ERROR"), "usecase/not_a_relationship");
        check(has(svg_of("usecase-beta"), "ERROR"), "usecase/empty");
    }

    // --- swimlanes, agentflow ---
    {
        std::string sw = svg_of("swimlane-beta LR\n  subgraph Customer\n    request[Request service]\n    receive[Receive update]\n  end\n\n  subgraph Support\n    triage[Triage request]\n    answer[Send answer]\n  end\n\n  subgraph Engineering\n    investigate[Investigate issue]\n    fix[Prepare fix]\n  end\n\n  request --> triage\n  triage -->|Known issue| answer\n  triage -->|Needs code change| investigate\n  investigate --> fix --> answer\n  answer --> receive");
        check(!has(sw, "ERROR") && count(sw, "class=\"lane\"") == 3 && count(sw, "class=\"edge\"") == 6, "swimlane/lanes_and_edges");
        check(has(sw, ">Customer<") && has(sw, ">Support<") && has(sw, ">Engineering<") && has(sw, ">Known issue<") && has(sw, ">Prepare fix<"), "swimlane/labels");
        check(!has(sw, "class=\"subgraph\""), "swimlane/lanes_replace_frames");
        std::string tb = svg_of("swimlane-beta\n  subgraph ops [Operations]\n    intake[Receive request]\n    plan[Plan work]\n  end\n  subgraph legal [Legal]\n    review[Review contract]\n  end\n  intake --> plan --> review\n  classDef attention fill:#fff2cc,stroke:#d6a500,color:#111;\n  class review attention;");
        check(!has(tb, "ERROR") && count(tb, "class=\"lane\"") == 2 && has(tb, ">Operations<") && has(tb, "fill=\"#fff2cc\""), "swimlane/top_down_and_styles");
        std::string shapes = svg_of("swimlane-beta LR\n  subgraph Intake\n    start([Start])\n    task[Do work]\n    fix[Fix issues]\n  end\n  subgraph Review\n    decision{Ready?}\n  end\n  subgraph Complete\n    done((Done))\n  end\n  start --> task --> decision\n  decision -->|Yes| done\n  decision -->|No| fix\n  fix --> task");
        check(!has(shapes, "ERROR") && count(shapes, "class=\"lane\"") == 3 && count(shapes, "<polygon") >= 1, "swimlane/shapes_and_cycle");
        check(has(svg_of("swimlane-beta LR"), "ERROR"), "swimlane/empty");
        std::string loose = svg_of("swimlane-beta\n  subgraph A\n    a1\n  end\n  a1 --> outside");
        check(count(loose, "class=\"lane\"") == 2, "swimlane/nodes_outside_a_lane");

        std::string ag = svg_of("agentflow-beta TB\n  flow reviewer[\"Review Agent\"]\n    changes[\"Gather changes\"]@{ shape: input }\n    analyse[\"Analyse diff\"]@{ shape: task }\n    lint[\"run_linter\"]@{ shape: tool }\n    ok[\"Clean?\"]@{ shape: decision }\n\n    changes --> analyse --> lint --> ok\n  end");
        check(!has(ag, "ERROR") && has(ag, ">Review Agent<") && has(ag, ">Gather changes<") && has(ag, ">run_linter<") && has(ag, ">Clean?<") && count(ag, "class=\"edge\"") == 3, "agentflow/flow_and_shapes");
        check(count(ag, "class=\"subgraph\"") == 1 && count(ag, "<polygon") >= 2, "agentflow/container_and_shape_kinds");
        std::string ed = svg_of("agentflow-beta TB\n  check[\"Tests pass?\"]@{ shape: decision }\n  ship[\"Ship it\"]@{ shape: action }\n  fix[\"Fix the build\"]@{ shape: task }\n  logs[\"Build logs\"]@{ shape: refdoc }\n\n  check -- yes --> ship\n  check -- no --> fix\n  fix --x check\n  fix -.- logs");
        check(!has(ed, "ERROR") && has(ed, ">yes<") && has(ed, ">no<") && count(ed, "class=\"edge\"") == 4, "agentflow/edges");
        std::string big = svg_of("agentflow-beta TB\n  connector llm[\"LLM API\"]\n  llm@{ protocol: \"http\", endpoint: \"https://api.example.com/chat\" }\n\n  flow coffee_team[\"Coffee Team\"]\n    city[\"city\"]@{ shape: input, value: \"Stockholm\" }\n\n    flow researcher[\"Researcher\"]\n      research[\"research_location\"]@{ shape: tool, params: \"city :: String\", returns: \"Report\" }\n      write[\"write_copy\"]@{ shape: tool, connectorRef: \"llm.chat\", returns: \"CoffeeCopy\" }\n      city --> research --> write\n    end\n    researcher@{ instruction: \"Research the city and draft English coffee copy citing sources.\" }\n\n    flow designer[\"Designer\"]\n      render[\"generate_html\"]@{ shape: tool, connectorRef: \"llm.chat\", returns: \"String\" }\n      brand[\"Nordic Brand Guide\"]@{ shape: refdoc }\n      render -.- brand\n    end\n\n    researcher --> designer\n  end");
        check(!has(big, "ERROR") && has(big, ">LLM API<") && has(big, ">Coffee Team<") && has(big, ">Researcher<") && has(big, ">Designer<") && has(big, ">generate_html<"), "agentflow/nested_flows_and_connector");
        std::string global = svg_of("agentflow-beta LR\n  global\n    a[\"A\"]\n    b[\"B\"]\n  end\n  a --> b");
        check(!has(global, "ERROR") && count(global, "class=\"subgraph\"") == 0 && has(global, ">A<"), "agentflow/global_draws_no_frame");
        check(has(svg_of("agentflow-beta\n  a --> "), "ERROR") || count(svg_of("agentflow-beta\n  a --> "), "class=\"node\"") >= 1, "agentflow/incomplete_edge_is_handled");
    }

    // --- treeView, ishikawa, venn ---
    {
        std::string tv = svg_of("treeView-beta\n  \"packages\"\n    \"core\"\n      \"src\"\n    \"cli\"\n  \"README.md\"");
        check(has(tv, ">packages<") && has(tv, ">src<") && has(tv, ">README.md<"), "treeview/labels");
        check(count(tv, "<path") == 5, "treeview/icons");
        check(has(svg_of("treeView-beta"), "ERROR"), "treeview/empty");
        std::string ik = svg_of("ishikawa-beta\n  Blurry photo\n    Process\n      Out of focus\n      Slow shutter\n    User\n      Shaky hands\n    Equipment");
        check(has(ik, ">Blurry photo<") && has(ik, ">Out of focus<") && has(ik, ">Equipment<"), "ishikawa/labels");
        check(count(ik, "stroke-width=\"2\" stroke-linecap") == 3, "ishikawa/bones");
        check(count(svg_of("ishikawa-beta\n  A\nB\nC"), "stroke-linecap") == 3, "ishikawa/effect_and_categories_at_one_indent");
        check(has(svg_of("ishikawa-beta"), "ERROR"), "ishikawa/empty");
        std::string vn = svg_of("venn-beta\n  title Overlap\n  set A[\"Frontend\"]:20\n  set B[\"Backend\"]:30\n  union A,B[\"Fullstack\"]\n    text t1[\"TypeScript\"]");
        check(count(vn, "class=\"set\"") == 2 && has(vn, ">Fullstack<") && has(vn, ">TypeScript<") && has(vn, ">Overlap<"), "venn/two_sets");
        check(count(svg_of("venn-beta\n  set A\n  set B\n  set C\n  union A,B,C[\"All\"]"), "class=\"set\"") == 3, "venn/three_sets");
        check(has(svg_of("venn-beta\n  set A\n  union A,Z"), "ERROR"), "venn/unknown_set");
        check(has(svg_of("venn-beta\n  text x"), "ERROR"), "venn/text_without_owner");
    }

    // --- accTitle / accDescr ---
    {
        std::string a = svg_of("graph TD\naccTitle: Order flow\naccDescr: A leads to B\nA-->B");
        check(has(a, "<title>Order flow</title>") && has(a, "<desc>A leads to B</desc>") && count(a, "class=\"edge\"") == 1, "acc/single_line");
        std::string m = svg_of("sequenceDiagram\naccTitle Sign in\naccDescr {\nThe user signs in.\nThen sees the home page.\n}\nA->>B: hi");
        check(has(m, "<title>Sign in</title>") && has(m, "<desc>The user signs in.\nThen sees the home page.</desc>") && has(m, ">hi<"), "acc/multi_line");
        check(has(svg_of("pie\naccTitle: <Pets> & more\n\"a\": 1"), "<title>&lt;Pets&gt; &amp; more</title>"), "acc/escaped");
        check(!has(svg_of("graph TD\nA-->B"), "<title>"), "acc/absent_means_no_title");
        check(has(svg_of("stateDiagram-v2\naccDescr: only a description\nA --> B"), "<desc>only a description</desc>"), "acc/descr_only");
    }

    // --- named themes ---
    {
        std::string svg, err;
        mermaid::Options o;
        check(mermaid::apply_theme("Nord", o) && o.bg == "#2e3440" && o.accent == "#88c0d0", "theme/nord");
        check(mermaid::apply_theme("solarized_dark", o) && o.bg == "#002b36", "theme/underscore_name");
        check(mermaid::apply_theme("default", o) && o.bg == "#ffffff", "theme/default_is_light");
        mermaid::Options before = o;
        check(!mermaid::apply_theme("no-such-theme", o) && o.bg == before.bg, "theme/unknown_leaves_options");
        check(mermaid::theme_names().size() >= 10, "theme/names");
        mermaid::Options on;
        on.allow_directives = true;
        check(mermaid::render("%%{init: {\"theme\":\"dracula\"}}%%\ngraph TD\nA-->B", on, svg, err) && has(svg, "#343746"), "theme/init_directive_preset");
        check(mermaid::render("%%{init: {\"theme\":\"dracula\",\"themeVariables\":{\"primaryColor\":\"#abcdef\"}}}%%\ngraph TD\nA-->B", on, svg, err) && has(svg, "#abcdef") && !has(svg, "#343746"), "theme/variables_override_preset");
    }

    // --- an edge does not run along the border of a subgraph frame ---
    {
        std::string svg = svg_of("flowchart TD\n subgraph Client\n  Browser([Web Browser])\n  Mobile[/Mobile App/]\n end\n subgraph Backend\n  Gateway{API Gateway}\n  Auth[[Auth Service]]\n end\n Browser --> Gateway\n Mobile --> Gateway\n Gateway --> Auth");
        std::vector<double> borders;  // top and bottom of each frame
        for (size_t at = svg.find("class=\"subgraph\""); at != std::string::npos; at = svg.find("class=\"subgraph\"", at + 1)) {
            size_t r = svg.find("<rect", at);
            double y = 0, h = 0;
            size_t py = svg.find(" y=\"", r), ph = svg.find(" height=\"", r);
            if (py != std::string::npos && ph != std::string::npos) {
                y = std::atof(svg.c_str() + py + 4);
                h = std::atof(svg.c_str() + ph + 9);
                borders.push_back(y);
                borders.push_back(y + h);
            }
        }
        check(borders.size() == 4, "frame/two_frames");
        bool clear = true;
        int bends = 0;
        for (size_t at = svg.find("<polyline class=\"edge\" points=\""); at != std::string::npos; at = svg.find("<polyline class=\"edge\" points=\"", at + 1)) {
            const char* s = svg.c_str() + at + 31;
            std::vector<std::pair<double, double>> pts;
            while (*s && *s != '"') {
                char* end;
                double x = std::strtod(s, &end);
                double y = std::strtod(end + 1, &end);
                pts.push_back({x, y});
                s = *end == ' ' ? end + 1 : end;
            }
            for (size_t k = 1; k + 2 < pts.size(); k++) {
                if (std::fabs(pts[k].second - pts[k + 1].second) > 1e-6) continue;
                bends++;
                for (double b : borders)
                    if (std::fabs(pts[k].second - b) < 3) clear = false;
            }
        }
        check(bends >= 2, "frame/edges_have_bends");
        check(clear, "frame/edge_bend_clear_of_frame_border");
    }

    // --- an edge label does not sit on the border of a composite state ---
    {
        std::string svg = svg_of("stateDiagram-v2\n [*] --> Pending\n Pending --> Paid: Payment Received\n Paid --> Processing: Prepare Items\n state Processing {\n  [*] --> Packing\n  Packing --> Shipping: Courier Picked Up\n }\n Processing --> Done\n Done --> [*]");
        size_t comp = svg.find("class=\"composite\"");
        size_t text = svg.find(">Prepare Items<");
        size_t grp = text == std::string::npos ? std::string::npos : svg.rfind("<g class=\"edge-label\">", text);
        check(comp != std::string::npos && grp != std::string::npos, "composite/label_found");
        if (comp != std::string::npos && grp != std::string::npos) {
            double top = std::atof(svg.c_str() + svg.find(" y=\"", svg.find("<rect", comp)) + 4);
            size_t r = svg.find("<rect", grp);
            double ly = std::atof(svg.c_str() + svg.find(" y=\"", r) + 4), lh = std::atof(svg.c_str() + svg.find(" height=\"", r) + 9);
            check(top - (ly + lh) >= 6 || ly - top >= 6, "composite/label_clear_of_border");
        }
    }

    // --- the official-colour themes: node, group, edge and arrow colours ---
    {
        std::string svg, err;
        const char* flow = "flowchart LR\n subgraph G[Group]\n A --> B\n end";
        struct Official { const char* theme; const char* surface; const char* border; const char* line; const char* group; };
        const Official official[] = {
            {"light", "#ececff", "#9370db", "#333333", "#ffffde"},
            {"dark", "#1f2020", "#cccccc", "#d3d3d3", "#474949"},
            {"forest", "#cde498", "#abb594", "#000000", "#cdffb2"},
            {"neutral", "#eeeeee", "#d5d5d5", "#666666", "#fcfcfc"},
        };
        for (const Official& t : official) {
            mermaid::Options o;
            mermaid::apply_theme(t.theme, o);
            bool ok = mermaid::render(flow, o, svg, err);
            std::string name = std::string("theme/official/") + t.theme;
            check(ok && has(svg, std::string("class=\"node\">\n<rect x=\"") ) && has(svg, std::string("fill=\"") + t.surface + "\" stroke=\"" + t.border + "\""), name + "/node");
            check(ok && has(svg, std::string("class=\"edge\"") ) && has(svg, std::string("stroke=\"") + t.line + "\""), name + "/edge");
            check(ok && has(svg, std::string("class=\"subgraph\">\n<rect x=\"") ) && has(svg, std::string("fill=\"") + t.group + "\" stroke=\"" + t.border + "\""), name + "/group");
            check(ok && has(svg, std::string("fill=\"") + t.line + "\" stroke=\"" + t.line + "\" stroke-width=\"0.75\""), name + "/arrow_follows_line");
        }
        // pie, xychart and sequence notes take their colours from the theme
        {
            mermaid::Options light, dark;
            mermaid::apply_theme("light", light);
            mermaid::apply_theme("dark", dark);
            std::string pie = "pie\n \"a\": 3\n \"b\": 5\n \"c\": 2";
            check(mermaid::render(pie, light, svg, err) && has(svg, "fill=\"#ececff\" fill-opacity=\"0.7\" stroke=\"#000000\"") && has(svg, "fill=\"#ffffde\" fill-opacity=\"0.7\"") && has(svg, "fill=\"#b5ff20\" fill-opacity=\"0.7\""), "theme/official/pie_scale");
            check(mermaid::render(pie, dark, svg, err) && has(svg, "fill=\"#0b0000\" fill-opacity=\"0.7\"") && has(svg, "fill=\"#4d1037\" fill-opacity=\"0.7\""), "theme/official/pie_scale_dark");
            std::string xy = "xychart-beta\n x-axis [a, b, c]\n bar [1, 2, 3]\n line [3, 2, 1]";
            check(mermaid::render(xy, light, svg, err) && has(svg, "fill=\"#ececff\" fill-opacity=\"1\"") && has(svg, "class=\"series\"") && has(svg, "stroke=\"#8493a6\"") && !has(svg, "<circle"), "theme/official/xychart_plot");
            std::string st = "stateDiagram-v2\n [*] --> A\n A --> B: go\n state B {\n  [*] --> C\n }";
            check(mermaid::render(st, light, svg, err) && has(svg, "fill=\"#ffffff\" stroke=\"#9370db\"") && has(svg, "height=\"26\" rx=\"5\" ry=\"5\" fill=\"#ececff\""), "theme/official/composite_state");
            check(mermaid::render(st, light, svg, err) && has(svg, "fill=\"#f4f4f4\" stroke=\"#f4f4f4\""), "theme/official/label_without_outline");
            mermaid::Options forest;
            mermaid::apply_theme("forest", forest);
            check(mermaid::render("sequenceDiagram\n A->>B: hi", forest, svg, err) && has(svg, "fill=\"#cde498\" stroke=\"#a6cf47\""), "theme/official/actor_border");
            std::string seq = "sequenceDiagram\n A->>B: hi\n Note over A,B: hello";
            check(mermaid::render(seq, light, svg, err) && has(svg, "fill=\"#fff5ad\" stroke=\"#aaaa33\""), "theme/official/note");
            check(mermaid::render(seq, dark, svg, err) && has(svg, "fill=\"#474949\" stroke=\"#2f2f2f\""), "theme/official/note_dark");
        }
        mermaid::Options custom;
        custom.arrow = "#ff0000";
        custom.group_fill = "#00ff00";
        custom.label_fill = "#0000ff";
        check(mermaid::render("flowchart LR\n subgraph G[g]\n A -->|x| B\n end", custom, svg, err) && has(svg, "fill=\"#ff0000\" stroke=\"#ff0000\"") && has(svg, "fill=\"#00ff00\"") && has(svg, "fill=\"#0000ff\""), "theme/explicit_arrow_group_label");
        mermaid::Options on;
        on.allow_directives = true;
        check(mermaid::render("%%{init: {\"theme\":\"light\",\"themeVariables\":{\"lineColor\":\"#123456\"}}}%%\ngraph TD\nA-->B", on, svg, err) && has(svg, "fill=\"#123456\" stroke=\"#123456\""), "theme/line_variable_moves_arrow");
        check(mermaid::render("%%{init: {\"theme\":\"light\",\"themeVariables\":{\"lineColor\":\"#123456\",\"arrowheadColor\":\"#654321\"}}}%%\ngraph TD\nA-->B", on, svg, err) && has(svg, "fill=\"#654321\" stroke=\"#654321\""), "theme/arrowhead_variable");
        check(mermaid::render("%%{init: {\"themeVariables\":{\"mainBkg\":\"#abc123\",\"nodeBorder\":\"#def456\"}}}%%\ngraph TD\nA-->B", on, svg, err) && has(svg, "#abc123") && has(svg, "#def456"), "theme/variable_aliases");
        check(mermaid::render("%%{init: {\"themeVariables\":{\"pie1\":\"#111111\",\"pie2\":\"#222222\"}}}%%\npie\n\"a\" : 1\n\"b\" : 2", on, svg, err) && has(svg, "#111111") && has(svg, "#222222"), "theme/pie_series_variables");
        check(mermaid::render("%%{init: {\"themeVariables\":{\"noteBkgColor\":\"#fedcba\"}}}%%\nsequenceDiagram\nA->>B: hi\nNote right of B: n", on, svg, err) && has(svg, "#fedcba"), "theme/note_variable");
        mermaid::Options plain;
        check(mermaid::render("flowchart LR\n  A[\"`**Bold** and *italic*\n  second line`\"] --> B", plain, svg, err) && !has(svg, "ERROR") && has(svg, ">Bold and italic<") && has(svg, ">second line<") && !has(svg, "**"), "markdown_string/flowchart");
    }

    // --- the themes of this engine's own (not the official ones) keep their output ---
    // A hash of the SVG per theme and diagram. A change that is meant to alter these themes updates the table.
    {
        const char* const diagrams[] = {
            "flowchart LR\n subgraph G[Group]\n A[Start] --> B{ok?}\n end\n B -->|yes| C((End))\n classDef hot fill:#f96\n class A hot",
            "sequenceDiagram\n participant A\n participant B\n A->>B: hi\n Note over A,B: note\n activate B\n B-->>A: back\n deactivate B",
            "classDiagram\n class Animal {\n +name\n +eat()\n }\n Animal <|-- Dog",
            "pie\n \"a\": 3\n \"b\": 5\n \"c\": 2",
            "gantt\n dateFormat YYYY-MM-DD\n section S\n A :done, a1, 2024-01-01, 3d\n B :active, a2, after a1, 4d\n C :crit, a3, after a2, 2d",
            "stateDiagram-v2\n [*] --> Idle\n Idle --> Busy: go\n Busy --> [*]",
        };
        struct Frozen { const char* theme; unsigned long long hash[6]; };
        const Frozen frozen[] = {
            {"nord", {11243782259192426327ull, 2354812876712625435ull, 7440896151333172490ull, 3905288298567241074ull, 175437596168651868ull, 9751055940604640942ull}},
            {"dracula", {9173676882967520079ull, 2790671306747882490ull, 7115237374810826030ull, 1716523713338679796ull, 15250715627772429097ull, 15813959643653013916ull}},
            {"solarized-light", {17722543342328864403ull, 258502525475343896ull, 10925943474433918076ull, 14190747636729263506ull, 1066096645479023495ull, 10785765333670782637ull}},
            {"solarized-dark", {12961002802899193158ull, 8039991062857688804ull, 13152149386711216853ull, 16079790508120439295ull, 16433683437209907014ull, 2925557938494227877ull}},
            {"rose-pine", {44304171628481796ull, 5401919379311402362ull, 10277657207745800466ull, 1101500477800157097ull, 5157649815519468525ull, 14185117963999280394ull}},
            {"sepia", {9767951103982456000ull, 17699003364794791736ull, 17433353230813544808ull, 8050788171094520827ull, 14193181199171495114ull, 13175144670565691982ull}},
        };
        for (const Frozen& f : frozen) {
            for (int d = 0; d < 6; d++) {
                mermaid::Options o;
                mermaid::apply_theme(f.theme, o);
                std::string svg, err;
                bool ok = mermaid::render(diagrams[d], o, svg, err);
                unsigned long long h = 1469598103934665603ull;  // FNV-1a
                for (unsigned char c : svg) h = (h ^ c) * 1099511628211ull;
                check(ok && h == f.hash[d], std::string("theme/frozen/") + f.theme + "/" + std::to_string(d) + " hash=" + std::to_string(h));
            }
        }
    }

    // --- modes: strict, compat, recover ---
    {
        std::string svg, err;
        std::vector<std::string> warn;
        mermaid::Options compat, recover;
        compat.mode = mermaid::Options::Mode::Compat;
        recover.mode = mermaid::Options::Mode::Recover;
        check(!render("flowchrt TD\nA-->B", svg, err) && has(err, "did you mean `flowchart`"), "mode/strict_hint");
        check(!render("Flowchart TD\nA-->B", svg, err), "mode/strict_case");
        check(mermaid::render("Flowchart TD\nA-->B", compat, svg, err, &warn) && has(svg, "recovered") && warn.size() == 1, "mode/compat_case");
        check(!mermaid::render("flowchrt TD\nA-->B", compat, svg, err), "mode/compat_no_typos");
        check(mermaid::render("flowchrt TD\nA-->B", recover, svg, err) && count(svg, "class=\"edge\"") == 1, "mode/recover_typo");
        check(mermaid::render("\xEF\xBB\xBFgraph TD\r\nA-->B\r\n", compat, svg, err), "mode/compat_bom_crlf");
        check(!render("stateDiagram-v2\nstate X {\nA --> B", svg, err) && has(err, "unclosed"), "mode/strict_unclosed");
        warn.clear();
        check(mermaid::render("stateDiagram-v2\nstate X {\nA --> B", compat, svg, err, &warn) && has(svg, "class=\"composite\"") && has(warn[0], "missing `}`"), "mode/compat_closes_block");
        warn.clear();
        check(!mermaid::render("pie\n\"a\" : 1\nnonsense\n\"b\" : 2", compat, svg, err), "mode/compat_keeps_bad_line_an_error");
        check(mermaid::render("pie\n\"a\" : 1\nnonsense\n\"b\" : 2", recover, svg, err, &warn) && count(svg, "class=\"slice\"") == 2 && has(warn[0], "skipped `nonsense`"), "mode/recover_skips_line");
        check(!mermaid::render("zzzzzz\nA-->B", recover, svg, err) && has(err, "unsupported"), "mode/recover_gives_up");
    }

    // --- syntax found in the Mermaid documentation ---
    {
        std::string bx = svg_of("sequenceDiagram\nbox Purple Team\nparticipant A\nparticipant B\nend\nparticipant C\nA->>B: hi\nB->>C: yo");
        check(has(bx, ">Team<") && !has(bx, ">Purple Team<") && has(bx, ">C<"), "seq/box_title_without_colour");
        check(has(svg_of("sequenceDiagram\ncreate participant D as Dee\nA->>D: hi\ndestroy D\nlink A: Dash @ https://x.example\nA->>A: self"), ">Dee<"), "seq/create_destroy_link");
        check(!has(svg_of("gantt\ndateFormat YYYY-MM-DD\nsection S\nA :a1, 2020-01-01, 3d\nB :until z\nZ :z, 2020-01-10, 1d"), "ERROR"), "gantt/until");
        check(has(svg_of("quadrantChart\nx-axis L --> R\nP:::c1: [0.5, 0.5] radius: 10\nclassDef c1 color: #109060"), ">P<"), "quadrant/class_def_and_style");
        check(count(svg_of("flowchart LR\nA o--o B\nC x--x D"), "class=\"edge\"") == 2, "flowchart/start_markers");
    }

    // --- size limits ---
    {
        std::string svg, err, big = "flowchart TD\n";
        for (int k = 0; k < 120; k++) big += "n" + std::to_string(k) + " --> n" + std::to_string(k + 1) + "\n";
        mermaid::Options small;
        small.max_lines = 100;
        check(!mermaid::render(big, small, svg, err) && has(err, "too many lines") && has(err, "121"), "limits/lines");
        small.max_lines = 0;
        check(mermaid::render(big, small, svg, err), "limits/zero_lifts_the_limit");
        mermaid::Options bytes;
        bytes.max_source_bytes = 50;
        check(!mermaid::render(big, bytes, svg, err) && has(err, "too large"), "limits/bytes");
        // comments and blank lines are free
        std::string chatty = "flowchart TD\n";
        for (int k = 0; k < 300; k++) chatty += "%% note\n\n";
        chatty += "A-->B\n";
        mermaid::Options few;
        few.max_lines = 5;
        check(mermaid::render(chatty, few, svg, err), "limits/comments_and_blank_lines_are_free");
        check(!render("pie\n" + std::string(250000, ' ') + "\"a\": 1", svg, err) && has(err, "too large"), "limits/default_bytes");
    }

    // --- errors ---
    {
        std::string svg, err;
        check(!render("zenuml", svg, err) && has(err, "unsupported"), "error/unsupported");
        check(!render("", svg, err), "error/empty");
        check(!render("graph TD\nA -->", svg, err), "error/dangling_edge");
    }

    // --- layout ---
    {
        auto r = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::TD);
        check(r.center[1].y > r.center[0].y + 30, "layout/td_goes_down");
        check(std::fabs(r.center[1].x - r.center[0].x) < 0.5, "layout/td_aligned");
        check(r.points[0].size() == 2, "layout/straight_edge_has_two_points");
        auto lr = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::LR);
        check(lr.center[1].x > lr.center[0].x + 60, "layout/lr_goes_right");
        auto bt = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::BT);
        check(bt.center[1].y < bt.center[0].y - 30, "layout/bt_goes_up");
        auto rl = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::RL);
        check(rl.center[1].x < rl.center[0].x - 60, "layout/rl_goes_left");
        check(r.center[0].x - 30 >= -0.01 && r.center[0].y - 15 >= -0.01, "layout/origin_is_top_left");
    }
    {
        // a -> b -> c and a -> c: the long edge must not run through b
        auto r = mermaid::layout_layered({box(60, 30), box(60, 30), box(60, 30)}, {edge(0, 1), edge(1, 2), edge(0, 2)}, Direction::TD);
        bool through = false;
        double bl = r.center[1].x - 30, br = r.center[1].x + 30, bt = r.center[1].y - 15, bb = r.center[1].y + 15;
        const auto& pts = r.points[2];
        for (size_t i = 0; i + 1 < pts.size(); i++) {
            double x = pts[i].x, y0 = std::min(pts[i].y, pts[i + 1].y), y1 = std::max(pts[i].y, pts[i + 1].y);
            if (std::fabs(pts[i].x - pts[i + 1].x) < 0.01 && x > bl && x < br && y1 > bt && y0 < bb) through = true;
        }
        check(!through, "layout/long_edge_avoids_node");
        check(r.center[2].y > r.center[1].y && r.center[1].y > r.center[0].y, "layout/three_layers");
    }
    {
        // a cycle: every edge is routed, the layout terminates, the nodes get different layers
        auto r = mermaid::layout_layered({box(60, 30), box(60, 30), box(60, 30)}, {edge(0, 1), edge(1, 2), edge(2, 0)}, Direction::TD);
        check(r.points[2].size() >= 2, "layout/cycle_edge_routed");
        check(r.center[0].y != r.center[2].y, "layout/cycle_layers");
        // the reversed edge still runs from its `from` node to its `to` node
        check(std::fabs(r.points[2].front().y - r.center[2].y) < 40 && std::fabs(r.points[2].back().y - r.center[0].y) < 40,
              "layout/cycle_edge_direction");
    }
    {
        auto r = mermaid::layout_layered({box(60, 30)}, {edge(0, 0)}, Direction::TD);
        check(r.points[0].size() == 4, "layout/self_loop");
        // siblings do not overlap
        auto s = mermaid::layout_layered({box(60, 30), box(80, 30), box(70, 30)}, {edge(0, 1), edge(0, 2)}, Direction::TD);
        check(std::fabs(s.center[1].x - s.center[2].x) >= (80 + 70) / 2.0, "layout/siblings_do_not_overlap");
        check(std::fabs(s.center[0].x - (s.center[1].x + s.center[2].x) / 2) < 30, "layout/parent_between_children");
    }
    {
        LayoutEdge e = edge(0, 1);
        e.label_w = 40;
        e.label_h = 30;
        auto lab = mermaid::layout_layered({box(60, 30), box(60, 30)}, {e}, Direction::TD);
        auto plain = mermaid::layout_layered({box(60, 30), box(60, 30)}, {edge(0, 1)}, Direction::TD);
        check(lab.center[1].y - lab.center[0].y > plain.center[1].y - plain.center[0].y + 29, "layout/label_gets_room");
    }
    {
        // a group keeps its members together, and nodes outside it stay out of its box
        std::vector<LayoutNode> ns(6, box(60, 30));
        ns[1].group = ns[2].group = ns[4].group = 0;
        auto r = mermaid::layout_layered(ns, {edge(0, 1), edge(0, 2), edge(0, 3), edge(1, 4), edge(3, 5), edge(2, 4)}, Direction::TD, {-1});
        double x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (int v : {1, 2, 4}) {
            x0 = std::min(x0, r.center[v].x - 30);
            x1 = std::max(x1, r.center[v].x + 30);
            y0 = std::min(y0, r.center[v].y - 15);
            y1 = std::max(y1, r.center[v].y + 15);
        }
        for (int v : {0, 3, 5}) {
            bool inside = r.center[v].x + 30 > x0 && r.center[v].x - 30 < x1 && r.center[v].y + 15 > y0 && r.center[v].y - 15 < y1;
            check(!inside, "layout/group_excludes_outsiders_" + std::to_string(v));
        }
    }
    {
        // labels in the same gap do not overlap
        LayoutEdge e1 = edge(0, 1), e2 = edge(0, 2);
        e1.label_w = e2.label_w = 80;
        e1.label_h = e2.label_h = 24;
        auto r = mermaid::layout_layered({box(60, 30), box(60, 30), box(60, 30)}, {e1, e2}, Direction::TD);
        double dx = std::fabs(r.label_center[0].x - r.label_center[1].x), dy = std::fabs(r.label_center[0].y - r.label_center[1].y);
        check(dx >= 80 || dy >= 24, "layout/labels_do_not_overlap");
    }
    {
        check(has(svg_of("graph TD\nA[\"a < b & c\"]"), "a &lt; b &amp; c"), "svg/escapes_text");
        std::string svg = svg_of("graph TD\nA-->B");
        check(!has(svg, "var(") && !has(svg, "color-mix"), "svg/plain_colours_only");
    }

    // --- sequence diagrams ---
    {
        const std::string seq = "sequenceDiagram\nparticipant A as Alice\nA->>B: hello\nB-->>A: back\n";
        std::string svg = svg_of(seq);
        check(has(svg, ">Alice<") && has(svg, ">B<"), "sequence/participants");
        check(count(svg, "<polygon") == 2, "sequence/arrow_heads");
        check(has(svg, ">hello<") && has(svg, "stroke-dasharray=\"6 4\""), "sequence/labels_and_dashed_reply");
        check(count(svg, ">Alice<") == 2, "sequence/boxes_top_and_bottom");
        check(count(svg_of("sequenceDiagram\nA->B: x"), "<polygon") == 0, "sequence/open_arrow_has_no_head");
        check(count(svg_of("sequenceDiagram\nA-xB: x"), "<line") >= 4, "sequence/cross");
        check(has(svg_of("sequenceDiagram\nA->>A: self"), "<polyline"), "sequence/self_message");
        check(has(svg_of("sequenceDiagram\nautonumber\nA->>B: x\nB->>A: y"), ">2. y<"), "sequence/autonumber");
        check(has(svg_of("sequenceDiagram\nA->>+B: x\nB-->>-A: y"), "width=\"8\""), "sequence/activation_bar");
        check(has(svg_of("sequenceDiagram\nNote over A,B: careful\nA->>B: x"), ">careful<"), "sequence/note");
        std::string blk = svg_of("sequenceDiagram\nloop every day\nA->>B: x\nalt ok\nB->>A: y\nelse bad\nB->>A: z\nend\nend");
        check(has(blk, ">loop<") && has(blk, ">[every day]<") && has(blk, ">alt<") && has(blk, ">[bad]<"), "sequence/blocks");
        check(has(svg_of("sequenceDiagram\nA->>B: \xe6\x97\xa5\xe6\x9c\xac"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "sequence/cjk");
        check(!has(blk, "var(") && !has(blk, "color-mix"), "sequence/plain_colours_only");
        std::string e1, e2;
        check(!render("sequenceDiagram\nend", e1, e2) && has(e2, "without a block"), "sequence/error_stray_end");
        check(!render("sequenceDiagram", e1, e2), "sequence/error_empty");
    }

    // --- state diagrams ---
    {
        std::string s = svg_of("stateDiagram-v2\n[*] --> Idle\nIdle --> Busy : start\nBusy --> [*]");
        check(count(s, "class=\"node\"") == 4, "state/nodes");
        check(count(s, "class=\"edge\"") == 3 && has(s, ">start<"), "state/edges_and_label");
        check(has(s, ">Idle<") && has(s, ">Busy<"), "state/names");
        check(has(svg_of("stateDiagram\nstate \"Long name\" as L\n[*] --> L"), ">Long name<"), "state/alias");
        check(has(svg_of("stateDiagram-v2\nA : first\nA : second"), ">second<"), "state/description");
        check(has(svg_of("stateDiagram-v2\nstate X {\n[*] --> In\n}\n[*] --> X"), "class=\"composite\""), "state/composite");
        check(has(svg_of("stateDiagram-v2\nstate c <<choice>>\nA --> c\nc --> B"), "<polygon points"), "state/choice");
        check(has(svg_of("stateDiagram-v2\ndirection LR\nA --> B"), "<svg"), "state/direction");
        check(has(svg_of("stateDiagram-v2\nA --> B : \xe6\x97\xa5\xe6\x9c\xac"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "state/cjk");
        std::string e1, e2;
        check(!render("stateDiagram-v2\nstate X {\nA --> B", e1, e2), "state/error_unclosed");
        check(!render("stateDiagram-v2", e1, e2), "state/error_empty");
    }

    // --- class diagrams ---
    {
        std::string s = svg_of("classDiagram\nclass Animal {\n  +String name\n  +eat() void\n}\nAnimal <|-- Dog\nDog : +bark()");
        check(count(s, "class=\"node\"") == 2, "class/nodes");
        check(has(s, ">+String name<") && has(s, ">+eat() void<") && has(s, ">+bark()<"), "class/members");
        check(count(s, "class=\"edge\"") == 1 && has(s, "<polygon"), "class/inheritance_triangle");
        check(has(svg_of("classDiagram\nA *-- B"), "<polygon") && has(svg_of("classDiagram\nA o-- B"), "<polygon"), "class/diamonds");
        check(has(svg_of("classDiagram\nA ..> B"), "stroke-dasharray=\"5 4\""), "class/dashed");
        check(has(svg_of("classDiagram\nA \"1\" --> \"*\" B : owns"), ">owns<") && has(svg_of("classDiagram\nA \"1\" --> \"*\" B"), ">*<"), "class/label_and_cardinality");
        check(has(svg_of("classDiagram\nclass I\n<<interface>> I"), ">&lt;&lt;interface&gt;&gt;<"), "class/annotation");
        check(has(svg_of("classDiagram\nA --|> B"), "<polygon"), "class/marker_at_end");
        check(has(svg_of("classDiagram\nclass \xe6\x97\xa5\xe6\x9c\xac"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "class/cjk");
        std::string e1, e2;
        check(!render("classDiagram\nclass A {\n+x", e1, e2), "class/error_unclosed");
        check(!render("classDiagram\nnonsense here", e1, e2), "class/error_unrecognised");
    }

    // --- ER diagrams ---
    {
        std::string s = svg_of("erDiagram\nCUSTOMER ||--o{ ORDER : places\nCUSTOMER {\n  string name PK\n  string email UK \"login\"\n}");
        check(count(s, "class=\"node\"") == 2, "er/entities");
        check(count(s, "class=\"edge\"") == 1 && has(s, ">places<"), "er/relation_and_label");
        check(has(s, ">name<") && has(s, ">email<") && has(s, ">string<") && has(s, ">PK<") && has(s, ">UK<"), "er/attributes");
        check(has(s, "<circle") && count(s, "<line") >= 5, "er/crows_foot");
        check(has(svg_of("erDiagram\nA ||..|{ B : x"), "stroke-dasharray=\"5 4\""), "er/non_identifying_dashed");
        check(has(svg_of("erDiagram\nA }|--|| B"), "<line"), "er/many_to_one");
        check(has(svg_of("erDiagram\nA |o--o| B"), "<circle"), "er/zero_or_one");
        check(has(svg_of("erDiagram\nA[\"Alias\"] ||--|| B"), ">Alias<"), "er/alias");
        check(has(svg_of("erDiagram\nA ||--|| B : \"\xe6\x97\xa5\xe6\x9c\xac\""), ">\xe6\x97\xa5\xe6\x9c\xac<"), "er/cjk_label");
        std::string e1, e2;
        check(!render("erDiagram\nA {\nstring", e1, e2), "er/error_unclosed");
        check(!render("erDiagram\nA xx--|| B", e1, e2), "er/error_unknown_cardinality");
        check(!render("erDiagram", e1, e2), "er/error_empty");
    }

    // --- xychart ---
    {
        std::string s = svg_of("xychart-beta\n  title \"Sales\"\n  x-axis [jan, feb, mar]\n  y-axis \"Revenue\" 0 --> 100\n  bar [10, 50, 90]\n  line [20, 40, 60]");
        check(has(s, ">Sales<") && has(s, ">jan<") && has(s, ">mar<") && has(s, ">Revenue<"), "xychart/titles_and_categories");
        check(count(s, "<rect x=") >= 3 && has(s, "fill-opacity"), "xychart/bars");
        check(has(s, "class=\"series\"") && count(s, "<circle") == 3, "xychart/line_points");
        check(has(s, ">100<") && has(s, ">0<"), "xychart/explicit_range_ticks");
        check(has(svg_of("xychart-beta\nx-axis \"n\" 1 --> 3\nline [1, 2, 3]"), ">2<"), "xychart/numeric_x_axis");
        check(has(svg_of("xychart-beta\nx-axis [\xe6\x97\xa5, \xe6\x9c\x88]\nbar [1, 2]"), ">\xe6\x97\xa5<"), "xychart/cjk");
        check(has(svg_of("xychart-beta\nbar [3, -2]"), "<rect"), "xychart/negative_values");
        {
            std::string h = svg_of("xychart-beta horizontal\n  title \"T\"\n  x-axis [jan, feb, mar]\n  y-axis \"Rev\" 0 --> 100\n  bar [10, 50, 90]\n  line [20, 40, 60]");
            check(has(h, ">jan<") && has(h, ">Rev<") && has(h, ">100<") && count(h, "<rect x=") >= 3 && count(h, "<circle") == 3, "xychart/horizontal");
            check(!has(h, "#cf222e"), "xychart/horizontal_no_error");
        }
        std::string e1, e2;
        check(!render("xychart-beta\nx-axis [a]", e1, e2), "xychart/error_no_series");
        check(!render("xychart-beta\nbar [a, b]", e1, e2), "xychart/error_not_a_number");
    }

    // --- pie ---
    {
        std::string s = svg_of("pie showData\n  title Pets\n  \"Dogs\" : 386\n  \"Cats\" : 85.5\n  \"Rats\" : 15");
        check(has(s, ">Pets<") && count(s, "class=\"slice\"") == 3, "pie/slices_and_title");
        check(has(s, ">Dogs [386]<") && has(s, ">Cats [85.5]<"), "pie/show_data_legend");
        check(has(s, ">79.3%<"), "pie/percent_label");
        check(count(svg_of("pie\n\"A\" : 1"), "<circle") == 1, "pie/single_slice_is_a_circle");
        check(has(svg_of("pie title \xe6\x97\xa5\xe6\x9c\xac\n\"\xe7\x8c\xab\" : 1\n\"b\" : 1"), ">\xe7\x8c\xab<"), "pie/cjk");
        check(!has(s, "var(") && !has(s, "color-mix"), "pie/plain_colours_only");
        std::string e1, e2;
        check(!render("pie\n\"A\" : x", e1, e2), "pie/error_not_a_number");
        check(!render("pie\n\"A\" : 0", e1, e2), "pie/error_zero_total");
        check(!render("pie", e1, e2), "pie/error_empty");
    }
    check(has(svg_of("graph LR\nA[/para/]"), "<polygon") && has(svg_of("graph LR\nA[\\para\\]"), "<polygon"), "shape/parallelogram");

    // --- gantt ---
    {
        std::string s = svg_of("gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Design :a1, 2024-01-01, 10d\n  Build :after a1, 20d\n  Ship :milestone, m1, 2024-02-01, 0d\n  section B\n  Docs :crit, 2024-01-05, 2w");
        check(has(s, ">Plan<") && has(s, ">Design<") && has(s, ">Build<") && has(s, ">Docs<"), "gantt/title_and_tasks");
        check(has(s, ">A<") && has(s, ">B<"), "gantt/sections");
        check(count(s, "class=\"task\"") == 3, "gantt/bars");
        check(has(s, "#e5484d"), "gantt/crit_colour");
        check(has(s, "<polygon"), "gantt/milestone");
        check(has(s, ">2024-01-01<"), "gantt/axis_labels");
        check(has(svg_of("gantt\n  axisFormat %b %e\n  T :2024-03-01, 5d"), ">Mar 1<"), "gantt/axis_format");
        check(has(svg_of("gantt\n  A :a, 2024-01-01, 2024-01-10\n  B :after a, 3d"), ">B<"), "gantt/end_date");
        check(has(svg_of("gantt\n  \xe8\xa8\xad\xe8\xa8\x88 :2024-01-01, 3d"), ">\xe8\xa8\xad\xe8\xa8\x88<"), "gantt/cjk");
        std::string e1, e2;
        check(!render("gantt\n  A :after nope, 3d", e1, e2) && has(e2, "unknown task id"), "gantt/error_unknown_id");
        check(!render("gantt\n  A :3d", e1, e2), "gantt/error_first_task_without_start");
        check(!render("gantt\n  A :2024-01-01, soon", e1, e2), "gantt/error_bad_length");
        check(!render("gantt\n  title x", e1, e2), "gantt/error_no_tasks");
    }

    // --- mindmap ---
    {
        std::string s = svg_of("mindmap\n  root((Centre))\n    A\n      A1\n      A2\n    B[Square]\n    C(Round)\n    D{{Hex}}\n");
        check(count(s, "class=\"node\"") == 7, "mindmap/nodes");
        check(count(s, "class=\"edge\"") == 6, "mindmap/connectors");
        check(has(s, ">Centre<") && has(s, ">Square<") && has(s, ">Round<") && has(s, ">Hex<"), "mindmap/shapes_use_the_text_only");
        check(has(s, "<ellipse") && has(s, "<polygon"), "mindmap/circle_and_hexagon");
        check(has(svg_of("mindmap\n  r\n    \xe6\x97\xa5\xe6\x9c\xac"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "mindmap/cjk");
        check(has(svg_of("mindmap\n  r\n    a\n    ::icon(fa fa-book)\n    b"), ">b<"), "mindmap/icon_lines_are_skipped");
        check(!has(s, "var(") && !has(s, "color-mix"), "mindmap/plain_colours_only");
        std::string e1, e2;
        check(!render("mindmap\n  a\n  b", e1, e2) && has(e2, "one root"), "mindmap/error_two_roots");
        check(!render("mindmap", e1, e2), "mindmap/error_empty");
    }

    // --- timeline ---
    {
        std::string s = svg_of("timeline\n  title History\n  section Early\n  2002 : LinkedIn\n  2004 : Facebook : Google\n  : Twitter\n  section Late\n  2010 : Instagram");
        check(has(s, ">History<") && has(s, ">Early<") && has(s, ">Late<"), "timeline/title_and_sections");
        check(count(s, "class=\"period\"") == 3, "timeline/periods");
        check(count(s, "class=\"event\"") == 5, "timeline/events_including_continuation");
        check(has(s, ">Twitter<") && has(s, ">Instagram<"), "timeline/event_text");
        check(count(svg_of("timeline\n  2000 : a\n  2001"), "class=\"period\"") == 2, "timeline/period_without_event");
        check(has(svg_of("timeline\n  \xe6\x97\xa5\xe6\x9c\xac : \xe6\x9d\xb1\xe4\xba\xac"), ">\xe6\x9d\xb1\xe4\xba\xac<"), "timeline/cjk");
        check(!has(s, "var(") && !has(s, "color-mix"), "timeline/plain_colours_only");
        std::string e1, e2;
        check(!render("timeline\n  : orphan", e1, e2), "timeline/error_event_without_period");
        check(!render("timeline", e1, e2), "timeline/error_empty");
    }

    // --- journey ---
    {
        std::string s = svg_of("journey\n  title Day\n  section Work\n    Make tea: 5: Me\n    Go upstairs: 3: Me, Cat\n  section Home\n    Sit down: 1: Me");
        check(has(s, ">Day<") && has(s, ">Work<") && has(s, ">Home<"), "journey/title_and_sections");
        check(count(s, "class=\"task\"") == 3 && count(s, "class=\"face\"") == 3, "journey/tasks_and_faces");
        check(has(s, ">Me<") && has(s, ">Cat<"), "journey/actor_legend");
        check(has(svg_of("journey\n  A: 4"), ">A<"), "journey/actors_are_optional");
        check(has(svg_of("journey\n  \xe4\xbd\x9c\xe6\xa5\xad: 3: \xe7\xa7\x81"), ">\xe4\xbd\x9c\xe6\xa5\xad<"), "journey/cjk");
        std::string e1, e2;
        check(!render("journey\n  A: 9", e1, e2), "journey/error_score_out_of_range");
        check(!render("journey\n  A", e1, e2), "journey/error_no_score");
        check(!render("journey", e1, e2), "journey/error_empty");
    }

    // --- quadrantChart ---
    {
        std::string s = svg_of("quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Cold --> Hot\n  quadrant-1 Expand\n  quadrant-3 Rethink\n  A: [0.3, 0.6]\n  B: [0.9, 0.1]");
        check(has(s, ">Reach<") && has(s, ">Low<") && has(s, ">High<") && has(s, ">Cold<") && has(s, ">Hot<"), "quadrant/titles_and_axes");
        check(has(s, ">Expand<") && has(s, ">Rethink<"), "quadrant/quadrant_names");
        check(count(s, "class=\"point\"") == 2 && has(s, ">A<") && has(s, ">B<"), "quadrant/points");
        check(has(svg_of("quadrantChart\n  \xe7\x82\xb9: [0.5, 0.5]"), ">\xe7\x82\xb9<"), "quadrant/cjk");
        std::string e1, e2;
        check(!render("quadrantChart\n  A: [2, 0.5]", e1, e2), "quadrant/error_out_of_range");
        check(!render("quadrantChart\n  nonsense", e1, e2), "quadrant/error_unrecognised");
    }

    // --- gitGraph ---
    {
        std::string s = svg_of("gitGraph\n  commit id: \"A\"\n  branch dev\n  checkout dev\n  commit id: \"B\" tag: \"v0\"\n  checkout main\n  merge dev id: \"M\"\n  commit type: HIGHLIGHT");
        check(count(s, "class=\"commit\"") == 4, "git/commits");
        check(count(s, "class=\"branch\"") == 2 && has(s, ">main<") && has(s, ">dev<"), "git/branches");
        check(has(s, ">A<") && has(s, ">B<") && has(s, ">M<") && has(s, ">v0<"), "git/ids_and_tags");
        check(has(s, "<path d=\""), "git/lane_change_is_a_curve");
        check(has(svg_of("gitGraph\n  commit\n  commit type: REVERSE"), "stroke=\"#ffffff\""), "git/reverse_cross");
        check(has(svg_of("gitGraph\n  commit id: \"\xe6\x97\xa5\xe6\x9c\xac\""), ">\xe6\x97\xa5\xe6\x9c\xac<"), "git/cjk");
        std::string e1, e2;
        check(!render("gitGraph\n  checkout nope", e1, e2), "git/error_unknown_branch");
        check(!render("gitGraph\n  commit\n  branch a\n  branch a", e1, e2), "git/error_duplicate_branch");
        check(!render("gitGraph\n  commit\n  merge main", e1, e2), "git/error_merge_into_itself");
        check(!render("gitGraph", e1, e2), "git/error_empty");
    }

    // --- kanban ---
    {
        std::string s = svg_of("kanban\n  Todo\n    [Write docs]\n    t1[Fix bug]@{ ticket: 'MC-1', assigned: 'ann', priority: 'High' }\n  [Done]\n    d1[Ship it]");
        check(count(s, "class=\"column\"") == 2 && has(s, ">Todo<") && has(s, ">Done<"), "kanban/columns");
        check(count(s, "class=\"card\"") == 3, "kanban/cards");
        check(has(s, ">Write docs<") && has(s, ">Fix bug<") && has(s, ">Ship it<"), "kanban/card_text");
        check(has(s, ">MC-1<") && has(s, ">ann<"), "kanban/ticket_and_assignee");
        check(has(s, "#f28e2b"), "kanban/priority_mark");
        check(has(svg_of("kanban\n  \xe5\x88\x97\n    \xe3\x82\xbf\xe3\x82\xb9\xe3\x82\xaf"), ">\xe5\x88\x97<"), "kanban/cjk");
        std::string e1, e2;
        check(!render("kanban", e1, e2), "kanban/error_empty");
    }

    // --- packet ---
    {
        std::string s = svg_of("packet-beta\n  title TCP\n  0-15: \"Source Port\"\n  16-31: \"Destination Port\"\n  32-63: \"Sequence Number\"\n  64-71: \"Flag\"");
        check(has(s, ">TCP<") && has(s, ">Source Port<") && has(s, ">Sequence Number<") && has(s, ">Flag<"), "packet/title_and_fields");
        check(count(s, "class=\"field\"") == 4, "packet/fields");
        check(count(svg_of("packet-beta\n  0-39: \"Wide\""), "class=\"field\"") == 2, "packet/field_wraps_over_rows");
        check(has(s, ">15<") && has(s, ">16<"), "packet/bit_numbers");
        check(has(svg_of("packet\n  0-7: \"\xe3\x83\x98\xe3\x83\x83\xe3\x83\x80\""), ">\xe3\x83\x98\xe3\x83\x83\xe3\x83\x80<"), "packet/cjk_and_plain_keyword");
        std::string e1, e2;
        check(!render("packet-beta\n  0-7: \"a\"\n  10-15: \"b\"", e1, e2) && has(e2, "without gaps"), "packet/error_gap");
        check(!render("packet-beta\n  x: \"a\"", e1, e2), "packet/error_bad_range");
        check(!render("packet-beta", e1, e2), "packet/error_empty");
    }

    // --- sankey ---
    {
        std::string s = svg_of("sankey-beta\n\nA,B,10\nA,C,5\nB,D,10\n\"x, y\",D,2");
        check(count(s, "class=\"flow\"") == 4, "sankey/flows");
        check(count(s, "class=\"node\"") == 5, "sankey/nodes");
        check(has(s, ">A  15<") && has(s, ">D  12<"), "sankey/node_values");
        check(has(s, ">x, y  2<"), "sankey/quoted_name");
        check(has(svg_of("sankey\n\xe5\x85\xa5,\xe5\x87\xba,3"), ">\xe5\x85\xa5  3<"), "sankey/cjk_and_plain_keyword");
        std::string e1, e2;
        check(!render("sankey-beta\nA,B", e1, e2), "sankey/error_missing_value");
        check(!render("sankey-beta\nA,B,-1", e1, e2), "sankey/error_negative");
        check(!render("sankey-beta\nA,A,1", e1, e2), "sankey/error_self_flow");
        check(!render("sankey-beta", e1, e2), "sankey/error_empty");
    }

    // --- requirementDiagram ---
    {
        std::string s = svg_of("requirementDiagram\n  requirement req {\n    id: 1\n    text: the test text.\n    risk: high\n    verifymethod: test\n  }\n  element ent {\n    type: simulation\n  }\n  ent - satisfies -> req\n  req <- contains - ent");
        check(count(s, "class=\"node\"") == 2 && has(s, ">req<") && has(s, ">ent<"), "requirement/nodes");
        check(has(s, ">&lt;&lt;Requirement&gt;&gt;<") && has(s, ">&lt;&lt;Element&gt;&gt;<"), "requirement/stereotypes");
        check(has(s, ">Id: 1<") && has(s, ">Text: the test text.<") && has(s, ">Type: simulation<"), "requirement/fields");
        check(has(s, ">Risk: High<") && has(s, ">Verification: Test<"), "requirement/capitalised_enum_values");
        check(count(s, "class=\"edge\"") == 2 && has(s, ">&lt;&lt;satisfies&gt;&gt;<") && has(s, ">&lt;&lt;contains&gt;&gt;<"), "requirement/relations");
        check(has(s, "stroke-dasharray=\"6 4\""), "requirement/dashed_except_contains");
        std::string e1, e2;
        check(!render("requirementDiagram\n  a - satisfies -> b", e1, e2), "requirement/error_unknown_item");
        check(!render("requirementDiagram\n  requirement r {\n id: 1", e1, e2), "requirement/error_unclosed");
        check(!render("requirementDiagram", e1, e2), "requirement/error_empty");
    }

    // --- block ---
    {
        std::string s = svg_of("block-beta\n  columns 3\n  a b c\n  d:2 e[\"Eee\"]\n  f(\"Round\") g((\"Circle\")) h{\"Dia\"}\n  a --> b\n  b -- \"link\" --> e");
        check(count(s, "class=\"node\"") == 8, "block/blocks");
        check(has(s, ">Eee<") && has(s, ">Round<") && has(s, ">Circle<") && has(s, ">Dia<"), "block/labels");
        check(has(s, "<ellipse") && has(s, "<polygon"), "block/shapes");
        check(count(s, "class=\"edge\"") == 2 && has(s, ">link<"), "block/links");
        check(count(svg_of("block-beta\n  columns 2\n  a space b"), "class=\"node\"") == 2, "block/space_is_empty");
        check(has(svg_of("block\n  \xe5\x9b\xb3[\"\xe6\x97\xa5\xe6\x9c\xac\"]"), ">\xe6\x97\xa5\xe6\x9c\xac<"), "block/cjk_and_plain_keyword");
        std::string e1, e2;
        check(render("block-beta\n  a --> b", e1, e2) && count(e1, "class=\"node\"") == 2 && count(e1, "class=\"edge\"") == 1, "block/edge_creates_missing_blocks");
        {
            std::string n = svg_of("block-beta\n  columns 3\n  a:3\n  block:g:2\n    columns 2\n    d e\n  end\n  f");
            check(count(n, "class=\"node\"") == 4 && count(n, "class=\"group\"") == 1, "block/nested_group");
            check(!has(n, "#cf222e"), "block/nested_no_error");
            check(has(svg_of("block-beta\n  block:outer\n    block:inner\n      x y\n    end\n    z\n  end"), "class=\"group\""), "block/nested_twice");
            check(count(svg_of("block-beta\n  block:g\n    a\n  end\n  b\n  a --> b"), "class=\"edge\"") == 1, "block/nested_link_across_groups");
        }
        check(!render("block-beta\n  end", e1, e2), "block/error_end_without_block");
        check(!render("block-beta\n  block:g\n  a", e1, e2), "block/error_unclosed");
        check(!render("block-beta\n  columns 0", e1, e2), "block/error_columns");
        check(!render("block-beta", e1, e2), "block/error_empty");
    }

    std::printf("----\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
