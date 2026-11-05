import { createDOM, enableLiveLayout } from "../dist/edge-js.js";
import { loadHtmlToImageModule } from "../dist/loader.js";
const module = await loadHtmlToImageModule();
const n = 3000; let b = ""; for (let i = 0; i < n; i++) b += `<div class="r" style="height:${10 + (i % 7)}px"><span>row ${i}</span></div>`;
for (const [label, sheet] of [["plain", ".r{margin:1px}"], ["nth-child", ".r{margin:1px}.r:nth-child(odd){background:#eee}"]]) {
  const dom = await createDOM({ html: `<!doctype html><html><head><style>${sheet}</style></head><body style="margin:0">${b}</body></html>` }, { settleMs: 0 });
  const L = await enableLiveLayout(dom, module, { width: 600 });
  await dom.eval("globalThis.els=document.body.children; els[0].getBoundingClientRect().y");
  for (const [name, code] of [["append", "{const d=document.createElement('div');d.className='r';d.textContent='n'+i;document.body.appendChild(d)}"], ["height", "els[i*7%N].style.height=(10+i)+'px'"]]) {
    const R = 5; const t = performance.now();
    await dom.eval(`(()=>{const N=${n};for(let i=0;i<${R};i++){${code};els[N-1].getBoundingClientRect().y}})()`);
    console.log(`${label} ${name}: ${((performance.now() - t) / R).toFixed(1)}ms`);
  }
  L.dispose(); dom.close();
}
