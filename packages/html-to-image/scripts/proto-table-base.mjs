import { loadHtmlToImageModule } from "../dist/loader.js";
const m = await loadHtmlToImageModule(); const inst = m.satoru_create_instance();
for (const n of [250, 500, 1000, 1500]) {
  let b = ""; for (let i = 0; i < n; i++) b += `<tr class="r"><td>row ${i}</td><td>cell <b>${i}</b></td></tr>`;
  const html = `<!doctype html><html><head><style>td{padding:2px}</style></head><body style="margin:0"><table id="t">${b}</table></body></html>`;
  const t = performance.now(); m.satoru_layout_json(inst, html + `<!--${n}-->`, 600, 0, 0, false);
  console.log(n, "rows full layout", (performance.now() - t).toFixed(0), "ms");
}
