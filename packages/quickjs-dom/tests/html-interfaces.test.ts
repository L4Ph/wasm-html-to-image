import { JSDOM as RealJSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "../src/jsdom.js";

// The members of the HTML interfaces (reflected attributes, validity, tables), against jsdom.

const open: JSDOM[] = [];
afterEach(() => {
  while (open.length) open.pop()!.close();
});

const both = (html: string, fn: (w: any) => unknown) => {
  const ours = new JSDOM(html, { virtualConsole: null });
  open.push(ours);
  return [fn(ours.window), fn(new RealJSDOM(html).window)];
};
const same = (html: string, fn: (w: any) => unknown) => {
  const [a, b] = both(html, fn);
  expect(a).toEqual(b);
};

describe("reflected attributes", () => {
  it("anchors, links, images, forms and cells", () => {
    same(
      `<body><a id=a href="/x" hreflang="de" download="f.txt" rel="noopener  nofollow" coords="1,2"></a><img id=i width=30 height=20 srcset="a 1x" sizes="100vw" ismap>
      <form id=f action="/go" method=POST novalidate></form><form id=g></form><table><tr><td id=c colspan=3 rowspan=2 abbr=x scope=col>1</td></tr></table><textarea id=t rows=5 maxlength=9>hi</textarea></body>`,
      (w) => {
        const d = w.document;
        const a = d.getElementById("a"), i = d.getElementById("i"), c = d.getElementById("c"), t = d.getElementById("t");
        return [
          a.hreflang, a.download, [...a.relList], a.relList.contains("nofollow"), a.coords,
          i.width, i.height, i.srcset, i.sizes, i.isMap, i.complete,
          d.getElementById("f").method, d.getElementById("f").noValidate, d.getElementById("g").method, d.getElementById("g").enctype,
          c.colSpan, c.rowSpan, c.abbr, c.scope, c.cellIndex,
          t.rows, t.cols, t.maxLength, t.minLength, t.defaultValue, t.textLength,
        ];
      },
    );
  });
});

const ours = (html: string, options: Record<string, unknown> = {}) => {
  const dom = new JSDOM(html, { virtualConsole: null, url: "https://example.com/dir/page.html", ...options });
  open.push(dom);
  return dom.window;
};

describe("images: srcset, currentSrc, natural size and decode", () => {
  const src = (name: string) => `https://example.com/dir/${name}`;

  it("selects the DPR-1 candidate: the smallest x >= 1x, else the largest", () => {
    const w = ours(`<body>
      <img id=a src="fallback.png" srcset="small.png 1x, large.png 2x">
      <img id=b src="fallback.png" srcset="small.png 2x, large.png 3x">
      <img id=c src="fallback.png" srcset="  ">
      <img id=d>
    </body>`);
    const d = w.document;
    expect(d.getElementById("a")!.currentSrc).toBe(src("small.png"));
    expect(d.getElementById("b")!.currentSrc).toBe(src("small.png"));
    // an unparseable srcset keeps src; no source at all is an empty currentSrc
    expect(d.getElementById("c")!.currentSrc).toBe(src("fallback.png"));
    expect(d.getElementById("d")!.currentSrc).toBe("");
    expect(d.getElementById("d")!.complete).toBe(true);
  });

  it("evaluates sizes for w descriptors, falling back to the largest candidate", () => {
    const w = ours(`<body>
      <img id=a srcset="w300.png 300w, w700.png 700w, w1200.png 1200w" sizes="200px">
      <img id=b srcset="w300.png 300w, w700.png 700w" sizes="(max-width: 700px) 100px, 600px">
      <img id=c srcset="w300.png 300w, w700.png 700w" sizes="(max-width: 900px) 100px, 600px">
      <img id=d srcset="w300.png 300w, w700.png 700w">
    </body>`);
    const d = w.document;
    // the viewport of the engine is 800px: b's condition does not match, c's does
    expect(d.getElementById("a")!.currentSrc).toBe(src("w300.png"));
    expect(d.getElementById("b")!.currentSrc).toBe(src("w700.png"));
    expect(d.getElementById("c")!.currentSrc).toBe(src("w300.png"));
    // no sizes means 100vw (800px): nothing covers it, so the largest w wins
    expect(d.getElementById("d")!.currentSrc).toBe(src("w700.png"));
  });

  it("re-selects when srcset, sizes or src changes", () => {
    const w = ours(`<body><img id=a src="fallback.png" srcset="x.png 2x, y.png 1x"></body>`);
    const img = w.document.getElementById("a")!;
    expect(img.currentSrc).toBe(src("y.png"));
    img.setAttribute("srcset", "w300.png 300w, w700.png 700w");
    img.setAttribute("sizes", "100px");
    expect(img.currentSrc).toBe(src("w300.png"));
    img.setAttribute("sizes", "500px");
    expect(img.currentSrc).toBe(src("w700.png"));
    img.removeAttribute("srcset");
    expect(img.currentSrc).toBe(src("fallback.png"));
    img.setAttribute("sizes", "200px");
    expect(img.currentSrc).toBe(src("fallback.png"));
  });

  it("takes natural size and complete from the resource record, and decode() resolves", async () => {
    const w = ours(`<body><img id=i src="a.png" srcset="a.png 1x"><img id=empty></body>`);
    const img = w.document.getElementById("i")!;
    const empty = w.document.getElementById("empty")!;
    expect(img.currentSrc).toBe(src("a.png"));
    expect(img.naturalWidth).toBe(0);
    expect(img.complete).toBe(true); // no record: the snapshot renderer owns the file, nothing to wait for

    (w as any).__edgeImageResource(src("a.png"), { status: "loading" });
    expect(img.complete).toBe(false);
    // decode waits for a record the renderer still owns; observe it from the page's side because
    // the bridge hands a guest promise back as a plain object, not a host promise
    w.eval('window.__decoded = "pending"; document.getElementById("i").decode().then(() => { window.__decoded = "resolved"; }); "ok"');
    expect((w as any).__decoded).toBe("pending");
    (w as any).__edgeImageResource(src("a.png"), { status: "loaded", width: 120.4, height: 80 });
    expect(img.complete).toBe(true);
    expect(img.naturalWidth).toBe(120);
    expect(img.naturalHeight).toBe(80);
    expect((w as any).__decoded).toBe("resolved");

    w.eval('document.getElementById("empty").decode().then(() => { window.__emptyDecoded = "resolved"; }, (e) => { window.__emptyDecoded = e.name; }); "ok"');
    expect((w as any).__emptyDecoded).toBe("EncodingError");
  });

  it("fires load on the elements showing a loaded record, before decode() resolves", () => {
    const w = ours(`<body><img id=i src="a.png"><img id=other src="b.png"></body>`);
    const img = w.document.getElementById("i")!;
    w.eval(`
      window.__log = [];
      document.getElementById("i").addEventListener("load", function (e) {
        window.__log.push({ type: e.type, target: e.target === this, current: e.currentTarget === this, bubbles: e.bubbles });
      });
      document.getElementById("other").addEventListener("load", function () {
        window.__log.push({ type: "other" });
      });
    `);
    const log = () => JSON.parse(w.eval("JSON.stringify(window.__log)") as string);

    (w as any).__edgeImageResource(src("a.png"), { status: "loading" });
    expect(log()).toEqual([]);
    w.eval('document.getElementById("i").decode().then(() => { window.__log.push({ type: "decode" }); }); "ok"');
    expect(log()).toEqual([]);

    (w as any).__edgeImageResource(src("a.png"), { status: "loaded", width: 20, height: 10 });
    expect(img.naturalWidth).toBe(20);
    // the event comes first, then the decode() waiter; only the matching element hears it
    expect(log()).toEqual([
      { type: "load", target: true, current: true, bubbles: false },
      { type: "decode" },
    ]);

    // a repeated settle of the same record is not a second load event
    (w as any).__edgeImageResource(src("a.png"), { status: "loaded", width: 20, height: 10 });
    expect(log()).toEqual([
      { type: "load", target: true, current: true, bubbles: false },
      { type: "decode" },
    ]);
  });

  it("fires error, leaves naturalWidth at 0 and rejects decode() after the event", () => {
    const w = ours(`<body><img id=e src="bad.png"></body>`);
    const img = w.document.getElementById("e")!;
    w.eval(`
      window.__log = [];
      document.getElementById("e").addEventListener("error", function (ev) {
        window.__log.push({ type: ev.type, target: ev.target === this, current: ev.currentTarget === this, bubbles: ev.bubbles });
      });
    `);
    const log = () => JSON.parse(w.eval("JSON.stringify(window.__log)") as string);

    (w as any).__edgeImageResource(src("bad.png"), { status: "loading" });
    expect(img.complete).toBe(false);
    w.eval('document.getElementById("e").decode().then(() => { window.__log.push({ type: "resolved" }); }, (e) => { window.__log.push({ type: "rejected", name: e.name }); }); "ok"');

    (w as any).__edgeImageResource(src("bad.png"), { status: "error" });
    expect(img.naturalWidth).toBe(0);
    expect(img.naturalHeight).toBe(0);
    expect(log()).toEqual([
      { type: "error", target: true, current: true, bubbles: false },
      { type: "rejected", name: "EncodingError" },
    ]);

    // error is not re-fired on a repeated settle
    (w as any).__edgeImageResource(src("bad.png"), { status: "error" });
    expect(log()).toEqual([
      { type: "error", target: true, current: true, bubbles: false },
      { type: "rejected", name: "EncodingError" },
    ]);
  });
});

describe("validity", () => {
  it("required, pattern, type, range and custom errors", () => {
    same(
      `<body><form id=f><input id=a required><input id=b pattern="[a-z]+" value="ABC"><input id=c type=email value="nope"><input id=d type=number min=5 max=10 value=11>
      <input id=e type=checkbox required><input id=g disabled required><input id=h value="ok"></form></body>`,
      (w) => {
        const d = w.document;
        const out: unknown[] = ["a", "b", "c", "d", "e", "g", "h"].map((id) => {
          const v = d.getElementById(id);
          return [id, v.validity.valid, v.validity.valueMissing, v.validity.patternMismatch, v.validity.typeMismatch, v.validity.rangeOverflow, v.willValidate, v.checkValidity()];
        });
        const h = d.getElementById("h");
        h.setCustomValidity("bad");
        out.push([h.validity.customError, h.validationMessage, h.checkValidity()]);
        h.setCustomValidity("");
        out.push([h.validity.valid, d.getElementById("f").checkValidity()]);
        return out;
      },
    );
  });

  it("fires invalid on a control that fails", () => {
    const [a] = both("<body><input id=a required></body>", (w) => {
      let seen = 0;
      const el = w.document.getElementById("a");
      el.addEventListener("invalid", () => seen++);
      el.checkValidity();
      return seen;
    });
    expect(a).toBe(1);
  });
});

describe("tables and selects", () => {
  it("insertRow, deleteRow, sections, cells and select.add", () => {
    same("<body><table id=t><thead><tr><th>h</th></tr></thead><tbody><tr id=r1><td>1</td><td>2</td></tr></tbody></table><select id=s><option>a</option></select></body>", (w) => {
      const d = w.document;
      const t = d.getElementById("t");
      const log: unknown[] = [t.rows.length, t.tBodies.length, t.tHead.localName, t.tFoot, t.caption];
      const r = t.insertRow();
      r.insertCell().textContent = "x";
      t.insertRow(0).insertCell();
      log.push(t.rows.length, [...t.rows].map((x: any) => x.rowIndex), r.cells.length, r.cells[0].cellIndex);
      t.deleteRow(0);
      t.createTFoot();
      t.createCaption();
      t.createTBody();
      log.push(t.rows.length, t.tBodies.length, t.tFoot.localName, t.caption.localName, d.getElementById("r1").sectionRowIndex);
      const row = d.getElementById("r1");
      row.deleteCell(0);
      log.push(row.cells.length);
      const s = d.getElementById("s");
      const o = d.createElement("option");
      o.textContent = "b";
      s.add(o);
      s.add(d.createElement("option"), 0);
      log.push(s.options.length, s.item(1).textContent, o.label, o.text);
      try { t.deleteRow(99); } catch (e: any) { log.push(e.name); }
      return log;
    });
  });
});

describe("setters the sites assign through", () => {
  it("meta.content, option.defaultSelected, select.length are writable; isEqualNode compares like jsdom", () => {
    same(
      '<body><meta id=m name=a content=b><select id=s><option>1<option selected>2</select><div id=a class=x><b>t</b></div><div id=b class=x><b>t</b></div><div id=c class=y><b>t</b></div></body>',
      (w) => {
        const d = w.document;
        const m = d.getElementById("m"), s = d.getElementById("s");
        m.content = "z";
        s.options[0].defaultSelected = true;
        s.length = 3;
        const a = d.getElementById("a");
        return [m.getAttribute("content"), s.options[0].hasAttribute("selected"), s.length,
          a.isEqualNode(d.getElementById("b")), a.isEqualNode(d.getElementById("c")), a.isSameNode(a), a.isEqualNode(null)];
      },
    );
  });
});
