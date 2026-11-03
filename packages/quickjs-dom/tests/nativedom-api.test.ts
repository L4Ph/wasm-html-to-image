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
