import { afterEach, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

let dom: QuickJSDOM | undefined;
afterEach(() => {
  dom?.close();
  dom = undefined;
});
const open = async (html: string) => {
  dom = await createDOM({ html }, { settleMs: 0 });
  return dom.bridge().window as any;
};

describe("a listener of the host called by the page", () => {
  it("gets the event of the page as an object of its class", async () => {
    const w = await open("<body><div id=a><button id=b>x</button></div>");
    const b = w.document.getElementById("b");
    const seen: any[] = [];
    b.addEventListener("click", function (this: any, e: any) {
      seen.push([e instanceof w.MouseEvent, e instanceof w.Event, e.constructor.name, this === b, e.target === b, e.type, e.clientX]);
    });
    await dom!.eval(`document.getElementById("b").dispatchEvent(new MouseEvent("click", { clientX: 7 }))`);
    await dom!.eval(`document.getElementById("b").click()`);
    expect(seen).toEqual([
      [true, true, "MouseEvent", true, true, "click", 7],
      [true, true, "MouseEvent", true, true, "click", 0],
    ]);
  });

  it("gets the same wrapper for an object it has seen, and values of other kinds as before", async () => {
    const w = await open("<body><p id=p>x</p>");
    const p = w.document.getElementById("p");
    const calls: unknown[][] = [];
    p.addEventListener("go", (...args: unknown[]) => calls.push(args));
    await dom!.eval(`var p = document.getElementById("p"); var e = new CustomEvent("go", { detail: [1, 2] });
      p.dispatchEvent(e); p.dispatchEvent(e);`);
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toBe(calls[1][0]); // one event, one wrapper
    expect((calls[0][0] as any).detail).toEqual([1, 2]);
  });

  it("passes plain values, arrays and dates through the JSON form when the callback is a plain function of the page's", async () => {
    const w = await open("<body></body>");
    const got: unknown[] = [];
    w.__hostFn = (...a: unknown[]) => { got.push(a); return a.length; };
    const r = await dom!.eval(`__hostFn(1, "s", true, null, undefined, [1, 2], { a: 1 }, new Date(0)) + __hostFn(document.body)`);
    expect(r).toBe(9);
    expect((got[0] as unknown[]).slice(0, 5)).toEqual([1, "s", true, null, undefined]);
    expect((got[0] as unknown[])[5]).toEqual([1, 2]);
    expect((got[0] as unknown[])[6]).toEqual({ a: 1 });
    expect(((got[0] as unknown[])[7] as Date).getTime()).toBe(0);
    expect((got[1] as any[])[0]).toBe(w.document.body);
  });
});

describe("dispatch skips the nodes that listen for nothing", () => {
  it("still runs capture, target and bubble listeners in order, and on<type> handlers", async () => {
    const w = await open("<body><div id=a><section id=s><button id=b>x</button></section></div>");
    const order: string[] = [];
    const d = w.document;
    d.getElementById("a").addEventListener("click", () => order.push("a-capture"), true);
    d.getElementById("a").addEventListener("click", () => order.push("a-bubble"));
    d.getElementById("s").onclick = () => order.push("s-handler");
    d.getElementById("b").addEventListener("click", () => order.push("b"));
    d.body.addEventListener("click", () => order.push("body"));
    w.addEventListener("click", () => order.push("window"));
    d.getElementById("b").dispatchEvent(new w.Event("click", { bubbles: true }));
    expect(order).toEqual(["a-capture", "b", "s-handler", "a-bubble", "body", "window"]);
  });

  it("keeps a handler of an object that is not a node (an own on<type> property)", async () => {
    await open("<body></body>");
    const r = await dom!.eval(`(function () {
      var t = new EventTarget(), hit = 0;
      t.onping = function () { hit++; };
      t.dispatchEvent(new Event("ping"));
      return hit;
    })()`);
    expect(r).toBe(1);
  });
});
