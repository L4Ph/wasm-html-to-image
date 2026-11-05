import { createDOM } from "wasm-quickjs-dom";
import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
console.log("memory-ish keys:", Object.keys(module).filter((k) => /mem|HEAP|wasm/i.test(k)));
const mem = () => { const m = module.wasmMemory ?? module.asm?.memory ?? module.HEAPU8?.buffer; return m ? ((m.buffer ?? m).byteLength / 1048576).toFixed(0) + " MB" : "?"; };
const inst = module.satoru_create_instance();
let b = ""; for (let i = 0; i < 1000; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px"><span>row ${i}</span></div>`;
const html = `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}</style></head><body style="margin:0">${b}</body></html>`;
module.satoru_live_open(inst, html.replace(/<div class="r/g, (m, off) => m), 600, 0);
console.log("renderer memory after open:", mem());
// renderer only: apply a color change to element qjsl-id? the page marks ids; use plain open with markers instead
let marked = ""; for (let i = 0; i < 1000; i++) marked += `<div class="qjsl-${2 * i} r c${i % 5}" style="height:${10 + (i % 7)}px"><span class="qjsl-${2 * i + 1}">row ${i}</span></div>`;
module.satoru_live_open(inst, `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}</style></head><body style="margin:0">${marked}</body></html>`, 600, 0);
console.log("after open (marked):", mem(), "external", (process.memoryUsage().external / 1048576).toFixed(0), "MB");
for (let round = 0; round < 5; round++) {
  for (let k = 0; k < 20; k++) module.satoru_live_apply(inst, `${(k * 14) % 2000}\u0001style\u00010\u0001color:#${100 + k}`, 600), module.satoru_live_sync(inst, true);
  console.log(`+20 applies (renderer only): renderer memory ${mem()}, external ${(process.memoryUsage().external / 1048576).toFixed(0)} MB`);
}
const ext = () => (process.memoryUsage().external / 1048576).toFixed(0) + " MB";
console.log("--- sync only, 60x (no apply)");
let e0 = ext(); for (let k = 0; k < 60; k++) module.satoru_live_sync(inst, false); console.log(e0, "->", ext());
console.log("--- apply only, 60x (no sync)");
e0 = ext(); for (let k = 0; k < 60; k++) module.satoru_live_apply(inst, `${(k * 14) % 2000}\u0001style\u00010\u0001color:#${200 + k}`, 600); console.log(e0, "->", ext());
console.log("--- layout_json (rebuild path) 20x");
e0 = ext(); for (let k = 0; k < 20; k++) module.satoru_layout_json(inst, `<!doctype html><body><p>${k}</p>` + marked, 600, 0, 0, false); console.log(e0, "->", ext());
