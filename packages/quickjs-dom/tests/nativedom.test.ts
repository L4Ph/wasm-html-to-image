import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

// The native DOM (csrc/nativedom.h) against linkedom: the same random program of tree edits is run on both, and after
// every step the two trees must look the same. This is the net the native DOM is built under.

let dom: QuickJSDOM;
beforeAll(async () => {
  dom = await createDOM({ html: "<p>" }, { settleMs: 0 });
});
afterAll(() => dom.close());

interface Failure {
  seed: number;
  step: number;
  op: string;
  what: string;
  linkedom: unknown;
  native: unknown;
  log: string[];
}

/** run `programs` programs of `steps` steps each, starting from `seed`; returns the first disagreement, if any */
async function lockstep(seed: number, programs: number, steps: number): Promise<Failure | null> {
  return (await dom.eval(
    (seed0: number, programs: number, steps: number) => {
      const N = (globalThis as any).__native.dom;
      const TAGS = ["div", "span", "p", "a", "b", "ul", "li", "section", "em", "table", "td", "br", "img"];
      const VOID = ["br", "img"];
      const TEXTS = ["hello", "a < b & c > d", "x y", "", " ", "quote \" and ' marks", "日本語", "line\nbreak"];
      const ATTRS = [["class", "a"], ["class", "a b"], ["class", "b"], ["id", "x"], ["id", "y"], ["title", "abc"], ["title", "a\"b"], ["href", "http://b/c"], ["data-i", "1"]];
      const MARKUP = ["<p>one</p><p class=a>two</p>", "<ul><li>a<li>b</ul>", "text &amp; <b>bold</b>", "<div id=x><span class='a b'>s</span></div>", "<a href=http://a/b title=t>link</a>", "", "<br><img src=x>"];
      const SELECTORS = ["div", "p", "span", "li", ".a", ".b", ".a.b", "#x", "#y", "[title]", "[title^=a]", "[href*=b]", "[data-i=\"1\"]", "div p", "div > p", "ul > li", "p.a", "div, span", "*", "section em", "a[href]"];
      let seed = seed0 >>> 0;
      const rnd = (n: number) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return Math.floor((seed / 4294967296) * n);
      };
      const pick = <T>(a: T[]): T => a[rnd(a.length)];

      for (let program = 0; program < programs; program++) {
        const programSeed = seed;
        const L: any[] = [];
        const NN: any[] = [];
        const lroot = document.createElement("div");
        const nroot = N.createElement("div");
        L.push(lroot);
        NN.push(nroot);
        const log: string[] = [];
        const indexL = (n: any) => (n == null ? -1 : L.indexOf(n));
        const indexN = (n: any) => (n == null ? -1 : NN.indexOf(n));
        const fail = (step: number, op: string, what: string, a: unknown, b: unknown) => ({ seed: programSeed, step, op, what, linkedom: a, native: b, log });
        const isDescendantL = (n: any, anc: any) => {
          for (let p = n; p; p = p.parentNode) if (p === anc) return true;
          return false;
        };

        for (let step = 0; step < steps; step++) {
          const kind = rnd(10);
          let op = "";
          if (kind === 0) {
            const tag = pick(TAGS);
            op = `createElement ${tag}`;
            L.push(document.createElement(tag));
            NN.push(N.createElement(tag));
          } else if (kind === 1) {
            const t = pick(TEXTS);
            op = `createTextNode ${JSON.stringify(t)}`;
            L.push(document.createTextNode(t));
            NN.push(N.createTextNode(t));
          } else if (kind <= 4) {
            // append / insertBefore a node into an element that is not void and not inside the node
            const ti = rnd(L.length);
            const ni = rnd(L.length);
            if (L[ti].nodeType !== 1 || VOID.includes(L[ti].localName) || ni === 0 || isDescendantL(L[ti], L[ni])) continue;
            const kids = Array.from(L[ti].childNodes) as any[];
            if (kind === 2 || kids.length === 0) {
              op = `append ${ni} -> ${ti}`;
              L[ti].appendChild(L[ni]);
              NN[ti].appendChild(NN[ni]);
            } else {
              // the reference is picked by position, because children made by innerHTML are not in the tables
              const k = rnd(kids.length);
              const ref = kids[k];
              if (ref === L[ni]) continue;
              op = `insertBefore ${ni} -> ${ti} before child ${k}`;
              L[ti].insertBefore(L[ni], ref);
              NN[ti].insertBefore(NN[ni], Array.from(NN[ti].childNodes)[k]);
            }
          } else if (kind === 5) {
            const ni = rnd(L.length);
            if (ni === 0 || !L[ni].parentNode) continue;
            op = `remove ${ni}`;
            L[ni].parentNode.removeChild(L[ni]);
            NN[ni].parentNode.removeChild(NN[ni]);
          } else if (kind === 6) {
            const ni = rnd(L.length);
            if (L[ni].nodeType !== 1) continue;
            const [name, value] = pick(ATTRS);
            op = `setAttribute ${ni} ${name}=${JSON.stringify(value)}`;
            L[ni].setAttribute(name, value);
            NN[ni].setAttribute(name, value);
          } else if (kind === 7) {
            const ni = rnd(L.length);
            if (L[ni].nodeType !== 1 || VOID.includes(L[ni].localName)) continue;
            const t = pick(TEXTS);
            op = `textContent ${ni} = ${JSON.stringify(t)}`;
            // the nodes inside are gone from the tree: forget their parents in the tables by keeping them (they stay valid detached)
            L[ni].textContent = t;
            NN[ni].textContent = t;
          } else if (kind === 8) {
            const ni = rnd(L.length);
            if (L[ni].nodeType !== 1 || VOID.includes(L[ni].localName)) continue;
            const m = pick(MARKUP);
            op = `innerHTML ${ni} = ${JSON.stringify(m)}`;
            L[ni].innerHTML = m;
            NN[ni].innerHTML = m;
          } else {
            const ni = rnd(L.length);
            if (L[ni].nodeType !== 1) continue;
            const name = pick(ATTRS)[0];
            op = `getAttribute ${ni} ${name}`;
            const a = L[ni].getAttribute(name);
            const b = NN[ni].getAttribute(name);
            // known difference: linkedom answers "" for a class attribute that is not there; the DOM says null (the native one does)
            if (a !== b && !(name === "class" && a === "" && b === null)) return fail(step, op, "getAttribute", a, b);
          }
          log.push(op);
          if (log.length > 40) log.shift();

          // the whole tree from the root
          // known difference: linkedom lists class and id before the other attributes; the DOM keeps the order they were set in
          const sortAttrs = (html: string) =>
            html.replace(/<([a-z0-9]+)((?:\s+[a-zA-Z-]+="[^"]*")+)>/g, (_m, tag, attrs) => "<" + tag + (attrs.match(/\s+[a-zA-Z-]+="[^"]*"/g) as string[]).sort().join("") + ">");
          const a = sortAttrs(lroot.outerHTML);
          const b = sortAttrs(nroot.outerHTML);
          if (a !== b) return fail(step, op, "outerHTML", a, b);
          if (lroot.textContent !== nroot.textContent) return fail(step, op, "textContent", lroot.textContent, nroot.textContent);

          // relations of every node that is still reachable or was created
          for (let i = 0; i < L.length; i++) {
            const lp = indexL(L[i].parentNode);
            const np = indexN(NN[i].parentNode);
            // linkedom's parentNode is null for a detached node; so is the native one
            if (lp !== np) return fail(step, op, `parentNode of ${i}`, lp, np);
            const rel = ["firstChild", "lastChild", "nextSibling", "previousSibling"];
            for (const r of rel) {
              const x = indexL(L[i][r]);
              const y = indexN(NN[i][r]);
              if (x !== y) return fail(step, op, `${r} of ${i}`, x, y);
            }
            if (L[i].nodeType === 1 && NN[i].childNodes.length !== L[i].childNodes.length) return fail(step, op, `childNodes.length of ${i}`, L[i].childNodes.length, NN[i].childNodes.length);
          }

          // a few selectors, on the root and on one other element
          const scope = rnd(L.length);
          for (const s of [pick(SELECTORS), pick(SELECTORS)]) {
            for (const si of [0, scope]) {
              if (L[si].nodeType !== 1) continue;
              const xs = Array.from(L[si].querySelectorAll(s)).map(indexL);
              const ys = Array.from(NN[si].querySelectorAll(s)).map(indexN);
              if (xs.join() !== ys.join()) return fail(step, op, `querySelectorAll(${s}) on ${si}`, xs, ys);
              const one = indexL(L[si].querySelector(s));
              const two = indexN(NN[si].querySelector(s));
              if (one !== two) return fail(step, op, `querySelector(${s}) on ${si}`, one, two);
              const mx = L[si].matches(s);
              const my = NN[si].matches(s);
              if (mx !== my) return fail(step, op, `matches(${s}) on ${si}`, mx, my);
            }
          }
        }
      }
      return null;
    },
    seed,
    programs,
    steps,
  )) as Failure | null;
}

describe("native DOM follows linkedom", () => {
  // 800 programs of 60 steps, in batches that each stay inside one eval()'s time limit
  for (const seed of [20250601]) {
    it(`random tree edits, seed ${seed}`, async () => {
      for (let batch = 0; batch < 4; batch++) {
        const failure = await lockstep(seed + batch * 1000003, 200, 60);
        expect(failure, failure ? `${failure.what} after "${failure.op}" (seed ${failure.seed}, step ${failure.step})\n${failure.log.join("\n")}` : "").toBeNull();
      }
    });
  }
});
