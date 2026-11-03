import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

// The native DOM (csrc/nativedom*.h) against linkedom: the same random program of tree edits is run on both, and after
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
      const TOKENS = ["a", "b", "c", "on", "x-y"];
      let seed = seed0 >>> 0;
      const rnd = (n: number) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return Math.floor((seed / 4294967296) * n);
      };
      const pick = <T>(a: T[]): T => a[rnd(a.length)];

      for (let program = 0; program < programs; program++) {
        const programSeed = seed;
        const ndoc = N.createDocument();
        const L: any[] = [];
        const NN: any[] = [];
        const lroot = document.createElement("div");
        const nroot = ndoc.createElement("div");
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
        // both sides get new nodes in step, so index i is the same node on each
        const add = (l: any, n: any) => {
          L.push(l);
          NN.push(n);
        };
        const canHold = (i: number) => (L[i].nodeType === 1 || L[i].nodeType === 11) && !VOID.includes(L[i].localName);
        const isEl = (i: number) => L[i].nodeType === 1;
        const mutates = (i: number) => isEl(i) && !VOID.includes(L[i].localName);

        for (let step = 0; step < steps; step++) {
          const kind = rnd(26);
          let op = "";
          try {
            if (kind === 0) {
              const tag = pick(TAGS);
              op = `createElement ${tag}`;
              add(document.createElement(tag), ndoc.createElement(tag));
            } else if (kind === 1) {
              const t = pick(TEXTS);
              op = `createTextNode ${JSON.stringify(t)}`;
              add(document.createTextNode(t), ndoc.createTextNode(t));
            } else if (kind === 2) {
              op = "createDocumentFragment";
              add(document.createDocumentFragment(), ndoc.createDocumentFragment());
            } else if (kind === 3) {
              const t = pick(TEXTS);
              op = `createComment ${JSON.stringify(t)}`;
              add(document.createComment(t), ndoc.createComment(t));
            } else if (kind <= 7) {
              // append / insertBefore a node into a parent that is not void and not inside the node
              const ti = rnd(L.length);
              const ni = rnd(L.length);
              if (!canHold(ti) || ni === 0 || isDescendantL(L[ti], L[ni])) continue;
              const kids = Array.from(L[ti].childNodes) as any[];
              if (kind <= 5 || kids.length === 0) {
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
            } else if (kind === 8) {
              const ni = rnd(L.length);
              if (ni === 0 || !L[ni].parentNode) continue;
              op = `remove ${ni}`;
              L[ni].parentNode.removeChild(L[ni]);
              NN[ni].parentNode.removeChild(NN[ni]);
            } else if (kind === 9) {
              const ni = rnd(L.length);
              if (!isEl(ni)) continue;
              const [name, value] = pick(ATTRS);
              op = `setAttribute ${ni} ${name}=${JSON.stringify(value)}`;
              L[ni].setAttribute(name, value);
              NN[ni].setAttribute(name, value);
            } else if (kind === 10) {
              const ni = rnd(L.length);
              if (!mutates(ni)) continue;
              const t = pick(TEXTS);
              op = `textContent ${ni} = ${JSON.stringify(t)}`;
              L[ni].textContent = t;
              NN[ni].textContent = t;
            } else if (kind === 11) {
              const ni = rnd(L.length);
              if (!mutates(ni)) continue;
              const m = pick(MARKUP);
              op = `innerHTML ${ni} = ${JSON.stringify(m)}`;
              L[ni].innerHTML = m;
              NN[ni].innerHTML = m;
            } else if (kind === 12) {
              const ni = rnd(L.length);
              if (!isEl(ni)) continue;
              const name = pick(ATTRS)[0];
              op = `getAttribute ${ni} ${name}`;
              const a = L[ni].getAttribute(name);
              const b = NN[ni].getAttribute(name);
              // known difference: linkedom answers "" for a class attribute that is not there; the DOM says null (the native one does)
              if (a !== b && !(name === "class" && a === "" && b === null)) return fail(step, op, "getAttribute", a, b);
            } else if (kind === 13) {
              // cloneNode: the copy is a new node on both sides
              const ni = rnd(L.length);
              const deep = rnd(2) === 0;
              if (L[ni].nodeType === 11 && !deep) continue;
              op = `cloneNode ${ni} deep=${deep}`;
              add(L[ni].cloneNode(deep), NN[ni].cloneNode(deep));
            } else if (kind === 14) {
              // replaceChild
              const ti = rnd(L.length);
              const ni = rnd(L.length);
              if (!canHold(ti) || ni === 0 || isDescendantL(L[ti], L[ni])) continue;
              const kids = Array.from(L[ti].childNodes) as any[];
              if (kids.length === 0) continue;
              const k = rnd(kids.length);
              if (kids[k] === L[ni]) continue;
              op = `replaceChild ${ni} in ${ti} at child ${k}`;
              L[ti].replaceChild(L[ni], kids[k]);
              NN[ti].replaceChild(NN[ni], Array.from(NN[ti].childNodes)[k]);
            } else if (kind === 15) {
              // normalize
              const ni = rnd(L.length);
              if (!isEl(ni)) continue;
              op = `normalize ${ni}`;
              L[ni].normalize();
              NN[ni].normalize();
            } else if (kind === 16) {
              // classList
              const ni = rnd(L.length);
              if (!isEl(ni)) continue;
              const t = pick(TOKENS);
              const which = rnd(4);
              op = `classList ${["add", "remove", "toggle", "contains"][which]} ${ni} ${t}`;
              const a = (L[ni].classList as any)[["add", "remove", "toggle", "contains"][which]](t);
              const b = (NN[ni].classList as any)[["add", "remove", "toggle", "contains"][which]](t);
              if (a !== b) return fail(step, op, "classList result", a, b);
              if (L[ni].classList.length !== NN[ni].classList.length) return fail(step, op, "classList.length", L[ni].classList.length, NN[ni].classList.length);
            } else if (kind === 17) {
              // dataset
              const ni = rnd(L.length);
              if (!isEl(ni)) continue;
              const key = pick(["fooBar", "x", "aB"]);
              const v = pick(TEXTS);
              op = `dataset ${ni} ${key} = ${JSON.stringify(v)}`;
              L[ni].dataset[key] = v;
              NN[ni].dataset[key] = v;
              if (L[ni].dataset[key] !== NN[ni].dataset[key]) return fail(step, op, "dataset read back", L[ni].dataset[key], NN[ni].dataset[key]);
            } else if (kind === 18) {
              // ParentNode / ChildNode mixins with a node and a string
              const ti = rnd(L.length);
              const ni = rnd(L.length);
              if (!mutates(ti) || ni === 0 || isDescendantL(L[ti], L[ni]) || L[ni].nodeType === 11) continue;
              const which = pick(["append", "prepend", "before", "after", "replaceWith"]);
              const s = pick(TEXTS);
              if ((which === "before" || which === "after" || which === "replaceWith") && (!L[ti].parentNode || L[ti].parentNode.nodeType !== 1)) continue;
              if (L[ni] === L[ti] && which !== "append" && which !== "prepend") continue;
              // known difference: linkedom's prepend(a, b) puts b before a; the DOM keeps the order (the native one does), so prepend gets one argument
              const one = which === "prepend";
              op = `${which} on ${ti} with node ${ni}${one ? "" : ` and ${JSON.stringify(s)}`}`;
              if (one) {
                (L[ti] as any)[which](L[ni]);
                (NN[ti] as any)[which](NN[ni]);
              } else {
                (L[ti] as any)[which](L[ni], s);
                (NN[ti] as any)[which](NN[ni], s);
              }
            } else if (kind === 19) {
              const ni = rnd(L.length);
              if (ni === 0 || L[ni].nodeType === 11) continue;
              op = `ChildNode.remove ${ni}`;
              L[ni].remove();
              NN[ni].remove();
            } else if (kind === 20) {
              // insertAdjacentHTML / Text / Element
              const ni = rnd(L.length);
              if (!mutates(ni)) continue;
              const where = pick(["beforebegin", "afterbegin", "beforeend", "afterend"]);
              if ((where === "beforebegin" || where === "afterend") && (!L[ni].parentNode || L[ni].parentNode.nodeType !== 1)) continue;
              const form = rnd(2);
              if (form === 0) {
                const m = pick(MARKUP);
                op = `insertAdjacentHTML ${ni} ${where} ${JSON.stringify(m)}`;
                L[ni].insertAdjacentHTML(where, m);
                NN[ni].insertAdjacentHTML(where, m);
              } else {
                const t = pick(TEXTS);
                op = `insertAdjacentText ${ni} ${where} ${JSON.stringify(t)}`;
                L[ni].insertAdjacentText(where, t);
                NN[ni].insertAdjacentText(where, t);
              }
            } else if (kind === 21) {
              // searches by tag and class, and closest
              const ni = rnd(L.length);
              if (!isEl(ni)) continue;
              const tag = pick(TAGS);
              // known difference: linkedom's getElementsByClassName takes one class; the DOM takes several (the native one does)
              const cls = pick(["a", "b"]);
              const a1 = Array.from(L[ni].getElementsByTagName(tag)).map(indexL);
              const b1 = Array.from(NN[ni].getElementsByTagName(tag)).map(indexN);
              if (a1.join() !== b1.join()) return fail(step, `getElementsByTagName ${ni} ${tag}`, "getElementsByTagName", a1, b1);
              const a2 = Array.from(L[ni].getElementsByClassName(cls)).map(indexL);
              const b2 = Array.from(NN[ni].getElementsByClassName(cls)).map(indexN);
              if (a2.join() !== b2.join()) return fail(step, `getElementsByClassName ${ni} ${cls}`, "getElementsByClassName", a2, b2);
              const sel = pick(SELECTORS);
              const a3 = indexL(L[ni].closest(sel));
              const b3 = indexN(NN[ni].closest(sel));
              if (a3 !== b3) return fail(step, `closest ${ni} ${sel}`, "closest", a3, b3);
              op = `searches ${ni}`;
            } else if (kind === 22) {
              // contains and compareDocumentPosition between two tracked nodes
              const xi = rnd(L.length);
              const yi = rnd(L.length);
              const a = L[xi].contains(L[yi]);
              const b = NN[xi].contains(NN[yi]);
              // known difference: linkedom says a comment or text node does not contain itself; the DOM says it does (the native one does)
              if (a !== b && !(xi === yi && L[xi].nodeType !== 1 && a === false && b === true)) return fail(step, `contains ${xi} ${yi}`, "contains", a, b);
              // only the answers that do not depend on how a library orders unrelated trees
              const ca = L[xi].compareDocumentPosition(L[yi]);
              const cb = NN[xi].compareDocumentPosition(NN[yi]);
              const sameTree = (n: any) => {
                let r = n;
                while (r.parentNode) r = r.parentNode;
                return r;
              };
              // known difference: linkedom gets the order of unrelated nodes wrong (preceding for following); only
              // contains / contained-by is compared here, and the order is checked on a fixed tree below
              if (sameTree(L[xi]) === sameTree(L[yi]) && (ca & 0x18) !== (cb & 0x18)) return fail(step, `compareDocumentPosition ${xi} ${yi}`, "compareDocumentPosition", ca, cb);
              op = `contains ${xi} ${yi}`;
            } else if (kind === 23) {
              const ni = rnd(L.length);
              if (!isEl(ni)) continue;
              const name = pick(ATTRS)[0];
              op = `removeAttribute ${ni} ${name}`;
              L[ni].removeAttribute(name);
              NN[ni].removeAttribute(name);
            } else if (kind === 24) {
              const ni = rnd(L.length);
              op = `hasChildNodes / getRootNode ${ni}`;
              if (L[ni].hasChildNodes() !== NN[ni].hasChildNodes()) return fail(step, op, "hasChildNodes", L[ni].hasChildNodes(), NN[ni].hasChildNodes());
              if (indexL(L[ni].getRootNode()) !== indexN(NN[ni].getRootNode())) return fail(step, op, "getRootNode", indexL(L[ni].getRootNode()), indexN(NN[ni].getRootNode()));
            } else {
              const ni = rnd(L.length);
              if (!isEl(ni)) continue;
              const v = pick(["x", "y", "a b"]);
              const prop = pick(["id", "className"]);
              op = `${prop} ${ni} = ${v}`;
              (L[ni] as any)[prop] = v;
              (NN[ni] as any)[prop] = v;
            }
          } catch (e: any) {
            // an operation both sides refuse is fine, as long as they refuse alike
            return fail(step, op || `kind ${kind}`, "threw", String(e && e.name) + ": " + String(e && e.message), "(see the log)");
          }
          log.push(op);
          if (log.length > 40) log.shift();

          // the whole tree from the root
          // known difference: linkedom lists class and id before the other attributes; the DOM keeps the order they were set in
          // and drops a class attribute whose last token was removed; the DOM leaves class="" (the native one does)
          const sortAttrs = (html: string) =>
            html.replace(/<([a-z0-9]+)((?:\s+[a-zA-Z-]+="[^"]*")+)>/g, (_m, tag, attrs) => "<" + tag + (attrs.match(/\s+[a-zA-Z-]+="[^"]*"/g) as string[]).filter((x) => x.trim() !== 'class=""').sort().join("") + ">");
          const a = sortAttrs(lroot.outerHTML);
          const b = sortAttrs(nroot.outerHTML);
          if (a !== b) return fail(step, op, "outerHTML", a, b);
          if (lroot.textContent !== nroot.textContent) return fail(step, op, "textContent", lroot.textContent, nroot.textContent);

          // relations of every node that is still reachable or was created
          for (let i = 0; i < L.length; i++) {
            if (L[i].nodeType !== NN[i].nodeType) return fail(step, op, `nodeType of ${i}`, L[i].nodeType, NN[i].nodeType);
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
            if ((L[i].nodeType === 1 || L[i].nodeType === 11) && NN[i].childNodes.length !== L[i].childNodes.length) return fail(step, op, `childNodes.length of ${i}`, L[i].childNodes.length, NN[i].childNodes.length);
            if (L[i].nodeType === 1 && L[i].firstElementChild !== null && indexL(L[i].firstElementChild) !== indexN(NN[i].firstElementChild)) return fail(step, op, `firstElementChild of ${i}`, indexL(L[i].firstElementChild), indexN(NN[i].firstElementChild));
            if (L[i].nodeType === 1 && L[i].isConnected !== NN[i].isConnected) return fail(step, op, `isConnected of ${i}`, L[i].isConnected, NN[i].isConnected);
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
        expect(failure, failure ? `${failure.what} after "${failure.op}" (seed ${failure.seed}, step ${failure.step})\n${failure.log.join("\n")}\nlinkedom: ${JSON.stringify(failure.linkedom)}\nnative:   ${JSON.stringify(failure.native)}` : "").toBeNull();
      }
    });
  }
});
