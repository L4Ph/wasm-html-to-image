# ライブレイアウトの差分反映 — 設計

状態: 設計案(未着手)。前提は試作(コミット `1982bef7`)と、その後の計測。

## 1. 目的

quickjs-dom のページが `getBoundingClientRect()` / `offset*` / `getComputedStyle()` を読んだとき、litehtml の計算結果を**同期で**返す。
Node と Workers の両方で動かす。2 つの wasm は同じ isolate に載り、JS を介して同期に呼び合う(試作と workerd で確認済み)。

試作は DOM が変わるたびに、DOM 全体を HTML にして litehtml に渡し、文書を作り直している。これを「変更だけを litehtml の常駐文書に反映する」方式に替える。

## 2. 現状のコスト(計測)

1,000 要素の div を書き換えて読む 1 回あたり(Node)。

| 処理 | 時間 |
|---|---|
| litehtml の文書生成(パース + スタイル解決) | 約 48 ms |
| litehtml のレイアウト | 約 7 ms |
| 結果の JSON 化、ホストでの JSON 処理 | 約 8 ms |
| ゲストの複製 + シリアライズ(`markForLayout`) | 約 6 ms |
| 合計 | 約 94 ms(3,000 要素で約 308 ms) |

workerd でも同じ比例関係(1,000 要素で 1 回約 125 ms)。書いて読むを 20 回繰り返すと 2.8 秒かかる。

**目標**: 1,000 要素で 1 回 15 ms 以下(属性の変更なら 10 ms 前後)。

## 3. 方針

```
quickjs-dom (QuickJS wasm)                 litehtml (renderer wasm)
 DOM の変更 → 変更ジャーナル(C)
 座標・スタイルを読む
   └ ジャーナルが空でなければ
     provider(ops) ───────────────────►  常駐の文書に ops を反映
                                          → 再スタイル → 再レイアウト
        ◄── boxes + 計算済みスタイル ────┘
```

- litehtml の文書を**閉じずに持ち続ける**(ライブ文書)。
- quickjs-dom は DOM の変更を C の層でジャーナルに記録する。ゲスト JS の `MutationObserver` 機構には載せない(オブザーバーが無くても記録するため)。
- 反映できない変更が混ざったら、従来の「HTML を渡して作り直す」に倒す(§7)。結果は同じになることを差分テストで保証する(§9)。

## 4. 要素の識別

今の `__qi` は「ドキュメント順の通し番号」で、変更のたびに振り直す。差分では使えない。

- quickjs-dom の ND に**恒久の id**(作成時に採番、再利用しない)を持たせる。`uint32`。
- litehtml 側は `id → weak_ptr<element>` の表を持つ。
- 初回(および作り直し)のシリアライズでは、各要素に `data-qjsl="<id>"` を付ける。今の `qjsl-<n>` クラスは class セレクターや `[class=...]` に影響し得るので、専用の属性にする。litehtml は属性を読んで表を作り、属性自体は以後使わない。
- litehtml が作る `-tag-before` / `-tag-after`(疑似要素)と `anonymous`(表の補完)は id を持たない。出力の走査でも飛ばす(`layout_json.cpp` の `is_tree_element` と同じ規則)。

## 5. 変更ジャーナル(quickjs-dom 側)

C の変更の入口はこの 5 か所に集約されている(`csrc/nativedom.h`、`nativedom_api.h`)。

| 入口 | 記録する op |
|---|---|
| `nd_set_attr` | `attr(id, name, value)` |
| `js_nd_remove_attribute` | `attr-remove(id, name)` |
| `nd_unlink` | `remove(id)` |
| `nd_insert` | `insert(parentId, refId \| 0, subtree)` |
| テキストの変更(`data` / `textContent`、パーサのテキスト結合) | `text(id, value)` |

- 記録は `nd_version` を進める箇所に合わせる。ただし**ライブ有効時だけ**記録する(無効なら負荷を足さない)。
- `insert` の `subtree` は、挿入したサブツリーを HTML 文字列にシリアライズしたもの(各要素に `data-qjsl`)。移動(`insertBefore` が既存ノードを動かす)は `remove` + `insert` として記録する。
- 同じ要素への連続した `attr` は最後の値だけ残す。挿入した要素への変更は、`insert` のシリアライズに含まれるので別に残さない。
- 上限(既定: 要素数の 30%、または 5,000 op)を超えたら、ジャーナルを捨てて「作り直し」フラグを立てる。

## 6. 反映(litehtml 側)

litehtml には、サブツリーを挿入する既存の手順がある(`document::append_children_from_string`)。
`create_node` → `apply_stylesheet`(master / styles / user)→ `parse_attributes` → `compute_styles` → `create_render_item` → `fix_tables_layout`。
`document::render` の中にも、`refresh_styles()` → `compute_styles()` → `create_render_item` → `fix_tables_layout` → `init` → 再 `measure` を行う経路(container query と表のための 2 回目)がある。これらを使い回す。

新しい API(`document` に追加):

```cpp
// 反映の窓口。失敗(未対応の変更)は false を返し、呼び側が作り直す。
bool document::live_apply(const live_op& op);
// 全部反映したあとの再計算。= refresh_styles + compute_styles + 描画ツリーの再構築 + render(width)
pixel_t document::live_relayout(pixel_t max_width);
```

op ごとの反映:

| op | litehtml での反映 |
|---|---|
| attr / attr-remove | `element::set_attr`(`class`・`id`・`style` は `m_classes`・`m_id`・`m_style` が追従するか要確認)。再スタイルの対象としてマーク |
| text | テキストノードは `el_text` / `el_space` に**単語単位で分割**されている。同じ位置の分割片を取り除き、`create_node` と同じ分割で作り直して差し込む |
| insert | 新設の `insert_children_from_string(parent, ref, html)`(`append_children_from_string` の位置指定版)。`fragment_context` は親のタグに合わせる |
| remove | `removeChild` と描画ツリーからの除去 |

再スタイルの範囲:
- 最初は**文書全体**の `refresh_styles()` + `compute_styles()`(要素ごとにセレクターを再照合する)。これで正しさを先に確保する。
- 速さが足りなければ、変更した要素とその子孫・後続の兄弟だけに絞る(`class`・`id`・属性・`:nth-child` などの影響範囲を安全側に見積もる)。

## 7. 作り直しに倒す条件

次のいずれかが起きたら、ジャーナルを捨て、現行の方式(HTML を渡して文書を作り直す)にする。

- `<style>`・`<link>`・`<script>`・`<base>`・`<title>`・`<template>` の追加・削除・内容変更(CSS の版が変わる)
- `<html>`・`<head>`・`<body>` の構造の変更
- 表の要素(`table`・`tr`・`td` など)への挿入・削除(`fix_tables_layout` と foster parenting の整合を取りにくい)
- `adoptedStyleSheets` の変更、メディア条件・ビューポート幅の変更
- 未知の id、未対応の op、ジャーナルの上限超過

作り直しは必ず正しい(今の方式そのもの)。差分反映は「速いが、確信が持てないときは諦める」層として足す。

## 8. リソース(画像・フォント・外部 CSS)

- 同期の反映の途中で fetch は待てない。新しい `<img>` やフォントは、litehtml の既存の仕組み(`satoru_collect_resources` / `get_pending_resources` / `add_resource`)で非同期に解決する。
- 解決するまでは、未解決のまま(画像は寸法なし)でレイアウトして返す。解決したら `context.needsRelayout` が立つので、次の読み取りで再レイアウトする。
- 非同期の解決を呼ぶのはホストの責務(`createDOM` 側の `track()` に載せる)。同期の計測呼び出しは待たない。

## 9. 正しさの保証

差分反映の結果は、作り直しの結果と**一致しなければならない**。

- **差分テスト**: quickjs-dom には、乱数のプログラムを jsdom と突き合わせる仕組みがある(`tests/nativedom.test.ts`、`tests/lockstep.ts`)。同じ生成器で DOM を変更し、各ステップで次の 2 通りを比べる。
  - A: 差分反映(ジャーナル → `live_apply` → `live_relayout`)
  - B: 作り直し(全体を HTML にして新しい文書でレイアウト)
  
  box と計算済みスタイルが一致(座標は 0.01px の誤差まで)することを確認する。
- 不一致の op は、まず「作り直しに倒す条件」(§7)に加える。直せるものは直す。
- 試作の `proto-live-layout.mjs` は、この比較の最小形として残す。

## 10. インターフェース

wasm の追加バインディング(既存は変えない):

| 関数 | 内容 |
|---|---|
| `satoru_live_open(inst, html, width, mediaType)` | 常駐文書を作る(従来の `collect_resources` と同じ)。`data-qjsl` から id 表を作る |
| `satoru_live_apply(inst, opsJson)` | ops を反映して再レイアウトする。戻り値は `"ok"` / `"rebuild"` |
| `satoru_live_boxes(inst)` | 全要素の box と計算済みスタイル(今の `satoru_layout_style_json` と同じ形に id を足したもの) |

ホスト(provider)の契約: `provider(ops | null, html)`。`ops` があれば差分を、`null`(作り直し)なら `html` を渡す。戻りは今と同じ boxes の JSON。
ゲストの `ensureLive()` は、バージョンが進んでいたらジャーナルを取り出して provider を呼ぶ。

出力の全 box は 1,000 要素で約 400 KB になる。最初は全部返し、効果が見えたら変わった要素だけを返す(差分の差分)。

## 11. 段階と合否

| 段階 | 内容 | 合格の目安 |
|---|---|---|
| P0 | **見積りの確認(最優先)**: 常駐文書に対して `refresh_styles` + `compute_styles` + 描画ツリーの再構築 + `render` だけの時間を、C++ で直接測る | 1,000 要素で 20 ms 以下。超えるなら §6 の「再スタイルの範囲を絞る」を P1 に前倒しする。それでも届かなければ、この方式を見直す |
| P1 | 属性の変更(`class`・`style`・属性)だけ。ジャーナル、id 表、`live_apply`、`live_relayout` | 1,000 要素の属性変更で 15 ms 以下。差分テストが一致 |
| P2 | テキストの変更 | 同上 |
| P3 | 挿入・削除(表を除く) | 差分テストが一致。追加・削除のループで作り直しより速い |
| P4 | 作り直しの条件(§7)の整備と、リソースの非同期解決(§8) | 実ページ(`real-page-fix` のコーパス)で、作り直しとの差が 0 |
| P5 | Workers 本番でメモリと CPU 時間を測る | 128MB に収まる。書いて読むを 20 回繰り返して CPU 上限に届かない |

P0 の結果で、全体の見積りが決まる。**P0 を先にやる**。

## 12. 未確認・リスク

- **再スタイルの本当のコスト**: 文書生成 48 ms のうち、パース(gumbo)とスタイル解決の内訳は未計測。再スタイルがほとんどを占めるなら、差分でも効果が小さい(P0 で判明する)。
- **`set_attr` の追従**: `html_tag::set_attr` が `class` / `id` / `style` の内部状態(`m_classes`、`m_id`、`m_style`)をどこまで更新するか、確認していない。
- **テキストの分割**: `el_space` / `el_text` への分割は `create_node` の中にある。切り出して再利用できるか、挿入の経路(`insert_children_from_string`)で代用できるかを見る。
- **カウンター・疑似要素・`text-fit`**: 再計算の対象になる。`rebuild_counters` は `refresh_styles` の末尾で走る。
- **quirks モード**: 作り直しでは文書ごとに決まる。常駐文書では最初の判定を引き継ぐ(doctype の変更は §7 で作り直し)。
- **ID の保持**: ND の構造体が大きくなる(4 バイト)。QuickJS の snapshot(`warm`)に影響しないことを確認する。
- **Workers のメモリ**: 常駐文書は、作り直しと違って古い文書を解放できない時間がない。ピークは増えにくいが、本番での確認は P5 まで残る。

## 13. P0 の結果(計測済み)

ページ: 1,000 / 3,000 個の `div.r > span`(要素数はその 2 倍)、`<style>` に 4 つの規則(`:nth-child`・子孫セレクターを含む)。Node、1 回あたりの平均。

| | 作り直し | 常駐文書を全体で再スタイル(全規則を再適用) | 同(`refresh_styles` のみ) |
|---|---|---|---|
| 1,000 組 | 233 ms | **88 ms** | 88 ms |
| 3,000 組 | 503 ms | **406 ms** | 434 ms |

内訳(1,000 組、全規則を再適用): 消去 2.0 / 規則の適用 11.9 / `compute_styles` 48.6 / 描画ツリー 8.6 / レイアウト 17.2 ms。

判定:
- **P0 の合格基準(20 ms 以下)は満たさない**。文書全体を再スタイルする方式は、作り直しの約 38%(1,000 組)・約 81%(3,000 組)にしか下がらない。3,000 組では効果が小さい。
- 時間の中心は `compute_styles`(約 55%)と規則の適用(約 14〜25%)。**再スタイルを変更箇所に絞らない限り、差分反映の意味がほとんどない**。
- 絞ったときの下限は「描画ツリー + レイアウト」で、1,000 組(2,000 要素)で約 26 ms。これは全体の再レイアウトなので、絞っても残る。

見直し:
1. §6「再スタイルの範囲を絞る」を P1 の必須にする。`element::compute_styles(bool recursive)` は再帰を切れる。変更した要素と、その影響が及ぶ範囲(子孫、`+`・`~` の後続の兄弟、`:nth-*`・`:has()` が絡む場合の親)だけを、規則の再適用と `compute_styles` の対象にする。
2. 目標を修正: **2,000 要素で 35 ms 以下**(作り直しの約 15%)。15 ms 以下を狙うには、描画ツリーとレイアウトも差分にする必要があり、litehtml の `render_item` に部分的な再レイアウトの仕組みが要る(別の大きな課題。P1〜P3 の後で再判断する)。
3. 影響範囲を安全側に見積もれない変更(`:has()`・兄弟セレクターが規則にある場合など)は、全体の再スタイルか作り直しに倒す。

## 14. P1 の結果(属性の変更のみ・実装済みの試作)

実装:
- quickjs-dom(C): ND に `qid`、属性の設定・削除の変更ジャーナル(`journalOn/Sync/Ok/Take`、`setQid`)。ジャーナルに載らない変更(木の編集など)は `nd_version` がジャーナルの版を追い越すので、読み手は作り直しに倒す。
- ゲスト(`boot.js`): `ensureLive()` が `journalOk()` ならジャーナルを送り、そうでなければ従来の全体シリアライズで開き直す。応答は `=`(全部)、`+`(変わった要素だけ、null は消えた要素)、`rebuild`。
- litehtml: `document::live_set_attr` / `live_relayout`(変更箇所に絞った再スタイル、`css::sibling_sensitive()` が真なら親の範囲)。`html_tag::remove_attr`。
- wasm: `satoru_live_open` / `satoru_live_apply` / `satoru_live_sync`(数値で比べて、変わった要素だけ整形)。

正しさ: `scripts/proto-p1.mjs` の差分テスト(40 要素のページに乱数の属性変更 150 ステップ。class、classList、style、cssText、属性の設定・削除、id、子要素の style)で、差分反映の box と計算済みスタイルが、同じ状態を最初から作り直した結果に全て一致(0.01 px)。差分反映 149 回、作り直しの要求 0 回。quickjs-dom のテスト 281 件と html-to-image の関連テストも通る。

速さ(Node、1 回の変更 + 読み取り):

| 要素数 | 変更 | 差分反映 | 参考: 作り直し |
|---|---|---|---|
| 2,000 | color(位置が動かない) | **34 ms** | 約 230 ms |
| 2,000 | height(下の全要素が動く) | 58 ms | 約 230 ms |
| 6,000 | color | 143 ms | 約 500 ms |
| 6,000 | height | 224 ms | 約 500 ms |

2,000 要素で目標(35 ms 以下)を満たすのは、位置が動かない変更だけ。動く変更は、差分が全要素になるうえ、レイアウト全体(約 17 ms)と描画ツリー(約 9 ms)の再実行が残る。6,000 要素では要素数に比例して重い(1 要素あたり約 23 µs)。

残る時間の内訳(2,000 要素・color): 反映(再スタイル + 描画ツリー + レイアウト)約 21 ms、box の走査と比較約 12 ms、ゲストとブリッジ約 1 ms。

次の改善候補:
1. 描画ツリーの再構築とレイアウトを、変更した部分木だけにする(litehtml の `render_item` に部分再レイアウトが要る。最も効くが大きい)。
2. box の走査を、レイアウトが動いた要素だけに絞る。
3. `document::render()` の 2 回目(表を含むページでは文書全体を再スタイルする)の抑止。表を含むページでは、この試作の効果が出ない。

未対応(設計どおり作り直しに倒す): 木の編集(挿入・削除)、テキストの変更、`<style>`・`<link>`、表への変更。
