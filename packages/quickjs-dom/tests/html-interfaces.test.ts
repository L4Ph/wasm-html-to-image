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
