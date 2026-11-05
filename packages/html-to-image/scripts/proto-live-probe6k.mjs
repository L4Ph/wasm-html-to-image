import { loadHtmlToImageModule } from "../dist/loader.js";
const m = await loadHtmlToImageModule();
const inst = m.satoru_create_instance();
const n = 3000; let b = ""; for (let i = 0; i < n; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"><span>row ${i}</span></div>`;
m.satoru_layout_json(inst, `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}</style></head><body style="margin:0">${b}</body></html>`, 600, 0, 0, true);
for (let i = 0; i < 4; i++) console.log(m.satoru_live_probe(inst, 600, 0));
