---
sidebar_position: 2
title: render() & Options
---

# render() & Options Reference

`render()` is the primary function for converting HTML or raw images into the target format.

## Signatures

```typescript
// wasm-html-to-image/single
export function render(
  options: HtmlToImageOptions,
): Promise<Uint8Array | string>;

// wasm-html-to-image
export function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<Uint8Array | string>;
```

:::note Return Type
Returns a `string` for `svg` format, and `Uint8Array` for all other formats (`png`, `jpeg`, `webp`, `apng`, `gif`, `tiff`, `avif`, `jxl`, `pdf`, `raw`, `thumbhash`).
:::

---

## Options (`HtmlToImageOptions`)

### Core Options

| Option    | Type                                              |   Default    | Description                                                              |
| --------- | ------------------------------------------------- | :----------: | ------------------------------------------------------------------------ |
| `value`   | `string \| string[] \| Uint8Array \| ArrayBuffer` |      -       | Input data (HTML string, HTML array for multi-page PDF, or image buffer) |
| `url`     | `string`                                          |      -       | URL to fetch and render when `value` is omitted                          |
| `baseUrl` | `string`                                          |      -       | Base URL for resolving relative assets                                   |
| `width`   | `number`                                          |    `800`     | Viewport width (HTML) or target output width (image)                     |
| `height`  | `number`                                          |    `auto`    | Viewport height (HTML) or target output height (image)                   |
| `format`  | `OutputFormat`                                    |   `"png"`    | Target output format (`png`, `jpeg`, `webp`, `apng`, `gif`, `tiff`, `avif`, `jxl`, `raw`, `thumbhash`, `svg`, `pdf`) |
| `scale` | `number` | `1` | Pixel density of raster output from HTML input (0-16). `width` stays in CSS px and the page is drawn `scale` times larger (`scale: 3.125` turns an 800px layout into a 2500px image, with text and shapes re-rasterized rather than stretched). Ignored for `svg` / `pdf` and for image input. |
| `dpi` | `number` | `96 × scale` | Resolution written to `tiff`, in pixels per inch. A print shop reads the physical size from it. |
| `colorSpace` | `"srgb" \| "cmyk"` | `"srgb"` | Output color space of `tiff` and `pdf`. `"cmyk"` is for print: TIFF becomes a separated CMYK image with transparency flattened onto white, and PDF has every fill, stroke and image rewritten to DeviceCMYK. The conversion is the plain device formula (K = 1 − max(R,G,B), black stays K only) with no ICC profile, so saturated screen colors are not gamut-mapped. Ignored for other formats. |

### Encoding & Resizing

| Option      | Type                                                      | Default | Description                                  |
| ----------- | --------------------------------------------------------- | :-----: | -------------------------------------------- |
| `quality`   | `number`                                                  |  `85`   | Compression quality 0–100 (JPEG, WebP, AVIF) |
| `speed`     | `number`                                                  | AVIF: `8` / other: `6` | Encoding speed 0–10 (AVIF, JXL and animated lossy WebP). Animated WebP uses libwebp method `8 - speed`: the default 6 is method 2, 5 is method 3 (~4% smaller), 9 is method 0 (fastest, ~30% larger). AVIF at 8 is several times faster than 6 for ~15–20% larger files; pass `speed: 6` for the smallest output |
| `fit`       | `"contain" \| "cover" \| "fill"`                          |    -    | Resize fit strategy                          |
| `crop`      | `{ x: number, y: number, width: number, height: number }` |    -    | Cropping bounding rectangle                  |
| `animation` | `boolean \| { duration: number; fps?: number; loop?: number }` | `false` | Preserve animation frames where supported. For HTML input, `{ duration, fps, loop }` samples `opacity`, `transform` (`translate` / `rotate` / `scale`), and `color` / `background-color` `@keyframes` into an animated WebP / APNG / GIF (`format: "webp" | "apng" | "gif"`); every `@keyframes` block animates all the elements its rule selects (several animations on one element are layered); `loop` is the repeat count (`0` = infinite = the default, `1` = play once). CSS `animation-duration` (including the shorthand) takes precedence, with `duration` used as an upper clamp and `fps` as the sampling rate |

### Fonts & Styling

| Option          | Type                                      |      Default       | Description                                            |
| --------------- | ----------------------------------------- | :----------------: | ------------------------------------------------------ |
| `fontMap`       | `Record<string, string>`                  | `DEFAULT_FONT_MAP` | Map of generic family names to Google Fonts URLs       |
| `fallbackFonts` | `(Uint8Array \| ArrayBuffer \| string)[]` |        `[]`        | User-supplied fallback fonts                           |
| `fonts`         | `{ name: string, data: Uint8Array }[]`    |        `[]`        | Named fonts pre-loaded on the instance                 |
| `css`           | `string`                                  |         -          | Additional custom CSS string injected before discovery |
| `mediaType`     | `"screen" \| "print"`                     |     `"screen"`     | Target media type for CSS `@media` rules               |
| `textToPaths`   | `boolean`                                 |       `true`       | Outline text as SVG paths                              |
| `userAgent`     | `string`                                  |  Chrome's UA       | User-Agent for resource fetches (Web font CSS, ...)    |

### Running scripts (`javascript`) and Mermaid (`mermaid`)

| Option | Type | Description |
| ------ | ---- | ----------- |
| `javascript` | `boolean \| { timeout?: number, settleMs?: number, waitFor?: string, engine?: "jsdom" \| "quickjs" }` | Run the page's `<script>`s in jsdom before rendering (Node.js `single` entry and the CLI's `--js`; needs the optional dependency `jsdom`). `true` waits 1 s after `load`. `timeout` bounds the whole phase (default 10000 ms), `settleMs` is the wait after `load` (default 1000 ms), `waitFor` is a CSS selector to wait for (replaces `settleMs`). `engine: "quickjs"` runs them in QuickJS (WebAssembly) on linkedom instead of jsdom ([running scripts on edge runtimes](#running-scripts-on-edge-runtimes-cloudflare-workers-and-others)). jsdom has no layout and is not a sandbox: use it with trusted pages only |
| `mermaid` | `{ source, theme?, padding?, background?, accent?, mode?, directives?, onWarning?, maxLines?, maxSourceBytes? }` | Draw a Mermaid diagram (instead of `value`), as an image sized to the diagram. See [Mermaid conversion](./mermaid.md) |

#### Running scripts on edge runtimes (Cloudflare Workers and others)

jsdom is Node.js only. Where `eval` is not allowed, such as Workers, `wasm-html-to-image/javascript` runs the page's scripts in QuickJS (WebAssembly) on a linkedom DOM. A React / Next.js client has been checked to run through hydration and its `useEffect`s.

```ts
import { applyJavaScript } from "wasm-html-to-image/javascript";
import { render } from "wasm-html-to-image/workerd";

const options = await applyJavaScript({ url: "https://example.com/", javascript: true, width: 1200, format: "png" });
const { data } = await render(options);
```

- The package picks the QuickJS wasm for the runtime (`#quickjs-wasm` in the `imports` of `package.json`): a pre-compiled module on Workers and on Vercel / Next.js Edge, read from disk on Node.js and Bun, fetched on Deno and in browsers. To use a module of your own, pass it as `applyJavaScript(options, { quickjsWasm })`. The Node.js `single` entry also selects this engine with `javascript: { engine: "quickjs" }`.
- It needs the optional dependencies `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync` (a Workers bundle includes them).
- Limits: no layout (`getBoundingClientRect` returns 0), no `canvas`, `type="module"` scripts run, but only `import`s with literal specifiers (fetched up front) resolve. The DOM is linkedom's, smaller than jsdom's, and QuickJS is an interpreter, so heavy pages are slower.
- As with jsdom, use it with trusted pages only (the scripts can `fetch`).

#### Keeping the DOM open (`createDOM`)

Without rendering anything, the page can be kept open and driven, like JSDOM. The DOM lives inside QuickJS, so you talk to it through `eval()` and JSON values rather than a live `dom.window`.

```ts
import { createDOM } from "wasm-html-to-image/javascript";
import { render } from "wasm-html-to-image/workerd";

const dom = await createDOM({ url: "https://example.com/" }, { width: 1200 });
try {
  const title = await dom.eval("document.title");            // the value comes back as JSON; promises are awaited
  await dom.eval("document.querySelector('h1').textContent = 'Hello'");
  const { data } = await render(dom.toOptions({ width: 1200, format: "png" })); // draw the DOM as it is now
} finally {
  dom.close();                                                // frees QuickJS
}
```

- `eval(code)` runs code in the page's global scope and returns the result as JSON. A promise is awaited, and what the code throws becomes an `Error`. A DOM node cannot be returned: return what you read from it. Calls run one after another.
- `settle(ms?)` lets the page's timers and fetches run. The page's clock runs only during `eval()` / `settle()`, not in between.
- `serialize()` is the current HTML; `toOptions(options)` gives render options you can pass to `render()` as they are.
- The second argument of `createDOM` is the `javascript` option (`timeout` / `settleMs` / `waitFor`) plus `width` and `quickjsWasm`. `timeout` counts per call.

### Rendering untrusted HTML (`limits`)

When rendering user-supplied HTML, always restrict where it may fetch from and how much. By default any host is fetched, and on Node local files under `baseUrl` are read.

| `limits` key            | Type       | Description                                                                                                                                                                |
| ----------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeoutMs`             | `number`   | Timeout for the whole render. Each individual fetch is aborted by the remaining time                                                                                       |
| `maxResourceCount`      | `number`   | Maximum number of resources to load                                                                                                                                        |
| `strictFonts`           | `boolean`  | Throw `LIMIT_RESOURCE_COUNT` instead of rendering missing glyphs when fonts were skipped by `maxResourceCount` (default `false`) |
| `maxResourceBytes`      | `number`   | Maximum bytes for a single resource                                                                                                                                        |
| `maxTotalResourceBytes` | `number`   | Maximum total bytes for all resources                                                                                                                                      |
| `allowedProtocols`      | `string[]` | Allowed URL protocols (e.g. `["https:"]`)                                                                                                                                  |
| `allowedHosts`          | `string[]` | Allowed hostnames                                                                                                                                                          |
| `blockedHosts`          | `string[]` | Blocked hostnames                                                                                                                                                          |
| `confineFilesToBaseUrl` | `boolean`  | **Opt-in (Node only).** Restrict local file reads to files inside `baseUrl` (symlinks resolved). `../` escapes are refused, and with no `baseUrl` no local file is read at all |

```ts
await render({
  value: untrustedHtml,
  width: 1200,
  baseUrl: "/srv/assets",
  limits: {
    timeoutMs: 10_000,
    maxResourceCount: 20,
    maxTotalResourceBytes: 10_000_000,
    allowedProtocols: ["https:"],
    confineFilesToBaseUrl: true,
  },
});
```

Fetched resources are cached in-process (up to 256 entries / 64 MiB, least-recently-used eviction, remote entries keyed per User-Agent). Call `clearResourceCache()` if the source files changed.

### PDF Metadata & Page Layout

| Option | Type | Default | Description |
| ------ | ---- | :-----: | ----------- |
| `pdfTitle` | `string` | - | PDF document title |
| `pdfAuthor` | `string` | - | Author name |
| `pdfSubject` | `string` | - | Document subject |
| `pdfKeywords` | `string` | - | Keywords |
| `pdfCreator` | `string` | - | Generating application |
| `pdfProducer` | `string` | - | PDF conversion engine |
| `pdfOutline` | `boolean` | `true` | Generate PDF bookmarks (outline) from `h1`–`h6`. Pass `false` to disable |
| `pdfMargin` | `{ top?: number, right?: number, bottom?: number, left?: number }` | - | Page margin settings (in px or pt) |
| `pdfHeader` | `string` | - | HTML header template for each page (`{{pageNumber}}`, `{{totalPages}}` supported) |
| `pdfFooter` | `string` | - | HTML footer template for each page (`{{pageNumber}}`, `{{totalPages}}` supported) |
| `pdfBackground` | `string` | - | Background of the whole PDF page, margins included (`#rrggbb` or `#rrggbbaa`). Without it the document's `background` covers only the content area, so a dark page shows white margins |
| `pdfSkipRunning` | `number` | `0` | How many leading pages are printed without header and footer (a cover, a contents page) |
