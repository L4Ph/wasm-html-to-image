import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type Bridge, type QuickJSDOM } from "../src/index.js";
import { side, type Trace } from "./lockstep.js";

// The bridge: the page's DOM used from Node, synchronously. The same random programs that tests/nativedom.test.ts runs
// inside the page are run here from the host on the bridge's document and on jsdom's, and must leave the same traces.

let dom: QuickJSDOM;
let bridge: Bridge;
let w: any;
beforeAll(async () => {
  dom = await createDOM({ html: "<!doctype html><title>t</title><body><div id=a class='x y'>hi <b>there</b></div><ul><li>1<li>2<li>3</ul>" }, { settleMs: 0 });
  bridge = dom.bridge();
  w = bridge.window;
});
afterAll(() => dom.close());

describe("bridge: objects of the page from the host", () => {
  it("reads nodes, properties and collections", () => {
    const d = w.document;
    expect(d.title).toBe("t");
    expect(d.nodeType).toBe(9);
    expect(d.body.tagName).toBe("BODY");
    const a = d.getElementById("a");
    expect(a.className).toBe("x y");
    expect(a.textContent).toBe("hi there");
    expect(a.constructor.name).toBe("HTMLDivElement");
    expect(a instanceof w.HTMLElement).toBe(true);
    expect(a instanceof w.Node).toBe(true);
    expect(a instanceof w.HTMLInputElement).toBe(false);
    expect(d.querySelectorAll("li").length).toBe(3);
    expect([...d.querySelectorAll("li")].map((li: any) => li.textContent)).toEqual(["1", "2", "3"]);
    expect(d.querySelectorAll("li")[1].textContent).toBe("2");
    expect(Array.from(a.childNodes).map((n: any) => n.nodeName)).toEqual(["#text", "B"]);
    expect(w.Node.ELEMENT_NODE).toBe(1);
    expect(a.ELEMENT_NODE).toBe(1);
  });

  it("gives the same wrapper for the same node", () => {
    const d = w.document;
    expect(d.getElementById("a")).toBe(d.getElementById("a"));
    expect(d.body.firstElementChild).toBe(d.getElementById("a"));
    expect(d.body.firstElementChild.parentNode).toBe(d.body);
    expect(d.documentElement).toBe(d.body.parentNode);
    expect(w.document).toBe(d);
  });

  it("writes, calls methods and passes values both ways", () => {
    const d = w.document;
    const el = d.createElement("p");
    el.textContent = "new";
    el.setAttribute("data-k", "v");
    el.classList.add("one", "two");
    el.style.color = "red";
    d.body.appendChild(el);
    expect(d.body.lastChild).toBe(el);
    expect(el.outerHTML).toBe('<p data-k="v" class="one two" style="color: red;">new</p>');
    expect(el.dataset.k).toBe("v");
    expect(el.classList.contains("two")).toBe(true);
    expect(el.getAttribute("nope")).toBe(null);
    expect(el.matches("body > p.one")).toBe(true);
    el.remove();
    expect(el.parentNode).toBe(null);
  });

  it("throws what the page throws, with the same kind of error", () => {
    const d = w.document;
    expect(() => d.querySelector("li:bogus")).toThrow(SyntaxError);
    try {
      d.body.appendChild(d.body);
      expect.unreachable();
    } catch (e: any) {
      expect(e.name).toBe("HierarchyRequestError");
      expect(e).toBeInstanceOf(DOMException);
    }
    expect(() => new w.Node()).toThrow(TypeError);
  });

  it("makes objects with the page's constructors", () => {
    const e = new w.CustomEvent("ping", { detail: { n: 1, list: [1, 2] }, bubbles: true });
    expect(e.type).toBe("ping");
    expect(e.bubbles).toBe(true);
    expect(e.detail).toEqual({ n: 1, list: [1, 2] });
    expect(e instanceof w.Event).toBe(true);
    expect(w.document.createElement("div") instanceof w.Element).toBe(true);
  });

  it("lets the host keep its own properties on a node", () => {
    const el = w.document.createElement("div");
    el.__fiber = { a: 1 };
    expect(el.__fiber).toEqual({ a: 1 });
    expect("__fiber" in el).toBe(true);
    expect(el.nothing).toBe(undefined);
  });
});

describe("bridge: functions of the host called by the page", () => {
  it("event listeners run at once, with the event, this and the target", () => {
    const d = w.document;
    const a = d.getElementById("a");
    const seen: unknown[] = [];
    const onClick = function (this: unknown, e: any) {
      seen.push([e.type, e.target === a, e.currentTarget === a, this === a, e.bubbles]);
    };
    a.addEventListener("click", onClick);
    a.dispatchEvent(new w.Event("click", { bubbles: true }));
    a.click();
    a.removeEventListener("click", onClick);
    a.click();
    expect(seen).toEqual([
      ["click", true, true, true, true],
      ["click", true, true, true, true], // click() bubbles
    ]);
  });

  it("listeners see the event travel, stop it and cancel it", () => {
    const d = w.document;
    const a = d.getElementById("a");
    const order: string[] = [];
    const body = (e: any) => order.push("body " + e.eventPhase);
    d.body.addEventListener("go", body);
    a.addEventListener("go", (e: any) => {
      order.push("a");
      e.preventDefault();
    });
    const ev = new w.Event("go", { bubbles: true, cancelable: true });
    expect(a.dispatchEvent(ev)).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
    expect(order).toEqual(["a", "body 3"]);
    d.body.removeEventListener("go", body);
  });

  it("a listener may call back into the page, several levels deep", () => {
    const d = w.document;
    const a = d.getElementById("a");
    const depth: number[] = [];
    a.addEventListener("deep", (e: any) => {
      const n = e.detail.n;
      depth.push(n);
      if (n < 3) a.dispatchEvent(new w.CustomEvent("deep", { detail: { n: n + 1 } }));
    });
    a.dispatchEvent(new w.CustomEvent("deep", { detail: { n: 1 } }));
    expect(depth).toEqual([1, 2, 3]);
  });

  it("an error thrown by a listener is reported by the page and the others still run", () => {
    const d = w.document;
    const a = d.getElementById("a");
    let after = 0;
    a.addEventListener("boom", () => {
      throw new Error("from the host");
    });
    a.addEventListener("boom", () => {
      after++;
    });
    a.dispatchEvent(new w.Event("boom"));
    expect(after).toBe(1);
  });

  it("mutation observers call the host when the host's call is over", () => {
    const d = w.document;
    const records: unknown[] = [];
    const obs = new w.MutationObserver((list: any[]) => records.push(list.map((r) => [r.type, r.addedNodes.length])));
    obs.observe(d.body, { childList: true });
    const el = d.createElement("i");
    d.body.appendChild(el);
    expect(records).toEqual([[["childList", 1]]]);
    obs.disconnect();
    el.remove();
  });

  it("timers of the page can call the host", async () => {
    const hits: number[] = [];
    w.setTimeout(() => hits.push(1), 0);
    await dom.settle(20);
    expect(hits).toEqual([1]);
  });
});

describe("bridge: handles", () => {
  it("are let go of when the wrappers are collected", async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const before = bridge.liveHandles();
    (() => {
      for (let i = 0; i < 500; i++) w.document.createElement("div");
    })();
    expect(bridge.liveHandles()).toBeGreaterThanOrEqual(before + 500);
    if (!gc) return; // needs node --expose-gc
    for (let i = 0; i < 5; i++) {
      gc();
      await new Promise((r) => setTimeout(r, 10));
    }
    bridge.flush();
    expect(bridge.liveHandles()).toBeLessThan(before + 100);
  });
});

describe("bridge follows jsdom", () => {
  // the programs of tests/nativedom.test.ts, run from the host through the bridge: 40 programs of 60 steps
  it("random tree edits through the bridge", () => {
    const seed = 20250601;
    const programs = 40;
    const steps = 60;
    const ref = side(new JSDOM("<p>").window.document, seed, programs, steps, false);
    const got = side(w.document.implementation?.createHTMLDocument ? w.document.implementation.createHTMLDocument("") : w.document, seed, programs, steps, false);
    for (let p = 0; p < programs; p++) {
      const a: Trace = ref[p];
      const b: Trace = got[p];
      for (let s = 0; s < Math.max(a.steps.length, b.steps.length); s++) {
        if (a.steps[s] === b.steps[s]) continue;
        const da = side(new JSDOM("<p>").window.document, a.seed, 1, steps, true)[0].steps[s] ?? "(none)";
        const db = side(w.document.implementation.createHTMLDocument(""), a.seed, 1, steps, true)[0].steps[s] ?? "(none)";
        const la = da.split("\n");
        const lb = db.split("\n");
        let k = 0;
        while (k < la.length && la[k] === lb[k]) k++;
        expect.fail(`program seed ${a.seed}, step ${s}\njsdom:  ${la[0]} ${la[k]}\nbridge: ${lb[0]} ${lb[k]}`);
      }
    }
  });
});

describe("bridge: what was read is not kept past a change of the page", () => {
  const fresh = () => {
    const d = w.document;
    d.body.innerHTML = "<p id=t>one</p>";
    return d.getElementById("t");
  };

  it("repeated reads are the same, and a write shows at once", () => {
    const p = fresh();
    expect(p.textContent).toBe("one");
    expect(p.textContent).toBe("one");
    p.textContent = "two";
    expect(p.textContent).toBe("two");
    expect(p.matches(".x")).toBe(false);
    p.className = "x";
    expect(p.matches(".x")).toBe(true);
    expect(p.getAttribute("class")).toBe("x");
    p.removeAttribute("class");
    expect(p.getAttribute("class")).toBe(null);
  });

  it("code the page runs (eval, a listener of the page, a timer) shows in the next read", async () => {
    const p = fresh();
    expect(p.textContent).toBe("one");
    w.eval("document.getElementById('t').textContent = 'from eval'");
    expect(p.textContent).toBe("from eval");
    w.eval("document.getElementById('t').addEventListener('click', () => { document.getElementById('t').textContent = 'clicked' })");
    expect(p.textContent).toBe("from eval");
    p.click();
    expect(p.textContent).toBe("clicked");
    w.eval("setTimeout(() => { document.getElementById('t').textContent = 'later' }, 5)");
    expect(p.textContent).toBe("clicked");
    await dom.settle(30);
    expect(p.textContent).toBe("later");
  });

  it("a list read before a change is not reused after it", () => {
    const d = w.document;
    d.body.innerHTML = "<i></i><i></i>";
    expect(d.querySelectorAll("i").length).toBe(2);
    d.body.appendChild(d.createElement("i"));
    expect(d.querySelectorAll("i").length).toBe(3);
    expect([...d.body.children].length).toBe(3);
    d.body.firstChild.remove();
    expect([...d.body.children].length).toBe(2);
  });
});

describe("bridge: functions of the host that the page held", () => {
  it("are forgotten once the page lets go of them", () => {
    const d = w.document;
    const el = d.createElement("button");
    d.body.appendChild(el);
    let calls = 0;
    const keep = () => calls++;
    el.addEventListener("click", keep);
    for (let i = 0; i < 1000; i++) {
      const f = () => {};
      el.addEventListener("click", f);
      el.removeEventListener("click", f);
    }
    d.body.getAttribute("x"); // any call lets the bridge sort the functions out
    expect(bridge.registeredFunctions()).toBeLessThan(600);
    el.click();
    expect(calls).toBe(1); // the listener that is still registered still works
    el.remove();
  });
});
