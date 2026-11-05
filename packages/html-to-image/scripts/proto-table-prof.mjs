import { loadHtmlToImageModule } from "../dist/loader.js";
const m = await loadHtmlToImageModule(); const inst = m.satoru_create_instance();
const n = 1000; let b = ""; for (let i = 0; i < n; i++) b += `<tr class="r"><td>row ${i}</td><td>cell <b>${i}</b></td></tr>`;
m.satoru_layout_json(inst, `<!doctype html><html><head><style>td{padding:2px}</style></head><body style="margin:0"><table id="t">${b}</table></body></html>`, 600, 0, 0, false);
