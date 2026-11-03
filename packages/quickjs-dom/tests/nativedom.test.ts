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

interface Trace {
  seed: number;
  steps: string[];
}

/**
 * One side of the comparison: runs `programs` programs of `steps` steps on `doc` and returns, per program, its seed and a
 * line per step (the operation, and a hash of what could be seen afterwards; the whole of it with `detail`).
 * Everything the program does is decided by its seed and by what the DOM shows, so two DOMs that agree make the same moves.
 * It is sent to the page as source text: it must not use anything from outside.
 */
function side(doc: any, seed0: number, programs: number, steps: number, detail: boolean): Trace[] {
  const TAGS = ["div", "span", "p", "a", "b", "ul", "li", "section", "em", "table", "td", "br", "img"];
  const VOID = ["br", "img"];
  const TEXTS = ["hello", "a < b & c > d", "x y", "", " ", "quote \" and ' marks", "日本語", "line\nbreak"];
  const ATTRS = [["class", "a"], ["class", "a b"], ["class", "b"], ["id", "x"], ["id", "y"], ["title", "abc"], ["title", "a\"b"], ["href", "http://b/c"], ["data-i", "1"]];
  const MARKUP = ["<p>one</p><p class=a>two</p>", "<ul><li>a<li>b</ul>", "text &amp; <b>bold</b>", "<div id=x><span class='a b'>s</span></div>", "<a href=http://a/b title=t>link</a>", "", "<br><img src=x>"];
  const SELECTORS = ["div", "p", "span", "li", ".a", ".b", ".a.b", "#x", "#y", "[title]", "[title^=a]", "[href*=b]", "[data-i=\"1\"]", "div p", "div > p", "ul > li", "p.a", "div, span", "*", "section em", "a[href]"];
  const TOKENS = ["a", "b", "c", "on", "x-y"];
  let seed = seed0 >>> 0;
  const rnd = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 4294967296) * n);
  };
  const pick = <T>(a: T[]): T => a[rnd(a.length)];
  const hash = (s: string) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
    return String(h);
  };

  const out: Trace[] = [];
  for (let program = 0; program < programs; program++) {
    const trace: Trace = { seed, steps: [] };
    out.push(trace);
    const L: any[] = [doc.createElement("div")];
    const root = L[0];
    const index = (n: any) => (n == null ? -1 : L.indexOf(n));
    const isDescendant = (n: any, anc: any) => {
      for (let p = n; p; p = p.parentNode) if (p === anc) return true;
      return false;
    };
    const canHold = (i: number) => (L[i].nodeType === 1 || L[i].nodeType === 11) && !VOID.includes(L[i].localName);
    const isEl = (i: number) => L[i].nodeType === 1;
    const mutates = (i: number) => isEl(i) && !VOID.includes(L[i].localName);

    for (let step = 0; step < steps; step++) {
      const kind = rnd(26);
      let op = "";
      const seen: string[] = []; // what the operation itself returned
      try {
        if (kind === 0) {
          const tag = pick(TAGS);
          op = `createElement ${tag}`;
          L.push(doc.createElement(tag));
        } else if (kind === 1) {
          const t = pick(TEXTS);
          op = `createTextNode ${JSON.stringify(t)}`;
          L.push(doc.createTextNode(t));
        } else if (kind === 2) {
          op = "createDocumentFragment";
          L.push(doc.createDocumentFragment());
        } else if (kind === 3) {
          const t = pick(TEXTS);
          op = `createComment ${JSON.stringify(t)}`;
          L.push(doc.createComment(t));
        } else if (kind <= 7) {
          const ti = rnd(L.length);
          const ni = rnd(L.length);
          if (!canHold(ti) || ni === 0 || isDescendant(L[ti], L[ni])) continue;
          const kids = Array.from(L[ti].childNodes) as any[];
          if (kind <= 5 || kids.length === 0) {
            op = `append ${ni} -> ${ti}`;
            L[ti].appendChild(L[ni]);
          } else {
            const k = rnd(kids.length);
            if (kids[k] === L[ni]) continue;
            op = `insertBefore ${ni} -> ${ti} before child ${k}`;
            L[ti].insertBefore(L[ni], kids[k]);
          }
        } else if (kind === 8) {
          const ni = rnd(L.length);
          if (ni === 0 || !L[ni].parentNode) continue;
          op = `remove ${ni}`;
          L[ni].parentNode.removeChild(L[ni]);
        } else if (kind === 9) {
          const ni = rnd(L.length);
          if (!isEl(ni)) continue;
          const [name, value] = pick(ATTRS);
          op = `setAttribute ${ni} ${name}=${JSON.stringify(value)}`;
          L[ni].setAttribute(name, value);
        } else if (kind === 10) {
          const ni = rnd(L.length);
          if (!mutates(ni)) continue;
          const t = pick(TEXTS);
          op = `textContent ${ni} = ${JSON.stringify(t)}`;
          L[ni].textContent = t;
        } else if (kind === 11) {
          const ni = rnd(L.length);
          if (!mutates(ni)) continue;
          const m = pick(MARKUP);
          op = `innerHTML ${ni} = ${JSON.stringify(m)}`;
          L[ni].innerHTML = m;
        } else if (kind === 12) {
          const ni = rnd(L.length);
          if (!isEl(ni)) continue;
          const name = pick(ATTRS)[0];
          op = `getAttribute ${ni} ${name}`;
          seen.push(String(L[ni].getAttribute(name)));
        } else if (kind === 13) {
          const ni = rnd(L.length);
          const deep = rnd(2) === 0;
          if (L[ni].nodeType === 11 && !deep) continue;
          op = `cloneNode ${ni} deep=${deep}`;
          L.push(L[ni].cloneNode(deep));
        } else if (kind === 14) {
          const ti = rnd(L.length);
          const ni = rnd(L.length);
          if (!canHold(ti) || ni === 0 || isDescendant(L[ti], L[ni])) continue;
          const kids = Array.from(L[ti].childNodes) as any[];
          if (kids.length === 0) continue;
          const k = rnd(kids.length);
          if (kids[k] === L[ni]) continue;
          op = `replaceChild ${ni} in ${ti} at child ${k}`;
          L[ti].replaceChild(L[ni], kids[k]);
        } else if (kind === 15) {
          const ni = rnd(L.length);
          if (!isEl(ni)) continue;
          op = `normalize ${ni}`;
          L[ni].normalize();
        } else if (kind === 16) {
          const ni = rnd(L.length);
          if (!isEl(ni)) continue;
          const t = pick(TOKENS);
          const which = ["add", "remove", "toggle", "contains"][rnd(4)];
          op = `classList ${which} ${ni} ${t}`;
          seen.push(String((L[ni].classList as any)[which](t)), String(L[ni].classList.length), L[ni].classList.value);
        } else if (kind === 17) {
          const ni = rnd(L.length);
          if (!isEl(ni)) continue;
          const key = pick(["fooBar", "x", "aB"]);
          const v = pick(TEXTS);
          op = `dataset ${ni} ${key} = ${JSON.stringify(v)}`;
          L[ni].dataset[key] = v;
          seen.push(L[ni].dataset[key]);
        } else if (kind === 18) {
          const ti = rnd(L.length);
          const ni = rnd(L.length);
          if (!mutates(ti) || ni === 0 || isDescendant(L[ti], L[ni]) || L[ni].nodeType === 11) continue;
          const which = pick(["append", "prepend", "before", "after", "replaceWith"]);
          const s = pick(TEXTS);
          if ((which === "before" || which === "after" || which === "replaceWith") && (!L[ti].parentNode || L[ti].parentNode.nodeType !== 1)) continue;
          if (L[ni] === L[ti] && which !== "append" && which !== "prepend") continue;
          op = `${which} on ${ti} with node ${ni} and ${JSON.stringify(s)}`;
          (L[ti] as any)[which](L[ni], s);
        } else if (kind === 19) {
          const ni = rnd(L.length);
          if (ni === 0 || L[ni].nodeType === 11) continue;
          op = `ChildNode.remove ${ni}`;
          L[ni].remove();
        } else if (kind === 20) {
          const ni = rnd(L.length);
          if (!mutates(ni)) continue;
          const where = pick(["beforebegin", "afterbegin", "beforeend", "afterend"]);
          if ((where === "beforebegin" || where === "afterend") && (!L[ni].parentNode || L[ni].parentNode.nodeType !== 1)) continue;
          if (rnd(2) === 0) {
            const m = pick(MARKUP);
            op = `insertAdjacentHTML ${ni} ${where} ${JSON.stringify(m)}`;
            L[ni].insertAdjacentHTML(where, m);
          } else {
            const t = pick(TEXTS);
            op = `insertAdjacentText ${ni} ${where} ${JSON.stringify(t)}`;
            L[ni].insertAdjacentText(where, t);
          }
        } else if (kind === 21) {
          const ni = rnd(L.length);
          if (!isEl(ni)) continue;
          const tag = pick(TAGS);
          const cls = pick(["a", "b", "a b"]);
          const sel = pick(SELECTORS);
          op = `searches ${ni} ${tag} ${cls} ${sel}`;
          seen.push(
            Array.from(L[ni].getElementsByTagName(tag)).map(index).join(),
            Array.from(L[ni].getElementsByClassName(cls)).map(index).join(),
            String(index(L[ni].closest(sel))),
          );
        } else if (kind === 22) {
          const xi = rnd(L.length);
          const yi = rnd(L.length);
          op = `contains ${xi} ${yi}`;
          seen.push(String(L[xi].contains(L[yi])));
          const rootOf = (n: any) => {
            let r = n;
            while (r.parentNode) r = r.parentNode;
            return r;
          };
          // the order of nodes of different trees is up to the implementation
          if (rootOf(L[xi]) === rootOf(L[yi])) seen.push(String(L[xi].compareDocumentPosition(L[yi]) & 0x1e));
        } else if (kind === 23) {
          const ni = rnd(L.length);
          if (!isEl(ni)) continue;
          const name = pick(ATTRS)[0];
          op = `removeAttribute ${ni} ${name}`;
          L[ni].removeAttribute(name);
        } else if (kind === 24) {
          const ni = rnd(L.length);
          op = `hasChildNodes / getRootNode ${ni}`;
          seen.push(String(L[ni].hasChildNodes()), String(index(L[ni].getRootNode())));
        } else {
          const ni = rnd(L.length);
          if (!isEl(ni)) continue;
          const v = pick(["x", "y", "a b"]);
          const prop = pick(["id", "className"]);
          op = `${prop} ${ni} = ${v}`;
          (L[ni] as any)[prop] = v;
        }
      } catch (e: any) {
        // an operation both sides refuse is fine, as long as they refuse alike
        trace.steps.push(`${step} ${op || "kind " + kind} threw ${e && e.name}`);
        continue;
      }

      // what can be seen of the whole tree
      const shown: string[] = [...seen, root.outerHTML, root.textContent];
      for (let i = 0; i < L.length; i++) {
        const n = L[i];
        shown.push(
          [i, n.nodeType, index(n.parentNode), index(n.firstChild), index(n.lastChild), index(n.nextSibling), index(n.previousSibling)].join(),
        );
        if (n.nodeType === 1 || n.nodeType === 11) shown.push(String(n.childNodes.length));
        if (n.nodeType === 1) shown.push(String(index(n.firstElementChild)), String(n.isConnected));
      }
      const scope = rnd(L.length);
      for (const s of [pick(SELECTORS), pick(SELECTORS)]) {
        for (const si of [0, scope]) {
          if (L[si].nodeType !== 1) continue;
          shown.push(`${s} on ${si}`, Array.from(L[si].querySelectorAll(s)).map(index).join(), String(index(L[si].querySelector(s))), String(L[si].matches(s)));
        }
      }
      const text = shown.join("\n");
      trace.steps.push(`${step} ${op} ${detail ? "\n" + text : hash(text)}`);
    }
  }
  return out;
}

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
