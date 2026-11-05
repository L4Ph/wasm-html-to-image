// Cost of one change plus one layout read with enableLiveLayout, on Node. Median of several changes per scenario.
// Needs the packages built (`pnpm build`). Usage (from `packages/html-to-image/`): node scripts/bench-live-layout.mjs [--quick] [--json]
//
// Scenarios: a page of `div.r > span` rows (2 elements per row) and a table of rows (3 elements per row).
//   color   a paint-only change: the engine keeps its layout
//   height  a change that moves every box behind it
//   append  one element added at the end of <body>
//   text    the text of one element
// Reference numbers (6,000 elements, Node 24): color 13 ms, height 170 ms, append 90 ms (see doc/design/live-layout-incremental.md).
import { createDOM, enableLiveLayout } from "../dist/edge-js.js";
import { loadHtmlToImageModule } from "../dist/loader.js";

const quick = process.argv.includes("--quick");
const asJson = process.argv.includes("--json");
const module = await loadHtmlToImageModule();

const divRows = (n) => {
  let b = "";
  for (let i = 0; i < n; i++) b += `<div class="r c${i % 5}" style="height:${10 + (i % 7)}px;padding:2px"><span>row ${i}</span></div>`;
  return `<!doctype html><html><head><style>.r{margin:1px}.c1{color:#036}.c2 span{font-weight:bold}</style></head><body style="margin:0">${b}</body></html>`;
};
const tableRows = (n) => {
  let b = "";
  for (let i = 0; i < n; i++) b += `<tr class="r"><td>row ${i}</td><td>cell <b>${i}</b></td></tr>`;
  return `<!doctype html><html><head><style>td{padding:2px}.c{color:red}</style></head><body style="margin:0"><table id="t">${b}</table></body></html>`;
};

const scenarios = {
  div: {
    html: divRows,
    elements: (n) => n * 2,
    pick: "document.body.children",
    changes: {
      color: "els[(i * 7) % N].style.color = '#' + (100 + i)",
      height: "els[(i * 7) % N].style.height = (10 + i) + 'px'",
      append: "{ const d = document.createElement('div'); d.className = 'r'; d.textContent = 'new ' + i; document.body.appendChild(d) }",
      text: "els[(i * 7) % N].firstElementChild.textContent = 'changed ' + i",
    },
    last: "els[els.length - 1]",
  },
  table: {
    html: tableRows,
    elements: (n) => n * 3,
    pick: "document.querySelectorAll('tr')",
    changes: {
      color: "els[(i * 7) % N].classList.toggle('c')",
      text: "els[(i * 7) % N].cells[0].textContent = 'changed text ' + i",
      append: "{ const r = document.createElement('tr'); r.innerHTML = '<td>n</td><td>m</td>'; document.getElementById('t').appendChild(r) }",
    },
    last: "els[els.length - 1]",
  },
};

const sizes = quick ? { div: [1000], table: [300] } : { div: [1000, 3000], table: [300, 1000] };
const results = [];
for (const [kind, sc] of Object.entries(scenarios)) {
  for (const n of sizes[kind]) {
    const dom = await createDOM({ html: sc.html(n) }, { settleMs: 0, width: 600 });
    const t0 = performance.now();
    const layout = await enableLiveLayout(dom, module, { width: 600 });
    await dom.eval(`globalThis.els = ${sc.pick}; ${sc.last}.getBoundingClientRect().y`);
    const open = performance.now() - t0;
    for (const [name, code] of Object.entries(sc.changes)) {
      const R = 9;
      // each change is timed on its own inside the page; QuickJS's clock ticks in whole milliseconds, so time batches from here
      const samples = [];
      for (let k = 0; k < R; k++) {
        const t = performance.now();
        await dom.eval(`(() => { const N = ${n}, i = ${k + 1}; ${code}; return ${sc.last}.getBoundingClientRect().y })()`);
        samples.push(performance.now() - t);
      }
      samples.sort((a, b) => a - b);
      results.push({ kind, elements: sc.elements(n), change: name, ms: +samples[R >> 1].toFixed(1), openMs: +open.toFixed(0) });
    }
    layout.dispose();
    dom.close();
  }
}
if (asJson) console.log(JSON.stringify(results, null, 1));
else {
  console.log("page    | elements | change | ms per change+read | (open + first read)");
  for (const r of results) console.log(`${r.kind.padEnd(7)} | ${String(r.elements).padStart(8)} | ${r.change.padEnd(6)} | ${String(r.ms).padStart(18)} | ${r.openMs} ms`);
}
