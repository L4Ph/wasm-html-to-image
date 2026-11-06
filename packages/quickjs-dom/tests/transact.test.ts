import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";
import { JSDOM } from "../src/jsdom.js";

// transact(): host DOM work queued and applied to the page as one call. These tests pin the
// semantics the implementation promises: placeholders usable before the flush, reads answered
// from the queue, a non-queueable operation applying the queue first, failure behaviour, and
// the tree model staying correct across a mid-transaction flush.

let dom: QuickJSDOM;
let w: any;
beforeAll(async () => {
  dom = await createDOM({ html: "<!doctype html><body><div id=host></div></body>" }, { settleMs: 0 });
  w = dom.bridge().window;
});
afterAll(() => dom.close());

const host = () => w.document.getElementById("host");

describe("transact: building and reading inside the queue", () => {
  it("builds a tree that serializes as if built directly", () => {
    const el = host();
    dom.transact(() => {
      const ul = w.document.createElement("ul");
      for (let i = 0; i < 3; i++) {
        const li = w.document.createElement("li");
        li.className = "row r" + i;
        li.textContent = "item " + i;
        ul.appendChild(li);
      }
      el.appendChild(ul);
    });
    expect(el.innerHTML).toBe(
      '<ul><li class="row r0">item 0</li><li class="row r1">item 1</li><li class="row r2">item 2</li></ul>',
    );
    el.innerHTML = "";
  });

  it("answers a fresh node's identity reads before the flush, and keeps the same wrapper after", () => {
    let li: any;
    let seen: unknown[] = [];
    dom.transact(() => {
      li = w.document.createElement("li");
      seen = [li.tagName, li.nodeType, li.localName, li instanceof w.HTMLLIElement, li instanceof w.HTMLElement];
      host().appendChild(li);
    });
    expect(seen).toEqual(["LI", 1, "li", true, true]);
    expect(host().firstChild).toBe(li);
    expect(li instanceof w.HTMLLIElement).toBe(true);
    host().innerHTML = "";
  });

  it("reads back queued writes: properties, style, and the value/defaultValue pair", () => {
    dom.transact(() => {
      const inp = w.document.createElement("input");
      inp.defaultValue = "dv";
      expect(inp.value).toBe("dv"); // a fresh control's value comes from its default
      inp.value = "v";
      expect(inp.value).toBe("v");
      expect(inp.defaultValue).toBe("dv"); // writing value does not move the default
      const div = w.document.createElement("div");
      div.className = "a b";
      expect(div.className).toBe("a b");
      div.style.width = "10px";
      expect(div.style.width).toBe("10px");
      div.textContent = "hello";
      expect(div.textContent).toBe("hello");
    });
  });

  it("answers tree reads on fresh parents from the queue", () => {
    dom.transact(() => {
      const ul = w.document.createElement("ul");
      const a = w.document.createElement("li");
      const b = w.document.createElement("li");
      ul.appendChild(a);
      ul.appendChild(b);
      expect(ul.firstChild).toBe(a);
      expect(ul.lastChild).toBe(b);
      expect(a.nextSibling).toBe(b);
      expect(b.previousSibling).toBe(a);
      expect(a.parentNode).toBe(ul);
      ul.appendChild(a); // a move within the queue
      expect(ul.firstChild).toBe(b);
      expect(ul.lastChild).toBe(a);
    });
  });

  it("applies the queue before an operation it cannot queue, which then sees the new tree", () => {
    const el = host();
    dom.transact(() => {
      const s = w.document.createElement("span");
      s.className = "marker";
      el.appendChild(s);
      // querySelectorAll cannot be queued: the queue goes first, so the query sees the span
      expect(el.querySelectorAll(".marker").length).toBe(1);
      expect(el.querySelector(".marker")).toBe(s);
    });
    el.innerHTML = "";
  });

  it("keeps the tree model correct for moves queued after a mid-transaction flush", () => {
    const el = host();
    dom.transact(() => {
      const ul = w.document.createElement("ul");
      const items: any[] = [];
      for (let i = 0; i < 3; i++) {
        const li = w.document.createElement("li");
        li.textContent = "item " + i;
        items.push(li);
        ul.appendChild(li);
      }
      el.appendChild(ul);
      el.querySelectorAll("li"); // forces the queue to apply; the nodes exist in the page now
      ul.appendChild(items[0]); // a move queued after that flush
      expect(ul.lastChild).toBe(items[0]);
      expect(ul.firstChild).toBe(items[1]);
    });
    expect(el.querySelectorAll("li").length).toBe(3);
    el.innerHTML = "";
  });

  it("fires listeners registered inside the transaction", () => {
    let clicks = 0;
    dom.transact(() => {
      const b = w.document.createElement("button");
      b.addEventListener("click", () => clicks++);
      host().appendChild(b);
    });
    const b = host().firstChild;
    b.click();
    expect(clicks).toBe(1);
    host().innerHTML = "";
  });
});

describe("transact: failure and nesting semantics", () => {
  it("applies what was queued when the callback throws, then propagates", () => {
    const el = host();
    expect(() =>
      dom.transact(() => {
        const s = w.document.createElement("span");
        s.textContent = "kept";
        el.appendChild(s);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(el.textContent).toBe("kept");
    el.innerHTML = "";
  });

  it("names the failing operation, keeps the operations before it, and poisons the rest", () => {
    const el = host();
    let dead: any;
    expect(() =>
      dom.transact(() => {
        const good = w.document.createElement("i");
        el.appendChild(good);
        const bad = w.document.createElement("b");
        bad.appendChild(bad); // operation 3: a node into itself
        dead = w.document.createElement("u");
        el.appendChild(dead);
      }),
    ).toThrow(/transaction failed at operation 3/);
    expect(el.querySelectorAll("i").length).toBe(1); // before the failure: stands
    expect(el.querySelectorAll("u").length).toBe(0); // after it: never applied
    expect(() => dead.tagName).toThrow(); // created by an operation that never ran
    el.innerHTML = "";
  });

  it("joins a nested transaction into the outer one", () => {
    const el = host();
    dom.transact(() => {
      const outer = w.document.createElement("div");
      dom.transact(() => {
        outer.appendChild(w.document.createElement("span"));
      });
      el.appendChild(outer);
    });
    expect(el.innerHTML).toBe("<div><span></span></div>");
    el.innerHTML = "";
  });

  it("is exposed on the jsdom facade as well", () => {
    const facade = new JSDOM("<!doctype html><body></body>");
    try {
      facade.transact(() => {
        const p = facade.window.document.createElement("p");
        p.textContent = "via facade";
        facade.window.document.body.appendChild(p);
      });
      expect(facade.window.document.body.innerHTML).toBe("<p>via facade</p>");
    } finally {
      facade.window.close();
    }
  });
});
