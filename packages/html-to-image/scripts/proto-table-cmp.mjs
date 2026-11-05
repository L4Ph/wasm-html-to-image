import { loadHtmlToImageModule } from "../dist/loader.js";
import fs from "node:fs";
const m = await loadHtmlToImageModule();
const pages = [
 `<table border=1 style="width:100%"><tr><td colspan=2>a long header cell with text</td><td>c</td></tr><tr><td style="width:30%">x</td><td>yyyyyyyy yyyyyy</td><td rowspan=2>z</td></tr><tr><td>1</td><td>2</td></tr></table>`,
 `<style>table{border-collapse:collapse;width:300px}td,th{border:1px solid #000;padding:4px}th{background:#ddd;text-align:left}</style><table><thead><tr><th>A<th>B<th>C</thead><tbody><tr><td>1<td>22222222222 22222222<td>3<tr><td colspan=3>wide</tbody><tfoot><tr><td>f<td>f<td>f</tfoot></table>`,
 `<table style="table-layout:fixed;width:400px"><col style="width:100px"><col><tr><td>one<td>two two two two two two</table><div style="display:table;width:50%"><div style="display:table-row"><div style="display:table-cell;padding:5px">cell</div><div style="display:table-cell">cell2 more text here</div></div></div>`,
 `<table><tr><td><table border=1><tr><td>in<td>ner</table><td>outer text that is long enough to wrap around maybe maybe</table><p>after</p><table><caption>cap</caption><tr><td style="font-size:30px">big<td style="font-size:8px">small</table>`,
 `<style>td{width:10em;vertical-align:middle;line-height:2}</style><table cellspacing=10 cellpadding=3 width=500><tr><td height=80>a<td>b<tr><td>c<td align=right>d</table>`,
];
const inst = m.satoru_create_instance();
const out = pages.map((p, i) => m.satoru_layout_style_json(inst, `<!doctype html><html><body>${p}</body></html><!--${i}-->`, 700, 0, 0, true));
fs.writeFileSync(process.argv[2], JSON.stringify(out));
