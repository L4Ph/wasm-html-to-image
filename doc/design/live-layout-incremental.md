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

## 15. P2 / P3 の結果(テキストの変更、挿入・削除・移動)

実装: 設計の「テキスト」「挿入」「削除」を、**「この要素の子が変わった」という 1 種類の記録**にまとめた(`kids`)。
- quickjs-dom(C): `nd_insert` / `nd_unlink` / テキストの編集(`data`、`nodeValue`、`textContent`)が、変更先の要素(qid あり、ページの文書の中)の `kids` を記録する。ページの文書の外(作成中の切り離したノード、`DOMParser` の文書、複製)の変更はジャーナルを乱さず、qid のない新しい要素の変更は、それを入れた場所の `kids` が運ぶ。文書そのもの・フラグメントを親にする変更は作り直しに倒す。テキストノードの編集が `nd_version` を進めていなかったので、進めるようにした(以前のライブレイアウトはテキスト編集を見落としていた)。
- ゲスト: `kids` の要素ごとに、子を HTML にして(各要素の id を先頭の class に付ける。新しい要素には `nextQi` から id を振る)送る。属性の変更が先、`kids` が後。入れ子の `kids` は外側だけ送る。
- litehtml: `document::live_replace_children`(子を HTML から作り直す。`<body>` を文脈にした断片のパース)。反映側は、`table` 系・`select`・`style`・`svg` などの中、および新しい内容に `<style` `<link` `<img` `<table` などがあるときは作り直しに倒す。

正しさ: 差分テストを 300 ステップに拡張(テキストの編集、`textContent`、要素の追加、`body` への挿入、削除、子の削除、移動を属性変更に混ぜる)。差分反映の box と計算済みスタイルが、作り直しの結果と全て一致。差分反映 284 回、作り直しの要求 0 回、開き直し 1 回(最初のみ)。quickjs-dom のテスト 281 件、html-to-image の関連テスト、ビジュアルテスト(1,084 件)も通る。

速さ(2,000 要素、Node、1 回の変更 + 読み取り):

| 変更 | 差分反映 |
|---|---|
| 行の中のテキスト編集 | 34 ms |
| 行に要素を 1 つ追加 | 35 ms |
| color(位置が動かない) | 33 ms |
| height(下の全要素が動く) | 61 ms |
| **`<body>` に行を 1 つ追加** | **155 ms**(作り直しは約 230 ms) |

課題: `<body>` のように**子が多い親**への挿入・削除は、全部の子を HTML から作り直して全体を再スタイルするので、作り直しの 7 割程度までしか下がらない。次の設計変更が要る。
1. `kids` を「既存の子は id で参照し、新しい子だけ HTML で送る」形にする。ホストは既存の要素をそのまま使い、新しい子だけパースする。
2. 再スタイルの範囲を「新しい要素、その前後の兄弟(`:first-child`・`:last-child`・`:nth-*` の影響範囲)」に絞る。`css::sibling_sensitive()` を、構造疑似クラスの種類ごとに分ける。
3. それでも描画ツリーの再構築(約 9 ms)とレイアウト全体(約 17 ms)は残る。

その他: 3,000 組で `<body>` に 20 回追加すると 10 秒の評価時間切れになる(上の理由による)。表を含むページは `document::render()` の 2 回目の全体再スタイルが残る。

## 16. 子が多い親への挿入・削除の改善(第 15 節の課題への対応)

変更:
1. `kids` の値を、子ごとのセグメントにした。ホストがすでに持っている要素(ページ側で id を持つ要素)は `E<id>`、新しい内容(テキスト、新しい要素)は `H<html>` で送る。ホストは既存の要素をそのまま使い(別の親から来たものは元の親から外す)、新しい内容だけをパースする。参照する要素は、どの op も適用する前にまとめて確保する(移動で元の親の op が先に走っても失われない)。
2. 再スタイルの範囲を、変更の種類で決める(`css::sibling_sensitive()` / `structural_sensitive()`、シートの全セレクターを走査)。
   - 兄弟・`:has()` を使うシート: 親の親の部分木。
   - 位置の疑似クラス(`:first-child`、`:nth-*`、`:empty` など)だけ: 親の部分木。
   - どちらもないシート: 新しい要素と、別の親から移ってきた要素の部分木だけ。
3. 入れ子の `kids` を外側にまとめるのをやめた(子を id で参照するので、外側の op は内側の変更を含まない)。子が 0 個になった親の検証の誤りも直した。

正しさ: 差分テスト 300 ステップ(テキスト、挿入、削除、移動を含む)が作り直しの結果と全て一致。差分反映 284 回、作り直しの要求 0 回、開き直し 1 回。quickjs-dom 281 件、html-to-image の関連 32 件、ビジュアル 1,084 件も通る。

速さ(Node、1 回の変更 + 読み取り):

| 要素数 | 変更 | 位置の疑似クラスなし | `:nth-child` あり |
|---|---|---|---|
| 2,000 | `<body>` に行を追加 | **29 ms**(以前 155 ms) | 97 ms(以前 155 ms) |
| 2,000 | 行に要素を追加 | 28 ms | 34 ms |
| 2,000 | 行のテキスト編集 | 31 ms | 30 ms |
| 6,000 | `<body>` に行を追加 | 149 ms | — |
| 6,000 | color | 130 ms | — |

残る課題:
- 位置の疑似クラスがあるシートでは、子が多い親への挿入が 97 ms。親の部分木全体を再スタイルしているため。対策は、残る子を「自分だけ再スタイルし、結果が変わった子だけ部分木を再スタイルする」方式にすること。変化の検出(使っているセレクターの一致結果の比較など)が要る。
- 6,000 要素では、どの変更も 110〜150 ms。描画ツリーの再構築、レイアウト全体、box の走査と比較が要素数に比例して残る。部分的な再レイアウト(`render_item` の更新)が要る。

## 17. Workers(workerd、`cf dev`)での再計測

方法: `cloudflare-screenshot` に一時的な `/probe` を足し(後で削除)、`cf dev` の workerd で 2 つの wasm を同じ isolate に載せて測った。workerd は `performance.now()` が CPU 実行中に進まないので、クライアントから見た往復時間で測り、変更の回数を 1 回と 21 回で比べて、1 回あたりを出した。ページはシート付きの `div.r > span` 行(位置の疑似クラスなし)。互換性フラグ `enable_weak_ref` が必要(bridge が `FinalizationRegistry` を使う)。

| 要素数 | 変更 | workerd(1 回の変更 + 読み取り) | 参考: Node |
|---|---|---|---|
| 2,000 | color | 24.5 ms | 29 ms |
| 2,000 | テキスト編集 | 25.3 ms | 31 ms |
| 2,000 | `<body>` に行を追加 | 31.0 ms | 29 ms |
| 2,000 | height(下が動く) | 62.5 ms | 53 ms |
| 6,000 | color | 139.8 ms | 130 ms |
| 6,000 | テキスト編集 | 131.2 ms | — |
| 6,000 | `<body>` に行を追加 | 150.3 ms | 149 ms |
| 6,000 | height | 225.3 ms | 181 ms |

最初の 1 回(DOM の生成 + 文書を開く + 応答)は、2,000 要素で約 220〜320 ms、6,000 要素で約 750〜830 ms。変更の回数はすべて「差分反映 = 回数、開き直し 1 回、作り直しの要求 0 回」。

分かったこと:
- **workerd でも Node とほぼ同じ速さ**。同期ブリッジ、差分反映、2 つの wasm の同居は成立する。以前の試作(毎回作り直し)は 2,000 要素で 1 回約 125 ms だったので、約 5 倍速い。
- **メモリ**: ローカルの workerd は isolate ごとのメモリを測れず、128MB の上限も強制しない。プロセス全体の working set は 727 MB から、2,000 / 6,000 要素のとき 736 MB / 731 MB、12,000 要素(6,000 組)のとき 818 MB で、要素数が小さいうちは目立つ増加がない。**128MB に収まるかは、本番の Workers にデプロイして確認するしかない(未確認)**。
- **CPU 時間**: 6,000 要素で 1 回 130 ms 以上。書いて読むを繰り返すループは、CPU 時間の上限(無料プランで 10 ms、有料で既定 30 秒)を意識する必要がある。1 リクエスト内で数十回の再計測なら、有料プランの範囲に収まる。

## 18. 本番の Workers での計測と、見つかったリーク

方法: `cloudflare-screenshot` と同じ依存で、別名の一時 Worker(`live-layout-probe-tmp`、トークン必須、workers.dev)をデプロイし、`wrangler tail --format json` の `outcome` と `cpuTime` を読んだ。有料プラン(gzip 5.5 MB のアップロードが通る)。互換性フラグ `enable_weak_ref` が必要。

### リーク(修正済み)

最初の本番の測定で、同じページでも**変更を繰り返すと `RangeError: Invalid array buffer length`(wasm のメモリ拡張の失敗)で落ちた**(`n=1000` 組で 100 回、`n=3000` 組で 21 回)。ローカルの Node は上限がないので気づかなかったが、`process.memoryUsage().external` は 1 回の変更で約 2〜3 MB(2,000 要素のとき)増え続けていた。QuickJS を外してレンダラーだけでも再現し、`apply` だけが増やしていた(`sync` と、作り直しの `layout_json` は増えない)。

原因: 再レイアウトのたびに描画ツリーを作り直すが、各要素が持つ `m_renders`(描画アイテムへの `weak_ptr` のリスト)が掃除されない。`make_shared` で作ったものは `weak_ptr` が残る限り領域が解放されないので、古い描画ツリーが全部残っていた。`document::drop_render_links()`(全要素の `m_renders` を空にし、古い描画ツリーを手放す)を、描画ツリーを作り直す 4 か所(ライブレイアウトの 2 か所と `render()` の中の 2 か所)の前に呼ぶようにした。修正後は、Node で 100 回の変更を重ねても `external` は一定(78 MB)。`render()` の中の 2 か所は、コンテナクエリ・表・`text-fit` のページが元から抱えていた同じ問題でもある。

### 修正後の本番の結果

| 条件(新しい isolate または再利用) | 結果 |
|---|---|
| 2,000 要素、変更 100 回(`append`・`color`) | 成功(以前は失敗) |
| 6,000 要素、変更 21 回(`append`・`color`・`height`) | 成功(以前は失敗) |
| 7,000 要素(3,500 組)以上、1 回でも | **失敗(`Invalid array buffer length`)** |

**128MB に収まる上限は、現状のエンジンで約 6,000〜7,000 要素**。Node で内訳を測ると(`external`)、レンダラーの wasm が読み込み後で約 49 MB、QuickJS のページ(6,000 要素)が +6 MB、そして**文書を開くと 6,000 要素で +106 MB**(1 要素あたり約 7〜9 KB、ピークはさらに大きい)。メモリの大半は litehtml の文書(要素と `css_properties`、描画アイテム、gumbo のパース木)で、QuickJS 側ではない。

### CPU 時間(`wrangler tail` の `cpuTime`)

- 最初のリクエスト(isolate の起動 + wasm の読み込み + 文書を開く)は、2,000 要素で約 1.4〜2.0 秒。
- 変更 1 回あたり(2,000 要素、起動分を引いた概算): `color` 約 24 ms(ローカルと同程度)、`append` 約 90 ms(ローカル約 30 ms の 3 倍)。6,000 要素: `color` 約 150 ms、`append` 約 350 ms、`height` 約 440 ms。
- 数十回の再計測を 1 リクエストの中で重ねると、数秒から 10 秒前後になる。有料プランの既定(30 秒)には収まるが、無料プラン(10 ms)では起動にも足りない(そもそも gzip 3 MB の上限を超える)。

### 次の改善候補

1. 6,000 要素を超えるページをどうするか。
   - 呼び出し側で要素数の上限を決め、超えたらライブレイアウトを使わない(`getBoundingClientRect` は 0 のまま)ようにする。メモリ不足の `RangeError` で落とさない。
   - litehtml の 1 要素あたりのメモリ(`css_properties` の大きさなど)を減らす。
2. `append` が本番でローカルの 3 倍かかる理由の調査(子が多い親では、ゲストの `E` セグメントの組み立てと、ホストの `pool`・`live_set_children` が子の数に比例する)。

## 19. 大きすぎるページと、レンダラーの失敗への備え(ガード)

第 18 節の上限(Workers で約 6,000〜7,000 要素)を超えるページや、レンダラーが失敗したときに、`RangeError` でページのスクリプトを巻き込まず、**レイアウトなしに縮退**するようにした(`boot.js`、ゲスト側のみ)。

- `__edgeEnableLiveLayout(maxElements)`: 要素数が `maxElements` を超えるページは、文書全体をレンダラーに渡す前(作り直し・最初の読み取り)に判定して、ライブレイアウトを止める。既定は無制限(Node 向け)。Workers では、ホストが 9,000 以下を渡す想定(第 21 節)。
- 提供側(`__layoutProvider`)が例外を投げた場合(メモリ不足、バグ)も同じく止める。ページのスクリプトには例外を見せない。
- 止まったあとの挙動: `getBoundingClientRect()` / `offset*` / `client*` / `scroll*` は 0、`getComputedStyle` は従来の JS のカスケードだけ(レンダラーの値で上書きしない)。ジャーナルも止める。`console.warn` で理由を 1 回だけ出す。再開はしない(そのページの間)。

`scripts/proto-guard.mjs` で確認(要素数の上限、提供側が最初から投げる、更新で投げる、通常のページに影響しない)。差分テスト 300 ステップ、quickjs-dom 281 件、html-to-image 関連 32 件も通る。

未対応: 上限の既定値の決め方(ホストごと)、Workers でこのガードが `RangeError` を実際に防げるかの本番での確認(レンダラーの wasm のメモリ拡張の失敗が、JS の例外として届く場合のみ捕まえられる)、litehtml の 1 要素あたりのメモリの削減。

本番の Workers での確認(一時 Worker、有料プラン、`enable_weak_ref`):

| 場合 | 結果 |
|---|---|
| 2,000 要素、上限 5,000 | 通常どおりレイアウトされる(`getBoundingClientRect` が実際の値、差分反映 5 回) |
| 7,000 要素、上限 5,000 | 約 0.3 秒で縮退(レンダラーは呼ばれない)、警告 1 回、応答 200 |
| 直後の通常のページ(同じ isolate) | 通常どおり動く |
| 7,000 要素、**上限なし**(新しい isolate) | レンダラーが `Invalid array buffer length` で失敗 → ガードが捕まえて縮退、警告 `the renderer failed: Invalid array buffer length`、応答 200(以前は 500) |
| 直後の通常のページ(同じ isolate) | 通常どおり動く |

つまり、上限を指定しなくても、メモリ不足の `RangeError` はページを巻き込まない。上限を指定すれば、失敗する前に約 0.3 秒で止められる。

## 20. 公開 API: `enableLiveLayout`

試作で手動で配線していたもの(`window.__layoutProvider`、`satoru_live_*` の呼び分け)を、`wasm-html-to-image/javascript` の関数にした(`src/live-layout.ts`)。

```ts
import { createDOM, enableLiveLayout } from "wasm-html-to-image/javascript";
import { getDefaultModule } from "wasm-html-to-image/workerd"; // Node では loadHtmlToImageModule()

const dom = await createDOM({ url }, { width: 1200 });
const layout = await enableLiveLayout(dom, await getDefaultModule(), { width: 1200, maxElements: 5000 });
await dom.eval("document.querySelector('main').getBoundingClientRect().height");
layout.dispose(); // ページを閉じるとき
dom.close();
```

- 最初に 1 回だけ、ページの今の HTML から、スタイルシート・フォント・画像を非同期に解決する(`render` と同じ `fontMap` / `fallbackFonts` / `limits` / `resolveResource` / `css` / `fonts` / `userAgent` が使える)。以後の読み取りは同期で、何も fetch しない。スクリプトがあとから足した外部リソースは取りに行かない。
- `maxElements`(第 19 節のガード)。Workers では 9,000 以下を勧める(第 21 節)。
- 既存の `measureLayout`(描画を 1 回走らせてスナップショットを渡す)は変えていない。ライブレイアウトは、ページが変わるたびに読み直す必要がある用途向け。
- エンジンの wasm に `satoru_live_*` がないと、`enableLiveLayout` は分かるエラーで失敗する。

テスト: `tests/live-layout.test.ts`(4 件)。座標・スタイルの読み取りと追従(属性、テキスト、挿入、削除)、60 ステップの乱数変更で「作り直した文書の結果」と一致、`maxElements`、`dispose()` 後の縮退。html-to-image のテスト全体(210 件)も通る。

## 21. 1 要素あたりのメモリを半分にする(`css_length` の縮小)

調べ方: エンジンの wasm と同じ ABI(wasm32)で `sizeof` を出す小さな C++ を `em++` で作り、Node で動かした(`/tmp` の一時ファイル。ヘッダーだけで足りる)。

見つかったこと(変更前):
- `element` 基底クラスが **4,884 バイト**で、そのうち `css_properties` が 4,796 バイト。テキストノード(`el_text` 4,948)も空白(`el_space`)も、同じ大きさを持つ。
- `css_properties` の中身は、`css_length`(**44 バイト**)が多数。`css_margins` 176 ×2、`css_offsets` 176、`css_borders` 608 ×2(中に `css_border` 56 バイトが 4 つ + 角丸)、単体の `css_length` が 24 個、など。

変更: `css_length` の `calc()` / `min()` / `max()` / `clamp()` 用の部分(4 つの float、演算子、`std::vector<css_length>`)を、必要なときだけヒープに置くようにした(`std::unique_ptr<calc_data>`)。普通の長さ(ほぼ全部)は **44 → 12 バイト**。コピーは深いコピー(`calc` の長さだけ割り当てる)、ムーブは既定。公開の関数(`set_calc`、`set_math`、`get_op`、`get_operands`、`calc_*`)は変えていない。

結果:
| | 変更前 | 変更後 |
|---|---|---|
| `css_length` | 44 B | 12 B |
| `css_margins` / `css_offsets` | 176 B | 48 B |
| `css_borders` | 608 B | 224 B |
| `css_properties` | 4,796 B | 2,300 B |
| `element` | 4,884 B | 2,388 B |
| 6,000 要素の文書を開いたときの増加(Node、`external`) | +106 MB | **+53 MB** |
| 6,000 要素の最初のレイアウト読み取りまで(wasm 2 つ + ページ) | 169 MB | **130 MB** |

副産物として速くなった(メモリへの書き込みが減る): 6,000 要素の `color` 変更 1 回が 130 ms → 103 ms、`<body>` への追加が 149 ms → 106 ms。

確認: ビジュアルテスト 1,084 件、html-to-image 全 210 件、quickjs-dom 281 件、差分テスト 300 ステップ、C++ ホストテスト 5 件がすべて通る。

見積り: Workers の上限は、1 要素あたりの増加が半分になったので、概算で 12,000 要素前後まで広がるはず(**本番では未確認**。第 18 節の測り方で確かめる)。

残る大きなメモリ: テキストノード・空白がそれぞれ `css_properties`(約 2.3 KB)を持つこと。親のスタイルを共有する形にすれば、テキストの多いページでさらに減るが、`element::css()` の使われ方が広く、別の大きな変更になる。

本番の Workers での確認(`css_length` の縮小のあと、新しい isolate ごとに 1 リクエスト、有料プラン、上限なし):

| 要素数 | 結果 |
|---|---|
| 7,000 / 8,000 / 10,000 | 成功(以前は 7,000 で失敗) |
| 11,000 | 成功(変更 1 回) |
| 12,000 / 14,000 | レンダラーが `Invalid array buffer length` で失敗 → ガードが捕まえて縮退、応答 200 |

**上限は約 6,000〜7,000 要素から、約 11,000 要素に広がった**。10,000 要素のページで変更を 20 回(`color`、続けて `append`)繰り返しても、同じ isolate で全て成功した(リークなし)。

CPU 時間(`wrangler tail` の `cpuTime`): 最初のリクエスト(isolate の起動 + 文書を開く)は 7,000〜10,000 要素で約 2.1〜3.0 秒。変更 1 回あたりは、8,000 要素で約 215 ms、10,000 要素で約 350 ms(起動分を引いた概算)。20 回の変更を重ねたリクエストは 6.7〜9.7 秒の CPU で、有料プランの既定(30 秒)に収まる。

推奨: Workers の `maxElements` は **9,000 前後**(ここで測った限界の約 8 割。ページの内容によって 1 要素あたりのメモリが変わるため、余裕を持たせる)。

## 22. テキストノードのスタイル共有(メモリ)

第 21 節で残った最大のメモリ、テキストノード・空白がそれぞれ持つ `css_properties`(約 2.3 KB)をなくした。

- `element` は自分のスタイルを `m_css_own`(ヒープ)に持ち、`m_cssp` で参照する。テキスト(`el_text`/`el_space`)とコメントは自分のスタイルを持たず、`m_cssp` が共有のものを指す。
- テキストのスタイル(親のフォント・行高・`white-space` など、`display: inline-text`、相対配置の引き継ぎ)は、同じ親の下のテキストで同一。`html_tag::text_css()` が親ごとに 1 つ作り(`build_text_css`)、子のテキストが `compute_styles` で受け取る。親の `compute_styles` の先頭で破棄するので、親のスタイルが変わると次の子の計算で作り直される。
- 子を持たない要素のスタイルは、これまでどおり要素ごとに持つ(`element` 自体の大きさは変わらないが、スタイルがヒープに移った)。

| | 変更前 | 変更後 |
|---|---|---|
| 6,000 要素(`div > span > 文字`)の文書を開いたときの増加(Node、`external`) | +53 MB | **+21 MB** |
| 1 要素あたり | 約 8.8 KB | **約 3.6 KB** |

確認: ビジュアルテスト 1,084 件、html-to-image 210 件、quickjs-dom 281 件が通る。Workers の上限は、テキストの多いページでさらに広がるはず(**本番では未確認**)。

本番の Workers での確認(テキストのスタイル共有のあと、`div > span > 文字` 型、新しい isolate ごとに 1 リクエスト、有料プラン):

| 要素数(div + span) | 結果 |
|---|---|
| 10,000 / 12,000 / 13,000 / 13,600 | 成功(`color` 変更 3 回) |
| 12,000 で `append` 10 回 | 成功(リークなし) |
| 14,000 / 16,000 | レンダラーが `Invalid array buffer length` で失敗 → ガードが捕まえて縮退 |

**上限は約 11,000 から約 13,600〜14,000 要素に広がった**(+25% ほど。この型のページでは要素の半分がテキストを 1 つだけ持つので、共有で減るのはその分)。テキストが多く要素が少ないページほど効く。推奨の `maxElements` は **10,000 前後**に更新する(測った限界の約 7 割)。測定用の Worker は削除済み。

## 23. 6,000 要素での 1 回あたりの内訳(測定のみ)

`scripts/proto-live-split.mjs`(Node、6,000 要素、`color` を 1 要素だけ変えて末尾の `getBoundingClientRect` を読む)と `proto-live-probe6k.mjs`。

| | `color` | `height` |
|---|---|---|
| 合計 | 76 ms | 171 ms |
| `satoru_live_apply`(再スタイル + 描画木の作り直し + レイアウト) | 63 ms | 65 ms |
| `satoru_live_sync`(箱とスタイルの比較・差分) | 12 ms | 48 ms |
| ページ側(ジャーナル・差分の反映) | 1 ms | 57 ms |

`apply` の中身(全体を再スタイルした場合の参考値): 描画木の作り直し 約 18 ms、全体レイアウト 約 45 ms。全体の再スタイルは約 120 ms かかるが、通常の経路は変更した要素の部分木だけを再スタイルするので `color` では小さい。

結論: 1 回あたりのほぼすべてが「描画木の作り直し + 全体レイアウト」(要素数に比例)。これ以上速くするには、変わった箱の祖先から先だけを再レイアウトする部分レイアウトが要る。`height` で `sync` とページ側が増えるのは、位置が動いた箱が多い(後ろの要素すべて)ため。見込みの大きい作業で、正しさの確認(差分テスト)も大きくなる。

## 24. 見た目だけの変更はレイアウトを飛ばす

`live_relayout` に `attrs_only` を足した。変更が `class` / `style` / `id` / `title` / `role` / `tabindex` / `data-*` / `aria-*` の属性だけ(子の変更・テキスト・その他の属性は対象外)で、再スタイルする部分木が 400 要素以下のとき、再スタイルの前後でその部分木の「カスケード後のスタイル」(`html_tag::m_style`)を比べる。違う値が `color` / `background-color` / `opacity` / `cursor` / 各種 `*-color` だけなら、描画木の作り直しと全体レイアウトを飛ばす(箱は動かない)。

比較は保守的: 値が同じと言えるのは整数・小数・色・文字列・長さ(文字列表現が同じ)だけで、それ以外(画像・トークン列・`var()` を含むもの)が違えば、見た目だけとは見なさずレイアウトし直す。

| 6,000 要素、`color` を 1 要素変えて読む(Node) | 変更前 | 変更後 |
|---|---|---|
| 合計 | 76 ms | **13 ms** |
| `satoru_live_apply` | 63 ms | 0.3 ms |

残る 12 ms は `satoru_live_sync` の全箱の走査。`height` など箱が動く変更は従来どおり(約 170 ms)。確認: 差分テスト(300 ステップ、`class` / `style` の変更を含む)と専用テストが通る。部分レイアウト(動く箱の祖先から先だけ)は未着手。
