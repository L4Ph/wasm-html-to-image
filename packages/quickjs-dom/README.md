# wasm-quickjs-dom

A small JSDOM for runtimes that have no Node and no `eval`: the page's scripts run in **QuickJS compiled to WebAssembly**, on a **linkedom** DOM. It works on Cloudflare Workers, Vercel / Next.js Edge, Deno, Bun, Node.js and in browsers. It is the engine behind the `javascript` option of [wasm-html-to-image](https://www.npmjs.com/package/wasm-html-to-image), and has no dependency on it.

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
- The page's clock runs only while `eval()` / `settle()` waits. `timeout` (default 10 s) counts per call.
- Scripts are run in document order, including the ones scripts add, `type="module"` scripts (their literal `import`s are fetched up front) and `fetch` / `XMLHttpRequest` (binary safe), `history.pushState`, storage, `MutationObserver`, `customElements` and the like. React / Next.js clients hydrate and run their effects.
- Limits: no layout (`getBoundingClientRect` returns 0), no canvas, a smaller DOM than jsdom's, and QuickJS is an interpreter, so heavy pages are slower.
- **Use trusted pages only**: the page's scripts can `fetch`.

The QuickJS wasm is chosen by the runtime (the `#quickjs-wasm` entry of `imports` in `package.json`): a pre-compiled module on Workers and Vercel / Next.js Edge, read from disk on Node.js and Bun, fetched on Deno and in browsers. Pass `{ quickjsWasm }` to `createDOM` to use a module of your own; `wasm-quickjs-dom/quickjs.wasm` is the file.

`dom.toOptions(options)` fills `value` (the serialized DOM) and `baseUrl` of an options object, so the page can be handed to a renderer such as `render()` of wasm-html-to-image.

## License

MIT
