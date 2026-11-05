import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
const inst = module.satoru_create_instance();
const mk = (n, k) => { let b = ""; for (let i = 0; i < n; i++) b += `<div class="r" style="height:${10 + ((i + k) % 7)}px;padding:2px">row ${i}</div>`; return `<!doctype html><body style="margin:0">${b}</body>`; };
const time = (label, f, R = 10) => { f(0); const t = performance.now(); for (let i = 1; i <= R; i++) f(i); console.log(label.padEnd(34), ((performance.now() - t) / R).toFixed(1) + "ms"); };
for (const n of [1000]) {
  time(`n=${n} layout_json (no style)`, (k) => module.satoru_layout_json(inst, mk(n, k), 600, 0, 0, true));
  time(`n=${n} layout_json (style)`, (k) => module.satoru_layout_style_json(inst, mk(n, k), 600, 0, 0, true));
  time(`n=${n} layout_json (no inline)`, (k) => module.satoru_layout_json(inst, mk(n, k), 600, 0, 0, false));
  time(`n=${n} same html again`, () => module.satoru_layout_json(inst, mk(n, 0), 600, 0, 0, true));
  time(`n=${n} only build string`, (k) => mk(n, k).length);
  time(`n=10 layout_json`, (k) => module.satoru_layout_json(inst, mk(10, k), 600, 0, 0, true), 30);
}
module.satoru_set_collect_profile_enabled(inst, true);
for (let i = 1; i <= 3; i++) module.satoru_layout_json(inst, mk(1000, 100 + i), 600, 0, 0, true);
const p = JSON.parse(module.satoru_get_collect_profile(inst));
console.log(JSON.stringify(p).slice(0, 900));
