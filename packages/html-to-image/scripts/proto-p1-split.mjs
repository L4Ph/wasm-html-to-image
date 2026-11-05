import { createDOM } from "wasm-quickjs-dom";
import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
const n = 1000;
let b = ""; for (let i = 0; i < n; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"><span>row ${i}</span></div>`;
const dom = await createDOM({ html: `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}</style></head><body style="margin:0">${b}</body></html>` }, { settleMs: 0 });
const inst = module.satoru_create_instance();
const T = { apply: 0, boxes: 0, bytes: 0 };
dom.bridge().window.__layoutProvider = (html, ops) => {
  let t = performance.now();
  if (ops) { const r = module.satoru_live_apply(inst, ops, 600); T.apply += performance.now() - t; if (r === "rebuild") return "rebuild"; }
  else module.satoru_live_open(inst, html, 600, 0);
  t = performance.now();
  const json = module.satoru_live_sync(inst, !!ops);
  T.boxes += performance.now() - t; T.bytes = json.length;
  return (ops ? "+" : "=") + json;
};
await dom.eval("__edgeEnableLiveLayout()");
await dom.eval("globalThis.els = document.body.children; els[0].getBoundingClientRect()");
Object.assign(T, { apply: 0, boxes: 0 });
const R = 20, t = performance.now();
await dom.eval(`for (let i=0;i<${R};i++){els[i*7%${n}].style.height=(10+i)+"px"; els[${n}-1].getBoundingClientRect().y}`);
const total = (performance.now() - t) / R;
console.log(`total ${total.toFixed(1)} | apply ${(T.apply / R).toFixed(1)} | live_boxes ${(T.boxes / R).toFixed(1)} | boxes json ${T.bytes}B | rest(guest+bridge) ${(total - (T.apply + T.boxes) / R).toFixed(1)}`);
dom.close();
