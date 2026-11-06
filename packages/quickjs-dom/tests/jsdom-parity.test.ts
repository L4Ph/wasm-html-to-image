import { JSDOM as RealJSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "../src/jsdom.js";

// What test suites written against jsdom rely on, run against jsdom and against this package: a difference here is a
// test that passes on one and fails on the other.

const open: { window: { close?: () => void } }[] = [];
afterEach(() => {
  while (open.length) open.pop()!.window.close?.();
});

describe.each([
  ["jsdom", RealJSDOM as unknown as typeof JSDOM],
  ["wasm-quickjs-dom", JSDOM],
])("%s", (_name, Dom) => {
  const page = (html = "<!doctype html><html><head></head><body></body></html>") => {
    const dom = new Dom(html, { url: "http://localhost/", runScripts: "dangerously" });
    open.push(dom as never);
    return dom.window as any;
  };

  describe("attributes", () => {
    it("lower-cases the name on an HTML element, in every attribute method", () => {
      const { document } = page();
      const el = document.createElement("div");
      el.setAttribute("tabIndex", "1");
      expect(el.getAttribute("tabindex")).toBe("1");
      expect(el.getAttribute("TABINDEX")).toBe("1");
      expect(el.hasAttribute("TabIndex")).toBe(true);
      el.removeAttribute("TABINDEX");
      expect(el.hasAttribute("tabindex")).toBe(false);
    });

    it("keeps the case on an SVG element", () => {
      const { document } = page();
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 1 1");
      expect(svg.getAttribute("viewBox")).toBe("0 0 1 1");
      expect(svg.getAttribute("viewbox")).toBe(null);
    });

    it("sees a change right after reading the old value", () => {
      const { document } = page();
      const el = document.createElement("div");
      el.setAttribute("a", "1");
      expect(el.getAttribute("a")).toBe("1");
      el.setAttribute("a", "2");
      expect(el.getAttribute("a")).toBe("2");
    });
  });

  describe("names of nodes", () => {
    it("tells an HTML element made with createElementNS from one made with createElement", () => {
      const { document } = page();
      const made = document.createElement("FOO");
      const ns = document.createElementNS("http://www.w3.org/1999/xhtml", "FOO");
      expect([made.localName, made.tagName]).toEqual(["foo", "FOO"]);
      expect(ns.localName).toBe("FOO");
      expect(document.createElement("FOO").localName).toBe("foo");
    });

    it("keeps the case of a foreign element's tag name", () => {
      const { document } = page();
      expect(document.createElementNS("http://www.w3.org/2000/svg", "linearGradient").tagName).toBe(
        "linearGradient",
      );
    });
  });

  describe("properties a test sets on a node", () => {
    it("overwrites its own value", () => {
      const { document } = page();
      const el = document.createElement("div");
      el.__mine = 1;
      el.__mine = 2;
      expect(el.__mine).toBe(2);
    });

    it("gives a defined setter the node as this", () => {
      const { document } = page();
      const el = document.createElement("div");
      const seen: unknown[] = [];
      Object.defineProperty(el, "size", {
        set(this: unknown) {
          seen.push(this);
        },
        configurable: true,
      });
      el.size = 1;
      expect(seen[0]).toBe(el);
    });

    it("gives an object inheriting from the node its own value", () => {
      const { document } = page();
      const el = document.createElement("div");
      el.__mine = 1;
      const child = Object.create(el);
      child.__mine = 2;
      expect(el.__mine).toBe(1);
      expect(Object.hasOwn(child, "__mine")).toBe(true);
    });

    it("respects a value defined as read-only", () => {
      const { document } = page();
      const el = document.createElement("div");
      Object.defineProperty(el, "fixed", { value: 1, writable: false, configurable: true });
      expect(Reflect.set(el, "fixed", 2)).toBe(false);
      expect(el.fixed).toBe(1);
    });
  });

  describe("selectors", () => {
    it("matches :disabled inside a disabled fieldset, except in its first legend", () => {
      const { document } = page(
        `<fieldset disabled><legend><input id="in"></legend><legend><input id="second"></legend><input id="out"></fieldset><input id="free">`,
      );
      const disabled = [...document.querySelectorAll("input:disabled")].map((e: any) => e.id);
      expect(disabled).toEqual(["second", "out"]);
      expect(document.getElementById("free").matches(":enabled")).toBe(true);
    });
  });

  describe("styles", () => {
    it("gives a zero length its unit, and a calc() its minus sign", () => {
      const { document } = page();
      const el = document.createElement("div");
      el.style.width = "0";
      el.style.left = "calc(100% + -2px)";
      expect(el.style.width).toBe("0px");
      expect(el.style.left).toBe("calc(100% - 2px)");
    });

    it("keeps one style object per element, and it follows the attribute", () => {
      const { document } = page();
      const el = document.createElement("div");
      expect(el.style).toBe(el.style);
      el.style.color = "red";
      el.style.color = "blue";
      expect(el.style.color).toBe("blue");
      el.setAttribute("style", "color: green");
      expect(el.style.color).toBe("green");
    });

    it("reads a property in camelCase and in kebab-case", () => {
      const { document } = page();
      const el = document.createElement("div");
      el.style.backgroundColor = "red";
      expect(el.style.getPropertyValue("background-color")).toBe("red");
    });

    it("answers getComputedStyle per the document as it is now", () => {
      const window = page(
        `<!doctype html><html><head><style>.x { display: none }</style></head><body><p id="p"></p></body></html>`,
      );
      const p = window.document.getElementById("p");
      expect(window.getComputedStyle(p).display).toBe("block");
      p.className = "x";
      expect(window.getComputedStyle(p).display).toBe("none");
      p.className = "";
      expect(window.getComputedStyle(p).display).toBe("block");
    });

    it("leaves what was read correct after getComputedStyle, and sees a change after it", () => {
      const window = page();
      const el = window.document.createElement("div");
      window.document.body.appendChild(el);
      el.setAttribute("a", "1");
      expect(el.getAttribute("a")).toBe("1");
      window.getComputedStyle(el);
      expect(el.getAttribute("a")).toBe("1");
      el.setAttribute("a", "2");
      window.getComputedStyle(el);
      expect(el.getAttribute("a")).toBe("2");
    });

    it("calls the original getComputedStyle from a test's wrapper of it, without recursing", () => {
      const window = page();
      const original = window.getComputedStyle;
      let calls = 0;
      window.getComputedStyle = function (this: unknown, ...args: unknown[]) {
        calls++;
        return original.apply(this, args);
      };
      expect(window.getComputedStyle(window.document.body).display).toBe("block");
      expect(calls).toBe(1);
    });
  });

  describe("classList", () => {
    it("answers its tokens by index, as a list and by method", () => {
      const { document } = page();
      const el = document.createElement("div");
      el.className = "a  b";
      expect(el.classList[0]).toBe("a");
      expect(el.classList[1]).toBe("b");
      expect(el.classList[2]).toBe(undefined);
      expect(el.classList.length).toBe(2);
      expect([...el.classList]).toEqual(["a", "b"]);
      el.classList.add("c");
      el.classList.remove("a");
      expect(el.className).toBe("b c");
      expect(el.classList.contains("c")).toBe(true);
      expect(el.classList.toggle("d")).toBe(true);
      expect(el.classList.value).toBe("b c d");
    });

    it("rejects a token with a space", () => {
      const { document } = page();
      expect(() => document.createElement("div").classList.add("a b")).toThrow();
    });
  });

  describe("lists", () => {
    it("iterates an input's labels, and sees one added later", () => {
      const { document } = page(`<label for="i">one</label><input id="i">`);
      const input = document.getElementById("i");
      expect([...input.labels].map((l: any) => l.textContent)).toEqual(["one"]);
      const second = document.createElement("label");
      second.htmlFor = "i";
      second.textContent = "two";
      document.body.appendChild(second);
      expect([...input.labels].map((l: any) => l.textContent)).toEqual(["one", "two"]);
    });

    it("gives cssRules as a list of rules", () => {
      const { document } = page(
        `<!doctype html><html><head><style>p { color: red }</style></head><body></body></html>`,
      );
      expect([...document.styleSheets[0].cssRules].map((r: any) => r.selectorText)).toEqual(["p"]);
    });
  });

  describe("events", () => {
    it("runs capture, target and bubble listeners in order, with the right phase and currentTarget", () => {
      const { document, Event } = page(`<div id="outer"><div id="inner"></div></div>`);
      const outer = document.getElementById("outer"),
        inner = document.getElementById("inner");
      const log: unknown[] = [];
      const note = function (this: any, e: any) {
        log.push([this.id, e.eventPhase, e.currentTarget === this, e.target === inner]);
      };
      outer.addEventListener("x", note, true);
      inner.addEventListener("x", note);
      outer.addEventListener("x", note);
      expect(inner.dispatchEvent(new Event("x", { bubbles: true }))).toBe(true);
      expect(log).toEqual([
        ["outer", 1, true, true],
        ["inner", 2, true, true],
        ["outer", 3, true, true],
      ]);
    });

    it("clears the current target when dispatch is over", () => {
      const { document, Event } = page();
      const e = new Event("x");
      document.body.dispatchEvent(e);
      expect(e.currentTarget).toBe(null);
      expect(e.eventPhase).toBe(0);
    });

    it("gives a listener on the window its event", () => {
      const window = page();
      const seen: string[] = [];
      window.addEventListener("x", (e: any) => seen.push(e.type));
      window.document.body.dispatchEvent(new window.Event("x", { bubbles: true }));
      expect(seen).toEqual(["x"]);
    });

    it("fills a MouseEvent from its init, with defaults for the rest", () => {
      const { MouseEvent } = page();
      const e = new MouseEvent("click", { bubbles: true, clientX: 3 });
      expect([
        e.type,
        e.bubbles,
        e.cancelable,
        e.clientX,
        e.clientY,
        e.button,
        e.ctrlKey,
        e.relatedTarget,
      ]).toEqual(["click", true, false, 3, 0, 0, false, null]);
    });

    it("stops listeners on the same node after stopImmediatePropagation", () => {
      const { document, Event } = page();
      const log: number[] = [];
      document.body.addEventListener("x", (e: any) => {
        log.push(1);
        e.stopImmediatePropagation();
      });
      document.body.addEventListener("x", () => log.push(2));
      document.body.dispatchEvent(new Event("x"));
      expect(log).toEqual([1]);
    });
  });

  describe("things jsdom does not have", () => {
    it("has no getAnimations on elements, so a library takes its no-animation path", () => {
      const { document } = page();
      expect(typeof document.createElement("div").getAnimations).toBe("undefined");
    });
  });

  describe("forms", () => {
    it("reads a form's entries into FormData", () => {
      const window = page(
        `<form id="f"><input name="a" value="1"><input name="off" value="x" disabled><input type="checkbox" name="c" value="y" checked></form>`,
      );
      const data = new window.FormData(window.document.getElementById("f"));
      expect([...data.entries()]).toEqual([
        ["a", "1"],
        ["c", "y"],
      ]);
    });
  });

  describe("custom elements", () => {
    it("constructs a class of the host, with its methods and lifecycle, and instanceof holds", () => {
      const window = page();
      const log: string[] = [];
      class Host extends window.HTMLElement {
        static observedAttributes = ["v"];
        hello() {
          return "hi";
        }
        connectedCallback() {
          log.push("connected");
        }
        attributeChangedCallback(name: string, _old: string, value: string) {
          log.push(name + "=" + value);
        }
      }
      window.customElements.define("x-host", Host);
      const el = window.document.createElement("x-host");
      expect(el).toBeInstanceOf(Host);
      expect(el.hello()).toBe("hi");
      window.document.body.appendChild(el);
      el.setAttribute("v", "1");
      expect(log).toEqual(["connected", "v=1"]);
    });
  });

  describe("history", () => {
    it("goes back and fires popstate, asynchronously", async () => {
      const window = page();
      window.history.pushState({ n: 1 }, "", "/a");
      window.history.pushState({ n: 2 }, "", "/b");
      const states: unknown[] = [];
      const done = new Promise<void>((resolve) =>
        window.addEventListener("popstate", (e: any) => {
          states.push(e.state);
          resolve();
        }),
      );
      window.history.back();
      expect(window.location.pathname).toBe("/b");
      await done;
      expect(states).toEqual([{ n: 1 }]);
      expect(window.location.pathname).toBe("/a");
    });
  });

  describe("owners", () => {
    it("moves a node to the document that adopts it", () => {
      const { document } = page();
      const other = document.implementation.createHTMLDocument("other");
      const el = document.createElement("div");
      expect(el.ownerDocument).toBe(document);
      other.body.appendChild(el);
      expect(el.ownerDocument).toBe(other);
      document.adoptNode(el);
      expect(el.ownerDocument).toBe(document);
    });
  });
});

describe("the page's jobs with deferJobs (the vitest environment)", () => {
  it("delivers a MutationObserver one batch for all the host's synchronous changes", async () => {
    const dom = new JSDOM("<!doctype html><body></body>", { deferJobs: true } as never);
    open.push(dom as never);
    const { document, MutationObserver } = dom.window as any;
    const batches: number[] = [];
    new MutationObserver((records: unknown[]) => batches.push(records.length)).observe(
      document.body,
      { childList: true },
    );
    for (let i = 0; i < 5; i++) document.body.appendChild(document.createElement("p"));
    expect(batches).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(batches).toEqual([5]);
  });
});

describe("the engine timeout", () => {
  it("does not count the time the host spends between calls", async () => {
    const dom = new JSDOM("<!doctype html><body><p id='p' a='1'></p></body>", { engine: { timeout: 30 } } as never);
    open.push(dom as never);
    const window = dom.window as any;
    const p = window.document.getElementById("p");
    await new Promise((resolve) => setTimeout(resolve, 60));
    // reads only, none of them run page code of its own; QuickJS looks at the clock every so many operations
    for (let i = 0; i < 20000; i++) expect(p.getAttribute("x" + i)).toBe(null);
    expect(window.getComputedStyle(p).display).toBe("block");
  });

  it("still stops a page that runs too long", () => {
    const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "dangerously", engine: { timeout: 30 } } as never);
    open.push(dom as never);
    expect(() => (dom.window as any).eval("for (;;) {}")).toThrow(/interrupted/);
  });
});

describe("a host function the page calls with something a token cannot carry", () => {
  it("still gets it, and the nodes it was given stay usable", () => {
    const dom = new JSDOM("<!doctype html><body><p id='p'></p></body>", {
      runScripts: "dangerously",
    });
    open.push(dom as never);
    const window = dom.window as any;
    const seen: unknown[][] = [];
    window.hostFn = (...args: unknown[]) => {
      seen.push(args);
    };
    const p = window.document.getElementById("p");
    window.eval(`hostFn(document.getElementById("p"), [document.body, 1], { a: 2 })`);
    const [node, list] = seen[0] as [unknown, unknown[]];
    expect(node).toBe(p);
    expect((list[0] as any).tagName).toBe("BODY");
    expect(list[1]).toBe(1);
    expect((node as any).id).toBe("p");
  });
});
