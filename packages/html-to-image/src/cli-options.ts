/**
 * CLI flag plumbing split from `./cli.ts` (behavior unchanged): input-type
 * detection, local file reading, and the flag -> `render()` option mapping.
 * Kept separate from the executable entry point so the mapping is
 * unit-testable without running the CLI.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isImageInput } from "./input.js";
import type { HtmlToImageOptions, OutputFormat } from "./core.js";
import type { JavaScriptOptions } from "./js-apply.js";
import { MERMAID_THEMES, type MermaidOptions, type MermaidTheme } from "./mermaid.js";

/** Flags as parsed by commander (see `./cli.ts`). */
export interface CliFlags {
  output?: string;
  width: number;
  height?: number;
  format: OutputFormat;
  quality: number;
  /** Explicit `--base-url`; absent means "let the source decide". */
  baseUrl?: string;
  /** `--color-space <srgb|cmyk>`; absent means the default (srgb). */
  colorSpace?: "srgb" | "cmyk";
  /** `--scale <n>`; absent means 1. */
  scale?: number;
  /** `--dpi <n>`; absent means 96 x scale. */
  dpi?: number;
  /** `--animation <duration-ms>`; absent means "no keyframe animation". */
  animation?: number;
  /** `--animation-fps <n>`; defaults to 15 when `--animation` is set. */
  animationFps?: number;
  /**
   * `--animation-loop <n>`; how many times the animated WebP repeats.
   * Absent means infinite (libwebp loop_count 0 = the historical default).
   */
  animationLoop?: number;
  /** `--font <path-or-glob>` (repeatable); local font files to register. */
  font?: string[];
  /** `--js`: run the page's scripts (QuickJS) before rendering. */
  js?: boolean;
  /** `--markdown`: treat the input as Markdown (implied by a `.md` / `.markdown` file). */
  markdown?: boolean;
  /** `--markdown-theme <light|dark>`; absent means light. */
  markdownTheme?: string;
  /** `--template <name|file>`: a bundled template, or a .json / .css file (see `loadTemplate`). */
  template?: string;
  /** `--page-size <A4|A5|...|"210mm 297mm">`. */
  pageSize?: string;
  /** `--accent <colour>`: links, rules and the cover accent. */
  accent?: string;
  /** `--body-font <family>`: the body font of the page. */
  bodyFont?: string;
  /** `--stamp <text>`: printed in the header of every page. */
  stamp?: string;
  /** `--cover` / `--no-cover`. */
  cover?: boolean;
  /** `--no-toc` sets this to false: a PDF from Markdown gets a table of contents by default. */
  toc?: boolean;
  /** `--toc-depth <n>`: deepest heading level in the table of contents (default 3). */
  tocDepth?: number;
  /** `--no-outline` sets this to false: the PDF's bookmarks (outline) are on by default. */
  outline?: boolean;
  /** `--no-math` sets this to false: `$...$` / `$$...$$` are typeset when katex is installed. */
  math?: boolean;
  /** `--markdown-css <path>`: extra stylesheet appended after the built-in one. */
  markdownCss?: string;
  /** `--mermaid`: treat the input as a Mermaid diagram (implied by a `.mmd` / `.mermaid` file). */
  mermaid?: boolean;
  /** `--mermaid-theme <name>`: one of `MERMAID_THEMES`. */
  mermaidTheme?: string;
  /** `--mermaid-mode <strict|compat|recover>`. */
  mermaidMode?: string;
  /** `--mermaid-directives`: honour `%%{init}%%` and frontmatter `config:`. */
  mermaidDirectives?: boolean;
  /** `--js-wait <ms|selector>`: a number is the settle time after load, anything else a CSS selector to wait for. */
  jsWait?: string;
}

/** `--js-wait`: milliseconds to settle after load, or a CSS selector to wait for. */
export function resolveJavaScript(wait: string | undefined): true | JavaScriptOptions {
  if (wait === undefined || wait === "") return true;
  return /^\d+(\.\d+)?$/.test(wait) ? { settleMs: Number(wait) } : { waitFor: wait };
}

/** Default frame rate for `--animation` when `--animation-fps` is omitted. */
export const DEFAULT_ANIMATION_FPS = 15;

/**
 * Animation flags resolved against the output format.
 *
 * Animated WebP is the only animated output the pipeline supports, so
 * `--animation` is ignored (with a warning) for every other format. The
 * boolean `animation: true` image-input path is intentionally not reachable
 * from the CLI: there the object form requests `@keyframes` sampling, which
 * is what `--animation` means.
 */
export interface AnimationResolution {
  /** Resolved `render()` animation option, or absent when disabled/ignored. */
  animation?: { duration: number; fps: number; loop?: number };
  /** Human-readable reason the flag was dropped; callers warn on stderr. */
  warning?: string;
}

/** Map `--animation` / `--animation-fps` / `--animation-loop` to the `render()` animation option. */
export function resolveAnimation(flags: CliFlags): AnimationResolution {
  if (flags.animation === undefined) {
    if (flags.animationFps !== undefined) {
      return { warning: "--animation-fps requires --animation; ignoring." };
    }
    if (flags.animationLoop !== undefined) {
      return { warning: "--animation-loop requires --animation; ignoring." };
    }
    return {};
  }
  if (flags.format !== "webp" && flags.format !== "apng" && flags.format !== "gif") {
    return {
      warning: `--animation is only supported for webp, apng and gif output; ignoring (format=${flags.format}).`,
    };
  }
  // `loop` stays absent unless requested: the render() default (0) is the
  // historical infinite loop, so the option object keeps its old shape.
  const loop =
    flags.animationLoop === undefined
      ? undefined
      : Math.max(0, Math.trunc(flags.animationLoop));
  return {
    animation: {
      duration: flags.animation,
      fps: flags.animationFps ?? DEFAULT_ANIMATION_FPS,
      ...(loop === undefined ? {} : { loop }),
    },
  };
}

const EXTENSION_FORMATS: Record<string, OutputFormat> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  apng: "apng",
  gif: "gif",
  svg: "svg",
  pdf: "pdf",
  tif: "tiff",
  tiff: "tiff",
  avif: "avif",
  jxl: "jxl",
};

/** Output format implied by the output file's extension, if recognised. */
export function inferFormat(output: string | undefined): OutputFormat | undefined {
  if (!output) return undefined;
  const ext = path.extname(output).slice(1).toLowerCase();
  return EXTENSION_FORMATS[ext];
}

/** Whether `input` names an existing file (a Markdown text or HTML string is not a path). */
export async function isFile(input: string): Promise<boolean> {
  try {
    return (await fs.stat(input)).isFile();
  } catch {
    return false;
  }
}

/** Markdown text passed with `--markdown` instead of a file path. */
export async function isInlineMarkdown(input: string, flags: { markdown?: boolean }): Promise<boolean> {
  return !!flags.markdown && input !== "-" && !isUrlInput(input) && !(await isFile(input));
}

/** A `.mmd` / `.mermaid` file path is a Mermaid diagram without `--mermaid`. */
export function isMermaidPath(input: string): boolean {
  return /\.(mmd|mermaid)$/i.test(input) && !isUrlInput(input);
}

/** Mermaid text passed with `--mermaid` instead of a file path. */
export async function isInlineMermaid(input: string, flags: { mermaid?: boolean }): Promise<boolean> {
  return !!flags.mermaid && input !== "-" && !isUrlInput(input) && !(await isFile(input));
}

/** The input is a Mermaid diagram: `--mermaid`, or a `.mmd` / `.mermaid` file. */
export function isMermaidInput(input: string, flags: { mermaid?: boolean }): boolean {
  return !!flags.mermaid || isMermaidPath(input);
}

/** The diagram's source: the text itself (`--mermaid`), stdin (`-`) or a file. */
export async function loadMermaidSource(input: string, flags: { mermaid?: boolean }): Promise<string> {
  if (await isInlineMermaid(input, flags)) return input;
  if (input === "-") return readStdin();
  return fs.readFile(input, "utf-8");
}

/** The `renderMermaid` options the flags ask for; an unknown theme or mode is an error that lists the choices. */
export function mermaidOptionsFromFlags(flags: CliFlags, widthGiven: boolean): MermaidOptions {
  const themes = Object.keys(MERMAID_THEMES);
  if (flags.mermaidTheme !== undefined && !themes.includes(flags.mermaidTheme)) {
    throw new Error(`unsupported mermaid theme "${flags.mermaidTheme}". Choose from: ${themes.join(", ")}`);
  }
  if (flags.mermaidMode !== undefined && !["strict", "compat", "recover"].includes(flags.mermaidMode)) {
    throw new Error(`unsupported mermaid mode "${flags.mermaidMode}". Choose from: strict, compat, recover`);
  }
  return {
    format: flags.format,
    ...(flags.mermaidTheme ? { theme: flags.mermaidTheme as MermaidTheme } : {}),
    ...(flags.mermaidMode ? { mode: flags.mermaidMode as "strict" | "compat" | "recover" } : {}),
    ...(flags.mermaidDirectives ? { directives: true } : {}),
    ...(flags.accent ? { accent: flags.accent } : {}),
    ...(widthGiven && flags.width ? { width: flags.width } : {}),
  };
}

/** A `.md` / `.markdown` file path is Markdown input without `--markdown`. */
export function isMarkdownPath(input: string): boolean {
  return /\.(md|markdown)$/i.test(input) && !isUrlInput(input);
}

/** Convert Markdown text to a styled HTML document (`marked` is an optional dependency). */
export async function convertMarkdown(
  markdown: string,
  flags: CliFlags,
): Promise<{ html: string; renderOptions: import("./markdown.js").MarkdownRenderOptions }> {
  let mod: typeof import("./markdown.js");
  try {
    mod = await import("./markdown.js");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw e;
    throw new Error(
      "Markdown input needs the optional dependency `marked`. Install it with `npm i marked`.",
    );
  }
  const theme = flags.markdownTheme?.toLowerCase();
  if (theme !== undefined && theme !== "light" && theme !== "dark") {
    throw new Error(`unsupported markdown theme "${flags.markdownTheme}". Choose from: light, dark`);
  }
  const css = flags.markdownCss ? await fs.readFile(flags.markdownCss, "utf-8") : undefined;
  const settings = {
    ...(flags.pageSize !== undefined ? { page_size: flags.pageSize } : {}),
    ...(flags.accent !== undefined ? { accent: flags.accent } : {}),
    ...(flags.bodyFont !== undefined ? { font: flags.bodyFont } : {}),
    ...(flags.stamp !== undefined ? { stamp: flags.stamp } : {}),
    ...(flags.cover !== undefined ? { cover: flags.cover } : {}),
  };
  const template = flags.template !== undefined ? await loadTemplate(flags.template) : undefined;
  return mod.markdownToDocument(markdown, {
    theme,
    css,
    ...(template !== undefined ? { template } : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
    paged: flags.format === "pdf",
    // Default: a table of contents in a PDF (markdownToHtml's own default), none in an image.
    ...(flags.toc === false ? { toc: false } : flags.tocDepth !== undefined ? { toc: { depth: flags.tocDepth } } : {}),
    ...(flags.math === false ? {} : await loadMath()),
  });
}

/**
 * `--template`: a bundled name, or a file. A `.json` file is a {@link MarkdownTemplate} (`type`, `page`,
 * `defaults`, `css`); a `.css` file is extra CSS laid over the default template.
 */
export async function loadTemplate(
  spec: string,
): Promise<string | import("./markdown-template.js").MarkdownTemplate> {
  if (!/\.(json|css)$/i.test(spec)) return spec; // a name: resolveTemplate reports an unknown one
  const text = await fs.readFile(spec, "utf-8");
  if (/\.css$/i.test(spec)) return { description: spec, css: text };
  try {
    return JSON.parse(text) as import("./markdown-template.js").MarkdownTemplate;
  } catch (e) {
    throw new Error(`template ${spec} is not valid JSON: ${(e as Error).message}`);
  }
}

/** KaTeX maths for the Markdown, or nothing when `katex` is not installed (it is optional). */
async function loadMath(): Promise<{ math?: import("./markdown-math.js").MathRenderer }> {
  try {
    const { katexMath } = await import("./markdown-math.js");
    return { math: katexMath() };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") return {};
    throw e;
  }
}

/** Inline markup passed on the command line (as opposed to a path or URL). */
export function isInlineHtml(input: string): boolean {
  return input.trimStart().startsWith("<");
}

/** Read all of standard input as UTF-8 text. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

/** Expand `*` / `?` in the last path segment; other patterns are literal paths. */
export async function expandGlob(pattern: string): Promise<string[]> {
  if (!/[*?]/.test(pattern)) return [pattern];
  const dir = path.dirname(pattern);
  const re = new RegExp(
    "^" +
      path
        .basename(pattern)
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  );
  const names = await fs.readdir(dir);
  return names
    .filter((n) => re.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

/**
 * Load `--font` files. Each is named after its file (without extension), or after the family
 * given as `Family Name=path` (use it to stand in for a system font such as `Segoe UI`).
 */
export async function loadFonts(
  patterns: string[],
): Promise<{ name: string; data: Uint8Array }[]> {
  const fonts: { name: string; data: Uint8Array }[] = [];
  for (const spec of patterns) {
    // `Family=path`: a drive letter (`C:\...`) has no `=`, so the first `=` splits family and path.
    const eq = spec.indexOf("=");
    const family = eq > 0 ? spec.slice(0, eq).trim() : undefined;
    const pattern = eq > 0 ? spec.slice(eq + 1) : spec;
    const files = await expandGlob(pattern);
    if (files.length === 0) {
      console.warn(`wasm-html-to-image: no font files match "${pattern}"`);
    }
    for (const file of files) {
      fonts.push({
        name: family ?? path.basename(file, path.extname(file)),
        data: new Uint8Array(await fs.readFile(file)),
      });
    }
  }
  return fonts;
}

/**
 * URL inputs are fetched, not read from disk. `data:` URLs stay values so
 * image inputs keep flowing through the converter pipeline.
 */
export function isUrlInput(input: string): boolean {
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(input);
  return (
    !isWindowsPath &&
    /^[a-z][a-z0-9+.-]*:/i.test(input) &&
    !input.startsWith("data:")
  );
}

/**
 * Read a local input file as binary; image files (magic-byte sniffed) are
 * passed through as bytes, everything else as UTF-8 text (HTML).
 */
export async function readInput(
  input: string,
): Promise<{ value: string | Uint8Array; baseUrl: string }> {
  const data = await fs.readFile(input);
  let value: string | Uint8Array = data.toString("utf-8");
  try {
    if (isImageInput(data)) value = data;
  } catch {
    // Unknown binary magic -> treat as text and let rendering decide.
  }
  return { value, baseUrl: path.dirname(path.resolve(input)) };
}

/**
 * Map CLI flags to `render()` options.
 *
 * `--base-url` is the only way to pin the base: without it a URL input leaves
 * `baseUrl` unset so relative resources follow the post-redirect final URL
 * (`resolveHtmlSource`), while a file input falls back to its own directory.
 */
export async function buildRenderOptions(
  input: string,
  flags: CliFlags,
): Promise<HtmlToImageOptions> {
  const markdown = flags.markdown || isMarkdownPath(input);
  // `--markdown` takes a file path, `-` (stdin) or the Markdown text itself.
  const inlineMarkdown = await isInlineMarkdown(input, flags);
  let source = inlineMarkdown || isInlineHtml(input)
    ? { value: input, baseUrl: process.cwd() }
    : input === "-"
      ? { value: await readStdin(), baseUrl: process.cwd() }
      : isUrlInput(input)
        ? { url: input }
        : await readInput(input);
  // A template's running header / footer and the PDF's title and author travel with the page.
  let templateOptions: import("./markdown.js").MarkdownRenderOptions = {};
  if (markdown && "value" in source && typeof source.value === "string") {
    const converted = await convertMarkdown(source.value, flags);
    source = { ...source, value: converted.html };
    templateOptions = converted.renderOptions;
  }
  const fonts = flags.font?.length ? await loadFonts(flags.font) : [];
  const { animation, warning } = resolveAnimation(flags);
  if (warning) console.warn(`wasm-html-to-image: ${warning}`);
  return {
    width: flags.width,
    height: flags.height,
    format: flags.format,
    quality: flags.quality,
    ...source,
    ...templateOptions,
    ...(flags.baseUrl !== undefined ? { baseUrl: flags.baseUrl } : {}),
    ...(flags.colorSpace !== undefined ? { colorSpace: flags.colorSpace } : {}),
    ...(flags.scale !== undefined ? { scale: flags.scale } : {}),
    ...(flags.dpi !== undefined ? { dpi: flags.dpi } : {}),
    ...(animation ? { animation } : {}),
    ...(fonts.length ? { fonts } : {}),
    ...(flags.js ? { javascript: resolveJavaScript(flags.jsWait) } : {}),
    ...(flags.outline === false ? { pdfOutline: false } : {}),
  };
}
