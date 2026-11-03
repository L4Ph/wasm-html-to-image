// What the bridge costs when the host's code walks the DOM a lot: @testing-library/dom's queries on a generated page, run
// on jsdom and on wasm-quickjs-dom/jsdom. jsdom, @testing-library/dom are devDependencies. Needs the package built (dist/).
// Usage (from `packages/quickjs-dom/`): node scripts/bench-bridge.mjs [rows]
import { JSDOM as RealJSDOM, VirtualConsole } from "jsdom";
import * as tl from "@testing-library/dom";
import { JSDOM } from "../dist/jsdom.js";

const rows = Number(process.argv[2] ?? 300);
const html =
  "<!doctype html><body><main>" +
  Array.from(
    { length: rows },
    (_, i) =>
      `<section class="card"><h3>Item ${i}</h3><p>Some text for item ${i}</p><label for="f${i}">Field ${i}</label><input id="f${i}" /><button type="button">Buy ${i}</button><a href="/i/${i}">link ${i}</a></section>`,
  ).join("") +
  "</main></body>";

const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
// every run starts with the bridge's reads forgotten, as after a change of the page (the first run of a test)
const time = (f, reps, touch) => {
  const t = [];
  for (let i = 0; i < reps; i++) {
    touch(i);
    const s = performance.now();
    f();
    t.push(performance.now() - s);
  }
  return median(t);
};

const cases = (doc) => ({
  "getByText (1 of N)": () => tl.getByText(doc.body, `Some text for item ${rows >> 1}`),
  "getAllByRole('button')": () => tl.getAllByRole(doc.body, "button"),
  "getByRole('button', {name})": () => tl.getByRole(doc.body, "button", { name: `Buy ${rows >> 1}` }),
  "getByLabelText": () => tl.getByLabelText(doc.body, `Field ${rows >> 1}`),
  "getAllByRole('link')": () => tl.getAllByRole(doc.body, "link"),
  "getAllByTestId (none, scan)": () => tl.queryAllByTestId(doc.body, "nothing"),
});

const real = new RealJSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
const ours = new JSDOM(html, { virtualConsole: null });
const mine = ours.window.document;
const bridge = ours.page.dom.bridge();

console.log(`${rows} cards, ${rows * 6 + 2} elements; median ms per query`);
console.log("query | jsdom | bridge | bridge / jsdom");
const a = cases(real);
const b = cases(mine);
for (const name of Object.keys(a)) {
  a[name]();
  b[name]();
  const reps = 5;
  const x = time(a[name], reps, () => {});
  const y = time(b[name], reps, () => bridge.invalidate());
  console.log(`${name} | ${x.toFixed(1)} | ${y.toFixed(1)} | ${(y / x).toFixed(2)}x`);
}
ours.close();
