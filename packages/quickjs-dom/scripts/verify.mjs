#!/usr/bin/env node
/**
 * verify.mjs — the parity checks in one place.
 *
 *   node scripts/verify.mjs          surface ledger + environment globals + 2x perf guard
 *   node scripts/verify.mjs --full   the above, then @testing-library/dom's suite
 *                                    (--deny-skips --dual-run; network on the first run)
 *
 * Each check is its own script and exits non-zero on drift; this runner only sequences them and
 * reports which one failed. Build first: perf-check and surface-diff import dist/.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const full = process.argv.includes("--full");
const checks = [
  ["check-gaps.mjs", [], "surface inventory matches tests/known-gaps.json"],
  ["env-diff.mjs", [], "environment globals match the recorded escapes"],
  ["perf-check.mjs", [], "host-driven DOM work is within 2x of jsdom"],
];
if (full) checks.push(["tl-suite.mjs", ["--deny-skips", "--dual-run"], "testing-library suite: 654/657, dual run identical, failures registered"]);

let failed = false;
for (const [script, extra, label] of checks) {
  console.log(`\n== ${label}`);
  const r = spawnSync(process.execPath, [join(here, script), ...extra], { stdio: "inherit" });
  if (r.status !== 0) {
    failed = true;
    console.error(`verify: ${script} failed`);
  }
}
if (failed) {
  console.error("\nverify: FAILED");
  process.exit(1);
}
console.log("\nverify: PASS");
