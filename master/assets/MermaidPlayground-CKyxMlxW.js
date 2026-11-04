import{n as e}from"./rolldown-runtime-WkwZ5CU-.js";import{c as t,d as n,i as r,o as i,t as a}from"./jsx-runtime-CMmYidMr.js";import{t as o}from"./useJxlSupport-kmQboleu.js";var s=e(n(),1),c=[{id:`flowchart`,label:`Flowchart`,group:`Diagrams`,text:`flowchart TD
  start([開始]) --> input[/注文を受け取る/]
  input --> check{在庫あり?}
  check -->|はい| ship[出荷する]
  check -->|いいえ| wait[入荷を待つ]
  wait --> check
  subgraph fulfil [出荷処理]
    ship --> pack[梱包] --> send[発送]
  end
  send --> done((完了))
  classDef good fill:#dcfce7,stroke:#16a34a
  class done good`},{id:`sequence`,label:`Sequence`,group:`Diagrams`,text:`sequenceDiagram
  autonumber
  participant U as ユーザー
  participant A as アプリ
  participant S as サーバー
  U->>A: ログインする
  A->>S: 認証を依頼
  alt 成功
    S-->>A: トークン
    A-->>U: ホーム画面
  else 失敗
    S-->>A: エラー
    A-->>U: 再入力を促す
  end
  Note over A,S: 通信は HTTPS`},{id:`state`,label:`State`,group:`Diagrams`,text:`stateDiagram-v2
  [*] --> 待機
  待機 --> 処理中: 開始
  state 処理中 {
    [*] --> 読み込み
    読み込み --> 変換
    変換 --> [*]
  }
  処理中 --> 完了: 成功
  処理中 --> 失敗: エラー
  失敗 --> 待機: 再試行
  完了 --> [*]`},{id:`class`,label:`Class`,group:`Diagrams`,text:`classDiagram
  class Animal {
    <<abstract>>
    +String name
    +eat() void
  }
  class Dog {
    +bark() void
  }
  class Cat {
    +meow() void
  }
  Animal <|-- Dog
  Animal <|-- Cat
  Dog "1" --> "*" Toy : plays with`},{id:`er`,label:`ER`,group:`Diagrams`,text:`erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER {
    int id PK
    string name
  }
  ORDER {
    int id PK
    int customer_id FK
  }`},{id:`requirement`,label:`Requirement`,group:`Diagrams`,text:`requirementDiagram
  requirement login {
    id: 1
    text: ユーザーはログインできる
    risk: high
    verifymethod: test
  }
  element auth_service {
    type: service
  }
  auth_service - satisfies -> login`},{id:`block`,label:`Block`,group:`Diagrams`,text:`block-beta
  columns 3
  a["入力"] b["処理"] c["出力"]
  d(["キュー"]):2 e[("DB")]
  a --> b
  b --> c
  b --> e`},{id:`architecture`,label:`Architecture`,group:`Diagrams`,text:`architecture-beta
  group api(cloud)[API]
  service db(database)[Database] in api
  service disk(disk)[Storage] in api
  service server(server)[Server] in api
  service gw(internet)[Gateway]

  gw:R --> L:server
  server:R -- L:db
  server:B -- T:disk`},{id:`c4`,label:`C4 context`,group:`Diagrams`,text:`C4Context
  title ネットバンキングのシステム構成
  Person(customer, "顧客", "口座を持つ個人")
  Enterprise_Boundary(bank, "銀行") {
    System(banking, "ネットバンキング", "残高照会と振込")
    SystemDb(ledger, "勘定系DB", "口座と取引")
  }
  System_Ext(mail, "メールシステム", "通知メールを送る")
  Rel(customer, banking, "利用する", "HTTPS")
  Rel(banking, ledger, "読み書きする")
  Rel(banking, mail, "通知を依頼する")`},{id:`gantt`,label:`Gantt`,group:`Charts`,text:`gantt
  title 開発スケジュール
  dateFormat YYYY-MM-DD
  section 設計
    要件定義 :done, a1, 2026-01-05, 10d
    基本設計 :active, a2, after a1, 12d
  section 実装
    実装     :a3, after a2, 20d
    テスト   :a4, after a3, 10d`},{id:`pie`,label:`Pie`,group:`Charts`,text:`pie showData title 好きなペット
  "犬" : 42
  "猫" : 35
  "鳥" : 12
  "魚" : 11`},{id:`xychart`,label:`XY chart`,group:`Charts`,text:`xychart-beta
  title "月別売上"
  x-axis [1月, 2月, 3月, 4月, 5月, 6月]
  y-axis "百万円" 0 --> 120
  bar [30, 45, 60, 80, 95, 110]
  line [25, 50, 55, 85, 90, 100]`},{id:`quadrant`,label:`Quadrant`,group:`Charts`,text:`quadrantChart
  title 施策の優先度
  x-axis 低コスト --> 高コスト
  y-axis 低効果 --> 高効果
  quadrant-1 すぐやる
  quadrant-2 計画する
  quadrant-3 後回し
  quadrant-4 見直す
  施策A: [0.25, 0.8]
  施策B: [0.7, 0.75]
  施策C: [0.3, 0.25]
  施策D: [0.8, 0.3]`},{id:`radar`,label:`Radar`,group:`Charts`,text:`radar-beta
  title スキル比較
  axis a["設計"], b["実装"], c["テスト"], d["運用"], e["文書"]
  curve x["Alice"]{4, 5, 3, 2, 4}
  curve y["Bob"]{3, 3, 5, 4, 2}
  max 5`},{id:`sankey`,label:`Sankey`,group:`Charts`,text:`sankey-beta

収入,生活費,50
収入,貯蓄,20
収入,娯楽,10
生活費,家賃,30
生活費,食費,20`},{id:`treemap`,label:`Treemap`,group:`Charts`,text:`treemap-beta
  "開発"
    "フロントエンド": 40
    "バックエンド": 55
  "運用"
    "監視": 20
    "保守": 25`},{id:`venn`,label:`Venn`,group:`Charts`,text:`venn-beta
  title チームの重なり
  set A["フロントエンド"]:20
  set B["バックエンド"]:20
  union A,B["フルスタック"]`},{id:`mindmap`,label:`Mindmap`,group:`Structure`,text:`mindmap
  root((新サービス))
    調査
      市場
      競合
    設計
      画面
      API
    公開
      告知`},{id:`timeline`,label:`Timeline`,group:`Structure`,text:`timeline
  title 製品の歴史
  2020 : 企画
  2021 : 試作 : 社内公開
  2022 : 正式リリース
  2023 : 海外展開`},{id:`journey`,label:`User journey`,group:`Structure`,text:`journey
  title 通勤の一日
  section 朝
    起きる: 2: 私
    電車に乗る: 3: 私, 同僚
  section 昼
    会議: 4: 私, 同僚
    昼食: 5: 私`},{id:`gitgraph`,label:`Git graph`,group:`Structure`,text:`gitGraph
  commit id: "初期化"
  branch feature
  checkout feature
  commit id: "機能追加"
  commit id: "テスト"
  checkout main
  merge feature
  commit id: "リリース" tag: "v1.0"`},{id:`kanban`,label:`Kanban`,group:`Structure`,text:`kanban
  todo[未着手]
    t1[仕様を書く]
  doing[作業中]
    t2[実装する]
    t3[レビューを待つ]
  done[完了]
    t4[環境構築]`},{id:`packet`,label:`Packet`,group:`Structure`,text:`packet-beta
  0-15: "送信元ポート"
  16-31: "宛先ポート"
  32-63: "シーケンス番号"
  64-95: "確認応答番号"`},{id:`ishikawa`,label:`Ishikawa`,group:`Structure`,text:`ishikawa-beta
  納期遅延
    人
      経験不足
      兼務が多い
    手順
      レビュー待ち
      仕様変更
    環境
      ビルドが遅い`},{id:`treeview`,label:`Tree view`,group:`Structure`,text:`treeView-beta
  "src"
    "cpp"
      "mermaid"
    "ts"
  "README.md"`},{id:`wardley`,label:`Wardley map`,group:`Diagrams`,text:`wardley-beta
title Tea Shop Value Chain

anchor Business [0.95, 0.63]
component Cup of Tea [0.79, 0.61]
component Tea [0.63, 0.81]
component Hot Water [0.52, 0.80]
component Kettle [0.43, 0.35]
component Power [0.10, 0.70]

Business -> Cup of Tea
Cup of Tea -> Tea
Cup of Tea -> Hot Water
Hot Water -> Kettle
Kettle -> Power

evolve Kettle 0.62
evolve Power 0.89

note "Standardising power allows Kettles to evolve faster" [0.30, 0.49]`},{id:`cynefin`,label:`Cynefin`,group:`Diagrams`,text:`cynefin-beta
  title Strategy Categorization

  complex
    "Market research"
    "Run chaos experiment"

  complicated
    "Competitive analysis"

  clear
    "Standard pricing"

  chaotic
    "Crisis management"

  confusion
    "Unknown failure mode"

  complex --> complicated : "Pattern identified"
  complicated --> clear : "Best practice codified"
  clear --> chaotic : "Complacency"
  chaotic --> complex : "Stabilized"`},{id:`railroad`,label:`Railroad (EBNF)`,group:`Diagrams`,text:`railroad-ebnf-beta
title "JSON Grammar"

json = element ;
element = object | array | string | number | "true" | "false" | "null" ;
object = "{" [ member ( "," member )* ] "}" ;
array = "[" [ element ( "," element )* ] "]" ;
member = string ":" element ;`},{id:`eventmodeling`,label:`Event modeling`,group:`Diagrams`,text:`eventmodeling

tf 01 ui CartUI
tf 02 cmd AddItem [[AddItem01]]
tf 03 evt ItemAdded [[ItemAdded]]
tf 04 cmd AddItem [[AddItem02]]
tf 05 evt ItemAdded [[ItemAdded]]

data AddItem01 {
  description: 'john'
  image: 'avatar_john'
  price: 20.4
}

data AddItem02 {
  description: 'jack'
  image: 'avatar_jack'
  price: 12.5
}

data ItemAdded {
  description: string
  image: string
  price: number
}`},{id:`usecase`,label:`Use case`,group:`Diagrams`,text:`usecase-beta
direction LR
accTitle: Online ordering use cases
accDescr {
  A customer places an order through the storefront.
  Staff review the order and inspect its data.
}
actor Customer("Customer")
actor Staff("Order staff")@{ type: hollow, business: true } <<Employee>>
systemBoundary ordering["Ordering System"]@{ type: package }:::system
  Browse("Browse products")
  Checkout("Checkout") <<Core>>:::critical
  Payment("Process payment")
  Review[Review order]
end
json OrderData@{
  "status": "pending",
  "items": [{ "name": "Book", "quantity": 1 }],
  "total": 29.95
}:::data
note for Checkout "\`Validates the **cart** before payment\`"
Customer starts@-- "places order" ---> Checkout
Customer --> Browse
Checkout pays@..> : include Payment
Staff --> Review
Review --> OrderData
classDef system stroke:#c8a02a,stroke-width:2px
classDef critical stroke:#c33,stroke-width:3px
classDef data stroke:#3572a5
style pays stroke:#6b46c1,stroke-width:2px`},{id:`swimlane`,label:`Swimlane`,group:`Diagrams`,text:`swimlane-beta LR
  subgraph Customer
    request[Request service]
    receive[Receive update]
  end

  subgraph Support
    triage[Triage request]
    answer[Send answer]
  end

  subgraph Engineering
    investigate[Investigate issue]
    fix[Prepare fix]
  end

  request --> triage
  triage -->|Known issue| answer
  triage -->|Needs code change| investigate
  investigate --> fix --> answer
  answer --> receive`},{id:`agentflow`,label:`Agent flow`,group:`Diagrams`,text:`agentflow-beta TB
  connector llm["LLM API"]
  llm@{ protocol: "http", endpoint: "https://api.example.com/chat" }

  flow coffee_team["Coffee Team"]
    city["city"]@{ shape: input, value: "Stockholm" }

    flow researcher["Researcher"]
      research["research_location"]@{ shape: tool, params: "city :: String", returns: "Report" }
      write["write_copy"]@{ shape: tool, connectorRef: "llm.chat", returns: "CoffeeCopy" }
      city --> research --> write
    end
    researcher@{ instruction: "Research the city and draft English coffee copy citing sources." }

    flow designer["Designer"]
      render["generate_html"]@{ shape: tool, connectorRef: "llm.chat", returns: "String" }
      brand["Nordic Brand Guide"]@{ shape: refdoc }
      render -.- brand
    end

    researcher --> designer
  end`},{id:`info`,label:`Info`,group:`Structure`,text:`info
showInfo`},{id:`style-box`,label:`classDef / style on other diagrams`,group:`Features`,text:`stateDiagram-v2
  classDef hot fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef cool fill:#dbeafe,stroke:#2563eb
  [*] --> 受付
  受付 --> 対応中
  対応中 --> 完了
  class 受付 hot
  class 完了 cool
  style 対応中 stroke-width:3px,stroke-dasharray:5 3`},{id:`accessibility`,label:`accTitle / accDescr`,group:`Features`,text:`flowchart LR
  accTitle: 判定の流れ
  accDescr {
    開始から判定を経て完了に至る流れ。
    図には描かれず、SVG の title と desc になります。
  }
  A[開始] --> B{判定}
  B -->|はい| C[完了]`},{id:`init-theme`,label:`init directive (turn on Directives)`,group:`Features`,directives:!0,text:`%%{init: {"theme": "dracula", "themeVariables": {"primaryColor": "#44475a"}}}%%
flowchart LR
  A[テーマは本文から] --> B[themeVariables も効く]`},{id:`frontmatter`,label:`Frontmatter config (turn on Directives)`,group:`Features`,directives:!0,text:`---
title: 設定は先頭に
config:
  theme: nord
---
flowchart LR
  A[frontmatter] --> B[config.theme]`},{id:`typo`,label:`Misspelt keyword (Recover)`,group:`Features`,mode:`recover`,text:`flowchrt LR
  A[綴りを直す] --> B[recover モード]`},{id:`case`,label:`Wrong case (Compat)`,group:`Features`,mode:`compat`,text:`Flowchart LR
  A[大文字小文字] --> B[compat モード]`},{id:`unclosed`,label:`Unclosed block (Compat)`,group:`Features`,mode:`compat`,text:`stateDiagram-v2
  state 処理 {
    [*] --> 読み込み
    読み込み --> 変換`},{id:`bad-lines`,label:`Unreadable lines (Recover)`,group:`Features`,mode:`recover`,text:`pie title 読めない行を飛ばす
  "犬" : 40
  ここは円グラフの行ではありません
  "猫" : 60`}],l=e=>{let t=``;for(let n of e)t+=String.fromCharCode(n);return btoa(t).replace(/\+/g,`-`).replace(/\//g,`_`).replace(/=+$/,``)},u=e=>{let t=e.replace(/-/g,`+`).replace(/_/g,`/`)+`=`.repeat((4-e.length%4)%4),n=atob(t),r=new Uint8Array(n.length);for(let e=0;e<n.length;e++)r[e]=n.charCodeAt(e);return r},d=async(e,t)=>{let n=t.writable.getWriter();return n.write(e).then(()=>n.close()).catch(()=>void 0),new Uint8Array(await new Response(t.readable).arrayBuffer())};async function f(e){if(typeof CompressionStream<`u`)try{return l(await d(new TextEncoder().encode(e),new CompressionStream(`deflate-raw`)))}catch{return}}async function p(e){if(typeof DecompressionStream<`u`)try{return new TextDecoder().decode(await d(u(e),new DecompressionStream(`deflate-raw`)))}catch{return}}var m=a(),h=`mermaid-playground-text`,g=[`svg`,`png`,`webp`,`jpeg`,`avif`,`jxl`,`pdf`],_={svg:`image/svg+xml`,png:`image/png`,webp:`image/webp`,jpeg:`image/jpeg`,avif:`image/avif`,jxl:`image/jxl`,pdf:`application/pdf`},v={theme:`light`,mode:`strict`,directives:!1,format:`svg`,accent:``,padding:16,width:``,background:``},y=e=>{let t={...v},n=e.get(`theme`);n&&n in r&&(t.theme=n);let i=e.get(`mmode`);(i===`compat`||i===`recover`)&&(t.mode=i),t.directives=e.get(`directives`)===`on`;let a=e.get(`format`);g.includes(a)&&(t.format=a),t.accent=e.get(`accent`)??``;let o=parseInt(e.get(`padding`)??``,10);return Number.isFinite(o)&&(t.padding=Math.min(200,Math.max(0,o))),t.width=e.get(`width`)??``,t.background=e.get(`background`)??``,t},b=e=>{let t=new URLSearchParams;return e.theme!==v.theme&&t.set(`theme`,e.theme),e.mode!==`strict`&&t.set(`mmode`,e.mode),e.directives&&t.set(`directives`,`on`),e.format!==`svg`&&t.set(`format`,e.format),e.accent&&t.set(`accent`,e.accent),e.padding!==v.padding&&t.set(`padding`,String(e.padding)),e.width&&t.set(`width`,e.width),e.background&&t.set(`background`,e.background),t},x=e=>({theme:e.theme,mode:e.mode,directives:e.directives,format:e.format,accent:e.accent||void 0,padding:e.padding,width:e.width&&Math.max(50,parseInt(e.width,10)||0)||void 0,background:e.background||void 0}),S=()=>{try{return localStorage.getItem(h)??c[0].text}catch{return c[0].text}},C=`w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm`,w=`flex flex-col gap-1 text-xs font-medium text-gray-600`,T=e=>{let t=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(e);if(!t)return!1;let[n,r,i]=[t[1],t[2],t[3]].map(e=>parseInt(e,16));return .2126*n+.7152*r+.0722*i<128},E=[`Diagrams`,`Charts`,`Structure`,`Features`],D=()=>{let[e,n]=(0,s.useState)(S),[a,l]=(0,s.useState)(()=>y(new URLSearchParams(window.location.search))),[u,d]=(0,s.useState)(()=>new URLSearchParams(window.location.search).get(`view`)===`gallery`?`gallery`:`editor`),D=o(),[k,A]=(0,s.useState)(()=>new URLSearchParams(window.location.search).get(`src`)??``),[j,M]=(0,s.useState)(null),[N,P]=(0,s.useState)(!1),[F,I]=(0,s.useState)(null),[L,R]=(0,s.useState)([]),[z,B]=(0,s.useState)(`svg`),[V,H]=(0,s.useState)(null),U=(0,s.useRef)(0),W=(0,s.useRef)(null),G=(e,t)=>l(n=>({...n,[e]:t}));(0,s.useEffect)(()=>{let e=new URLSearchParams(window.location.search);for(let t of[...e.keys()])t!==`mode`&&e.delete(t);for(let[t,n]of b(a))e.set(t,n);u===`gallery`&&e.set(`view`,`gallery`),k&&e.set(`src`,k),window.history.replaceState({},``,`${window.location.pathname}?${e.toString()}`)},[a,u,k]),(0,s.useEffect)(()=>{let e=new URLSearchParams(window.location.search).get(`src`);e&&p(e).then(e=>e!==void 0&&n(e))},[]),(0,s.useEffect)(()=>{let t=!1,n=setTimeout(async()=>{let n=await f(e);t||A(n&&n.length<=6e3?n:``)},400);return()=>{t=!0,clearTimeout(n)}},[e]),(0,s.useEffect)(()=>{try{localStorage.setItem(h,e)}catch{}},[e]),(0,s.useEffect)(()=>()=>{W.current&&URL.revokeObjectURL(W.current)},[]),(0,s.useEffect)(()=>{if(u!==`editor`)return;let n=++U.current;P(!0);let r=setTimeout(async()=>{let r=performance.now();try{let i=[],o=await t(e,{...x(a),onWarning:e=>i.push(e)});if(n!==U.current)return;let s=o.data,c=new Blob([typeof s==`string`?s:s.slice()],{type:_[a.format]}),l=URL.createObjectURL(c);W.current&&URL.revokeObjectURL(W.current),W.current=l,M({url:l,bytes:c.size,text:typeof s==`string`?s:null,time:performance.now()-r,format:a.format}),I(null),R(i)}catch(e){n===U.current&&(I(e instanceof Error?e.message:String(e)),R([]))}finally{n===U.current&&P(!1)}},300);return()=>clearTimeout(r)},[e,a,u]);let K=(0,s.useMemo)(()=>{try{return i(e,{...x(a),raster:a.format!==`svg`})}catch(e){return e instanceof Error?e.message:String(e)}},[e,a]),q=()=>{if(!j)return;let e=document.createElement(`a`);e.href=j.url,e.download=`diagram.${j.format}`,e.click()},J=e=>{n(e.text),l(t=>({...t,mode:e.mode??`strict`,directives:e.directives??!1,...e.theme?{theme:e.theme}:{}})),d(`editor`)},Y=a.format===`svg`||a.format===`png`||a.format===`webp`,X=r[a.theme]?.bg??`#ffffff`,Z=T(X),Q=Y?Z&&!a.background?{backgroundColor:X}:{backgroundColor:`#fff`,backgroundImage:`conic-gradient(#eee 25%, transparent 0 50%, #eee 0 75%, transparent 0)`,backgroundSize:`16px 16px`}:{backgroundColor:`#f3f4f6`};return(0,m.jsxs)(`div`,{className:`flex flex-col gap-4`,children:[(0,m.jsx)(`div`,{className:`flex gap-2 text-sm`,children:[`editor`,`gallery`].map(e=>(0,m.jsx)(`button`,{type:`button`,onClick:()=>d(e),className:`cursor-pointer rounded-md border px-3 py-1 ${u===e?`border-blue-600 bg-blue-50 font-semibold text-blue-700`:`border-gray-300 bg-white text-gray-600 hover:bg-gray-50`}`,children:e===`editor`?`Editor`:`Gallery (${c.length})`},e))}),(0,m.jsxs)(`fieldset`,{className:`rounded-lg border border-gray-200 bg-white p-3`,children:[(0,m.jsx)(`legend`,{className:`px-1 text-sm font-semibold text-gray-700`,children:`Render`}),(0,m.jsxs)(`div`,{className:`grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6`,children:[(0,m.jsxs)(`label`,{className:w,children:[`Theme`,(0,m.jsx)(`select`,{className:C,value:a.theme,onChange:e=>G(`theme`,e.target.value),children:Object.keys(r).map(e=>(0,m.jsx)(`option`,{value:e,children:e},e))})]}),(0,m.jsxs)(`label`,{className:w,children:[`Input repair`,(0,m.jsxs)(`select`,{className:C,value:a.mode,onChange:e=>G(`mode`,e.target.value),children:[(0,m.jsx)(`option`,{value:`strict`,children:`strict`}),(0,m.jsx)(`option`,{value:`compat`,children:`compat`}),(0,m.jsx)(`option`,{value:`recover`,children:`recover`})]})]}),(0,m.jsxs)(`label`,{className:w,children:[`Format`,(0,m.jsx)(`select`,{className:C,value:a.format,onChange:e=>G(`format`,e.target.value),disabled:u===`gallery`,children:g.map(e=>(0,m.jsx)(`option`,{value:e,children:e},e))})]}),(0,m.jsxs)(`label`,{className:w,children:[`Accent colour`,(0,m.jsxs)(`div`,{className:`flex gap-1`,children:[(0,m.jsx)(`input`,{type:`color`,className:`h-7 w-9 cursor-pointer rounded border border-gray-300 bg-white p-0.5`,value:/^#[0-9a-f]{6}$/i.test(a.accent)?a.accent:`#2563eb`,onChange:e=>G(`accent`,e.target.value)}),(0,m.jsx)(`button`,{type:`button`,className:`cursor-pointer rounded border border-gray-300 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50`,onClick:()=>G(`accent`,``),title:`Back to the theme's accent`,children:`Reset`})]})]}),(0,m.jsxs)(`label`,{className:w,children:[`Padding (px)`,(0,m.jsx)(`input`,{type:`number`,min:0,max:200,className:C,value:a.padding,onChange:e=>G(`padding`,Math.min(200,Math.max(0,parseInt(e.target.value,10)||0)))})]}),(0,m.jsxs)(`label`,{className:w,children:[`Width (px)`,(0,m.jsx)(`input`,{className:C,value:a.width,placeholder:`fit`,inputMode:`numeric`,onChange:e=>G(`width`,e.target.value.replace(/\D/g,``))})]}),(0,m.jsxs)(`label`,{className:`${w} sm:col-span-2`,children:[`Background (CSS colour)`,(0,m.jsx)(`input`,{className:C,value:a.background,placeholder:`auto`,onChange:e=>G(`background`,e.target.value)})]}),(0,m.jsxs)(`label`,{className:`flex cursor-pointer items-center gap-1.5 self-end pb-1 text-sm text-gray-700 sm:col-span-2`,children:[(0,m.jsx)(`input`,{type:`checkbox`,checked:a.directives,onChange:e=>G(`directives`,e.target.checked)}),`Directives (`,`%%{init}%%`,`, frontmatter)`]}),(0,m.jsx)(`button`,{type:`button`,className:`ml-auto cursor-pointer self-end rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50`,onClick:()=>l(v),children:`Reset all`})]})]}),u===`gallery`?(0,m.jsx)(O,{panel:a,onOpen:J}):(0,m.jsxs)(`div`,{className:`grid gap-4 lg:grid-cols-2`,children:[(0,m.jsxs)(`section`,{className:`flex min-w-0 flex-col gap-3`,children:[(0,m.jsxs)(`div`,{className:`flex items-center justify-between gap-2`,children:[(0,m.jsx)(`h2`,{className:`m-0 text-base font-semibold text-gray-800`,children:`Mermaid`}),(0,m.jsxs)(`select`,{className:`rounded border border-gray-300 bg-white px-2 py-1 text-sm`,value:``,onChange:e=>{let t=c.find(t=>t.id===e.target.value);t&&J(t)},children:[(0,m.jsx)(`option`,{value:``,children:`Load a sample…`}),E.map(e=>(0,m.jsx)(`optgroup`,{label:e,children:c.filter(t=>t.group===e).map(e=>(0,m.jsx)(`option`,{value:e.id,children:e.label},e.id))},e))]})]}),(0,m.jsx)(`textarea`,{value:e,onChange:e=>n(e.target.value),spellCheck:!1,className:`h-[28rem] w-full resize-y rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm leading-relaxed`})]}),(0,m.jsxs)(`section`,{className:`flex min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white`,children:[(0,m.jsxs)(`div`,{className:`flex items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-sm`,children:[(0,m.jsxs)(`div`,{className:`flex items-center gap-3 text-gray-600`,children:[(0,m.jsx)(`span`,{className:`font-semibold text-gray-800`,children:a.format.toUpperCase()}),N&&(0,m.jsx)(`span`,{className:`text-blue-600`,children:`Rendering…`}),!N&&j&&(0,m.jsxs)(m.Fragment,{children:[(0,m.jsxs)(`span`,{children:[Math.round(j.time),` ms`]}),(0,m.jsxs)(`span`,{children:[(j.bytes/1024).toFixed(1),` KB`]}),V&&j.format!==`pdf`&&(0,m.jsxs)(`span`,{children:[V.w,` × `,V.h]})]})]}),(0,m.jsx)(`button`,{type:`button`,onClick:q,disabled:!j,className:`cursor-pointer rounded bg-orange-500 px-3 py-1 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-300`,children:`Download`})]}),F&&(0,m.jsx)(`pre`,{className:`m-0 whitespace-pre-wrap border-b border-red-200 bg-red-50 p-3 text-xs text-red-700`,children:F}),L.length>0&&(0,m.jsx)(`ul`,{className:`m-0 flex list-none flex-col gap-1 border-b border-gray-200 p-3 text-xs`,children:L.map((e,t)=>(0,m.jsxs)(`li`,{className:e.code===`MERMAID_ERROR`?`text-red-700`:`text-amber-700`,children:[(0,m.jsx)(`b`,{children:e.code===`MERMAID_ERROR`?`Could not read`:`Repaired`}),`: `,e.message]},t))}),(0,m.jsx)(`div`,{className:`min-h-[28rem] flex-1 overflow-auto p-3`,style:Q,children:j?j.format===`pdf`?(0,m.jsx)(`embed`,{src:j.url,type:`application/pdf`,className:`h-[28rem] w-full border-0`}):j.format===`jxl`&&D===!1?(0,m.jsx)(`p`,{className:`text-sm text-gray-500`,children:`This browser cannot show JXL (Safari can). Use Download to get the file.`}):(0,m.jsx)(`img`,{src:j.url,alt:`diagram`,onLoad:e=>H({w:e.currentTarget.naturalWidth,h:e.currentTarget.naturalHeight}),className:`max-w-none`}):(0,m.jsx)(`p`,{className:`text-sm text-gray-500`,children:N?`Rendering…`:`The diagram appears here.`})})]})]}),u===`editor`&&(0,m.jsxs)(`section`,{className:`rounded-lg border border-gray-200 bg-white`,children:[(0,m.jsx)(`div`,{className:`flex border-b border-gray-200 text-sm`,children:[[`svg`,`Output SVG`],[`html`,`Page HTML`]].map(([e,t])=>(0,m.jsx)(`button`,{type:`button`,onClick:()=>B(e),className:`cursor-pointer border-b-2 px-4 py-2 ${z===e?`border-blue-600 font-semibold text-blue-600`:`border-transparent text-gray-600 hover:text-gray-900`}`,children:t},e))}),(0,m.jsxs)(`pre`,{className:`m-0 max-h-72 overflow-auto p-3 text-xs leading-relaxed text-gray-700`,children:[z===`svg`&&(j?.text??`Only the SVG format has source to show.`),z===`html`&&K]})]})]})},O=({panel:e,onOpen:n})=>{let[i,a]=(0,s.useState)({}),o=(0,s.useRef)([]);(0,s.useEffect)(()=>{let n=!1;a({});for(let e of o.current)URL.revokeObjectURL(e);return o.current=[],(async()=>{for(let r of c){if(n)return;try{let i={...x(e),format:`svg`,width:void 0,mode:r.mode??e.mode,directives:r.directives??e.directives},{data:s}=await t(r.text,i);if(n)return;let c=URL.createObjectURL(new Blob([s],{type:`image/svg+xml`}));o.current.push(c),a(e=>({...e,[r.id]:{url:c,failed:s.includes(`#cf222e`)}}))}catch{n||a(e=>({...e,[r.id]:{url:``,failed:!0}}))}}})(),()=>{n=!0}},[e.theme,e.accent,e.padding,e.background,e.mode,e.directives]),(0,s.useEffect)(()=>()=>{for(let e of o.current)URL.revokeObjectURL(e)},[]);let l=Object.keys(i).length;return(0,m.jsxs)(`section`,{className:`flex flex-col gap-3`,children:[(0,m.jsxs)(`p`,{className:`m-0 text-xs text-gray-500`,children:[l,` / `,c.length,` drawn with theme `,(0,m.jsx)(`b`,{children:e.theme}),`. The samples that show a repair mode use their own mode. Click one to open it in the editor.`]}),(0,m.jsx)(`div`,{className:`grid gap-3 sm:grid-cols-2 xl:grid-cols-3`,children:c.map(t=>{let a=i[t.id];return(0,m.jsxs)(`button`,{type:`button`,onClick:()=>n(t),className:`flex cursor-pointer flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left transition-shadow hover:shadow-md`,children:[(0,m.jsxs)(`span`,{className:`flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs`,children:[(0,m.jsx)(`span`,{className:`font-semibold text-gray-800`,children:t.label}),(0,m.jsx)(`span`,{className:`text-gray-500`,children:t.group})]}),(0,m.jsx)(`span`,{className:`flex h-56 items-center justify-center overflow-hidden p-2`,style:{backgroundColor:e.background||r[e.theme]?.bg||`#fff`},children:a?.url?(0,m.jsx)(`img`,{src:a.url,alt:t.label,className:`max-h-full max-w-full object-contain`}):(0,m.jsx)(`span`,{className:`text-xs text-gray-400`,children:a?.failed?`Failed`:`Rendering…`})}),a?.failed&&a.url&&(0,m.jsx)(`span`,{className:`bg-red-50 px-3 py-1 text-xs text-red-700`,children:`The diagram did not parse in this mode.`})]},t.id)})})]})};export{D as MermaidPlayground,D as default};