// P1 of doc/design/live-layout-incremental.md: attribute changes applied to the resident document.
//   node scripts/proto-p1.mjs
// 1. differential: after random attribute changes, the live boxes and styles equal a document built from scratch
// 2. timing: one change + one read on a large page, against the rebuild
import { createDOM } from "wasm-quickjs-dom";
import { loadHtmlToImageModule } from "../dist/loader.js";

const module = await loadHtmlToImageModule();
const WIDTH = 600;

const sheet = `.r{margin:1px}.c1{color:#036;padding:3px}.c2 span{font-weight:bold;font-size:20px}.c3{float:left;width:50px}
.c4>span{display:inline-block;width:80px}#big{height:90px}.hide{display:none}`;
const structuralRule = ".r:nth-child(odd){background:#eee}";
const page = (n, structural = true) => {
  let b = "";
  for (let i = 0; i < n; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"><span>row ${i}</span></div>`;
  return `<!doctype html><html><head><style>${sheet}${structural ? structuralRule : ""}</style></head><body style="margin:0">${b}</body></html>`;
};

// the contract of the guest: __layoutProvider(html, ops) -> "=" + all boxes | "+" + the boxes that changed | "rebuild"
const stats = { open: 0, apply: 0, rebuild: 0, openMs: 0, applyMs: 0 };
const make = (inst) => (html, ops) => {
  const t = performance.now();
  if (ops) {
    const r = module.satoru_live_apply(inst, ops, WIDTH);
    if (r === "rebuild") { stats.rebuild++; if (process.env.DEBUG_REBUILD && stats.rebuild <= 8) console.log("rebuild asked for:", JSON.stringify(ops.slice(0, 260))); return "rebuild"; }
    const out = "+" + module.satoru_live_sync(inst, true);
    stats.apply++;
    stats.applyMs += performance.now() - t;
    return out;
  }
  module.satoru_live_open(inst, html, WIDTH, 0);
  stats.open++;
  stats.openMs += performance.now() - t;
  return "=" + module.satoru_live_sync(inst, false);
};

const open = async (n, structural = true) => {
  const dom = await createDOM({ html: page(n, structural) }, { settleMs: 0 });
  const inst = module.satoru_create_instance();
  dom.bridge().window.__layoutProvider = make(inst);
  await dom.eval("__edgeEnableLiveLayout()");
  return { dom, inst };
};

// ---- 1. differential
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const close = (a, b) => Math.abs(a - b) < 0.011;
const same = (A, B) => {
  if (A.length !== B.length) return `length ${A.length} vs ${B.length}`;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = B[i];
    for (const k of ["x", "y", "w", "h"]) if (!close(a[k], b[k])) return `#${i} <${a.t}> ${k}: live ${a[k]} vs rebuilt ${b[k]}`;
    for (const k of Object.keys(b.s)) {
      if (typeof b.s[k] === "number" ? !close(a.s[k], b.s[k]) : a.s[k] !== b.s[k]) return `#${i} <${a.t}> style ${k}: live ${a.s[k]} vs rebuilt ${b.s[k]}`;
    }
  }
  return null;
};
{
  const N = 40;
  const { dom, inst } = await open(N);
  const ref = module.satoru_create_instance();
  const mutations = [
    (i) => `els[${i} % els.length].className = "r c${Math.floor(rnd() * 5)}"`,
    (i) => `els[${i} % els.length].classList.toggle("hide")`,
    (i) => `els[${i} % els.length].style.height = "${Math.floor(rnd() * 60)}px"`,
    (i) => `els[${i} % els.length].style.cssText = "float:${pick(["left", "right", "none"])};width:${Math.floor(rnd() * 120)}px;color:#${Math.floor(rnd() * 4095).toString(16).padStart(3, "0")}"`,
    (i) => `els[${i} % els.length].setAttribute("data-x", "${Math.floor(rnd() * 9)}")`,
    (i) => `els[${i} % els.length].removeAttribute("style")`,
    (i) => `els[${i} % els.length].id = ${rnd() < 0.5 ? '"big"' : '""'}`,
    (i) => `{ const c = els[${i} % els.length].firstElementChild; if (c) c.style.fontSize = "${8 + Math.floor(rnd() * 20)}px" }`,
    // text, insertion, removal, moves (P2 / P3)
    (i) => `{ const e = els[${i} % els.length]; if (e.firstElementChild && e.firstElementChild.firstChild) e.firstElementChild.firstChild.data = "text ${Math.floor(rnd() * 99)} and some more words" }`,
    (i) => `{ const e = els[${i} % els.length]; if (e.firstElementChild) e.firstElementChild.textContent = "${pick(["", "a", "one two three", "a much longer line of text that may wrap around the box"])}" }`,
    (i) => `{ const d = document.createElement("div"); d.className = "r c${Math.floor(rnd() * 5)}"; d.setAttribute("style", "height:${Math.floor(rnd() * 40)}px"); d.appendChild(document.createElement("span")).textContent = "new ${Math.floor(rnd() * 99)}"; els[${i} % els.length].appendChild(d) }`,
    (i) => `{ const d = document.createElement("div"); d.className = "r"; d.textContent = "inserted"; document.body.insertBefore(d, els[${i} % els.length]) }`,
    (i) => `{ if (els.length > 20) els[${i} % els.length].remove() }`,
    (i) => `{ if (els.length > 20) { const e = els[${i} % els.length]; if (e.lastElementChild && !e.lastElementChild.firstElementChild) e.lastElementChild.remove() } }`,
    (i) => `{ const a = els[${i} % els.length], b = els[(${i} + 7) % els.length]; if (a !== b) document.body.insertBefore(a, b) }`,
  ];
  await dom.eval(`globalThis.els = document.body.children; els[0].getBoundingClientRect()`);
  let bad = 0;
  const STEPS = 300;
  for (let step = 0; step < STEPS && bad < 5; step++) {
    const burst = 1 + Math.floor(rnd() * 3);
    const code = [];
    for (let k = 0; k < burst; k++) code.push(pick(mutations)(Math.floor(rnd() * N)));
    await dom.eval(code.join(";"));
    await dom.eval("els[0].getBoundingClientRect()"); // the live answer for this state
    const live = JSON.parse(module.satoru_live_boxes(inst));
    const html = "<!DOCTYPE html>" + (await dom.eval("document.documentElement.outerHTML"));
    const rebuilt = JSON.parse(module.satoru_layout_style_json(ref, html + `<!--${step}-->`, WIDTH, 0, 0, true));
    const diff = same(live, rebuilt);
    if (diff) { bad++; console.log(`step ${step}: ${diff}\n   ${code.join("; ")}`); }
  }
  console.log(`differential: ${bad === 0 ? "all" : "FAILED after"} ${STEPS} steps ok=${bad === 0} | live applies ${stats.apply}, rebuild asks ${stats.rebuild}, opens ${stats.open}`);
  dom.close();
  module.satoru_destroy_instance(inst);
  module.satoru_destroy_instance(ref);
}

// ---- 2. timing
for (const [n, structural] of [[1000, true], [1000, false], [3000, false]]) {
  const { dom, inst } = await open(n, structural);
  await dom.eval(`globalThis.els = document.body.children; els[0].getBoundingClientRect()`); // the first read opens the document
  const R = 20;
  for (const [label, change] of [
    ["height (moves everything below)", (i) => `els[${i}*7%${n}].style.height=(10+${i})+"px"`],
    ["color (nothing moves)", (i) => `els[${i}*7%${n}].style.color="#"+(100+${i})`],
    ["text edit in a row", (i) => `els[${i}*7%${n}].firstElementChild.firstChild.data = "edited " + ${i}`],
    ["append a <b> to a row", (i) => `els[${i}*7%${n}].appendChild(document.createElement("b")).textContent = "x" + ${i}`],
    ["append a row to <body>", (i) => `{ const d = document.createElement("div"); d.className = "r"; d.textContent = "new " + ${i}; document.body.appendChild(d) }`],
  ]) {
    stats.apply = 0; stats.applyMs = 0;
    const t = performance.now();
    await dom.eval(`for (let i=0;i<${R};i++){${change("i")}; els[${n}-1].getBoundingClientRect().y}`);
    const total = (performance.now() - t) / R;
    console.log(`n=${n} groups (${2 * n} elements${structural ? ", :nth-child in the sheet" : ""}) ${label}: one change + read ${total.toFixed(1)}ms | renderer ${(stats.applyMs / R).toFixed(1)}ms | applies ${stats.apply}`);
  }
  dom.close();
  module.satoru_destroy_instance(inst);
}
