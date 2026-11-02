import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, type QuickJSDOM } from "../src/index.js";

// csrc/htmlparse.h is a port of htmlparser2's HTML mode. These tests run both on the same input and compare what
// linkedom's handlers would be called with.
const require = createRequire(require_resolve_linkedom());
function require_resolve_linkedom(): string {
  return createRequire(import.meta.url).resolve("linkedom/package.json");
}
const { Parser } = require("htmlparser2") as { Parser: new (handlers: object, options: object) => { write(s: string): void; end(): void } };

type Ev = [string, ...unknown[]];

/** htmlparser2's events, in the shape the guest recorder below produces */
function reference(markup: string): Ev[] {
  const ev: Ev[] = [];
  const parser = new Parser(
    {
      onopentag: (name: string, attributes: Record<string, string>) => ev.push(["o", name, Object.keys(attributes).map((k) => [k, attributes[k]])]),
      onclosetag: () => ev.push(["c"]),
      ontext: (t: string) => ev.push(["t", t]),
      oncomment: (t: string) => ev.push(["m", t]),
      onprocessinginstruction: (n: string, d: string) => ev.push(["p", n, d]),
    },
    { lowerCaseAttributeNames: false, decodeEntities: true, xmlMode: false },
  );
  parser.write(markup);
  parser.end();
  return ev;
}

let dom: QuickJSDOM;
beforeAll(async () => {
  dom = await createDOM({ html: "<p>" }, { settleMs: 0 });
});
afterAll(() => dom.close());

/** the native parser's events (null when it declined) */
async function native(markups: string[]): Promise<(Ev[] | null)[]> {
  return (await dom.eval((list: string[]) => {
    return list.map((markup) => {
      const ev: unknown[] = [];
      const ok = (globalThis as any).__native.parseHTML(markup, {
        onopentag(n: string, a: Record<string, string>) { ev.push(["o", n, Object.keys(a).map((k) => [k, a[k]])]); },
        onclosetag() { ev.push(["c"]); },
        ontext(t: string) { ev.push(["t", t]); },
        oncomment(t: string) { ev.push(["m", t]); },
        onprocessinginstruction(n: string, d: string) { ev.push(["p", n, d]); },
      });
      return ok === true ? ev : null;
    });
  }, markups)) as (Ev[] | null)[];
}

async function expectSame(markups: string[], mayDecline = (m: string) => /[^\x00-\x7f]/.test(m)) {
  const got = await native(markups);
  markups.forEach((m, i) => {
    if (got[i] === null) {
      expect(mayDecline(m), `declined: ${JSON.stringify(m)}`).toBe(true);
      return;
    }
    expect(got[i], JSON.stringify(m)).toEqual(reference(m));
  });
}

describe("native HTML parser matches htmlparser2", () => {
  it("elements, attributes, text, comments and declarations", async () => {
    await expectSame([
      "",
      "plain text",
      "<p>hello</p>",
      '<!doctype html><html lang="en"><head><title>t &amp; u</title></head><body class=a id="b" data-x=\'c\' hidden disabled="">x</body></html>',
      "<div a=1 a=2 A=3 b = 'x' c=\"y\"   d>text</div>",
      "<a href=/x?y=1&z=2&copy=3&copy;>link</a>",
      "<!-- a comment --><!--- dashes ---><!-->short<!--->x",
      "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0//EN\">",
      "<?xml version=\"1.0\"?><?php echo 1 ?>",
      "<![CDATA[ not a comment ]]>after",
      "<![CDATA[unterminated",
      "<!--unterminated",
      "<div",
      '<div class="x',
      "<div class=",
      "<div a",
      "text <",
      "text &",
      "text &a",
      "text &am",
      "text &amp",
      "text &amp;",
      "&#",
      "&#x",
      "&#12",
      "&#x41",
      "&#x41;&#65;&#0;&#xD800;&#x110000;&#x80;&#99999999999999999999;",
      "&lt;&gt;&quot;&apos;&nbsp;&copy;&copy&notit;&notin;&amp&ampx",
      "&NotEqualTilde;&fjlig;&acE;&Aopf;",
      '<a title="&copy 2020 &amp x &ampy=1 &lt;">',
      "<a title=&copy=1 alt=&copy;&amp>",
    ]);
  });

  it("implied closes, void elements, mismatched and stray tags", async () => {
    await expectSame([
      "<p>one<p>two<div>three</div><p>four",
      "<ul><li>a<li>b<ul><li>c</ul></ul>",
      "<table><tr><td>a<td>b<tr><td>c<th>d</table>",
      "<table><thead><tr><th>h<tbody><tr><td>x<tfoot><tr><td>f</table>",
      "<select><option>a<option>b<optgroup label=g><option>c</select>",
      "<dl><dt>t<dd>d<dt>t2<dd>d2</dl>",
      "<ruby>a<rt>b<rp>c<rt>d</ruby>",
      "<head><link><script>x</script><body>y",
      "<button>a<input>b<button>c<textarea>d</textarea>",
      "</p></br></div></img>",
      "<br><br/><br></br><img src=x><img src=x/></img><input value=a><hr><hr/>",
      "<b><i>x</b>y</i>z",
      "<div><span></div>after</span>",
      "<h1>a<h2>b<p>c<h3>d",
      "<a><a><a></a>",
      "<svg><circle/><path d=''/><foreignObject><p>x<br/>y</foreignObject></svg><br/>",
      "<math><mi>x</mi><annotation-xml><p>q</p></annotation-xml></math>",
      "<svg><title><b>x</b></title><desc>d</desc><g/></svg>",
      "</svg></math></title></desc><div>x</div>",
      "<div/><span/>x</span></div>",
      "<custom-element a=b><slot name=s></slot></custom-element>",
    ]);
  });

  it("raw text elements: script, style, title, textarea, xmp", async () => {
    await expectSame([
      "<script>if (a < b && c > d) { x = '</div>' }</script>after",
      "<script>a</scr</script>b",
      "<script>a<</script>b",
      "<SCRIPT>x</SCRIPT>y",
      "<script/>x</script>",
      "<script src=a.js></script><style>a > b { color: red }</style>",
      "<style>x</styles>y</style>z",
      "<title>a &amp; b <b>not a tag</b></title><p>x",
      "<title>unterminated &amp",
      "<textarea>a &amp; <b>x</b></textarea>y",
      "<xmp><p>&amp;</xmp>z",
      "<script>unterminated",
      "<script>x</script",
      "<script>x</script >y",
      "<script>x</script\n>y",
      "<scriptx>a</scriptx>",
      "<styl>a</styl>",
      "<tit>a</tit><titlex>b</titlex>",
      "<textare>a</textare>",
    ]);
  });

  it("odd tokens", async () => {
    await expectSame([
      "<>text</>",
      "< p>text",
      "<1>x",
      "<-a>x",
      "</>x",
      "</ p>x",
      "</1>x",
      "</p x=y>z",
      "<!>x<!x>y<! x>",
      "<?>x<?y>z",
      "<a =b>x</a>",
      "<a b=>x</a>",
      "<a b='>x</a>",
      '<a b=">x</a>',
      "<a/b>x",
      "<a / b>x",
      "<a b/c>x",
      "<a b=c/>x",
      "<a b='c'd='e'>x",
      "<a\nb\n=\n'c'\n>",
      "<a __proto__=x constructor=y toString=z hasOwnProperty=w>",
      "<a 1=x 0=y 02=z b=c>",
      "<a b\0c=d>\0</a>",
      "<br/ >",
      "a\r\nb\rc\fd\te",
    ]);
  });

  it("non-ASCII text and attributes go through; non-ASCII names are declined", async () => {
    const got = await native(["<p title='é😀'>日本語 &amp; ñ</p>", "<pé>x</pé>", "<p>x</aÄ>", "<!DOCTYPEé>", "<p>\ud800</p>", "<!DOCTYPE é>"]);
    expect(got[0]).toEqual(reference("<p title='é😀'>日本語 &amp; ñ</p>"));
    expect(got[1]).toBeNull();
    expect(got[2]).toBeNull();
    expect(got[3]).toBeNull();
    expect(got[4]).toBeNull();
    expect(got[5]).toEqual(reference("<!DOCTYPE é>")); // the name ends before the é
  });

  it("random markup", async () => {
    // a small deterministic generator over the tokens that matter
    let seed = 20250601;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor((seed / 4294967296) * n);
    };
    const tokens = [
      "<", ">", "/", "!", "?", "-", "--", "-->", "<!--", "<![CDATA[", "]]>", "=", '"', "'", " ", "\n", "\t", "&", ";", "#", "x", "&#", "&#x",
      "&amp;", "&amp", "&lt", "&copy", "&copy;", "&notit;", "&NotEqualTilde;", "&#65;", "&#x42", "&#0;", "&#x110000;", "&zzz;", "&a", "&am",
      "div", "p", "li", "td", "tr", "th", "ul", "table", "tbody", "thead", "svg", "math", "foreignObject", "desc", "title", "script", "style",
      "textarea", "xmp", "br", "input", "option", "select", "button", "a", "b", "span", "body", "head", "html", "dd", "dt", "rt", "h1",
      "<div>", "</div>", "<p>", "</p>", "<li>", "<td>", "<tr>", "<svg>", "</svg>", "<script>", "</script>", "<title>", "</title>", "<br/>", "</br>",
      "<a href=", "class=", "id='", 'x="', "text", "é", "😀", "a b", "0", "1",
    ];
    const cases: string[] = [];
    for (let i = 0; i < 4000; i++) {
      let m = "";
      const n = 1 + rnd(40);
      for (let j = 0; j < n; j++) m += tokens[rnd(tokens.length)];
      cases.push(m);
    }
    for (let i = 0; i < cases.length; i += 500) await expectSame(cases.slice(i, i + 500));
  });

  it("real pages", async () => {
    const files: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 4 || files.length >= 60) return;
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, depth + 1);
        else if (/\.html?$/.test(name) && st.size < 400_000) files.push(p);
      }
    };
    for (const root of ["../../visual-test", "../../docs/static", "../../html-to-image/tests"]) {
      try {
        walk(join(import.meta.dirname, root), 0);
      } catch {
        // a package that is not there
      }
    }
    expect(files.length).toBeGreaterThan(0);
    await expectSame(files.map((f) => readFileSync(f, "utf8")));
  });
});
