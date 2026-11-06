// React running INSIDE the page: client rendering with createRoot, a state update, and
// hydration of server-rendered markup — measured, with the interactive behaviour checked.
// The companion to the prerendering recipe in docs/react-rendering.md.
//
// The guest bundle is built with esbuild (react + react-dom are devDependencies; esbuild is
// located in the workspace store, or pass --esbuild <path to the esbuild binary>). Needs the
// package built (dist/).
// Usage (from `packages/quickjs-dom/`): node scripts/guest-react-example.mjs [rows=300]
import { execFileSync } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDOM } from "../dist/index.js";

const rows = Number(process.argv[2] ?? 300);
const argEsbuild = process.argv.find((a) => a.startsWith("--esbuild="))?.slice("--esbuild=".length);
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

const ENTRY = `
const React = require("react");
const { renderToString } = require("react-dom/server");
const { createRoot, hydrateRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");

function App({ rows, tick }) {
  const [clicks, setClicks] = React.useState(0);
  const children = [];
  for (let i = 0; i < rows; i++) {
    children.push(
      React.createElement("div", { className: "row", key: i },
        React.createElement("span", null, "Row " + i + " t" + (tick || 0)),
        React.createElement("input", { defaultValue: "value " + i }),
        React.createElement("button", { onClick: () => setClicks((c) => c + 1) }, "Save " + i)));
  }
  return React.createElement("div", { className: "app" },
    React.createElement("p", { id: "counter" }, "clicks:" + clicks),
    children);
}

let root = null;
globalThis.__ssr = (rows) => renderToString(React.createElement(App, { rows }));
globalThis.__clientRender = (rows) => {
  const t = performance.now();
  root = createRoot(document.getElementById("root"));
  flushSync(() => root.render(React.createElement(App, { rows })));
  return performance.now() - t;
};
globalThis.__update = (rows, tick) => {
  const t = performance.now();
  flushSync(() => root.render(React.createElement(App, { rows, tick })));
  return performance.now() - t;
};
globalThis.__hydrate = (rows) => {
  const el = document.getElementById("root");
  el.innerHTML = renderToString(React.createElement(App, { rows }));
  const t = performance.now();
  root = hydrateRoot(el, React.createElement(App, { rows }));
  flushSync(() => {});
  return performance.now() - t;
};
globalThis.__clickSync = () => {
  flushSync(() => { document.querySelector("#root button").click(); });
  return document.getElementById("counter").textContent;
};
globalThis.__html = () => document.getElementById("root").innerHTML;
`;

function findEsbuild() {
  if (argEsbuild) return argEsbuild;
  const store = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", ".pnpm");
  const hits = globSync("esbuild@*/node_modules/esbuild/bin/esbuild", { cwd: store });
  if (hits.length) return join(store, hits[0]);
  throw new Error("esbuild not found in the workspace store; pass --esbuild=<path to the esbuild binary>");
}

// inside the package, so esbuild resolves react/react-dom from its node_modules
const dir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".guest-react-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, "entry.js"), ENTRY);
execFileSync(findEsbuild(), [join(dir, "entry.js"), "--bundle", "--format=iife",
  "--define:process.env.NODE_ENV=\"production\"", "--outfile=" + join(dir, "bundle.js")], { stdio: "inherit" });
const bundle = readFileSync(join(dir, "bundle.js"), "utf8");
console.log(`guest bundle: ${(bundle.length / 1024).toFixed(0)} KiB (react + react-dom client+server, production)`);

const evals = [];
let dom;
for (let i = 0; i < 3; i++) {
  const d = await createDOM({ html: "<!doctype html><body><div id='root'></div></body>", baseUrl: "https://example.com/" }, { settleMs: 0 });
  const t = performance.now();
  await d.eval(bundle);
  evals.push(performance.now() - t);
  if (i < 2) d.close(); else dom = d;
}
console.log(`bundle eval: median ${median(evals).toFixed(0)} ms (one-time per page)`);
const reset = () => dom.eval("document.body.innerHTML = '<div id=\"root\"></div>'");

const renders = [], updates = [];
for (let i = 0; i < 5; i++) {
  await reset();
  renders.push(await dom.eval(`__clientRender(${rows})`));
  updates.push(await dom.eval(`__update(${rows}, ${i + 1})`));
}
console.log(`client render (${rows} rows): median ${median(renders).toFixed(0)} ms`);
console.log(`client update (every row's text changes): median ${median(updates).toFixed(0)} ms`);

await reset();
await dom.eval(`__clientRender(${rows})`);
const clientHtml = await dom.eval("__html()");
const ssrHtml = await dom.eval(`__ssr(${rows})`);
const norm = (s) => s.replace(/<input([^>]*?)\/>/g, "<input$1>");
console.log("client-rendered HTML == renderToString HTML (modulo void-element slash):", norm(clientHtml) === norm(ssrHtml));
console.log("clicks after client render (flushSync dispatch):", await dom.eval("__clickSync()"), "->", await dom.eval("__clickSync()"));

const hyd = [];
for (let i = 0; i < 5; i++) { await reset(); hyd.push(await dom.eval(`__hydrate(${rows})`)); }
console.log(`hydrateRoot (${rows} rows): median ${median(hyd).toFixed(0)} ms to schedule (hydration is incremental; interactions force it)`);
console.log("clicks after hydration (flushSync dispatch):", await dom.eval("__clickSync()"), "->", await dom.eval("__clickSync()"));
console.log("rows after hydration:", await dom.eval("document.querySelectorAll('.row').length"));
dom.close();
