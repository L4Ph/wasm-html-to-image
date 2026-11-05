# jsdom 互換層の設計 (wasm-quickjs-dom)

状態: 設計案(未着手)。

## 1. 目的と非目的

**目的**: Node(V8)側のコードから、`new JSDOM(html)` と同じ形で `window` / `document` / 要素を同期的に触れるようにする。
これにより `@testing-library/*`、React Testing Library、`jest-environment-jsdom` / vitest の jsdom 環境の代わりに使えるようにする。

**非目的**:
- jsdom のコードや内部 API の再現(`jsdom.reconfigure`、`jsdom.internals` など)。
- 完全なレイアウトと CSS カスケード(別の課題。§9)。
- 仕様の全 API。足りない API は、実際にテストで必要になったものから足す。

## 2. 現状のどこが問題か

DOM は QuickJS の wasm の中にあり、Node 側は `dom.eval()` で JSON の値を出し入れするだけ。要素そのものを受け取れない。

ただし、次の事実が設計の前提になる。

- wasm のインスタンスは**同期**で呼べる。`createDOM` が非同期なのは、スクリプトの待ち合わせ(fetch、タイマー)のためで、DOM の読み書きそのものは同期。
- 呼び出しのコストが小さい。Node から wasm の QuickJS を呼ぶのは、ソースを毎回コンパイルする `eval` でも 1 回 4〜8 µs(測定: `1+1` が 4.8 µs、`JSON.stringify` を含めて 7.6 µs)。ハンドル番号で引く専用の入口にすれば 1 µs 前後まで下げられる見込み。
- jsdom で 1 要素の生成と追加は約 13 µs(2000 要素で 26 ms)。境界を 1 回越えるコストが同じ桁なので、「1 操作 = 1 回の呼び出し」なら jsdom と同程度か、数倍以内に収まる。

## 3. 方式の比較

| 案 | 内容 | 長所 | 短所 |
|---|---|---|---|
| A. 同期 RPC のプロキシ(**推奨**) | DOM は wasm の中のまま。Node 側にハンドルを持つ薄いオブジェクトを置き、操作ごとに同期呼び出し | 今のコードをほぼそのまま使える。ページのスクリプトも同じ DOM を見る | 呼び出しの多いコードは遅くなる。GC の扱いが要る |
| B. DOM の核を Node の wasm に直接載せ、JS 層を V8 で動かす | C の核を QuickJS なしの wasm にし、`nativedom.js` を V8 に移す | 速い。境界の越え方が素直 | C のコードが QuickJS の API(`JSValue`)に深く依存していて、書き直しに近い。ページのスクリプトは別の VM になり DOM を共有できない |
| C. jsdom をそのまま使う | - | 完成している | 重い。エッジで動かない。このパッケージの意味がない |

**A を採る**。B は速いが、ページのスクリプト(QuickJS)と DOM の共有ができなくなり、作り直しの量が大きすぎる。A は、遅くなる部分(多数回の往復)を後から「一括」「キャッシュ」で縮められる。

## 4. 全体構成

```
Node (V8)                                   wasm (QuickJS)
─────────────────────────────────────       ─────────────────────────────────
テストコード / testing-library / React       ページのスクリプト
   │ document.querySelector("a")             │
   ▼                                         │
 生成されたクラス (Window, Node, Element…)    │
   │ 属性の読み書き・メソッド = op           │
   ▼                                         ▼
 Bridge ── call(op, handle, args) ──►  ハンドル表 id → ノード (強参照)
        ◄── 値 / ハンドル / エラー ──   ネイティブ DOM (csrc/nativedom*.h)
        ◄── callback(id, args) ───────  イベントリスナー (Node 側の関数)
```

Bridge は 4 つの部品でできている。

1. **ハンドル表** (wasm 側): `id → JSValue`。Node に渡したノードを GC から守る。
2. **値の符号化** (両側): プリミティブはそのまま、ノードと `NodeList` などはハンドル、配列はハンドルの配列、関数はコールバック番号。
3. **スキーマ** (起動時に 1 回): wasm 側のインターフェース(名前、継承、アクセサ、メソッド、定数)を一覧にして Node に送り、Node 側で同じ形のクラスを生成する。
4. **コールバック**: wasm から Node の関数を同期で呼ぶ入口(§6)。

## 5. 値の受け渡し

| ゲストの値 | Node 側に見えるもの |
|---|---|
| string, number, boolean, null, undefined | そのまま(`undefined` と `NaN` / `Infinity` は区別して符号化) |
| ノード、`Document`、`Event`、`MutationRecord`、`DOMTokenList`、`Attr`、`Range` など DOM のオブジェクト | 生成クラスのインスタンス(ハンドル 1 つ)。**同じノードは同じオブジェクト**(`Map<id, WeakRef>` で保証) |
| `NodeList`、`HTMLCollection`、`NamedNodeMap` | ライブなコレクション用のオブジェクト。`length` と添字はその都度問い合わせる。`for…of`、`Array.from` が使える |
| 配列(DOM でない) | 要素ごとに符号化した配列のコピー |
| プレーンなオブジェクト(`CustomEvent` の `detail` など) | JSON 化できるものはコピー。できないものは例外 |
| 関数 | Node → ゲストに渡すときはコールバック番号。ゲストの関数をそのまま受け取ることは**しない**(必要なら `window.eval` で呼ぶ) |
| 例外 | `DOMException` はクラスごと対応(`name`、`code`、`message`)。それ以外は `Error` に変換(元のスタックを添える) |

Node から渡す値も同じ規則で逆に符号化する。ハンドルは、渡し先のインスタンスが違えば例外(別のページのノードを混ぜない)。

## 6. 同期コールバック(イベント)

テストでは `addEventListener("click", fn)` の `fn` が Node の関数になる。`dispatchEvent` の最中に wasm から Node へ戻り、その中でまた wasm を呼ぶ(再入)。

- wasm の import に `host.callback(id, argsPtr, len) → resultPtr` を足す(`src/runtime.ts` の `host` に `call` を追加)。
- ゲスト側の関数 `__cb(id)` が、渡された引数(多くは `Event` のハンドル)を符号化して `host.callback` を呼び、戻り値を復号する。
- 再入を許す。`vm.eval` は、実行中にも呼べるよう **再入可能にする**(今の実装は単一のスタックを前提にしているので、再入の数を数えて締切 `setDeadline` とジョブの実行 `jobs()` の位置を直す)。
- Node の関数が例外を投げたら、ゲストに例外として渡す(`dispatchEvent` は他のリスナーを続ける。仕様どおり `error` イベントを報告する)。
- `removeEventListener(type, fn)` は、同じ `fn` に同じ番号を割り当てるため、`WeakMap<Function, id>` を持つ。
- `handleEvent` を持つオブジェクト(`{ handleEvent() {} }`)も同様に扱う。

## 7. `JSDOM` の外観

```ts
import { JSDOM } from "wasm-quickjs-dom/jsdom";

const dom = new JSDOM(html, { url, runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
dom.window.document.querySelector("h1").textContent;
dom.serialize();
dom.window.close();
const dom2 = await JSDOM.fromURL(url, options);
```

- **コンストラクタは同期**。パースと、インラインスクリプトの実行までを同期で行う。外部スクリプト、モジュール、`fetch` は jsdom と同じくバックグラウンドで進み、終わったら `load` を発火する(今の `createDOM` の待ち合わせ処理を、Node のタイマーで駆動する形に作り替える)。
- **タイマー**: ゲストの `setTimeout` は `host.timer` を通して Node の `setTimeout` に予約し、時間が来たらゲストの `__fire(id)` を呼ぶ。`window.close()` で全部止める。
- **`runScripts`**: `"dangerously"` はページのスクリプトを実行、`"outside-only"` は `window.eval` だけ、未指定はスクリプトを実行しない(jsdom と同じ既定)。
- **`window.eval` / `vm.runInContext` 相当**: `dom.getInternalVMContext()` は提供しない。代わりに `dom.window.eval(code)` を提供する(戻り値は §5 の規則で変換)。
- **`virtualConsole`**: ゲストの `console` とエラーを `VirtualConsole`(`EventEmitter`)へ流す。`jsdomError` の種類は、スクリプトエラー、未処理の拒否、未実装の機能の 3 つ。
- **`new JSDOM()` の `url` / `referrer` / `contentType` / `cookieJar`**: `url` と `referrer` は対応。`cookieJar` は渡された `tough-cookie` 互換のオブジェクトを使うか、内蔵の簡易ジャーで代用する。

## 8. テスト環境のアダプター

- `wasm-quickjs-dom/vitest`(名前で指定するなら別パッケージ `vitest-environment-wasm-quickjs-dom`、`environment: "wasm-quickjs-dom"`): vitest の `environment`(`setup()` で `JSDOM` を作り、`window` のプロパティを `global` に写し、`teardown()` で閉じる)。
- `wasm-quickjs-dom/jest`: `jest-environment-*` 形式。
- グローバルに写すのは、jsdom 環境と同じ一覧(`document`、`window`、`HTMLElement`、`Event` 系、`MutationObserver`、`getComputedStyle`、`requestAnimationFrame` など)。Node 側に既にあるもの(`fetch`、`URL`、`TextEncoder`)は上書きしない。
- 型は `lib.dom.d.ts` をそのまま使えるようにし、独自の型は作らない(クラスの名前と形が同じため)。
- 環境のトリアージと4方針(fake timers、rAF、外部資源、teardown)は [environment-triage.md](./environment-triage.md) に記録する。real-timer のテストは移行し、fake-timer は jsdom に残す。外部資源は env 未対応、teardown は同期 `close()` だけでは不足する(要再現)。

## 9. 必要になる実装(段階)

| 段階 | 内容 | 完了の基準 |
|---|---|---|
| P0 | 同期の呼び出し口。再入、ハンドル表、値の符号化、締切の扱い | 往復 1 回 ≤ 2 µs(`o.a` 相当)。再入 3 段で正しい。ハンドルの解放で wasm のメモリが戻る |
| P1 | スキーマの生成とクラスの生成、同一性、ライブコレクション | 差分テスト(既存の乱数プログラム)を、**Node 側のプロキシ**に対して jsdom と回して全て一致 |
| P2 | コールバックとイベント、`MutationObserver`、`CustomEvent`、`Event` のハンドル | `dispatchEvent`、リスナー、`stopPropagation`、再入、例外が jsdom と同じ |
| P3 | `JSDOM` の外観、タイマー、スクリプト、`fromURL`、`virtualConsole` | jsdom のドキュメントの基本の使用例が通る |
| P4 | vitest / jest の環境、`@testing-library/dom` と React Testing Library の実テスト | 下の受け入れテストが通る |
| P5 | 速度: プリフェッチ、キャッシュ、一括呼び出し | 下の性能基準を満たす |

## 10. 受け入れテスト

1. **差分テスト**: 既存の `tests/nativedom.test.ts` と同じ乱数プログラムを、プロキシ経由(Node 側)で jsdom と同時に実行し、観測が一致すること。
2. **`@testing-library/dom` の自身のテスト**: 同ライブラリのテストを、環境を差し替えて実行。失敗は一覧にし、理由(未実装の API、レイアウト、CSS)ごとに分類する。
3. **React**: `react-dom` と `@testing-library/react` で、状態、イベント、`act()`、`useEffect`、フォーム入力を含む小さなアプリのテスト。
4. **`user-event`**: クリック、入力、タブ移動、`pointer` の列。
5. **メモリ**: 1 万ノードを作って捨てる操作を繰り返し、wasm のメモリとハンドル表が増え続けないこと。

## 11. 性能の見積もりと基準

境界の越え方 1 回 ≈ 1〜4 µs(§2)。

| 操作 | 呼び出し回数 | 見積もり |
|---|---|---|
| `document.querySelector(sel)` | 1 | jsdom 以下 |
| `el.textContent` | 1 | jsdom 以下 |
| `el.children` を `for…of` で全部読む(1000 個) | 1 + 1000 回の添字 | **1 回の `children` で、ハンドルの配列を一括で返す**ことで 1〜2 回にする |
| React の描画 1000 要素 | 数千〜数万 | jsdom の 1〜3 倍と見込む(測定して確認) |
| `testing-library` の `getByRole`(深い走査) | 数千〜数万 | **`getByRole` などの重い処理はゲスト側で実行**する専用の入口を用意すれば、jsdom より速くできる |

最適化の柱:
- **キャッシュ**: `nodeType`、`nodeName`、`localName`、`namespaceURI` は不変なのでハンドルと一緒に返す。`parentNode` などは、変更の世代番号 `N.version()` を見て無効化する。
- **一括返却**: `childNodes`、`children`、`attributes`、`classList` は、長さと要素のハンドルをまとめて返す。
- **一括実行**: 書き込みの列を 1 回で送る任意の API(テストコードの標準経路には載せない)。実装は `bridge.batch([ops])` で、`["tree", parent, { tag, attrs, text, children }]` がホスト側レンダラの持つ木を 1 往復で作り、`["call"]` / `["set"]` / `["new"]` を同じ配列に混ぜられる。既に文字列の HTML がある場合は、ノードをホストで組み立てず `innerHTML` を 1 回代入する方が短い(パーサが C 側で一括生成する)。
- **ゲスト側の関数**: `@testing-library/dom` の `queries` を、ゲストの中で動かせるように同梱(任意)。

**性能基準(P5)**: テストの標準的な例(React の小さなアプリ 100 本)の総実行時間が jsdom の 2 倍以内。それを超える場合は、遅い順に原因を調べる。

## 12. リスクと対策

| リスク | 内容 | 対策 |
|---|---|---|
| 往復の多いコードが遅い | testing-library は DOM を何度も走査する | §11 のキャッシュ、一括、ゲスト側の実行。測定を先にやる(P1 の終わりで React の描画を測る) |
| ハンドルのリーク | `FinalizationRegistry` は実行時期が不定 | 明示の `dispose()`、テスト環境の `teardown` で全ハンドルを解放。上限を超えたら警告 |
| 再入と締切 | Node の関数の中で長く待つと、ゲストの締切が切れる | 締切は「ゲストのスクリプトを実行している時間」だけを数え、Node のコールバックの時間は除く |
| 同一性 | `el === document.body` が崩れる | ノードごとに 1 つの Node 側オブジェクト(`WeakRef` つきの表)。`FinalizationRegistry` で表も掃除 |
| ライブコレクション | `childNodes` が生きている | コレクションは参照を持たず、毎回問い合わせる。`Array.from` は 1 回の一括呼び出し |
| DOM の仕様の欠け | `getComputedStyle`、`styleSheets`、レイアウト、フォーム検証など | 受け入れテスト 2 の失敗一覧から優先度を付ける。`getComputedStyle` は、最小限のカスケード(`style` 属性、`<style>` の単純なセレクタ、継承)を C で作る案を別に検討 |
| スキーマとゲストの不一致 | ゲストの実装が変わると Node 側のクラスが古くなる | スキーマはビルド時に生成して同梱し、ゲストのバージョンと一緒に検査 |
| ブラウザのような非同期性 | `JSDOM` の同期コンストラクタと外部リソース | §7。外部リソースは `load` 後にだけ見える。同期に見たいときは `await dom.ready` を足す |

## 13. 決めること

1. 公開の仕方: 既存の `wasm-quickjs-dom` に `./jsdom`、`./vitest`、`./jest` の export を足す(推奨)か、別パッケージにするか。
2. 最初の対応範囲: P0〜P2(プロキシ、イベント)と、vitest 環境 + `@testing-library/dom` だけを先に作る(推奨)か、P5 まで一度に作るか。
3. `getComputedStyle` の方針(§12)。

## 14. 最初の 1 週間でやること(測定を先に)

1. `host.callback` と再入を入れ、`o.a` 相当の往復が 2 µs 以下になるか測る。
2. `Element` / `Node` / `Document` だけのスキーマを生成し、`document.body.appendChild(document.createElement("div"))` が Node 側から動くようにする。
3. 小さな React アプリ(カウンター)を `react-dom` で描画し、jsdom と時間を比べる。ここで 2 倍を大きく超えるなら、§11 の最適化を先に設計し直す。

## 15. happy-dom 互換の設定表 (P1)

`JSDOMOptions` は happy-dom の4つの資源トグルを、トップレベルまたは `settings` オブジェクトで受ける
(トップレベルが優先)。既定はすべて `true` で、quickjs の挙動を変えない。トグルは拒否権であり、
資源を要求する jsdom 側のスイッチ(`resources: "usable"`、`runScripts: "dangerously"`)はそのまま必要。

| happy-dom | `JSDOMOptions` | 既定 | この実装での効果 |
|---|---|---|---|
| `settings.enableCSSFileLoading` | `enableCSSFileLoading` | `true` | `<link rel="stylesheet">` の取得は `resources: "usable"` のときだけ。`false` はその取得を止める。`<style>` と `style` 属性は常にカスケードする |
| `settings.enableJavaScriptEvaluation` | `enableJavaScriptEvaluation` | `true` | `false` は `runScripts: "dangerously"` でもページのスクリプト(inline / external)を実行しない。`"outside-only"` の `window.eval` はホスト駆動なので残る |
| `settings.enableImageFileLoading` | `enableImageFileLoading` | `true` | 受理のみ。DOM は画像を取得しない(描画側が `setImageResource()` で公開する)ため効果なし |
| `settings.enableIframePageLoading` | `enableIframePageLoading` | `true` | 受理のみ。入れ子の閲覧コンテキストを読み込まない(`srcdoc` は空文書の種)ため効果なし |

JS / CSS の既定値の対応:

| 項目 | jsdom | happy-dom | `wasm-quickjs-dom/jsdom` |
|---|---|---|---|
| ページスクリプトの既定 | なし(`runScripts` 未指定) | 評価 ON | なし。`runScripts: "dangerously"` が必要。`enableJavaScriptEvaluation: false` が拒否権 |
| 外部 `<script src>` | `resources: "usable"` | `enableJavaScriptFileLoading` ON | `runScripts: "dangerously"` + `resources: "usable"` + 評価 ON |
| 外部 CSS | `resources: "usable"` | `enableCSSFileLoading` ON | `resources: "usable"` + `enableCSSFileLoading` |
| `<style>` / `style` 属性 | カスケード | カスケード | 常にカスケード(`stylesheets: false` は外部ファイルだけに効く) |
| 画像 | jsdom が取得 | 取得 | DOM は取得しない(描画側が所有) |
| iframe | 資源とともに読む | `enableIframePageLoading` | 中身は読まない |
| タイマー | ホストのタイマー | 自前の時計 | ページのタイマーはホストの `setTimeout` と `Date` を使うので、runner の fake timers(Vitest / Jest)で進む(known-gaps §1) |
| viewport 幅 | 1024 | 設定可 | `engine.width`(既定 800)= `window.innerWidth` |
| viewport 高さ | 768 | 設定可 | `engine.height`(`createDOM` の `height`)。既定は `round(width * 0.75)` |

`register()` / `unregister()` は happy-dom の `GlobalRegistrator` 相当(`src/jsdom.ts`)。
`dom.goto(url)` は `JSDOM.fromURL`(`file:` は `JSDOM.fromFile`)+ `await dom.ready` の薄いラッパで、
現在のページをその場で遷移させず、閉じもしない。`dom.waitUntilComplete()` は `await dom.ready`。
`Browser` 全体(履歴、その場の遷移、フレーム遷移)は再現しない。
