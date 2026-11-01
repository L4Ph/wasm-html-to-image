---
sidebar_position: 7
title: Markdown 変換 (PDF / 画像)
---

# Markdown 変換 (`/markdown`)

`wasm-html-to-image/markdown` は、GitHub Flavoured Markdown（GFM）を美しくスタイリングされた HTML ページや PDF ドキュメント用データに変換するモジュールです。

純粋な JavaScript で実装されているため、Node.js だけでなくブラウザや Cloudflare Workers 等のエッジ環境でも軽量・高速に動作します。

---

## 主な機能

- **`markdownToDocument()` & `markdownToHtml()`**: Markdown から HTML および PDF 用オプション（ヘッダー、フッター、タイトル等）を生成。
- **テンプレートシステム**: 11 の組み込みテンプレート（`default`, `report`, `proposal`, `book`, `paper`, `compact`, `manual`, `minutes`, `letter`, `slides`, `invoice`）を提供。CSS を書かずにプロ品質のレイアウトが可能。
- **自動目次（TOC）とページ番号連携**: 見出しから目次ページを自動生成。PDF レンダラーと連携して正確な開始ページ番号を自動挿入。
- **PDF ブックマーク（アウトライン）自動生成**: `h1`〜`h6` 見出しから PDF ビューワーの目次ツリー（アウトライン）を自動構築。
- **スマートな改ページ制御**: 見出し直後の孤立改ページ防止（`break-after: avoid`）やコードブロック・表の分断防止。
- **YAML Front Matter**: 文書先頭のメタデータ（タイトル、著者、テンプレート、余白、スタンプ等）を自動解釈。
- **シンタックスハイライト**: highlight.js を内蔵し、20 種類以上の主要言語のコードブロックを色分け表示。
- **Mermaid 図**: ` ```mermaid ` をエンジン内で描画（フローチャート、シーケンス、状態、クラス、ER、ガント、円グラフなど 30 種以上。一覧は [Mermaid 変換](./mermaid.md#6-対応している図)）。
- **KaTeX 数式レンダリング (`/markdown-math`)**: インライン `$…$` およびブロック `$$…$$` 数式を高精度に組版。

---

## 基本的な使い方

### 1. Markdown から PDF を生成

PDF を作成する場合は、`markdownToDocument()` を使用してページ HTML と PDF 用オプション（テンプレートのヘッダー・フッターなど）を取得し、`render()` に渡します。

```typescript
import fs from "node:fs/promises";
import { render } from "wasm-html-to-image";
import { markdownToDocument } from "wasm-html-to-image/markdown";

const md = `---
title: 四半期業績報告書
subtitle: 2026年度 第3四半期
author: 山田 太郎
date: 2026-10-29
template: report
accent: "#2563eb"
stamp: 社内限り
---

# エグゼクティブサマリー

本四半期の売上高は前年同期比 **+15.2%** と堅調に推移しました。

# 主要指標

| 指標 | 目標 | 実績 |
| :--- | :--- | :--- |
| 売上総利益 | 5,000万円 | 5,420万円 |
| 新規顧客数 | 120社 | 135社 |
`;

// HTML と PDF レンダリング用オプションを取得
const { html, renderOptions } = markdownToDocument(md, {
  paged: true, // PDF 向けページ余白・改ページ最適化を有効化
});

const { data } = await render({
  value: html,
  format: "pdf",
  ...renderOptions,
});

await fs.writeFile("report.pdf", Buffer.from(data));
```

### 2. 単一画像（PNG / WebP）として描画

画像として出力する場合は `markdownToHtml()` を使用します。

```typescript
import { render } from "wasm-html-to-image";
import { markdownToHtml } from "wasm-html-to-image/markdown";

const html = markdownToHtml("# ドキュメントタイトル\n\n内容...", {
  theme: "dark",
  maxWidth: 800,
});

const { data } = await render({
  value: html,
  width: 900,
  format: "png",
});
```

### 3. オプション（`MarkdownOptions`）

`markdownToHtml()` と `markdownToDocument()` の第 2 引数です。

| オプション | 型 | 既定値 | 説明 |
| :--- | :--- | :--- | :--- |
| `template` | `string \| MarkdownTemplate` | なし | 組み込みテンプレートの名前、または自作のテンプレート（[カスタムテンプレート](#カスタムテンプレート)）。フロントマターの `template:` より優先 |
| `settings` | `DocumentSettings` | なし | フロントマターより優先する文書設定（`title`、`author`、`accent`、`font`、`page_size`、`cover`、`stamp` など） |
| `theme` | `"light" \| "dark"` | `"light"` | 組み込みスタイルシートの配色 |
| `css` | `string` | なし | 組み込みスタイルシートの後に追加する CSS |
| `stylesheet` | `string` | なし | 組み込みスタイルシートを丸ごと置き換える（`theme` は無視される） |
| `paged` | `boolean` | `false` | PDF 向け。`padding` が全ページの `@page` 余白になり、2 ページ目以降も上下の余白が保たれる |
| `padding` | `number` | `32` | 記事の周りの余白（px） |
| `maxWidth` | `number` | なし | 記事の最大幅（px）。省略すると表示幅いっぱい |
| `title` | `string` | フロントマターの `title` | 文書の `<title>` |
| `toc` | `boolean \| { depth?: number, title?: string }` | PDF（`paged`）では有効 | 目次。`depth` は 1〜6（既定 3）、`title` は目次の見出し（既定 `Contents`、空文字で省略） |
| `highlight` | `boolean` | `true` | 言語名の付いたコードブロックをシンタックスハイライトする |
| `mermaid` | `boolean` | `true` | ` ```mermaid ` を図として描く。`false` で通常のコードブロック |
| `frontMatter` | `boolean` | `true` | 先頭の YAML フロントマターを取り除き、`title` を読む |
| `math` | `MathRenderer` | なし | `$…$` / `$$…$$` の数式を組版する。`wasm-html-to-image/markdown-math` の `katexMath()` を渡す。なければ `$` は普通の文字（[KaTeX](#katex-数式組版-markdown-math)） |

`markdownToDocument()` は `{ html, settings, renderOptions }` を返します。`settings` は実際に適用された設定（テンプレートの既定値 < フロントマター < オプション）、`renderOptions` は `render()` に展開して渡す PDF 用オプション（ヘッダー、フッター、`pdfTitle`、`pdfAuthor`、`pdfBackground`、`pdfSkipRunning`）です。`markdownStylesheet()` は組み込みスタイルシートの CSS だけを返します。

---

## 組み込みテンプレート

テンプレートを指定することで、文書全体のタイポグラフィ、ページサイズ、余白、ヘッダー/フッター、表紙・目次の有無を一括設定できます。すべてのテンプレートはライト・ダークの両テーマに対応しています。

| テンプレート名 | 主な用途 | 特徴・レイアウト |
| :--- | :--- | :--- |
| `default` | Web 画像・クイック PDF | GitHub 風のクリーンなスタイル |
| `report` | ビジネスレポート・仕様書 | A4、表紙、目次、アクセントカラー適用、ヘッダーにタイトル、フッターに著者とページ番号（`n / N`） |
| `proposal` | 提案書・見積書 | A4、表紙、セクション見出しにアクセントバー、表ヘッダーをアクセント色で塗り、引用を強調ボックス化、フッターにタイトルとページ番号 |
| `book` | 書籍・長文ドキュメント | A5、明朝/ローマン（serif）、両端揃え、各章（`h1`）ごとに改ページ、表紙、目次、フッターにページ番号 |
| `paper` | 論文・学術・技術ノート | A4、serif、両端揃え、引き締まった行送り、フッターにページ番号 |
| `compact` | チートシート・メモ | 12px 文字、12mm 余白、表紙・目次なし |
| `manual` | マニュアル・仕様書 | A4、表紙、目次、見出し番号、章（`h1`）ごとに改ページ、注意書き、ヘッダーに題名、フッターにページ番号 |
| `minutes` | 議事録 | A4、表紙・目次なし、題名に太い罫線、表ヘッダーに薄い塗り、ヘッダーに題名と日付 |
| `letter` | 書簡・通知文 | A4、serif、広い余白、行送りゆったり、`.right` と `.center` クラスで宛名や日付を寄せる |
| `slides` | 発表資料 | A4 横、28px の大きな文字、`h2` ごとに 1 ページ、`---` は無視、表紙つき |
| `invoice` | 請求書・見積書 | A4、右寄せの大きな題名、アクセント色の表ヘッダー、最終行を強調、注意書きの枠 |

利用可能なテンプレートは `listTemplates()` で取得できます：

```typescript
import { listTemplates } from "wasm-html-to-image/markdown";

console.log(listTemplates());
```

---

## YAML Front Matter（フロントマター）

文書の先頭に `---` で囲まれたブロックを置くことで、ドキュメントの設定を記述できます。

```markdown
---
title: 製品仕様書<br>バージョン 2.0
subtitle: 次世代画像処理コア
author: 開発チーム
date: 2026-10-29
template: report
accent: "#059669"
font: sans-serif
page_size: A4
stamp: DRAFT
cover: true
toc: true
logo: https://example.com/logo.png
lang: ja
---
```

### 設定項目の優先順位

設定値は以下の順序でマージされ、後ろのものが優先されます：
1. テンプレートの既定値（`template.defaults`）
2. Front Matter の記述
3. API オプション（`options.settings` や `options.title` 等）

---

### ページと表紙の設定

フロントマターでは、次の項目もページの体裁を変えます。

| キー | 値 | 内容 |
| :--- | :--- | :--- |
| `header` / `footer` | HTML | 実行ヘッダー・フッター（テンプレートのものを置き換え）。`{{title}}`、`{{author}}`、`{{date}}`、`{{stamp}}`、`{{pageNumber}}`、`{{totalPages}}`、`{{chapter}}`（そのページにある `h1` の題名。ページに見出しが無いときは、直前の章）が使えます。`book` のヘッダーは章の題名を出します |
| `margin` | `20mm 18mm` | ページの余白（CSS の `margin`） |
| `orientation` | `landscape` | 用紙を横向きにする |
| `toc_depth` | `1`〜`6` | 目次に載せる見出しの深さ |
| `toc_title` | 文字列 | 目次ページの見出し（既定は `Contents`） |
| `cover_style` | `band` / `plain` / `center` | 表紙の体裁 |
| `numbering` | `true` | 見出しに `1`、`1.1`、`1.1.1` の番号を付ける |
| `footnotes` | `end` | 脚注の置き場所。`end` は本文のあとに一覧、`page` は参照のあるページの下部（PDF 用。1 件がページの 3 分の 1 より高いと `end` に戻る） |
| `mermaid_theme` | 名前（`nord` など） | 図の配色を名前付きテーマにする（文書のライト・ダークの色ではなく、テーマの色になる。ダークな文書には `dracula`、`nord`、`dark` などが合う） |
| `mermaid_mode` | `compat` / `recover` | 壊れた図の許容度 |
| `mermaid_directives` | `true` | 図の中の `%%{init}%%` と frontmatter を反映する |

表紙のあるテンプレートでは、表紙にヘッダーとフッターを出しません（ページ番号の数え方は変わらず、表紙が 1 ページ目です）。

## 記法の拡張

- **注意書き**: `> [!NOTE]`、`> [!TIP]`、`> [!IMPORTANT]`、`> [!WARNING]`、`> [!CAUTION]` で始まる引用は、色付きの箱になります（`lang: ja` なら題名は日本語）。
- **図の番号**: `![説明](画像 "題名")` のように題名を付けた画像は、`図 1　題名` の説明文付きの図になります。
- **改ページ**: `<!-- pagebreak -->` の位置で改ページします。
- **脚注**: 文中の `[^名前]` と、どこかの `[^名前]: 本文` で、文書の最後に脚注の一覧を出します（番号は初めて使った順）。
- **表**: `report`、`proposal`、`book`、`paper` では、表が本文の幅いっぱいに広がります。
- **長いコード行**: 行は右端で折り返します（切れません）。

## 目次（TOC）と PDF ブックマーク

`paged: true`（または CLI の PDF 出力）を指定すると、見出しから目次ページと PDF ビューワー用ブックマーク（アウトライン）が既定で自動生成されます。

- **目次ページ**: 見出し（既定ではレベル 3 まで）が一覧表示され、PDF レンダラーによって実際の配置先ページ番号が自動で計算・表示されます。各項目はクリック可能なリンクになります。
- **PDF ブックマーク**: PDF リーダーの目次ツリーとして階層的に展開されます。
- **ページ内リンク**: Markdown 内の `[詳細はこちら](#setup)` といったリンクも PDF 内でクリック遷移できます。

```typescript
// 目次の階層深度やタイトルをカスタマイズ
const { html, renderOptions } = markdownToDocument(md, {
  paged: true,
  toc: { depth: 2, title: "目次" },
});

// 目次ページを出力しない場合
const { html, renderOptions } = markdownToDocument(md, {
  paged: true,
  toc: false,
});

// PDF ブックマーク（アウトライン）をオフにする場合
await render({
  value: html,
  format: "pdf",
  pdfOutline: false,
  ...renderOptions,
});
```

---

## Mermaid 図

` ```mermaid ` のコードブロックは、エンジンが自前でベクター描画します（ブラウザや外部ライブラリは不要で、PDF でも文字が選択できるベクターのままです）。

````markdown
```mermaid
graph LR
  A[受注] --> B{在庫あり?}
  B -->|はい| C[出荷]
  B -->|いいえ| D[発注]
```
````

| 図 | 書き出し |
| :--- | :--- |
| フローチャート | `graph` / `flowchart` |
| シーケンス図 | `sequenceDiagram` |
| 状態遷移図 | `stateDiagram-v2` |
| クラス図 | `classDiagram` |
| ER 図 | `erDiagram` |
| 棒・折れ線グラフ | `xychart-beta` |
| 円グラフ | `pie` |
| ガントチャート | `gantt` |
| マインドマップ | `mindmap` |
| タイムライン | `timeline` |
| ユーザージャーニー | `journey` |
| 四象限チャート | `quadrantChart` |
| Git グラフ | `gitGraph` |
| カンバン | `kanban` |
| パケット図 | `packet-beta` |
| サンキー図 | `sankey-beta` |
| 要求図 | `requirementDiagram` |
| ブロック図 | `block-beta`（入れ子のブロックは未対応） |
| C4 図 | `C4Context` / `C4Container` / `C4Component` / `C4Dynamic` / `C4Deployment` |
| アーキテクチャ図 | `architecture-beta` |
| ベン図 | `venn-beta` |
| 特性要因図（フィッシュボーン） | `ishikawa-beta` |
| ツリー表示 | `treeView-beta` |
| ツリーマップ | `treemap-beta` |
| レーダーチャート | `radar-beta` |
| バージョン表示 | `info` |

- 色はテーマ（`light` / `dark`）に合わせて自動で決まります。
- 図はページをまたいで分断されません。
- `accTitle: 題名` と `accDescr: 説明`（複数行は `accDescr { ... }`）は、図には描かず、SVG の `<title>` と `<desc>` として出力します。スクリーンリーダーなどが読み上げます。
- `mermaid: false` を渡すと、通常のコードブロックとして表示します。
- 未対応の図種（`zenuml` など）や構文エラーは、図の位置にエラー枠が表示されます。

### JavaScript から SVG・画像として取得する

図だけを SVG 文字列や画像として取り出す `renderMermaid()`、テーマ、入力の補正、CSS からの指定は、[Mermaid 変換](./mermaid.md) にまとめています。

## KaTeX 数式組版 (`/markdown-math`)

`wasm-html-to-image/markdown-math` サブパスの `katexMath()` を渡すことで、インライン `$…$` およびディスプレイ `$$…$$` の TeX 数式を描画できます。

```typescript
import { render } from "wasm-html-to-image";
import { markdownToHtml } from "wasm-html-to-image/markdown";
import { katexMath } from "wasm-html-to-image/markdown-math";

const md = `
オイラーの等式: $e^{i\\pi} + 1 = 0$

解の公式:
$$
x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
$$
`;

const html = markdownToHtml(md, {
  math: katexMath(), // { fontBase: "https://your-host/katex/fonts" } でフォント自前配信も可能
});
```

- 価格表記（`$5 and $10`）やコードブロック内の `$` は数式として誤判定されません。
- 構文エラーの TeX があっても描画全体は失敗せず、ソース文字列とエラー内容が表示されます。
- 純粋な JavaScript・CSS で構成されているため、ブラウザや Cloudflare Workers でも外部バイナリなしで動作します。

---

## カスタムテンプレート

独自の JSON またはオブジェクトを渡してテンプレートを定義できます：

```typescript
const myTemplate = {
  type: {
    font: "serif",
    size: 14,
    lineHeight: 1.7,
    justify: true,
    chapterBreak: true,
  },
  page: {
    size: "B5",
    margin: "18mm",
    footer: `<div style="text-align:center;font-size:10px">{{pageNumber}} / {{totalPages}}</div>`,
  },
  defaults: {
    cover: true,
    toc: true,
    accent: "#0f766e",
  },
};

const doc = markdownToDocument(md, { template: myTemplate, paged: true });
```

### 組み込みテンプレートを土台にする（`extends`）

`extends` に組み込みテンプレートの名前を書くと、その `type`、`page`、`defaults` を項目ごとに上書きできます。`css` は土台のものの後ろに足されます。`defineTemplate()` は型を確認するだけで、値はそのまま返します。

```typescript
import { defineTemplate, markdownToDocument } from "wasm-html-to-image/markdown";

const mine = defineTemplate({
  extends: "report",
  type: { size: 13 },
  defaults: { accent: "#0f766e" },
  css: ".markdown-body h2 { border-bottom-style: dashed; }",
});

const doc = markdownToDocument(md, { template: mine, paged: true });
```

CLI では、JSON ファイルに `{ "extends": "report", "defaults": { "accent": "#0f766e" } }` と書いて `--template mine.json` で渡せます。

### 色は CSS 変数で書く

テンプレートの `css` では、色を直書きせず、`var(--surface)`、`var(--border)`、`var(--muted)`、`var(--text)`、`var(--accent)` を使ってください。ライトとダークのどちらのテーマでも、配色が追従します。
