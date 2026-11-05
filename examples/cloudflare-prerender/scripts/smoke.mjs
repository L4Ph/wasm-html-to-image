// HTTP smoke assertions for cloudflare-prerender (diff comparison mode), against a local page:
//   GET /                          -> Top page with URL input form (text/html)
//   GET /?url=<page>               -> Diff Viewer UI (text/html) comparing no-JS vs with-JS
//   GET /?url=<page>&format=raw    -> text/html with raw prerendered result (backward compatible)
//   GET /?url=<page>&format=json   -> JSON with diffs, stats and page logs
//   GET /?url=<page>&wait=#late    -> waits for an element a timer adds
import { createServer } from "node:http";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, expectStatus, runCfSmoke, REQUEST_TIMEOUT_MS } from "../../../scripts/cf-smoke.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devVars = path.join(pkgDir, ".dev.vars");

const page =
  '<!doctype html><html><head><title>Initial Title</title></head><body><h1 id="t">empty</h1><ul id="l"></ul><script>' +
  'document.title = "Updated Title";' +
  'document.getElementById("t").textContent = "Rendered by a script";' +
  'for (let i = 1; i <= 3; i++) { const li = document.createElement("li"); li.textContent = "item " + i; document.getElementById("l").appendChild(li); }' +
  'console.log("page says hi");' +
  'setTimeout(function () { var p = document.createElement("p"); p.id = "late"; p.textContent = "arrived " + "late"; document.body.appendChild(p); }, 1500);' +
  "</script></body></html>";

const origin = createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(page);
}).listen(0, "127.0.0.1");
await new Promise((r) => origin.once("listening", r));
const target = `http://127.0.0.1:${origin.address().port}/`;

const get = async (base, route) => {
  const res = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { res, text: await res.text() };
};

writeFileSync(devVars, "ALLOW_PRIVATE_HOSTS=1\n");
try {
  process.exitCode = await runCfSmoke({
    pkgDir,
    checks: [
      // 1. Home page: form is displayed when no URL is provided
      async (base) => {
        const { res, text } = await get(base, "/");
        assert(res.status === 200, `status=${res.status}`);
        assert(res.headers.get("content-type")?.startsWith("text/html"), `content-type=${res.headers.get("content-type")}`);
        assert(text.includes('action="/"'), "has form submitting to /");
        assert(text.includes('name="url"'), "has url input field");
        assert(text.includes("JS Render Diff Viewer"), "renders title");
        console.log("home form: ok");
      },
      // 2. Default: HTML Diff Viewer UI
      async (base) => {
        const { res, text } = await get(base, `/?url=${encodeURIComponent(target)}&settle=50`);
        assert(res.status === 200, `status=${res.status}`);
        assert(res.headers.get("content-type")?.startsWith("text/html"), `content-type=${res.headers.get("content-type")}`);
        assert(text.includes("JS Render Diff Viewer"), "renders the diff viewer UI");
        assert(text.includes("Initial Title"), "shows initial title");
        assert(text.includes("Updated Title"), "shows updated title");
        assert(text.includes("diffData"), "embeds diffData in page");
        assert(res.headers.get("x-final-url") === target, `x-final-url=${res.headers.get("x-final-url")}`);
        console.log("ui viewer: ok");
      },
      // 3. Backward compatibility: format=raw returns prerendered HTML directly
      async (base) => {
        const { res, text } = await get(base, `/?url=${encodeURIComponent(target)}&format=raw&settle=50`);
        assert(res.status === 200, `status=${res.status}`);
        assert(res.headers.get("content-type")?.startsWith("text/html"), `content-type=${res.headers.get("content-type")}`);
        assert(text.includes('<h1 id="t">Rendered by a script</h1>'), "raw format includes rendered content");
        assert(text.includes("<li>item 3</li>"), "raw format includes rendered list");
        assert(text.includes(`<base href="${target}">`), "a <base href> of the page's URL was added");
        console.log("raw format: ok");
      },
      // 4. wait parameter with format=raw
      async (base) => {
        const { text } = await get(base, `/?url=${encodeURIComponent(target)}&format=raw&wait=${encodeURIComponent("#late")}&settle=0&base=0`);
        assert(text.includes('<p id="late">arrived late</p>'), "waited for #late");
        assert(!text.includes("<base"), "base=0 leaves the HTML alone");
        console.log("wait: ok");
      },
      // 5. JSON format with diff details (debug=1 or format=json)
      async (base) => {
        const { res, text } = await get(base, `/?url=${encodeURIComponent(target)}&settle=50&format=json`);
        const body = JSON.parse(text);
        assert(res.headers.get("content-type")?.startsWith("application/json"), "format=json answers JSON");
        assert(body.titles.noJs === "Initial Title", `noJs title=${body.titles.noJs}`);
        assert(body.titles.withJs === "Updated Title", `withJs title=${body.titles.withJs}`);
        assert(body.noJs.html.includes("empty"), "noJs html has initial markup");
        assert(body.withJs.html.includes("Rendered by a script"), "withJs html has rendered markup");
        assert(body.textDiff.changes.some((c) => c.type === "added" && c.value.includes("Rendered by a script")), "diff detects added script content");
        assert(body.logs.some((e) => e.type === "console" && e.message === "page says hi"), "the console output is in the logs");
        console.log("json format: ok");
      },
      (base) => expectStatus(base, "/?format=json", 400),
      (base) => expectStatus(base, `/?url=${encodeURIComponent("ftp://example.com/")}&format=json`, 400),
      (base) => expectStatus(base, "/other", 404),
    ],
  });
} finally {
  origin.close();
  rmSync(devVars, { force: true });
}
