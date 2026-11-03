#!/usr/bin/env node
/**
 * surface-diff.mjs — the surface inventory of the jsdom-parity plan (Phase 0).
 *
 * Runs the SAME walker inside both windows (real jsdom and wasm-quickjs-dom,
 * each through its own `window.eval`, so the enumeration semantics are
 * identical) and diffs what it finds:
 *
 *   - the set of globals on `window` (jsdom's `_`-prefixed internals are
 *     reported separately: they are not public API, see the design doc §1)
 *   - for every global that is a constructor with a prototype ("interface"),
 *     the member names on its prototype chain and its static names
 *   - for a set of representative elements, the members visible on a live
 *     INSTANCE (its own properties plus its whole prototype chain) — this is
 *     the surface code actually sees, however the classes are wired inside
 *   - the `CSSStyleDeclaration` member list is counted separately: jsdom
 *     materialises its whole CSS property database there, which would swamp
 *     every other number if it were mixed into the structural members.
 *
 * Names only: what a member does is the business of the lockstep
 * comparisons, not this list.
 *
 * Usage: node scripts/surface-diff.mjs [--json <path>]
 */
import { writeFileSync } from "node:fs";
import { JSDOM as RealJSDOM } from "jsdom";
import { JSDOM as OurJSDOM } from "../dist/jsdom.js";

const WALKER = `
(() => {
  const globals = new Set();
  for (let p = window; p; p = Object.getPrototypeOf(p)) {
    for (const n of Object.getOwnPropertyNames(p)) globals.add(n);
  }
  const ifaces = {};
  for (const name of globals) {
    let v;
    try { v = window[name]; } catch { continue; }
    if (typeof v === "function" && v.prototype && typeof v.prototype === "object") {
      const members = new Set();
      for (let p = v.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        for (const m of Object.getOwnPropertyNames(p)) members.add(m);
      }
      const SKIP = new Set(["length", "name", "prototype", "arguments", "caller"]);
      ifaces[name] = {
        members: [...members].sort(),
        statics: Object.getOwnPropertyNames(v).filter((m) => !SKIP.has(m)).sort(),
      };
    }
  }
  const chainNames = (o) => {
    const s = new Set();
    for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const m of Object.getOwnPropertyNames(p)) s.add(m);
    }
    return [...s].sort();
  };
  const instances = {};
  const d = document;
  const specimens = [
    d.documentElement, d.head, d.body, d.createElement("div"), d.createElement("span"),
    d.createElement("a"), d.createElement("img"), d.createElement("form"), d.createElement("input"),
    d.createElement("select"), d.createElement("option"), d.createElement("textarea"),
    d.createElement("button"), d.createElement("table"), d.createElement("td"), d.createElement("ul"),
    d.createElement("li"), d.createElement("video"), d.createElement("audio"), d.createElement("canvas"),
    d.createElement("template"), d.createElement("script"), d.createElement("style"), d.createElement("link"),
    d.createElementNS("http://www.w3.org/2000/svg", "svg"), d.createElementNS("http://www.w3.org/2000/svg", "circle"),
    d.createTextNode("t"), d.createComment("c"), d.createDocumentFragment(), d,
  ];
  for (const el of specimens) {
    const key = (el.constructor && el.constructor.name) || "?";
    if (!instances[key]) instances[key] = chainNames(el);
  }
  const extra = {
    classList: chainNames(d.body.classList),
    dataset: chainNames(d.body.dataset),
    style: chainNames(d.body.style),
    attributes: chainNames(d.body.attributes),
    childNodes: chainNames(d.body.childNodes),
    validity: (() => { const i = d.createElement("input"); return chainNames(i.validity); })(),
    options: chainNames(d.createElement("select").options),
    rows: chainNames(d.createElement("table").rows),
    window: chainNames(window),
    navigator: chainNames(window.navigator || {}),
    location: chainNames(window.location || {}),
    history: chainNames(window.history || {}),
    document: chainNames(d),
  };
  return JSON.stringify({ globals: [...globals].sort(), ifaces, instances, extra });
})()`;

const HTML = `<!doctype html><html><head><title>t</title></head><body>
<form><input type=text><select><option>1</option></select><textarea></textarea><button>b</button></form>
<table><tr><td>c</td></tr></table>
<svg><circle r="1"/></svg>
<video></video><audio></audio><canvas></canvas><img src=x><a href="/">a</a>
<template><li>t</li></template>
</body></html>`;

function inventory(JSDOM) {
  const dom = new JSDOM(HTML, { runScripts: "outside-only", url: "https://example.invalid/" });
  try {
    return JSON.parse(dom.window.eval(WALKER));
  } finally {
    dom.window.close();
  }
}

const diffSet = (a, b) => a.filter((x) => !b.includes(x));
const isInternal = (n) => n.startsWith("_");

const real = inventory(RealJSDOM);
const ours = inventory(OurJSDOM);

const missingGlobals = diffSet(real.globals, ours.globals).filter((g) => !isInternal(g));
const internalGlobals = diffSet(real.globals, ours.globals).filter(isInternal);
const extraGlobals = diffSet(ours.globals, real.globals);
const sharedIfaces = Object.keys(real.ifaces).filter((k) => k in ours.ifaces);
// an interface counts as missing only when the name is not reachable in ours at all: a native
// function (queueMicrotask in the QuickJS runtime) has no JS prototype to walk, but it is there
// and callable, so it is not a gap
const missingIfaces = Object.keys(real.ifaces).filter((k) => !(k in ours.ifaces) && !ours.globals.includes(k));
const extraIfaces = Object.keys(ours.ifaces).filter((k) => !(k in real.ifaces));

const memberGaps = {};
let totalMissingMembers = 0;
for (const name of sharedIfaces) {
  if (name === "CSSStyleDeclaration") continue;
  const missing = diffSet(real.ifaces[name].members, ours.ifaces[name].members);
  const missingStatics = diffSet(real.ifaces[name].statics, ours.ifaces[name].statics);
  if (missing.length || missingStatics.length) {
    memberGaps[name] = { missing, missingStatics };
    totalMissingMembers += missing.length + missingStatics.length;
  }
}
const cssGap = diffSet(real.ifaces.CSSStyleDeclaration?.members ?? [], ours.ifaces.CSSStyleDeclaration?.members ?? []);

const instanceGaps = {};
for (const key of Object.keys(real.instances)) {
  if (!(key in ours.instances)) { instanceGaps[key] = { missingInstance: true }; continue; }
  const missing = diffSet(real.instances[key], ours.instances[key]);
  if (missing.length) instanceGaps[key] = { missing };
}
const extraGaps = {};
for (const key of Object.keys(real.extra)) {
  const missing = diffSet(real.extra[key], ours.extra[key] ?? []);
  if (missing.length) extraGaps[key] = { missing };
}

console.log(`globals:      jsdom ${real.globals.length} / ours ${ours.globals.length} — missing ${missingGlobals.length} (+${internalGlobals.length} jsdom internals, not API), extra ${extraGlobals.length}`);
console.log(`interfaces:   jsdom ${Object.keys(real.ifaces).length} / ours ${Object.keys(ours.ifaces).length} — missing ${missingIfaces.length}, extra ${extraIfaces.length}`);
console.log(`members (constructor chains, CSSStyleDeclaration excluded): ${totalMissingMembers} missing across ${Object.keys(memberGaps).length} shared interfaces`);
console.log(`CSSStyleDeclaration property names: ${cssGap.length} missing`);
console.log(`instances:    ${Object.values(instanceGaps).filter((g) => !g.missingInstance).reduce((n, g) => n + g.missing.length, 0)} members missing across ${Object.keys(instanceGaps).length} specimen kinds`);
if (missingIfaces.length) console.log(`missing interfaces: ${missingIfaces.join(", ")}`);
const nonIfaceGlobals = missingGlobals.filter((g) => !(g in real.ifaces));
if (nonIfaceGlobals.length) console.log(`missing non-interface globals (${nonIfaceGlobals.length}): ${nonIfaceGlobals.slice(0, 40).join(", ")}${nonIfaceGlobals.length > 40 ? " … (mostly on* handler properties)" : ""}`);
for (const [key, g] of Object.entries(instanceGaps)) console.log(`  instance ${key}: ${g.missingInstance ? "no such instance" : `${g.missing.length} missing (${g.missing.slice(0, 10).join(", ")}${g.missing.length > 10 ? ", …" : ""})`}`);
for (const [key, g] of Object.entries(extraGaps)) console.log(`  object ${key}: ${g.missing.length} missing (${g.missing.slice(0, 10).join(", ")}${g.missing.length > 10 ? ", …" : ""})`);

const jsonAt = process.argv.indexOf("--json");
if (jsonAt >= 0 && process.argv[jsonAt + 1]) {
  writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ real, ours, diff: { missingGlobals, internalGlobals, extraGlobals, missingIfaces, extraIfaces, memberGaps, cssGap, instanceGaps, extraGaps } }, null, 1));
  console.log(`full dictionaries written to ${process.argv[jsonAt + 1]}`);
}
