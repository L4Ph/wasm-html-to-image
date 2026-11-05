import { afterEach, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

// What the host has read of the page is kept until the page changes. A change of attributes, or a new node, drops only
// the reads it can change, and only while the page has no custom elements (their callbacks run page code). These tests
// make the reads and then the changes that must not leave a stale answer.

let dom: QuickJSDOM | undefined;
afterEach(() => {
  dom?.close();
  dom = undefined;
});
const open = async (html: string) => {
  dom = await createDOM({ html }, { settleMs: 0 });
  return dom.bridge().window as any;
};

describe("reads that outlast a change of attributes", () => {
  it("still see the tree change (firstChild, lastChild, ownerDocument, parentNode)", async () => {
    const w = await open("<body><div id=a><i>1</i></div>");
    const d = w.document;
    const a = d.getElementById("a");
    expect(a.firstChild.nodeName).toBe("I");
    expect(a.lastChild.nodeName).toBe("I");
    a.setAttribute("title", "t");
    a.className = "c";
    expect(a.firstChild.nodeName).toBe("I"); // read again, after attribute changes only
    const b = d.createElement("b");
    expect(b.ownerDocument).toBe(d);
    a.appendChild(b);
    expect(a.lastChild).toBe(b);
    expect(b.parentNode).toBe(a);
    a.removeChild(a.firstChild);
    expect(a.firstChild).toBe(b);
    a.textContent = "text";
    expect(a.firstChild.nodeType).toBe(3);
    expect(a.lastChild.nodeValue).toBe("text");
  });

  it("see an attribute-dependent answer change", async () => {
    const w = await open("<body><div id=a class=x></div><div id=b></div>");
    const d = w.document;
    const a = d.getElementById("a");
    expect(a.matches(".x")).toBe(true);
    expect(d.querySelectorAll(".x").length).toBe(1);
    expect(d.getElementById("b")).not.toBe(null);
    a.setAttribute("class", "y");
    expect(a.matches(".x")).toBe(false);
    expect(d.querySelectorAll(".x").length).toBe(0);
    d.getElementById("b").setAttribute("id", "c");
    expect(d.getElementById("b")).toBe(null);
    expect(a.className).toBe("y");
    a.className = "z";
    expect(a.getAttribute("class")).toBe("z");
    const t = d.createTextNode("one");
    a.appendChild(t);
    expect(a.textContent).toBe("one");
    t.data = "two";
    expect(a.textContent).toBe("two");
    t.nodeValue = "three";
    expect(a.textContent).toBe("three");
  });

  it("see a node moved into another document", async () => {
    const w = await open("<body><div id=a></div>");
    const d = w.document;
    const other = d.implementation.createHTMLDocument("x");
    const e = d.createElement("p");
    expect(e.ownerDocument).toBe(d);
    other.body.appendChild(e);
    expect(e.ownerDocument).toBe(other);
    const f = other.createElement("p");
    expect(f.ownerDocument).toBe(other);
    d.adoptNode(f);
    expect(f.ownerDocument).toBe(d);
  });

  it("see a node move between documents whose ownerDocument is known on both sides", async () => {
    const w = await open("<body><div id=a></div>");
    const d = w.document;
    const other = d.implementation.createHTMLDocument("x");
    const host = other.body;
    expect(host.ownerDocument).toBe(other); // known
    const e = d.createElement("p"); // made by d: known
    const g = d.createElement("p");
    expect(e.ownerDocument).toBe(d);
    d.body.appendChild(g); // the same document on both sides: nothing moves
    expect(g.ownerDocument).toBe(d);
    host.appendChild(e); // two documents
    expect(e.ownerDocument).toBe(other);
    expect(g.ownerDocument).toBe(d);
    d.body.insertBefore(e, g); // and back
    expect(e.ownerDocument).toBe(d);
    host.replaceChildren(g);
    expect(g.ownerDocument).toBe(other);
    expect(host.ownerDocument).toBe(other);
  });
});

describe("custom elements run page code on a change of attributes", () => {
  it("a callback that changes the tree is seen by a read that was made before", async () => {
    const w = await open("<body><x-a id=a><span></span></x-a>");
    const d = w.document;
    const a = d.getElementById("a");
    expect(a.firstChild.nodeName).toBe("SPAN");
    // the page defines the element after the host has read: the host must notice
    await dom!.eval(`customElements.define("x-a", class extends HTMLElement {
      static get observedAttributes() { return ["data-n"]; }
      attributeChangedCallback() { this.insertBefore(document.createElement("em"), this.firstChild); }
    })`);
    a.setAttribute("data-n", "1");
    expect(a.firstChild.nodeName).toBe("EM");
    a.setAttribute("data-n", "2");
    expect(a.firstChild.nodeName).toBe("EM");
    expect(a.childNodes.length).toBe(3);
  });
});

describe("a handler set again", () => {
  it("is set again when the page replaced it", async () => {
    const w = await open("<body><button id=a>go</button>");
    const a = w.document.getElementById("a");
    const seen: string[] = [];
    const first = () => seen.push("host");
    a.onclick = first;
    a.onclick = first; // the same handler again: nothing to send
    a.click();
    expect(seen).toEqual(["host"]);
    await dom!.eval(`document.getElementById("a").onclick = function () { globalThis.page = 1; }`);
    a.onclick = first; // the page replaced it, so the host's must go back
    a.click();
    expect(seen).toEqual(["host", "host"]);
    // (an "onclick" attribute is not compiled here, so the property keeps what was set)
    a.onclick = first;
    a.click();
    expect(seen).toEqual(["host", "host", "host"]);
    a.onclick = null;
    a.click();
    expect(seen.length).toBe(3);
  });
});
