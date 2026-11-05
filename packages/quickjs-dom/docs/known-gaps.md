# Known gaps: the decisions that will not change

状態: 記録(2026-11-04)。ここは「直さない」と決めた残件の一覧である。直せる欠落は
`tests/known-gaps.json`(surface / semantic の台帳)と Phase レポートにあり、この文書は
そのうち **wontfix と宣言したもの** だけを集める。判断を変えるときは、ここを更新して
から実装する(先にコードを変えない)。

## 1. fake timers(2026-11-05 に再確認: 動く。以前の wontfix は取り下げ)

以前は「jest の fake timers はテスト側 realm だけを進め、ページの時計は別」と記録していたが、現在の実装では
ページのタイマーはホストの `setTimeout` で起こされ、期限はホストの `Date` で測る(`src/jsdom.ts` の `arm()` と
`src/page.ts` の `timer`)。runner が fake timers でそれらを差し替えると、ページのタイマーもその時計で進む。

- 確認した組み合わせ: Vitest の `vi.useFakeTimers()` + `advanceTimersByTimeAsync`(`window.setTimeout`、ページ自身の
  `setInterval`、`vi.setSystemTime` のあとのページの `Date` と `Date.now()`)、Jest の modern と legacy の fake timers +
  `@testing-library/dom` の `waitFor`。テストは `tests/env/fake-timers.test.ts` と `tests/jest/fake-timers.jest.cjs`。
- 同じ制約: Vitest では `waitFor` の fake-timer 分岐が `jest` の有無で決まるため、`vi.useFakeTimers()` 下の `waitFor` は
  jsdom でも進まない(`advanceTimers` オプションで進める)。環境の差ではない。
- 未確認: `tl-suite` の `environment.fake-timers-legacy` / `-modern` の2件(台帳 `tlSuite.accepted`)。リポジトリの
  clone が要るので今回は再実行していない。再実行して通るなら台帳から外す。
- `requestAnimationFrame` は 16ms のページのタイマーなので、`pretendToBeVisual` のときは同じ時計で進む。

## 2. XML と adoption agency の残り(wontfix)

HTML パーサは標準の木構築の主要部分(暗示的な table の section/row、foster parenting、
簡略化した adoption agency と active formatting elements の再構築、SVG の adjusted name、
isindex/command の通常要素化)を実装済み。次の残りは wontfix とする。

- adoption agency の furthest-block の入れ替え(完全版)は実装しない。簡略版で
  実用上のコーパスは通っており、完全版は木構築の書き直しになる。
- XML(`DOMParser` の XML 型)は名前空間を解決しない(qualified name を保つ)、
  processing instruction を読み飛ばす、CDATA を text にする(CDATA node 種別を持たない)。
- `createElementNS` はパーサの adjustment 以外では与えられた case をそのまま保つ。
- MathML の text integration point(mi/mo/mn/ms/mtext の子)は HTML namespace にしない。

HTML 文書としての DOM 契約には影響しない範囲であり、必要になった時点で再トリアージする。
- 台帳: `tests/known-gaps.json` の `semantic.areas[parse]`。

## 3. `Window` インターフェース(global の prototype は差し替えない)

`Window` はページの global object そのもののインターフェースで、その prototype を差し替えると
ランタイムと bridge の前提(global の同一性、プロパティの解決)が壊れる。このため
`Window` は window の global 名として公開しない。`env-diff` の許容欠落にも
`Window` として記録済み。

- 更新(2026-11-05): `Window` は呼べないコンストラクタとして公開し、`Symbol.hasInstance` で page の global を認識する。`window instanceof Window` と `typeof Window` は通る。global の prototype は差し替えない(下の理由は変わらない)。
- 以前の帰結: `window instanceof Window` / `typeof Window` は使えない。`window` のメンバー
  (`document`、`location`、イベント、`getComputedStyle` など)はすべて動く。
- 台帳: `tests/known-gaps.json` の `surface.missing-features`(`Window` が唯一の残件)、
  `scripts/env-diff.mjs` の `ALLOWED_MISSING`。
- 再検討の条件: global object の prototype を安全に差し替えられるランタイム表現を
  設計するとき。それまでは wontfix。

## 4. 参考: env の外部資源と teardown(実装済みの境界)

wontfix ではないが、env の境界として固定しておく。

- 外部資源は既定で未対応: `setup()` は `dom.ready` を待たずに返る。待つ必要がある
  テストは `environmentOptions` の `awaitReady: true`(既定 off)を指定する。旗 ON の
  ときだけ setup が非同期になり、engine timeout(既定 10 秒)で打ち切る。旗 OFF では
  同期のままタイマーも動かない。
- teardown は `await dom.ready.catch(() => {})` → `uninstall()` → `dom.close()` →
  host を 1 tick 進める、の順で固定。in-flight の外部 script を abort しない。
- 詳細: `docs/environment-triage.md` section 4 と section 5。
