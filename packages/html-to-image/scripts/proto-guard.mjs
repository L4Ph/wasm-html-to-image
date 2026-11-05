// live layout degrades instead of failing: too many elements, or a renderer that throws
import { createDOM } from "wasm-quickjs-dom";
import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
const html = (n) => `<!doctype html><html><head><style>.r{height:20px;color:#036}</style></head><body style="margin:0">${'<div class="r">x</div>'.repeat(n)}</body></html>`;
let failed = 0;
const check = (label, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label} ${extra}`); if (!ok) failed++; };

async function scenario(n, max, makeProvider) {
  const inst = module.satoru_create_instance();
  const stats = { calls: 0 };
  const warnings = [];
  const dom = await createDOM({ html: html(n) }, { settleMs: 0, onConsole: undefined });
  dom.bridge().window.__layoutProvider = makeProvider(inst, stats);
  await dom.eval(`console.warn = (m) => { globalThis.__warned = (globalThis.__warned || []).concat(String(m)) }; __edgeEnableLiveLayout(${max === undefined ? "" : max})`);
  const rect = await dom.eval(`(() => { const e = document.body.lastElementChild; return [e.getBoundingClientRect().y, e.offsetHeight, getComputedStyle(e).color] })()`);
  const again = await dom.eval(`(() => { document.body.lastElementChild.style.height = "50px"; return document.body.lastElementChild.getBoundingClientRect().height })()`);
  const warned = await dom.eval(`JSON.stringify(globalThis.__warned || [])`);
  dom.close();
  module.satoru_destroy_instance(inst);
  return { rect, again, warned: JSON.parse(warned), stats };
}
const real = (inst, stats) => (h, ops) => {
  stats.calls++;
  if (ops) return module.satoru_live_apply(inst, ops, 600) === "rebuild" ? "rebuild" : "+" + module.satoru_live_sync(inst, true);
  module.satoru_live_open(inst, h, 600, 0);
  return "=" + module.satoru_live_sync(inst, false);
};

let r = await scenario(50, undefined, real);
check("normal page is laid out", r.rect[0] === 49 * 20 && r.again === 50 && r.warned.length === 0, JSON.stringify(r.rect));

r = await scenario(300, 100, real);
check("over the element cap: no layout, the renderer is never called", r.stats.calls === 0 && r.rect[0] === 0 && r.rect[1] === 0 && r.again === 0, JSON.stringify(r.rect));
check("   ... the cascade still answers getComputedStyle", r.rect[2] === "rgb(0, 51, 102)", r.rect[2]);
check("   ... one warning", r.warned.length === 1 && /more than 100 elements/.test(r.warned[0]), JSON.stringify(r.warned));

r = await scenario(20, undefined, () => () => { throw new Error("out of memory"); });
check("renderer throws: the page keeps running without layout", r.rect[0] === 0 && r.again === 0, JSON.stringify(r.rect));
check("   ... one warning that names the failure", r.warned.length === 1 && /renderer failed: out of memory/.test(r.warned[0]), JSON.stringify(r.warned));

r = await scenario(20, undefined, (inst, stats) => { const f = real(inst, stats); return (h, ops) => { if (ops) throw new Error("apply failed"); return f(h, ops); }; });
check("renderer fails on an update: layout stops, the page keeps running", r.again === 0 && r.warned.length === 1, JSON.stringify(r.warned));

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
