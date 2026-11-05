// P0 of doc/design/live-layout-incremental.md: what does restyle + relayout of a resident document cost?
import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
const mk = (n, rows) => { let b = ""; for (let i = 0; i < n; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"><span>row ${i}</span></div>`; return `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}.c2 span{font-weight:bold}.r:nth-child(odd){background:#eee}</style></head><body style="margin:0">${b}</body></html>`; };
for (const n of [1000, 3000]) {
  const inst = module.satoru_create_instance();
  const html = mk(n);
  const t = performance.now();
  module.satoru_layout_json(inst, html, 600, 0, 0, false); // full build (the "作り直し")
  const full = performance.now() - t;
  const avg = (mode) => {
    const sum = { clear: 0, apply: 0, compute: 0, tree: 0, layout: 0 };
    const R = 8;
    JSON.parse(module.satoru_live_probe(inst, 600, mode)); // warm
    for (let i = 0; i < R; i++) { const p = JSON.parse(module.satoru_live_probe(inst, 600, mode)); for (const k in sum) sum[k] += p[k] / R; }
    const total = Object.values(sum).reduce((a, b) => a + b, 0);
    return `total ${total.toFixed(1)}ms  ` + Object.entries(sum).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" | ");
  };
  console.log(`n=${n}: full rebuild ${full.toFixed(1)}ms`);
  console.log(`   mode0 reapply stylesheets: ${avg(0)}`);
  console.log(`   mode1 refresh_styles only: ${avg(1)}`);
  module.satoru_destroy_instance(inst);
}
