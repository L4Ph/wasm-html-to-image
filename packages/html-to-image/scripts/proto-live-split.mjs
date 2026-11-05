import { createDOM, enableLiveLayout } from "../dist/edge-js.js";
import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
const T = { apply: 0, sync: 0, n: 0 };
const w = new Proxy(module, { get(t, k) { const v = t[k]; if (k === "satoru_live_apply") return (...a) => { const s = performance.now(); const r = v.apply(t, a); T.apply += performance.now() - s; T.n++; return r; }; if (k === "satoru_live_sync") return (...a) => { const s = performance.now(); const r = v.apply(t, a); T.sync += performance.now() - s; return r; }; return typeof v === "function" ? v.bind(t) : v; } });
const n = Number(process.argv[2] ?? 3000);
let b = ""; for (let i = 0; i < n; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"><span>row ${i}</span></div>`;
const dom = await createDOM({ html: `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}</style></head><body style="margin:0">${b}</body></html>` }, { settleMs: 0 });
const L = await enableLiveLayout(dom, w, { width: 600 });
await dom.eval("globalThis.els=document.body.children; els[0].getBoundingClientRect().y");
for (const [name, code] of [["color", "els[i*7%N].style.color='#'+(100+i)"], ["height", "els[i*7%N].style.height=(10+i)+'px'"]]) {
  T.apply = T.sync = T.n = 0; const R = 10;
  const t = performance.now();
  await dom.eval(`(()=>{const N=${n};for(let i=0;i<${R};i++){${code};els[N-1].getBoundingClientRect().y}})()`);
  const tot = (performance.now() - t) / R;
  console.log(`${name}: total ${tot.toFixed(1)}ms  apply ${(T.apply / R).toFixed(1)}  sync ${(T.sync / R).toFixed(1)}  rest(js) ${(tot - (T.apply + T.sync) / R).toFixed(1)}`);
}
