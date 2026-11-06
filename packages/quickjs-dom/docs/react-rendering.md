# Rendering React with wasm-quickjs-dom

There are three ways to render a React tree with this package, and they differ by an order of
magnitude. Which one is right depends on where the React code runs.

| Approach | Where React runs | 300-row tree (measured) | Use it for |
| :--- | :--- | ---: | :--- |
| Host-driven `react-dom` | Node, DOM in the page | ≈ 90 ms | Tests (Testing Library), incremental updates, event simulation |
| Host-driven + `transact()` | Node, DOM in the page | ≈ 80–95 ms, level with the plain commit | Host-driven commits that interleave reads and writes |
| In-page `renderToString` | Inside the page | ≈ 20 ms render, ≈ 22 ms render + parse + serialize | Prerendering / SSR-shaped output: HTML is the product |

Measurements: React 19.3.1, a 300-row tree (1,201 elements + ~600 text nodes: a labelled
span, an `<input defaultValue>`, and a button per row), this machine's medians. The host-driven
numbers use the development `react-dom` build, the in-page numbers the production
`react-dom/server` build. jsdom renders the same tree host-side in ≈ 35–70 ms.

## Why host-driven rendering costs what it costs

Every DOM operation the host performs crosses the bridge once: a property write, a method
call, a read that is not cached. React's commit phase performs thousands of them, and its
individual operations are already near the bridge's floor (≈ 2 µs for a simple write, more for
node creation, whose answer must be wrapped and registered host-side). Steps taken in the
bridge itself — cheaper creation and style paths, dropping repeated writes whose value is
already in the page, and `transact()` — narrow the gap but cannot remove the per-operation
floor. A tree built entirely inside the page pays none of it: the same 3,000-node build that
takes 46–58 ms driven from the host takes ≈ 5 ms in page code.

## Prerendering: run React inside the page

When the deliverable is HTML — an OGP image, a prerendered page, a screenshot — render inside
the page and take the HTML out:

1. Bundle the app with `react-dom/server` for the browser (any bundler; esbuild below).
2. `createDOM` a page, `dom.eval` the bundle once, then call the exported render function per
   request and assign the result with `innerHTML`, or use the returned string directly.
3. `dom.serialize()` (or the string itself) is the output.

```js
// entry.js — bundled and evaluated in the page
const React = require("react");
const { renderToString } = require("react-dom/server");

function App({ rows }) {
  const children = [];
  for (let i = 0; i < rows; i++) {
    children.push(
      React.createElement("div", { className: "row", key: i },
        React.createElement("span", null, "Row " + i),
        React.createElement("input", { defaultValue: "value " + i }),
        React.createElement("button", null, "Save " + i)));
  }
  return React.createElement("div", { className: "app" }, children);
}
globalThis.__renderApp = (rows) => renderToString(React.createElement(App, { rows }));
```

```sh
esbuild entry.js --bundle --format=iife \
  --define:process.env.NODE_ENV='"production"' --outfile=bundle.js
```

```ts
import { readFileSync } from "node:fs";
import { createDOM } from "wasm-quickjs-dom";

const bundle = readFileSync("bundle.js", "utf8");
const dom = await createDOM(
  { html: "<!doctype html><body><div id='root'></div></body>", baseUrl: "https://example.com/" },
);
try {
  await dom.eval(bundle); // one-time per page: ≈ 140–210 ms for react + react-dom/server (~590 KB)
  const html = await dom.eval<string>("__renderApp(300)"); // ≈ 20 ms
  // Either use the string as the prerendered output, or parse it into the page
  // (for layout with wasm-html-to-image, screenshots, further page scripts):
  await dom.eval("document.getElementById('root').innerHTML = __renderApp(300)");
  const page = dom.serialize();
} finally {
  dom.close();
}
```

Notes:

- The bundle evaluation is the one real fixed cost. Reuse the page across renders when the
  app allows it, or accept it per render — at 300 rows the whole in-page path, bundle included,
  is still comparable to one host-driven render, and every render after the first is ~4× faster.
- `renderToString` output parses and serializes back identically, except that void elements
  lose their XML-style trailing slash (`<input/>` → `<input>`), as in any HTML serializer.
- Hydration is a page-side concern: ship the client bundle to the browser as usual. If the
  page itself must become interactive inside wasm-quickjs-dom (to run its scripts), load the
  client bundle as a page script instead and let it hydrate the prerendered markup — the DOM
  work still happens entirely in the page.

## Host-driven rendering: use `transact()` for commits

When React must run on the host — Testing Library suites, user-event, incremental updates
against a live tree — keep `react-dom` as it is, and wrap each synchronous commit in
`transact()` so the mutations queue into one page call instead of crossing one by one, and so
reads interleaved with the writes are answered from the queue where possible:

```ts
dom.transact(() => {
  act(() => {
    root.render(React.createElement(App, { rows: 300 }));
  });
});
```

Wrap the whole synchronous `act(...)` call, not just `root.render(...)`: React schedules the
commit inside `act`, so a wrapper that returns before `act` flushes contains nothing. See the
README's "Transactions" section for the exact semantics.

What to expect: `transact()` buys no speed over the plain commit — about the same time, from 300
rows (≈ 80 ms either way) to 3,000 items (≈ 380 ms mount either way) — and its value is the
semantics above (one page call per commit, reads answered from the queue). It gets there because
a commit is applied in as few page calls as it can be: node creation, tree and attribute calls,
state-only property writes and `on…` handler assignments are queued, and the queue is applied
only when something needs the page's answer. Whatever cannot be queued (a method that returns a
page value, a property read the queue cannot answer) applies the queue first, so a commit that
interleaves many such reads pays for each of them with a page call — measure before assuming a
win. Updates of an existing tree read child nodes (`firstChild`, `lastChild`) of nodes the
host has not seen change, and each such read is a page call in either mode.
