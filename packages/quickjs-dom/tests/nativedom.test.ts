import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

// The native DOM (csrc/nativedom*.h) against jsdom, which follows the DOM and HTML specifications (parse5 is its parser):
// the same random program of tree edits is run once on each, and what each step shows (the tree, the relations of every
// node, the answers of searches and selectors) is compared. This is the net the native DOM is built under.

let dom: QuickJSDOM;
beforeAll(async () => {
  dom = await createDOM({ html: "<p>" }, { settleMs: 0 });
});
afterAll(() => dom.close());

import { side, type Trace } from "./lockstep.js";

function jsdomSide(seed: number, programs: number, steps: number, detail: boolean): Trace[] {
  const { window } = new JSDOM("<p>");
  return side(window.document, seed, programs, steps, detail);
}

async function nativeSide(seed: number, programs: number, steps: number, detail: boolean): Promise<Trace[]> {
  const source = side.toString();
  return dom.eval(`(function () { const side = ${source}; return side(__native.dom.createDocument(), ${seed}, ${programs}, ${steps}, ${detail}); })()`);
}

/** the first place where the two sides differ, with the whole of what each showed there */
async function firstDifference(seed: number, programs: number, steps: number): Promise<string | null> {
  const a = jsdomSide(seed, programs, steps, false);
  const b = await nativeSide(seed, programs, steps, false);
  for (let p = 0; p < programs; p++) {
    const x = a[p].steps;
    const y = b[p].steps;
    for (let s = 0; s < Math.max(x.length, y.length); s++) {
      if (x[s] === y[s]) continue;
      const da = jsdomSide(a[p].seed, 1, steps, true)[0].steps;
      const db = (await nativeSide(a[p].seed, 1, steps, true))[0].steps;
      const log = da.slice(Math.max(0, s - 6), s + 1).map((l) => l.split("\n")[0]);
      const la = (da[s] ?? "(none)").split("\n");
      const lb = (db[s] ?? "(none)").split("\n");
      let k = 0;
      while (k < la.length && la[k] === lb[k]) k++;
      return `program seed ${a[p].seed}, step ${s}\n${log.join("\n")}\njsdom:  ${la[k]}\nnative: ${lb[k]}`;
    }
  }
  return null;
}

describe("native DOM follows jsdom", () => {
  // 800 programs of 60 steps, in batches that each stay inside one eval()'s time limit
  for (const seed of [20250601]) {
    it(`random tree edits, seed ${seed}`, async () => {
      for (let batch = 0; batch < 4; batch++) {
        const difference = await firstDifference(seed + batch * 1000003, 200, 60);
        expect(difference, difference ?? "").toBeNull();
      }
    });
  }
});
