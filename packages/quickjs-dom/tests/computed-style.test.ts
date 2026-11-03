import { JSDOM as RealJSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "../src/jsdom.js";

// getComputedStyle and document.styleSheets of the page, read from the host, against jsdom.

const open: JSDOM[] = [];
const make = (html: string) => {
  const dom = new JSDOM(html, { virtualConsole: null });
  open.push(dom);
  return dom;
};
afterEach(() => {
  while (open.length) open.pop()!.close();
});

const PAGE = `<!doctype html><html><head><style>
  /* comment */
  body { color: blue; font-size: 20px }
  .card { display: flex; margin: 1px 2px; border: 2px solid red }
  #special.card { color: green !important }
  div p { color: purple }
  p.note { color: orange }
  p { text-align: center; padding: 3px }
  @media (min-width: 5000px) { p { color: pink } }
  @media (min-width: 1px) { .shown { opacity: 0.5 } }
  .hidden { display: none }
  @keyframes spin { from { opacity: 0 } to { opacity: 1 } }
  </style></head><body>
  <div class="card" id="special" style="color: red; z-index: 3"><p class="note">hi <span>there</span></p></div>
  <div class="hidden"><i id="inner">x</i></div>
  <p class="shown" hidden>h</p>
  <a href="#" id="link">l</a><b id="b">b</b><ul><li id="li">1</li></ul>
  </body></html>`;

const read = (window: any, id: string, props: string[]) => {
  const el = window.document.getElementById(id) ?? window.document.querySelector(id);
  const cs = window.getComputedStyle(el);
  return props.map((p) => cs.getPropertyValue(p));
};

describe("getComputedStyle", () => {
  const props = ["display", "color", "font-size", "margin-top", "margin-left", "border-top-width", "border-top-style", "text-align", "padding-left", "z-index", "opacity", "visibility"];
  it("cascades like jsdom for the properties a test asks about", () => {
    const ours = make(PAGE).window;
    const ref = new RealJSDOM(PAGE).window;
    for (const sel of ["#special", "p.note", "span", ".hidden", "#inner"]) {
      const a = read(ours, sel, props);
      const b = read(ref, sel, props);
      // jsdom has no UA sheet beyond a few defaults and computes fewer properties: compare what both answered
      a.forEach((v, i) => {
        // jsdom lets a style attribute beat an !important of a sheet; the specification does not (checked below)
        if (b[i] !== "" && !(sel === "#special" && props[i] === "color")) expect([sel, props[i], v]).toEqual([sel, props[i], b[i]]);
      });
    }
  });

  it("importance, specificity, inline style and order", () => {
    const { window } = make(PAGE);
    expect(read(window, "#special", ["color"])).toEqual(["rgb(0, 128, 0)"]); // !important in a sheet beats the style attribute
    expect(read(window, "p.note", ["color"])).toEqual(["rgb(255, 165, 0)"]); // .note p (0,2,0 -> 0,1,1) beats div p (0,0,2)
    expect(read(window, "#special", ["z-index"])).toEqual(["3"]); // from the style attribute
    expect(read(window, "#special", ["margin-top", "margin-right", "margin-bottom", "margin-left"])).toEqual(["1px", "2px", "1px", "2px"]);
    expect(window.getComputedStyle(window.document.querySelector("p.note")).margin).toBe("0px");
  });

  it("inherits what is inherited, and not the rest", () => {
    const { window } = make(PAGE);
    expect(read(window, "span", ["color", "font-size"])).toEqual(["rgb(255, 165, 0)", "20px"]);
    expect(read(window, "#inner", ["display", "color"])).toEqual(["inline", "rgb(0, 0, 255)"]); // display is not inherited
    expect(read(window, "span", ["border-top-width"])).toEqual(["0px"]);
  });

  it("media queries", () => {
    const { window } = make(PAGE);
    expect(read(window, "p.shown", ["opacity"])).toEqual(["0.5"]);
    expect(read(window, "p.note", ["color"])).not.toEqual(["rgb(255, 192, 203)"]);
  });

  it("the defaults of elements, hidden, and reads by camelCase name", () => {
    const { window } = make(PAGE);
    const cs = (id: string) => window.getComputedStyle(window.document.getElementById(id));
    expect(cs("b").fontWeight).toBe("bold");
    expect(cs("link").textDecorationLine).toBe("underline");
    expect(cs("li").display).toBe("list-item");
    expect(window.getComputedStyle(window.document.querySelector("p.shown")).display).toBe("none"); // the hidden attribute
    expect(window.getComputedStyle(window.document.head).display).toBe("none");
    expect(cs("special").borderTopColor).toBe("rgb(255, 0, 0)"); // border: 2px solid red
    window.document.getElementById("b").setAttribute("style", "border: 1px solid");
    expect(cs("b").borderTopColor).toBe("rgb(0, 0, 255)"); // currentcolor: the colour of the element (inherited from body)
  });

  it("is read-only, and answers for a node that is not an element with a TypeError", () => {
    const { window } = make(PAGE);
    const style = window.getComputedStyle(window.document.body);
    expect(() => style.setProperty("color", "red")).toThrow(/read-only/);
    expect(() => window.getComputedStyle(window.document)).toThrow(TypeError);
  });

  it("follows the page: a changed class or style shows in the next read", () => {
    const { window } = make(PAGE);
    const p = window.document.querySelector("p.note");
    expect(window.getComputedStyle(p).color).toBe("rgb(255, 165, 0)");
    p.className = "";
    expect(window.getComputedStyle(p).color).toBe("rgb(128, 0, 128)");
    p.style.color = "teal";
    expect(window.getComputedStyle(p).color).toBe("rgb(0, 128, 128)");
    window.document.querySelector("style").textContent = "p { color: navy }";
    p.removeAttribute("style");
    expect(window.getComputedStyle(p).color).toBe("rgb(0, 0, 128)");
  });
});

describe("document.styleSheets", () => {
  it("lists the <style> elements with their rules, and insertRule / deleteRule change them", () => {
    const { window } = make(PAGE);
    const sheets = window.document.styleSheets;
    expect(sheets.length).toBe(1);
    const rules = [...sheets[0].cssRules] as any[];
    expect(rules[0].selectorText).toBe("body");
    expect(rules[0].style.color).toBe("blue");
    expect(rules[1].selectorText).toBe(".card");
    expect(rules.some((r) => r.selectorText === "p.note")).toBe(true);
    sheets[0].insertRule(".added { color: lime }", 0);
    const el = window.document.createElement("div");
    el.className = "added";
    window.document.body.appendChild(el);
    expect(window.getComputedStyle(el).color).toBe("rgb(0, 255, 0)");
    sheets[0].deleteRule(0);
    expect(window.getComputedStyle(el).color).toBe("rgb(0, 0, 255)");
  });
});

describe("custom properties, units and calc()", () => {
  const CSS = `<!doctype html><html><head><style>
    :root { --gap: 4px; --main: #336699; --pair: 2px 6px; font-size: 20px }
    body { margin: 0 }
    .a { margin: var(--gap); color: var(--main); padding: var(--pair); width: var(--missing, 33px) }
    .b { --gap: 10px; margin-left: var(--gap); border: var(--gap) solid var(--main) }
    .c { font-size: 1.5em; margin-top: 2em; height: calc(2rem + 10px); width: calc(100% - 10px); line-height: 1.5em }
    .d { margin-top: calc(1in / 2); padding-top: min(10px, 2em); padding-left: max(1px, 3pt); padding-right: clamp(1px, 100px, 5px) }
    .e { color: var(--undefined); margin-top: 7px }
    h2 { }
  </style></head><body>
    <div class="a" id="a"><span class="b" id="b"></span></div>
    <div class="c" id="c"><span id="inner" style="font-size: 50%; margin-top: 2em"></span></div>
    <div class="d" id="d"></div><div class="e" id="e"></div><h2 id="h2"></h2>
  </body></html>`;
  const style = (id: string) => {
    const { window } = make(CSS);
    return window.getComputedStyle(window.document.getElementById(id));
  };

  it("substitutes var() with inheritance, fallbacks and shorthands", () => {
    const a = style("a");
    expect(a.getPropertyValue("--gap")).toBe("4px");
    expect([a.marginTop, a.marginLeft]).toEqual(["4px", "4px"]);
    expect(a.color).toBe("rgb(51, 102, 153)");
    expect([a.paddingTop, a.paddingRight]).toEqual(["2px", "6px"]);
    expect(a.width).toBe("33px");
    const b = style("b");
    expect(b.getPropertyValue("--gap")).toBe("10px"); // redefined at .b
    expect(b.marginLeft).toBe("10px");
    expect(b.borderTopWidth).toBe("10px");
    expect(b.borderTopColor).toBe("rgb(51, 102, 153)"); // --main is inherited
  });

  it("an undefined variable without a fallback leaves the declaration out", () => {
    const e = style("e");
    expect(e.color).toBe("rgb(0, 0, 0)");
    expect(e.marginTop).toBe("7px");
  });

  it("computes lengths in px", () => {
    const c = style("c");
    expect(c.fontSize).toBe("30px"); // 1.5em of the 20px of :root
    expect(c.marginTop).toBe("60px"); // 2em of its own font size
    expect(c.height).toBe("50px"); // calc(2rem + 10px), rem = 20px
    expect(c.width).toBe("calc(100% - 10px)"); // a percentage needs a layout
    expect(c.lineHeight).toBe("45px");
    expect(style("inner").fontSize).toBe("15px");
    expect(style("inner").marginTop).toBe("30px"); // em of the element's own computed size
    const d = style("d");
    expect(d.marginTop).toBe("48px");
    expect(d.paddingTop).toBe("10px");
    expect(d.paddingLeft).toBe("4px");
    expect(d.paddingRight).toBe("5px");
    expect(style("h2").fontSize).toBe("30px"); // 1.5em of 20px
  });
});

describe("<link rel=stylesheet>", () => {
  it("is cascaded once the sheets are fetched (resources: usable)", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "text/css");
      res.end(req.url === "/a.css" ? "p { color: red; margin-top: calc(1px + 2px) } @media (min-width: 1px) { .x { display: flex } }" : "");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    try {
      const html = `<!doctype html><html><head><link rel="stylesheet" href="/a.css"><style>p { color: blue }</style></head><body><p id=p class=x>t</p></body></html>`;
      const dom = new JSDOM(html, { url: `http://127.0.0.1:${port}/`, resources: "usable", virtualConsole: null });
      open.push(dom);
      await dom.ready;
      const p = dom.window.document.getElementById("p");
      // the later <style> beats the link by order; the margin comes only from the link
      expect(dom.window.getComputedStyle(p).color).toBe("rgb(0, 0, 255)");
      expect(dom.window.getComputedStyle(p).marginTop).toBe("3px");
      expect(dom.window.getComputedStyle(p).display).toBe("flex");
      const plain = make(html.replace("<link", "<link data-x"));
      expect(plain.window.getComputedStyle(plain.window.document.getElementById("p")).marginTop).toBe("0px");
    } finally {
      server.close();
    }
  });
});
