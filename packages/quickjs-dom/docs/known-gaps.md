# Known gaps: the decisions that will not change

状態: 記録(2026-11-04)。ここは「直さない」と決めた残件の一覧である。直せる欠落は
`tests/known-gaps.json`(surface / semantic の台帳)と Phase レポートにあり、この文書は
そのうち **wontfix と宣言したもの** だけを集める。判断を変えるときは、ここを更新して
から実装する(先にコードを変えない)。

## 1. fake timers は残留(wontfix)

jest の legacy / modern fake timers はテスト側 realm の `setTimeout` / `setInterval` /
`requestAnimationFrame` を差し替えるが、ページは QuickJS 側の自前の時計(`host.timer`)で
動く。`jest.advanceTimersByTime()` はページの時計を進めないため、`waitFor` の
fake-timer 分岐はページの変化を待てない。これは bridged realm という環境の構造から
来るもので、DOM の欠落ではない。

- 方針: fake timers を使うテストは jsdom 環境に残す。real-timer のテストだけ移行する。
- 台帳: `tests/known-gaps.json` の `tlSuite.accepted`(`environment.fake-timers-legacy` /
  `environment.fake-timers-modern`)。
- 詳細: `docs/environment-triage.md` section 2 と section 3。
- 再検討の条件: ページ側の時計をテストから進める API を設計するとき(コード変更を伴う)。

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

## 3. `Window` インターフェース(wontfix)

`Window` はページの global object そのもののインターフェースで、その prototype を差し替えると
ランタイムと bridge の前提(global の同一性、プロパティの解決)が壊れる。このため
`Window` は window の global 名として公開しない。`env-diff` の許容欠落にも
`Window` として記録済み。

- 帰結: `window instanceof Window` / `typeof Window` は使えない。`window` のメンバー
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
