---
sidebar_position: 3
title: 互換性と仕様
---

# 互換性と対応機能一覧

**wasm-html-to-image** がサポートする入力形式、出力フォーマット、CSS 仕様、および実行環境の対応状況です。

## 1. フォーマット対応マトリクス

### 入力形式 (`value`)

| 形式                | 判定方法                    | 説明                                                            |
| ------------------- | --------------------------- | --------------------------------------------------------------- |
| **HTML 文字列**     | 文字列 (先頭タグやテキスト) | 通常の HTML/CSS レンダリング                                    |
| **HTML 文字列配列** | `string[]`                  | 複数ページの PDF 出力専用                                       |
| **URL**             | `http://` または `https://` | 指定 URL の HTML を自動フェッチしてレンダリング                 |
| **画像バイナリ**    | `Uint8Array` / `Buffer`     | マジックバイトにより PNG, JPEG, WebP, GIF, AVIF, JPEG XL, BMP を自動認識 |
| **Data URL**        | `data:image/*;base64,...`   | 画像として自動認識し最適化パイプラインへ直行                    |

### 出力形式 (`format`)

| フォーマット | 戻り値の型   | HTML 入力時の動作                          | 画像入力時の動作                  |
| ------------ | ------------ | ------------------------------------------ | --------------------------------- |
| `png`        | `Uint8Array` | Skia 描画 → PNG エンコード                 | 画像をデコードして PNG 出力       |
| `jpeg`       | `Uint8Array` | Skia 描画 → JPEG 圧縮 (`quality`)          | 画像をデコードして JPEG 圧縮      |
| `webp`       | `Uint8Array` | Skia 描画 → WebP 圧縮 (`quality`)          | 画像をデコードして WebP 圧縮      |
| `apng`       | `Uint8Array` | Skia 描画 → PNG (`animation` 指定でアニメーション) | 画像をデコードして PNG 化 |
| `gif`        | `Uint8Array` | Skia 描画 → GIF (256 色・ディザ。`animation` 指定でアニメーション) | 画像をデコードして GIF 化 |
| `avif`       | `Uint8Array` | Skia 描画 → AVIF 圧縮 (`quality`, `speed`) | 画像をデコードして AVIF 圧縮      |
| `jxl`        | `Uint8Array` | Skia 描画 → JXL 圧縮 (`quality`, `speed`)  | 画像をデコードして JXL 圧縮（JXL 入力も libjxl でデコードでき、`<img>` や画像入力として使えます） |
| `raw`        | `Uint8Array` | RGBA 非圧縮ピクセルデータ                  | RGBA 非圧縮ピクセルデータ         |
| `thumbhash`  | `Uint8Array` | 描画結果から ThumbHash を生成              | 画像から ThumbHash を生成         |
| `svg`        | `string`     | Skia ベクター描画ストリーム                | `<image>` タグでラップした SVG    |
| `pdf`        | `Uint8Array` | SkPDFDocument によるベクター PDF           | 画像を等倍 1 ページに配置した PDF |

> `png` は 256 色以下の画像（フラットな UI など）を自動でインデックスカラー PNG（パレット）で出力します（RGBA 比で約 3 分の 1 のサイズ、見た目は同一）。それ以外は従来どおり RGBA です。
>
> `webp` / `apng` / `gif` は `animation: { duration, fps, loop }`（CLI: `--animation`）を指定するとアニメーション画像を出力します（`apng` は `animation` なしだと通常の PNG、`gif` は 256 色パレット + ディザで、透過部分は白背景に合成されます）。`opacity`・`transform`（`translate` / `rotate` / `scale` のみ）・`color` / `background-color` の `@keyframes` をサンプリングし、既定 15fps、上限は 5 秒（`duration` は内部で 5000ms にクランプ）／約 75 フレームです。再生回数は `loop`（CLI: `--animation-loop`）で指定でき、既定は `0`（無限ループ）です。キーフレームの値には `var()` を使用でき、カスタムプロパティは描画対象の要素の解決済みの値から補完されます。ループ長は CSS の `animation-duration`（`animation` ショートハンドを含む）が優先され、API の `duration` は上限クランプとして働きます。

---

## 2. CSS & レイアウト対応状況

| 機能カテゴリー       | 対応機能                                                                | 詳細・特記事項                                         |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| **ボックスモデル**   | Margin, Padding, Border, Box-sizing, `aspect-ratio`                     | 論理プロパティ (`margin-inline` 等) も完全サポート     |
| **Flexbox**          | `flex`, `flex-direction`, `justify-content`, `align-items`, `flex-wrap`, `gap` | W3C 仕様準拠の多段レイアウト解決                       |
| **ブロック・テーブル** | `display: flow-root`、`overflow: clip`（`hidden` と同じクリップ、`overflow-clip-margin` は未対応）、`display: table-header-group` / `table-footer-group`（先頭・末尾に配置）、`table-caption`、`<col>` / `<colgroup>` の背景 | `flow-root` は float を内包し margin の相殺を遮断します。header / footer group を明示した表も描画され、`<thead>` 同様に PDF のヘッダ繰り返しの対象です |
| **テキストの切り詰め・縁取り** | `max-lines`、`block-ellipsis`、`text-fit`、`stroke-linejoin` | `max-lines` は `-webkit-line-clamp` 相当を標準プロパティで指定（`overflow: hidden` を暗黙に付与）、`block-ellipsis` で省略記号を差し替え。`text-fit: grow / shrink [上限%]` は最も広い行がコンテナ幅に収まるようフォントを拡縮します（最大 3 回の再レイアウト）。`stroke-linejoin` は `-webkit-text-stroke` の角（`miter` / `round` / `bevel`、`miter-clip` / `arcs` は `miter` で代替）を指定します |
| **改行・揃え・ハイフン** | `line-break`、`text-align-last`、`text-justify`、`tab-size`、`hyphens`（`-webkit-hyphens` 別名）、`hyphenate-character` | `line-break` は CJK の禁則の強さ（`strict` は小書き仮名・`ー` を行頭に置かず、`loose` は `々` などを行頭に許し、`anywhere` は任意の位置で折る）。`text-align-last` は最終行の揃え（`justify` も可）。`text-justify` は `none` で均等割りを止め、`inter-word` は空白のみ、`inter-character` / `distribute` は字間も伸縮します。`tab-size` は行頭からのタブストップ（数値は空白幅の倍数、または長さ）。`&shy;` は行末で折れたときだけハイフンを表示し、`hyphens: auto` は `lang="en"` の英単語を簡易ヒューリスティックで分割します（辞書なし）。`hyphenate-character` で記号を差し替えられます（`auto` は `-`） |
| **非標準プロパティ** | `flex-line-count`（takumi 独自拡張） | CSS 標準に存在しないため採用しません。指定しても無視されます（行数は内容とコンテナ幅から決まります） |
| **Grid**             | `grid-template-columns`, `grid-template-rows`, `grid-template` / `grid` ショートハンド, `grid-column`, `grid-row`, `grid-auto-columns`, `grid-auto-rows`, `grid-auto-flow`, `gap`, `place-items` | 明示トラック・自動配置（`row` / `column` と `dense` 穴埋め）・暗黙トラックのサイズ決定をサポート。`grid-auto-flow: column` は列方向に自動配置します |
| **位置指定**         | `position: static / relative / absolute / fixed`, `top`, `right`, `bottom`, `left`, `inset`, `z-index` | 包含ブロックに応じた正確な配置                         |
| **タイポグラフィ**   | HarfBuzz テキストシェイピング, BiDi (双方向テキスト), `unicode-bidi`, 縦書き (`writing-mode`) | CJK (日中韓)、ハングル・ヘブライ語・アラビア語・タイ語・ヒンディー語・ギリシャ文字、カラー絵文字、縦書き (`vertical-rl`)、文字縁取り (`-webkit-text-stroke`)、複数行省略 (`-webkit-line-clamp` / `max-lines` + `block-ellipsis` / `text-overflow: ellipsis`)、`text-transform` に対応。`unicode-bidi` は `bidi-override` / `isolate-override` を行内順序へ反映します（`embed` / `isolate` の境界制御と1ラン内の字形反転は部分対応）。Noto Sans JP に無い文字体系と絵文字のフォントは、必要なときだけ外部 CDN (Google Fonts / jsDelivr) から自動取得します |
| **フォント機能**     | `font-feature-settings`, `font-variant-*` (`-ligatures` / `-numeric` / `-east-asian` / `-caps` / `-position`), `font-kerning`, `font-variation-settings`, `font-stretch`, `font-optical-sizing`, `font-synthesis` | OpenType 機能 (`palt` / `kern` / `liga` / `pnum` / `zero` 等) を HarfBuzz 経由で適用し、要素ごとに異なる設定も反映。可変フォント軸 (`wght` / `wdth` 等) と `font-stretch` のキーワード・百分率に対応。`small-caps` 等の合成、`sub` / `super` の疑似代替、`@font-face` の `font-stretch` 記述子、optical sizing は部分対応／未対応です |
| **テキスト装飾**     | `text-decoration` (`-line` / `-style` / `-color` / `-thickness`), `text-decoration-skip-ink`, `text-underline-position`, `text-underline-offset` | 実線・破線・点線・二重線・波線の下線／上線／取り消し線に対応。`skip-ink` はグリフとの重なりを避けて線を分割描画し、縦書きにも適用。`thickness` と `underline-offset` の百分率は要素のフォントサイズ基準で解決します |
| **装飾・エフェクト** | `box-shadow`, `border-radius`, `opacity`, `transform`, `filter`, `backdrop-filter`, `image-rendering` | 角丸クリッピング、`corner-shape`（`round` / `scoop` / `bevel` / `notch` / `squircle` / `square` / `superellipse()`、隅ごとの longhand。背景・ボーダー・`box-shadow`・クリップに反映）、`box-decoration-break: clone`（PDF のページ分割で、ページをまたぐブロックの各断片に角丸・ボーダー・背景を描画。インライン要素の行分割は対象外）、複数ドロップシャドウ、ブラー、色調整、トランスフォーム対応。`image-rendering: pixelated` は最近傍補間で `<img>` と背景画像（タイル含む）を描画します（`crisp-edges` は未対応） |
| **モーションパス**   | `offset-path` (`ray()` / `path()` / basic-shape), `offset-distance`, `offset-rotate`, `offset-anchor`, `offset-position`, `offset` 短縮形 | パス上の位置と接線方向の回転、アンカー解決に対応。文法は Chromium 対照で厳密化済み（`calc()` 含む長さ・座標ボックス）。`url()` 参照・`<coord-box>` の厳密解釈は未対応 |
| **グラデーション & 背景** | `linear-gradient`, `radial-gradient`, `conic-gradient`, `background-size`, `mix-blend-mode` | 複雑なカラーストップとアングル指定、ブレンドモードに対応 |
| **クリッピング & マスク** | `clip-path: circle(), ellipse(), polygon(), path(), inset()`, `clip-rule: evenodd`, `mask` / `mask-image` / `mask-size` / `mask-repeat` / `mask-position` | Skia ネイティブパスによる自由形状クリッピングとアルファマスク (画像・グラデーションを繰り返し・サイズ指定付きで適用) |
| **インライン SVG**   | `<svg>`, `<path>`, `<circle>`, `<rect>`, `<g>`, `<linearGradient>` 等 | SkSVGDOM によるベクターグラフィックスの直接埋め込み描画 |
| **画像としての SVG**   | `<img src="x.svg">`、CSS の背景、SVG を入力に渡す場合 | `<text>` はページと同じフォントで描かれます（総称名・日本語・`fonts` オプション・SVG 内の `@font-face` に対応）。SVG 内の `<image href>` が別 URL を指す場合は取得して描きます（`resolveResource` と `limits` の対象）。SVG 入力は、`<text>` を含むときだけページ描画を経由します |
| **モダン CSS 機能**  | `calc()`, `light-dark()`, CSS 変数 (`var(--...)`), `@layer`, `white-space-collapse`, `text-wrap-mode` / `text-wrap-style` | 数値計算やデザイントークンの活用。`white-space-collapse` と `text-wrap-mode` は `white-space` / 折り返しへ反映します。`text-wrap-style: balance` は行数が変わらない範囲で折り返し幅を狭めて行長を揃え、`pretty` は最終行の孤立語を解消します（水平組みの通常フロー、balance は 6 行・pretty は 10 行まで。float・インライン置換要素・強制改行・縦書き・shrink-to-fit 幅は対象外） |
| **セレクタ**         | クラス, ID, 属性セレクタ, `:nth-child()`, `:not()`, `:is()`, `:where()`, `:has()`, `::before`, `::after` | 擬似クラス・擬似要素 (`content`) による高度なスタイリング。`:has()` は子 (`>`)・子孫・隣接 (`+`)・一般 (`~`) コンビネータの動作を Chromium 対照で確認済み |
| **スクロール・表示最適化** | `scroll-snap-*`, `scroll-snap-align`, `content-visibility` は no-op (無視) | 静止画レンダラーではスクロール位置や遅延描画の概念がないため、指定があっても通常描画される |
| **レスポンシブ**     | `@container` (コンテナクエリ), `@media print`, `@media screen`          | コンポーネント単位のサイズ適応                         |

---

## 3. 非対応機能・制限事項 (AI コード生成時の注意点)

ブラウザエンジン（Chromium/WebKit）ではなく、軽量な **litehtml + Skia** の静的レンダラーであるため、以下の機能は動作しません。HTML/CSS を設計する際はこれらを避けてください：

1. **JavaScript は既定では実行しません**: `<script>` タグやインラインイベントハンドラ (`onclick` など) は実行されません。静的な HTML/CSS マークアップを生成してください。Node.js に限り、`javascript` オプション（CLI: `--js`）を指定すると、jsdom でスクリプトを実行したあとの DOM を描画します（信頼できるページのみ。[render() のオプション](./api-reference/render.md)）。ブラウザ専用の API やレイアウト計測に依存するスクリプトは、期待どおりに動きません。
2. **CSS アニメーション / トランジション（部分対応）**: `transition` は評価されません。`@keyframes` は既定では評価されず静的スタイルのみ描画されますが、`animation: { duration, fps, loop }`（CLI: `--animation`）を指定すると **`opacity`・`transform`・`color` / `background-color` の `@keyframes`**をサンプリングしてアニメーション WebP / APNG / GIF を出力できます。再生回数は `loop`（CLI: `--animation-loop`、既定 `0` = 無限）で指定できます。既定 15fps、上限は 5 秒（`duration` は 5000ms にクランプ）／約 75 フレームです。CSS の `animation-duration`（`animation` ショートハンドを含む、`var()` 対応）が 1 イテレーションの長さになり、`animation-delay` と `animation-iteration-count`（数値 / `infinite`）からサンプリング区間が決まります（`infinite` は 1 イテレーション、`alternate` / `alternate-reverse` は 2 イテレーション）。API の `duration` は区間全体の上限クランプ、API の `fps` は上限のフレームレートとして働きます。`transform` は `translate` / `rotate` / `scale` のみに対応し、キーフレーム間で関数リストが一致しない場合はその要素は静止したままです。タイミング関数はキーフレームブロック内の `animation-timing-function` がその停止点から始まる区間に適用され、要素側（`<style>` またはインライン）の `animation-timing-function` が既定値になります（`linear` / `ease` / `ease-in` / `ease-out` / `ease-in-out` / `cubic-bezier()` / `steps()` / `step-start` / `step-end`、`opacity`・`color`・`transform` の補間に適用）。`animation-direction`（normal / reverse / alternate / alternate-reverse）と `animation-fill-mode`（none / forwards / backwards / both）にも対応し、`animation-delay` 中の値（backwards）と終了後の保持値（forwards）を解決します。負の `animation-delay` はイテレーション途中からの開始として扱います。文書内のすべての `@keyframes` がそれぞれ、ルールのセレクタに一致する全要素（複数可）を動かします。1 要素への複数アニメーション（`animation: a 2s, b 3s` や `animation-name: a, b`）は重ねて適用され、同じプロパティは後のものが優先されます。`translateX` / `translateY` にも対応します。
3. **HTML5 `<canvas>` スクリプト**: `canvas.getContext('2d')` による描画は行われません。図形描画にはインライン `<svg>` や CSS プロパティを使用してください。
4. **動的インタラクション**: `:hover`, `:active`, `:focus` などの動的疑似クラスは反映されません。
5. **ブラウザ専用 Web API**: `window`, `document`, `localStorage`, `IndexedDB` などの Web API は参照できません。

---

## 4. ランタイム互換性

| ランタイム              | サポート | 推奨サブパス                                                                          | 備考                                                                             |
| ----------------------- | :------: | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Node.js (>=20)**      |    ✅    | `wasm-html-to-image/single`<br/>`wasm-html-to-image`<br/>`wasm-html-to-image/workers` | シングルスレッド、インスタンス再利用、マルチスレッド Worker プールすべて利用可能 |
| **Cloudflare Workers**  |    ✅    | `wasm-html-to-image/workerd`                                                          | `.wasm` の import は現行 Wrangler でデフォルトでバンドルされるため追加設定不要（`rules` を自前定義するとデフォルト上書きになるため、カスタマイズ時・非常に古い Wrangler 利用時のみ必要） |
| **Vercel Edge Runtime** |    ✅    | `wasm-html-to-image/edge-light`                                                       | Edge 環境特有のメモリ制限・API 制約に最適化                                      |
| **モダンブラウザ**      |    ✅    | `wasm-html-to-image/single`<br/>`wasm-html-to-image/workers`                          | Web Worker を用いたバックグラウンド描画が可能                                    |
| **Deno**                |    ✅    | `wasm-html-to-image`                                                                  | Deno Deploy やローカル CLI で動作                                                |
| **Bun**                 |    ✅    | `wasm-html-to-image/single`                                                           | Node.js 互換レイヤー経由で高速動作                                               |
