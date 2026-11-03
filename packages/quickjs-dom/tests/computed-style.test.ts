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
