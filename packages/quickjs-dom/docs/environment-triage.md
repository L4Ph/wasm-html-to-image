# テスト環境のトリアージと4方針

状態: 記録(2026-11-04)。コード本体(`src/vitest.ts` / `jest.cjs`)は変更しない。ここは
「どの失敗を移行し、どれを残留させるか」と、その判定を再現するための検証手順を残す場所。

対象は `packages/quickjs-dom` のテスト環境(`wasm-quickjs-dom/vitest` と
`wasm-quickjs-dom/jest`)である。Phase 4 の受け入れ計測
(`scripts/tl-suite.mjs`、`@testing-library/dom` v10.4.2、657 tests)で観測した
「jsdom では通るが、この環境では落ちる」3件を、ここで確定した分類に移す。

## 1. トリアージの移行

| # | 失敗(observation) | 発生源 | 分類 | 扱い |
|---|---|---|---|---|
| 1 | legacy fake timers 下の `waitFor` が完了しない | jest の fake timers がテスト側の realm だけを進める。ページは自前の時計を持つ | 環境要因(bridged realm) | 残留。jsdom で実行する |
| 2 | modern fake timers 下の `waitFor` が完了しない | 同上 | 環境要因(bridged realm) | 残留。jsdom で実行する |
| 3 | `::before` / `::after` の accessible name で jsdom 自身の console error を検査する | jsdom の computed style と console 出力の挙動 | jsdom 固有(仕様の DOM 契約ではない) | 残留。jsdom で実行する |

これらは DOM の欠落ではない。台帳では `tests/known-gaps.json` の
`tlSuite.accepted` に機械可読で登録し、`scripts/tl-suite.mjs` は
「未登録の only-ours 失敗」が出たら失敗する。受け入れ数は
baseline 657 / ours 654 / total 657(すべて v10.4.2 時点)。

`tlSuite.accepted` の `match` は実行結果のキー
`<test file> :: <test title>` に対する正規表現である。テスト名や版が変わったら、
移行ではなく再トリアージとして台帳を更新する。

## 2. 方針1: fake timers — real-timer は移行、fake-timer は残留

- **real-timer は移行する。** `tests/env/testing-library.test.ts:71-95` の
  `waiting` ブロックは real timer だけで書かれている
  (`setTimeout(..., 20)`、`waitFor`、`findByRole`、`MutationObserver`)。
  これはこの環境で通るので、jsdom から移す。
- **fake-timer は残留させる。** jest の legacy/modern fake timers は
  テスト側 realm の `setTimeout` / `setInterval` / `requestAnimationFrame` を
  差し替えるが、ページの時計は QuickJS 側の `host.timer` で動く。
  `jest.advanceTimersByTime()` はページの時計を進めないため、`waitFor` の
  fake-timer 分岐はページの変化を待てない。したがって fake timers を使う
  テストは jsdom 環境に残す。
- 移行判定は「実時間で完結するか」で行う。fake timers が必要なテストを
  この環境へ移す場合は、まずページ側の時計を進める手段を設計する
  (本ドキュメントの範囲外。コード変更を伴う)。

## 3. 方針2: rAF の組合せ表

ページの `requestAnimationFrame` は `scripts/edge-js/shims.js` で
`setTimeout(fn, 16)` として実装され、ページの `host.timer` に載る。
`pretendToBeVisual` が false のときは `boot.js` が
`requestAnimationFrame` / `cancelAnimationFrame` を削除する。
したがって「visual」と「timer の種類」の4通りは次のようになる。

| visual | timer | ページの rAF | 何が起きるか | 移行 |
|---|---|---|---|---|
| true | real | ある(16ms のページ setTimeout) | ページの時計はホストの実時間で進む。`waitFor` は real-timer 分岐(setInterval + MutationObserver)で完了する | **移行する**(環境の既定) |
| false | real | ない(グローバルから削除) | ページのタイマーは動くが、rAF を feature-detect するコードは非 visual 経路を取る。`waitFor` は real-timer 分岐なので完了する | 移行可。rAF が要るテストだけ `pretendToBeVisual: true` にする |
| true | fake | あるが、テスト側の fake clock では進まない | `advanceTimersByTime()` はテスト realm だけを進め、ページの 16ms タイマーには届かない。`waitFor` の fake-timer 分岐もページの rAF/タイマーを進められず timeout する | **残留**(jsdom) |
| false | fake | ない | ページのタイマーは実時間のまま。fake clock はページを進めない。rAF 不在の経路でも `waitFor` の fake-timer 分岐はページの変化を待てない | **残留**(jsdom) |

要点: fake timers の下では visual の真偽によらず、ページの rAF とページの
タイマーはテスト側の時計に従わない。real timers の下では visual=false でも
`waitFor` は動くが、rAF 依存のコードは non-visual の分岐になる。

## 4. 方針3: 外部 script の待機 — 環境は外部資源を未対応と宣言する

`JSDOM` のコンストラクタは同期で、外部スクリプト・モジュール・`fetch` は
`dom.ready` の後ろで進む。一方、vitest / jest の env `setup()` は
`new JSDOM(...)` の直後にグローバルを設置して返るだけで、`dom.ready` を
待たない(env は `dom` 自体も公開しない)。

したがって本環境の立場は次のとおり:

- **外部資源(`<script src>`、外部 stylesheet、外部 `fetch` を待つ初期化)は
  env 未対応とする。** これらを必要とするテストは env では実行しない。
- 外部資源が必要な検証は、env ではなく素の `JSDOM` を使い、
  `await dom.ready` してから操作する。`scripts/tl-suite.mjs` の
  dom-testing-library スイートは外部資源に依存しないため、この制約の外にある。
- 待機が必要な場合の逃げ道として `environmentOptions` の `awaitReady: true`
  (既定 off)を追加した。旗 ON のときだけ `setup()` が非同期になり、
  `dom.ready` を engine timeout(既定 10 秒)との race で待つ。旗 OFF では
  同期のまま、タイマーも動かない。外部資源の既定未対応は変えない。

## 5. 方針4: teardown は同期 `close()` だけでは不足する

`dom.close()` は同期で、ページのタイマーを止め、以降のオブジェクト操作を
無効にする。しかし次のものは待たない。

- 進行中の外部スクリプト読み込みと `fetch`
- ページ内の未解決 Promise / マイクロタスク
- ホスト側の `arm()` が積んだ `setTimeout` のコールバック

そのため「テスト終了 → 即 `close()`」だけでは、次のテストやプロセス終了と
競合しうる。破棄手順は次を標準とする。

1. 可能なら `await dom.ready.catch(() => {})` で初期化の完了(または失敗)を待つ。
   外部資源を使わないページでも、進行中のマイクロタスクを吸収するために置く。
2. `dom.close()` を呼ぶ(同期)。タイマーとページオブジェクトを止める。
3. env の `uninstall()` でグローバルを戻す(vitest / jest の teardown が行う)。
4. `window` / `document` / 要素の参照をテスト側から落とす。
5. 必要なら `await new Promise((resolve) => setTimeout(resolve, 0))` で
   ホストのキューを1巡させてから次のテストへ進む。

**再現済み**: `tests/jsdom.test.ts` の「awaits an in-flight external script」が
最小再現である。同期 `close()` だけでは、まだ fetch が始まっていない外部 script は
abort され、ページは読み込み途中のままテストが終わる。このテストは 3 回の繰り返しで
flake 0 を確認する。env の teardown は `jest.cjs` / `src/vitest.ts` とも
「`await dom.ready.catch(() => {})` → `uninstall()` → `dom.close()` →
`setTimeout(0)` で host を 1 tick」の順に固定した(上記 1〜3 と 5)。

## 6. 検証の強化

`scripts/` に次の検証を置く。`scripts/verify.mjs` が既定で
surface / env / perf を順に実行し、`--full` で testing-library スイートを足す。

| 検証 | スクリプト | 合格条件 |
|---|---|---|
| surface のドリフト | `check-gaps.mjs`(内部で `surface-diff.mjs`) | `tests/known-gaps.json` の surface 事実と一致 |
| env のドリフト | `env-diff.mjs` | 欠落が `Window` / `Atomics` / `WebAssembly` / `_` 内部名だけ |
| 性能ガード | `perf-check.mjs` | host-driven DOM の build+read が jsdom の **2倍以内** |
| testing-library | `tl-suite.mjs --deny-skips --dual-run` | baseline 657 / ours 654 / total 657、2回実行の失敗集合が同一(差分ゼロ)、skip なし、only-ours 失敗がすべて `tlSuite.accepted` に登録済み |

`tl-suite.mjs` は台帳の `tlSuite` から期待値と登録済み失敗を読む。
`--expect-baseline` / `--expect-ours` / `--total` で上書きでき、
`--runs=N` で実行回数を変えられる(`--dual-run` は `--runs=2` の別名)。
`--deny-skips` は pending / skipped / todo / disabled が1件でもあれば失敗する。
`--help` は実行せずに用法を表示する。

初回の `tl-suite` は dom-testing-library の該当タグを
`node_modules/.cache/tl-dom-suite` に clone し、依存を install する(ネットワークが必要)。
`perf-check` と `surface-diff` はビルド済み `dist/` を import するので、
先に `pnpm --filter wasm-quickjs-dom build` を実行する。
