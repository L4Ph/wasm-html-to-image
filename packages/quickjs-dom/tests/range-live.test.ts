import { JSDOM as RealJSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "../src/jsdom.js";

// Ranges follow the tree as it changes, compared step by step with jsdom.

const HTML = "<body><div id=a><p id=p1>one</p><p id=p2>two</p><p id=p3>three</p></div><span id=s>text</span></body>";

const open: JSDOM[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});

type Step = (w: any) => void;
const points = (w: any, r: any) => {
  const name = (n: any) => (n.id ? "#" + n.id : n.nodeType === 3 ? "text:" + n.data : n.nodeName);
  return [name(r.startContainer), r.startOffset, name(r.endContainer), r.endOffset];
};
const run = (setup: Step, mutate: Step) => {
  const ours = new JSDOM(HTML, { virtualConsole: null });
  open.push(ours);
  const ref = new RealJSDOM(HTML);
  const out = [ours.window, ref.window].map((w: any) => {
    const r = w.document.createRange();
    setup({ w, r });
    mutate(w);
    return points(w, r);
  });
  return out;
};

const cases: Record<string, [(c: any) => void, Step]> = {
  "remove a sibling before the range": [
    (c) => { c.r.setStart(c.w.document.getElementById("a"), 1); c.r.setEnd(c.w.document.getElementById("a"), 3); },
    (w) => w.document.getElementById("p1").remove(),
  ],
  "remove a node containing the range": [
    (c) => { const t = c.w.document.getElementById("p2").firstChild; c.r.setStart(t, 1); c.r.setEnd(t, 2); },
    (w) => w.document.getElementById("p2").remove(),
  ],
  "insert before the range": [
    (c) => { c.r.setStart(c.w.document.getElementById("a"), 1); c.r.setEnd(c.w.document.getElementById("a"), 2); },
    (w) => w.document.getElementById("a").insertBefore(w.document.createElement("hr"), w.document.getElementById("p1")),
  ],
  "append after the range does not move it": [
    (c) => { c.r.setStart(c.w.document.getElementById("a"), 0); c.r.setEnd(c.w.document.getElementById("a"), 1); },
    (w) => w.document.getElementById("a").appendChild(w.document.createElement("hr")),
  ],
  "move a node within the parent": [
    (c) => { c.r.setStart(c.w.document.getElementById("a"), 0); c.r.setEnd(c.w.document.getElementById("a"), 3); },
    (w) => w.document.getElementById("a").appendChild(w.document.getElementById("p1")),
  ],
  "replace a child": [
    (c) => { c.r.setStart(c.w.document.getElementById("a"), 0); c.r.setEnd(c.w.document.getElementById("a"), 3); },
    (w) => w.document.getElementById("a").replaceChild(w.document.createElement("b"), w.document.getElementById("p2")),
  ],
  "text data replaced": [
    (c) => { const t = c.w.document.getElementById("s").firstChild; c.r.setStart(t, 1); c.r.setEnd(t, 3); },
    (w) => { w.document.getElementById("s").firstChild.data = "longer text"; },
  ],
  "textContent of an ancestor": [
    (c) => { const t = c.w.document.getElementById("p3").firstChild; c.r.setStart(t, 1); c.r.setEnd(c.w.document.getElementById("a"), 3); },
    (w) => { w.document.getElementById("a").textContent = "new"; },
  ],
  "innerHTML of the container": [
    (c) => { c.r.setStart(c.w.document.getElementById("a"), 1); c.r.setEnd(c.w.document.getElementById("a"), 2); },
    (w) => { w.document.getElementById("a").innerHTML = "<i>x</i><i>y</i>"; },
  ],
  "remove the container itself": [
    (c) => { c.r.setStart(c.w.document.getElementById("p1").firstChild, 1); c.r.setEnd(c.w.document.getElementById("p3").firstChild, 2); },
    (w) => w.document.getElementById("a").remove(),
  ],
};

describe("live ranges", () => {
  for (const [name, [setup, mutate]] of Object.entries(cases)) {
    it(name, () => {
      const [a, b] = run(setup, mutate);
      expect(a).toEqual(b);
    });
  }

  it("a range inside a selection keeps the selection in step", () => {
    const dom = new JSDOM(HTML, { virtualConsole: null });
    open.push(dom);
    const win = dom.window as any;
    const document = win.document;
    const sel = win.getSelection();
    sel.setBaseAndExtent(document.getElementById("a"), 1, document.getElementById("a"), 3);
    document.getElementById("p1").remove();
    expect([sel.anchorOffset, sel.focusOffset]).toEqual([0, 2]);
  });
});
