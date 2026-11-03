import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

// What the native DOM (csrc/nativedom*.h) must do as the DOM specification says, where linkedom is not a reference
// (or has nothing to compare): each test runs a snippet in the page and checks what it returns.

let dom: QuickJSDOM;
beforeAll(async () => {
  dom = await createDOM({ html: "<p>" }, { settleMs: 0 });
});
afterAll(() => dom.close());

/** run a snippet with `N` (__native.dom) and a fresh native document `d` in scope; it returns the result as JSON */
const run = (body: string) => dom.eval(`(function () { var N = __native.dom, d = N.createDocument(); ${body} })()`);

describe("native DOM: interfaces", () => {
  it("nodes inherit from the interfaces the DOM names", async () => {
    expect(
      await run(`
        var el = d.createElement("div"), t = d.createTextNode("x"), c = d.createComment("c"), f = d.createDocumentFragment();
        var C = N.ctors;
        return [
          el instanceof C.Node, el instanceof C.Element, el instanceof C.HTMLElement, el instanceof C.Text,
          t instanceof C.Text, t instanceof C.CharacterData, t instanceof C.Node, t instanceof C.Element,
          c instanceof C.Comment, c instanceof C.CharacterData,
          d instanceof C.Document, d instanceof C.Node, f instanceof C.DocumentFragment,
          C.Node.ELEMENT_NODE, C.Node.TEXT_NODE, C.Node.DOCUMENT_POSITION_FOLLOWING,
          el.constructor === C.HTMLElement, Object.getPrototypeOf(C.HTMLElement) === C.Element,
        ];`),
    ).toEqual([true, true, true, false, true, true, true, false, true, true, true, true, true, 1, 3, 4, true, true]);
  });

  it("the interfaces cannot be constructed", async () => {
    expect(await run(`try { new N.ctors.Node(); return "no error"; } catch (e) { return e.name + ": " + e.message; }`)).toBe("TypeError: Illegal constructor");
  });

  it("names, types and data", async () => {
    expect(
      await run(`
        var el = d.createElement("DiV"), t = d.createTextNode("héllo"), f = d.createDocumentFragment();
        return [el.tagName, el.localName, el.nodeName, el.nodeType, t.nodeName, t.nodeType, t.data, t.nodeValue, t.length, el.nodeValue, d.nodeName, f.nodeName, d.nodeType, f.nodeType];`),
    ).toEqual(["DIV", "div", "DIV", 1, "#text", 3, "héllo", "héllo", 5, null, "#document", "#document-fragment", 9, 11]);
  });
});

describe("native DOM: documents", () => {
  it("documentElement, head, body and doctype", async () => {
    expect(
      await run(`
        var doc = N.parse("<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>");
        return [doc.documentElement.tagName, doc.head.firstChild.tagName, doc.body.firstChild.tagName, doc.doctype.nodeType, N.serialize(doc).slice(0, 15), doc.doctype.nodeName, doc.body.ownerDocument === doc, doc.ownerDocument];`),
    ).toEqual(["HTML", "TITLE", "P", 10, "<!doctype html>", "html", true, null]);
  });

  it("a node moved to another document is adopted by it", async () => {
    expect(
      await run(`
        var other = N.createDocument();
        var el = d.createElement("div"), kid = d.createElement("b");
        el.appendChild(kid);
        var host = other.createElement("section");
        host.appendChild(el);
        return [el.ownerDocument === other, kid.ownerDocument === other, el.ownerDocument === d];`),
    ).toEqual([true, true, false]);
  });

  it("importNode copies, cloneNode keeps the document", async () => {
    expect(
      await run(`
        var other = N.createDocument();
        var el = d.createElement("div"); el.setAttribute("a", "1"); el.appendChild(d.createTextNode("t"));
        var imported = other.importNode(el, true), cloned = el.cloneNode(true), shallow = el.cloneNode(false);
        return [imported.ownerDocument === other, cloned.ownerDocument === d, imported.outerHTML, cloned.outerHTML, shallow.outerHTML, imported === el, cloned.parentNode];`),
    ).toEqual([true, true, '<div a="1">t</div>', '<div a="1">t</div>', '<div a="1"></div>', false, null]);
  });
});

describe("native DOM: tree operations", () => {
  it("refuses what the DOM refuses", async () => {
    expect(
      await run(`
        var out = [], a = d.createElement("div"), b = d.createElement("p"), c = d.createElement("i");
        a.appendChild(b);
        var tryit = function (f) { try { f(); out.push("ok"); } catch (e) { out.push(e.name); } };
        tryit(function () { b.appendChild(a); });
        tryit(function () { a.appendChild(a); });
        tryit(function () { a.insertBefore(c, d.createElement("u")); });
        tryit(function () { a.removeChild(c); });
        tryit(function () { a.replaceChild(c, c); });
        tryit(function () { d.createTextNode("t").appendChild(c); });
        tryit(function () { a.appendChild(d); });
        tryit(function () { a.appendChild({}); });
        return out;`),
    ).toEqual(["HierarchyRequestError", "HierarchyRequestError", "NotFoundError", "NotFoundError", "NotFoundError", "HierarchyRequestError", "HierarchyRequestError", "TypeError"]);
  });

  it("a fragment hands over its children", async () => {
    expect(
      await run(`
        var f = d.createDocumentFragment(), a = d.createElement("a"), b = d.createElement("b");
        f.appendChild(a); f.appendChild(b);
        var host = d.createElement("div"), mid = d.createElement("i");
        host.appendChild(mid);
        host.insertBefore(f, mid);
        return [host.innerHTML, f.childNodes.length, a.parentNode === host];`),
    ).toEqual(["<a></a><b></b><i></i>", 0, true]);
  });

  it("inserting a node before itself leaves it, replaceChild returns the old child", async () => {
    expect(
      await run(`
        var host = d.createElement("div"), a = d.createElement("a"), b = d.createElement("b"), c = d.createElement("i");
        host.appendChild(a); host.appendChild(b);
        host.insertBefore(a, a);
        var first = host.innerHTML;
        var old = host.replaceChild(c, a);
        return [first, host.innerHTML, old === a, a.parentNode];`),
    ).toEqual(["<a></a><b></b>", "<i></i><b></b>", true, null]);
  });

  it("compareDocumentPosition, contains and getRootNode", async () => {
    expect(
      await run(`
        var doc = N.parse("<div id=r><p id=a><b id=x></b></p><p id=b></p></div>");
        var q = function (id) { return doc.getElementById(id); };
        var r = q("r"), a = q("a"), b = q("b"), x = q("x"), loose = d.createElement("u");
        return [
          a.compareDocumentPosition(b), b.compareDocumentPosition(a), r.compareDocumentPosition(x), x.compareDocumentPosition(r), a.compareDocumentPosition(a),
          (a.compareDocumentPosition(loose) & 1) === 1,
          r.contains(x), x.contains(r), x.contains(x), a.contains(null),
          x.getRootNode() === doc, loose.getRootNode() === loose, x.isConnected, loose.isConnected,
        ];`),
    ).toEqual([4, 2, 20, 10, 0, true, true, false, true, false, true, true, true, false]);
  });

  it("normalize joins neighbouring text and drops empty text", async () => {
    expect(
      await run(`
        var el = d.createElement("div");
        ["a", "", "b"].forEach(function (s) { el.appendChild(d.createTextNode(s)); });
        el.appendChild(d.createElement("i"));
        el.appendChild(d.createTextNode("c")); el.appendChild(d.createTextNode("d"));
        el.normalize();
        return [el.childNodes.length, el.firstChild.data, el.lastChild.data];`),
    ).toEqual([3, "ab", "cd"]);
  });

  it("the element-only relations skip text", async () => {
    expect(
      await run(`
        var doc = N.parse("<div>t<p id=a></p>u<p id=b></p>v</div>");
        var div = doc.firstChild, a = doc.getElementById("a");
        return [div.childElementCount, div.firstElementChild.id, div.lastElementChild.id, a.nextElementSibling.id, a.previousElementSibling, div.children.length, div.childNodes.length];`),
    ).toEqual([2, "a", "b", "b", null, 2, 5]);
  });
});

describe("native DOM: templates", () => {
  it("keeps the children of a template in its content", async () => {
    expect(
      await run(`
        var doc = N.parse("<template id=t><p>one</p><p>two</p></template>");
        var t = doc.getElementById("t");
        var copy = doc.importNode(t.content, true);
        t.innerHTML = "<b>x</b>";
        return [t.childNodes.length, t.content.childNodes.length, t.content.nodeType, N.serialize(doc), copy.childNodes.length, d.createElement("div").content];`),
    ).toEqual([0, 1, 11, '<template id="t"><b>x</b></template>', 2, null]);
  });
});

describe("native DOM: element API", () => {
  it("attributes", async () => {
    expect(
      await run(`
        var el = d.createElement("div");
        el.setAttribute("a", "1"); el.setAttribute("b", "2"); el.setAttribute("a", "3");
        var out = [el.getAttribute("a"), el.getAttributeNames(), el.hasAttribute("b"), el.hasAttributes(), el.attributes.length, el.attributes.a.value, el.attributes.item(1).name, el.toggleAttribute("c"), el.hasAttribute("c"), el.toggleAttribute("c"), el.hasAttribute("c")];
        el.removeAttribute("a"); el.removeAttribute("zzz");
        out.push(el.getAttributeNames());
        return out;`),
    ).toEqual(["3", ["a", "b"], true, true, 2, "3", "b", true, true, false, false, ["b"]]);
  });

  it("classList follows the DOM", async () => {
    expect(
      await run(`
        var el = d.createElement("div"), cl = el.classList;
        var out = [cl.length, el.hasAttribute("class")];
        cl.remove("x");
        out.push(el.hasAttribute("class"));
        cl.add("a", "b", "a");
        out.push(el.className, cl.contains("b"), cl.toggle("c"), cl.toggle("a", false), cl.toggle("z", true), cl.replace("b", "q"), el.className, cl.item(0), cl.value, String(cl), el.classList === cl);
        el.className = "  p   q ";
        out.push(cl.length, Array.from(cl));
        try { cl.add(""); } catch (e) { out.push(e.name); }
        try { cl.add("a b"); } catch (e) { out.push(e.name); }
        return out;`),
    ).toEqual([0, false, false, "a b", true, true, false, true, true, "q c z", "q", "q c z", "q c z", true, 2, ["p", "q"], "SyntaxError", "InvalidCharacterError"]);
  });

  it("dataset", async () => {
    expect(
      await run(`
        var el = d.createElement("div");
        el.setAttribute("data-foo-bar", "1");
        el.dataset.bazQux = "2";
        var out = [el.dataset.fooBar, el.getAttribute("data-baz-qux"), "fooBar" in el.dataset, "nope" in el.dataset, typeof el.dataset.nope, Object.keys(el.dataset)];
        delete el.dataset.fooBar;
        out.push(el.hasAttribute("data-foo-bar"), el.dataset === el.dataset);
        return out;`),
    ).toEqual(["1", "2", true, false, "undefined", ["fooBar", "bazQux"], false, true]);
  });

  it("searches and closest", async () => {
    expect(
      await run(`
        var doc = N.parse('<div id=r class="a b"><p class=a>1</p><p class="a b c">2</p><span class=b>3</span></div>');
        var r = doc.getElementById("r");
        var ids = function (list) { return Array.from(list).map(function (e) { return e.textContent || e.id; }); };
        return [ids(r.getElementsByClassName("a b")), ids(r.getElementsByClassName("c")), ids(r.getElementsByTagName("P")), r.getElementsByTagName("*").length, doc.getElementsByTagName("p").length,
          doc.querySelector("span").closest("div").id, doc.querySelector("span").closest("p"), doc.querySelector("p").closest("p") === doc.querySelector("p")];`),
    ).toEqual([["2"], ["2"], ["1", "2"], 3, 2, "r", null, true]);
  });
});

describe("native DOM: ChildNode and ParentNode", () => {
  it("append, prepend, before, after, replaceWith, remove, replaceChildren", async () => {
    expect(
      await run(`
        var host = d.createElement("div"), a = d.createElement("a"), b = d.createElement("b"), c = d.createElement("i");
        host.append(a, "t", b);
        var steps = [host.innerHTML];
        host.prepend(c, "p");
        steps.push(host.innerHTML);
        a.before("x", b);
        steps.push(host.innerHTML);
        a.after(c);
        steps.push(host.innerHTML);
        c.replaceWith("R", b);
        steps.push(host.innerHTML);
        a.remove();
        steps.push(host.innerHTML);
        host.replaceChildren(d.createElement("u"), "end");
        steps.push(host.innerHTML);
        return steps;`),
    ).toEqual([
      "<a></a>t<b></b>",
      "<i></i>p<a></a>t<b></b>",
      "<i></i>px<b></b><a></a>t",
      "px<b></b><a></a><i></i>t",
      "px<a></a>R<b></b>t",
      "pxR<b></b>t",
      "<u></u>end",
    ]);
  });
});

describe("native DOM: insertAdjacent and outerHTML", () => {
  it("insertAdjacentHTML / Text / Element in the four places", async () => {
    expect(
      await run(`
        var doc = N.parse("<div><p id=m>mid</p></div>");
        var m = doc.getElementById("m");
        m.insertAdjacentHTML("beforebegin", "<i>1</i>");
        m.insertAdjacentHTML("afterbegin", "<b>2</b>");
        m.insertAdjacentText("beforeend", "3");
        m.insertAdjacentElement("afterend", doc.createElement("u"));
        var bad; try { m.insertAdjacentHTML("middle", ""); } catch (e) { bad = e.name; }
        return [doc.firstChild.innerHTML, bad];`),
    ).toEqual(["<i>1</i><p id=\"m\"><b>2</b>mid3</p><u></u>", "SyntaxError"]);
  });

  it("outerHTML can be set, and not on the child of a document", async () => {
    expect(
      await run(`
        var doc = N.parse("<div><p id=m>x</p></div>");
        var m = doc.getElementById("m");
        m.outerHTML = "<a>1</a><b>2</b>";
        var bad; try { doc.firstChild.outerHTML = "<i></i>"; } catch (e) { bad = e.name; }
        return [doc.firstChild.innerHTML, m.parentNode, bad];`),
    ).toEqual(["<a>1</a><b>2</b>", null, "NoModificationAllowedError"]);
  });
});

describe("native DOM: memory", () => {
  it("trees that nothing refers to any more are freed, cycles included", async () => {
    const result = (await dom.eval(`(function () {
      var N = __native.dom;
      N.gc();
      var before = N.liveNodes();
      for (var round = 0; round < 10; round++) {
        var d = N.createDocument();
        var root = d.createElement("div");
        for (var i = 0; i < 3000; i++) {
          var p = d.createElement("p");
          p.appendChild(d.createTextNode("t" + i));
          root.appendChild(p);
        }
        var big = N.parse("<ul>" + new Array(500).fill("<li><b>x</b></li>").join("") + "</ul>");
        var held = root.cloneNode(true);
      }
      var during = N.liveNodes();
      d = root = p = big = held = null;
      N.gc();
      return { before: before, during: during, after: N.liveNodes() };
    })()`)) as { before: number; during: number; after: number };
    expect(result.during).toBeGreaterThan(result.before + 1000);
    expect(result.after).toBeLessThanOrEqual(result.before + 5);
  });
});

describe("native DOM: events", () => {
  it("capture, target and bubble phases in order, with stopPropagation", async () => {
    expect(
      await run(`
        var log = [], E = globalThis.Event;
        var a = d.createElement("div"), b = d.createElement("p"), c = d.createElement("b");
        a.appendChild(b); b.appendChild(c); d.appendChild(a);
        var on = function (n, name, cap) { n.addEventListener("x", function (e) { log.push(name + e.eventPhase); }, cap); };
        on(d, "d", true); on(a, "a", true); on(a, "A", false); on(b, "b", true); on(b, "B", false); on(c, "c", false); on(c, "C", true);
        var ok = c.dispatchEvent(new E("x", { bubbles: true, cancelable: true }));
        var nb = []; a.addEventListener("y", function () { nb.push("a"); }); c.dispatchEvent(new E("y"));
        var stop = []; b.addEventListener("z", function (e) { e.stopPropagation(); }); a.addEventListener("z", function () { stop.push("a"); });
        c.dispatchEvent(new E("z", { bubbles: true }));
        return [log.join(","), ok, nb.length, stop.length];`),
    ).toEqual(["d1,a1,b1,c2,C2,B3,A3", true, 0, 0]);
  });

  it("once, removeEventListener, handleEvent objects, preventDefault and on<type>", async () => {
    expect(
      await run(`
        var E = globalThis.Event, el = d.createElement("button"), n = 0, obj = 0, prop = 0, f = function () { n++; };
        el.addEventListener("click", f, { once: true }); el.addEventListener("click", { handleEvent: function () { obj++; } });
        el.onclick = function () { prop++; };
        el.click(); el.click();
        var g = function () { n += 100; }; el.addEventListener("click", g); el.removeEventListener("click", g); el.click();
        el.addEventListener("q", function (e) { e.preventDefault(); });
        return [n, obj, prop, el.dispatchEvent(new E("q", { cancelable: true }))];`),
    ).toEqual([1, 3, 3, false]);
  });
});

describe("native DOM: MutationObserver", () => {
  it("reports childList, attributes and characterData mutations as records, in a microtask", async () => {
    const out = (await dom.eval(`(async function () {
      var N = __native.dom, d = N.createDocument(), root = d.createElement("div"), got = [];
      d.appendChild(root);
      var mo = new N.MutationObserver(function (recs) { recs.forEach(function (r) { got.push(r); }); });
      mo.observe(root, { childList: true, attributes: true, subtree: true, attributeOldValue: true, characterData: true });
      var p = d.createElement("p"); root.appendChild(p);
      p.setAttribute("id", "a"); p.setAttribute("id", "b"); p.removeAttribute("id");
      var t = d.createTextNode("x"); p.appendChild(t); t.data = "y";
      root.removeChild(p);
      var sync = got.length;
      await Promise.resolve();
      return { sync: sync, recs: got.map(function (r) { return [r.type, r.target.nodeName, r.addedNodes.length, r.removedNodes.length, r.attributeName, r.oldValue].map(String).join("|"); }) };
    })()`)) as { sync: number; recs: string[] };
    expect(out.sync).toBe(0);
    expect(out.recs).toEqual(["childList|DIV|1|0|null|null", "attributes|P|0|0|id|null", "attributes|P|0|0|id|a", "attributes|P|0|0|id|b", "childList|P|1|0|null|null", "characterData|#text|0|0|null|null", "childList|DIV|0|1|null|null"]);
  });

  it("only sees what it observes, and disconnect stops it", async () => {
    const out = (await dom.eval(`(async function () {
      var N = __native.dom, d = N.createDocument(), a = d.createElement("div"), b = d.createElement("div"), n = 0;
      var mo = new N.MutationObserver(function (recs) { n += recs.length; });
      mo.observe(a, { childList: true });
      a.appendChild(d.createElement("i")); b.appendChild(d.createElement("i"));
      a.firstChild.appendChild(d.createElement("u"));
      await Promise.resolve();
      var seen = n; mo.disconnect(); a.appendChild(d.createElement("i")); await Promise.resolve();
      return [seen, n];
    })()`)) as number[];
    expect(out).toEqual([1, 1]);
  });
});

describe("native DOM: style, forms and shadow roots", () => {
  it("style reads and writes the style attribute", async () => {
    expect(
      await run(`
        var el = d.createElement("div");
        el.style.backgroundColor = "red"; el.style.setProperty("margin-top", "4px"); el.style.color = "blue";
        var a = el.getAttribute("style"), len = el.style.length;
        el.style.color = ""; el.style.cssText = "width: 10px; height:5px";
        return [a, len, el.style.marginTop, el.style.width, el.getAttribute("style"), el.style.removeProperty("width"), el.style.cssText];`),
    ).toEqual(["background-color: red; margin-top: 4px; color: blue;", 3, "", "10px", "width: 10px; height:5px", "10px", "height: 5px;"]);
  });

  it("form controls: value, checked, disabled, form", async () => {
    expect(
      await run(`
        var doc = N.parse('<form id=f><input id=i value=a><textarea id=t>hi</textarea><select id=s><option value=x>X<option value=y selected>Y</select><input id=c type=checkbox checked></form>');
        var $ = function (id) { return doc.getElementById(id); };
        $("i").value = "b"; $("t").value = "bye"; $("s").value = "x"; $("c").checked = false; $("i").disabled = true;
        return [$("i").value, $("i").getAttribute("value"), $("t").value, $("t").textContent, $("s").value, $("c").checked, $("i").disabled, $("i").form === $("f")];`),
    ).toEqual(["b", "b", "bye", "bye", "x", false, true, true]);
  });

  it("attachShadow: the root belongs to the host, not to the tree, and events go through the host", async () => {
    expect(
      await run(`
        var E = globalThis.Event, host = d.createElement("div"), got = [];
        var root = host.attachShadow({ mode: "open" }), inner = d.createElement("span");
        root.appendChild(inner);
        host.addEventListener("x", function () { got.push("host"); });
        inner.dispatchEvent(new E("x", { bubbles: true }));
        var twice; try { host.attachShadow({ mode: "open" }); twice = "no error"; } catch (e) { twice = e.name; }
        var closed = d.createElement("p"); closed.attachShadow({ mode: "closed" });
        return [host.shadowRoot === root, root.host === host, host.childNodes.length, host.innerHTML, got, twice, closed.shadowRoot];`),
    ).toEqual([true, true, 0, "", ["host"], "NotSupportedError", null]);
  });
});

describe("native DOM: selectors against linkedom", () => {
  const html =
    '<div id=root class="a b"><ul id=list><li id=l1 class=x>1</li><li id=l2 data-k="foo-bar" lang=en>2</li><li id=l3 class="x y">3</li><li id=l4 hidden>4</li></ul>' +
    '<p id=p1>t</p><p id=p2></p><span id=s1 title="Hello World">s</span><a id=lnk href="/x">l</a><a id=nolnk>n</a>' +
    '<form id=f><input id=i1 type=checkbox checked><input id=i2 disabled required><select id=sel><option id=o1>a<option id=o2 selected>b</select></form>' +
    '<section id=sec><h1 id=h1>x</h1><h2 id=h2>y</h2><h2 id=h3>z</h2></section><div class="md:flex" id=esc></div></div>';
  const selectors = [
    "li", "ul > li", "div li", "li.x", "li.x.y", "#l2", "li[data-k]", "li[data-k=foo-bar]", "[data-k^=foo]", "[data-k$=bar]", "[data-k*=o-b]",
    "[data-k~=foo]", "[lang|=en]", "[title='Hello World' i]", "[TITLE]", "li:first-child", "li:last-child", "li:nth-child(2)", "li:nth-child(odd)",
    "li:nth-child(even)", "li:nth-child(2n+1)", "li:nth-child(-n+2)", "li:nth-last-child(1)", "h2:first-of-type", "h2:last-of-type", "h2:nth-of-type(2)",
    "p:empty", "li:not(.x)", "li:not(.x):not([hidden])", "div :not(li):not(ul)",":is(h1, h2)", ":where(p, span)", "div:has(> p)", "ul:has(li.y)", "li + li",
    "li ~ li", "h1 + h2", "p + span", "li:first-child + li", "#root > ul > li:nth-child(3)", "a:link", "a:any-link", "input:checked", "option:checked",
    "input:disabled", "input:enabled", "input:required", "input:optional", "li, p", "div.a.b", "* > p", ".md\\:flex", "#sec h2:not(:first-of-type)",
    "li:hover", "ul li:only-child", "section :only-of-type", ":root", "html", "ul:not(:has(.y))",
  ];
  it("gives linkedom's answers", async () => {
    const out = (await dom.eval(`(function () {
      var native = __native.dom.parse(${JSON.stringify(html)}), ref = __linkedom.parseHTML(${JSON.stringify(`<html><body>${html}</body></html>`)}).document;
      var ids = function (list) { return Array.prototype.map.call(list, function (e) { return e.localName + "#" + e.getAttribute("id"); }).join(","); };
      var bad = [];
      ${JSON.stringify(selectors)}.forEach(function (sel) {
        var a, b;
        try { a = ids(native.querySelectorAll(sel)); } catch (e) { a = "ERR " + e.name; }
        try { b = ids(ref.querySelectorAll(sel)); } catch (e) { b = "ERR " + e.name; }
        if (sel === ":root" || sel === "html") return;
        if (a !== b) bad.push(sel + " native=[" + a + "] linkedom=[" + b + "]");
      });
      return bad;
    })()`)) as string[];
    expect(out).toEqual([]);
  });

  it("matches, closest and :scope; invalid selectors throw SyntaxError", async () => {
    expect(
      await run(`
        var doc = N.parse(${JSON.stringify(html)}), l2 = doc.getElementById("l2"), bad;
        try { doc.querySelector("li:bogus"); bad = "no error"; } catch (e) { bad = e.name; }
        return [l2.matches("ul > li:nth-child(2)"), l2.closest("div.a") === doc.getElementById("root"), l2.closest(":scope") === l2,
                doc.getElementById("list").querySelectorAll(":scope > li").length, doc.querySelectorAll(":root").length, bad];`),
    ).toEqual([true, true, true, 4, 1, "SyntaxError"]);
  });
});

describe("native DOM: live collections", () => {
  it("children, childNodes and getElementsBy* follow later changes", async () => {
    expect(
      await run(`
        var root = d.createElement("div"), kids = root.children, nodes = root.childNodes, ps = root.getElementsByTagName("p"), cs = root.getElementsByClassName("c");
        var before = [kids.length, nodes.length, ps.length, cs.length];
        var p = d.createElement("p"); p.className = "c"; root.appendChild(p); root.appendChild(d.createTextNode("t"));
        var mid = [kids.length, nodes.length, ps.length, cs.length, kids[0] === p, kids.item(0) === p, kids.item(5), Array.isArray(kids), Array.from(kids).length, root.children === kids];
        p.className = ""; var cls = cs.length; root.removeChild(p);
        return [before, mid, cls, kids.length, ps.length, [].slice.call(nodes).length, Object.keys(nodes).join()];`),
    ).toEqual([[0, 0, 0, 0], [1, 2, 1, 1, true, true, null, false, 1, true], 0, 0, 0, 1, "0"]);
  });
});
