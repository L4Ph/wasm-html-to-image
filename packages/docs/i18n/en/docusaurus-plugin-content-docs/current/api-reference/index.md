---
sidebar_position: 1
title: API Overview
---

# API Overview

`wasm-html-to-image` provides versatile interfaces ranging from zero-config functions to low-level controls and parallel worker pools.

## Main Entry Points

| Path                            | Functions / Classes                                       | Use Case                                               |
| ------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `wasm-html-to-image/single`     | `render(options)`                                         | Embedded single WASM. Simplest zero-config entry point |
| `wasm-html-to-image`            | `loadHtmlToImageModule()`<br/>`htmlToImage(mod, options)` | High throughput via reusable module instance           |
| `wasm-html-to-image/workerd`    | `render(options)`                                         | Cloudflare Workers optimized binding                   |
| `wasm-html-to-image/edge-light` | `render(options, wasm)`                                   | Vercel Edge Runtime binding (caller supplies a pre-compiled `WebAssembly.Module` as 2nd arg) |
| `wasm-html-to-image/workers`    | `createHtmlToImageWorker()`<br/>`render(options)`         | Multi-threaded worker pool                             |
| `wasm-html-to-image/react`      | `render(options)`                                         | Wrapper for React JSX elements                         |
| `wasm-html-to-image/preact`     | `render(options)`                                         | Wrapper for Preact JSX elements                        |
| `wasm-html-to-image/tailwind`   | `createCSS(html, { css })` / `tailwind(html, { css })` / `convertTw(html)` | Tailwind v4 utilities as CSS (`tw` → `class`, `@theme` → `:root` variables, `@apply` expansion)                       |
| `wasm-html-to-image/markdown`   | `markdownToHtml(md, options)`<br/>`markdownToDocument(md, options)`<br/>`listTemplates()` | GitHub-flavoured Markdown to styled HTML / PDF documents (templates, TOC, cover, pagination) |
| `wasm-html-to-image/single`, `/workers` | `renderMermaid(source, options)` | A Mermaid diagram alone as an SVG string or an image ([Mermaid Conversion](./mermaid.md)) |
| `wasm-html-to-image/markdown-math` | `katexMath(options)`<br/>`katexCss(fontBase?)` | KaTeX renderer for inline `$…$` and display `$$…$$` math in Markdown |
| `wasm-html-to-image/javascript` | `applyJavaScript(options)`<br/>`runPageScriptsQuickJS(source, option)` | Run a page's scripts in QuickJS (WebAssembly) on linkedom, for Workers and other runtimes without `eval` (the QuickJS wasm is chosen for the runtime automatically) |

---

## Basic Type Definitions

```typescript
export type ImageFormat =
  | "png"
  | "jpeg"
  | "webp"
  | "avif"
  | "jxl"
  | "raw"
  | "thumbhash"
  | "svg"
  | "pdf";

export type RenderInput =
  | string // HTML string, URL, or Data URL
  | string[] // Array of HTML strings (for multi-page PDF)
  | Uint8Array // Image binary buffer
  | ArrayBuffer;

export interface RenderResult<T = Uint8Array | string> {
  data: T;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  format?: ImageFormat;
  isAnimated?: boolean;
}
```
