#!/usr/bin/env node
/**
 * area-diff.mjs — the semantic inventory of the jsdom-parity plan (Phase 0).
 *
 * Runs the seeded area programs of scripts/area-sides.mjs on real jsdom and
 * on wasm-quickjs-dom (the side is serialised and evaluated inside the guest
 * window, exactly like tests/nativedom.test.ts does for the native DOM) and
 * compares the traces step by step. Per area it reports how many programs
 * agree completely and the first divergence of the first few that do not —
 * the initial score Phase 2 has to drive to zero.
 *
 * Usage: node scripts/area-diff.mjs [--programs 20] [--steps 60] [--areas events,parse] [--json <path>]
 */
import { writeFileSync } from "node:fs";
import { JSDOM as RealJSDOM } from "jsdom";
import { JSDOM as OurJSDOM } from "../dist/jsdom.js";
import { AREAS } from "./area-sides.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const PROGRAMS = Number(arg("programs", "20"));
const STEPS = Number(arg("steps", "60"));
const ONLY = arg("areas", Object.keys(AREAS).join(",")).split(",");
const BATCH = 5;

function compare(name, side) {
  const real = new RealJSDOM("", { runScripts: "outside-only", url: "https://example.invalid/" });
  const ours = new OurJSDOM("", { runScripts: "outside-only", url: "https://example.invalid/" });
  let equal = 0;
  const divergences = [];
  try {
    const source = side.toString();
    for (let done = 0; done < PROGRAMS; done += BATCH) {
      const n = Math.min(BATCH, PROGRAMS - done);
      const seedBase = 7919 * (done + 1) + name.length * 131;
      const a = side(real.window, seedBase, n, STEPS);
      const b = ours.window.eval(`(function () { const side = ${source}; return side(window, ${seedBase}, ${n}, ${STEPS}); })()`);
      for (let p = 0; p < n; p++) {
        const x = a[p].steps, y = b[p].steps;
        let div = -1;
        for (let s = 0; s < Math.max(x.length, y.length); s++) if (x[s] !== y[s]) { div = s; break; }
        if (div < 0) equal++;
        else if (divergences.length < 3) divergences.push({ seed: a[p].seed, step: div, jsdom: x[div], ours: y[div] });
      }
    }
  } finally {
    real.window.close();
    ours.window.close();
  }
  return { area: name, programs: PROGRAMS, steps: STEPS, equal, divergences };
}

const results = [];
for (const name of ONLY) {
  const r = compare(name, AREAS[name]);
  results.push(r);
  console.log(`${name.padEnd(9)} ${r.equal}/${r.programs} programs agree (${STEPS} steps each)`);
  for (const d of r.divergences) {
    console.log(`  seed ${d.seed} step ${d.step}:`);
    console.log(`    jsdom: ${String(d.jsdom).slice(0, 220)}`);
    console.log(`    ours:  ${String(d.ours).slice(0, 220)}`);
  }
}
const jsonAt = process.argv.indexOf("--json");
if (jsonAt >= 0 && process.argv[jsonAt + 1]) {
  writeFileSync(process.argv[jsonAt + 1], JSON.stringify(results, null, 1));
  console.log(`details written to ${process.argv[jsonAt + 1]}`);
}
