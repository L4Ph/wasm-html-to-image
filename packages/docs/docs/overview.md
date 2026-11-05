---
sidebar_position: 1
title: 概要
---

# wasm-html-to-image の概要

**wasm-html-to-image** は、HTML 描画エンジン（Satoru）と画像変換・最適化エンジン（wasm-image-optimization）を 1 つの WebAssembly (Emscripten) モジュールに統合した、超高速・自己完結型の画像生成・変換ライブラリです。

Chromium や Puppeteer、Playwright などの重厚なヘッドレスブラウザを一切必要とせず、サーバーサイド、Cloudflare Workers 等のエッジ環境、ブラウザ、CLI など多様な環境でポータブルに動作します。

```mermaid
graph LR
    HTML["HTML / URL / React"] --> Engine["wasm-html-to-image <br/> 単一 Skia-WASM エンジン"]
    Img["画像バイト列 / DataURL"] --> Engine
    Engine --> Output["PNG / JPEG / WebP / AVIF <br/> RAW / ThumbHash / SVG / PDF"]
```

## 主な特徴

- **単一 WASM モジュール統合**: HTML のパース・CSS レイアウト・Skia 描画・画像エンコード（WebP/AVIF/JPEG等）を単一バイナリ内で実行。中間データを JS とやり取りするオーバーヘッドをゼロに。
- **多彩な入力**: HTML 文字列、HTML 文字列配列（複数ページ PDF 用）、Markdown、URL（Web ページ直接描画）、各種画像バッファ（PNG, JPEG, WebP, GIF, AVIF, BMP, Data URL）に対応。
- **多彩な出力フォーマット**: SVG（ベクター）、PNG、JPEG、WebP、AVIF、RAW ピクセル、ThumbHash、複数ページ対応 PDF を標準サポート。
- **Zero-Config `render()`**: `wasm-html-to-image` のルートインポートにより、事前の WASM ロード設定や初期化不要で即座に実行可能（Cloudflare Workers では自動的に `workerd` 実装へ切り替わります）。
- **Edge・Cloudflare Workers 最適化**: 自動判別に加え、明示的な `wasm-html-to-image/workerd` および `edge-light` サブパスにより、エッジ環境の制限に完全適合。
- **並列 Worker プール**: `wasm-html-to-image/workers` によるマルチスレッド処理で、大量のリクエストやバッチ処理を高速並行実行。
- **リッチなエコシステム**: React / Preact JSX コンポーネント描画、UnoCSS ベースの Tailwind ユーティリティ、さらに Markdown からの画像・美しい PDF 帳票生成（テンプレート、自動目次、ブックマーク、KaTeX 数式対応）を標準サポート。

---

## クイックスタート

### インストール

```bash npm2yarn
npm install wasm-html-to-image
```

### 1. 最もシンプルな使い方

`wasm-html-to-image` をインポートすると、WASM モジュールが自動解決され、手動でのロード処理を書かずに直接 `render()` を呼び出すことができます。

```typescript
import { render } from "wasm-html-to-image";

// HTML から PNG を生成 (戻り値は RenderResult)
const res = await render({
  value: `<div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 40px; color: white; border-radius: 16px; font-family: sans-serif;">
    <h1 style="margin: 0; font-size: 32px;">Hello wasm-html-to-image</h1>
    <p style="margin-top: 8px; opacity: 0.9;">High-performance serverless rendering</p>
  </div>`,
  width: 800,
  format: "png",
});

console.log(res.data); // Uint8Array
console.log(res.width, res.height); // 800, 600

// 2. 画像から画像へのフォーマット変換・圧縮・リサイズも同じ render() 関数で実行可能
const webp = await render({
  value: res.data, // 画像バイト列 (Uint8Array / Buffer) を直接渡す
  width: 400, // リサイズ後の幅
  format: "webp",
  quality: 80,
});

console.log(webp.originalWidth, webp.originalHeight); // 元画像サイズ: 800, 600
console.log(webp.width, webp.height); // 出力画像サイズ: 400, ...
```

---

## 🖼️ 画像から画像へのフォーマット変換 (Image-to-Image)

**wasm-html-to-image** は HTML からの画像生成だけでなく、既存の画像ファイルを直接入力として受け取り、高速に**フォーマット変換・リサイズ・品質圧縮・ThumbHash 生成**を行う画像処理エンジンとしても動作します。

```mermaid
graph LR
    InputImg[入力画像 <br/> PNG / JPEG / WebP / GIF / AVIF / BMP] --> AutoDetect{マジックバイト自動認識}
    AutoDetect --> FastPath[高速画像処理パイプライン <br/> (HTML描画段スキップ)]
    FastPath --> OutputImg[出力画像 <br/> WebP / AVIF / JPEG / PNG / ThumbHash / SVG / PDF]
```

### 特徴

- **自動入力判定 (`isImageInput`)**: バイト列先頭のマジックバイト（PNG, JPEG, WebP, GIF, AVIF, BMP）や `data:image/...` プレフィックスを自動検知。
- **ゼロオーバーヘッド**: 画像入力時は HTML/CSS レイアウト段を完全にスキップし、Skia の高速ネイティブデコーダから直接画像変換パイプラインへ直行します。
- **多彩な出力**:
  - **次世代形式への圧縮**: 巨大な PNG や JPEG を WebP や AVIF に高圧縮
  - **リサイズ & フィット**: `width`, `height`, `fit` (`contain` / `cover` / `fill`), `crop` オプションをサポート
  - **SVG 化**: 画像を埋め込んだベクター SVG マークアップを出力
  - **PDF 化**: 画像を等倍配置した 1 ページ PDF ドキュメントを出力
  - **ThumbHash 生成**: プレースホルダー用の超軽量ハッシュバイト列を直接算出

### コード例: 画像変換

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image";

// JPEG 画像ファイルを読み込み
const jpegBuffer = await fs.readFile("photo.jpg");

// 1. JPEG -> AVIF にリサイズ＆圧縮
const avif = await render({
  value: jpegBuffer,
  width: 800,
  format: "avif",
  quality: 75,
  speed: 6,
});

// 2. JPEG -> プレースホルダー用 ThumbHash
const thumbhash = await render({
  value: jpegBuffer,
  width: 100,
  format: "thumbhash",
});

// 3. JPEG -> 1ページ PDF
const pdf = await render({
  value: jpegBuffer,
  format: "pdf",
});
```

### 2. インスタンスの明示的構築 (`/index`)

サーバー起動時などに WASM モジュールを一度だけ手動で初期化し、再利用することで最大のスループットを発揮します。

```typescript
import { loadHtmlToImageModule, htmlToImage } from "wasm-html-to-image/index";

// モジュールのロード（プロセス内でキャッシュ可能）
const mod = await loadHtmlToImageModule();

// HTML から WebP を出力
const result = await htmlToImage(mod, {
  value: "<h1>Fast Rendering</h1>",
  width: 1200,
  height: 630,
  format: "webp",
  quality: 85,
});
```

---

## サブパス一覧

用途やランタイム環境に応じて、最適なサブパスを選択できます。

| サブパス                        | 対象環境 / 用途            | 説明                                                                                      |
| ------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `wasm-html-to-image`            | 全環境（標準）             | ゼロコンフィグ標準エントリー（Cloudflare では `workerd`、他環境では `single` を自動解決） |
| `wasm-html-to-image/single`     | Node.js / バンドラ         | 単一WASM内包エントリーポイント                                                            |
| `wasm-html-to-image/index`      | 低レイヤ手動制御           | コア関数 `loadHtmlToImageModule`, `htmlToImage` を提供                                    |
| `wasm-html-to-image/workerd`    | Cloudflare Workers         | WebAssembly.Module インポートに対応した Workers 最適化版                                  |
| `wasm-html-to-image/edge-light` | Vercel Edge / Edge Runtime | Edge Runtime 向け最適化版                                                                 |
| `wasm-html-to-image/workers`    | Node.js / ブラウザ         | Worker スレッド / Web Worker による並列処理プール                                         |
| `wasm-html-to-image/react`      | React 連携                 | React JSX ノードを直接描画するラッパー                                                    |
| `wasm-html-to-image/preact`     | Preact 連携                | Preact JSX ノードを直接描画するラッパー                                                   |
| `wasm-html-to-image/tailwind`   | スタイリング               | UnoCSS / Tailwind v4 のユーティリティ CSS を生成（`tw` prop、`@theme`、`@apply`）                                             |
| `wasm-html-to-image/markdown`   | Markdown 入力              | GitHub 形式 Markdown を装飾済み HTML / PDF 用ドキュメントに変換（`markdownToHtml`, `markdownToDocument`, テンプレート対応） |
| `wasm-html-to-image/single`、`/workers` | Mermaid の図 | `renderMermaid(source, options)` で、図だけを SVG や画像として取得（33 種類の図、テーマ、入力の補正） |
| `wasm-html-to-image/markdown-math` | 数式描画                | Markdown 内の数式（`$…$`, `$$…$$`）を KaTeX でレンダリング（`katexMath`） |

---

## プロジェクト構成

- **`packages/html-to-image`**: 公開 npm パッケージ。TypeScript ファサード、各ランタイム対応、CLI、Worker プール。
- **`examples/cloudflare-ogp`**: Cloudflare Workers で OGP 画像生成を行うサンプルプロジェクト。
- **`examples/deno-ogp`**: Deno Deploy での利用サンプル。
- **`packages/playground`**: ブラウザ上で動作する Web Playground。HTML → 画像 / PDF、画像の最適化、Markdown → PDF（`?mode=markdown`。テンプレート、テーマ、表紙・目次・しおり、数式を、その場で切り替えて PDF を確認できる）、Mermaid（`?mode=mermaid`。全図種のサンプル、テーマ、入力の補正、出力形式を切り替え、ギャラリーで一覧できる）の 4 つのモード。
- **`packages/visual-test`**: 視覚回帰テストスイート。
- **`src/cpp`**: C++ / Skia / litehtml コアエンジンおよび Emscripten バインディング。

---

## 💻 サンプルコード・プロジェクト

実践的なフレームワーク連携やユースケースごとのサンプルコードは、公式サンプルリポジトリで公開されています：

👉 **[wasm-html-to-image-samples (GitHub)](https://github.com/SoraKumo001/wasm-html-to-image-samples)**

- Next.js (App Router / Route Handler)
- Cloudflare Workers / Pages
- Node.js Express / Fastify サーバー
- Deno / Bun ランタイム
- React / Preact / Tailwind 連携
