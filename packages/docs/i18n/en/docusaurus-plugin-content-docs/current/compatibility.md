---
sidebar_position: 3
title: Compatibility & Specifications
---

# Compatibility & Specifications

Supported input types, output formats, CSS properties, and runtime environments.

## 1. Format Matrix

### Inputs (`value`)

| Input                 | Detection                 | Description                                                |
| --------------------- | ------------------------- | ---------------------------------------------------------- |
| **HTML String**       | Text string with tags     | Regular HTML/CSS rendering                                 |
| **HTML String Array** | `string[]`                | Multi-page PDF generation                                  |
| **URL**               | `http://` or `https://`   | Auto-fetches and renders remote HTML                       |
| **Image Buffer**      | `Uint8Array` / `Buffer`   | Magic-byte recognition for PNG, JPEG, WebP, GIF, AVIF, JPEG XL, BMP |
| **Data URL**          | `data:image/*;base64,...` | Bypasses HTML path, routed to image optimization pipeline  |

### Outputs (`format`)

| Format      | Return Type  | From HTML                                      | From Image                    |
| ----------- | ------------ | ---------------------------------------------- | ----------------------------- |
| `png`       | `Uint8Array` | Skia render → PNG encode                       | Decodes and outputs PNG       |
| `jpeg`      | `Uint8Array` | Skia render → JPEG encode (`quality`)          | Decodes and compresses JPEG   |
| `webp`      | `Uint8Array` | Skia render → WebP encode (`quality`)          | Decodes and compresses WebP   |
| `apng`      | `Uint8Array` | Skia render → PNG (animated with `animation`)  | Decodes and converts to PNG   |
| `gif`       | `Uint8Array` | Skia render → GIF (256 colors, dithered; animated with `animation`) | Decodes and converts to GIF |
| `avif`      | `Uint8Array` | Skia render → AVIF encode (`quality`, `speed`) | Decodes and compresses AVIF   |
| `jxl`       | `Uint8Array` | Skia render → JXL encode (`quality`, `speed`)  | Decodes and compresses JXL (JXL input is decoded with libjxl too, for `<img>` and image inputs) |
| `raw`       | `Uint8Array` | Uncompressed RGBA pixels                       | Uncompressed RGBA pixels      |
| `thumbhash` | `Uint8Array` | Computes ThumbHash from render                 | Computes ThumbHash from image |
| `svg`       | `string`     | Skia vector stream                             | Wraps in `<image>` SVG        |
| `pdf`       | `Uint8Array` | SkPDFDocument vector PDF                       | Single-page centered PDF      |

> `png` output is stored as an indexed (palette) PNG automatically when the image has at most 256 colors (flat UI, diagrams): about a third of the RGBA size with identical pixels. Richer images stay RGBA.
>
> `webp`, `apng` and `gif` produce an animated image when (`apng` without `animation` is a plain PNG; `gif` uses a 256-color dithered palette and composites transparency over white) `animation: { duration, fps, loop }` (CLI: `--animation`) is set. `opacity`, `transform` (`translate` / `rotate` / `scale` only) and `color` / `background-color` `@keyframes` are sampled; the default is 15 fps with caps of 5 s (`duration` is clamped to 5000 ms) / ~75 frames. The repeat count is set with `loop` (CLI: `--animation-loop`) and defaults to `0` (infinite).

---

## 2. CSS & Layout Features

- **Box Model**: Margins, paddings, borders, box-sizing (`border-box`, `content-box`), `aspect-ratio`, and logical properties (`margin-inline`, `padding-block`, etc.).
- **Flexbox**: Multi-pass resolution conforming to W3C Flexbox specs (`flex-direction`, `justify-content`, `align-items`, `flex-wrap`, `gap`, `row-gap`, `column-gap`, etc.).
- **Block & Table Layout**: `overflow: clip` (clips like `hidden`; `overflow-clip-margin` is not supported), `display: flow-root` (contains floats, stops margin collapsing), explicit `display: table-header-group` / `table-footer-group` (placed first / last, repeated in PDF pagination like `<thead>`), `table-caption`, and `<col>` / `<colgroup>` backgrounds.
- **Text Truncation & Stroke**: `max-lines` (standard `-webkit-line-clamp`, implies `overflow: hidden`), `block-ellipsis: auto | no-ellipsis | "<string>"`, `text-fit: grow | shrink [<limit>%]` (rescales the font so the widest line fits; up to 3 relayout passes), and `stroke-linejoin` for `-webkit-text-stroke` (`miter-clip` / `arcs` fall back to `miter`).
- **Line Breaking, Alignment & Hyphenation**: `line-break` (CJK kinsoku strength: `strict` keeps small kana and `ー` off the line start, `loose` lets a line start with iteration marks, `anywhere` breaks anywhere), `text-align-last` (including `justify`), `text-justify` (`none` stops justification, `inter-word` stretches spaces only, `inter-character` / `distribute` also stretch between characters), `tab-size` (number of spaces or a length; tab stops measured from the line start), `hyphens` (`-webkit-hyphens` alias) and `hyphenate-character`. A soft hyphen (`&shy;`) shows a hyphen only when the line breaks there; `hyphens: auto` splits English words (`lang="en*"`) with a heuristic, there is no dictionary. The auto hyphen is `-`.
- **Non-standard properties**: `flex-line-count` (a takumi extension) is not adopted: it is not part of any CSS specification and is ignored (the number of flex lines follows from the content and the container width).
- **Grid Layout**: Grid tracks (`grid-template-columns/rows`, the `grid-template` / `grid` shorthands), item placement (`grid-column/row`), implicit tracks (`grid-auto-columns/rows`), `grid-auto-flow` (`row`, `column`, and `dense` hole filling), `place-items`, `gap`.
- **Typography & Internationalization**: HarfBuzz text shaping, bidirectional text (BiDi), `unicode-bidi` (`bidi-override` / `isolate-override` map to line-item order; `embed` / `isolate` boundaries and per-run glyph reversal are partial), line-breaking for CJK, Latin, Arabic, and Emoji. Vertical text (`writing-mode: vertical-rl`), multi-line truncation (`-webkit-line-clamp` / `max-lines` + `block-ellipsis` / `text-overflow: ellipsis`), `text-transform`, and text stroke (`-webkit-text-stroke`). Fonts for scripts missing from Noto Sans JP (Hangul, Hebrew, Arabic, Thai, Devanagari, Greek) and for color emoji are fetched on demand from external CDNs (Google Fonts / jsDelivr) only when such characters appear.
- **Font Features**: `font-feature-settings`, `font-variant-*` (`-ligatures`, `-numeric`, `-east-asian`, `-caps`, `-position`), `font-kerning`, `font-variation-settings`, `font-stretch`, `font-optical-sizing` (`auto` drives the `opsz` axis from the font size, `none` keeps the default, an explicit `opsz` in `font-variation-settings` always wins), `font-synthesis` (+ longhands; `none` disables synthetic bold / italic, the synthetic small-caps / sub-super variants do not exist in the engine). OpenType features (`palt`, `kern`, `liga`, `pnum`, `zero`, …) are applied through HarfBuzz per element; variable axes (`wght`, `wdth`, …) and stretch keywords/percentages are supported. Synthetic small-caps, synthetic `sub`/`super`, `@font-face` stretch descriptors, and optical sizing are partial or unsupported.
- **Text Decoration**: `text-decoration` (`-line`, `-style`, `-color`, `-thickness`), `text-decoration-skip-ink`, `text-underline-position`, `text-underline-offset`. Solid, dashed, dotted, double, and wavy underlines, overlines, and line-throughs; skip-ink splits the line around glyph ink and also applies to vertical writing. Percentages for `thickness` and `underline-offset` resolve against the element's font size.
- **Visual Effects**: Box shadows (multiple shadows, inset), border-radii (elliptical, individual corners), `box-decoration-break: clone` (PDF page fragments of block boxes get complete borders, corners and background; inline line breaks are unaffected), `corner-shape` (`round` / `scoop` / `bevel` / `notch` / `squircle` / `square` / `superellipse()` plus per-corner longhands; applied to backgrounds, borders, `box-shadow` and clipping), transforms, opacity, filters (`blur`, `drop-shadow`), backdrop filters, blend modes (`mix-blend-mode`, `background-blend-mode`), and `image-rendering` (`pixelated` uses nearest-neighbour sampling for `<img>` and background images, including tiles; `crisp-edges` is unsupported).
- **Motion Path**: `offset-path` (`ray()`, `path()`, basic shapes), `offset-distance`, `offset-rotate`, `offset-anchor`, `offset-position`, and the `offset` shorthand. Position and tangent rotation along the path are supported with Chromium-checked grammar (lengths including `calc()`, coordinate boxes). `url()` references and strict `<coord-box>` handling are unsupported.
- **Clipping & Shapes**: Native Skia vector clipping paths (`circle()`, `ellipse()`, `polygon()`, `path()`, `inset()`, with `clip-rule: evenodd`), and alpha masks (`mask`, `mask-image`, `mask-size`, `mask-repeat`, `mask-position`; images and gradients, tiled).
- **Inline SVG**: Direct embedded `<svg>` rendering with `<path>`, `<rect>`, `<circle>`, `<g>`, `<linearGradient>`, etc. via SkSVGDOM.
- **SVG as an image** (`<img src="x.svg">`, CSS backgrounds, or an SVG passed as the input): `<text>` is drawn with the same fonts as the page (generic families, Japanese, the `fonts` option and `@font-face` inside the SVG). An `<image href>` that points at another URL is fetched and drawn (subject to `resolveResource` and `limits`). An SVG input goes through the page renderer only when it contains `<text>`.
- **Modern CSS**: `calc()`, `light-dark()`, CSS Variables (`var(--name)`), cascade layers (`@layer`), `white-space-collapse`, `text-wrap-mode` / `text-wrap-style` (`white-space-collapse` and `text-wrap-mode` affect collapsing and wrapping; `text-wrap-style: balance` narrows the wrap width while keeping the line count so the lines even out, and `pretty` repairs an orphaned last word. Both apply to horizontal plain-flow text only — up to 6 lines for `balance`, 10 for `pretty`, and never with floats, atomic inlines, forced breaks, vertical writing or shrink-to-fit widths).
- **Selectors & Pseudo-elements**: ID, class, attributes, `:nth-child()`, `:not()`, `:is()`, `:where()`, `:has()`, `::before`, `::after` (`content`).
- **Media & Containers**: `@media screen`, `@media print`, and container queries (`@container`).

---

## 3. Unsupported Features & Limitations (AI Guidelines)

`wasm-html-to-image` is a lightweight static renderer based on **litehtml** and **Skia**, not a headless browser. Keep the following constraints in mind when writing templates:

1. **No JavaScript by default**: `<script>` tags, DOM event listeners, and DOM APIs do not run. The `javascript` option (CLI: `--js`) runs the page's scripts in QuickJS (WebAssembly) on a DOM written in C and renders the resulting DOM (the Node.js `single` entry and the CLI do it for you; on edge entries, use `applyJavaScript()` from `wasm-html-to-image/javascript`). The same engine works where `eval` is not allowed, such as Cloudflare Workers (trusted pages only; see [render() options](./api-reference/render.md)). Scripts that depend on browser-only APIs or layout measurements will not behave as in a browser.
2. **Partial CSS Animation Support**: `transition` is not evaluated. `@keyframes` are ignored by default (only static styles paint), but passing `animation: { duration, fps, loop }` (CLI: `--animation`) samples **`opacity`, `transform` and `color` / `background-color` `@keyframes`** into an animated WebP / APNG / GIF. The repeat count is set with `loop` (CLI: `--animation-loop`, default `0` = infinite). Defaults are 15 fps with caps of 5 s (`duration` is clamped to 5000 ms) / ~75 frames. The CSS `animation-duration` (including the `animation` shorthand, `var()` supported) is the length of one iteration; together with `animation-delay` and `animation-iteration-count` (a number or `infinite`) it defines the sampled timeline (`infinite` samples one iteration, `alternate` / `alternate-reverse` two). The API `duration` is an upper bound on the whole timeline and the API `fps` caps the frame rate. `transform` supports `translate` / `rotate` / `scale` only; when the function list differs between the keyframes the element keeps its static transform. An `animation-timing-function` inside a keyframe block applies to the interval that starts at that stop, and the element-level one (`<style>` or inline) is the default (`linear` / `ease` / `ease-in` / `ease-out` / `ease-in-out` / `cubic-bezier()` / `steps()` / `step-start` / `step-end`; applied to `opacity`, `color` and `transform` interpolation). `animation-direction` (normal / reverse / alternate / alternate-reverse) and `animation-fill-mode` (none / forwards / backwards / both) are honoured, so the value during `animation-delay` (backwards) and after the animation (forwards) is resolved; a negative `animation-delay` starts inside the first iteration. Every `@keyframes` block of the document animates all the elements its rule selects (several allowed); several animations on one element (`animation: a 2s, b 3s` or `animation-name: a, b`) are layered, the later one winning on shared properties; `translateX` / `translateY` are supported too.
3. **NO Canvas Scripting**: `<canvas>` element 2D/WebGL contexts do not execute. Use inline `<svg>` or CSS shapes instead.
4. **NO Interactive States**: `:hover`, `:active`, and `:focus` states do not trigger.
5. **NO Browser Web Storage**: `window`, `document`, `localStorage`, and `IndexedDB` are unavailable.

---

## 4. Runtime Compatibility

- **Node.js (>=20)**: Full support across single, multi-threaded worker pools, and explicit modules.
- **Cloudflare Workers**: Full support via `wasm-html-to-image/workerd`.
- **Vercel Edge Runtime**: Full support via `wasm-html-to-image/edge-light`.
- **Browsers**: Runs client-side or within Web Workers.
- **Deno & Bun**: Fully compatible.
