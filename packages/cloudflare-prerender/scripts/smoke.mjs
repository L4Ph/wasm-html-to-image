// HTTP smoke assertions for cloudflare-prerender, against a local page whose script builds its content:
//   GET /?url=<page>               -> text/html with the script's result and a <base href>
//   GET /?url=<page>&wait=#late    -> waits for an element a timer adds
//   GET /?url=<page>&debug=1       -> JSON with the HTML and the page's logs
// The worker refuses localhost unless ALLOW_PRIVATE_HOSTS=1, so the script writes it to `.dev.vars` for the run.
import { createServer } from "node:http";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, expectStatus, runCfSmoke, REQUEST_TIMEOUT_MS } from "../../../scripts/cf-smoke.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devVars = path.join(pkgDir, ".dev.vars");

const page =
  '<!doctype html><html><head><title>t</title></head><body><h1 id="t">empty</h1><ul id="l"></ul><script>' +
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
      async (base) => {
        const { res, text } = await get(base, `/?url=${encodeURIComponent(target)}&settle=50`);
        assert(res.status === 200, `status=${res.status}`);
        assert(res.headers.get("content-type")?.startsWith("text/html"), `content-type=${res.headers.get("content-type")}`);
        assert(text.includes('<h1 id="t">Rendered by a script</h1>'), "the page's script ran");
        assert(text.includes("<li>item 3</li>"), "the list the script built is there");
        assert(text.includes(`<base href="${target}">`), "a <base href> of the page's URL was added");
        assert(res.headers.get("x-final-url") === target, `x-final-url=${res.headers.get("x-final-url")}`);
        assert(!text.includes('id="late"'), "the timer had not fired within the short settle time");
        console.log("html: ok");
      },
      async (base) => {
        const { text } = await get(base, `/?url=${encodeURIComponent(target)}&wait=${encodeURIComponent("#late")}&settle=0&base=0`);
        assert(text.includes('<p id="late">arrived late</p>'), "waited for #late");
        assert(!text.includes("<base"), "base=0 leaves the HTML alone");
        console.log("wait: ok");
      },
      async (base) => {
        const { res, text } = await get(base, `/?url=${encodeURIComponent(target)}&settle=50&debug=1`);
        const body = JSON.parse(text);
        assert(res.headers.get("content-type")?.startsWith("application/json"), "debug answers JSON");
        assert(body.logs.some((e) => e.type === "console" && e.message === "page says hi"), "the console output is in the logs");
        assert(body.logs.some((e) => e.type === "request" && e.status === 200), "the page's own request is in the logs");
        assert(body.html.includes('<h1 id="t">Rendered by a script</h1>'), "the HTML is in the JSON");
        console.log("debug: ok");
      },
      (base) => expectStatus(base, "/", 400),
      (base) => expectStatus(base, `/?url=${encodeURIComponent("ftp://example.com/")}`, 400),
      (base) => expectStatus(base, "/other", 404),
    ],
  });
} finally {
  origin.close();
  rmSync(devVars, { force: true });
}
