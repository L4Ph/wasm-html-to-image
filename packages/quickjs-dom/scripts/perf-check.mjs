// The Phase 4 guards, measured rather than asserted (numbers move with the machine; the suite
// must not flake on them): bridge round-trip cost against the design's ~3 µs, host-driven DOM
// work against jsdom (the design's line is 2x), and whether creating and discarding ten
// thousand nodes over and over grows anything.
//   node scripts/perf-check.mjs   (imports the built dist: rebuild first — pnpm --filter wasm-quickjs-dom build)
import { JSDOM as RealJSDOM } from "jsdom";
import { JSDOM } from "../dist/jsdom.js";

const now = () => performance.now();
const per = (ms, n) => (ms * 1000 / n).toFixed(2) + " µs/op";

// 1. one host->page property read, the bridge's round trip
{
  const ours = new JSDOM("<p id=x>hello</p>", { virtualConsole: null });
  const ref = new RealJSDOM("<p id=x>hello</p>");
  const oe = ours.window.document.getElementById("x");
  const re = ref.window.document.getElementById("x");
  const N = 20000;
  for (const [name, el] of [["ours", oe], ["jsdom", re]]) {
    let t = now();
    let sink = "";
    for (let i = 0; i < N; i++) sink += el.textContent;
    console.log(`bridge read textContent (${name}): ${per(now() - t, N)} (sink ${sink.length})`);
  }
  ours.close();
}

// 2. host-driven DOM work: build a 3000-node tree, read it back, tear it down
const build = (document) => {
  const root = document.createElement("div");
  for (let i = 0; i < 100; i++) {
    const sec = document.createElement("section");
    sec.setAttribute("data-i", String(i));
    for (let j = 0; j < 29; j++) {
      const p = document.createElement("p");
      p.textContent = `item ${i}-${j}`;
      sec.appendChild(p);
    }
    root.appendChild(sec);
  }
  document.body.appendChild(root);
  return root;
};
{
  const ours = new JSDOM("<!doctype html><body></body>", { virtualConsole: null });
  const ref = new RealJSDOM("<!doctype html><body></body>");
  const times = {};
  for (const [name, dom] of [["ours", ours], ["jsdom", ref]]) {
    // the phases separately: a framework's render is the first two (it holds its own
    // references); sweeping a fresh query result back out is host bookkeeping of another kind
    let t = now();
    const root = build(dom.window.document);
    const built = now() - t;
    t = now();
    const html = root.innerHTML.length;
    const read = now() - t;
    t = now();
    root.querySelectorAll("p").forEach((p) => p.remove());
    const sweep = now() - t;
    root.remove();
    times[name] = built + read;
    console.log(`3000 nodes (${name}): build ${built.toFixed(1)} ms, read ${read.toFixed(1)} ms, query-sweep ${sweep.toFixed(1)} ms (html ${html})`);
  }
  console.log(`ratio ours/jsdom (build+read, the render shape): ${(times.ours / times.jsdom).toFixed(2)}x (guard: <= 2x)`);
  ours.close();
}

// 3. ten thousand nodes, created and discarded, five times over
{
  const ours = new JSDOM("<!doctype html><body></body>", { virtualConsole: null });
  const rss = () => Math.round(process.memoryUsage().rss / 1048576);
  console.log(`memory: start rss ${rss()} MB`);
  for (let cycle = 1; cycle <= 5; cycle++) {
    await ours.window.eval(`(() => {
      const host = document.createElement("div");
      for (let i = 0; i < 10000; i++) { const s = document.createElement("span"); s.textContent = "n" + i; host.appendChild(s); }
      document.body.appendChild(host);
      host.remove();
      return document.querySelectorAll("span").length;
    })()`);
    console.log(`memory: after cycle ${cycle} rss ${rss()} MB`);
  }
  ours.close();
}
