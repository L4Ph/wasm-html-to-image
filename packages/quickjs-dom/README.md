# wasm-quickjs-dom

A small JSDOM for runtimes that have no Node and no `eval`: the page's scripts run in **QuickJS-ng compiled to WebAssembly**, on a **linkedom** DOM. It works on Cloudflare Workers, Vercel / Next.js Edge, Deno, Bun, Node.js and in browsers. It is the engine behind the `javascript` option of [wasm-html-to-image](https://www.npmjs.com/package/wasm-html-to-image), and has no dependency on it.

```ts
import { createDOM } from "wasm-quickjs-dom";

const dom = await createDOM({ url: "https://example.com/" }); // or { html, baseUrl }
try {
  console.log(await dom.eval("document.title"));              // JSON values; promises are awaited
  await dom.eval("document.querySelector('h1').textContent = 'Hello'");
  await dom.settle(200);                                       // let timers / fetches of the page run
  console.log(dom.serialize());                                // the HTML as it is now
} finally {
  dom.close();                                                 // frees the QuickJS runtime
}
```

- The DOM lives inside QuickJS, so you reach it through `eval()` and JSON values rather than a live `window`. A DOM node cannot be returned: return what you read from it.
- `eval` also takes a function and JSON arguments (`dom.eval((sel) => document.querySelectorAll(sel).length, "a")`); `click`, `type` and `waitForSelector` drive the page; `expose(name, fn)` lets the page call a function of yours as a promise.
- The page's clock runs only while `eval()` / `settle()` waits. `timeout` (default 10 s) counts per call.
- Scripts are run in document order, including the ones scripts add, `type="module"` scripts (their literal `import`s are fetched up front) and `fetch` / `XMLHttpRequest` (binary safe), `history.pushState`, storage, `MutationObserver`, `customElements` and the like. React / Next.js clients hydrate and run their effects.
- Limits: no layout of its own (`getBoundingClientRect` returns 0 until you call `setLayout()`; `wasm-html-to-image` has `measureLayout()` that fills it from its layout engine), no canvas, a smaller DOM than jsdom's, and QuickJS is an interpreter, so heavy pages are slower.
- **Untrusted pages need `limits`**: the page's scripts can `fetch`, and so can the scripts and modules it loads. `createDOM(source, { limits })` restricts them (`allowedProtocols`, `allowedHosts`, `blockedHosts`, `blockPrivateHosts`, `maxResourceCount`, `maxResourceBytes`, `maxTotalResourceBytes`; every redirect is checked too).
- `dom.logs` (and the `onLog` option) hold what happened in the page: console output, script errors, unhandled promise rejections and requests with their status. They tell you why a page rendered empty.
- `IntersectionObserver` / `ResizeObserver` report once on `observe()` (so lazy content loads), `matchMedia` answers for the viewport width, and `getComputedStyle` returns the element's own style and initial values.

The QuickJS wasm is chosen by the runtime (the `#quickjs-wasm` entry of `imports` in `package.json`): a pre-compiled module on Workers and Vercel / Next.js Edge, read from disk on Node.js and Bun, fetched on Deno and in browsers. Pass `{ quickjsWasm }` to `createDOM` to use a module of your own; `wasm-quickjs-dom/quickjs.wasm` is the file.

`dom.toOptions(options)` fills `value` (the serialized DOM) and `baseUrl` of an options object, so the page can be handed to a renderer such as `render()` of wasm-html-to-image.

## Building

The package builds its own QuickJS: `vendor/quickjs` (QuickJS-ng, unmodified) and `csrc/qjsdom.c` are compiled to a standalone `dist/quickjs.wasm` with Emscripten (`emcc` on `PATH`), and the guest program (linkedom and the browser shims) is compiled to QuickJS bytecode with that very wasm. Reading bytecode takes about a millisecond where compiling the source takes tens, so a page starts in roughly 30 ms. Each page runs in a wasm instance of its own; there is no dependency on `quickjs-emscripten`.

```sh
pnpm --filter wasm-quickjs-dom build
```

## License

MIT. QuickJS-ng, linkedom and web-streams-polyfill are included under their own licenses: see `THIRD-PARTY-NOTICES.md`.
