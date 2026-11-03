import { JSDOM as RealJSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "../src/jsdom.js";

// SVG elements: their interfaces, animated attributes and geometry, from the host and (where jsdom has it) against jsdom.

const HTML = `<body><svg id=s width="100" height="50" viewBox="0 0 10 5" class="icon big">
  <defs><linearGradient id=lg></linearGradient></defs>
  <g id=g><rect id=r x="1" y="2" width="3" height="4"/><circle id=c cx="5" cy="5" r="2"/>
  <path id=p d="M0 0 L3 4 H6 v-4 z"/><polyline id=pl points="0,0 3,4"/></g><use id=u href="#r"/><text id=t x="7">hi</text></svg></body>`;

const open: JSDOM[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});
const make = () => {
  const dom = new JSDOM(HTML, { virtualConsole: null });
  open.push(dom);
  return dom.window as any;
};

describe("svg", () => {
  it("answers the same as jsdom for what jsdom implements", () => {
    const ours = make();
    const ref = new RealJSDOM(HTML).window as any;
    const probe = (w: any) => {
      const d = w.document;
      const s = d.getElementById("s"), r = d.getElementById("r");
      return [
        s.constructor.name, s instanceof w.SVGElement, s instanceof w.SVGSVGElement, r instanceof w.SVGSVGElement,
        s.className.baseVal, s.className.animVal, r.ownerSVGElement === s, r.viewportElement === s, s.ownerSVGElement,
        s.getAttribute("viewBox"),
      ];
    };
    // jsdom implements only part of the SVG interfaces (no SVGGraphicsElement, no animated lengths)
    expect(probe(ours)).toEqual(probe(ref));
  });

  it("a rect is not a circle, and an a / script / title inside svg stays what HTML says", () => {
    const w = make();
    const d = w.document;
    expect(d.getElementById("r") instanceof w.SVGRectElement).toBe(true);
    expect(d.getElementById("r") instanceof w.SVGCircleElement).toBe(false);
    expect(d.getElementById("c") instanceof w.SVGGeometryElement).toBe(true);
    expect(d.getElementById("lg") instanceof w.SVGElement).toBe(true);
    expect(d.getElementById("lg") instanceof w.SVGGeometryElement).toBe(false);
    expect(d.createElement("div") instanceof w.SVGElement).toBe(false);
  });

  it("className.baseVal writes the class attribute, and href reads href or xlink:href", () => {
    const w = make();
    const d = w.document;
    const s = d.getElementById("s");
    s.className.baseVal = "other";
    expect(s.getAttribute("class")).toBe("other");
    expect(d.getElementById("u").href.baseVal).toBe("#r");
    d.getElementById("u").removeAttribute("href");
    d.getElementById("u").setAttribute("xlink:href", "#c");
    expect(d.getElementById("u").href.baseVal).toBe("#c");
  });

  it("lengths convert their units, and viewBox is a rectangle", () => {
    const w = make();
    const d = w.document;
    const s = d.getElementById("s");
    expect(s.viewBox.baseVal.width).toBe(10);
    s.setAttribute("width", "1in");
    expect(s.width.baseVal.value).toBe(96);
    expect(s.width.baseVal.unitType).toBe(8);
    s.width.baseVal.value = 42;
    expect(s.getAttribute("width")).toBe("42");
  });

  it("geometry from the attributes: getBBox, getTotalLength, getPointAtLength", () => {
    const w = make();
    const d = w.document;
    const box = d.getElementById("r").getBBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([1, 2, 3, 4]);
    const c = d.getElementById("c").getBBox();
    expect([c.x, c.y, c.width, c.height].map((n: number) => Math.round(n))).toEqual([3, 3, 4, 4]);
    expect(d.getElementById("c").getTotalLength()).toBeCloseTo(4 * Math.PI, 5);
    // M0 0 L3 4 (5) H6 (3) v-4 (4) z (back to 0,0: 6)
    expect(d.getElementById("p").getTotalLength()).toBeCloseTo(5 + 3 + 4 + 6, 5);
    expect(d.getElementById("pl").getTotalLength()).toBeCloseTo(5, 5);
    const mid = d.getElementById("pl").getPointAtLength(2.5);
    expect([mid.x, mid.y]).toEqual([1.5, 2]);
    const g = d.getElementById("g").getBBox();
    expect(g.width).toBeGreaterThan(0);
    expect(d.getElementById("s").createSVGPoint().x).toBe(0);
    expect(d.getElementById("r").getCTM().a).toBe(1);
  });

  it("computes the SVG presentation properties", () => {
    const w = make();
    const d = w.document;
    d.getElementById("g").setAttribute("style", "fill: red; stroke: blue; stroke-width: 2px");
    const cs = w.getComputedStyle(d.getElementById("r"));
    expect([cs.fill, cs.stroke, cs.strokeWidth]).toEqual(["rgb(255, 0, 0)", "rgb(0, 0, 255)", "2px"]); // inherited
    expect(w.getComputedStyle(d.getElementById("s")).display).toBe("inline");
  });
});
