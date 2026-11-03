import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";
import { JSDOM } from "jsdom";

// What the native DOM (csrc/nativedom*.h) must do as the DOM specification says, where jsdom is not a reference
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
          el.constructor === C.HTMLDivElement, Object.getPrototypeOf(C.HTMLElement) === C.Element,
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

describe("native DOM: parsing like a browser", () => {
  const show = (markup: string) =>
    dom.eval((m: string) => new DOMParser().parseFromString(m, "text/html").documentElement.outerHTML, markup);
  it("supplies html, head and body, and drops the blank text before <head>", async () => {
    expect(await show("<h1>Hi</h1>")).toBe("<html><head></head><body><h1>Hi</h1></body></html>");
    expect(await show("<title>t</title><p>x")).toBe("<html><head><title>t</title></head><body><p>x</p></body></html>");
    expect(await show("<html>\n<head></head>\n<body>b</body>\n</html>\n")).toBe("<html><head></head>\n<body>b\n\n</body></html>");
  });
  it("puts a <tr> of a table in a <tbody>, and folds the case of HTML attribute names but not of svg's", async () => {
    expect(await show("<table><tr><td>1<tr><td>2</table>")).toBe(
      "<html><head></head><body><table><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table></body></html>",
    );
    expect(await show('<div onClick=a ID=b><svg viewBox="0 0 1 1"><g onClick=c></g></svg></div>')).toBe(
      '<html><head></head><body><div onclick="a" id="b"><svg viewBox="0 0 1 1"><g onClick="c"></g></svg></div></body></html>',
    );
  });
});

describe("native DOM: parsing", () => {
  it("a character reference does not split a text node", async () => {
    const out = await dom.eval(() => {
      const t = new DOMParser().parseFromString("<p>a&#x27;s &amp; b<!-- c -->d&lt;e</p>", "text/html").querySelector("p")!;
      return [...t.childNodes].map((n) => n.nodeType + ":" + n.textContent);
    });
    expect(out).toEqual(["3:a's & b", "8: c ", "3:d<e"]);
  });
});

describe("native DOM: addresses", () => {
  it("document.location, and an anchor's address taken apart", async () => {
    const out = await dom.eval(() => {
      const a = document.createElement("a");
      a.setAttribute("href", "https://h.test:8080/p/q?x=1#f");
      return [document.location === window.location, a.protocol, a.host, a.hostname, a.port, a.pathname, a.search, a.hash, a.origin];
    });
    expect(out).toEqual([true, "https:", "h.test:8080", "h.test", "8080", "/p/q", "?x=1", "#f", "https://h.test:8080"]);
  });
});

describe("native DOM: XPath", () => {
  it("document.evaluate answers paths, predicates, functions and unions", async () => {
    const out = await dom.eval(() => {
      const d = new DOMParser().parseFromString(
        '<ul id=l><li class="a x">one</li><li class=b>two</li><li class="a">three<b>!</b></li></ul><p title=t>hi</p>',
        "text/html",
      );
      const q = (e: string) => {
        const r = d.evaluate(e, d, null, 7, null);
        return Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i)!.textContent);
      };
      return [
        q("//li"),
        q("//li[2]"),
        q("//li[last()]"),
        q("//li[@class='b']"),
        q("//li[contains(@class, 'a')]/text()"),
        q("//ul/li[position() < 3]"),
        q("//li | //p"),
        q("//@title"),
        q("//b/ancestor::li"),
        q("//li[1]/following-sibling::li"),
        q("//li[not(@class='b') and b]"),
        d.evaluate("count(//li)", d, null, 1, null).numberValue,
        d.evaluate("string(//p/@title)", d, null, 2, null).stringValue,
        d.evaluate("//p", d, null, 9, null).singleNodeValue!.nodeName,
        d.evaluate("//li[@class='zz']", d, null, 3, null).booleanValue,
      ];
    });
    expect(out).toEqual([
      ["one", "two", "three!"],
      ["two"],
      ["three!"],
      ["two"],
      ["one", "three"],
      ["one", "two"],
      ["one", "two", "three!", "hi"],
      ["t"],
      ["three!"],
      ["two", "three!"],
      ["three!"],
      3,
      "t",
      "P",
      false,
    ]);
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
        var doc = N.parseLoose("<div>t<p id=a></p>u<p id=b></p>v</div>");
        var div = doc.firstChild, a = doc.getElementById("a");
        return [div.childElementCount, div.firstElementChild.id, div.lastElementChild.id, a.nextElementSibling.id, a.previousElementSibling, div.children.length, div.childNodes.length];`),
    ).toEqual([2, "a", "b", "b", null, 2, 5]);
  });
});

describe("native DOM: templates", () => {
  it("keeps the children of a template in its content", async () => {
    expect(
      await run(`
        var doc = N.parseLoose("<template id=t><p>one</p><p>two</p></template>");
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
        var doc = N.parseLoose("<div><p id=m>mid</p></div>");
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
        var doc = N.parseLoose("<div><p id=m>x</p></div>");
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
    ).toEqual(["b", "a", "bye", "hi", "x", false, true, true]);
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

describe("native DOM: selectors against jsdom", () => {
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
  it("gives jsdom's answers", async () => {
    const answers = (parse: (html: string) => any) => {
      const doc = parse(html);
      const ids = (list: any) => Array.prototype.map.call(list, (e: any) => e.localName + "#" + e.getAttribute("id")).join(",");
      return selectors.map((sel) => {
        try {
          return ids(doc.querySelectorAll(sel));
        } catch (e: any) {
          return "ERR " + e.name;
        }
      });
    };
    const ref = answers((h) => new JSDOM(`<html><body>${h}</body></html>`).window.document);
    const native = (await dom.eval(`(function () { var selectors = ${JSON.stringify(selectors)}, html = ${JSON.stringify(html)};
      var doc = __native.dom.parse(html);
      var ids = function (list) { return Array.prototype.map.call(list, function (e) { return e.localName + "#" + e.getAttribute("id"); }).join(","); };
      return selectors.map(function (sel) { try { return ids(doc.querySelectorAll(sel)); } catch (e) { return "ERR " + e.name; } });
    })()`)) as string[];
    const bad = selectors.flatMap((sel, i) => (native[i] === ref[i] || sel === ":root" || sel === "html" /* the page here is a fragment, with no html element */ ? [] : [`${sel} native=[${native[i]}] jsdom=[${ref[i]}]`]));
    expect(bad).toEqual([]);
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

describe("native DOM: namespaces", () => {
  it("svg content reports the SVG namespace; createElementNS and the NS attribute methods work", async () => {
    expect(
      await run(`
        var doc = N.parse('<div id=a><svg id=s><path id=p d="M0 0"/><foreignObject id=fo><span id=sp></span></foreignObject></svg></div>');
        var $ = function (id) { return doc.getElementById(id); };
        var el = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#x");
        return [$("a").namespaceURI, $("s").namespaceURI, $("p").namespaceURI, $("sp").namespaceURI, el.namespaceURI, el.getAttribute("xlink:href"), el.getAttributeNS("http://www.w3.org/1999/xlink", "href"), el.hasAttributeNS(null, "xlink:href")];`),
    ).toEqual(["http://www.w3.org/1999/xhtml", "http://www.w3.org/2000/svg", "http://www.w3.org/2000/svg", "http://www.w3.org/1999/xhtml", "http://www.w3.org/2000/svg", "#x", "#x", true]);
  });
});

describe("native DOM: element interfaces", () => {
  it("elements are instances of the interface of their tag, parsed or made", async () => {
    expect(
      await run(`
        var C = N.ctors, doc = N.parse('<form><input id=i><a href=x id=a>l</a><svg id=s><circle id="c"></circle></svg><h3 id=h></h3><b id=b></b></form>');
        var $ = function (id) { return doc.getElementById(id); };
        var made = doc.createElement("input"), clone = $("i").cloneNode();
        return [$("i") instanceof C.HTMLInputElement, made instanceof C.HTMLInputElement, clone instanceof C.HTMLInputElement, $("i") instanceof C.HTMLAnchorElement,
                $("a") instanceof C.HTMLAnchorElement, $("h") instanceof C.HTMLHeadingElement, $("b").constructor === C.HTMLElement, $("i") instanceof C.HTMLElement,
                $("s") instanceof C.SVGElement, $("c") instanceof C.SVGElement, $("s") instanceof C.SVGSVGElement, $("c") instanceof C.SVGSVGElement, $("b") instanceof C.SVGElement,
                typeof Object.getOwnPropertyDescriptor(C.HTMLInputElement.prototype, "value").set, $("i").constructor.name];`),
    ).toEqual([true, true, true, false, true, true, true, true, true, true, true, false, false, "function", "HTMLInputElement"]);
  });
});

describe("native DOM: members real pages call", () => {
  it("iterators, walkers, attributes as a live map, title, scrolling no-ops", async () => {
    expect(
      await run(`
        var doc = N.parse('<html><head><title> My  page </title></head><body><div id=a x=1 y=2><!--c1--><p>t</p><!--c2--></div></body></html>');
        var a = doc.getElementById("a"), comments = [];
        var it = doc.createNodeIterator(a, 128), n;
        while ((n = it.nextNode())) comments.push(n.data);
        var tw = doc.createTreeWalker(a, 1), tags = [];
        while ((n = tw.nextNode())) tags.push(n.localName);
        var attrs = a.attributes, before = attrs.length;
        while (attrs.length) a.removeAttributeNode(attrs[0]);
        doc.title = "New"; a.scrollTo({ left: 1 }); a.scrollTop = 5;
        var at = doc.createAttribute("z"); at.value = "9"; a.setAttributeNode(at);
        return [comments.join(), tags.join(), before, attrs.length, a.getAttribute("id"), doc.title, a.getAttribute("z"), a.scrollTop, a.getAttributeNode("z").value];`),
    ).toEqual(["c1,c2", "p", 3, 1, null, "New", "9", 0, "9"]);
  });
});

describe("markup set inside raw-text elements", () => {
  const code = "for(r=0;r<t;r++)x;n>3&&q<z>1";
  it("script, style, textarea and title take it as text; .text reads it back", async () => {
    const dom = await createDOM({ html: "<body></body>" }, { settleMs: 0 });
    try {
      const w = dom.bridge().window as any;
      const d = w.document;
      for (const tag of ["script", "style", "textarea", "title", "xmp", "noscript"]) {
        const e = d.createElement(tag);
        e.innerHTML = code;
        expect([tag, e.childNodes.length, e.textContent]).toEqual([tag, 1, code]);
        e.insertAdjacentHTML("beforeend", "<b>x</b>");
        expect(e.textContent).toBe(code + "<b>x</b>");
      }
      const t = d.createElement("textarea");
      t.innerHTML = "a &amp; b";
      expect(t.textContent).toBe("a & b"); // character references are decoded in the text of a textarea
      const s = d.createElement("script");
      s.text = code;
      expect([s.textContent, s.text]).toEqual([code, code]);
      const o = d.createElement("option");
      o.innerHTML = "  a \n b ";
      expect(o.text).toBe("a b");
    } finally {
      dom.close();
    }
  });
});

describe("media elements", () => {
  it("are elements without a playable source: paused, empty, and play() is refused", async () => {
    const dom = await createDOM({ html: "<body><video id=v muted autoplay></video><audio id=a></audio></body>" }, { settleMs: 0 });
    try {
      const w = dom.bridge().window as any;
      const d = w.document;
      const v = d.getElementById("v");
      expect(v instanceof w.HTMLMediaElement).toBe(true);
      expect(v instanceof w.HTMLVideoElement).toBe(true);
      expect(d.getElementById("a") instanceof w.HTMLMediaElement).toBe(true);
      expect([v.muted, v.defaultMuted, v.autoplay, v.paused, v.ended, v.readyState, v.volume, v.currentTime, v.canPlayType("video/mp4")]).toEqual([true, true, true, true, false, 0, 1, 0, ""]);
      expect(Number.isNaN(v.duration)).toBe(true);
      v.muted = false;
      v.volume = 0.5;
      v.currentTime = 3;
      expect([v.muted, v.volume, v.currentTime]).toEqual([false, 0.5, 3]);
      expect(() => (v.volume = 2)).toThrow(/range/);
      expect(v.buffered.length).toBe(0);
      expect(v.playsInline).toBe(false);
      v.playsInline = true;
      expect(v.getAttribute("playsinline")).toBe("");
      v.pause();
      v.load();
    } finally {
      dom.close();
    }
  });
});

describe("character references in RCDATA", () => {
  it("a textarea's text is decoded like a title's", async () => {
    const dom = await createDOM({ html: "<!doctype html><title>A &amp; B</title><body><textarea id=t>x &amp; y &lt;b&gt;</textarea><script id=s>a &amp; b</script></body>" }, { settleMs: 0 });
    try {
      const d = dom.bridge().window.document as any;
      expect([d.title, d.getElementById("t").value, d.getElementById("s").textContent]).toEqual(["A & B", "x & y <b>", "a &amp; b"]);
    } finally {
      dom.close();
    }
  });
});

describe("URL against an opaque base", () => {
  it("resolves a path against x:/ the way webpack's check does", async () => {
    const dom = await createDOM({ html: "<body></body>" }, { settleMs: 0 });
    try {
      const w = dom.bridge().window as any;
      expect([w.eval('new URL("/a/b.svg", "x:/").href'), w.eval('new URL("b", "x:/a/").href')]).toEqual(["x:/a/b.svg", "x:/a/b"]);
    } finally {
      dom.close();
    }
  });
});

describe("Storage and Intl", () => {
  it("localStorage is a Storage whose items are also properties; Intl has what pages feature-detect", async () => {
    const dom = await createDOM({ html: "<body></body>" }, { settleMs: 0 });
    try {
      const w = dom.bridge().window as any;
      expect(w.eval("localStorage instanceof Storage")).toBe(true);
      expect(w.eval('localStorage.theme = "dark"; [localStorage.getItem("theme"), localStorage.length, Object.keys(localStorage).join(), "theme" in localStorage].join()')).toBe("dark,1,theme,true");
      expect(w.eval('delete localStorage.theme; localStorage.getItem("theme")')).toBeNull();
      expect(w.eval('[...new Intl.Segmenter().segment("a\u{1F44D}\u{1F3FD}b")].map((s) => s.segment).length')).toBe(3);
      expect(w.eval('[...new Intl.Segmenter("en", { granularity: "word" }).segment("hi there!")].filter((s) => s.isWordLike).map((s) => s.segment).join()')).toBe("hi,there");
      expect(w.eval('new Intl.PluralRules("en").select(1) + new Intl.PluralRules("en").select(2)')).toBe("oneother");
      expect(w.eval('new Intl.ListFormat("en").format(["a", "b", "c"])')).toBe("a, b, and c");
    } finally {
      dom.close();
    }
  });
});

describe("geometry interfaces, Intl.NumberFormat, XMLHttpRequest events", () => {
  it("DOMMatrix, DOMRect and DOMPoint work; NumberFormat is callable and groups", async () => {
    const dom = await createDOM({ html: "<body></body>" }, { settleMs: 0 });
    try {
      const w = dom.bridge().window as any;
      expect(w.eval('String(new DOMMatrix("translate(10px, 20px) scale(2)"))'.replace("10px, 20px", "10, 20"))).toBe("matrix(2, 0, 0, 2, 10, 20)");
      expect(w.eval('const m = new DOMMatrix("matrix(1, 0, 0, 1, 5, 6)"); [m.e, m.f, m.is2D, m.inverse().e, m.transformPoint({ x: 1, y: 1 }).x].join()')).toBe("5,6,true,-5,6");
      expect(w.eval('new DOMMatrix("none").isIdentity')).toBe(true);
      expect(w.eval('const r = new DOMRect(1, 2, 3, 4); [r.right, r.bottom, JSON.stringify(r.toJSON()).length > 10].join()')).toBe("4,6,true");
      expect(w.eval('Intl.NumberFormat("en-US").format(1234567.891)')).toBe("1,234,567.891");
      expect(w.eval('new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(1234.5)')).toBe("$1,234.50");
      expect(w.eval('new Intl.NumberFormat("en", { style: "percent" }).format(0.256)')).toBe("26%");
      expect(w.eval('new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(2.5)')).toBe("3");
    } finally {
      dom.close();
    }
  });

  it("XMLHttpRequest events carry currentTarget and the readyState sequence", async () => {
    const dom = await createDOM({ html: "<body></body>" }, { settleMs: 0 });
    try {
      const w = dom.bridge().window as any;
      const out = w.eval(`(function () {
        var x = new XMLHttpRequest(), seen = [];
        x.addEventListener("readystatechange", function (e) { seen.push(e.currentTarget === x ? x.readyState : "bad"); });
        x.open("GET", "data:,");
        return seen.concat([x.getAllResponseHeaders() === "", XMLHttpRequest.DONE]).join();
      })()`);
      expect(out).toBe("1,true,4");
    } finally {
      dom.close();
    }
  });
});

describe("platform odds and ends", () => {
  it("baseURI follows <base href>; URL.canParse/parse; the query is kept as written", async () => {
    const page = await createDOM({ html: '<head><base href="/x/"></head><body><i></i></body>', baseUrl: "https://e.com/a/b?q#frag" }, { settleMs: 0 });
    try {
      expect(
        await page.eval(`JSON.stringify([document.baseURI, document.body.baseURI, document.createElement("a").baseURI,
          URL.canParse("/p", "https://e.com"), URL.canParse("nope"), URL.parse("nope"), URL.parse("/p", "https://e.com").href,
          new URL("https://e.com/a?x#y").href, location.hash, location.search])`),
      ).toBe(JSON.stringify(["https://e.com/x/", "https://e.com/x/", "https://e.com/x/", true, false, null, "https://e.com/p", "https://e.com/a?x#y", "#frag", "?q"]));
    } finally {
      page.close();
    }
  });
});

describe("streams and constructable sheets", () => {
  it("ReadableStream / TransformStream / TextEncoderStream and CSSStyleSheet", async () => {
    expect(
      await dom.eval(`(async function () {
        var out = [];
        var r = new ReadableStream({ start(c) { c.enqueue("a"); c.enqueue("b"); c.close(); } }).getReader();
        out.push((await r.read()).value, (await r.read()).value, (await r.read()).done);
        var t = new ReadableStream({ start(c) { c.enqueue("héllo"); c.close(); } }).pipeThrough(new TextEncoderStream()).pipeThrough(new TextDecoderStream());
        var s = ""; for await (var ch of t) s += ch; out.push(s);
        var sh = new CSSStyleSheet(); sh.replaceSync("a{color:red} .b{margin:0}");
        document.adoptedStyleSheets = [sh];
        out.push(sh.cssRules.length, sh.cssRules[0].selectorText, document.adoptedStyleSheets.length);
        return JSON.stringify(out);
      })()`),
    ).toBe(JSON.stringify(["a", "b", true, "héllo", 2, "a", 1]));
  });
});

describe("custom elements with private fields; canvas value classes", () => {
  it("a constructor runs once per element however the element is made", async () => {
    const page = await createDOM({ html: "<my-b id=up datetime=1></my-b>" }, { settleMs: 0 });
    try {
      expect(
        await page.eval(`(function () {
          var runs = 0;
          class B extends HTMLElement { #t; constructor() { super(); runs++; this.#t = 5; } get t() { return this.#t; } }
          customElements.define("my-b", B);
          var made = document.createElement("my-b"), by = new B();
          document.body.innerHTML = "<my-b id=z></my-b>";
          return JSON.stringify([document.getElementById("z").t, made.t, by.t, document.querySelector("#up") === null, runs,
            typeof Path2D, new ImageData(2, 2).data.length, typeof OffscreenCanvas, typeof document.createElement("div").attachShadow({ mode: "open" }).adoptedStyleSheets]);
        })()`),
      ).toBe(JSON.stringify([5, 5, 5, true, 4, "function", 16, "function", "object"]));
    } finally {
      page.close();
    }
  });
});

describe("what pages with a lot of CSS-in-JS and feature checks hit", () => {
  it("a selector that ends in a lone backslash does not hang; thousands of insertRule calls stay fast", async () => {
    const page = await createDOM({ html: "<style id=s></style><div class=a></div>" }, { settleMs: 0, timeout: 8000 });
    try {
      const out = JSON.parse(
        await page.eval(`(function () {
          var t0 = Date.now(), sheet = document.getElementById("s").sheet || document.styleSheets[0];
          document.getElementById("s").textContent = ".a { color: red } .b\\\\";
          var c = getComputedStyle(document.querySelector(".a")).color;
          for (var i = 0; i < 3000; i++) sheet.insertRule(".r" + i + " { margin: " + i + "px }", sheet.cssRules.length);
          return JSON.stringify([c, sheet.cssRules.length > 3000, Date.now() - t0 < 5000]);
        })()`),
      );
      expect(out).toEqual(["rgb(255, 0, 0)", true, true]);
    } finally {
      page.close();
    }
  });

  it("File, FileReader, Intl without new, the observer entry classes", async () => {
    expect(
      await dom.eval(`new Promise(function (res) {
        var f = new File(["hi"], "a.txt", { type: "text/plain" }), r = new FileReader();
        r.onload = function () {
          res(JSON.stringify([f.name, f instanceof Blob, r.result, typeof Intl.DateTimeFormat("en").format(new Date(0)), typeof Intl.Collator().compare,
            "intersectionRatio" in IntersectionObserverEntry.prototype]));
        };
        r.readAsDataURL(f);
      })`),
    ).toBe(JSON.stringify(["a.txt", true, "data:text/plain;base64,aGk=", "string", "function", true]));
  });
});
