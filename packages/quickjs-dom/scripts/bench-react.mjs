// React rendering on jsdom and on wasm-quickjs-dom/jsdom: start-up, mount, update, and a click through @testing-library/dom.
// react, react-dom, @testing-library/dom, jsdom are devDependencies. Needs the package built (dist/).
// Usage (from `packages/quickjs-dom/`): node scripts/bench-react.mjs [items=3000] [reps=7]
import { JSDOM as RealJSDOM, VirtualConsole } from "jsdom";
import { fireEvent } from "@testing-library/dom";
import { JSDOM as WasmJSDOM } from "../dist/jsdom.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const items = Number(process.argv[2] ?? 3000);
const reps = Number(process.argv[3] ?? 7);
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const h = React.createElement;
const List = ({ n, tick, onClick }) =>
  h(
    "ul",
    { className: "list" },
    Array.from({ length: n }, (_, i) =>
      h("li", { key: i, className: i % 2 ? "odd" : "even", "data-i": i }, h("span", null, `item ${i} ${tick}`), h("button", { onClick, type: "button" }, "go")),
    ),
  );

async function run(name, JSDOM) {
  const startup = [];
  for (let i = 0; i < reps; i++) {
    const s = performance.now();
    const d = new JSDOM("<!doctype html><body><div id=root></div>", { virtualConsole: new VirtualConsole() });
    startup.push(performance.now() - s);
    if (i < reps - 1) d.window.close();
    else var dom = d;
  }
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const root = createRoot(window.document.getElementById("root"));
  const mount = [], update = [], small = [], click = [];
  let clicks = 0;
  const onClick = () => clicks++;
  for (let r = 0; r < Math.max(3, reps >> 1); r++) {
    let s = performance.now();
    flushSync(() => root.render(h(List, { n: items, tick: r, onClick })));
    mount.push(performance.now() - s);
    s = performance.now();
    flushSync(() => root.render(h(List, { n: items, tick: r + 100, onClick })));
    update.push(performance.now() - s);
    s = performance.now();
    flushSync(() => root.render(h(List, { n: 200, tick: r, onClick })));
    small.push(performance.now() - s);
    const b = window.document.querySelector("button");
    s = performance.now();
    for (let k = 0; k < 50; k++) fireEvent.click(b);
    click.push((performance.now() - s) / 50);
    flushSync(() => root.render(null));
  }
  root.unmount();
  window.close?.();
  return { name, startup: median(startup), mount: median(mount), update: median(update), small200: median(small), clickMs: median(click), clicks };
}

const rows = [await run("jsdom", RealJSDOM), await run("wasm", WasmJSDOM)];
console.log(`${items} items; median ms`);
console.log("env | startup | mount | update | render 200 | fireEvent.click");
for (const r of rows) console.log(`${r.name} | ${r.startup.toFixed(1)} | ${r.mount.toFixed(0)} | ${r.update.toFixed(0)} | ${r.small200.toFixed(1)} | ${(r.clickMs * 1000).toFixed(0)} µs`);
console.log(`wasm / jsdom: mount ${(rows[1].mount / rows[0].mount).toFixed(2)}x, update ${(rows[1].update / rows[0].update).toFixed(2)}x, render200 ${(rows[1].small200 / rows[0].small200).toFixed(2)}x, click ${(rows[1].clickMs / rows[0].clickMs).toFixed(1)}x`);
process.exit(0);
