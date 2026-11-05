// HTTP smoke assertions for cloudflare-screenshot, against a local page whose script builds its content:
//   GET /?url=<page>            -> image/png (the page's script ran: the image is larger than the empty page's)
//   GET /?url=<page>&js=0       -> image/png without running the script
// The worker refuses localhost unless ALLOW_PRIVATE_HOSTS=1, so the script writes it to `.dev.vars` for the run.
import { createServer } from "node:http";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, expectPng, expectStatus, runCfSmoke } from "../../../scripts/cf-smoke.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devVars = path.join(pkgDir, ".dev.vars");

const page =
  '<!doctype html><body style="margin:0;background:#fff"><h1 id="t">empty</h1><ul id="l"></ul><script>' +
  'document.getElementById("t").textContent = "Rendered by a script";' +
  'for (let i = 1; i <= 8; i++) { const li = document.createElement("li"); li.textContent = "item " + i; li.style.cssText = "font-size:28px;color:#c00"; document.getElementById("l").appendChild(li); }' +
  "</script></body>";

const origin = createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(page);
}).listen(0, "127.0.0.1");
await new Promise((r) => origin.once("listening", r));
const target = `http://127.0.0.1:${origin.address().port}/`;

writeFileSync(devVars, "ALLOW_PRIVATE_HOSTS=1\n");
try {
  process.exitCode = await runCfSmoke({
    pkgDir,
    checks: [
      async (base) => {
        const withJs = await expectPng(base, `/?url=${encodeURIComponent(target)}&width=600&settle=100`);
        const withoutJs = await expectPng(base, `/?url=${encodeURIComponent(target)}&width=600&js=0`);
        assert(withJs.length !== withoutJs.length, `the script changed the picture (${withJs.length}B vs ${withoutJs.length}B)`);
      },
      (base) => expectStatus(base, "/", 400),
      (base) => expectStatus(base, `/?url=${encodeURIComponent("ftp://example.com/")}`, 400),
      (base) => expectStatus(base, `/?url=${encodeURIComponent(target)}&format=gif`, 400),
      (base) => expectStatus(base, "/other", 404),
    ],
  });
} finally {
  origin.close();
  rmSync(devVars, { force: true });
}
