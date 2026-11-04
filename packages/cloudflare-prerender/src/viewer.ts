import type { DiffResult } from "./diff.js";

export interface ViewerData {
  url: string;
  finalUrl: string;
  titles: {
    noJs: string;
    withJs: string;
  };
  textDiff: DiffResult;
  htmlDiff: DiffResult;
  stats: {
    text: { noJsChars: number; withJsChars: number };
    html: { noJsChars: number; withJsChars: number };
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Top page / Home view with URL input form.
 */
export function renderHome(error?: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JS Render Diff Viewer</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --btn-active: #238636;
      --btn-active-hover: #2ea043;
      --btn-bg: #21262d;
      --btn-border: #363b42;
      --error-bg: rgba(248, 81, 73, 0.15);
      --error-border: rgba(248, 81, 73, 0.4);
      --error-text: #f85149;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .container {
      width: 100%;
      max-width: 680px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2.25rem;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    }
    .header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      margin-bottom: 0.6rem;
    }
    .header p {
      color: var(--text-muted);
      font-size: 0.95rem;
      max-width: 520px;
      margin: 0 auto;
    }
    .badge {
      font-size: 0.75rem;
      font-weight: 500;
      padding: 0.2rem 0.6rem;
      border-radius: 12px;
      background: #1f6feb22;
      border: 1px solid #1f6feb55;
      color: #58a6ff;
    }
    .error-box {
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      color: var(--error-text);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .input-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
    }
    .url-input {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      padding: 0.8rem 1rem;
      font-size: 1rem;
      width: 100%;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .url-input:focus {
      border-color: #58a6ff;
      box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.2);
    }
    details {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      background: rgba(255, 255, 255, 0.02);
    }
    summary {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
    }
    summary:hover {
      color: var(--text);
    }
    .options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
    }
    .option-field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .option-field label {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .option-field input, .option-field select {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      padding: 0.45rem 0.65rem;
      font-size: 0.85rem;
    }
    .checkbox-field {
      grid-column: span 2;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
    .checkbox-field label {
      font-size: 0.85rem;
      cursor: pointer;
    }
    .submit-btn {
      background: var(--btn-active);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      padding: 0.85rem 1.5rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    .submit-btn:hover {
      background: var(--btn-active-hover);
    }
    .features {
      margin-top: 2rem;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }
    .feature-card {
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.85rem;
      font-size: 0.8rem;
    }
    .feature-card strong {
      display: block;
      color: var(--text);
      margin-bottom: 0.25rem;
    }
    .feature-card p {
      color: var(--text-muted);
      line-height: 1.4;
    }
    footer {
      margin-top: 2rem;
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    footer a {
      color: var(--text-muted);
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <h1>
          ⚡ JS Render Diff Viewer
          <span class="badge">QuickJS WASM</span>
        </h1>
        <p>JavaScript 有効時（スクリプト実行後）と無効時（初期フェッチ）の可視テキスト・HTMLソースの差異を可視化します。</p>
      </div>

      ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ""}

      <form method="GET" action="/">
        <div class="input-group">
          <label for="url">検証する Web ページの URL</label>
          <input
            id="url"
            class="url-input"
            type="url"
            name="url"
            placeholder="https://example.com"
            required
            autofocus
          >
        </div>

        <details>
          <summary>⚙️ 詳細オプション（待機時間、セレクタなど）</summary>
          <div class="options-grid">
            <div class="option-field">
              <label for="settle">待機時間 (settle ms)</label>
              <input id="settle" type="number" name="settle" value="1000" min="0" max="5000" step="100">
            </div>
            <div class="option-field">
              <label for="wait">待機セレクタ (CSS selector)</label>
              <input id="wait" type="text" name="wait" placeholder="#app, .loaded">
            </div>
            <div class="option-field">
              <label for="format">出力フォーマット</label>
              <select id="format" name="format">
                <option value="ui" selected>Diff Viewer (HTML UI)</option>
                <option value="json">JSON API (差分データ & ログ)</option>
                <option value="raw">Raw HTML (レンダリング後HTMLのみ)</option>
              </select>
            </div>
            <div class="option-field">
              <label for="timeout">タイムアウト (ms)</label>
              <input id="timeout" type="number" name="timeout" value="10000" min="1000" max="20000" step="1000">
            </div>
            <div class="checkbox-field">
              <input id="trackers" type="checkbox" name="trackers" value="1">
              <label for="trackers">トラッカー・広告スクリプトも読み込む (通常は除外)</label>
            </div>
          </div>
        </details>

        <button class="submit-btn" type="submit">
          <span>差分を比較する</span>
          <span>&rarr;</span>
        </button>
      </form>

      <div class="features">
        <div class="feature-card">
          <strong>📝 テキスト差分</strong>
          <p>タグ除去後の可視テキストを比較し、SEOやアクセシビリティに必要なコンテンツを特定。</p>
        </div>
        <div class="feature-card">
          <strong>🏷️ HTML構造比較</strong>
          <p>DOMの変異、動的に挿入されたタグや属性の変更を行単位で確認。</p>
        </div>
        <div class="feature-card">
          <strong>🔒 安全なサンドボックス</strong>
          <p>Cloudflare Workers 上の QuickJS (WASM) で分離実行。</p>
        </div>
      </div>
    </div>

    <footer>
      Powered by Cloudflare Workers &amp; wasm-quickjs-dom
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Generates the HTML string for diff contents (SSR).
 */
function renderDiffContent(activeDiff: DiffResult, layout: "split" | "unified"): string {
  if (!activeDiff || activeDiff.changes.length === 0) {
    return '<div class="empty-diff-notice">差分はありません（完全に一致しています）</div>';
  }

  if (layout === "unified") {
    let html = '<div class="diff-header unified"><div class="diff-header-col">Unified Diff (赤: JS無効時にのみ存在 / 緑: JS実行で追加)</div></div>';
    let lineA = 1;
    let lineB = 1;

    for (const change of activeDiff.changes) {
      const type = change.type;
      const escaped = escapeHtml(change.value);
      const sign = type === "added" ? "+" : type === "removed" ? "-" : " ";
      const numA = type === "added" ? "" : String(lineA++);
      const numB = type === "removed" ? "" : String(lineB++);

      html += `<div class="unified-row ${type}">
        <div class="line-num">${numA}</div>
        <div class="line-num">${numB}</div>
        <div class="line-sign">${sign}</div>
        <div class="line-content">${escaped}</div>
      </div>`;
    }
    return html;
  }

  // Split (Side-by-Side)
  let html = `<div class="diff-header">
    <div class="diff-header-col">JavaScript 無効 (初期 HTML)</div>
    <div class="diff-header-col">JavaScript 有効 (QuickJS 実行後)</div>
  </div>`;

  const left: Array<{ type: string; value: string } | null> = [];
  const right: Array<{ type: string; value: string } | null> = [];
  let i = 0;
  const changes = activeDiff.changes;

  while (i < changes.length) {
    const c = changes[i];
    if (c.type === "unchanged") {
      left.push({ type: "unchanged", value: c.value });
      right.push({ type: "unchanged", value: c.value });
      i++;
    } else {
      const removedChunk: string[] = [];
      const addedChunk: string[] = [];
      while (i < changes.length && changes[i].type !== "unchanged") {
        if (changes[i].type === "removed") removedChunk.push(changes[i].value);
        if (changes[i].type === "added") addedChunk.push(changes[i].value);
        i++;
      }
      const maxLen = Math.max(removedChunk.length, addedChunk.length);
      for (let k = 0; k < maxLen; k++) {
        left.push(k < removedChunk.length ? { type: "removed", value: removedChunk[k] } : null);
        right.push(k < addedChunk.length ? { type: "added", value: addedChunk[k] } : null);
      }
    }
  }

  let lineLeft = 1;
  let lineRight = 1;
  for (let idx = 0; idx < left.length; idx++) {
    const l = left[idx];
    const r = right[idx];

    const lClass = l ? l.type : "empty";
    const rClass = r ? r.type : "empty";
    const lNum = l ? String(lineLeft++) : "";
    const rNum = r ? String(lineRight++) : "";
    const lContent = l ? escapeHtml(l.value) : "";
    const rContent = r ? escapeHtml(r.value) : "";

    html += `<div class="split-row">
      <div class="split-cell ${lClass}">
        <div class="line-num">${lNum}</div>
        <div class="line-content">${lContent}</div>
      </div>
      <div class="split-cell ${rClass}">
        <div class="line-num">${rNum}</div>
        <div class="line-content">${rContent}</div>
      </div>
    </div>`;
  }
  return html;
}

export function renderViewer(data: ViewerData): string {
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");
  const initialSsrHtml = renderDiffContent(data.textDiff, "split");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JS Diff: ${escapeHtml(data.url)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --added-bg: rgba(46, 160, 67, 0.15);
      --added-border: rgba(46, 160, 67, 0.4);
      --added-text: #3fb950;
      --removed-bg: rgba(248, 81, 73, 0.15);
      --removed-border: rgba(248, 81, 73, 0.4);
      --removed-text: #f85149;
      --header-bg: #161b22;
      --btn-active: #1f6feb;
      --btn-bg: #21262d;
      --btn-border: #363b42;
      --notice-bg: rgba(210, 153, 34, 0.15);
      --notice-border: rgba(210, 153, 34, 0.4);
      --notice-text: #d29922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 1.5rem;
    }
    .header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.5rem;
    }
    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .badge {
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      background: var(--btn-bg);
      border: 1px solid var(--border);
      color: var(--text-muted);
    }
    .url-form {
      display: flex;
      gap: 0.5rem;
      flex: 1;
      max-width: 650px;
    }
    .url-input {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      padding: 0.4rem 0.75rem;
      font-size: 0.875rem;
    }
    .btn {
      background: var(--btn-bg);
      border: 1px solid var(--btn-border);
      border-radius: 6px;
      color: var(--text);
      padding: 0.4rem 0.85rem;
      font-size: 0.875rem;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn:hover { background: #30363d; }
    .btn.active {
      background: var(--btn-active);
      border-color: var(--btn-active);
      color: #fff;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      font-size: 0.875rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
    }
    .meta-item strong {
      color: var(--text-muted);
      display: block;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-add { color: var(--added-text); font-weight: 600; }
    .stat-del { color: var(--removed-text); font-weight: 600; }

    .noscript-banner {
      background: var(--notice-bg);
      border: 1px solid var(--notice-border);
      color: var(--notice-text);
      padding: 0.6rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }

    .controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .btn-group {
      display: flex;
      gap: 0.25rem;
      background: var(--card-bg);
      padding: 0.25rem;
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    .btn-group .btn {
      border: none;
      border-radius: 4px;
      padding: 0.35rem 0.75rem;
    }

    .diff-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      font-size: 0.8125rem;
      min-height: 120px;
    }
    .diff-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      background: #1c2128;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      color: var(--text-muted);
      font-size: 0.8125rem;
    }
    .diff-header.unified {
      grid-template-columns: 1fr;
    }
    .diff-header-col {
      padding: 0.5rem 1rem;
    }
    .diff-header-col:first-child {
      border-right: 1px solid var(--border);
    }
    .diff-header.unified .diff-header-col:first-child {
      border-right: none;
    }

    /* Unified View */
    .unified-row {
      display: flex;
      width: 100%;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .unified-row.added { background: var(--added-bg); }
    .unified-row.removed { background: var(--removed-bg); }
    .line-num {
      width: 45px;
      min-width: 45px;
      padding: 0.15rem 0.5rem;
      text-align: right;
      color: var(--text-muted);
      user-select: none;
      opacity: 0.6;
    }
    .line-sign {
      width: 20px;
      min-width: 20px;
      text-align: center;
      user-select: none;
      font-weight: bold;
    }
    .unified-row.added .line-sign { color: var(--added-text); }
    .unified-row.removed .line-sign { color: var(--removed-text); }
    .line-content {
      padding: 0.15rem 0.75rem;
      white-space: pre-wrap;
      word-break: break-all;
      flex: 1;
    }

    /* Split View */
    .split-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: 100%;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .split-cell {
      display: flex;
      min-width: 0;
    }
    .split-cell:first-child {
      border-right: 1px solid var(--border);
    }
    .split-cell.added { background: var(--added-bg); }
    .split-cell.removed { background: var(--removed-bg); }
    .split-cell.empty { background: rgba(0,0,0,0.15); opacity: 0.3; }

    .empty-diff-notice {
      padding: 3rem;
      text-align: center;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="title-row">
      <h1>
        <a href="/" style="color:inherit; text-decoration:none;">⚡ JS Render Diff Viewer</a>
        <span class="badge">wasm-quickjs</span>
      </h1>
      <form class="url-form" method="GET" action="/">
        <input class="url-input" type="url" name="url" value="${escapeHtml(data.url)}" placeholder="https://example.com" required>
        <button class="btn" type="submit">比較</button>
      </form>
    </div>
    <div class="meta-grid">
      <div class="meta-item">
        <strong>URL</strong>
        <a href="${escapeHtml(data.url)}" target="_blank" rel="noopener" style="color:var(--text); text-decoration:none;">${escapeHtml(data.url)}</a>
      </div>
      <div class="meta-item">
        <strong>Title 変化</strong>
        <div>
          <span style="opacity:0.8">${escapeHtml(data.titles.noJs || "(なし)")}</span>
          ${data.titles.noJs !== data.titles.withJs ? ` &rarr; <span class="stat-add">${escapeHtml(data.titles.withJs || "(なし)")}</span>` : ""}
        </div>
      </div>
      <div class="meta-item">
        <strong>可視テキスト差分</strong>
        <div>
          <span class="stat-add">+${data.textDiff.stats.added}</span> /
          <span class="stat-del">-${data.textDiff.stats.removed}</span> 行
          <span style="opacity:0.6; font-size:0.75rem;">(${data.stats.text.noJsChars} &rarr; ${data.stats.text.withJsChars} 文字)</span>
        </div>
      </div>
      <div class="meta-item">
        <strong>HTMLソース差分</strong>
        <div>
          <span class="stat-add">+${data.htmlDiff.stats.added}</span> /
          <span class="stat-del">-${data.htmlDiff.stats.removed}</span> 行
          <span style="opacity:0.6; font-size:0.75rem;">(${data.stats.html.noJsChars} &rarr; ${data.stats.html.withJsChars} 文字)</span>
        </div>
      </div>
    </div>
  </header>

  <noscript>
    <div class="noscript-banner">
      ℹ️ JavaScript が無効化されているため、テキスト比較の初期表示のみ行っています。HTML比較やインラインレイアウトへの切り替えには JavaScript を有効にしてください。
    </div>
  </noscript>

  <div class="controls">
    <div class="btn-group" id="modeGroup">
      <button class="btn active" data-mode="text">テキスト比較 (Text Content)</button>
      <button class="btn" data-mode="html">HTMLソース比較 (Source Code)</button>
    </div>
    <div class="btn-group" id="layoutGroup">
      <button class="btn active" data-layout="split">左右並列 (Side-by-Side)</button>
      <button class="btn" data-layout="unified">インライン (Unified)</button>
    </div>
  </div>

  <main class="diff-container" id="diffViewer">
    ${initialSsrHtml}
  </main>

  <script>
    const diffData = ${dataJson};
    let currentMode = "text";
    let currentLayout = "split";

    function escapeLine(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function renderDiff() {
      const activeDiff = currentMode === "text" ? diffData.textDiff : diffData.htmlDiff;
      const viewer = document.getElementById("diffViewer");
      if (!viewer) return;

      if (!activeDiff || activeDiff.changes.length === 0) {
        viewer.innerHTML = '<div class="empty-diff-notice">差分はありません（完全に一致しています）</div>';
        return;
      }

      if (currentLayout === "unified") {
        let html = '<div class="diff-header unified"><div class="diff-header-col">Unified Diff (赤: JS無効時にのみ存在 / 緑: JS実行で追加)</div></div>';
        let lineA = 1;
        let lineB = 1;

        for (const change of activeDiff.changes) {
          const type = change.type;
          const escaped = escapeLine(change.value);
          const sign = type === "added" ? "+" : type === "removed" ? "-" : " ";
          const numA = type === "added" ? "" : lineA++;
          const numB = type === "removed" ? "" : lineB++;

          html += \`<div class="unified-row \${type}">
            <div class="line-num">\${numA}</div>
            <div class="line-num">\${numB}</div>
            <div class="line-sign">\${sign}</div>
            <div class="line-content">\${escaped}</div>
          </div>\`;
        }
        viewer.innerHTML = html;
      } else {
        // Split (Side-by-Side)
        let html = \`<div class="diff-header">
          <div class="diff-header-col">JavaScript 無効 (初期 HTML)</div>
          <div class="diff-header-col">JavaScript 有効 (QuickJS 実行後)</div>
        </div>\`;

        // Pair changes for side-by-side
        const left = [];
        const right = [];
        let i = 0;
        const changes = activeDiff.changes;

        while (i < changes.length) {
          const c = changes[i];
          if (c.type === "unchanged") {
            left.push({ type: "unchanged", value: c.value });
            right.push({ type: "unchanged", value: c.value });
            i++;
          } else {
            const removedChunk = [];
            const addedChunk = [];
            while (i < changes.length && changes[i].type !== "unchanged") {
              if (changes[i].type === "removed") removedChunk.push(changes[i].value);
              if (changes[i].type === "added") addedChunk.push(changes[i].value);
              i++;
            }
            const maxLen = Math.max(removedChunk.length, addedChunk.length);
            for (let k = 0; k < maxLen; k++) {
              left.push(k < removedChunk.length ? { type: "removed", value: removedChunk[k] } : null);
              right.push(k < addedChunk.length ? { type: "added", value: addedChunk[k] } : null);
            }
          }
        }

        let lineLeft = 1;
        let lineRight = 1;
        for (let idx = 0; idx < left.length; idx++) {
          const l = left[idx];
          const r = right[idx];

          const lClass = l ? l.type : "empty";
          const rClass = r ? r.type : "empty";
          const lNum = l ? lineLeft++ : "";
          const rNum = r ? lineRight++ : "";
          const lContent = l ? escapeLine(l.value) : "";
          const rContent = r ? escapeLine(r.value) : "";

          html += \`<div class="split-row">
            <div class="split-cell \${lClass}">
              <div class="line-num">\${lNum}</div>
              <div class="line-content">\${lContent}</div>
            </div>
            <div class="split-cell \${rClass}">
              <div class="line-num">\${rNum}</div>
              <div class="line-content">\${rContent}</div>
            </div>
          </div>\`;
        }
        viewer.innerHTML = html;
      }
    }

    const modeGroup = document.getElementById("modeGroup");
    if (modeGroup) {
      modeGroup.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-mode]");
        if (!btn) return;
        document.querySelectorAll("#modeGroup .btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentMode = btn.dataset.mode;
        renderDiff();
      });
    }

    const layoutGroup = document.getElementById("layoutGroup");
    if (layoutGroup) {
      layoutGroup.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-layout]");
        if (!btn) return;
        document.querySelectorAll("#layoutGroup .btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentLayout = btn.dataset.layout;
        renderDiff();
      });
    }
  </script>
</body>
</html>`;
}
