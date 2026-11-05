# wasm-quickjs-dom

[![npm version](https://img.shields.io/npm/v/wasm-quickjs-dom.svg)](https://www.npmjs.com/package/wasm-quickjs-dom)
[![npm downloads](https://img.shields.io/npm/dw/wasm-quickjs-dom.svg)](https://www.npmjs.com/package/wasm-quickjs-dom)
[![license](https://img.shields.io/npm/l/wasm-quickjs-dom.svg)](https://github.com/SoraKumo001/wasm-html-to-image/blob/master/LICENSE)
[![Documentation](https://img.shields.io/badge/Docs-Docusaurus-blue)](https://sorakumo001.github.io/wasm-html-to-image/master/docs/)

Run a web page's JavaScript **without a browser and without `eval`** — and read or serialize the resulting DOM.

`wasm-quickjs-dom` is a lightweight JSDOM alternative built for environments where `jsdom` cannot run: **Cloudflare Workers**, **Vercel / Next.js Edge**, **Deno**, **Bun**, **browsers**, and **Node.js**. Page scripts execute inside [QuickJS-ng](https://github.com/quickjs-ng/quickjs) compiled to WebAssembly, backed by a fast native DOM written in C inside the same WebAssembly module. No `eval`, no native addons, and no headless browser required.

```ts
import { createDOM } from "wasm-quickjs-dom";

const dom = await createDOM({ url: "https://example.com/" });
console.log(await dom.eval("document.title"));
console.log(dom.serialize()); // HTML after the page's scripts ran
dom.close();
```

---

## ✨ Key Features & Use Cases

| Feature | Description |
| :--- | :--- |
| 🌐 **Runs Everywhere** | Zero-config WebAssembly loading for Cloudflare Workers, Vercel Edge, Node.js, Bun, Deno, and browsers. |
| 🔒 **Sandboxed Execution** | Scripts run inside a WebAssembly instance with no filesystem or `process` access, bounded memory/stack, and configurable `fetch` limits. |
| ⚡ **Fast Cold Starts (~3 ms)** | Pre-initialized QuickJS bytecode snapshot + C-based DOM parser and selector engine (~1.3 MB/s HTML parsing). |
| 🧩 **Two API Styles** | Async sandboxed API (`createDOM`) for edge/serverless + synchronous `new JSDOM()` drop-in (`wasm-quickjs-dom/jsdom`) for Node.js & Bun. |
| 🧪 **Vitest & Jest Environments** | Built-in test environments compatible with `@testing-library/dom`, `@testing-library/react`, `user-event`, and `jest-dom`. |
| 🎨 **CSS Cascade & SVG Geometry** | `getComputedStyle` cascades `<style>`, inline styles, and `<link rel="stylesheet">` (fetched by default; `stylesheets: false` skips them); computes approximate SVG `getBBox` / `getTotalLength`. |

**Good for:**
- Pre-rendering single-page apps (React, Next.js, Vue, etc.) to static HTML for SEO, OGP, and link previews.
- Scraping or extracting data from pages that build their DOM with client-side JavaScript.
- Running DOM unit tests on Node.js, Bun, or edge-compatible setups.
- Pre-processing scripted pages before passing them to an image renderer like [`wasm-html-to-image`](https://www.npmjs.com/package/wasm-html-to-image).

**Not a full browser:**
- No built-in visual layout engine (unless boxes are supplied via [`setLayout`](#layout-integration)), no `<canvas>` rendering, no live `WebSocket` / `Worker`, and QuickJS runs as an interpreter so very heavy bundles take longer than V8. See [Compatibility & Limitations](#compatibility--limitations).

---

## ⚖️ Comparison with JSDOM

`wasm-quickjs-dom` is designed specifically to run in environments where `jsdom` cannot (Cloudflare Workers, Vercel Edge, Deno, browsers), while offering a drop-in synchronous API (`wasm-quickjs-dom/jsdom`) for Node.js and Bun.

### Feature & Architecture Comparison

| Feature / Aspect | `jsdom` | `wasm-quickjs-dom` |
| :--- | :--- | :--- |
| **Runtime Support** | Node.js only (requires `vm` module and `eval`) | **Anywhere WebAssembly runs** (Node.js, Workers, Edge, Bun, Deno, browsers) |
| **Script Sandbox** | None (`runScripts: "dangerously"` runs in host process) | **Strict WebAssembly sandbox** (no filesystem, capped memory/stack, fetch limits) |
| **DOM Implementation** | Pure JavaScript on V8 objects | **High-speed C DOM & selector engine** (`csrc/nativedom*.h`) |
| **HTML Parser** | `parse5` (JavaScript) | **C port of `htmlparser2`** (~8.6× faster) |
| **CSS Cascade** | `getComputedStyle` with CSS cascade | `getComputedStyle` with CSS cascade (`<style>`, inline, `@media`, `var()`, `calc()`) |
| **SVG Geometry** | Minimal | **Approximate SVG geometry** from attributes (`getBBox`, `getTotalLength`, `getPointAtLength`) |
| **Testing Support** | Jest, Vitest, Testing Library | **Vitest & Jest environments included**, Testing Library compatible |

### Performance Benchmark (Node.js)

*Measured on Node.js v24 against `jsdom` v30.1.3:*

| Scenario | `jsdom` | `wasm-quickjs-dom` | Comparison |
| :--- | :--- | :--- | :--- |
| **HTML Parsing** (~100 KB, 1,000 table rows, ~5,000 nodes) | 77.0 ms | **11.0 ms** | **~7.0× faster** ⚡ |
| **HTML Serialization** (`dom.serialize()`) | 7.1 ms | **1.0 ms** | **~7.1× faster** ⚡ |
| **Selector Query** (`querySelectorAll("td a")` × 1,000 matches) | 0.83 ms | **< 0.1 ms** | **~8× faster** ⚡ |
| **Complex Selector Query** (`500 × querySelectorAll("tr.r3 > td a[href]")`) | 471 ms | **102 ms** | **~4.6× faster** ⚡ |
| **In-Page Script DOM Creation** (2,000 elements created in `<script>`) | 25.6 ms | **2.0 ms** | **~12.8× faster** ⚡ |
| **Warm Instance Creation** (`new JSDOM()` median over 50 runs) | 4.85 ms | **4.35 ms** | **~1.1× faster** ⚡ |
| **Testing Library Query Traversal** (`getAllByRole('button')` on 100 cards) | 23.5 ms | **28.7 ms** | **~1.2× jsdom** (cached AST & short-circuit) |

> [!TIP]
> **When `wasm-quickjs-dom` is faster:** Parsing HTML, serializing, executing CSS selector queries, and running client scripts that generate DOM inside the page (all execute natively in C / WebAssembly without host overhead).
>
> **Host-driven DOM queries & mutations:** Earlier versions were bottlenecked by WASM bridge roundtrips and frequent cache invalidations. With C-level AST caching, host-side tag short-circuit evaluation for `Element.matches()`, static Proxy handler pooling, and $O(1)$ tag prototype lookups, host queries (such as `@testing-library/dom` traversals) operate within **1.1x–1.3x** of V8-native JSDOM.

---

## 📦 Installation

```sh
npm install wasm-quickjs-dom
```

- **ESM only**
- **Node.js 20+** (or Cloudflare Workers, Vercel Edge, Deno, Bun, modern browsers)

### Subpath Exports

| Import Path | Purpose |
| :--- | :--- |
| `wasm-quickjs-dom` | Core async API (`createDOM`, `runPageScriptsQuickJS`, `isPrivateHost`) |
| `wasm-quickjs-dom/jsdom` | Synchronous `JSDOM` & `VirtualConsole` compatible API (Node.js & Bun) |
| `wasm-quickjs-dom/vitest` | Vitest test environment |
| `wasm-quickjs-dom/jest` | Jest test environment |
| `wasm-quickjs-dom/quickjs.wasm` | Raw WebAssembly binary (when custom loading is needed) |

---

## 🚀 Quick Start

### 1. Get the HTML of a Page After Its Scripts Run

```ts
import { createDOM } from "wasm-quickjs-dom";

const dom = await createDOM(
  { url: "https://example.com/" }, // or { html: "<div id='app'></div><script>...</script>", baseUrl: "https://example.com/" }
  { waitFor: "#app" },             // wait until this selector matches (default: let timers & requests settle)
);

try {
  const html = dom.serialize();
  console.log(html);
} finally {
  dom.close(); // always close to free the WebAssembly instance
}
```

If you only need the final HTML and don't need to interact with the page further, use `runPageScriptsQuickJS` (which closes the instance automatically):

```ts
import { runPageScriptsQuickJS } from "wasm-quickjs-dom";

const { html, baseUrl } = await runPageScriptsQuickJS(
  { url: "https://example.com/" },
  { waitFor: "#app" },
);
```

### 2. Read Values from the Page (`dom.eval`)

`dom.eval()` executes code inside the page's global scope and returns the result serialized as JSON. You can pass either a code string or a function with JSON-serializable arguments:

```ts
const title = await dom.eval<string>("document.title");

const count = await dom.eval(
  (selector: string) => document.querySelectorAll(selector).length,
  "a.item",
);

const rows = await dom.eval(() =>
  [...document.querySelectorAll("tr")].map((tr) => tr.textContent),
);
```

> [!NOTE]
> - DOM nodes cannot be returned directly across `eval` — return the data you read from them (or use `dom.bridge().window` for live object access).
> - Functions passed to `eval` are serialized via `.toString()`, so they cannot reference variables from the outer host scope.

### 3. Interact with the Page

```ts
await dom.type("#search", "wasm");            // sets value, dispatches input + change events
await dom.click("button[type=submit]");       // dispatches a bubbling click event
await dom.waitForSelector(".results");        // resolves true when matched, or false on timeout

// Expose a host function to the page as `await window.saveRow(...)`
dom.expose("saveRow", (row) => db.save(row));
```

### 4. Use Inside Cloudflare Workers / Edge Runtimes

WebAssembly loading is completely automatic (`workerd` and `edge-light` export conditions are configured out of the box):

```ts
import { createDOM } from "wasm-quickjs-dom";

export default {
  async fetch(request: Request): Promise<Response> {
    const target = new URL(request.url).searchParams.get("url")!;
    const dom = await createDOM(
      { url: target },
      {
        limits: {
          allowedProtocols: ["https:"],
          blockPrivateHosts: true,
          maxResourceBytes: 5_000_000,
        },
      },
    );

    try {
      return new Response(dom.serialize(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } finally {
      dom.close();
    }
  },
};
```

> See [`packages/cloudflare-prerender`](../cloudflare-prerender) in the repository for a complete Cloudflare Worker example.

---

## 🧩 JSDOM-Compatible API (`wasm-quickjs-dom/jsdom`)

For Node.js and Bun, `wasm-quickjs-dom/jsdom` provides a drop-in replacement for `jsdom`'s synchronous constructor. `dom.window` exposes live proxy objects bridged directly to the QuickJS instance (each property read or method call is a synchronous call into WebAssembly taking ~3 µs).

```ts
import { JSDOM } from "wasm-quickjs-dom/jsdom";

const dom = new JSDOM(
  "<p class='a'>Hello</p><script>document.title = 'Updated'</script>",
  { runScripts: "dangerously" },
);

const { document } = dom.window;
console.log(document.querySelector("p.a")?.textContent); // "Hello"
console.log(document.title);                             // "Updated"

// Host functions can be registered directly as DOM event listeners
document.addEventListener("click", (e: Event) => {
  console.log((e.target as Node).nodeName);
});

console.log(dom.serialize());
dom.window.close();
```

> 💡 **Tip:** You can also access the same synchronous live window from an async `createDOM()` instance via `dom.bridge().window`.

### JSDOM Feature Support

| Supported | Not Supported |
| :--- | :--- |
| `new JSDOM(html, options)` (synchronous parse & inline scripts) | `getInternalVMContext()` (runs in QuickJS WASM, not Node `vm`; use `window.eval`) |
| `url`, `referrer`, `contentType`, `pretendToBeVisual` | `nodeLocation()` (parser does not retain source offsets) |
| `runScripts: "dangerously"` \| `"outside-only"` | |
| `cookieJar` (shared/injected, tough-cookie-compatible; see below) | |
| `resources: "usable"` (fetches `<script src>` and `<link rel="stylesheet">`) | |
| `virtualConsole` (`new VirtualConsole().sendTo(console)`) | |
| `beforeParse(window)` | |
| `JSDOM.fromURL(url, options)` & `JSDOM.fromFile(path, options)` | |
| `JSDOM.fragment(html)` (synchronously creates a `DocumentFragment`) | |
| `dom.reconfigure({ url })` | |
| `dom.serialize()`, `dom.close()`, `dom.window.close()` | |
| `await dom.ready` (waits for external scripts and the `load` event) | |
| happy-dom `enableCSSFileLoading` / `enableJavaScriptEvaluation` / `enableImageFileLoading` / `enableIframePageLoading` | |
| `register()` / `unregister()` / `GlobalRegistrator` (happy-dom style process globals) | |
| `dom.goto(url)` / `dom.waitUntilComplete()` (thin wrappers, see below) | |

> [!NOTE]
> - **Timers & Lifecycle:** The page's timers and `load` event run behind the constructor and do not keep the Node process alive; `await dom.ready` waits for external scripts and the `load` event.
> - **Cookies:** `document.cookie`, the cookies of the page's requests and the `Set-Cookie` headers of its responses all go through the page's jar, with RFC 6265 domain/path scoping, `Secure` and `HttpOnly` (hidden from the page) honoured. Without a `cookieJar` option each page gets a fresh jar of this package's own (`dom.cookieJar`, as in jsdom); pass one — this package's `CookieJar`, or a tough-cookie jar, whose synchronous surface is what is used — to share cookies between pages or to seed them. The engine's `createDOM` / `openPage` take the same option; a page opened without it keeps a small per-page jar of its own.

### happy-dom Compatibility (P1)

A happy-dom configuration can be reused. The four `settings` toggles are accepted directly on `JSDOMOptions` or in a nested `settings` object (a top-level field wins). They default to `true`, so the quickjs behaviour is unchanged; they are vetoes, and the jsdom switch that requests a subresource still decides whether any work happens.

| happy-dom setting | `JSDOMOptions` | Default | Effect here |
| :--- | :--- | :--- | :--- |
| `settings.enableCSSFileLoading` | `enableCSSFileLoading` | `true` | Linked CSS is fetched only with `resources: "usable"`; `false` skips those requests even then. `<style>` and `style` attributes cascade either way. |
| `settings.enableJavaScriptEvaluation` | `enableJavaScriptEvaluation` | `true` | `false` vetoes page scripts even with `runScripts: "dangerously"` (inline and external). `window.eval` with `"outside-only"` is host-driven and stays available. |
| `settings.enableImageFileLoading` | `enableImageFileLoading` | `true` | Accepted for compatibility; the DOM never fetches image bytes (the renderer publishes them with `setImageResource()`), so it changes nothing yet. |
| `settings.enableIframePageLoading` | `enableIframePageLoading` | `true` | Accepted for compatibility; nested browsing contexts are not loaded, so it changes nothing yet. |

| Concern | jsdom | happy-dom | `wasm-quickjs-dom/jsdom` |
| :--- | :--- | :--- | :--- |
| Page scripts by default | none (`runScripts` unset) | evaluation on | none unless `runScripts: "dangerously"`; `enableJavaScriptEvaluation: false` vetoes |
| External `<script src>` | `resources: "usable"` | `enableJavaScriptFileLoading` on | `runScripts: "dangerously"` + `resources: "usable"` + evaluation on |
| Linked CSS (`<link rel="stylesheet">`) | `resources: "usable"` | `enableCSSFileLoading` on | `resources: "usable"` + `enableCSSFileLoading` |
| `<style>` and `style=""` | cascaded | cascaded | cascaded always (`stylesheets: false` affects only linked files) |
| Images | fetched by jsdom | fetched | never fetched by the DOM; the renderer owns the request |
| Iframes | loaded with resources | `enableIframePageLoading` | contents not loaded (`srcdoc` seeds a blank document only) |
| Timers | host timers | own clock | the page's timers run on the host's `setTimeout` and read its `Date`, so a test runner's fake timers (Vitest `vi.useFakeTimers()`, Jest modern and legacy) drive them: advancing the fake clock fires the page's timers and moves its `Date.now()` (see [`docs/known-gaps.md`](./docs/known-gaps.md) §1) |
| Viewport width | 1024 | configurable | `engine.width` (default 800), also `window.innerWidth` |
| Viewport height | 768 | configurable | `engine.height` (`createDOM` option `height`); default `round(width * 0.75)` |

`register()` / `unregister()` stand in for happy-dom's `GlobalRegistrator`:

```ts
import { register, unregister } from "wasm-quickjs-dom/jsdom";

register({ url: "http://localhost/", runScripts: "dangerously" });
// document / window / HTMLElement ... now point at the page
unregister(); // globals restored, page closed
```

`dom.goto(url)` is a thin `JSDOM.fromURL` (a `file:` URL goes through `JSDOM.fromFile`) followed by `await dom.ready`; it returns the new page and does **not** navigate the current page in place or close it. `dom.waitUntilComplete()` is `await dom.ready`. They are also reachable as `dom.happyDOM.goto()` / `dom.happyDOM.waitUntilComplete()` for code written against happy-dom. A full happy-dom `Browser` (history, in-place navigation, frame navigation) is not reproduced.

---

## 🧪 Test Runner Environments (Vitest & Jest)

`wasm-quickjs-dom` includes ready-to-use environments for **Vitest** and **Jest**, exposing `window`, `document`, `HTMLElement`, `Event`, and other browser globals to your test files.

Compatible with:
- `@testing-library/dom`
- `@testing-library/react` (React 18+)
- `@testing-library/user-event`
- `@testing-library/jest-dom`

### Vitest Configuration

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Recommended: resolve the environment through the package's subpath export.
    environment: "wasm-quickjs-dom/vitest",
    environmentOptions: {
      wasmQuickjsDom: {
        url: "http://localhost:3000",
        // Any JSDOMOptions (html, resources: "usable", etc.)
      },
      // An existing jsdom setup keeps working: its options are the defaults,
      // and wasmQuickjsDom overrides them.
      jsdom: { url: "http://localhost:3000" },
    },
  },
});
```

> [!IMPORTANT]
> Use `environment: "wasm-quickjs-dom/vitest"`. It goes through the package's `./vitest` subpath export, so Vitest resolves the copy that is actually installed — including pnpm's non-hoisted `node_modules/.pnpm` layout, where a hard-coded `./node_modules/wasm-quickjs-dom/dist/vitest.js` may not exist or may point at a different copy.
>
> Pointing `environment` at the file directly (for example `"./node_modules/wasm-quickjs-dom/dist/vitest.js"`) still works but is **deprecated**; prefer the subpath form in new configurations.

> [!NOTE]
> Options are resolved in this order: `environmentOptions.wasmQuickjsDom`, then `environmentOptions.jsdom` (the options of Vitest's `jsdom` environment), then the top-level `environmentOptions.url`; the first value present wins. `html` likewise falls back to `jsdom.html`, so a config written for `jsdom` does not need to move either option.

### Jest Configuration

```js
// jest.config.cjs
module.exports = {
  testEnvironment: "wasm-quickjs-dom/jest",
  testEnvironmentOptions: {
    url: "http://localhost:3000",
  },
};
```

> [!TIP]
> **Performance in Tests:** Every DOM call from the host crosses the WebAssembly bridge (~3 µs). Typical component tests run as fast as `jsdom` or faster, while tests that traverse thousands of nodes repeatedly from the host (such as broad `getByRole` queries on huge trees) may take slightly longer.
>
> **Building a subtree from the host:** `bridge.batch([["tree", parent, tree]])` builds the whole tree in one call (`tree` is `{ tag, attrs?, text?, children? }`). If the markup is already a string, assigning it to `innerHTML` once is still the shortest path: the C parser builds it in the page without a host round trip. Use `batch` for the virtual tree a host renderer already has, and `innerHTML` for markup it already has.

---

## 🔒 Security: Handling Untrusted Pages

A page's scripts (and any external scripts or ES modules it imports) can call `fetch` and `XMLHttpRequest`. **Without `limits`, a page can request any URL your host runtime can reach, including internal/private networks.**

Always configure `limits` when loading pages you do not control:

```ts
const dom = await createDOM(
  { url },
  {
    limits: {
      allowedProtocols: ["https:"],
      allowedHosts: ["example.com", "cdn.example.com"], // exact hostname allowlist
      blockedHosts: ["internal.example.com"],           // exact hostname blocklist
      blockPrivateHosts: true,                          // blocks localhost, 127.0.0.1, 10.x, 192.168.x, 169.254.x, IPv6 loopback/unique-local
      maxResourceCount: 50,                             // max total requests per page
      maxResourceBytes: 5_000_000,                      // max bytes per single response
      maxTotalResourceBytes: 20_000_000,                // max cumulative bytes across all responses
    },
    skip: (reqUrl) => reqUrl.includes("analytics"),     // abort matching requests before hitting the network
  },
);
```

### Security Guarantees

- **Every request is checked:** `limits` apply to the initial `source.url`, `fetch`, `XMLHttpRequest`, `<script src>`, `<link rel="stylesheet">`, and ES module imports.
- **Redirect validation:** When host or protocol limits are active, every HTTP redirect hop is inspected manually before following (up to 10 hops).
- **DNS rebinding note:** `blockPrivateHosts` inspects hostnames and IP literals before calling `fetch`. Because standard `fetch` resolves DNS internally, pair `blockPrivateHosts: true` with `allowedHosts` when full SSRF protection against custom domains is required.
- **WebAssembly isolation:** Page scripts run inside a dedicated WASM sandbox with no access to the filesystem, environment variables, or `process`. Memory is capped at 256 MB, stack at 192 KB, and execution time per call is bounded by `timeout` (unless you explicitly pass `0` / `Infinity`).

---

## 📖 API Reference

### `createDOM(source, options?)` → `Promise<QuickJSDOM>`

Creates a new isolated QuickJS + C DOM instance, loads the HTML, executes scripts, and keeps the page open.

#### `source`

- `{ url: string }` — Fetches the document from `url`.
- `{ html: string, baseUrl?: string }` — Parses an existing HTML string (`baseUrl` defaults to `"about:blank"` and sets `location` + relative URL resolution).

#### `options` (`CreateDOMOptions`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `timeout` | `number` | `10000` | Maximum time in ms allowed for **each call** into the page (initial load, `eval`, `settle`, etc.). `0` or `Infinity` disables the limit; a negative or `NaN` value throws. |
| `settleMs` | `number` | `1000` | Maximum time in ms after `load` to let pending timers and network requests finish. Returns early as soon as the queue is idle. |
| `waitFor` | `string` | — | CSS selector to wait for after `load` instead of `settleMs`. |
| `width` | `number` | `800` | Viewport width (`window.innerWidth` and `@media` / `matchMedia` width queries). |
| `height` | `number` | `round(width * 0.75)` | Viewport height (`window.innerHeight`, `screen.height`, `vh` units). |
| `stylesheets` | `boolean` | `true` | Fetches external `<link rel="stylesheet">` files so `getComputedStyle()` includes their rules. Set `false` to skip those requests; `<style>` elements and inline styles are cascaded either way. |
| `beforeScripts` | `string \| string[]` | — | Classic script(s) to execute after HTML parsing but before any page `<script>` runs (useful for polyfills, globals, or probes). |
| `limits` | `FetchLimits` | — | Network and resource restrictions (see [Security](#security-handling-untrusted-pages)). |
| `skip` | `(url: string) => boolean` | — | Return `true` to reject a subresource request immediately without network access (great for skipping ads/analytics). |
| `onLog` | `(entry: PageLogEntry) => void` | — | Callback invoked in real time for every console log, script error, unhandled rejection, or network request. |
| `quickjsWasm` | `WebAssembly.Module` | auto | Custom pre-compiled QuickJS `WebAssembly.Module` (loaded automatically by default). |

---

### `QuickJSDOM` Instance

> [!IMPORTANT]
> **How the Page Clock Works:** The page's virtual clock and event loop advance **only** while an async method (`eval`, `settle`, `waitForSelector`, `click`, `type`) is awaiting. Between calls, timers and in-flight requests remain paused.

| Property / Method | Signature | Description |
| :--- | :--- | :--- |
| `baseUrl` | `readonly string` | Final document URL (after redirects if fetched). |
| `logs` | `readonly PageLogEntry[]` | Last 1,000 log entries (`console`, `error`, `rejection`, `request`). Check this first when a page fails to render as expected. |
| `eval` | `eval<T>(code: string): Promise<T>`<br>`eval<T>(fn, ...args): Promise<T>` | Evaluates code or a function in the page's global scope and awaits any returned Promise. Returns JSON-serializable values. |
| `waitForSelector` | `(selector: string) => Promise<boolean>` | Waits up to `timeout` ms for a CSS selector to match. Returns `false` if timed out or no more work is pending. |
| `click` | `(selector: string) => Promise<boolean>` | Dispatches a bubbling `click` event on the first matching element (`false` if not found). |
| `type` | `(selector: string, text: string) => Promise<boolean>` | Sets `value` (or `textContent`) on the first matching element and fires `input` and `change` events. |
| `expose` | `(name: string, fn: Function) => void` | Exposes a host function on `window[name]`. Callable from the page as `await window[name](...args)`. |
| `settle` | `(ms?: number) => Promise<void>` | Advances timers and network requests for up to `ms` (defaults to `settleMs`) or until idle. |
| `serialize` | `() => string` | Serializes the current DOM tree back to an HTML string. |
| `bridge` | `(options?: BridgeOptions) => Bridge` | Returns `{ window }`, giving the host synchronous proxy access to page DOM objects. |
| `toOptions` | `<T>(options: T) => T` | Populates `value` (serialized HTML) and `baseUrl` on a renderer options object (e.g., for `wasm-html-to-image`). |
| `markForLayout` | `() => string` | Returns serialized HTML with `qjsl-<n>` classes injected on elements for layout measurement. |
| `setLayout` | `(boxes: Record<number, [x, y, w, h]>) => void` | Injects measured `[x, y, width, height]` bounding boxes back into the DOM. |
| `close` | `() => void` | Frees the QuickJS WebAssembly instance. Must be called when done. |

#### `PageLogEntry` Types

```ts
type PageLogEntry =
  | { type: "console"; level: "log" | "warn" | "error"; message: string }
  | { type: "error"; message: string; source: string }
  | { type: "rejection"; message: string }
  | { type: "request"; method: string; url: string; status?: number; error?: string };
```

---

### Layout Integration

By default, QuickJS has no visual layout engine, so `getBoundingClientRect()`, `offsetWidth`, and `clientHeight` return `0` (except SVG shapes, where `getBBox()`, `getTotalLength()`, and `getPointAtLength()` are worked out from the path/shape attributes, approximately — see [Compatibility & Limitations](#compatibility--limitations)).

If a page's scripts depend on real layout measurements:
1. Call `dom.markForLayout()` to get HTML tagged with element IDs (`qjsl-<n>`).
2. Measure element bounding boxes in a layout engine.
3. Pass the results to `dom.setLayout({ [elementId]: [x, y, width, height] })`.

When paired with [`wasm-html-to-image`](https://www.npmjs.com/package/wasm-html-to-image), `measureLayout(dom, render)` performs all three steps in a single call, and `enableLiveLayout(dom, module)` keeps the boxes (and `getComputedStyle`) current as the page changes, with no calls from you. The boxes also feed `document.elementFromPoint()` / `elementsFromPoint()`.

---

## 💻 Command Line (CLI)

```sh
wasm-quickjs-dom [options] <url | file | ->
```

Runs a page's scripts and writes the resulting HTML (or evaluated expression) to standard output.

### Examples

```sh
# Pre-render a URL and wait for #app to appear
npx wasm-quickjs-dom https://example.com/ --wait "#app" > rendered.html

# Evaluate an expression in the page and print the result
npx wasm-quickjs-dom https://example.com/ -e "document.title"

# Render a local HTML file (or "-" for stdin) with a base URL
npx wasm-quickjs-dom page.html --base-url https://example.com/

# Run safely on an untrusted URL with network limits and request logs
npx wasm-quickjs-dom https://example.com/ --protocol https: --block-private --logs
```

### CLI Options

| Option | Description |
| :--- | :--- |
| `-o, --output <file>` | Write output to `<file>` instead of stdout. |
| `-e, --eval <code>` | Evaluate `<code>` after load and print its result (strings raw, other values as JSON). |
| `--json` | Output `{ baseUrl, html, logs }` formatted as JSON. |
| `--logs` | Print page logs (console, errors, rejections, requests) to stderr. |
| `--wait <selector>` | Wait for `<selector>` to match after load. |
| `--settle <ms>` | Settle duration in ms after load (default: `1000`). |
| `--timeout <ms>` | Timeout per operation in ms (default: `10000`). |
| `--width <px>` | Viewport width in pixels (default: `800`). |
| `--base-url <url>` | Base URL when reading from a local file or stdin (`-`). |
| `--stylesheets` | Fetch `<link rel="stylesheet">` sheets for `getComputedStyle` (already the default; kept as an explicit flag). |
| `--protocol <proto>` | Allowed URL protocol, e.g., `https:` (repeatable). |
| `--allow-host <host>` | Allowed hostname (repeatable). |
| `--block-host <host>` | Blocked hostname (repeatable). |
| `--block-private` | Block localhost and private/loopback/link-local IP ranges. |
| `--max-bytes <n>` | Maximum bytes per response (and 4× total). |
| `--max-requests <n>` | Maximum total network requests. |
| `--skip <substring>` | Skip requests whose URL contains `<substring>` (repeatable). |
| `--before <file>` | Run `<file>` in the page before any page scripts execute (repeatable). |

**Exit codes:** `0` on success, `1` if loading or `--eval` failed, `2` on invalid CLI arguments.

---

## 📊 Compatibility & Limitations

### What Works

- **Scripts & Modules:** Inline `<script>`, external `<script src>`, dynamically inserted scripts, and `<script type="module">` (static `import` and `import("literal")` are pre-fetched and linked).
- **Frameworks:** React 18+, Next.js client hydration, Preact, Vue, and standard SPA routers (`history.pushState` / `replaceState`).
- **Network:** `fetch` and `XMLHttpRequest` (binary-safe via base64 bridge), `Headers`, `Request`, `Response`, `AbortController`, `TextEncoder` / `TextDecoder`, `URL` / `URLSearchParams`, `Blob`, `FormData`, Web Streams.
- **DOM & Selectors:** Full C-backed DOM tree manipulation, live HTMLCollections, `<template>`, Shadow DOM (`attachShadow`; shadow trees are not serialized), Custom Elements (`customElements.define`), `DOMParser`, `Range` & `Selection` (live-updated on tree mutations), and a native CSS selector engine (`:not`, `:is`, `:has`, `:nth-child`, attribute operators).
- **Forms:** The `form` attribute associates controls (`input`, `button`, `select`, `textarea`, `fieldset`, `object`, `output`) with a form outside their subtree, with no fallback to an ancestor form when the named form does not exist. `form.elements` / `form.length` include those external controls, clicking a submit button submits its owner form, and `form.requestSubmit(submitter)` fires a `SubmitEvent` whose `submitter` is the button (it throws `TypeError` for a non-submit button and `NotFoundError` for a button owned by another form).
- **CSS & `getComputedStyle`:** Cascades `<style>` tags, inline `style` attributes, and external `<link rel="stylesheet">` (fetched by default; `stylesheets: false` skips them, while the JSDOM facade fetches them with `resources: "usable"`). Supports selector specificity, `!important`, inheritance, `@media` width queries, `var()` custom properties, color normalization to `rgb()`, unit conversion (`em`, `rem`, `pt`, `cm`, `in`, etc. to `px`), and `calc()` / `min()` / `max()` / `clamp()`.
- **Observers & Timers:** `MutationObserver`, `setTimeout` / `setInterval`, `requestAnimationFrame`, `queueMicrotask`. `IntersectionObserver` and `ResizeObserver` fire once immediately upon `.observe()` so lazy-loaded components render automatically.
- **SVG Geometry (approximate):** `getBBox()`, `getTotalLength()`, and `getPointAtLength()` are computed from SVG shape and path attributes, not from a real layout (see the [limitations](#what-does-not-work) below).
- **Storage & Crypto:** In-memory `localStorage`, `sessionStorage`, `document.cookie`, and `crypto.getRandomValues` / `crypto.randomUUID` (backed by `Math.random`, not a CSPRNG). `Storage.prototype` carries the standard methods (`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`), so host-side test helpers such as `vi.spyOn(Storage.prototype, "setItem")` work as they do with jsdom.

### What Does Not Work

- **Visual Layout:** `getBoundingClientRect()` and `offsetWidth` return `0` unless bounding boxes are provided via [`setLayout`](#layout-integration) (or kept current by `enableLiveLayout()` of `wasm-html-to-image`).
- **Canvas & Media:** `<canvas>` has no backing store: `getContext()` returns `null` and `toDataURL()` returns `"data:,"` (each logs a one-time warning), so calling a method on the returned context throws a `TypeError`; `<audio>` / `<video>` have no media decoders (`play()` rejects just like an unsupported media source in a browser).
- **Live Persistent Connections & Threads:** `WebSocket`, `EventSource`, and `Worker` exist as classes that emit an `error` event and close (logging a warning to `dom.logs`), allowing pages with fallback logic to continue gracefully.
- **Iframe Documents:** nested browsing contexts are not loaded (no scripts or resources inside a frame run), but each `<iframe>` owns a separate blank HTML document: `contentDocument` is that document (`srcdoc` seeds it), `contentWindow` is a small window-like object carrying it, and `document.open()/write()/close()` work for pages that render through an iframe (such as modern-screenshot).
- **Shadow DOM Serialization:** `attachShadow()` and `shadowRoot` work for scripts, but shadow trees are not serialized: `serialize()` and the rendered HTML omit their content, and `attachShadow()` logs a warning. Declarative shadow DOM is not emitted.
- **Fonts:** `document.fonts` is a stub (`ready` resolves at once, `check()` always returns `true`, `load()` resolves to an empty array) and `FontFace` is not defined, so pages cannot actually load or wait for web fonts.
- **Interaction Selectors:** `:focus`, `:focus-visible` (the same as `:focus`), `:focus-within`, `:hover`, `:active` and `:target` follow the page's state: `focus()` / `blur()`, the pointer events the page or a test library dispatches (`mouseover` / `pointerover` set `:hover` to the target and its ancestors, `mousedown` / `pointerdown` set `:active`, `mouseup` clears it, a `mouseout` without `relatedTarget` clears `:hover`), and the URL hash (`location.hash = ...` fires `hashchange`; `history.pushState` does not). They work in selectors and in `getComputedStyle()`. `:visited` never matches, and pseudo-elements never match in selectors (as in browsers); `getComputedStyle(el, "::before")` (also `::after`, `::first-line`, `::first-letter`, `::marker`, `::placeholder`, `::selection`, and the one-colon forms) answers from the rules whose selector ends in that pseudo-element, inheriting from the element, with `content: none` when nothing is generated. Layout values of a pseudo-element are not available. (`matchMedia("(hover: hover)")` still reports `true`.)
- **Hit Testing & Scrolling:** `document.elementFromPoint()` / `elementsFromPoint()` work from the layout boxes once they are supplied (`setLayout`, or `enableLiveLayout` in `wasm-html-to-image`): the last element in document order whose box holds the point, skipping `visibility: hidden` and `pointer-events: none`; `z-index` and clipping are not looked at, and without boxes they return `null` / `[]`. `scrollIntoView()` does nothing; `scrollTop` / `scrollLeft` keep what the page writes but nothing scrolls.
- **XPath Namespaces:** XPath 1.0 expressions work, but namespace prefixes cannot be resolved (`namespace-uri()` returns `""` and `createNSResolver().lookupNamespaceURI()` returns `null`).
- **SVG Geometry:** `getBBox()`, `getTotalLength()`, and `getPointAtLength()` are approximate: a path's `A` (arc) command is treated as its chord, `transform` attributes are ignored (`getCTM()` / `getScreenCTM()` return the identity), circles and ellipses are sampled, and `<text>` has no layout, so its box is `0 × 0`.

### Performance Characteristics

| Metric | Typical Value |
| :--- | :--- |
| **First page in process** | ~120 ms (compiles WASM & initializes snapshot) |
| **Subsequent pages** | **~3 ms** (cloned from pre-initialized snapshot) |
| **HTML parsing & DOM build** | **~2.5 MB/s** (~11 ms for a 100 KB / 5,000-node HTML document, ~7× faster than JS `parse5`) |
| **Host ↔ WASM bridge call** | **~0.6 µs** per cached property read, **~3 µs** per cross-boundary call |

---

## 🌐 Runtime Support & WASM Loading

WebAssembly loading is handled automatically via `package.json` conditional imports (`#quickjs-wasm`):

| Runtime | How `quickjs.wasm` is Loaded |
| :--- | :--- |
| **Cloudflare Workers** | Imported as a pre-compiled `WebAssembly.Module` (`workerd` condition) |
| **Vercel / Next.js Edge** | Imported with `?module` (`edge-light` condition) |
| **Node.js & Bun** | Read from disk once and compiled (`node` / `bun` conditions) |
| **Deno & Browsers** | Fetched relative to `import.meta.url` once and compiled (`default` condition) |

If your bundler or environment requires manual WASM handling, import `wasm-quickjs-dom/quickjs.wasm` and pass the compiled `WebAssembly.Module` as `{ quickjsWasm }` to `createDOM()`.

---

## 🔧 How It Works (Architecture)

1. **Snapshot-based Instant Startup:** Browser globals and the JavaScript layer of the DOM (Events, `MutationObserver`, Custom Elements, Shadow DOM, form controls) are pre-compiled into QuickJS bytecode at build time. The first page boots this bytecode once; every subsequent page clones the initialized state in ~3 ms with isolated memory, clock origin, and `Math.random` seed.
2. **Native C DOM & CSS Engine (`csrc/nativedom*.h`):** DOM nodes live as C structs inside the same WebAssembly module. Tree traversal, HTML parsing (a C port of `htmlparser2` with automatic fallback for edge-case syntax), HTML serialization, and CSS selector matching all run natively in C without crossing the JS/C boundary.
3. **Differential Fuzzing:** The native C DOM is continuously verified against `jsdom` using randomized sequences of tree mutations and selector queries after every step.

---

## 🛠️ Development

Building from source requires Node.js >= 20, pnpm, and Emscripten (`emcc` in `PATH`) to compile `vendor/quickjs` (unmodified QuickJS-ng) and `csrc/qjsdom.c` into `dist/quickjs.wasm`.

```sh
pnpm --filter wasm-quickjs-dom build
pnpm --filter wasm-quickjs-dom test
```

---

## 📄 License

MIT © [SoraKumo](https://github.com/SoraKumo001).  
QuickJS-ng and `web-streams-polyfill` are included under their respective licenses — see [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).
