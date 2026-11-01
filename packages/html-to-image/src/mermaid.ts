/**
 * Mermaid diagrams as images or SVG. The engine draws `<div class="mermaid">` itself (flowchart, sequence,
 * state, class, ER, pie and xy charts); this module wraps a diagram source in a small page and renders it,
 * sized to the diagram.
 *
 * ```ts
 * import { renderMermaid } from "wasm-html-to-image";
 *
 * const { data: svg } = await renderMermaid("graph LR\n  A --> B"); // an SVG string
 * const { data: png } = await renderMermaid("graph LR\n  A --> B", { format: "png", theme: "dark" });
 * ```
 */

import type { HtmlToImageOptions, OutputFormat, RenderResult } from "./core.js";
import { LogLevel } from "./diagnostics.js";

export interface MermaidOptions {
  /** Colour scheme: a key of {@link MERMAID_THEMES}. Defaults to `"light"`. */
  theme?: MermaidTheme;
  /** Output format. Defaults to `"svg"` (a string); `"png"`, `"webp"`, `"pdf"`, ... give bytes. */
  format?: OutputFormat;
  /** Space around the diagram in px. Defaults to 16. */
  padding?: number;
  /** Image width in px. Defaults to the diagram's width plus the padding. */
  width?: number;
  /** Page background: a CSS colour, or `"transparent"`. Defaults to the theme's background for raster output, transparent for SVG. */
  background?: string;
  /** The accent colour of the diagram (arrows, bars); the theme's derived colour when omitted. */
  accent?: string;
  /**
   * How much a broken source is forgiven. `"strict"` (default) reports every mistake; `"compat"` also accepts a
   * keyword in the wrong case and unfinished `end` / `}` blocks; `"recover"` also fixes a misspelt keyword and skips
   * lines the diagram cannot read. What was repaired is left in the SVG as a leading `<!-- recovered: ... -->` comment.
   */
  mode?: "strict" | "compat" | "recover";
  /** Honour `%%{init: {...}}%%` and frontmatter `config:` (theme, themeVariables) written in the source. Off by default. */
  directives?: boolean;
  /**
   * Called with what went wrong or was repaired: `MERMAID_ERROR` when the source did not parse (the image then
   * shows an error box), and one `MERMAID_RECOVERED` per change the `compat` / `recover` mode made.
   */
  onWarning?: (warning: MermaidWarning) => void;
  /** The most lines of text a diagram may have (comments and blank lines are free). Default 2000; 0 lifts the limit. */
  maxLines?: number;
  /** The largest diagram source in bytes. Default 200000; 0 lifts the limit. */
  maxSourceBytes?: number;
}

/** One thing the engine reported about a diagram: `code` is `MERMAID_ERROR` or `MERMAID_RECOVERED`. */
export interface MermaidWarning {
  code: "MERMAID_ERROR" | "MERMAID_RECOVERED";
  message: string;
}

/** What a render function takes: `render` of `wasm-html-to-image`, or `htmlToImage` with its module applied. */
export type RenderFn = (options: HtmlToImageOptions) => Promise<RenderResult<Uint8Array | string>>;

/**
 * The themes, by name. The engine owns the palette (`--mermaid-theme`); `fg` and `bg` are the text and
 * background colour of the theme, for the page that holds the diagram. `light`, `dark`, `neutral` and
 * `forest` follow the official Mermaid themes of those names (`default` is `light`).
 */
export const MERMAID_THEMES = {
  light: { fg: "#333333", bg: "#ffffff" },
  dark: { fg: "#cccccc", bg: "#333333" },
  neutral: { fg: "#000000", bg: "#ffffff" },
  forest: { fg: "#000000", bg: "#ffffff" },
  nord: { fg: "#eceff4", bg: "#2e3440" },
  dracula: { fg: "#f8f8f2", bg: "#282a36" },
  "solarized-light": { fg: "#586e75", bg: "#fdf6e3" },
  "solarized-dark": { fg: "#93a1a1", bg: "#002b36" },
  "rose-pine": { fg: "#e0def4", bg: "#191724" },
  sepia: { fg: "#433422", bg: "#f4ecd8" },
} as const;

export type MermaidTheme = keyof typeof MERMAID_THEMES;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The page that holds one diagram, for `render({ value, ... })`. */
export function mermaidToHtml(source: string, options: Pick<MermaidOptions, "theme" | "padding" | "background" | "accent" | "mode" | "directives" | "maxLines" | "maxSourceBytes"> & { raster?: boolean } = {}): string {
  const theme = options.theme ?? "light";
  const c: { fg: string; bg: string } = MERMAID_THEMES[theme];
  if (!c) throw new Error(`unknown mermaid theme "${options.theme}". Choose from: ${Object.keys(MERMAID_THEMES).join(", ")}`);
  const padding = options.padding ?? 16;
  const background = options.background ?? (options.raster ? c.bg : "transparent");
  const accent = (options.accent ? ` --mermaid-accent: ${options.accent};` : "") + (options.mode && options.mode !== "strict" ? ` --mermaid-mode: ${options.mode};` : "") + (options.directives ? " --mermaid-directives: on;" : "") + (options.maxLines !== undefined ? ` --mermaid-max-lines: ${Math.max(0, Math.floor(options.maxLines))};` : "") + (options.maxSourceBytes !== undefined ? ` --mermaid-max-bytes: ${Math.max(0, Math.floor(options.maxSourceBytes))};` : "");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html, body { margin: 0; padding: 0; background: ${background}; }` +
    `body { padding: ${padding}px; }` +
    `.mermaid { display: inline-block; color: ${c.fg}; --mermaid-theme: ${theme};${accent} }` +
    `</style></head><body><div class="mermaid">${escapeHtml(source)}</div></body></html>`
  );
}

/** The width and height of the diagram in an SVG that was rendered from {@link mermaidToHtml}. */
function diagramSize(svg: string): { width: number; height: number } | undefined {
  const m = /<svg\b[^>]*?\bwidth="([\d.]+)"[^>]*?\bheight="([\d.]+)"/.exec(svg.slice(svg.indexOf("</defs>")));
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/** The width the probe render lays the page out at: wider than any diagram the page itself would clip. */
const PROBE_WIDTH = 4096;

/**
 * The SVG of a page rendered at {@link PROBE_WIDTH}, made the SVG of the same page rendered at `width`: the two differ only in
 * the width of the outermost `<svg>` (the diagram sits at the page's left edge and paints nothing else). Undefined when that
 * does not hold, for instance with a page background, which is painted across the whole width.
 */
function refit(svg: string, width: number): string | undefined {
  const root = /<svg\b[^>]*>/.exec(svg);
  if (!root || !root[0].includes(`width="${PROBE_WIDTH}"`)) return undefined;
  const rest = svg.slice(root.index + root[0].length);
  if (rest.includes(`"${PROBE_WIDTH}"`)) return undefined;
  return svg.slice(0, root.index) + root[0].replace(`width="${PROBE_WIDTH}"`, `width="${width}"`) + rest;
}

/**
 * The log options that pass the engine's Mermaid messages on to `onWarning`. The engine reports repairs and errors through its
 * log; the page is laid out more than once and each pass draws the diagram again, so each message is passed on once.
 */
export function mermaidListen(
  onWarning: MermaidOptions["onWarning"],
  base: Pick<HtmlToImageOptions, "logLevel" | "onLog"> = {},
): Pick<HtmlToImageOptions, "logLevel" | "onLog"> {
  if (!onWarning) return {};
  const told = new Set<string>();
  return {
    logLevel: Math.max(base.logLevel ?? LogLevel.Warning, LogLevel.Warning),
    onLog: (level: LogLevel, text: string) => {
      base.onLog?.(level, text);
      const m = /^\[(MERMAID_ERROR|MERMAID_RECOVERED)\]\s*(.*)$/.exec(text);
      if (m && !told.has(text)) {
        told.add(text);
        onWarning({ code: m[1] as MermaidWarning["code"], message: m[2] });
      }
    },
  };
}

/** What `render({ mermaid })` takes: the diagram's source and how to draw it. `width` and `format` are the render options'. */
export interface MermaidInput extends Omit<MermaidOptions, "format" | "width"> {
  /** The Mermaid source. */
  source: string;
}

/**
 * Render the Mermaid diagram of `options.mermaid` with `render`, which draws a page (`htmlToImage` with its module applied).
 * The page is first laid out wide to learn the diagram's size, then rendered at exactly that width (unless `width` is
 * given), so the result has no stray margin. The other render options (fonts, limits, logging, ...) reach both passes.
 */
export async function renderMermaidInput(
  render: RenderFn,
  options: HtmlToImageOptions & { mermaid: MermaidInput },
): Promise<RenderResult<Uint8Array | string>> {
  const { mermaid: input, ...rest } = options;
  const format = options.format ?? "svg";
  const padding = input.padding ?? 16;
  const raster = format !== "svg";
  const value = mermaidToHtml(input.source, { ...input, raster });
  const listen = mermaidListen(input.onWarning, rest);
  let width = options.width;
  if (width === undefined) {
    // laid out wide first to learn the diagram's size; an SVG with a transparent page needs nothing more than that width
    // changed in its first tag, so that one render is the answer (a raster image has to be drawn at its own width)
    const probe = await render({ ...rest, ...listen, value, width: PROBE_WIDTH, format: "svg" });
    const size = typeof probe.data === "string" ? diagramSize(probe.data) : undefined;
    width = size ? Math.ceil(size.width + 2 * padding) : 800;
    if (!raster && size && width <= PROBE_WIDTH && input.background === undefined) {
      const fitted = refit(probe.data as string, width);
      if (fitted !== undefined) return { ...probe, data: fitted, width };
    }
  }
  return render({ ...rest, ...listen, value, width, format });
}

/** The shape of `renderMermaid` in each entry point: SVG text by default, bytes for the other formats. */
export interface RenderMermaid {
  (source: string, options?: MermaidOptions & { format?: "svg" }): Promise<RenderResult<string>>;
  (source: string, options: MermaidOptions): Promise<RenderResult<Uint8Array | string>>;
}

/** `renderMermaid(source, options)` as a call of an entry point's `render`: `render({ mermaid: { source, ... }, format, width })`. */
export function mermaidRenderOptions(source: string, options: MermaidOptions = {}): HtmlToImageOptions & { mermaid: MermaidInput } {
  const { format, width, ...rest } = options;
  return { mermaid: { ...rest, source }, format, width };
}
