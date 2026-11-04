// The globals a test environment ends up with, ours against jsdom's: both windows go through the
// package's own installWindow (what the Vitest and Jest environments run), onto fresh objects,
// and the installed names are compared. Deliberate differences (Node's own names that
// installWindow keeps, jsdom's internals) are listed apart, not counted.
//   node scripts/env-diff.mjs
//
// Exit 1 when a name jsdom's environment has is missing from ours and is not one of the recorded
// escapes (Window is the surface remainder; Atomics/WebAssembly come from the host runtime showing
// through jsdom's window; the underscore-prefixed names are jsdom internals, not API).
import { JSDOM as RealJSDOM } from "jsdom";
import { JSDOM } from "../src/jsdom.ts";
import { installWindow } from "../src/globals.ts";

const ALLOWED_MISSING = new Set(["Window", "Atomics", "WebAssembly"]);
const installed = (win) => {
  const g = {};
  const uninstall = installWindow(g, win);
  const names = Object.getOwnPropertyNames(g).sort();
  uninstall();
  return names;
};
const ours = new JSDOM("<!DOCTYPE html>", { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously", virtualConsole: null });
const ref = new RealJSDOM("<!DOCTYPE html>", { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously" });
const a = installed(ours.window);
const b = installed(ref.window);
ours.close();
const missing = b.filter((k) => !a.includes(k));
const extra = a.filter((k) => !b.includes(k));
console.log(`environment globals: jsdom ${b.length}, ours ${a.length}`);
console.log("missing from ours:", JSON.stringify(missing));
console.log("extra in ours:   ", JSON.stringify(extra));
const unexpected = missing.filter((k) => !ALLOWED_MISSING.has(k) && !k.startsWith("_"));
if (unexpected.length) {
  console.error(`env-diff: ${unexpected.length} unrecorded missing global(s): ${unexpected.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("env-diff: PASS (only the recorded escapes are missing)");
}
