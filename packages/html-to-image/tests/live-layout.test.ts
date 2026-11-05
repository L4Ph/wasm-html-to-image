import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, enableLiveLayout } from "../src/edge-js.js";
import { loadHtmlToImageModule, type HtmlToImageModule } from "../src/loader.js";

const SHEET = `.r{margin:1px}.c1{color:#036;padding:3px}.c2 span{font-weight:bold;font-size:20px}.c3{float:left;width:50px}
.c4>span{display:inline-block;width:80px}.r:nth-child(odd){background:#eee}#big{height:90px}.hide{display:none}`;
const rows = (n: number) => {
  let b = "";
  for (let i = 0; i < n; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"><span>row ${i}</span></div>`;
  return `<!doctype html><html><head><style>${SHEET}</style></head><body style="margin:0">${b}</body></html>`;
};

let module: HtmlToImageModule;
beforeAll(async () => {
  module = await loadHtmlToImageModule();
});
afterAll(() => undefined);

describe("live layout: enableLiveLayout", () => {
  it("answers getBoundingClientRect / offsetHeight / getComputedStyle from the engine, and follows the page's changes", async () => {
    const dom = await createDOM({ html: `<!doctype html><html><head><style>#a{width:200px;height:50px;padding:10px;border:2px solid #000}.c{display:flex}.c>div{width:100px;height:30px}</style></head><body style="margin:0"><div id="a">A</div><div class="c"><div id="b1"></div><div id="b2"></div></div></body></html>` }, { settleMs: 0 });
    const layout = await enableLiveLayout(dom, module, { width: 400 });
    try {
      const rect = (id: string) => dom.eval(`(() => { const r = document.getElementById("${id}").getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()`);
      expect(await rect("a")).toEqual([0, 0, 224, 74]);
      expect(await rect("b2")).toEqual([100, 74, 100, 30]);
      expect(await dom.eval(`document.getElementById("a").offsetHeight`)).toBe(74);
      await dom.eval(`document.getElementById("a").style.height = "100px"`);
      expect(await rect("a")).toEqual([0, 0, 224, 124]);
      expect(await rect("b1")).toEqual([0, 124, 100, 30]);
      // text, an inserted node and a removed one
      await dom.eval(`document.getElementById("b1").textContent = "hello"`);
      await dom.eval(`const d = document.createElement("div"); d.id = "n"; d.style.height = "40px"; document.body.insertBefore(d, document.querySelector(".c"))`);
      expect(await rect("n")).toEqual([0, 124, 400, 40]);
      expect(await rect("b2")).toEqual([100, 164, 100, 30]);
      await dom.eval(`document.getElementById("n").remove()`);
      expect(await rect("b2")).toEqual([100, 124, 100, 30]);
      const cs = await dom.eval(`(() => { const s = getComputedStyle(document.getElementById("a")); return [s.display, s.paddingLeft, s.borderLeftWidth] })()`);
      expect(cs).toEqual(["block", "10px", "2px"]);
      await dom.eval(`document.getElementById("b1").style.cssText = "float:left;color:#336699;font-size:2em;margin:3px 5px"`);
      expect(await dom.eval(`(() => { const s = getComputedStyle(document.getElementById("b1")); return [s.float, s.color, s.fontSize, s.marginTop, s.marginLeft] })()`)).toEqual(["left", "rgb(51, 102, 153)", "32px", "3px", "5px"]);
    } finally {
      layout.dispose();
      dom.close();
    }
  });

  it("matches a layout built from scratch after random changes of attributes, text and the tree", async () => {
    const N = 30;
    const dom = await createDOM({ html: rows(N) }, { settleMs: 0 });
    const layout = await enableLiveLayout(dom, module, { width: 600 });
    const reference = module.satoru_create_instance();
    try {
      let seed = 4242;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
      const at = (i: number) => `els[${i} % els.length]`;
      const mutations: ((i: number) => string)[] = [
        (i) => `${at(i)}.className = "r c${Math.floor(rnd() * 5)}"`,
        (i) => `${at(i)}.classList.toggle("hide")`,
        (i) => `${at(i)}.style.height = "${Math.floor(rnd() * 60)}px"`,
        (i) => `${at(i)}.style.cssText = "float:${pick(["left", "right", "none"])};width:${Math.floor(rnd() * 120)}px;color:#${Math.floor(rnd() * 4095).toString(16).padStart(3, "0")}"`,
        (i) => `${at(i)}.setAttribute("data-x", "${Math.floor(rnd() * 9)}")`,
        (i) => `${at(i)}.removeAttribute("style")`,
        (i) => `{ const c = ${at(i)}.firstElementChild; if (c) c.style.fontSize = "${8 + Math.floor(rnd() * 20)}px" }`,
        (i) => `{ const c = ${at(i)}.firstElementChild; if (c && c.firstChild) c.firstChild.data = "text ${Math.floor(rnd() * 99)} and some more words" }`,
        (i) => `{ const c = ${at(i)}.firstElementChild; if (c) c.textContent = "${pick(["", "a", "one two three", "a much longer line of text that may wrap around the box"])}" }`,
        (i) => `{ const d = document.createElement("div"); d.className = "r c${Math.floor(rnd() * 5)}"; d.setAttribute("style", "height:${Math.floor(rnd() * 40)}px"); d.appendChild(document.createElement("span")).textContent = "new ${Math.floor(rnd() * 99)}"; ${at(i)}.appendChild(d) }`,
        (i) => `{ const d = document.createElement("div"); d.className = "r"; d.textContent = "inserted"; document.body.insertBefore(d, ${at(i)}) }`,
        (i) => `{ if (els.length > 12) ${at(i)}.remove() }`,
        (i) => `{ const a = ${at(i)}, b = els[(${i} + 7) % els.length]; if (a !== b) document.body.insertBefore(a, b) }`,
      ];
      await dom.eval(`globalThis.els = document.body.children; els[0].getBoundingClientRect()`);
      const near = (a: number, b: number) => Math.abs(a - b) < 0.011;
      for (let step = 0; step < 60; step++) {
        const code: string[] = [];
        for (let k = 0, burst = 1 + Math.floor(rnd() * 3); k < burst; k++) code.push(pick(mutations)(Math.floor(rnd() * N)));
        await dom.eval(code.join(";"));
        await dom.eval("els[0].getBoundingClientRect()");
        // what the page reads for the elements the engine lays out (not <head>, not display:none and what is inside it) ...
        const live = JSON.parse((await dom.eval(`JSON.stringify(Array.from(document.querySelectorAll("body, body *, html")).filter((e) => {
          for (let n = e; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).display === "none") return false;
          return true;
        }).map((e) => { const r = e.getBoundingClientRect(); return [e.tagName.toLowerCase(), r.x, r.y, r.width, r.height, getComputedStyle(e).color] }))`)) as string) as [string, number, number, number, number, string][];
        // ... and what the engine says for a document built from scratch out of this state's HTML
        const html = "<!DOCTYPE html>" + ((await dom.eval("document.documentElement.outerHTML")) as string);
        const built = JSON.parse(module.satoru_layout_style_json!(reference, html, 600, 0, 0, true)) as { t: string; x: number; y: number; w: number; h: number; s: Record<string, string | number> }[];
        // (an inline element with nothing in it has no box in the engine's list, and nothing to compare: leave out what has no size)
        const liveInOrder = live.filter((l) => l[3] !== 0 || l[4] !== 0);
        const wanted = built.filter((e) => e.t !== "head" && (e.w !== 0 || e.h !== 0));
        expect(liveInOrder.length, `step ${step}: ${code.join("; ")}`).toBe(wanted.length);
        expect(wanted.length, "the comparison covers real elements").toBeGreaterThan(20);
        for (let i = 0; i < wanted.length; i++) {
          const l = liveInOrder[i];
          const e = wanted[i];
          const where = `step ${step} element #${i} <${e.t}>: ${code.join("; ")}`;
          expect(l[0], where).toBe(e.t);
          expect(near(l[1], e.x) && near(l[2], e.y) && near(l[3], e.w) && near(l[4], e.h), `${where} box ${l.slice(1, 5)} vs ${[e.x, e.y, e.w, e.h]}`).toBe(true);
          expect(l[5], `${where} color`).toBe(e.s.color);
        }
      }
    } finally {
      module.satoru_destroy_instance(reference);
      layout.dispose();
      dom.close();
    }
  }, 120_000);

  it("stops laying out a page with more elements than maxElements, and keeps the page running", async () => {
    const dom = await createDOM({ html: rows(40) }, { settleMs: 0 });
    const layout = await enableLiveLayout(dom, module, { width: 600, maxElements: 30 });
    try {
      await dom.eval(`console.warn = (m) => { globalThis.__warned = (globalThis.__warned || []).concat(String(m)) }`);
      expect(await dom.eval(`document.body.lastElementChild.getBoundingClientRect().y`)).toBe(0);
      expect(await dom.eval(`getComputedStyle(document.body.lastElementChild).color`)).toBe("rgb(0, 0, 0)");
      expect(JSON.parse((await dom.eval(`JSON.stringify(globalThis.__warned || [])`)) as string)).toHaveLength(1);
    } finally {
      layout.dispose();
      dom.close();
    }
  });

  it("stops laying out, without breaking the page, after dispose()", async () => {
    const dom = await createDOM({ html: rows(5) }, { settleMs: 0 });
    const layout = await enableLiveLayout(dom, module, { width: 600 });
    try {
      expect(await dom.eval(`document.body.lastElementChild.getBoundingClientRect().y`)).toBeGreaterThan(0);
      layout.dispose();
      await dom.eval(`document.body.firstElementChild.style.height = "99px"`);
      expect(await dom.eval(`document.body.lastElementChild.getBoundingClientRect().y`)).toBe(0);
      expect(await dom.eval(`document.title = "still running"; document.title`)).toBe("still running");
    } finally {
      dom.close();
    }
  });
});
