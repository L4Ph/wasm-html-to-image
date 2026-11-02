import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { markdownToDocument, markdownToHtml } from "../src/markdown";
import { defineTemplate, fillRunningText, listTemplates, parseFrontMatter, resolveTemplate, TEMPLATES } from "../src/markdown-template";
import { buildRenderOptions, loadTemplate, type CliFlags } from "../src/cli-options";
import { parseCssColor } from "../src/encode-args";

const style = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1];
const article = (html: string) => /<article class="markdown-body">([\s\S]*)<\/article>/.exec(html)![1];

describe("front matter", () => {
  it("reads flat key: value lines: quotes, comments, hyphenated keys", () => {
    expect(
      parseFrontMatter(
        [
          "title: \"A: B\"",
          "author: Taro  # who",
          "page-size: A5",
          "toc: false",
          "cover: true",
          "# a comment",
          "stamp: 'DRAFT'",
          "",
        ].join("\n"),
      ),
    ).toEqual({ title: "A: B", author: "Taro", page_size: "A5", toc: false, cover: true, stamp: "DRAFT" });
  });

  it("skips what it does not know (lists, nested values, other tools' keys) and non-boolean toc/cover", () => {
    const s = parseFrontMatter("tags: [a, b]\nmeta:\n  nested: 1\n- item\ntoc: maybe\ncover: \"true\"\ntitle: T");
    expect(s).toEqual({ title: "T" });
  });
});

describe("templates", () => {
  it("lists the bundled templates with a description each", () => {
    const names = listTemplates().map((t) => t.name);
    expect(names).toEqual(["default", "report", "proposal", "book", "paper", "compact", "manual", "minutes", "letter", "slides", "invoice"]);
    for (const t of listTemplates()) expect(t.description.length).toBeGreaterThan(10);
  });

  it("an unknown template name is an error that lists the choices", () => {
    expect(() => resolveTemplate("nope")).toThrow(/Choose from: default, report, proposal, book, paper, compact/);
    expect(() => markdownToHtml("x", { template: "nope" })).toThrow(/unknown template/);
  });

  it("without a template the page is the plain one: no @page size, no cover", () => {
    const html = markdownToHtml("---\ntitle: T\n---\n# H", { paged: true });
    expect(style(html)).toContain("@page { margin: 32px; }");
    expect(/@page \{[^}]*\bsize:/.test(style(html))).toBe(false); // a margin only, no page size
    expect(article(html)).not.toContain('class="cover"');
  });

  it("each template gets its own typography, page size and margins", () => {
    const sheet = (template: string) => style(markdownToHtml("# H\n\ntext", { template, paged: true }));
    expect(sheet("book")).toContain("@page { size: A5; margin: 20mm 17mm 22mm; }");
    expect(sheet("book")).toContain("font-family: serif");
    expect(sheet("book")).toMatch(/h1 \{[^}]*break-before: page/); // a chapter per page
    expect(sheet("report")).toContain("@page { size: A4; margin: 26mm 22mm 24mm; }");
    expect(sheet("compact")).toContain("font-size: 12px");
    expect(sheet("paper")).toContain("text-align: justify");
    expect(sheet("default")).not.toContain("break-before: page");
  });

  it("the theme is separate from the template: every template has a dark variant", () => {
    for (const name of Object.keys(TEMPLATES)) {
      const html = markdownToHtml("# H", { template: name, theme: "dark", paged: true });
      expect(style(html)).toContain("background: #0d1117");
    }
  });

  it("a template given as an object works like a bundled one and fills in what it leaves out", () => {
    const html = markdownToHtml("# H", {
      paged: true,
      template: { type: { size: 20 }, page: { size: "Letter", margin: "10mm" }, css: ".x{y:z}" },
    });
    expect(style(html)).toContain("font-size: 20px");
    expect(style(html)).toContain("@page { size: Letter; margin: 10mm; }");
    expect(style(html)).toContain("font-family: sans-serif"); // from the default type
    expect(style(html)).toContain(".x{y:z}");
  });
});

describe("settings: template defaults < front matter < options", () => {
  const md = "---\ntitle: From front matter\nauthor: Front\n---\n# H";
  it("the template supplies what the document does not say", () => {
    expect(markdownToDocument(md, { template: "report", paged: true }).settings).toMatchObject({
      cover: true,
      toc: true,
      accent: "#1d4ed8",
      title: "From front matter",
    });
  });

  it("front matter beats the template, options beat front matter", () => {
    const fm = "---\ntitle: T\ncover: false\naccent: '#111111'\ntemplate: report\n---\n# H";
    const s = markdownToDocument(fm, { paged: true }).settings;
    expect(s).toMatchObject({ cover: false, accent: "#111111", toc: true });
    const o = markdownToDocument(fm, { paged: true, settings: { cover: true, accent: "#222222" }, toc: false }).settings;
    expect(o).toMatchObject({ cover: true, accent: "#222222", toc: false });
  });

  it("settings.template names the template that was used, whichever of the option and the front matter chose it", () => {
    const fm = "---\ntitle: T\ntemplate: report\n---\n# H";
    expect(markdownToDocument(fm, { paged: true }).settings.template).toBe("report");
    expect(markdownToDocument(fm, { paged: true, template: "book" }).settings.template).toBe("book");
    // a template given as an object has no name; the front matter's is not what was used either
    expect(markdownToDocument(fm, { paged: true, template: { css: "" } }).settings.template).toBeUndefined();
    expect(markdownToDocument("# H", { paged: true }).settings.template).toBeUndefined();
  });

  it("a front matter template: is used, and the option wins over it", () => {
    const fm = "---\ntitle: T\ntemplate: book\n---\n# H";
    expect(style(markdownToHtml(fm, { paged: true }))).toContain("@page { size: A5;");
    expect(style(markdownToHtml(fm, { paged: true, template: "compact" }))).toContain("margin: 12mm 12mm");
  });

  it("page_size, font and accent apply to the stylesheet", () => {
    const html = markdownToHtml("---\ntitle: T\npage_size: 210mm 297mm\nfont: serif\naccent: '#c2410c'\n---\n# H", {
      template: "default",
      paged: true,
    });
    expect(style(html)).toContain("size: 210mm 297mm;");
    expect(style(html)).toMatch(/body \{[^}]*font-family: serif/);
    expect(style(html)).toContain("--accent: #c2410c");
    expect(style(html)).toContain("a { color: #c2410c");
  });
});

describe("cover", () => {
  const doc = (extra = "") =>
    markdownToHtml(`---\ntitle: First<br>Second\nsubtitle: Sub & more\nauthor: Ann\ndate: 2026-10-29\n${extra}---\n# Chapter`, {
      template: "report",
      paged: true,
    });

  it("has the title (with <br> breaks), subtitle, author and date, and comes before the contents", () => {
    const cover = /<header class="cover">[\s\S]*?<\/header>/.exec(doc())![0];
    expect(cover).toContain('<p class="cover-title">First<br>Second</p>');
    expect(cover).toContain('<p class="cover-subtitle">Sub &amp; more</p>');
    expect(cover).toContain('<span class="cover-author">Ann</span>');
    expect(cover).toContain('<span class="cover-date">2026-10-29</span>');
    expect(doc().indexOf('class="cover"')).toBeLessThan(doc().indexOf('class="toc"'));
  });

  it("is not a heading: it stays out of the contents and the outline", () => {
    expect(article(doc())).not.toMatch(/<h1[^>]*>First/);
    expect(doc().match(/data-toc-page=/g)?.length).toBe(1); // only "Chapter"
  });

  it("needs a title, and a logo is added to it", () => {
    expect(article(markdownToHtml("# Chapter", { template: "report", paged: true }))).not.toContain('class="cover"');
    expect(doc("logo: https://example.com/l.png\n")).toContain('<img class="cover-logo" src="https://example.com/l.png" alt="">');
  });

  it("cover: false removes the template's cover", () => {
    expect(doc("cover: false\n")).not.toContain('<header class="cover">');
  });
});

describe("running header and footer, PDF title", () => {
  it("fills {{title}}, {{author}}, {{date}} and {{stamp}} (escaped) and leaves the page numbers to the renderer", () => {
    const text = fillRunningText("{{title}}|{{author}}|{{date}}|{{stamp}}|{{pageNumber}}/{{totalPages}}", {
      title: "A<br>B",
      author: "<b>x</b>",
      stamp: "DRAFT",
    });
    expect(text).toBe("A B|&lt;b&gt;x&lt;/b&gt;||DRAFT|{{pageNumber}}/{{totalPages}}");
  });

  it("a template's header and footer come back as render options, with the PDF's title and author", () => {
    const { renderOptions } = markdownToDocument("---\ntitle: Report\nauthor: Ann\nstamp: DRAFT\n---\n# H", {
      template: "report",
      paged: true,
    });
    expect(renderOptions.pdfHeader).toContain("Report");
    expect(renderOptions.pdfHeader).toContain("DRAFT");
    expect(renderOptions.pdfFooter).toContain("{{pageNumber}} / {{totalPages}}");
    expect(renderOptions.pdfFooter).toContain("Ann");
    expect(renderOptions.pdfTitle).toBe("Report");
    expect(renderOptions.pdfAuthor).toBe("Ann");
  });

  it("a stamp alone gives a header even without a template; no title or template gives no render options", () => {
    expect(markdownToDocument("# H", { settings: { stamp: "DRAFT" }, paged: true }).renderOptions.pdfHeader).toContain("DRAFT");
    expect(markdownToDocument("# H", { paged: true }).renderOptions).toEqual({});
  });
});

describe("dark pages", () => {
  const bg = (o: Parameters<typeof markdownToDocument>[1]) => markdownToDocument("# H", o).renderOptions.pdfBackground;
  it("a dark PDF asks for the whole page to be painted; light, images and own stylesheets do not", () => {
    expect(bg({ theme: "dark", paged: true })).toBe("#0d1117");
    expect(bg({ theme: "light", paged: true })).toBeUndefined();
    expect(bg({ theme: "dark" })).toBeUndefined();
    expect(bg({ theme: "dark", paged: true, stylesheet: "body{}" })).toBeUndefined();
  });

  it("parseCssColor gives the engine's ARGB integer and rejects what it cannot read", () => {
    expect(parseCssColor("#0d1117")).toBe(0xff0d1117);
    expect(parseCssColor("#fff")).toBe(0xffffffff);
    expect(parseCssColor("#11223380")).toBe(0x80112233);
    expect(() => parseCssColor("red")).toThrow(/invalid colour/);
    expect(() => parseCssColor("#12")).toThrow(/invalid colour/);
  });
});

describe("the template from the CLI", () => {
  const flags: CliFlags = { width: 800, format: "pdf", quality: 85, markdown: true };
  it("--template, --page-size, --accent, --body-font, --stamp and --no-cover reach the page", async () => {
    const o = await buildRenderOptions("---\ntitle: T\n---\n# H", {
      ...flags,
      template: "report",
      pageSize: "A3",
      accent: "#abcdef",
      bodyFont: "serif",
      stamp: "SECRET",
      cover: false,
    });
    const html = String(o.value);
    expect(style(html)).toContain("size: A3;");
    expect(style(html)).toContain("--accent: #abcdef");
    expect(style(html)).toMatch(/body \{[^}]*font-family: serif/);
    expect(html).not.toContain('<header class="cover">');
    expect(o.pdfHeader).toContain("SECRET");
    expect(o.pdfFooter).toContain("{{pageNumber}}");
  });

  it("loads a .json template (type, page, defaults, css) and a .css file laid over the default", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-"));
    const json = path.join(dir, "mine.json");
    fs.writeFileSync(json, JSON.stringify({ type: { size: 18 }, page: { size: "B5", margin: "9mm" }, defaults: { cover: true } }));
    const css = path.join(dir, "extra.css");
    fs.writeFileSync(css, ".marker { color: red }");
    const a = await buildRenderOptions("---\ntitle: T\n---\n# H", { ...flags, template: json });
    expect(style(String(a.value))).toContain("font-size: 18px");
    expect(style(String(a.value))).toContain("@page { size: B5; margin: 9mm; }");
    expect(String(a.value)).toContain('<header class="cover">');
    const b = await buildRenderOptions("# H", { ...flags, template: css });
    expect(style(String(b.value))).toContain(".marker { color: red }");
    fs.writeFileSync(path.join(dir, "bad.json"), "{ nope");
    await expect(loadTemplate(path.join(dir, "bad.json"))).rejects.toThrow(/not valid JSON/);
    expect(await loadTemplate("book")).toBe("book"); // a name is resolved later, so the error lists the choices
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("template colours and code, tables", () => {
  const css = (template: string, theme: "light" | "dark" = "light") => style(markdownToDocument("---\ntitle: T\n---\n# H", { template, theme, paged: true }).html);

  it("hands the page colours to templates as variables, so a dark theme reaches table stripes and quotes", () => {
    for (const theme of ["light", "dark"] as const) {
      const s = css("proposal", theme);
      expect(s).toMatch(/--surface: #[0-9a-f]{6}/i);
      expect(s).toContain("background: var(--surface");
    }
    // the dark palette's surface is not the light one
    expect(css("proposal", "dark").match(/--surface: (#[0-9a-f]{6})/i)![1]).not.toBe(css("proposal").match(/--surface: (#[0-9a-f]{6})/i)![1]);
  });

  it("keeps hard-coded light colours out of the bundled templates", () => {
    for (const [name, t] of Object.entries(TEMPLATES)) expect(t.css ?? "", name).not.toMatch(/background:\s*#(?:f1f5f9|fff)/i);
  });

  it("wraps long code lines instead of cutting them", () => {
    const s = css("default");
    expect(s).toMatch(/\.markdown-body pre \{[^}]*white-space: pre-wrap/);
    expect(s).toMatch(/\.markdown-body pre code \{[^}]*white-space: pre-wrap/);
  });

  it("gives report, proposal, book and paper full-width tables with one-line headers, the others not", () => {
    for (const name of ["report", "proposal", "book", "paper"]) expect(css(name), name).toMatch(/table \{[^}]*width: 100%/);
    for (const name of ["default", "compact"]) expect(css(name), name).not.toMatch(/table \{[^}]*width: 100%/);
    expect(css("report")).toMatch(/\.markdown-body th \{[^}]*white-space: nowrap/);
  });

  it("does not indent block quotes", () => {
    expect(css("default")).toMatch(/blockquote \{ margin-left: 0; margin-right: 0;/);
  });
});

describe("page settings in the front matter", () => {
  const doc = (front: string, options = {}) => markdownToDocument(`---\n${front}\n---\n# H\n\ntext`, { paged: true, ...options });

  it("reads header, footer, margin, orientation, toc_depth, toc_title and cover_style", () => {
    expect(parseFrontMatter(["header: <b>{{title}}</b>", "footer: {{pageNumber}} / {{totalPages}}", "margin: 20mm 18mm", "orientation: landscape", "toc_depth: 2", "toc_title: 目次", "cover_style: center"].join("\n"))).toEqual({
      header: "<b>{{title}}</b>",
      footer: "{{pageNumber}} / {{totalPages}}",
      margin: "20mm 18mm",
      orientation: "landscape",
      toc_depth: 2,
      toc_title: "目次",
      cover_style: "center",
    });
    expect(parseFrontMatter("toc_depth: 9\ntoc_depth: x")).toEqual({}); // not 1 to 6
  });

  it("replaces the template's footer and margin, and fills the title variable", () => {
    const d = doc("title: Doc\ntemplate: report\nfooter: <i>{{title}} p{{pageNumber}}</i>\nmargin: 10mm");
    expect(d.renderOptions.pdfFooter).toBe("<i>Doc p{{pageNumber}}</i>");
    expect(style(d.html)).toContain("margin: 10mm;");
  });

  it("makes a document without a template paged when it asks for a footer", () => {
    const d = doc("title: Doc\nfooter: {{pageNumber}}");
    expect(d.renderOptions.pdfFooter).toBe("{{pageNumber}}");
    expect(style(d.html)).toContain("@page {");
  });

  it("turns the page to landscape, for a named size and for two lengths", () => {
    expect(style(doc("template: report\norientation: landscape").html)).toContain("size: A4 landscape;");
    expect(style(doc("template: report\npage_size: 210mm 297mm\norientation: landscape").html)).toContain("size: 210mm 297mm landscape;");
  });

  it("limits the contents to toc_depth and titles it with toc_title", () => {
    const md = "---\ntitle: T\ntoc: true\ntoc_depth: 1\ntoc_title: 目次\n---\n# A\n\n## B\n\n# C\n";
    const html = markdownToDocument(md, { paged: true }).html;
    expect(html).toContain('<p class="toc-title">目次</p>');
    expect(html.match(/class="toc-item/g)).toHaveLength(2);
  });

  it("dresses the cover by cover_style, and leaves the first page without header and footer", () => {
    expect(doc("title: T\ncover: true\ncover_style: center").html).toContain('<header class="cover cover-center">');
    expect(doc("title: T\ncover: true\ncover_style: nope").html).toContain('<header class="cover">');
    expect(doc("title: T\ntemplate: report").renderOptions.pdfSkipRunning).toBe(1);
    expect(doc("title: T\ntemplate: compact").renderOptions.pdfSkipRunning).toBeUndefined(); // no cover
  });
});

describe("call-outs, figures, page breaks, heading numbers and footnotes", () => {
  const html = (md: string, options = {}) => markdownToDocument(md, options).html;

  it("turns [!NOTE]-style block quotes into titled call-outs and leaves ordinary quotes alone", () => {
    const h = html("> [!WARNING]\n> Mind the gap.\n\n> plain quote\n\n> [!TIP] inline start");
    expect(h).toMatch(/<div class="callout callout-warning"><p class="callout-title">Warning<\/p><p>Mind the gap\.<\/p>\s*<\/div>/);
    expect(h).toContain("<blockquote>");
    expect(h).toContain('class="callout callout-tip"');
    expect(h).toContain("<p>inline start</p>");
    expect(html("---\nlang: ja\n---\n> [!NOTE]\n> x")).toContain(">補足</p>");
  });

  it("numbers a figure when the image has a title, and does not touch an image without one", () => {
    const h = html('![a](a.png "First")\n\n![b](b.png "Second")\n\n![c](c.png)');
    expect(h).toContain("<figcaption>Figure 1　First</figcaption>");
    expect(h).toContain("<figcaption>Figure 2　Second</figcaption>");
    expect(h.match(/<figure/g)).toHaveLength(2);
    expect(h).toContain('<p><img src="c.png" alt="c"></p>');
  });

  it("makes <!-- pagebreak --> a forced page break", () => {
    expect(html("a\n\n<!-- pagebreak -->\n\nb")).toContain('<div class="pagebreak"></div>');
    expect(html("a\n\n<!-- a comment -->\n\nb")).not.toContain("pagebreak\"");
  });

  it("numbers the headings 1, 1.1, 1.2, 2 when numbering is on, and the contents show the numbers", () => {
    const d = html("---\ntitle: T\nnumbering: true\ntoc: true\n---\n# A\n\n## B\n\n## C\n\n# D", { paged: true });
    const nums = [...d.matchAll(/<h[12] id="[^"]*"><span class="hnum">([\d.]+)<\/span>/g)].map((m) => m[1]);
    expect(nums).toEqual(["1", "1.1", "1.2", "2"]);
    expect(d).toMatch(/class="toc-text"><span class="hnum">1\.2<\/span>/);
    expect(html("# A\n\n## B")).not.toContain("hnum\"");
  });

  it("collects footnotes at the end, numbered by first use, and leaves unknown ids and code alone", () => {
    const md = "Text[^a] and more[^b], again[^a], unknown[^zz].\n\n[^a]: first note\n[^b]: second **bold**\n  continued\n\n```\n[^c]: not a note\n```\n";
    const h = html(md);
    expect([...h.matchAll(/<sup class="fnref"><a id="fnref-(\d)-(\d)" href="#fn-\d">(\d)/g)].map((m) => `${m[3]}:${m[2]}`)).toEqual(["1:1", "2:1", "1:2"]);
    expect(h).toContain('<li id="fn-1">first note</li>');
    expect(h).toContain('<li id="fn-2">second <strong>bold</strong> continued</li>');
    expect(h).toContain("unknown[^zz]");
    expect(h).toContain("[^c]: not a note");
    expect(h).toContain('<p class="footnotes-title">Notes</p>');
    expect(html("a[^q]")).not.toContain('class="footnotes"');
  });

  it("marks the list for the PDF engine only with footnotes: page on a paged document", () => {
    const md = "---\nfootnotes: page\n---\nText[^a].\n\n[^a]: note\n";
    const paged = markdownToDocument(md, { paged: true }).html;
    expect(paged).toContain("data-pdf-footnotes");
    expect(paged).not.toContain(`<p class="footnotes-title">`); // the list itself is not printed
    expect(paged).toContain('<li id="fn-1">note</li>');
    expect(markdownToDocument(md).html).not.toContain("data-pdf-footnotes");
    expect(markdownToDocument(md.replace("page", "end"), { paged: true }).html).not.toContain("data-pdf-footnotes");
  });
});

describe("the manual, minutes, letter, slides and invoice templates", () => {
  const names = ["manual", "minutes", "letter", "slides", "invoice"];

  it("are listed with a description", () => {
    const listed = listTemplates().map((t) => t.name);
    for (const n of names) expect(listed).toContain(n);
    for (const t of listTemplates()) expect(t.description, t.name).not.toBe("");
  });

  it("render a document in both themes without throwing", () => {
    for (const n of names)
      for (const theme of ["light", "dark"] as const)
        expect(() => markdownToDocument("---\ntitle: T\n---\n# H\n\n## S\n\n> [!NOTE]\n> n\n\n| a | b |\n|---|---|\n| 1 | 2 |", { template: n, theme, paged: true }), `${n} ${theme}`).not.toThrow();
  });

  it("manual numbers headings, starts chapters on a new page and has a cover and contents", () => {
    const d = markdownToDocument("---\ntitle: T\ntemplate: manual\n---\n# A\n\n## B", { paged: true });
    expect(d.settings).toMatchObject({ cover: true, toc: true, numbering: true });
    expect(style(d.html)).toMatch(/\.markdown-body h1 \{[^}]*break-before: page/);
    expect(d.html).toContain('<span class="hnum">1.1</span>');
  });

  it("slides is A4 landscape with each h2 on its own page, and hides a --- rule", () => {
    const s = style(markdownToDocument("---\ntitle: T\ntemplate: slides\n---\n## One\n\n---\n\n## Two", { paged: true }).html);
    expect(s).toContain("size: A4 landscape;");
    expect(s).toMatch(/\.markdown-body h2 \{[^}]*break-before: page/);
    expect(s).toMatch(/\.markdown-body hr \{ display: none; \}/);
  });

  it("minutes and letter have no cover or contents; letter offers .right and .center", () => {
    for (const n of ["minutes", "letter"]) expect(resolveTemplate(n).defaults).toMatchObject({ cover: false, toc: false });
    expect(resolveTemplate("letter").css).toContain(".right { text-align: right; }");
  });

  it("invoice titles the page at the right and fills the table header with the accent colour", () => {
    const css = resolveTemplate("invoice").css!;
    expect(css).toContain("text-align: right");
    expect(css).toMatch(/th \{ color: #ffffff; background: var\(--accent/);
  });
});

describe("templates that extend a bundled one", () => {
  it("lays the fields over the base field by field and appends the css", () => {
    const t = resolveTemplate(defineTemplate({ extends: "report", type: { size: 17 }, page: { margin: "9mm" }, defaults: { accent: "#ff0000" }, css: ".x { color: red }" }));
    expect(t.type).toMatchObject({ size: 17, lineHeight: 1.65, accentHeadings: true }); // size replaced, the rest from report
    expect(t.page).toMatchObject({ margin: "9mm" });
    expect(t.page?.footer).toContain("{{pageNumber}}"); // report's footer kept
    expect(t.defaults).toMatchObject({ cover: true, toc: true, accent: "#ff0000" });
    expect(t.css).toContain("--accent"); // report's css first
    expect(t.css!.endsWith(".x { color: red }")).toBe(true);
  });

  it("works through markdownToDocument, and an unknown base lists the choices", () => {
    const d = markdownToDocument("---\ntitle: T\n---\n# H", { paged: true, template: { extends: "book", defaults: { cover: false } } });
    expect(d.settings.cover).toBe(false);
    expect(style(d.html)).toContain("size: A5;");
    expect(() => resolveTemplate({ extends: "nope" })).toThrow(/unknown template "nope"/);
  });

  it("is what a JSON template file says through the CLI", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
    const json = path.join(dir, "mine.json");
    fs.writeFileSync(json, JSON.stringify({ extends: "proposal", defaults: { accent: "#123456" } }));
    const o = await buildRenderOptions("---\ntitle: T\n---\n# H", { width: 800, format: "pdf", quality: 85, markdown: true, template: json });
    expect(style(String(o.value))).toContain("--accent: #123456");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("Mermaid settings in the front matter", () => {
  const sheet = (front: string) => style(markdownToDocument(`---\n${front}\n---\n# H`, { paged: true }).html);

  it("reads mermaid_theme, mermaid_mode and mermaid_directives", () => {
    expect(parseFrontMatter("mermaid_theme: nord\nmermaid_mode: recover\nmermaid_directives: true")).toEqual({ mermaid_theme: "nord", mermaid_mode: "recover", mermaid_directives: true });
  });

  it("names the theme in the diagram's CSS and leaves the document's colours out of it", () => {
    const s = sheet("mermaid_theme: nord");
    const rule = /\.markdown-body \.mermaid \{[^}]*\}/.exec(s)![0];
    expect(rule).toContain("--mermaid-theme: nord;");
    expect(rule).not.toContain("--mermaid-bg"); // those would override the theme
  });

  it("keeps the document's colours without a theme, and adds the mode and directives when asked", () => {
    const plain = /\.markdown-body \.mermaid \{[^}]*\}/.exec(sheet("title: T"))![0];
    expect(plain).toContain("--mermaid-bg");
    expect(plain).not.toContain("--mermaid-theme");
    const rule = /\.markdown-body \.mermaid \{[^}]*\}/.exec(sheet("mermaid_mode: recover\nmermaid_directives: true"))![0];
    expect(rule).toContain("--mermaid-mode: recover;");
    expect(rule).toContain("--mermaid-directives: on;");
    expect(/\.markdown-body \.mermaid \{[^}]*\}/.exec(sheet("mermaid_mode: strict"))![0]).not.toContain("--mermaid-mode");
  });

  it("ignores a theme name that is not a plain word", () => {
    expect(/\.markdown-body \.mermaid \{[^}]*\}/.exec(sheet("mermaid_theme: a; b {"))![0]).not.toContain("--mermaid-theme");
  });
});

describe("running chapter title", () => {
  it("book names the chapter in its header, and a template or the front matter may use {{chapter}} anywhere", () => {
    const d = markdownToDocument("---\ntitle: B\ntemplate: book\n---\n# One", { paged: true });
    expect(d.renderOptions.pdfHeader).toContain("{{chapter}}"); // left for the engine: it knows the pages
    const own = markdownToDocument("---\ntitle: B\nfooter: <i>{{chapter}} / {{pageNumber}}</i>\n---\n# One", { paged: true });
    expect(own.renderOptions.pdfFooter).toBe("<i>{{chapter}} / {{pageNumber}}</i>");
  });
});
