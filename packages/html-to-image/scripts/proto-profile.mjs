// where does one live re-measure spend its time? (n elements)
import { createDOM } from "wasm-quickjs-dom";
import { loadHtmlToImageModule } from "../dist/loader.js";
const n = Number(process.argv[2] ?? 1000);
const module = await loadHtmlToImageModule();
const inst = module.satoru_create_instance();
const T = { provider: 0, parse: 0, layoutOnly: 0, calls: 0, htmlBytes: 0, jsonBytes: 0 };
const provider = (html) => {
  const t0 = performance.now();
  const json = module.satoru_layout_style_json(inst, html, 600, 0, 0, true);
  const t1 = performance.now();
  const list = JSON.parse(json);
  const boxes = {};
  for (const b of list) { const m = /(?:^|\s)qjsl-(\d+)(?:\s|$)/.exec(b.c); if (m) boxes[m[1]] = [b.x, b.y, b.w, b.h, b.s]; }
  const out = JSON.stringify(boxes);
  T.provider += t1 - t0; T.parse += performance.now() - t1; T.calls++; T.htmlBytes = html.length; T.jsonBytes = out.length;
  return out;
};
let body = "";
for (let i = 0; i < n; i++) body += `<div class="r" style="height:${10 + (i % 7)}px;padding:2px">row ${i}</div>`;
const dom = await createDOM({ html: `<!doctype html><body style="margin:0">${body}</body>` }, { settleMs: 0 });
dom.bridge().window.__layoutProvider = provider;
await dom.eval("__edgeEnableLiveLayout()");
await dom.eval(`document.body.lastElementChild.getBoundingClientRect().y`); // warm
Object.assign(T, { provider: 0, parse: 0, calls: 0 });
const R = 20;
const t = performance.now();
await dom.eval(`for (let i=0;i<${R};i++){document.body.firstElementChild.style.height=(10+i)+"px";document.body.lastElementChild.getBoundingClientRect().y}`);
const total = performance.now() - t;
const mark = await dom.eval(`(()=>{const s=performance.now();for(let i=0;i<${R};i++)__edgeMarkLayout();return (performance.now()-s)/${R}})()`).catch(() => null);
console.log(`n=${n} per measure: total ${(total / R).toFixed(1)}ms | renderer(parse+layout+json) ${(T.provider / T.calls).toFixed(1)}ms | host JSON ${(T.parse / T.calls).toFixed(1)}ms | guest mark ${mark === null ? "?" : Number(mark).toFixed(1)}ms | html ${T.htmlBytes}B -> boxes ${T.jsonBytes}B`);
dom.close(); module.satoru_destroy_instance(inst);
