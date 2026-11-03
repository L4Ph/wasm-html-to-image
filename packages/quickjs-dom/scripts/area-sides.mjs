/**
 * area-sides.mjs — seeded random programs per DOM area, for the jsdom-parity
 * inventory (Phase 0). Follows tests/lockstep.ts: each side is SELF-CONTAINED
 * (it is serialised with toString() and evaluated inside the other realm, so
 * it may use nothing from outside — the small seeded RNG is repeated in each),
 * decides everything from its seed, and leaves one observation string per
 * step. Two DOMs that agree make the same moves and leave equal traces. An
 * operation that throws records the error name in the observation, so a
 * missing feature shows up as a divergence, not as a crashed comparison.
 */

/** Events: listener order, phases, capture/bubble, stopping, listener removal. */
export function sideEvents(win, seed0, programs, steps) {
  let seed = seed0 >>> 0;
  const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); };
  const pick = (a) => a[rnd(a.length)];
  const attempt = (fn) => { try { return fn(); } catch (e) { return "ERR:" + (e && e.name ? e.name : "Error"); } };
  const out = [];
  const doc = win.document;
  for (let p = 0; p < programs; p++) {
    const trace = { seed, steps: [] }; out.push(trace);
    doc.body.innerHTML = '<div id="a"><div id="b"><div id="c">x</div></div></div>';
    const A = doc.getElementById("a"), B = doc.getElementById("b"), C = doc.getElementById("c");
    let log = [];
    const mk = (id, opts) => (e) => {
      log.push(id + ":" + e.eventPhase + ":" + (e.currentTarget.id || "doc"));
      if (opts && opts.stop) e.stopPropagation();
      if (opts && opts.stopNow) e.stopImmediatePropagation();
      if (opts && opts.prevent) e.preventDefault();
    };
    const pool = [];
    const targets = [A, B, C, doc];
    for (let s = 0; s < steps; s++) {
      const op = rnd(6);
      let obs;
      if (op === 0) {
        const t = pick(targets); const capture = rnd(2) === 0; const id = "L" + pool.length;
        const fn = mk(id, { stop: rnd(4) === 0, stopNow: rnd(6) === 0, prevent: rnd(5) === 0 });
        attempt(() => t.addEventListener("click", fn, capture));
        pool.push([t, fn, capture, id]);
        obs = "add " + id + " on " + (t.id || "doc") + " cap=" + capture;
      } else if (op === 1 && pool.length) {
        const i = rnd(pool.length); const [t, fn, capture, id] = pool.splice(i, 1)[0];
        attempt(() => t.removeEventListener("click", fn, capture));
        obs = "remove " + id;
      } else if (op === 2 || op === 3) {
        log = [];
        const bubbles = rnd(2) === 0, cancelable = rnd(2) === 0;
        const ev = new win.MouseEvent("click", { bubbles, cancelable, detail: 2 });
        const t = pick([A, B, C]);
        const ret = attempt(() => t.dispatchEvent(ev));
        obs = "dispatch@" + t.id + " b=" + bubbles + " c=" + cancelable + " ret=" + ret + " log=[" + log.join(",") + "] dp=" + ev.defaultPrevented;
      } else if (op === 4) {
        log = [];
        const fn = mk("ATTR", null);
        attempt(() => { C.onclick = fn; });
        const ret = attempt(() => C.dispatchEvent(new win.MouseEvent("click", { bubbles: true })));
        attempt(() => { C.onclick = null; });
        obs = "onclick-attr ret=" + ret + " log=[" + log.join(",") + "]";
      } else {
        log = [];
        const ev = attempt(() => new win.CustomEvent("ping", { detail: { n: rnd(9) }, bubbles: true }));
        const fn = (e) => log.push("got:" + (e.detail && e.detail.n) + ":" + e.type + ":" + (e.target.id || "?"));
        attempt(() => B.addEventListener("ping", fn));
        const ret = typeof ev === "string" ? ev : attempt(() => C.dispatchEvent(ev));
        attempt(() => B.removeEventListener("ping", fn));
        obs = "custom ret=" + ret + " log=[" + log.join(",") + "]";
      }
      trace.steps.push(obs);
    }
  }
  return out;
}

/** Ranges: endpoints, comparisons, content surgery on a fixed rich tree. */
export function sideRange(win, seed0, programs, steps) {
  let seed = seed0 >>> 0;
  const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); };
  const pick = (a) => a[rnd(a.length)];
  const attempt = (fn) => { try { return fn(); } catch (e) { return "ERR:" + (e && e.name ? e.name : "Error"); } };
  const out = [];
  const doc = win.document;
  const FIX = '<div id="r"><p>hello <b>bold</b> tail</p><p>second para</p><ul><li>one</li><li>two</li></ul></div>';
  for (let p = 0; p < programs; p++) {
    const trace = { seed, steps: [] }; out.push(trace);
    doc.body.innerHTML = FIX;
    const root = doc.getElementById("r");
    const nodes = [];
    const walk = (n) => { nodes.push(n); for (const c of n.childNodes) walk(c); };
    walk(root);
    const idx = (n) => nodes.indexOf(n);
    const maxOff = (n) => (n.nodeType === 3 || n.nodeType === 8 ? n.length : n.childNodes.length);
    const describe = (r) => "s=" + idx(r.startContainer) + ":" + r.startOffset + " e=" + idx(r.endContainer) + ":" + r.endOffset + " col=" + r.collapsed + " str=" + JSON.stringify(attempt(() => r.toString()));
    const ranges = [doc.createRange(), doc.createRange()];
    for (let s = 0; s < steps; s++) {
      const r = ranges[rnd(2)];
      const op = rnd(7);
      let obs;
      if (op === 0) { const n = pick(nodes); obs = "setStart " + attempt(() => { r.setStart(n, rnd(maxOff(n) + 1)); return ""; }) + describe(r); }
      else if (op === 1) { const n = pick(nodes); obs = "setEnd " + attempt(() => { r.setEnd(n, rnd(maxOff(n) + 1)); return ""; }) + describe(r); }
      else if (op === 2) { const before = rnd(2) === 0; obs = "collapse(" + before + ") " + attempt(() => { r.collapse(before); return ""; }) + describe(r); }
      else if (op === 3) { const n = pick(nodes); const which = rnd(2); obs = "select " + attempt(() => { if (which) r.selectNode(n); else r.selectNodeContents(n); return ""; }) + describe(r); }
      else if (op === 4) { obs = "cmp " + attempt(() => String(r.compareBoundaryPoints(rnd(4) === 0 ? win.Range.START_TO_START : win.Range.END_TO_END, ranges[1 - ranges.indexOf(r)]))) + " " + describe(r); }
      else if (op === 5) { obs = "delete " + attempt(() => { r.deleteContents(); return ""; }) + describe(r) + " html=" + root.innerHTML; }
      else { const frag = attempt(() => r.cloneContents()); obs = "clone html=" + (typeof frag === "string" ? frag : (() => { const d = doc.createElement("div"); d.appendChild(frag); return d.innerHTML; })()) + " " + describe(r); }
      trace.steps.push(obs);
    }
  }
  return out;
}

/** Forms: values, checkedness, selection, validity, form membership. */
export function sideForms(win, seed0, programs, steps) {
  let seed = seed0 >>> 0;
  const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); };
  const pick = (a) => a[rnd(a.length)];
  const attempt = (fn) => { try { return fn(); } catch (e) { return "ERR:" + (e && e.name ? e.name : "Error"); } };
  const out = [];
  const doc = win.document;
  const FIX = '<form id="f"><input id="t" name="t" required><input id="c" type="checkbox" name="c" value="cv">'
    + '<input id="r1" type="radio" name="g" value="1"><input id="r2" type="radio" name="g" value="2" checked>'
    + '<select id="s" name="s"><option value="a">A</option><option value="b" selected>B</option><option>C</option></select>'
    + '<textarea id="ta" name="ta">init</textarea><input id="n" type="number" name="n" min="1" max="9"></form>';
  for (let p = 0; p < programs; p++) {
    const trace = { seed, steps: [] }; out.push(trace);
    doc.body.innerHTML = FIX;
    const $ = (id) => doc.getElementById(id);
    const snap = () => {
      const v = (el) => attempt(() => String(el.validity.valid) + "/" + String(el.validity.valueMissing) + "/" + String(el.validity.rangeUnderflow) + "/" + String(el.validity.rangeOverflow));
      return "t=" + JSON.stringify($("t").value) + " c=" + $("c").checked + " r=" + $("r1").checked + "," + $("r2").checked
        + " s=" + $("s").selectedIndex + ":" + JSON.stringify($("s").value) + " ta=" + JSON.stringify($("ta").value)
        + " n=" + JSON.stringify($("n").value) + " | vt=" + v($("t")) + " vn=" + v($("n")) + " vform=" + attempt(() => String($("f").checkValidity()))
        + " elems=" + attempt(() => $("f").elements.length);
    };
    for (let s = 0; s < steps; s++) {
      const op = rnd(8);
      let obs;
      if (op === 0) { const val = pick(["", "x", "hello world", "  "]); obs = "t.value=" + attempt(() => { $("t").value = val; return ""; }) + snap(); }
      else if (op === 1) { obs = "t.attr " + attempt(() => { $("t").setAttribute("value", pick(["attr", ""])); return ""; }) + snap(); }
      else if (op === 2) { obs = "c.checked " + attempt(() => { $("c").checked = rnd(2) === 0; return ""; }) + snap(); }
      else if (op === 3) { const which = rnd(2) ? "r1" : "r2"; obs = "radio " + attempt(() => { $(which).checked = true; return ""; }) + snap(); }
      else if (op === 4) { obs = "sel.idx " + attempt(() => { $("s").selectedIndex = rnd(4) - 1; return ""; }) + snap(); }
      else if (op === 5) { obs = "sel.value " + attempt(() => { $("s").value = pick(["a", "b", "C", "zz"]); return ""; }) + snap(); }
      else if (op === 6) { obs = "n.value " + attempt(() => { $("n").value = pick(["", "0", "5", "10", "abc"]); return ""; }) + snap(); }
      else { obs = "reset " + attempt(() => { $("f").reset(); return ""; }) + snap(); }
      trace.steps.push(obs);
    }
  }
  return out;
}

/** MutationObserver: record contents via takeRecords() (synchronous). */
export function sideMutation(win, seed0, programs, steps) {
  let seed = seed0 >>> 0;
  const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); };
  const pick = (a) => a[rnd(a.length)];
  const attempt = (fn) => { try { return fn(); } catch (e) { return "ERR:" + (e && e.name ? e.name : "Error"); } };
  const out = [];
  const doc = win.document;
  for (let p = 0; p < programs; p++) {
    const trace = { seed, steps: [] }; out.push(trace);
    doc.body.innerHTML = '<div id="root"><p id="p1">one</p><p id="p2">two</p></div>';
    const root = doc.getElementById("root");
    const nodes = [root, doc.getElementById("p1"), doc.getElementById("p2")];
    const idxOf = (n) => nodes.indexOf(n);
    const observer = new win.MutationObserver(() => {});
    const cfg = pick([{ childList: true, subtree: true }, { attributes: true, subtree: true }, { childList: true, attributes: true, characterData: true, subtree: true, attributeOldValue: true, characterDataOldValue: true }]);
    attempt(() => observer.observe(root, cfg));
    for (let s = 0; s < steps; s++) {
      const op = rnd(6);
      let obs;
      if (op === 0) { const el = doc.createElement(pick(["div", "span", "b"])); el.textContent = "n" + s; const t = pick(nodes); attempt(() => t.appendChild(el)); if (el.parentNode === t) nodes.push(el); obs = "append"; }
      else if (op === 1) { const t = pick(nodes.slice(1)); obs = "remove " + attempt(() => { t.remove(); return ""; }); }
      else if (op === 2) { const t = pick(nodes); attempt(() => t.setAttribute(pick(["class", "title", "data-x"]), "v" + rnd(3))); obs = "attr"; }
      else if (op === 3) { const t = pick(nodes); attempt(() => { t.textContent = "T" + rnd(3); }); obs = "text"; }
      else if (op === 4) { const t = pick(nodes); attempt(() => { const tx = t.firstChild; if (tx && tx.nodeType === 3) tx.data = "D" + rnd(3); return ""; }); obs = "data"; }
      else { obs = "noop"; }
      const recs = attempt(() => observer.takeRecords().map((r) => r.type + "@" + idxOf(r.target) + (r.attributeName ? ":" + r.attributeName : "") + " +" + r.addedNodes.length + "/-" + r.removedNodes.length + (r.oldValue != null ? " old=" + JSON.stringify(r.oldValue) : "")).join(","));
      trace.steps.push(obs + " recs=[" + recs + "] html=" + root.innerHTML.length);
    }
    attempt(() => observer.disconnect());
  }
  return out;
}

/** getComputedStyle: cascade, specificity, inheritance, var(), inline styles. */
export function sideStyle(win, seed0, programs, steps) {
  let seed = seed0 >>> 0;
  const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); };
  const pick = (a) => a[rnd(a.length)];
  const attempt = (fn) => { try { return fn(); } catch (e) { return "ERR:" + (e && e.name ? e.name : "Error"); } };
  const out = [];
  const doc = win.document;
  const CSS = ".a { color: rgb(1, 2, 3); margin-top: 4px; } #x { color: rgb(9, 9, 9); } div.b { font-size: 20px; }"
    + " .a { background-color: rgb(5, 5, 5) !important; } section { --v: 7px; } .u { width: var(--v); }"
    + " @media screen { .a { visibility: hidden; } } p { display: block; opacity: 0.5; }";
  const FIX = '<style>' + CSS + '</style><section id="sec"><div id="x" class="a b"><p id="pp" class="u">t</p></div></section>';
  const PROPS = ["display", "color", "background-color", "width", "margin-top", "font-size", "visibility", "opacity"];
  for (let p = 0; p < programs; p++) {
    const trace = { seed, steps: [] }; out.push(trace);
    doc.body.innerHTML = FIX;
    const x = doc.getElementById("x"), pp = doc.getElementById("pp"), sec = doc.getElementById("sec");
    const snap = () => {
      const cs = attempt(() => { const c = win.getComputedStyle(x); return PROPS.map((pr) => pr + "=" + c.getPropertyValue(pr)).join(" "); });
      const cp = attempt(() => { const c = win.getComputedStyle(pp); return "p:" + PROPS.map((pr) => pr + "=" + c.getPropertyValue(pr)).join(" "); });
      return cs + " | " + cp + " | prio=" + attempt(() => win.getComputedStyle(x).getPropertyPriority("background-color")) + " cssText=" + JSON.stringify(x.style.cssText);
    };
    for (let s = 0; s < steps; s++) {
      const op = rnd(6);
      let obs;
      if (op === 0) { obs = "class " + attempt(() => { x.className = pick(["a b", "b", "a", "", "u a"]); return ""; }) + snap(); }
      else if (op === 1) { obs = "inline " + attempt(() => { x.style.setProperty(pick(["color", "margin-top", "opacity"]), pick(["rgb(7, 7, 7)", "12px", "0.9", ""])); return ""; }) + snap(); }
      else if (op === 2) { obs = "cssText " + attempt(() => { x.style.cssText = pick(["color: rgb(3, 3, 3)", "width: 30px; color: rgb(4, 4, 4)", ""]); return ""; }) + snap(); }
      else if (op === 3) { obs = "var " + attempt(() => { sec.style.setProperty("--v", pick(["7px", "21px", ""])); pp.className = "u"; return ""; }) + snap(); }
      else if (op === 4) { obs = "removeProp " + attempt(() => { x.style.removeProperty(pick(["color", "margin-top"])); return ""; }) + snap(); }
      else { obs = "read " + snap(); }
      trace.steps.push(obs);
    }
  }
  return out;
}

/** Parsing and serialisation: tricky markup through innerHTML, template, DOMParser. */
export function sideParse(win, seed0, programs, steps) {
  let seed = seed0 >>> 0;
  const rnd = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * n); };
  const pick = (a) => a[rnd(a.length)];
  const attempt = (fn) => { try { return fn(); } catch (e) { return "ERR:" + (e && e.name ? e.name : "Error"); } };
  const out = [];
  const doc = win.document;
  const CORPUS = [
    "<b><i>x</b>y</i>",
    "<table><div>f</div><tr><td>c</td></tr></table>",
    "<ul><li>a<li>b<li>c</ul>",
    "<p>one<p>two",
    "<textarea><b>not bold</b></textarea>",
    "text &amp; &nbsp; &#x41; &unknown;",
    "<svg><foreignObject><div>x</div></foreignObject><circle r='1'/></svg>",
    "<form><table><tr><td><input></td></tr></table></form>",
    "<select><option>a<option>b</select>",
    "<div title='a\"b'>q</div>",
    "<script>if (a < b) { c(); }</" + "script><p>after</p>",
    "<!-- comment --><p>x</p>",
    "<template><tr><td>in tpl</td></tr></template>",
    "<isindex prompt='what'>",
    "<math><mi>x</mi><annotation-xml encoding='text/html'><p>y</p></annotation-xml></math>",
    "<button><p>block in button</p></button>",
    "<a href='/x'>one<a href='/y'>two</a>",
    "<pre>  keep\n  space</pre>",
    "<listing>listed</listing>",
    "<p id=a id=b>dup attr</p>",
  ];
  const dump = (n, d) => {
    if (d > 6) return "";
    let s2 = n.nodeType === 3 ? JSON.stringify(n.data) : n.nodeName;
    if (n.childNodes) { const kids = [...n.childNodes].map((c) => dump(c, d + 1)); if (kids.length) s2 += "(" + kids.join(",") + ")"; }
    return s2;
  };
  for (let p = 0; p < programs; p++) {
    const trace = { seed, steps: [] }; out.push(trace);
    doc.body.innerHTML = "";
    for (let s = 0; s < steps; s++) {
      const op = rnd(5);
      let obs;
      if (op === 0) { const m = pick(CORPUS); obs = "innerHTML " + attempt(() => { doc.body.innerHTML = m; return ""; }) + " => " + doc.body.innerHTML + " || " + dump(doc.body, 0); }
      else if (op === 1) { const m = pick(CORPUS); obs = "insertAdj " + attempt(() => { doc.body.insertAdjacentHTML(pick(["beforeend", "afterbegin", "beforebegin", "afterend"]), m); return ""; }) + " => " + doc.body.innerHTML; }
      else if (op === 2) { const m = pick(CORPUS); obs = "parser " + attempt(() => { const d2 = new win.DOMParser().parseFromString(m, "text/html"); return d2.body.innerHTML + " || " + dump(d2.body, 0); }); }
      else if (op === 3) { const m = pick(CORPUS); obs = "tpl " + attempt(() => { const t = doc.createElement("template"); t.innerHTML = m; return t.innerHTML + " content=" + dump(t.content, 0); }); }
      else { obs = "xml " + attempt(() => { const d2 = new win.DOMParser().parseFromString("<root><a x='1'>t</a></root>", "text/xml"); return new win.XMLSerializer().serializeToString(d2); }); }
      trace.steps.push(obs);
    }
  }
  return out;
}

export const AREAS = {
  events: sideEvents,
  range: sideRange,
  forms: sideForms,
  mutation: sideMutation,
  style: sideStyle,
  parse: sideParse,
};
