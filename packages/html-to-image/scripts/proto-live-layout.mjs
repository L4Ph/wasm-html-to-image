// Prototype: getBoundingClientRect answered synchronously by litehtml (the renderer wasm) while the page runs.
//   node scripts/proto-live-layout.mjs
import { createDOM } from "wasm-quickjs-dom";
import { loadHtmlToImageModule } from "../dist/loader.js";

const module = await loadHtmlToImageModule();
const inst = module.satoru_create_instance();
const WIDTH = 400;

let calls = 0;
let spent = 0;
// html (marked with qjsl-<n> classes) -> { "<n>": [x, y, w, h] }, as measureLayout() builds it, but synchronous
const provider = (html) => {
  const t = performance.now();
  const list = JSON.parse(module.satoru_layout_style_json(inst, html, WIDTH, 0, 0, true));
  const boxes = {};
  for (const b of list) {
    const m = /(?:^|\s)qjsl-(\d+)(?:\s|$)/.exec(b.c);
    if (m) boxes[m[1]] = [b.x, b.y, b.w, b.h, b.s];
  }
  calls++;
  spent += performance.now() - t;
  return JSON.stringify(boxes);
};

const html = `<!doctype html><html><head><style>
body{margin:0} #a{width:200px;height:50px;padding:10px;border:2px solid #000}
.c{display:flex} .c>div{width:100px;height:30px}
</style></head><body><div id="a">A</div><div class="c"><div id="b1"></div><div id="b2"></div></div><p id="t">hello</p></body></html>`;

const dom = await createDOM({ html }, { settleMs: 0 });
try {
  const bridge = dom.bridge();
  bridge.window.__layoutProvider = provider;
  await dom.eval("__edgeEnableLiveLayout()");

  const q = (code) => dom.eval(code);
  const r = async (id) => JSON.stringify(await q(`(()=>{const r=document.getElementById("${id}").getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`));
  console.log("a  ", await r("a"), "expect [0,0,224,74]");
  console.log("b2 ", await r("b2"), "expect x=100");
  const c1 = calls;
  await q(`document.getElementById("a").style.height="100px"`);
  console.log("a after height=100px", await r("a"), "expect h=124");
  console.log("b1 y after", await r("b1"), "expect y=124");
  await q(`document.getElementById("a").style.height="100px"`); // same value: still re-measure is fine
  await r("a");
  await r("b1");
  await r("b2"); // three reads with no change in between -> no re-measure
  console.log("layout calls:", calls, "avg ms:", (spent / calls).toFixed(2), "(reads without change reuse the cache; first call count", c1, ")");

  // computed style from the renderer
  const cs = async (id, props) => JSON.stringify(await q(`(()=>{const s=getComputedStyle(document.getElementById("${id}"));return [${props.map((p) => `s.${p}`).join(",")}]})()`));
  console.log("a  cs", await cs("a", ["display", "paddingLeft", "borderLeftWidth", "color", "fontSize"]));
  await q(`document.getElementById("b1").style.cssText="float:left;color:#336699;font-size:2em;margin:3px 5px"`);
  console.log("b1 cs", await cs("b1", ["display", "float", "color", "fontSize", "marginTop", "marginLeft"]), "expect block,left,rgb(51, 102, 153),32px,3px,5px");

  // layout thrash: write, read, write, read ... 200 times
  const t = performance.now();
  const before = calls;
  await q(`for (let i=0;i<200;i++){const e=document.getElementById("a");e.style.height=(50+i)+"px";e.getBoundingClientRect().height}`);
  console.log("thrash: 200 write+read ->", calls - before, "layouts in", (performance.now() - t).toFixed(0), "ms");
} finally {
  dom.close();
  module.satoru_destroy_instance(inst);
}
