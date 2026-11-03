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

  it("exposes DOMTokenList for classList", () => {
    const a = w.document.getElementById("a");
    expect(typeof w.DOMTokenList).toBe("function");
    expect(a.classList instanceof w.DOMTokenList).toBe(true);
    expect(a.classList.constructor.name).toBe("DOMTokenList");
    expect(() => new w.DOMTokenList()).toThrow(TypeError);
  });

  it("gives the table, legacy and SVG elements their interfaces, and iterators theirs", async () => {
    const out = await dom.eval(`(() => {
      const d = document.implementation.createHTMLDocument("");
      d.body.innerHTML = "<table><caption>c</caption><colgroup><col></colgroup><thead><tr><td>x</td></tr></thead></table><frameset></frameset><marquee>m</marquee><dir></dir>";
      const q = (s) => d.querySelector(s);
      const it = d.createNodeIterator(d.body, 0xFFFFFFFF);
      const tw = d.createTreeWalker(d.body, 0xFFFFFFFF);
      const svg = d.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.innerHTML = "<title>t</title><switch></switch>";
      return JSON.stringify([
        q("caption") instanceof HTMLTableCaptionElement, q("col") instanceof HTMLTableColElement, q("colgroup") instanceof HTMLTableColElement,
        q("thead") instanceof HTMLTableSectionElement, q("frameset") instanceof HTMLFrameSetElement, q("marquee") instanceof HTMLMarqueeElement, q("dir") instanceof HTMLDirectoryElement,
        typeof HTMLFrameElement, it instanceof NodeIterator, tw instanceof TreeWalker, it.nextNode() === d.body,
        svg.firstChild instanceof SVGTitleElement, svg.lastChild instanceof SVGSwitchElement,
        d.createElement("title") instanceof SVGTitleElement,
        q("thead").rows.length, q("thead").rows[0].tagName, typeof q("caption").webkitMatchesSelector, q("caption").translate,
        q("col").span, it.pointerBeforeReferenceNode,
      ]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        true, true, true,
        true, true, true, true,
        "function", true, true, true,
        true, true,
        false,
        1, "TR", "function", false,
        1, false,
      ]),
    );
  });

  it("constructs the remaining event classes and the XHR family", async () => {
    const out = await dom.eval(`(() => {
      const ce = new CloseEvent("close", { wasClean: true, code: 1000, reason: "bye" });
      const pre = new PromiseRejectionEvent("unhandledrejection", { promise: Promise.resolve(1), reason: "r" });
      const dm = new DeviceMotionEvent("devicemotion", { interval: 16 });
      const xhr = new XMLHttpRequest();
      const qe = new QuotaExceededError("full");
      return JSON.stringify([
        ce.type, ce.wasClean, ce.code, ce.reason, ce instanceof Event,
        pre.reason, pre.promise instanceof Promise, pre instanceof Event,
        dm.interval, dm.acceleration, new BlobEvent("blob", { data: null }).type,
        typeof BeforeUnloadEvent, typeof DeviceOrientationEvent, typeof DeviceMotionEventAcceleration, typeof DeviceMotionEventRotationRate,
        xhr instanceof XMLHttpRequestEventTarget, xhr instanceof EventTarget, xhr.upload instanceof XMLHttpRequestUpload, xhr.upload instanceof XMLHttpRequestEventTarget,
        qe.name, qe.code, qe instanceof DOMException, typeof QuotaExceededError,
      ]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        "close", true, 1000, "bye", true,
        "r", true, true,
        16, null, "blob",
        "function", "function", "function", "function",
        true, true, true, true,
        "QuotaExceededError", 22, true, "function",
      ]),
    );
  });

  it("constructs Option and Audio, and names the document and range classes", async () => {
    const out = await dom.eval(`(() => {
      const opt = new Option("hi", "v", false, true);
      const aud = new Audio("x.mp3");
      const img = new Image();
      const xd = document.implementation.createDocument(null, "root", null);
      const xp = new DOMParser().parseFromString("<root/>", "text/xml");
      const r = document.createRange();
      const sr = new StaticRange({ startContainer: document.body, startOffset: 0, endContainer: document.body, endOffset: 0 });
      return JSON.stringify([
        opt.tagName, opt.textContent, opt.value, opt.selected, opt instanceof Option, opt instanceof HTMLOptionElement,
        aud.tagName, aud.getAttribute("src"), aud instanceof Audio, img instanceof Image,
        xd instanceof XMLDocument, xd.contentType, xp instanceof XMLDocument,
        typeof CDATASection, typeof ProcessingInstruction, typeof CustomElementRegistry,
        customElements instanceof CustomElementRegistry, customElements.constructor.name,
        r instanceof AbstractRange, sr instanceof StaticRange, sr instanceof AbstractRange, sr.collapsed, sr.startContainer === document.body,
        typeof XMLDocument,
      ]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        "OPTION", "hi", "v", true, true, true,
        "AUDIO", "x.mp3", true, true,
        true, "application/xml", true,
        "function", "function", "function",
        true, "CustomElementRegistry",
        true, true, true, true, true,
        "function",
      ]),
    );
  });

  it("answers the window's own functions", async () => {
    const out = await dom.eval(`(async () => {
      const got = [];
      window.addEventListener("message", (e) => got.push([e.data, e.origin, e instanceof MessageEvent]));
      const sync = [
        typeof alert, typeof confirm, typeof prompt, typeof focus, typeof blur, typeof print, typeof stop, typeof open,
        confirm(), prompt(), open(), webkitURL === URL, crypto instanceof Crypto, typeof Crypto,
      ];
      window.postMessage({ a: 1 });
      await new Promise((r) => setTimeout(r, 20));
      return JSON.stringify([sync, got]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        ["function", "function", "function", "function", "function", "function", "function", "function", false, null, null, true, true, "function"],
        [[{ a: 1 }, "", true]],
      ]),
    );
  });

  it("answers the Document members jsdom answers", async () => {
    const out = await dom.eval(`(() => {
      const d = document;
      const before = [d.URL, d.documentURI, d.contentType, d.compatMode, d.characterSet, d.charset, d.inputEncoding,
        d.referrer, d.readyState, d.hidden, d.visibilityState, d.currentScript, d.hasFocus(), d.dir,
        d.forms.length, d.images.length, d.scripts.length, d.links.length, d.anchors.length, d.embeds.length, d.plugins.length, d.applets.length,
        typeof d.open, typeof d.write, typeof d.captureEvents, d.getElementsByName("n").length, typeof d.onvisibilitychange];
      const at = d.createAttributeNS("http://ns", "p:q");
      let cdata = "no throw";
      try { d.createCDATASection("x"); } catch (e) { cdata = e.name; }
      const ev = d.createEvent("MouseEvents"); ev.initEvent("click", true, false);
      const parsed = new DOMParser().parseFromString("<p>y</p>", "text/html");
      parsed.cookie = "a=1"; parsed.cookie = "b=2";
      return JSON.stringify([before, at.name, at.localName, at.prefix, at.namespaceURI, cdata, ev.type, ev instanceof MouseEvent, parsed.cookie, parsed.contentType, parsed.URL]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        ["about:blank", "about:blank", "text/html", "CSS1Compat", "UTF-8", "UTF-8", "UTF-8",
          "", "complete", true, "prerender", null, false, "",
          0, 0, 0, 0, 0, 0, 0, 0,
          "function", "function", "function", 0, "object"],
        "p:q", "q", "p", "http://ns", "NotSupportedError", "click", true, "a=1; b=2", "text/html", "about:blank",
      ]),
    );
  });

  it("makes el.style and computed styles instances of the one CSSStyleDeclaration", async () => {
    const out = await dom.eval(`(() => {
      const el = document.getElementById("a");
      el.style.color = "red";
      const cs = getComputedStyle(el);
      const proto = CSSStyleDeclaration.prototype;
      return JSON.stringify([
        typeof CSSStyleDeclaration, el.style instanceof CSSStyleDeclaration, cs instanceof CSSStyleDeclaration,
        el.style.constructor.name, el.style.getPropertyValue("color"), cs.getPropertyValue("color"),
        typeof proto.getPropertyValue, typeof proto.setProperty, typeof proto.removeProperty, typeof proto.getPropertyPriority, typeof proto.item,
        "cssText" in proto, "length" in proto, el.style.parentRule, cs.parentRule,
      ]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        "function", true, true,
        "CSSStyleDeclaration", "red", "rgb(255, 0, 0)",
        "function", "function", "function", "function", "function",
        true, true, null, null,
      ]),
    );
  });

  it("gives the window its on* handler properties", async () => {
    const out = await dom.eval(`(() => {
      const seen = [];
      const names = [];
      let o = window;
      while (o) { for (const k of Object.getOwnPropertyNames(o)) if (/^on./.test(k) && !names.includes(k)) names.push(k); o = Object.getPrototypeOf(o); }
      const before = [window.onclick, window.onload];
      window.onclick = (e) => seen.push("win:" + e.target.id);
      document.getElementById("a").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const mid = [typeof window.onclick, seen.join(",")];
      window.onclick = null;
      return JSON.stringify([names.length, before, mid, window.onclick, typeof window.onbeforeunload, typeof window.onmessage]);
    })()`);
    expect(out).toBe(JSON.stringify([118, [null, null], ["function", "win:a"], null, "object", "object"]));
  });

  it("reflects the aria* properties onto their attributes", async () => {
    const out = await dom.eval(`(() => {
      const el = document.getElementById("a");
      const before = [el.ariaLabel, el.ariaBusy, el.ariaValueNow];
      el.ariaBusy = "true"; el.ariaValueNow = "5"; el.ariaColIndexText = "x";
      const mid = [el.getAttribute("aria-busy"), el.getAttribute("aria-valuenow"), el.getAttribute("aria-colindextext")];
      el.ariaBusy = null;
      const names = [];
      let o = el;
      while (o) { for (const k of Object.getOwnPropertyNames(o)) if (/^aria[A-Z]/.test(k) && !names.includes(k)) names.push(k); o = Object.getPrototypeOf(o); }
      return JSON.stringify([before, mid, el.ariaBusy, el.hasAttribute("aria-busy"), names.length]);
    })()`);
    expect(out).toBe(JSON.stringify([[null, null, null], ["true", "5", "x"], null, false, 41]));
  });

  it("answers the legacy constants, splitText and the namespace lookups", async () => {
    const out = await dom.eval(`(() => {
      const host = document.createElement("div");
      host.innerHTML = "<b>1</b>mid<i>2</i>";
      const text = host.childNodes[1];
      const rest = text.splitText(1);
      const p = document.getElementById("a");
      p.setAttribute("data-z", "9");
      return JSON.stringify([
        Node.ATTRIBUTE_NODE, Node.CDATA_SECTION_NODE, Node.ENTITY_REFERENCE_NODE, Node.ENTITY_NODE, Node.PROCESSING_INSTRUCTION_NODE, Node.NOTATION_NODE,
        host.ATTRIBUTE_NODE, host.ENTITY_NODE,
        text.data, rest.data, host.textContent, rest.wholeText, text.assignedSlot,
        text.previousElementSibling.tagName, text.nextElementSibling.tagName,
        document.getElementsByTagNameNS("*", "b").length, host.getElementsByTagNameNS("", "i").length,
        p.attributes.getNamedItemNS("", "data-z").value, p.attributes.getNamedItemNS("", "nope"),
      ]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        2, 4, 5, 6, 7, 12,
        2, 6,
        "m", "id", "1mid2", "mid", null,
        "B", "I",
        1, 1,
        "9", null,
      ]),
    );
  });

  it("exposes BarProp, External and the window's scalar properties", async () => {
    const out = await dom.eval(`JSON.stringify([
      typeof BarProp, typeof External,
      locationbar instanceof BarProp, menubar instanceof BarProp, toolbar.visible, scrollbars.visible,
      external instanceof External, external.constructor.name,
      pageXOffset, scrollX, pageYOffset, scrollY, screenX, screenLeft, screenY, screenTop,
      name, status, origin === location.origin, frameElement, length, "event" in window,
    ])`);
    expect(out).toBe(
      JSON.stringify([
        "function", "function",
        true, true, true, true,
        true, "External",
        0, 0, 0, 0, 0, 0, 0, 0,
        "", "", true, null, 0, true,
      ]),
    );
  });

  it("exposes DOMImplementation and HTMLDocument", async () => {
    const out = await dom.eval(`(() => {
      const impl = document.implementation;
      const dt = impl.createDocumentType("html", "-//X//EN", "sys");
      const hd = impl.createHTMLDocument("T");
      const xd = impl.createDocument(null, "root", null);
      const parsed = new DOMParser().parseFromString("<p>y</p>", "text/html");
      return JSON.stringify([
        typeof DOMImplementation, impl instanceof DOMImplementation, impl.constructor.name, document.implementation === impl,
        impl.hasFeature("HTML", "1.0"),
        dt.nodeType, dt instanceof DocumentType, dt.name, dt.publicId, dt.systemId,
        hd instanceof HTMLDocument, hd instanceof Document, hd.constructor.name, hd.title, hd.body.tagName,
        xd.documentElement.tagName, xd instanceof HTMLDocument,
        document instanceof HTMLDocument, document.constructor.name,
        parsed instanceof HTMLDocument,
        (() => { try { new DOMImplementation(); return "no error"; } catch (e) { return e.name; } })(),
      ]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        "function", true, "DOMImplementation", true,
        true,
        10, true, "html", "-//X//EN", "sys",
        true, true, "HTMLDocument", "T", "BODY",
        "ROOT", false, // the root's tag is uppercased like an HTML element's; jsdom says "root" (recorded in the ledger)
        true, "HTMLDocument",
        true,
        "TypeError",
      ]),
    );
  });

  it("exposes RadioNodeList for a radio group", async () => {
    const out = await dom.eval(`(() => {
      const f = document.createElement("form");
      f.innerHTML = '<input type=radio name=r value=a><input type=radio name=r value=b checked><input type=text name=t value=x>';
      document.body.appendChild(f);
      const list = f.elements.namedItem("r");
      const viaProp = f.elements.r;
      const single = f.elements.namedItem("t");
      const ans = [
        typeof RadioNodeList, list instanceof RadioNodeList, list instanceof NodeList, list.constructor.name,
        list.length, list.value, viaProp === list || viaProp instanceof RadioNodeList, single === f.querySelector("input[type=text]"),
      ];
      list.value = "a";
      ans.push(list.value, f.querySelectorAll("input")[0].checked);
      list.value = "";
      ans.push(list.value);
      f.remove();
      return JSON.stringify(ans);
    })()`);
    expect(out).toBe(JSON.stringify(["function", true, true, "RadioNodeList", 2, "b", true, true, "a", true, ""]));
  });

  it("exposes FileList for input.files", async () => {
    const out = await dom.eval(`(() => {
      const f = document.createElement("input"); f.type = "file";
      const t = document.createElement("input");
      return JSON.stringify([
        typeof FileList, f.files instanceof FileList, f.files.constructor.name, f.files.length,
        f.files.item(0), [...f.files].length, f.files === f.files, t.files,
        (() => { try { new FileList(); return "no error"; } catch (e) { return e.name; } })(),
      ]);
    })()`);
    expect(out).toBe(JSON.stringify(["function", true, "FileList", 0, null, 0, true, null, "TypeError"]));
  });

  it("exposes StyleSheet, MediaList and StyleSheetList for the sheets", async () => {
    const out = await dom.eval(`(() => {
      const st = document.createElement("style");
      st.setAttribute("media", "screen and (min-width: 100px), print");
      st.textContent = "p { color: red }";
      document.head.appendChild(st);
      const sheets = document.styleSheets;
      const sheet = sheets[sheets.length - 1];
      const m = sheet.media;
      const before = [m.length, m.item(0), m.item(1), m.item(2), m[0], String(m)];
      m.appendMedium("tv"); m.deleteMedium("print");
      return JSON.stringify([
        typeof StyleSheet, typeof MediaList, typeof StyleSheetList,
        sheets instanceof StyleSheetList, sheets.item(sheets.length - 1) === sheet, [...sheets].length === sheets.length,
        sheet instanceof CSSStyleSheet, sheet instanceof StyleSheet, sheet.constructor.name,
        st.sheet === sheet, m instanceof MediaList, m.constructor.name, before,
        m.mediaText, m.length,
        (() => { try { new StyleSheet(); return "no error"; } catch (e) { return e.name; } })(),
      ]);
    })()`);
    expect(out).toBe(
      JSON.stringify([
        "function", "function", "function",
        true, true, true,
        true, true, "CSSStyleSheet",
        true, true, "MediaList", [2, "screen and (min-width: 100px)", "print", null, "screen and (min-width: 100px)", "screen and (min-width: 100px), print"],
        "screen and (min-width: 100px), tv", 2,
        "TypeError",
      ]),
    );
  });

  it("exposes Location for the location", async () => {
    expect(
      await dom.eval(`JSON.stringify([
        typeof Location, location instanceof Location, location instanceof URL, location.constructor.name,
        location.pathname, (() => { try { new Location(); return "no error"; } catch (e) { return e.name; } })(),
      ])`),
    ).toBe(JSON.stringify(["function", true, true, "Location", "blank", "TypeError"]));
  });

  it("exposes DOMStringMap for dataset", async () => {
    expect(typeof w.DOMStringMap).toBe("function");
    expect(
      await dom.eval(`(() => {
        const el = document.getElementById("a");
        const out = [el.dataset instanceof DOMStringMap, el.dataset.constructor.name, el.dataset.x];
        el.setAttribute("data-constructor", "zzz");
        out.push(el.dataset.constructor);
        el.removeAttribute("data-constructor");
        out.push(typeof el.dataset.constructor);
        return JSON.stringify(out);
      })()`),
    ).toBe(JSON.stringify([true, "DOMStringMap", undefined, "zzz", "function"]));
  });

  it("exposes History, Navigator, Screen and Performance for the window singletons", async () => {
    expect(typeof w.History).toBe("function");
    expect(typeof w.Navigator).toBe("function");
    expect(typeof w.Screen).toBe("function");
    expect(typeof w.Performance).toBe("function");
    // in the page the singletons are instances of their interfaces (the bridge's host wrappers
    // for non-node objects do not carry the page's prototypes, so this is checked in the page)
    expect(
      await dom.eval(`JSON.stringify([
        history instanceof History, navigator instanceof Navigator, screen instanceof Screen, performance instanceof Performance,
        history.constructor.name, navigator.constructor.name, screen.constructor.name, performance.constructor.name,
        (() => { try { new History(); return "no error"; } catch (e) { return e.name; } })(),
      ])`),
    ).toBe(JSON.stringify([true, true, true, true, "History", "Navigator", "Screen", "Performance", "TypeError"]));
    // the singletons still behave: pushState moves the location and grows the history
    const before = w.history.length;
    w.history.pushState({ a: 1 }, "", "/there");
    expect(w.history.state).toEqual({ a: 1 });
    expect(w.history.length).toBe(before + 1);
    expect(w.location.pathname).toBe("/there");
  });

  it("exposes MutationRecord for mutation records", async () => {
    const out = await dom.eval(`new Promise((res) => {
      const mo = new MutationObserver((rs) => res([typeof MutationRecord, rs[0] instanceof MutationRecord, rs[0].constructor.name, (() => { try { new MutationRecord(); return "no error"; } catch (e) { return e.name; } })()]));
      mo.observe(document.body, { childList: true });
      document.body.appendChild(document.createElement("i"));
    })`);
    expect(out).toEqual(["function", true, "MutationRecord", "TypeError"]);
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
