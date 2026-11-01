// Differential test: notation variants of each diagram go through the official Mermaid parser (12.x, via jsdom) and
// through the host mermaid_cli. A variant the official parser takes and the engine rejects is a candidate bug.
//
//   node packages/mermaid-compare/scripts/notation-diff.mjs [path/to/mermaid_cli.exe] [--json out.json]
//
// Only accept/reject is compared. Each divergence is listed as "official ok / engine rejects" (engine gap) or
// "official rejects / engine ok" (engine more lenient; usually harmless).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
// the host build puts the CLI in Release/ with Visual Studio (.exe) and in the build folder itself with a single-config generator
const cliCandidates = ["Release/mermaid_cli.exe", "Debug/mermaid_cli.exe", "mermaid_cli"].map((p) => path.join(ROOT, "build-host-tests", p));
const cli = args.find((a) => a.endsWith(".exe") || a.endsWith("mermaid_cli")) ?? cliCandidates.find((p) => fs.existsSync(p)) ?? cliCandidates[0];

const require = createRequire(path.join(ROOT, "package.json"));
const jsdomDir = fs.readdirSync(path.join(ROOT, "node_modules/.pnpm")).find((d) => d.startsWith("jsdom@"));
const { JSDOM } = await import(pathToFileURL(path.join(ROOT, "node_modules/.pnpm", jsdomDir, "node_modules/jsdom/lib/api.js")).href);
const dom = new JSDOM("<!doctype html><body></body>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const mermaidDir = path.join(ROOT, "packages/mermaid-compare/node_modules/mermaid/dist/mermaid.core.mjs");
const mermaid = (await import(pathToFileURL(mermaidDir).href)).default;

// ---- variant generation -------------------------------------------------------------------------------------------
const cases = [];
const add = (kind, name, text) => cases.push({ kind, name, text });
const sp = (s) => (s ? " " : "");

// A. link tokens x spacing, for flowchart-like diagrams
const linkVariants = [
  ["---", ""], ["----", ""], ["-----", ""], ["-->", ""], ["--->", ""], ["---->", ""], ["--x", ""], ["--o", ""], ["<-->", ""],
  ["===", ""], ["==>", ""], ["====>", ""], ["-.-", ""], ["-.->", ""], ["-..->", ""], ["~~~", ""],
  ["-->", "|t|"], ["---", "|t|"], ["==>", "|t|"], ["-.->", "|t|"],
];
for (const head of ["graph LR", "flowchart TD", "flowchart LR", "swimlane-beta LR", "agentflow-beta TB"]) {
  const tag = head.split(" ")[0];
  for (const [tok, lab] of linkVariants) {
    for (const s of [true, false]) {
      add("A.link", `${tag} ${s ? "spaced" : "compact"} ${tok}${lab}`, `${head}\n  A${sp(s)}${tok}${lab}${sp(s)}B`);
    }
    add("A.chain", `${tag} chain ${tok}${lab}`, `${head}\n  A ${tok}${lab} B ${tok}${lab} C ${tok}${lab} D`);
    add("A.amp", `${tag} amp ${tok}${lab}`, `${head}\n  A ${tok}${lab} B & C & D`);
    add("A.mixed", `${tag} mixed ${tok}`, `${head}\n  A ${tok} B --> C ==> D -.-> E`);
  }
  for (const m of ["-- text -->", "--text-->", '--"text"-->', '-- "text" -->', "== text ==>", "==text==>", "-. text .->", "-.text.->", "-- a --> b -->", "-- text ---", "--text---", "== text ===", "-. text .-"]) {
    add("A.textlink", `${tag} ${m}`, `${head}\n  A ${m} B`);
    add("A.textlink", `${tag} compact ${m}`, `${head}\n  A${m}B`);
  }
}

// B. labels containing delimiters
const nasty = ["a: b", "a --> b", "a --- b", "a | b", "a & b", "a;b", "a,b", "a\"b", "a'b", "a (b) c", "a [b] c", "a {b} c", "a %% b", "#35;", "a#quot;b", "日本語 ラベル", "😀 emoji", "a<br/>b", "a<br>b", "<b>x</b>", "a\\nb", "a ~ b", "a @ b", "a ... b", "a :::b", "a->b", "a=>b", "a<--b", "end", "graph", "subgraph", "A--B"];
for (const lab of nasty) {
  add("B.node", `flow node [${lab}]`, `flowchart LR\n  A["${lab}"] --> B`);
  add("B.edge", `flow edge |${lab}|`, `flowchart LR\n  A -->|"${lab}"| B`);
  add("B.edgeq", `flow edge -- "${lab}" -->`, `flowchart LR\n  A -- "${lab}" --> B`);
  add("B.sub", `flow subgraph "${lab}"`, `flowchart LR\n  subgraph s1["${lab}"]\n    A --> B\n  end`);
  add("B.seq", `seq message ${lab}`, `sequenceDiagram\n  participant A\n  participant B\n  A->>B: ${lab}`);
  add("B.seq", `seq note ${lab}`, `sequenceDiagram\n  participant A\n  Note over A: ${lab}`);
  add("B.seq", `seq alias ${lab}`, `sequenceDiagram\n  participant A as ${lab}\n  A->>A: x`);
  add("B.state", `state label ${lab}`, `stateDiagram-v2\n  A --> B: ${lab}`);
  add("B.state", `state desc ${lab}`, `stateDiagram-v2\n  A: ${lab}\n  A --> B`);
  add("B.state", `state as ${lab}`, `stateDiagram-v2\n  state "${lab}" as s1\n  s1 --> B`);
  add("B.class", `class label ${lab}`, `classDiagram\n  A --> B : ${lab}`);
  add("B.class", `class member ${lab}`, `classDiagram\n  class A {\n    +x : int\n    +f(a) void\n  }\n  A : +g() ${lab.replace(/[^\w ]/g, "")}`);
  add("B.er", `er label "${lab}"`, `erDiagram\n  A ||--o{ B : "${lab}"`);
  add("B.block", `block label ${lab}`, `block-beta\n  A["${lab}"] B`);
  add("B.mind", `mindmap ${lab}`, `mindmap\n  root["${lab}"]\n    child`);
  add("B.pie", `pie "${lab}"`, `pie title ${lab.replace(/"/g, "")}\n  "${lab.replace(/"/g, "")}" : 3\n  "b" : 4`);
  add("B.timeline", `timeline ${lab}`, `timeline\n  title ${lab}\n  2020 : ${lab}`);
  add("B.journey", `journey ${lab}`, `journey\n  title ${lab}\n  section s\n    ${lab.replace(/:/g, "")}: 5: Me`);
  add("B.gantt", `gantt ${lab}`, `gantt\n  title ${lab}\n  section s\n  ${lab.replace(/[:;#]/g, "")} :a1, 2024-01-01, 3d`);
  add("B.kanban", `kanban ${lab}`, `kanban\n  todo[${lab.replace(/[\[\]]/g, "")}]\n    t1[${lab.replace(/[\[\]]/g, "")}]`);
  add("B.req", `requirement ${lab}`, `requirementDiagram\n  requirement r {\n    id: 1\n    text: ${lab.replace(/"/g, "")}\n    risk: high\n    verifymethod: test\n  }`);
}

// C. whitespace / line-ending / structure
const bodies = {
  flowchart: ["A --> B", "A[Start] --> B{Choice}", "A --> B\n  B --> C"],
  sequence: ["A->>B: hi", "A-->>B: hi", "A-)B: hi", "A->>+B: hi\n  B-->>-A: ok"],
};
const heads = { flowchart: ["flowchart LR", "graph TD", "graph TB;"], sequence: ["sequenceDiagram"] };
for (const [k, hs] of Object.entries(heads)) {
  for (const h of hs) {
    for (const b of bodies[k]) {
      add("C.ws", `${k} ${h} crlf`, `${h}\r\n  ${b.replace(/\n/g, "\r\n")}\r\n`);
      add("C.ws", `${k} ${h} tabs`, `${h}\n\t${b.replace(/\n/g, "\n\t")}`);
      add("C.ws", `${k} ${h} noindent`, `${h}\n${b.replace(/\n  /g, "\n")}`);
      add("C.ws", `${k} ${h} semicolons`, `${h}\n  ${b.replace(/\n/g, ";\n")};`);
      add("C.ws", `${k} ${h} trailing`, `${h}   \n  ${b}   \n\n\n`);
      add("C.ws", `${k} ${h} comment`, `${h}\n  %% note\n  ${b}  %% tail?\n`);
      add("C.ws", `${k} ${h} oneline`, `${h}; ${b.split("\n")[0].trim()}`);
    }
  }
}

// D. diagram-specific edge syntax variants
const ex = [
  ["sequenceDiagram\n  A->B: m", "seq ->"], ["sequenceDiagram\n  A-->B: m", "seq -->"], ["sequenceDiagram\n  A-xB: m", "seq -x"], ["sequenceDiagram\n  A--xB: m", "seq --x"],
  ["sequenceDiagram\n  A->>B:m", "seq no space after colon"], ["sequenceDiagram\n  A ->> B : m", "seq spaced colon"], ["sequenceDiagram\n  A<<->>B: m", "seq bidir"],
  ["sequenceDiagram\n  participant A as \"Alice B\"\n  A->>A: m", "seq quoted alias"], ["sequenceDiagram\n  actor A\n  A->>A: m", "seq actor"],
  ["sequenceDiagram\n  autonumber\n  A->>B: m", "seq autonumber"], ["sequenceDiagram\n  loop every 5s\n  A->>B: m\n  end", "seq loop"],
  ["sequenceDiagram\n  alt a\n  A->>B: m\n  else b\n  B->>A: n\n  end", "seq alt"], ["sequenceDiagram\n  Note right of A: x\n  A->>B: m", "seq note right"],
  ["sequenceDiagram\n  Note over A,B: x\n  A->>B: m", "seq note over"], ["sequenceDiagram\n  activate A\n  A->>B: m\n  deactivate A", "seq activate"],
  ["sequenceDiagram\n  create participant C\n  A->>C: m", "seq create"], ["sequenceDiagram\n  A->>B: m;n", "seq semicolon in message"],
  ["stateDiagram-v2\n  [*] --> A", "state start"], ["stateDiagram-v2\n  A --> [*]", "state end"], ["stateDiagram-v2\n  A-->B", "state compact"], ["stateDiagram-v2\n  A --> B:x", "state compact label"],
  ["stateDiagram-v2\n  A --> B : x", "state spaced label"], ["stateDiagram\n  A --> B", "state v1"], ["stateDiagram-v2\n  state A {\n    [*] --> B\n  }", "state composite"],
  ["stateDiagram-v2\n  state fork_state <<fork>>\n  [*] --> fork_state", "state fork"], ["stateDiagram-v2\n  state if_state <<choice>>\n  A --> if_state", "state choice"],
  ["stateDiagram-v2\n  A --> B\n  note right of A: hi", "state note"], ["stateDiagram-v2\n  A --> B\n  note right of A\n    hi\n  end note", "state note block"],
  ["stateDiagram-v2\n  direction LR\n  A --> B", "state direction"], ["stateDiagram-v2\n  A --> B\n  --\n  C --> D", "state concurrent?"],
  ["classDiagram\n  A <|-- B", "class inherit"], ["classDiagram\n  A<|--B", "class inherit compact"], ["classDiagram\n  A *-- B", "class comp"], ["classDiagram\n  A o-- B", "class aggr"],
  ["classDiagram\n  A --> B", "class assoc"], ["classDiagram\n  A ..> B", "class dep"], ["classDiagram\n  A ..|> B", "class realize"], ["classDiagram\n  A -- B", "class link"], ["classDiagram\n  A .. B", "class dashed"],
  ['classDiagram\n  A "1" --> "*" B', "class card"], ['classDiagram\n  A "1" --> "*" B : has', "class card label"], ["classDiagram\n  A --> B : has many", "class label"],
  ["classDiagram\n  class A~T~", "class generic"], ["classDiagram\n  class A {\n    <<interface>>\n    +f()\n  }", "class annotation"], ["classDiagram\n  class A\n  <<service>> A", "class annot ext"],
  ["classDiagram\n  A : +int x\n  A : +f() int", "class member colon"], ["classDiagram\n  direction RL\n  A --> B", "class direction"], ['classDiagram\n  class A["Alias name"]', "class alias"],
  ["classDiagram\n  note for A \"hi\"", "class note"], ["classDiagram\n  A <|-- B\n  B <|-- C : x", "class two"], ["classDiagram\n  A --|> B", "class reverse inherit"],
  ["classDiagram\n  A ()-- B", "class lollipop"], ["classDiagram\n  A --() B", "class lollipop2"],
  ["erDiagram\n  A ||--o{ B : has", "er basic"], ["erDiagram\n  A||--o{B : has", "er compact"], ["erDiagram\n  A ||--o{ B : \"has many\"", "er quoted"], ["erDiagram\n  A }|..|{ B : x", "er dotted"],
  ["erDiagram\n  A ||--|| B : x", "er one"], ["erDiagram\n  A |o--o| B : x", "er zero-one"], ["erDiagram\n  A one to many B : x", "er words"], ["erDiagram\n  A 1 to 0+ B : x", "er words2"],
  ["erDiagram\n  A {\n    string name PK\n    int id FK \"comment\"\n  }", "er attrs"], ["erDiagram\n  A {\n    string name PK, UK\n  }", "er multi key"], ['erDiagram\n  A["Alias"] ||--o{ B : x', "er alias"],
  ["erDiagram\n  A ||--o{ B : has\n  A ||--o{ B : has", "er dup"], ["erDiagram\n  A ||--o{ B : x\n  direction LR", "er direction"], ["erDiagram\n  A ||--o{ B", "er no label"],
  ["block-beta\n  columns 3\n  A B C", "block cols"], ["block-beta\n  A --> B", "block link"], ["block-beta\n  A-->B", "block link compact"], ['block-beta\n  A -- "t" --> B', "block link label"],
  ["block-beta\n  A:2 B", "block span"], ["block-beta\n  block:g\n    A\n  end", "block group"], ["block-beta\n  A((c)) B(r) C{d}", "block shapes"], ["block-beta\n  space B", "block space"],
  ["architecture-beta\n  service a(server)[A]", "arch service"], ["architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R -- L:b", "arch edge"], ["architecture-beta\n  group g(cloud)[G]\n  service a(server)[A] in g", "arch group"],
  ["architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R --> L:b", "arch arrow"], ["architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  a:R<-->L:b", "arch bidi compact"],
  ["architecture-beta\n  junction j\n  service a(server)[A]\n  a:R -- L:j", "arch junction"],
  ["gitGraph\n  commit\n  branch dev\n  checkout dev\n  commit id: \"x\"\n  checkout main\n  merge dev", "git basic"], ["gitGraph\n  commit tag: \"v1\"", "git tag"], ["gitGraph\n  commit type: HIGHLIGHT", "git type"],
  ["gitGraph LR:\n  commit", "git LR:"], ["gitGraph\n  commit\n  cherry-pick id: \"x\"", "git cherry"],
  ["pie\n  \"a\" : 1\n  \"b\" : 2", "pie"], ["pie showData\n  \"a\" : 1", "pie showData"], ["pie title T\n  \"a\" : 1.5", "pie float"], ["pie\n  \"a\":1\n  \"b\":2", "pie compact"],
  ["xychart-beta\n  x-axis [a, b]\n  y-axis \"Y\" 0 --> 10\n  bar [1, 2]", "xy"], ["xychart-beta horizontal\n  x-axis [a,b]\n  line [1,2]", "xy horizontal"],
  ["quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  quadrant-1 A\n  P: [0.3, 0.6]", "quadrant"], ["quadrantChart\n  x-axis Low-->High\n  P:[0.3,0.6]", "quadrant compact"],
  ["sankey-beta\n\n  A,B,10\n  B,C,5", "sankey"], ["sankey-beta\n  \"A, x\",B,10", "sankey quoted comma"],
  ["radar-beta\n  axis a,b,c\n  curve c1{1,2,3}", "radar"], ["radar-beta\n  axis a[\"A\"], b[\"B\"], c[\"C\"]\n  curve c1[\"X\"]{1,2,3}", "radar labels"],
  ["timeline\n  2020 : a\n  2021 : b : c", "timeline multi"], ["timeline\n  section S\n  2020 : a", "timeline section"],
  ["journey\n  section S\n    T: 5: Me, You", "journey actors"], ["journey\n  title T\n  section S\n    T:5:Me", "journey compact"],
  ["gantt\n  dateFormat YYYY-MM-DD\n  A :a1, 2024-01-01, 3d\n  B :after a1, 2d", "gantt after"], ["gantt\n  dateFormat YYYY-MM-DD\n  A :done, a1, 2024-01-01, 2024-01-05", "gantt done"],
  ["gantt\n  dateFormat YYYY-MM-DD\n  A :crit, active, 2024-01-01, 3d", "gantt crit"], ["gantt\n  dateFormat YYYY-MM-DD\n  excludes weekends\n  A :2024-01-01, 3d", "gantt excludes"],
  ["gantt\n  A :milestone, m1, 2024-01-01, 0d", "gantt milestone"], ["gantt\n  axisFormat %m/%d\n  A :2024-01-01, 1w", "gantt axisFormat"],
  ["mindmap\n  root((r))\n    a\n    b", "mind circle"], ["mindmap\n  root)r(\n    a", "mind cloud"], ["mindmap\n  r\n    a::icon(fa fa-book)", "mind icon"], ["mindmap\n  r\n    a\n      b\n    c", "mind deep"],
  ["kanban\n  todo[Todo]\n    t1[Task]@{ assigned: 'x' }", "kanban meta"], ["kanban\n  todo[Todo]\n    t1[Task]@{ ticket: A-1, priority: 'High' }", "kanban prio"],
  ["requirementDiagram\n  requirement r {\n    id: 1\n    text: t\n    risk: high\n    verifymethod: test\n  }\n  element e {\n    type: sim\n  }\n  e - satisfies -> r", "req"],
  ["requirementDiagram\n  requirement r {\n    id: 1\n    text: t\n    risk: low\n    verifymethod: test\n  }\n  element e {\n    type: sim\n  }\n  e-satisfies->r", "req compact"],
  ["C4Context\n  Person(a, \"A\")\n  System(b, \"B\")\n  Rel(a, b, \"uses\")", "c4"], ["C4Context\n  Person(a, \"A\", \"desc\")\n  Rel(a, b, \"uses\", \"HTTP\")", "c4 args"],
  ["C4Context\n  Enterprise_Boundary(e, \"E\") {\n    Person(a, \"A\")\n  }", "c4 boundary"], ["C4Context\n  Person(a,\"A\")", "c4 compact"],
  ["packet-beta\n  0-15: \"Source\"\n  16-31: \"Dest\"", "packet"], ["packet-beta\n  +16: \"a\"\n  +16: \"b\"", "packet plus"],
  ["treemap-beta\n  \"A\"\n    \"B\": 10", "treemap"], ["venn-beta\n  set A\n  set B\n  union A,B", "venn"],
  ["ishikawa-beta\n  Effect\n    Cause1\n      Sub", "ishikawa"], ["treeView-beta\n  root\n    a\n    b", "treeview"], ["info", "info"], ["info showInfo", "info show"],
  ["wardley-beta\n  title T\n  anchor A [0.9, 0.5]\n  component B [0.5, 0.5]\n  A -> B", "wardley"], ["wardley-beta\n  component B [0.5, 0.5]\n  component C [0.4, 0.6]\n  B->C", "wardley compact"],
  ["wardley-beta\n  component B [0.5, 0.5] label [10, 10]\n  evolve B 0.8", "wardley evolve"],
  ["cynefin-beta\n  title T\n  complex\n    \"a\"", "cynefin"], ["usecase-beta\n  actor A\n  U\n  A --> U", "usecase"], ["usecase-beta\n  actor A\n  U\n  A-->U", "usecase compact"],
  ["usecase-beta\n  actor A\n  U\n  V\n  U ..> V : include", "usecase include"], ["usecase-beta\n  actor A\n  U\n  V\n  U ..> V: include", "usecase include compact"],
  ["usecase-beta\n  actor A\n  U\n  A -- U", "usecase plain"], ["usecase-beta\n  actor A\n  U\n  A --- U", "usecase 3"],
  ["railroad-ebnf-beta\n  a = b , c ;", "railroad"], ["railroad-ebnf-beta\n  a = b | c ;", "railroad alt"], ["railroad-ebnf-beta\n  a = { b } ;", "railroad rep"], ["railroad-ebnf-beta\n  a = [ b ] ;", "railroad opt"],
  ["eventmodeling\n  tf 01 ui CartUI", "eventmodeling"],
  ["---\ntitle: T\n---\nflowchart LR\n  A --> B", "front matter"], ["%%{init: {'theme':'dark'}}%%\nflowchart LR\n  A --> B", "init directive"],
  ["---\nconfig:\n  theme: dark\n---\nflowchart LR\n  A --> B", "front matter config"], ["\n\nflowchart LR\n  A --> B", "leading blank"], ["%% c\nflowchart LR\n  A --> B", "leading comment"],
  ["flowchart LR\n  A --> B\n  classDef c fill:#f00\n  class A c", "flow classDef"], ["flowchart LR\n  A:::c --> B\n  classDef c fill:#f00", "flow :::"], ["flowchart LR\n  A --> B\n  style A fill:#f00,stroke:#333", "flow style"],
  ["flowchart LR\n  A --> B\n  linkStyle 0 stroke:#f00", "flow linkStyle"], ["flowchart LR\n  A --> B\n  click A href \"http://x\"", "flow click"], ["flowchart LR\n  A@{ shape: rect, label: \"x\" } --> B", "flow @{}"],
  ["flowchart LR\n  A e1@--> B\n  e1@{ animate: true }", "flow edge id"], ["flowchart LR\n  A -->B", "flow half spaced r"], ["flowchart LR\n  A--> B", "flow half spaced l"],
  ["flowchart LR\n  A --> B --> C", "flow chain"], ["flowchart LR\n  A & B --> C & D", "flow amp both"], ["flowchart LR\n  A --> B\n  B --> A", "flow cycle"], ["flowchart LR\n  A --> A", "flow self"],
  ["flowchart LR\n  subgraph S\n    direction TB\n    A --> B\n  end\n  S --> C", "flow sg edge"], ["flowchart LR\n  subgraph S [Title]\n    A\n  end", "flow sg title spaced"],
  ["flowchart LR\n  A[\"x\"]-->B[\"y\"]", "flow quoted compact"], ["flowchart LR\n  A(x)-->B((y))-->C{z}", "flow shapes compact"], ["flowchart LR\n  A[/x/] --> B[\\y\\] --> C[/z\\] --> D[\\w/]", "flow slants"],
  ["flowchart LR\n  A([x]) --> B[[y]] --> C[(z)] --> D{{w}}", "flow shapes 2"], ["flowchart LR\n  A>x] --> B", "flow asym"], ["flowchart LR\n  A -->|x| B -->|y| C", "flow label chain"],
  ["flowchart LR\n  A -- x --> B -- y --> C", "flow textlink chain"], ["flowchart LR\n  A --x B", "flow cross no arrow spaced"], ["flowchart LR\n  A --o B", "flow circle spaced"], ["flowchart LR\n  A ---|t| B", "flow open label"],
  ["flowchart LR\n  A ~~~ B", "flow invisible"], ["flowchart LR\n  A --> B;\n  B --> C;", "flow semi"], ["flowchart LR\n  A[a;b] --> B", "flow semi in label"],
  ["flowchart LR\n  A[\"line1\n  line2\"] --> B", "flow newline in label"], ["flowchart LR\n  A -->|\"l1\n  l2\"| B", "flow newline in edge label"], ["flowchart LR\n  A -- \"l1\n  l2\" --> B", "flow newline in text link"],
  ["flowchart LR\n  A[\"a\"]\n  A --> B", "flow node decl then edge"], ["flowchart LR\n  A\n  B\n  A --- B", "flow decl then open"], ["flowchart LR\n  A --- B\n  B --- C", "flow two open lines"],
  ["flowchart LR\n  A ---> B", "flow long arrow"], ["flowchart LR\n  A <--> B <--> C", "flow bidir chain"], ["flowchart LR\n  A o--o B", "flow o--o"], ["flowchart LR\n  A x--x B", "flow x--x"],
  ["flowchart LR\n  A <-.-> B", "flow bidir dotted"], ["flowchart LR\n  A <==> B", "flow bidir thick"], ["flowchart LR\n  A -.- B -.- C", "flow dotted open chain"], ["flowchart LR\n  A === B === C", "flow thick open chain"],
];
for (const [text, name] of ex) add("D", name, text);

// ---- run ----------------------------------------------------------------------------------------------------------
async function official(text) {
  try {
    await mermaid.parse(text);
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e?.message ?? e).split("\n")[0] };
  }
}
function own(text) {
  const p = spawnSync(cli, [], { input: Buffer.from(text, "utf8"), maxBuffer: 1 << 28, timeout: 30000 });
  return { ok: p.status === 0, msg: String(p.stderr ?? "").trim().split("\n")[0], svg: String(p.stdout ?? "") };
}
// Structure of a flowchart as the official parser reads it: node, edge and subgraph counts.
const size = (v) => v?.size ?? v?.length ?? 0;
async function officialShape(text) {
  const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db;
  if (db.getVertices) return { nodes: db.getVertices().size, edges: db.getEdges().length, subgraphs: db.getSubGraphs().length };
  if (db.getEntities) return { nodes: size(db.getEntities()), edges: size(db.getRelationships()), subgraphs: 0 };
  if (db.getStates) return { nodes: size(db.getStates()), edges: size((db.getRelations ?? db.getEdges)?.call(db)), subgraphs: 0 };
  if (db.getClasses) return { nodes: size(db.getClasses()), edges: size(db.getRelations?.()), subgraphs: 0 };
  if (db.getActors) {
    // sequence: the actors, and the messages that draw an arrow (not notes, loops or activations)
    const arrow = new Set([0, 1, 3, 4, 5, 6, 24, 25, 33, 34]);
    return { nodes: db.getActors().size, edges: db.getMessages().filter((m) => arrow.has(m.type)).length, subgraphs: 0 };
  }
  return null;
}
function ownShape(svg) {
  const n = (re) => (svg.match(re) ?? []).length;
  return { nodes: n(/class="node"/g) + n(/class="lifeline"/g), edges: n(/class="edge"/g) + n(/class="message"/g), subgraphs: n(/class="subgraph"/g) };
}

const rows = [];
for (const c of cases) {
  const o = await official(c.text);
  const e = own(c.text);
  const row = { ...c, official: o, own: e };
  const body = c.text.replace(/^---[\s\S]*?---\s*/, "").replace(/^%%.*\s*/gm, "");
  if (o.ok && e.ok && /^\s*(graph|flowchart|stateDiagram|classDiagram|erDiagram|sequenceDiagram)\b/.test(body)) {
    try {
      row.shape = { official: await officialShape(c.text), own: ownShape(e.svg) };
    } catch (err) { if (!globalThis.__w) { globalThis.__w = 1; console.error("shape error:", err?.message); } }
  }
  delete e.svg;
  rows.push(row);
}

const gap = rows.filter((r) => r.official.ok && !r.own.ok);
const lenient = rows.filter((r) => !r.official.ok && r.own.ok);
console.log(`${rows.length} variants; both accept ${rows.filter((r) => r.official.ok && r.own.ok).length}; both reject ${rows.filter((r) => !r.official.ok && !r.own.ok).length}`);
console.log(`\n== official accepts, engine rejects: ${gap.length}`);
for (const r of gap) console.log(`  [${r.kind}] ${r.name}  -> ${r.own.msg}\n      ${JSON.stringify(r.text)}`);
console.log(`\n== official rejects, engine accepts: ${lenient.length}`);
for (const r of lenient) console.log(`  [${r.kind}] ${r.name}  (official: ${r.official.msg})`);
const shapeDiff = rows.filter((r) => r.shape?.official && r.shape.own && JSON.stringify(r.shape.official) !== JSON.stringify(r.shape.own));
console.log(`
== both accept, structure differs (nodes/edges/subgraphs): ${shapeDiff.length} of ${rows.filter((r) => r.shape?.official).length}`);
for (const r of shapeDiff) console.log(`  [${r.kind}] ${r.name}  official ${JSON.stringify(r.shape.official)}  engine ${JSON.stringify(r.shape.own)}
      ${JSON.stringify(r.text)}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 2));

// --check: exit 1 for a divergence that is not a known, deliberate one (see notation-known-gaps.json).
if (args.includes("--check")) {
  const list = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "notation-known-gaps.json"), "utf8"));
  const known = Object.keys(list["official accepts, engine rejects (reason)"]);
  const knownShape = Object.keys(list["structure differs (reason)"]);
  const newGaps = gap.filter((r) => !known.includes(r.name));
  // `~~~` is an invisible link: official counts it as an edge, the engine draws none on purpose
  const newShapes = shapeDiff.filter((r) => !r.text.includes("~~~") && !knownShape.includes(r.name));
  console.log(`\ncheck: ${newGaps.length} new gaps, ${newShapes.length} new structure differences`);
  process.exit(newGaps.length || newShapes.length ? 1 : 0);
}
