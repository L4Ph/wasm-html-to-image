#!/usr/bin/env node
/**
 * check-gaps.mjs — the freshness check for tests/known-gaps.json.
 *
 * Re-runs the surface inventory and fails (exit 1) if the facts the ledger
 * records about the surface have drifted: the missing-interface set, the
 * headline global/interface counts, the CSS property-name count and the
 * aria* count on a specimen element. When this fails after an intended fix,
 * update the ledger in the same commit — the ledger is the progress metric
 * of the parity plan, and it is only allowed to shrink.
 *
 * Usage: node scripts/check-gaps.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), "gaps-")), "surface.json");
execFileSync(process.execPath, [join(here, "surface-diff.mjs"), "--json", out], { stdio: "pipe" });
const fresh = JSON.parse(readFileSync(out, "utf8"));
const ledger = JSON.parse(readFileSync(join(here, "..", "tests", "known-gaps.json"), "utf8"));

const problems = [];
const expect = (label, recorded, actual) => {
  if (JSON.stringify(recorded) !== JSON.stringify(actual)) problems.push(`${label}: ledger says ${JSON.stringify(recorded)}, inventory says ${JSON.stringify(actual)}`);
};

const groups = Object.fromEntries(ledger.surface.groups.map((g) => [g.id, g]));
const recordedMissing = [...groups["surface.unexposed-classes"].items, ...groups["surface.missing-features"].items].sort();
expect("missing interfaces", recordedMissing, [...fresh.diff.missingIfaces].sort());
expect("globals jsdom/ours/missing", [ledger.surface.globals.jsdom, ledger.surface.globals.ours, ledger.surface.globals.missing], [fresh.real.globals.length, fresh.ours.globals.length, fresh.diff.missingGlobals.length]);
expect("jsdom internals", ledger.surface.globals.jsdomInternalsNotApi, fresh.diff.internalGlobals.length);
expect("interfaces jsdom/ours/missing/extra", [ledger.surface.interfaces.jsdom, ledger.surface.interfaces.ours, ledger.surface.interfaces.missing, ledger.surface.interfaces.extra], [Object.keys(fresh.real.ifaces).length, Object.keys(fresh.ours.ifaces).length, fresh.diff.missingIfaces.length, fresh.diff.extraIfaces.length]);
expect("css property names", groups["surface.css-property-names"].count, fresh.diff.cssGap.length);
const aria = (fresh.diff.instanceGaps.HTMLDivElement?.missing ?? []).filter((x) => x.startsWith("aria")).length;
expect("aria* on HTMLDivElement", groups["surface.aria-reflection"].count, aria);
const onCount = fresh.diff.missingGlobals.filter((x) => x.startsWith("on")).length;
expect("window on* globals", groups["surface.window-event-handlers"].count, onCount);

if (problems.length) {
  console.error("known-gaps.json is stale:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("known-gaps.json matches a fresh surface inventory.");
