// Speed of the native DOM (QuickJS in WebAssembly) against jsdom (V8) on a generated table page: median of several runs
// per operation. jsdom is a devDependency. Needs the package built (dist/).
// Usage (from `packages/quickjs-dom/`): node scripts/bench-dom.mjs
import { JSDOM, VirtualConsole } from "jsdom";
import { createDOM } from "../dist/index.js";

const rows = (n) =>
  Array.from({ length: n }, (_, i) => `<tr class="r${i % 7}"><td>${i}</td><td><a href="/x/${i}" title="t&amp;${i}">link ${i}</a></td><td><span class="k">v${i}</span></td></tr>`).join("");
const page = (n) => `<!doctype html><html><head><title>t</title></head><body><div id=app><table>${rows(n)}</table></div></body></html>`;
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const time = (f, reps) => {
  const t = [];
  for (let i = 0; i < reps; i++) {
    const s = performance.now();
    f();
    t.push(performance.now() - s);
  }
  return median(t);
};
const virtualConsole = new VirtualConsole();

// QuickJS's performance.now() has a resolution of 1 ms, so each sample is a batch of K runs
const native = await createDOM({ html: "<p>" }, { settleMs: 0, timeout: 0 });
const inPage = (reps, html) =>
  native.eval(
    `(function () {
      var h = ${JSON.stringify(html)}, R = ${reps}, K = 20;
      var m = function (f) { var t = []; for (var i = 0; i < R; i++) { var s = performance.now(); for (var k = 0; k < K; k++) f(); t.push((performance.now() - s) / K); } t.sort(function (a, b) { return a - b; }); return t[t.length >> 1]; };
      var d;
      return {
        parse: m(function () { d = new DOMParser().parseFromString(h, "text/html"); }),
        query: m(function () { d.querySelectorAll("tr.r3 > td a[href]").length; d.querySelectorAll("span.k").length; }),
        serialize: m(function () { d.documentElement.outerHTML; }),
        mutate: m(function () { var u = d.createElement("ul"); for (var i = 0; i < 2000; i++) { var li = d.createElement("li"); li.setAttribute("class", "c" + i); li.textContent = "x" + i; u.appendChild(li); } d.body.appendChild(u); u.remove(); }),
        walk: m(function () { var c = 0, w = d.createTreeWalker(d.body, 1); while (w.nextNode()) c++; }),
      };
    })()`,
  );

console.log("elements | operation | jsdom ms | native ms | jsdom / native");
for (const n of [100, 1000, 5000]) {
  const html = page(n);
  const reps = n >= 5000 ? 5 : 15;
  let d;
  const j = { parse: time(() => (d = new JSDOM(html, { virtualConsole }).window.document), reps) };
  j.query = time(() => (d.querySelectorAll("tr.r3 > td a[href]").length, d.querySelectorAll("span.k").length), reps);
  j.serialize = time(() => d.documentElement.outerHTML, reps);
  j.mutate = time(() => {
    const u = d.createElement("ul");
    for (let i = 0; i < 2000; i++) {
      const li = d.createElement("li");
      li.setAttribute("class", "c" + i);
      li.textContent = "x" + i;
      u.appendChild(li);
    }
    d.body.appendChild(u);
    u.remove();
  }, reps);
  j.walk = time(() => {
    let c = 0;
    const w = d.createTreeWalker(d.body, 1);
    while (w.nextNode()) c++;
  }, reps);
  const v = await inPage(reps, html);
  for (const k of Object.keys(j)) console.log(`${n * 5} | ${k} | ${j[k].toFixed(2)} | ${v[k].toFixed(2)} | ${(j[k] / v[k]).toFixed(1)}x`);
}

// from nothing to a parsed page: a JSDOM against createDOM (a QuickJS instance copied from a started one, then the parse)
const html = page(1000);
const startJsdom = time(() => new JSDOM(html, { virtualConsole }), 10);
const starts = [];
for (let i = 0; i < 10; i++) {
  const s = performance.now();
  (await createDOM({ html }, { settleMs: 0 })).close();
  starts.push(performance.now() - s);
}
console.log(`new page with 1000 rows: jsdom ${startJsdom.toFixed(1)} ms, createDOM ${median(starts).toFixed(1)} ms`);
native.close();
