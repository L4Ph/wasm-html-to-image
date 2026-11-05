// does the memory grow with every applied change? (wasm memory never shrinks: watch arrayBuffers)
import { createDOM } from "wasm-quickjs-dom";
import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
const mode = process.argv[2] ?? "color";
const MUTATE = mode === "append" ? '{ const d = document.createElement("div"); d.className = "r"; d.textContent = "new " + i; document.body.appendChild(d) }' : 'els[(i*7)%els.length].style.color="#"+(100+i)';
const n = 1000;
let b = ""; for (let i = 0; i < n; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px"><span>row ${i}</span></div>`;
const inst = module.satoru_create_instance();
const dom = await createDOM({ html: `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}</style></head><body style="margin:0">${b}</body></html>` }, { settleMs: 0 });
dom.bridge().window.__layoutProvider = (html, ops) => {
  if (ops) { if (module.satoru_live_apply(inst, ops, 600) === "rebuild") return "rebuild"; return "+" + module.satoru_live_sync(inst, true); }
  module.satoru_live_open(inst, html, 600, 0); return "=" + module.satoru_live_sync(inst, false);
};
await dom.eval("__edgeEnableLiveLayout()");
await dom.eval("globalThis.els = document.body.children; els[0].getBoundingClientRect()");
const mb = () => { const m = process.memoryUsage(); return `ab ${(m.arrayBuffers / 1048576).toFixed(0)} MB, external ${(m.external / 1048576).toFixed(0)} MB, rss ${(m.rss / 1048576).toFixed(0)} MB`; };
console.log("after open: arrayBuffers", mb(), "MB");
for (const batch of [20, 20, 20, 20, 20]) {
  await dom.eval(`for (let i=0;i<${batch};i++){ ${MUTATE}; els[els.length-1].getBoundingClientRect().y }`);
  console.log("after +" + batch + " color changes: arrayBuffers", mb(), "MB");
}
dom.close();
