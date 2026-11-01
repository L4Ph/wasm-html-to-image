import { marked, Marked } from "marked";
import { mathExtension, type MathRenderer } from "./markdown-math-syntax.js";
import { calloutHtml, createFootnotes, figureLabel, pagebreakHtml } from "./markdown-blocks.js";
import {
  DEFAULT_PAGE,
  DEFAULT_TYPE,
  fillRunningText,
  parseFrontMatter,
  resolveTemplate,
  titleHtml,
  type DocumentSettings,
  type MarkdownTemplate,
  type TemplateType,
} from "./markdown-template.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdownLang from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// A private instance: registering languages must not leak into an app's own highlight.js.
const highlighter = hljs.newInstance();
for (const [name, def] of Object.entries({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown: markdownLang, php, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
})) {
  highlighter.registerLanguage(name, def);
}
highlighter.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
highlighter.registerAliases(["ts", "tsx"], { languageName: "typescript" });
highlighter.registerAliases(["sh", "zsh"], { languageName: "bash" });
highlighter.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
highlighter.registerAliases(["yml"], { languageName: "yaml" });
highlighter.registerAliases(["py"], { languageName: "python" });
highlighter.registerAliases(["rs"], { languageName: "rust" });
highlighter.registerAliases(["rb"], { languageName: "ruby" });
highlighter.registerAliases(["md"], { languageName: "markdown" });
highlighter.registerAliases(["c++", "h", "hpp"], { languageName: "cpp" });
highlighter.registerAliases(["cs"], { languageName: "csharp" });
highlighter.registerAliases(["kt"], { languageName: "kotlin" });
highlighter.registerAliases(["toml"], { languageName: "ini" });

/** Options for {@link markdownToHtml}. */
// The template API lives beside the converter: `import { listTemplates, type MarkdownTemplate } from ".../markdown"`.
export { defineTemplate, listTemplates, TEMPLATES } from "./markdown-template.js";
export type { DocumentSettings, MarkdownTemplate, TemplatePage, TemplateType } from "./markdown-template.js";

export interface MarkdownOptions {
  /** Colour scheme of the built-in stylesheet. Defaults to `"light"`. */
  theme?: "light" | "dark";
  /** Extra CSS appended after the built-in stylesheet (it wins on equal specificity). */
  css?: string;
  /** Page padding around the article in px. Defaults to 32. */
  padding?: number;
  /**
   * Paginated output (`format: "pdf"`): `padding` becomes the `@page` margin on every page instead
   * of padding around the article, so pages after the first keep their top and bottom margins.
   */
  paged?: boolean;
  /** Maximum width of the article in px; omit for the full viewport width. */
  maxWidth?: number;
  /** `<title>` of the generated document. Defaults to the `title` of the front matter, if any. */
  title?: string;
  /** Highlight fenced code blocks that name a known language. Defaults to true. */
  highlight?: boolean;
  /**
   * Draw ```` ```mermaid ```` fences as diagrams (over 30 kinds, drawn by the engine itself). Defaults to true; `false`
   * leaves them as code blocks.
   */
  mermaid?: boolean;
  /** Strip a leading `---` YAML front matter block (and read its `title`). Defaults to true. */
  frontMatter?: boolean;
  /**
   * Typeset `$...$` and `$$...$$` with this renderer (`katexMath()` from `wasm-html-to-image/markdown-math`).
   * Without it a dollar sign is just text.
   */
  math?: MathRenderer;
  /** Replace the built-in stylesheet entirely (`theme` is then ignored). */
  stylesheet?: string;
  /**
   * A table of contents before the text: every heading down to `depth` (default 3), each a link to its
   * heading with the page it lands on filled in by the PDF renderer. On by default for paged
   * (`paged: true`, i.e. PDF) output, off otherwise; `false` switches it off, `true` or an object on.
   */
  toc?: boolean | TocOptions;
  /**
   * The look: a bundled template by name (`"default"`, `"report"`, `"book"`, `"paper"`, `"compact"`, see
   * `listTemplates()`) or your own {@link MarkdownTemplate}. A front matter `template:` picks one too; this
   * option wins. Without either the page is the plain GitHub-like one.
   */
  template?: string | MarkdownTemplate;
  /**
   * Document settings that override the front matter (`title`, `author`, `accent`, `font`, `page_size`,
   * `cover`, `stamp`, ...). Precedence: template defaults < front matter < `settings` / the other options.
   */
  settings?: DocumentSettings;
}

export interface TocOptions {
  /** Deepest heading level listed, 1-6. Defaults to 3. */
  depth?: number;
  /** Heading above the list. Defaults to "Contents"; an empty string leaves it out. */
  title?: string;
}

/** One heading of the document, as the table of contents sees it. */
interface TocEntry {
  level: number;
  id: string;
  /** The heading's text as HTML (inline markup kept). */
  html: string;
}

/** A URL-fragment-safe id for a heading: letters (any script), digits, `-` and `_`, spaces as `-`. */
function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PALETTES = {
  light: {
    fg: "#1f2328",
    muted: "#59636e",
    bg: "#ffffff",
    border: "#d1d9e0",
    codeBg: "#f6f8fa",
    link: "#0969da",
    quote: "#59636e",
    keyword: "#cf222e",
    string: "#0a3069",
    comment: "#6e7781",
    number: "#0550ae",
    title: "#8250df",
    tag: "#116329",
    add: "#dafbe1",
    del: "#ffebe9",
  },
  dark: {
    fg: "#e6edf3",
    muted: "#9198a1",
    bg: "#0d1117",
    border: "#3d444d",
    codeBg: "#151b23",
    link: "#4493f8",
    quote: "#9198a1",
    keyword: "#ff7b72",
    string: "#a5d6ff",
    comment: "#8b949e",
    number: "#79c0ff",
    title: "#d2a8ff",
    tag: "#7ee787",
    add: "#12261e",
    del: "#3c1618",
  },
} as const;

/** The built-in GitHub-like stylesheet. Plain selectors only: it has to render in the engine as well. */
export function markdownStylesheet(
  theme: "light" | "dark" = "light",
  padding = 32,
  maxWidth?: number,
  paged = false,
  type: TemplateType = DEFAULT_TYPE,
  accent?: string,
  page?: { size?: string; margin: string },
  mermaid: { theme?: string; mode?: string; directives?: boolean } = {},
): string {
  const c = { ...PALETTES[theme], ...(accent ? { link: accent } : {}) };
  // a named Mermaid theme brings its own colours, so the document's are left out of the diagram's variables
  const mermaidTheme = mermaid.theme && /^[a-z][a-z-]*$/.test(mermaid.theme) ? mermaid.theme : undefined;
  const mermaidMode = mermaid.mode === "compat" || mermaid.mode === "recover" ? mermaid.mode : undefined;
  const head = type.headingFont ?? type.font;
  const headColor = type.accentHeadings && accent ? accent : c.fg;
  const pageRule = page
    ? `@page { ${page.size ? `size: ${page.size}; ` : ""}margin: ${page.margin}; }\n`
    : paged
      ? `@page { margin: ${padding}px; }\n`
      : "";
  return `${pageRule}:root { --accent: ${accent ?? c.link}; --surface: ${c.codeBg}; --border: ${c.border}; --muted: ${c.muted}; --text: ${c.fg}; --page: ${c.bg}; }
html, body { margin: 0; padding: 0; background: ${c.bg}; }
body { color: ${c.fg}; font-family: ${type.font}; font-size: ${type.size}px; line-height: ${type.lineHeight};${type.justify ? " text-align: justify;" : ""} }
.markdown-body { padding: ${paged ? 0 : padding}px;${maxWidth ? ` max-width: ${maxWidth}px; margin: 0 auto;` : ""} }
.markdown-body > *:first-child { margin-top: 0; }
.markdown-body > *:last-child { margin-bottom: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin-top: 24px; margin-bottom: 16px; font-family: ${head}; font-weight: ${type.headingWeight}; line-height: 1.25; text-align: left; color: ${headColor}; }
.markdown-body h1 { font-size: 2em;${type.h1Rule ? ` padding-bottom: 0.3em; border-bottom: 1px solid ${c.border};` : ""}${type.chapterBreak ? " break-before: page;" : ""} }
.markdown-body h2 { font-size: 1.5em;${type.h2Rule ? ` padding-bottom: 0.3em; border-bottom: 1px solid ${c.border};` : ""} }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: 0.875em; }
.markdown-body h6 { font-size: 0.85em; color: ${c.muted}; }
.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote, .markdown-body pre, .markdown-body table { margin-top: 0; margin-bottom: 16px; }
.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li + li { margin-top: 0.25em; }
.markdown-body li > ul, .markdown-body li > ol { margin-top: 0.25em; margin-bottom: 0; }
.markdown-body a { color: ${c.link}; text-decoration: none; }
.markdown-body strong { font-weight: 600; }
.markdown-body blockquote { margin-left: 0; margin-right: 0; padding: 0 1em; color: ${c.quote}; border-left: 4px solid ${c.border}; }
.markdown-body blockquote > *:last-child { margin-bottom: 0; }
.markdown-body code { padding: 0.2em 0.4em; font-family: ${type.mono}; font-size: 85%; background: ${c.codeBg}; border-radius: ${type.radius}px; }
.markdown-body pre { padding: 16px; overflow: hidden; white-space: pre-wrap; word-break: break-all; font-size: 85%; line-height: 1.45; background: ${c.codeBg}; border-radius: ${type.radius}px; text-align: left; }
.markdown-body .diagram { margin: 0 0 16px; text-align: center; }
.markdown-body .mermaid { display: inline-block; margin: 0; color: ${c.fg};${mermaidTheme ? ` --mermaid-theme: ${mermaidTheme};` : ` --mermaid-fg: ${c.fg}; --mermaid-bg: ${c.bg}; --mermaid-border: ${c.border}; --mermaid-surface: ${c.codeBg};`}${mermaidMode ? ` --mermaid-mode: ${mermaidMode};` : ""}${mermaid.directives ? " --mermaid-directives: on;" : ""} }
.markdown-body pre code { padding: 0; font-size: 100%; background: transparent; white-space: pre-wrap; word-break: break-all; }
.markdown-body .hnum { margin-right: 0.4em; }
.markdown-body .callout { margin: 0 0 16px; padding: 10px 16px; border-left: 4px solid ${c.link}; background: ${c.codeBg}; break-inside: avoid; }
.markdown-body .callout > *:last-child { margin-bottom: 0; }
.markdown-body .callout-title { margin: 0 0 4px; font-weight: 700; color: ${c.link}; }
.markdown-body .callout-tip { border-left-color: #16a34a; }
.markdown-body .callout-tip .callout-title { color: #16a34a; }
.markdown-body .callout-important { border-left-color: #8b5cf6; }
.markdown-body .callout-important .callout-title { color: #8b5cf6; }
.markdown-body .callout-warning { border-left-color: #d97706; }
.markdown-body .callout-warning .callout-title { color: #d97706; }
.markdown-body .callout-caution { border-left-color: #dc2626; }
.markdown-body .callout-caution .callout-title { color: #dc2626; }
.markdown-body .figure { margin: 0 0 16px; text-align: center; break-inside: avoid; }
.markdown-body .figure img { max-width: 100%; }
.markdown-body figcaption { margin-top: 6px; font-size: 0.9em; color: ${c.muted}; }
.markdown-body .pagebreak { height: 1px; margin: 0; break-after: page; }
.markdown-body .fnref { font-size: 0.75em; line-height: 0; }
.markdown-body .footnotes { margin-top: 32px; padding-top: 8px; border-top: 1px solid ${c.border}; font-size: 0.9em; color: ${c.muted}; }
.markdown-body .footnotes-title { margin: 0 0 4px; font-weight: 600; }
.markdown-body .footnotes ol { margin: 0; }
.markdown-body hr { height: 0; margin: 24px 0; border: 0; border-top: 4px solid ${c.border}; }
.markdown-body img { max-width: 100%; }
.markdown-body table { border-collapse: collapse;${type.wideTables ? " width: 100%;" : ""} }
.markdown-body th, .markdown-body td { padding: 6px 13px; border: 1px solid ${c.border}; }
.markdown-body th { font-weight: 600;${type.wideTables ? " white-space: nowrap;" : ""} }
.markdown-body tr:nth-child(2n) { background: ${c.codeBg}; }
.markdown-body input[type="checkbox"] { margin: 0 0.4em 0 -1.4em; }
.hljs-keyword, .hljs-doctag, .hljs-template-tag, .hljs-type, .hljs-meta { color: ${c.keyword}; }
.hljs-string, .hljs-regexp, .hljs-symbol { color: ${c.string}; }
.hljs-comment, .hljs-quote { color: ${c.comment}; }
.hljs-number, .hljs-literal, .hljs-attr, .hljs-attribute, .hljs-variable, .hljs-built_in, .hljs-selector-id, .hljs-selector-class, .hljs-params { color: ${c.number}; }
.hljs-title { color: ${c.title}; }
.hljs-name, .hljs-tag, .hljs-selector-tag, .hljs-bullet { color: ${c.tag}; }
.hljs-section { color: ${c.number}; font-weight: 600; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
.hljs-addition { color: ${c.tag}; background: ${c.add}; }
.hljs-deletion { color: ${c.keyword}; background: ${c.del}; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { break-after: avoid; break-inside: avoid; }
.markdown-body .toc { margin: 0 0 24px; break-after: page; }
.markdown-body .toc-title { margin: 0 0 12px; font-size: 1.5em; font-weight: 600; line-height: 1.25; }
.markdown-body .toc-item { display: flex; align-items: baseline; padding: 2px 0; color: ${c.fg}; text-decoration: none; }
.markdown-body .toc-l1 { font-weight: 600; margin-top: 6px; }
.markdown-body .toc-l2 { padding-left: 1.25em; }
.markdown-body .toc-l3 { padding-left: 2.5em; }
.markdown-body .toc-l4, .markdown-body .toc-l5, .markdown-body .toc-l6 { padding-left: 3.75em; }
.markdown-body .toc-leader { flex: 1; min-width: 12px; margin: 0 6px; border-bottom: 1px dotted ${c.muted}; }
.markdown-body .toc-page { min-width: 2.5em; text-align: right; color: ${c.muted}; }
.markdown-body pre, .markdown-body .diagram,.markdown-body table, .markdown-body blockquote, .markdown-body img, .markdown-body tr { break-inside: avoid; }
`;
}

/** The cover: a fixed structure the template's CSS dresses. Its title is not an h1, so it stays out of the outline. */
function coverHtml(settings: DocumentSettings): string {
  const parts = [
    settings.logo ? `<img class="cover-logo" src="${escapeHtml(settings.logo)}" alt="">` : "",
    `<p class="cover-title">${titleHtml(settings.title ?? "")}</p>`,
    settings.subtitle ? `<p class="cover-subtitle">${escapeHtml(settings.subtitle)}</p>` : "",
    settings.author || settings.date
      ? `<p class="cover-meta">${settings.author ? `<span class="cover-author">${escapeHtml(settings.author)}</span>` : ""}${settings.date ? `<span class="cover-date">${escapeHtml(settings.date)}</span>` : ""}</p>`
      : "",
  ];
  const style = settings.cover_style && /^(band|plain|center)$/.test(settings.cover_style) ? ` cover-${settings.cover_style}` : "";
  return `<header class="cover${style}">${parts.join("")}</header>
`;
}

/** Structure of the cover and the first page; templates tune it with their own `css`. */
const COVER_CSS = `.cover { margin: 40mm 0 0; break-after: page; }
.cover-logo { display: block; max-height: 22mm; max-width: 60mm; margin-bottom: 14mm; }
.cover-title { margin: 0; font-size: 2.6em; font-weight: 700; line-height: 1.25; }
.cover-subtitle { margin: 0.6em 0 0; font-size: 1.25em; color: var(--muted, #6b7280); }
.cover-meta { margin: 3em 0 0; color: var(--muted, #6b7280); }
.cover-meta span + span { margin-left: 1.5em; }
.cover.cover-plain { padding: 0; border: 0; }
.cover.cover-center { padding: 0; border: 0; text-align: center; }
.cover.cover-band { padding-left: 14px; border-left: 6px solid var(--accent, #1d4ed8); text-align: left; }
`;

/**
 * The table-of-contents block: a nav with one row per heading. A row is a block link (the whole row
 * is clickable in the PDF) holding the heading, a dotted leader and the page number. The number is
 * an element with data-toc-page, which the PDF renderer fills in once the pages are planned; it has
 * a fixed width so a longer number does not rewrap the row and move the pages.
 */
function tocHtml(entries: TocEntry[], options: TocOptions): string {
  const depth = Math.min(6, Math.max(1, options.depth ?? 3));
  const title = options.title ?? "Contents";
  const rows = entries
    .filter((e) => e.level <= depth)
    .map(
      (e) =>
        `<a class="toc-item toc-l${e.level}" href="#${e.id}"><span class="toc-text">${e.html}</span><span class="toc-leader"></span><span class="toc-page" data-toc-page="${e.id}">0</span></a>`,
    )
    .join("");
  if (!rows) return "";
  return `<nav class="toc">${title ? `<p class="toc-title">${escapeHtml(title)}</p>` : ""}${rows}</nav>
`;
}

/**
 * Convert Markdown (GitHub flavoured, via `marked`) to a complete HTML document with a built-in
 * GitHub-like stylesheet, ready to pass to `render({ value })`.
 */
export function markdownToHtml(markdown: string, options: MarkdownOptions = {}): string {
  return markdownToDocument(markdown, options).html;
}

/** What `render()` needs besides the HTML for the template's running header and footer. */
export interface MarkdownRenderOptions {
  /** The theme's page colour, for a dark theme: the PDF page (margins included) takes it, not only the text area. */
  pdfBackground?: string;
  pdfHeader?: string;
  pdfFooter?: string;
  /** The cover page is printed without header and footer (its number is still counted). */
  pdfSkipRunning?: number;
  pdfTitle?: string;
  pdfAuthor?: string;
}

export interface MarkdownDocument {
  /** The page, ready for `render({ value })`. */
  html: string;
  /** The settings that applied (template defaults < front matter < options), for your own use. */
  settings: DocumentSettings;
  /** Spread into `render()` for a PDF: the template's header and footer, the PDF's title and author. */
  renderOptions: MarkdownRenderOptions;
}

/**
 * Convert Markdown (GitHub flavoured, via `marked`) to a page and the render options that go with it
 * (a template's running header and footer, the PDF's title). {@link markdownToHtml} is the HTML alone.
 */
export function markdownToDocument(markdown: string, options: MarkdownOptions = {}): MarkdownDocument {
  let source = markdown;
  let front: DocumentSettings = {};
  if (options.frontMatter !== false) {
    const m = /^﻿?---[ \t]*\r?\n([^]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
    if (m) {
      source = source.slice(m[0].length);
      front = parseFrontMatter(m[1]);
    }
  }
  // Template defaults < front matter < options.
  const named = (typeof options.template === "string" ? options.template : undefined) ?? front.template;
  const template = resolveTemplate(typeof options.template === "object" ? options.template : named);
  const settings: DocumentSettings = {
    ...template.defaults,
    ...front,
    ...options.settings,
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.toc !== undefined ? { toc: options.toc !== false } : {}),
  };
  // `settings` reports what applied: the template that was used, whichever of the option and the front matter named it.
  if (typeof options.template === "object") delete settings.template;
  else if (named !== undefined) settings.template = named;

  const renderer = new marked.Renderer();
  // Every heading gets an id (a link target, and what the table of contents points at).
  const entries: TocEntry[] = [];
  const usedIds = new Map<string, number>();
  const counters = [0, 0, 0, 0, 0, 0];
  renderer.heading = function ({ tokens, depth, text }) {
    const base = slugify(text);
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen + 1}`;
    let inner = this.parser.parseInline(tokens);
    if (settings.numbering) {
      counters[depth - 1]++;
      for (let k = depth; k < 6; k++) counters[k] = 0;
      inner = `<span class="hnum">${counters.slice(0, depth).map((n) => n || 1).join(".")}</span> ${inner}`;
    }
    entries.push({ level: depth, id, html: inner });
    return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
  };
  renderer.code = ({ text, lang }) => {
    const name = (lang ?? "").trim().split(/\s+/)[0];
    if (name === "mermaid" && options.mermaid !== false) return `<div class="diagram"><div class="mermaid">${escapeHtml(text)}</div></div>\n`;
    const body = options.highlight !== false && name && highlighter.getLanguage(name)
      ? highlighter.highlight(text, { language: name, ignoreIllegals: true }).value
      : escapeHtml(text);
    return `<pre><code${name ? ` class="language-${escapeHtml(name)}"` : ""}>${body}\n</code></pre>\n`;
  };
  // Call-out boxes (`> [!NOTE]`), numbered figures, page breaks and footnotes.
  renderer.blockquote = function ({ tokens }) {
    const body = this.parser.parse(tokens);
    return calloutHtml(body, settings.lang) ?? `<blockquote>
${body}</blockquote>
`;
  };
  let figures = 0;
  const defaultParagraph = renderer.paragraph.bind(renderer);
  renderer.paragraph = function (token) {
    const only = token.tokens.length === 1 ? token.tokens[0] : undefined;
    if (only?.type === "image" && only.title) {
      figures++;
      return `<figure class="figure">${this.parser.parseInline(token.tokens).replace(/ title="[^"]*"/, "")}<figcaption>${figureLabel(figures, settings.lang)}　${escapeHtml(only.title)}</figcaption></figure>
`;
    }
    return defaultParagraph(token);
  };
  renderer.html = ({ text: raw }) => pagebreakHtml(raw) ?? raw;
  const footnotes = createFootnotes();
  source = footnotes.extract(source);
  const parser = new Marked(footnotes.extension, options.math ? mathExtension(options.math) : {});
  const text =
    (parser.parse(source, { async: false, gfm: true, renderer }) as string) +
    footnotes.list((t) => parser.parseInline(t, { async: false, gfm: true }) as string, settings.lang?.toLowerCase().startsWith("ja") ? "脚注" : "Notes", !!options.paged && settings.footnotes === "page");

  const tocOption = options.toc ?? (front.toc !== undefined || template.defaults?.toc !== undefined ? settings.toc : !!options.paged);
  const tocExtras = { ...(settings.toc_depth ? { depth: settings.toc_depth } : {}), ...(settings.toc_title ? { title: settings.toc_title } : {}) };
  const toc = tocOption === true && typeof options.toc === "object" ? options.toc : tocOption === true && Object.keys(tocExtras).length ? tocExtras : tocOption;
  const tocBlock = toc && entries.length ? tocHtml(entries, toc === true ? {} : toc) : "";
  const cover = settings.cover && settings.title ? coverHtml(settings) : "";
  const body = cover + tocBlock + text;

  const type = { ...DEFAULT_TYPE, ...template.type, ...(settings.font ? { font: settings.font } : {}) };
  const page = {
    ...DEFAULT_PAGE,
    ...template.page,
    ...(settings.margin ? { margin: settings.margin } : {}),
    ...(settings.header !== undefined ? { header: settings.header } : {}),
    ...(settings.footer !== undefined ? { footer: settings.footer } : {}),
  };
  // Asking for a page of its own (a header, a footer, a margin or an orientation) makes the document paged like a template does.
  const hasTemplate =
    options.template !== undefined ||
    front.template !== undefined ||
    [settings.header, settings.footer, settings.margin, settings.orientation].some((v) => v !== undefined);
  const withOrientation = (size: string) => (settings.orientation === "landscape" && !/landscape/.test(size) ? `${size} landscape` : size);
  // A plain document keeps the exact page it always had; a template adds its own @page (size and margins).
  const pageSetting = hasTemplate && options.paged !== false
    ? { size: withOrientation(settings.page_size ?? page.size), margin: page.margin }
    : settings.page_size && options.paged
      ? { size: withOrientation(settings.page_size), margin: `${options.padding ?? 32}px` }
      : undefined;
  const sheet =
    options.stylesheet ??
    markdownStylesheet(options.theme, options.padding, options.maxWidth, options.paged, type, settings.accent, pageSetting, {
      theme: settings.mermaid_theme,
      mode: settings.mermaid_mode,
      directives: settings.mermaid_directives,
    });

  const titleText = settings.title;
  const title = titleText ? `<title>${escapeHtml(titleText)}</title>` : "";
  const lang = settings.lang ? ` lang="${escapeHtml(settings.lang)}"` : "";
  const dir = settings.dir ? ` dir="${escapeHtml(settings.dir)}"` : "";
  const html = `<!doctype html><html${lang}${dir}><head><meta charset="utf-8">${title}<style>${sheet}${COVER_CSS}${template.css ?? ""}${options.math?.css ?? ""}${options.css ?? ""}</style></head><body><article class="markdown-body">${body}</article></body></html>`;

  const running = (t: string | undefined) => (t ? fillRunningText(t, settings) : undefined);
  const stamp = settings.stamp ? `<span style="float:right">${escapeHtml(settings.stamp)}</span>` : "";
  const header = hasTemplate ? running(page.header) : settings.stamp ? `<div style="font:11px sans-serif;color:#6b7280;padding-top:8mm;text-align:right">${stamp.replace(/<[^>]+>/g, "")}</div>` : undefined;
  return {
    html,
    settings,
    renderOptions: {
      // The text area takes the page's background from the CSS; the margins need the page itself painted.
      ...(options.paged && options.theme === "dark" && options.stylesheet === undefined ? { pdfBackground: PALETTES.dark.bg } : {}),
      ...(header ? { pdfHeader: header } : {}),
      ...(hasTemplate && page.footer ? { pdfFooter: running(page.footer) } : {}),
      ...(cover && hasTemplate && (header || page.footer) ? { pdfSkipRunning: 1 } : {}),
      ...(settings.title ? { pdfTitle: settings.title.replace(/<br\s*\/?>/gi, " ") } : {}),
      ...(settings.author ? { pdfAuthor: settings.author } : {}),
    },
  };
}
