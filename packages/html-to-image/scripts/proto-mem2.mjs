import { loadHtmlToImageModule } from "../dist/loader.js";
const ext = () => process.memoryUsage().external / 1048576;
const module = await loadHtmlToImageModule();
const base = ext();
const build = (n, kind) => {
  let b = "";
  for (let i = 0; i < n; i++) {
    if (kind === "div") b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"></div>`;
    else if (kind === "span") b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"><span>row ${i}</span></div>`;
    else b += `<p>${"word ".repeat(12)}${i}</p>`;
  }
  return `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}</style></head><body style="margin:0">${b}</body></html>`;
};
for (const [kind, n] of [["div", 3000], ["span", 1500], ["span", 3000], ["text", 1000]]) {
  const inst = module.satoru_create_instance();
  const before = ext();
  module.satoru_layout_json(inst, build(n, kind), 600, 0, 0, false);
  const after = ext();
  const elems = kind === "div" ? n : kind === "span" ? 2 * n : n;
  console.log(`${kind.padEnd(5)} n=${n} (${elems} elements): +${(after - before).toFixed(0)} MB  = ${(((after - before) * 1024) / elems).toFixed(1)} KB/element   (total external ${after.toFixed(0)} MB)`);
  module.satoru_destroy_instance(inst);
}
