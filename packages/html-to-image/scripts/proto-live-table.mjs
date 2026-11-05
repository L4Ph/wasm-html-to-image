import { createDOM, enableLiveLayout } from "../dist/edge-js.js";
import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
for (const n of [500, 1500]) {
  let b = ""; for (let i = 0; i < n; i++) b += `<tr class="r"><td>row ${i}</td><td>cell <b>${i}</b></td></tr>`;
  const dom = await createDOM({ html: `<!doctype html><html><head><style>td{padding:2px}.c{color:red}</style></head><body style="margin:0"><table id="t">${b}</table></body></html>` }, { settleMs: 0 });
  const L = await enableLiveLayout(dom, module, { width: 600 });
  await dom.eval("globalThis.rows=document.querySelectorAll('tr'); rows[0].getBoundingClientRect().y");
  for (const [name, code] of [["color", "rows[i*7%N].classList.toggle('c')"], ["text", "rows[i*7%N].cells[0].textContent='changed text '+i"], ["append", "{const r=document.createElement('tr');r.innerHTML='<td>n</td><td>m</td>';document.getElementById('t').appendChild(r)}"]]) {
    const R = 5; const t = performance.now();
    await dom.eval(`(()=>{const N=${n};for(let i=0;i<${R};i++){${code};rows[N-1].getBoundingClientRect().y}})()`);
    console.log(`n=${n} ${name}: ${((performance.now() - t) / R).toFixed(1)}ms`);
  }
  L.dispose(); dom.close();
}
