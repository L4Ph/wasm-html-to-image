import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

// Collection iteration passes the collection itself to callbacks — never the snapshot array
// behind it. Browsers pass the list, and the distinction is not cosmetic for a host callback:
// its arguments are encoded per call, so receiving the raw array means serializing every item
// on every invocation (a 300-item sweep measured ~2.9 ms per call before this was pinned).

let dom: QuickJSDOM;
let w: any;
beforeAll(async () => {
  dom = await createDOM({ html: "<!doctype html><body><div id=r></div></body>" }, { settleMs: 0 });
  w = dom.bridge().window;
  const root = w.document.getElementById("r");
  for (let i = 0; i < 5; i++) {
    const p = w.document.createElement("p");
    p.textContent = "x" + i;
    root.appendChild(p);
  }
});
afterAll(() => dom.close());

describe("collection callbacks receive the collection", () => {
  it("querySelectorAll forEach: value, index, and the list itself", () => {
    const list = w.document.querySelectorAll("#r p");
    const seen: unknown[] = [];
    list.forEach((node: any, i: number, l: any) => {
      seen.push([node.textContent, i, l === list]);
    });
    expect(seen).toEqual([
      ["x0", 0, true],
      ["x1", 1, true],
      ["x2", 2, true],
      ["x3", 3, true],
      ["x4", 4, true],
    ]);
  });

  it("a host callback can remove while sweeping a static list", () => {
    const root = w.document.getElementById("r");
    root.querySelectorAll("p").forEach((p: any) => p.remove());
    expect(root.childNodes.length).toBe(0);
    expect(root.innerHTML).toBe("");
  });

  it("live collections: the guest-side callback also receives the collection, not an array", async () => {
    const root = w.document.getElementById("r");
    for (let i = 0; i < 3; i++) root.appendChild(w.document.createElement("i"));
    const kinds: string[] = [];
    w.document.body.onclick = function (node: any, i: number, l: any) {
      kinds.push(Array.isArray(l) ? "array" : "collection:" + (l && l.length));
    };
    await dom.eval('document.getElementById("r").childNodes.forEach(document.body.onclick)');
    expect(kinds).toEqual(["collection:3", "collection:3", "collection:3"]);
    await dom.eval('document.getElementById("r").children.forEach(document.body.onclick)');
    expect(kinds.slice(3)).toEqual(["collection:3", "collection:3", "collection:3"]);
  });
});
