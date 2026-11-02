# wasm-quickjs-dom

Run a web page's JavaScript **without a browser and without `eval`** — and read the resulting DOM.

It is a small JSDOM for places where JSDOM cannot go: Cloudflare Workers, Vercel / Next.js Edge, Deno, Bun, browsers, and plain Node.js. The page's scripts run in [QuickJS-ng](https://github.com/quickjs-ng/quickjs) compiled to WebAssembly, on a [linkedom](https://github.com/WebReflection/linkedom) DOM, so nothing needs `eval`, native modules or a headless browser.

```ts
import { createDOM } from "wasm-quickjs-dom";

const dom = await createDOM({ url: "https://example.com/" });
console.log(await dom.eval("document.title"));
console.log(dom.serialize()); // the HTML after the page's scripts ran
dom.close();
```

**Good for:** pre-rendering single-page apps to HTML (SEO, OGP, link previews), reading data that a page builds with JavaScript, running DOM code in tests on edge runtimes, and handing a scripted page to an image renderer such as [wasm-html-to-image](https://www.npmjs.com/package/wasm-html-to-image).

**Not a browser:** there is no layout of its own, no canvas, no `WebSocket` or `Worker`, and QuickJS is an interpreter, so very heavy pages are slow. See [What works](#what-works-and-what-does-not).

## Install

```sh
npm install wasm-quickjs-dom
```

ESM only. Node.js 20 or later; the other runtimes below need nothing extra.

## Quick start

### Get the HTML a page has after its scripts ran

```ts
import { createDOM } from "wasm-quickjs-dom";

const dom = await createDOM(
  { url: "https://example.com/" },          // or { html: "<p>…</p>", baseUrl: "https://example.com/" }
  { waitFor: "#app" },                      // wait until this selector matches (default: let timers and requests settle)
);
try {
  const html = dom.serialize();
} finally {
  dom.close();                              // always close: it frees the page
}
```

### Read values out of the page

`eval` runs code in the page and gives you the result as JSON. It takes a string, or a function and JSON arguments:

```ts
const title = await dom.eval("document.title");
const count = await dom.eval((selector: string) => document.querySelectorAll(selector).length, "a.item");
const rows = await dom.eval(() => [...document.querySelectorAll("tr")].map((tr) => tr.textContent));
```

A DOM node cannot cross the boundary: return what you read from it. A function is sent as source text, so it cannot use variables from your own scope.

### Drive the page

```ts
await dom.type("#search", "wasm");           // sets the value, fires input and change
await dom.click("button[type=submit]");      // dispatches a bubbling click
await dom.waitForSelector(".results");       // resolves true, or false if it never appears
dom.expose("saveRow", (row) => db.save(row)); // the page can call: await window.saveRow({...})
```

### Inside a Worker

```ts
import { createDOM } from "wasm-quickjs-dom";

export default {
  async fetch(request: Request) {
    const target = new URL(request.url).searchParams.get("url")!;
    const dom = await createDOM(
      { url: target },
      { limits: { allowedProtocols: ["https:"], blockPrivateHosts: true, maxResourceBytes: 5_000_000 } },
    );
    try {
      return new Response(dom.serialize(), { headers: { "content-type": "text/html; charset=utf-8" } });
    } finally {
      dom.close();
    }
  },
};
```

There is nothing to configure for the WebAssembly: the right way to load it is picked for the runtime. A complete Worker is in the repository: [`packages/cloudflare-prerender`](../cloudflare-prerender).

### From the command line

```sh
npx wasm-quickjs-dom https://example.com/ --wait "#app" > rendered.html
npx wasm-quickjs-dom https://example.com/ -e "document.title"
npx wasm-quickjs-dom page.html --base-url https://example.com/      # a file; "-" reads standard input
```

See [Command line](#command-line) below.

## Pages you do not control

A page's scripts can `fetch`, and so can the scripts and modules it loads. **Without `limits`, a page can reach every host your runtime can reach, internal ones included.** For anything you did not write, set them:

```ts
const dom = await createDOM({ url }, {
  limits: {
    allowedProtocols: ["https:"],
    allowedHosts: ["example.com", "cdn.example.com"], // exact hostnames
    blockPrivateHosts: true,                          // localhost, private, loopback, link-local
    maxResourceCount: 50,
    maxResourceBytes: 5_000_000,
    maxTotalResourceBytes: 20_000_000,
  },
});
```

- The limits cover the page itself (`url`), the page's own `fetch` / `XMLHttpRequest`, and every script and module it loads. With host or protocol limits, each redirect is checked before it is followed.
- `blockPrivateHosts` looks at hostnames and IP literals. It cannot see where a hostname resolves through DNS, so use `allowedHosts` as well when the target is not trusted.
- The scripts run inside the WebAssembly sandbox: they have no file system, no `process`, and reach the outside only through `fetch` (the limits above) and the functions you `expose`.
- Also bounded for you: each call is limited by `timeout`, and memory and stack by fixed caps.

## API

### `createDOM(source, options?)` → `Promise<QuickJSDOM>`

`source` is `{ url }`, or `{ html, baseUrl? }` for markup you already have (`baseUrl` is where relative URLs resolve and what `location` says).

| Option | Default | |
| ------ | ------- | --- |
| `timeout` | `10000` | Upper limit in ms for **each call** into the page (the initial run, each `eval`, `settle`, …). |
| `settleMs` | `1000` | After load, run timers and requests for at most this long. It is an upper bound: the page finishes as soon as nothing is pending. |
| `waitFor` | | A CSS selector to wait for after load instead of `settleMs`. |
| `width` | `800` | `window.innerWidth`; also what `matchMedia` answers for. |
| `limits` | none | What the page may fetch (see above). |
| `skip` | | `(url) => boolean`: return `true` for a URL the page should not get. The request fails without going to the network (a `<script>` gets its `error` event, a `fetch` rejects). Analytics and ads are most of a real site's script time, and a render rarely needs them. The page itself is never skipped. |
| `onLog` | | Called with each log entry as it happens (see `logs`). |
| `quickjsWasm` | | A compiled `WebAssembly.Module` of your own, instead of the packaged one. |

### The page: `QuickJSDOM`

| Member | |
| ------ | --- |
| `baseUrl` | The document's URL (after redirects, when it was fetched). |
| `eval(code)` / `eval(fn, ...args)` | Run code in the page's global scope; get the result as JSON. Promises are awaited. A throw becomes a rejected promise. Calls run one after another. |
| `waitForSelector(selector)` | Wait up to `timeout` for a match; `false` if there is none (or can no longer be). |
| `click(selector)` | Dispatch a bubbling `click` on the first match; `false` if nothing matched. |
| `type(selector, text)` | Set the first match's `value` (or text), then fire `input` and `change`; `false` if nothing matched. |
| `expose(name, fn)` | Make a function of yours callable from the page as `await window[name](...args)`. Arguments and result are JSON; a throw rejects with the same message. |
| `settle(ms?)` | Let timers and requests run for up to `ms` (default `settleMs`). |
| `serialize()` | The document as HTML, as it is now. |
| `logs` | What happened so far (the last 1000): `console` output, script errors, unhandled promise rejections, and requests with their status or failure. The first place to look when a page comes back empty. |
| `close()` | Free the page. It cannot be used afterwards. |
| `toOptions(options)` | Fill `value` (the serialized DOM) and `baseUrl` of an options object — for example the render options of wasm-html-to-image. |
| `markForLayout()` / `setLayout(boxes)` | Give the page a layout (see below). |

**The page's clock runs only while one of these calls is waiting.** Timers and requests progress during `eval`, `settle`, `waitForSelector` and so on, and stand still in between.

Log entries look like `{ type: "console", level, message }`, `{ type: "error", message, source }`, `{ type: "rejection", message }` and `{ type: "request", method, url, status?, error? }`.

### `runPageScriptsQuickJS(source, options?)` → `Promise<{ html, baseUrl }>`

For when you only want the HTML: runs the page with the same options as `createDOM` and closes it for you.

### Layout

There is no layout inside QuickJS, so `getBoundingClientRect()`, `offsetWidth` and the like return 0 — until you give the page boxes with `setLayout({ [elementNumber]: [x, y, width, height] })`. With `wasm-html-to-image` this is one call, `measureLayout(dom, render)`, which lays the page out with its engine and fills the boxes in (inline elements included). Use it for pages whose scripts size things from the real layout.

## What works, and what does not

**Works:** inline, external, dynamically added and `type="module"` scripts (static `import`s and `import("literal")` are fetched up front); `fetch` and `XMLHttpRequest` (binary safe); timers, `requestAnimationFrame`, promises; `history.pushState`, `localStorage` / `sessionStorage` (in memory), `customElements`, `MutationObserver`, `crypto.getRandomValues` / `randomUUID`; `matchMedia` for the viewport width; `getComputedStyle` (the element's own style plus initial values); `IntersectionObserver` and `ResizeObserver` (each reports once on `observe()`, so lazy content loads). React and Next.js clients hydrate and run their effects.

**Does not:** layout (see above), `canvas`, `WebSocket`, `EventSource`, `Worker`, `iframe` content, CSS cascade computation, and anything that needs a real browser engine. A DOM smaller than JSDOM's. If a script throws, the page carries on with what it had; `dom.logs` tells you what went wrong.

**Speed:** a page starts in about 3 ms (the first in a process pays about 120 ms). A typical page, including its network, takes a few hundred ms. HTML is parsed natively and building the DOM from it runs at roughly 1.3 MB/s (a 250 KB page in about 190 ms), so very large pages still take seconds.

## Where it runs

| Runtime | How the WebAssembly is loaded |
| ------- | ----------------------------- |
| Cloudflare Workers | imported as a pre-compiled module (`workerd` condition) |
| Vercel / Next.js Edge | imported with `?module` (`edge-light` condition) |
| Node.js, Bun | read from the package and compiled once |
| Deno, browsers | fetched from beside the module and compiled once |

All of that is automatic. If your setup differs, pass your own module: `createDOM(source, { quickjsWasm })` (`wasm-quickjs-dom/quickjs.wasm` is the file).

## Command line

```sh
wasm-quickjs-dom [options] <url | file | ->
```

Prints the HTML after the page's scripts ran.

| Option | |
| ------ | --- |
| `-o, --output <file>` | Write to a file instead of standard output. |
| `-e, --eval <code>` | Print the value of this code instead (a string as it is, anything else as JSON). |
| `--json` | Print `{ baseUrl, html, logs }` as JSON. |
| `--logs` | Also write the page's log (console, errors, rejections, requests) to standard error. |
| `--wait <selector>`, `--settle <ms>`, `--timeout <ms>`, `--width <px>` | Shape the run (same as the options above). |
| `--base-url <url>` | The page's URL, for a file or standard input. |
| `--protocol <p>`, `--allow-host <h>`, `--block-host <h>`, `--block-private`, `--max-bytes <n>`, `--max-requests <n>` | The limits (repeat `--protocol`, `--allow-host` and `--block-host`). Set them for pages you do not control. |
| `--skip <text>` | Do not fetch URLs containing this text (repeatable). |

Exit code `0` is done, `1` the page could not be loaded (or `-e` threw), `2` wrong usage. `--help` lists everything.

## How it works

Each page gets its own WebAssembly instance of QuickJS-ng. The browser APIs a bare QuickJS lacks, and linkedom, are compiled to QuickJS bytecode when the package is built; the first page of a process starts that program, and every later page is a copy of that started instance, which is why a page starts in about 3 ms. Nothing is shared between pages. Each gets its own clock origin and `Math.random` seed.

HTML (the page itself, and every `innerHTML` the page sets) is tokenized by a C port of htmlparser2 inside the WebAssembly module, which hands linkedom the same calls htmlparser2 would; that is about 2.5 times faster than parsing in the interpreter. Input the port does not reproduce exactly (for example non-ASCII tag names) falls back to htmlparser2 by itself.

## For contributors

The package builds its own QuickJS: `vendor/quickjs` (QuickJS-ng, unmodified) and `csrc/qjsdom.c` are compiled to a standalone `dist/quickjs.wasm` with Emscripten (`emcc` on `PATH`), and the guest program is compiled to bytecode with that very wasm.

```sh
pnpm --filter wasm-quickjs-dom build
pnpm --filter wasm-quickjs-dom test
```

## License

MIT. QuickJS-ng, linkedom and web-streams-polyfill are included under their own licenses: see `THIRD-PARTY-NOTICES.md`.
