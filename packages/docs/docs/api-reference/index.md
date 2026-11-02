---
sidebar_position: 1
title: API 概要
---

# API 概要

`wasm-html-to-image` は、初心者向けのゼロコンフィグ関数から、高スループットサーバー向けの詳細制御、ワーカー並列化まで、目的に応じた柔軟なインターフェースを提供します。

## 主要 API エントリーポイント

| パス                            | 関数 / クラス                                             | 主な用途                                                                          |
| ------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `wasm-html-to-image`            | `render(options)`                                         | ユニバーサル標準エントリー（Cloudflare では `workerd`、他は `single` を自動解決） |
| `wasm-html-to-image/single`     | `render(options)`                                         | 単一 WASM 内包エントリーポイント                                                  |
| `wasm-html-to-image/index`      | `loadHtmlToImageModule()`<br/>`htmlToImage(mod, options)` | WASM モジュールインスタンスを明示的に保持・再利用する低レイヤ版                   |
| `wasm-html-to-image/workerd`    | `render(options)`                                         | Cloudflare Workers 環境専用に最適化されたレンダラー                               |
| `wasm-html-to-image/edge-light` | `render(options, wasm)`                                   | Vercel Edge Runtime 等のエッジ向けレンダラー（呼び出し側が `WebAssembly.Module` を用意して第2引数で渡す） |
| `wasm-html-to-image/workers`    | `createHtmlToImageWorker()`<br/>`render(options)`         | マルチスレッド Worker プールによる並列処理版                                      |
| `wasm-html-to-image/react`      | `render(options)`                                         | React JSX エレメントを直接渡して描画するラッパー                                  |
| `wasm-html-to-image/preact`     | `render(options)`                                         | Preact JSX エレメントを直接渡して描画するラッパー                                 |
| `wasm-html-to-image/tailwind`   | `createCSS(html, { css })` / `tailwind(html, { css })` / `convertTw(html)` | Tailwind v4 のユーティリティ CSS を生成（`tw` prop → `class`、`@theme` → `:root` 変数、`@apply` 展開） |
| `wasm-html-to-image/markdown`   | `markdownToHtml(md, options)`<br/>`markdownToDocument(md, options)`<br/>`listTemplates()` | GitHub 形式 Markdown を装飾済み HTML / PDF 用ドキュメントに変換（テンプレート、目次、表紙、改ページ最適化） |
| `wasm-html-to-image/single`、`/workers` | `renderMermaid(source, options)` | Mermaid の図だけを SVG 文字列や画像として取得（[Mermaid 変換](./mermaid.md)） |
| `wasm-html-to-image/markdown-math` | `katexMath(options)`<br/>`katexCss(fontBase?)` | Markdown 内のインライン `$…$` およびブロック `$$…$$` 数式を KaTeX でレンダリング |
| `wasm-html-to-image/javascript` | `applyJavaScript(options)`<br/>`runPageScriptsQuickJS(source, option)` | ページのスクリプトを QuickJS（WebAssembly）と linkedom で実行する（Workers など `eval` できない環境向け。QuickJS の wasm は実行環境に合わせて自動で選びます） |

---

## 基本的な型定義

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
  | string // HTML文字列、またはURL、またはDataURL
  | string[] // HTML文字列の配列（複数ページPDF用）
  | Uint8Array // 画像バイナリバッファ
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
