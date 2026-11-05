import { afterAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

// The pseudo-classes that depend on what the user did (:focus, :focus-within, :hover, :active, :target), the hashchange that
// moves :target, window.innerHeight and the Window interface.

const html = `<!doctype html><html><head><style>
a{color:#000} a:hover{color:#f00} a:active{color:#00f}
#t:target{color:#0f0}
</style></head><body><div id="w"><input id="i"><a id="a" href="#t">x</a></div><p id="t">target</p><p id="u">other</p></body></html>`;

const open: QuickJSDOM[] = [];
const page = async (options: Record<string, unknown> = {}, baseUrl = "http://x.test/") => {
  const dom = await createDOM({ html, baseUrl }, { settleMs: 0, ...options });
  open.push(dom);
  return dom;
};
afterAll(() => open.forEach((d) => d.close()));

describe("interaction state in selectors", () => {
  it(":focus and :focus-within follow focus() and blur()", async () => {
    const dom = await page();
    const has = (s: string) => dom.eval(`!!document.querySelector(${JSON.stringify(s)})`);
    expect([await has("input:focus"), await has("#w:focus-within")]).toEqual([false, false]);
    await dom.eval(`document.getElementById("i").focus()`);
    expect([await has("input:focus"), await has("#w:focus-within"), await has("p:focus-within")]).toEqual([true, true, false]);
    expect(await dom.eval(`document.getElementById("i").matches(":focus")`)).toBe(true);
    await dom.eval(`document.getElementById("i").blur()`);
    expect([await has("input:focus"), await has("#w:focus-within")]).toEqual([false, false]);
  });

  it(":focus does not match a focused element that left the document", async () => {
    const dom = await page();
    await dom.eval(`document.getElementById("i").focus(); document.getElementById("i").remove()`);
    expect(await dom.eval(`!!document.querySelector(":focus")`)).toBe(false);
  });

  it(":hover and :active follow the pointer events, in selectors and in getComputedStyle", async () => {
    const dom = await page();
    const color = () => dom.eval(`getComputedStyle(document.getElementById("a")).color`);
    const fire = (type: string) => dom.eval(`document.getElementById("a").dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: true }))`);
    expect(await color()).toBe("rgb(0, 0, 0)");
    await fire("mouseover");
    expect(await color()).toBe("rgb(255, 0, 0)");
    expect(await dom.eval(`!!document.querySelector("#w:hover")`)).toBe(true); // an ancestor of the hovered element
    await fire("mousedown");
    expect(await dom.eval(`document.getElementById("a").matches("a:active")`)).toBe(true);
    await fire("mouseup");
    expect(await dom.eval(`document.getElementById("a").matches("a:active")`)).toBe(false);
    await fire("mouseout");
    expect(await color()).toBe("rgb(0, 0, 0)");
  });

  it(":target follows the URL hash, and location.hash = fires hashchange once (history.pushState does not)", async () => {
    const dom = await page({}, "http://x.test/p?q=1#t");
    expect(await dom.eval(`getComputedStyle(document.getElementById("t")).color`)).toBe("rgb(0, 255, 0)");
    await dom.eval(`globalThis.__log = []; addEventListener("hashchange", (e) => __log.push(e.oldURL + " -> " + e.newURL)); location.hash = "u"`);
    await dom.settle(30);
    expect(await dom.eval(`document.querySelector(":target").id`)).toBe("u");
    expect(await dom.eval(`__log`)).toEqual(["http://x.test/p?q=1#t -> http://x.test/p?q=1#u"]);
    await dom.eval(`history.pushState(null, "", "#t")`);
    await dom.settle(30);
    expect(await dom.eval(`__log.length`)).toBe(1);
    expect(await dom.eval(`location.href`)).toBe("http://x.test/p?q=1#t");
    await dom.eval(`location.hash = ""`);
    await dom.settle(30);
    expect(await dom.eval(`document.querySelector(":target")`)).toBe(null);
  });
});

describe("window", () => {
  it("innerHeight takes the height option and defaults to three quarters of the width", async () => {
    const a = await page({ width: 640, height: 480 });
    expect(await a.eval(`[innerWidth, innerHeight, screen.height]`)).toEqual([640, 480, 480]);
    const b = await page({ width: 800 });
    expect(await b.eval(`innerHeight`)).toBe(600);
  });

  it("window instanceof Window; other things are not", async () => {
    const dom = await page();
    expect(await dom.eval(`[window instanceof Window, document instanceof Window, ({}) instanceof Window, typeof Window]`)).toEqual([true, false, false, "function"]);
    expect(await dom.eval(`try { new Window(); "no error" } catch (e) { e.name }`)).toBe("TypeError");
  });
});
