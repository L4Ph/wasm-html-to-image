// HTTP smoke assertions for cloudflare-ogp:
//   GET /?title=Hello -> image/png with PNG magic + >100B
//   GET /not-found     -> 404
// The `cf dev` start/wait/stop plumbing lives in scripts/cf-smoke.mjs.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectPng, expectStatus, runCfSmoke } from "../../../scripts/cf-smoke.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.exitCode = await runCfSmoke({
  pkgDir,
  checks: [
    (base) => expectPng(base, `/?title=${encodeURIComponent("Hello")}`),
    (base) => expectStatus(base, "/not-found", 404),
  ],
});
