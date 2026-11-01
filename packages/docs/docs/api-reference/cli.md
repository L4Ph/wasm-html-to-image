---
sidebar_position: 6
title: CLI ツール
---

# コマンドラインツール (CLI)

`wasm-html-to-image` は、ターミナルから直接 HTML や画像を高速に変換できるコマンドラインインターフェース（CLI）を提供します。

`npx` で即座に実行できるほか、グローバルインストールやスクリプト内での利用が可能です。

## 基本的な構文

```bash
npx wasm-html-to-image <input> [options]
```

`<input>` には、ローカルの HTML ファイルパス、画像ファイルパス、または Web URL を指定できます。

---

## オプション一覧

| オプション           | 短縮形 |    既定値     | 説明                                                                       |
| -------------------- | :----: | :-----------: | -------------------------------------------------------------------------- |
| `--output <path>`    |  `-o`  |  入力名準拠   | 出力先ファイルパス                                                         |
| `--width <number>`   |  `-w`  |     `800`     | ビューポート幅（px）                                                       |
| `--height <number>`  |  `-h`  | 自動 (`auto`) | ビューポート高さ（px）                                                     |
| `--format <format>`  |  `-f`  |     `png`     | 出力形式 (`svg`, `png`, `pdf`, `jpeg`, `webp`, `apng`, `gif`, `tiff`, `avif`, `jxl`, `raw`, `thumbhash`) |
| `--scale <n>` | - | `1` | HTML 入力のラスタ出力の画素密度（例: `3.125` で 800px のレイアウトを 2500px に） |
| `--dpi <n>` | - | `96 × scale` | `tiff` に書き込む解像度（ppi） |
| `--color-space <srgb\|cmyk>` | - | `srgb` | `tiff` / `pdf` の出力色空間。`cmyk` は印刷用（ICC プロファイルなしのデバイス変換） |
| `--quality <number>` |  `-q`  |     `85`      | 圧縮品質 (0〜100、エンコード形式のみ有効)                                  |
| `--base-url <url>`   |   -    | 入力から自動  | 相対リソース解決のベース URL。URL 入力ではリダイレクト後の URL、ファイル入力ではそのディレクトリが既定。明示指定時はそれを優先 |
| `--animation <duration-ms>` | - | 無効 | `@keyframes` の **opacity / transform / color / background-color** アニメーションをサンプリングしてアニメーション WebP / APNG / GIF を出力（1 ループの長さを ms で指定、`webp` / `apng` / `gif` 出力時のみ有効。5000ms にクランプ。CSS の `animation-duration` が優先され、この値は上限クランプ） |
| `--animation-fps <n>` | - | `15` | アニメーションのサンプリング fps（`--animation` 指定時に有効。上限約 75 フレーム） |
| `--animation-loop <n>` | - | `0`（無限） | アニメーション WebP / APNG / GIF の再生回数（`0` = 無限、`1` = 1 回だけ。`--animation` 指定時に有効） |
| `--markdown` | - | 自動判別 | 入力を Markdown として処理（`.md` / `.markdown` 拡張子のファイル入力時は自動で有効） |
| `--template <name\|file>` | - | `default` | ドキュメントのテンプレート指定（組み込みの `default`, `report`, `proposal`, `book`, `paper`, `compact`、または `.json` / `.css` ファイル） |
| `--list-templates` | - | - | 利用可能なテンプレート一覧を表示して終了 |
| `--page-size <size>` | - | テンプレート依存 | ページサイズ（`A3`, `A4`, `A5`, `B4`, `B5`, `Letter`、または `"210mm 297mm"` のような 2 つの長さ） |
| `--accent <color>` | - | テンプレート依存 | リンク、見出し、表紙などのアクセントカラー（例: `"#c2410c"`） |
| `--body-font <family>` | - | テンプレート依存 | 本文のフォントファミリー |
| `--stamp <text>` | - | なし | 全ページのヘッダーに印刷するテキスト（`DRAFT`, `Confidential` 等） |
| `--cover` / `--no-cover` | - | テンプレート依存 | 表紙ページの生成を強制有効化 / 無効化 |
| `--no-toc` | - | - | 目次（Table of Contents）ページの出力を無効化（PDF 出力時は既定で有効） |
| `--toc-depth <n>` | - | `3` | 目次に含める見出しの最大深度（1〜6） |
| `--no-outline` | - | - | PDF ブックマーク（アウトライン）の生成を無効化（既定で有効） |
| `--no-math` | - | - | KaTeX 数式処理を無効化（`katex` がインストールされている場合は既定で有効） |
| `--markdown-theme <light\|dark>` | - | `light` | Markdown スタイルシートのカラーテーマ |
| `--markdown-css <path>` | - | なし | 組み込みスタイルの後に追加適用する CSS ファイル |
| `--mermaid` | - | `.mmd` / `.mermaid` なら自動 | 入力を Mermaid の図として扱う（インラインの文字列や標準入力には必要） |
| `--mermaid-theme <name>` | - | `light` | 図の配色（`light`、`dark`、`neutral`、`forest`、`nord`、`dracula`、`solarized-light`、`solarized-dark`、`rose-pine`、`sepia`） |
| `--mermaid-mode <mode>` | - | `strict` | 壊れたソースの許容度: `strict`、`compat`、`recover` |
| `--mermaid-directives` | - | 無効 | 本文の `%%{init}%%` と frontmatter の `config:` を反映 |
| `--font <path>` | - | なし | ローカルのフォントファイルまたは glob（例: `'./fonts/*.woff2'`）。何度でも指定できる。`'Family=path'` は、そのファミリー名で登録する（例: `'Segoe UI=C:/Windows/Fonts/segoeui.ttf'`）。同じファミリーを太さごとに繰り返すと、`font-weight` に最も近いファイルが使われる |
| `--js` | - | 無効 | 描画の前に、ページのスクリプトを jsdom で実行する（任意依存の `jsdom` が要る。信頼できるページだけに使う） |
| `--js-wait <ms\|selector>` | - | `1000` | `--js` と一緒に使う。`load` の後に待つミリ秒、または出現を待つ CSS セレクタ |

---

## 使用例

### 1. ローカル HTML を WebP に変換

```bash
npx wasm-html-to-image template.html -o card.webp -w 1200 -h 630 -f webp -q 90
```

### 2. URL からスクリーンショット (PNG) を生成

```bash
npx wasm-html-to-image https://example.com -o site.png -w 1280 -h 720
```

### 3. 画像ファイルを AVIF に圧縮・リサイズ

```bash
npx wasm-html-to-image banner.png -o banner.avif -w 800 -f avif -q 80
```

### 4. HTML から PDF を作成

```bash
npx wasm-html-to-image invoice.html -o invoice.pdf -w 800 -f pdf
```

### 5. Markdown から PDF ドキュメントを作成

`.md` ファイルを指定して出力先を `.pdf` にすると、自動的に改ページや余白が最適化された PDF が生成されます（目次および PDF ブックマークも既定で自動作成されます）。

```bash
npx wasm-html-to-image report.md -o report.pdf
```

### 6. テンプレート・アクセントカラー・スタンプを指定して Markdown レポートを作成

ビジネスレポート向けの `report` テンプレートを適用し、アクセントカラーと透かしスタンプを設定：

```bash
npx wasm-html-to-image report.md -o report.pdf --template report --accent "#c2410c" --stamp DRAFT
```

書籍スタイルで A5 サイズ・目次オフで出力する場合：

```bash
npx wasm-html-to-image book.md -o book.pdf --template book --page-size A5 --no-toc
```

利用可能なテンプレート一覧の確認：

```bash
npx wasm-html-to-image --list-templates
```

### 7. HTML の opacity / transform / color アニメーションをアニメーション WebP に変換

```bash
npx wasm-html-to-image loader.html -o loader.webp -f webp --animation 2000 --animation-fps 20
```

### 8. アニメーション WebP を 1 回だけ再生する

```bash
npx wasm-html-to-image loader.html -o loader.webp -f webp --animation 2000 --animation-loop 1
```
