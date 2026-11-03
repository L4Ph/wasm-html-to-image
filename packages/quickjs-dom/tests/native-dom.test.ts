import { describe, expect, it } from "vitest";
import { createDOM } from "../src/index.js";

// The page running on the native DOM (the only DOM now): the scenarios of dom.test.ts that touch the DOM most.

const page = async (html: string, run: string) => {
  const dom = await createDOM({ html }, { settleMs: 20 });
  try {
    return { value: await dom.eval(run), html: dom.serialize(), logs: dom.logs.filter((l) => l.type === "error") };
  } finally {
    dom.close();
  }
};

describe("createDOM on the native DOM", () => {
  it("runs scripts, serializes with the doctype and finds head and body in loose markup", async () => {
    const r = await page(`<!doctype html><div id=a>x</div><script>document.getElementById("a").textContent = "y"; document.body.setAttribute("data-b", "1")</script>`, `document.head.tagName + document.body.tagName`);
    expect(r.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(r.html).toContain(">y<");
    expect(r.logs).toEqual([]);
  });

  it("custom elements: constructor, connected, attributeChanged and disconnected callbacks, upgrade of existing markup", async () => {
    const r = await page(
      `<x-old></x-old><script>
        const log = [];
        class Old extends HTMLElement { constructor() { super(); log.push("ctor-old"); } connectedCallback() { log.push("conn-old"); } }
        customElements.define("x-old", Old);
        class B extends HTMLElement {
          static get observedAttributes() { return ["v"]; }
          connectedCallback() { log.push("conn"); }
          disconnectedCallback() { log.push("disc"); }
          attributeChangedCallback(n, o, v) { log.push("attr:" + o + ">" + v); }
        }
        customElements.define("x-b", B);
        const b = document.createElement("x-b"); b.setAttribute("v", "1"); document.body.appendChild(b); b.setAttribute("v", "2"); b.remove();
        const made = new B(); log.push(String(made instanceof B) + made.localName);
        window.__log = log.join(",");
      </script>`,
      `window.__log`,
    );
    expect(r.value).toBe("ctor-old,conn-old,attr:null>1,conn,attr:1>2,disc,truex-b");
  });

  it("MutationObserver, events and style work through the page's globals", async () => {
    const r = await page(
      `<div id=a></div><script>
        const a = document.getElementById("a"), got = [];
        new MutationObserver((m) => { a.dataset.n = String(m.length); }).observe(a, { childList: true });
        a.addEventListener("click", (e) => got.push(e.type + e.target.id));
        a.appendChild(document.createElement("i")); a.click(); a.style.color = "red";
        window.__got = got.join();
      </script>`,
      `window.__got`,
    );
    expect(r.value).toBe("clicka");
    expect(r.html).toContain('data-n="1"');
    expect(r.html).toContain("color: red;");
  });
});
