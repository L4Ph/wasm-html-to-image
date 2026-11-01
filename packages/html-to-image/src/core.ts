import type { HtmlToImageModule } from "./loader.js";
import { buildFullSatoruOptions } from "./encode-args.js";
import { renderMermaidInput, type MermaidInput } from "./mermaid.js";
import { imageBytesFromUnknown, isImageInput, sniffImageFormat } from "./input.js";
import { svgHasText, svgIntrinsicSize, svgPage } from "./svg-input.js";
import {
  DIAGNOSTIC_CODES,
  LogLevel,
  type DiagnosticMessage,
  type FontDiagnostic,
  type RenderDiagnostics,
  type RenderLimits,
  type ResolveResourceHook,
  type ResourceDiagnostic,
} from "./diagnostics.js";
import {
  createOrchestration,
  resolveHtmlSource,
  runImageInput,
  tryRunHtmlInstance,
  tryRunLegacyFallback,
} from "./core-orchestrate.js";

// Backward compatibility: `isImageInput` now lives in `./input.js` but
// stays importable from here (and therefore from the package root).
export { isImageInput };

// Playground parity: diagnostics surface lives in `./diagnostics.js` but
// stays importable from here (and therefore from `./workers`).
export { DIAGNOSTIC_CODES, LogLevel };
export type {
  DiagnosticMessage,
  FontDiagnostic,
  RenderDiagnostics,
  RenderLimits,
  ResolveResourceHook,
  ResourceDiagnostic,
} from "./diagnostics.js";

// Backward compatibility: binding-name type now lives in
// `./core-orchestrate.js` but stays importable from here.
export type { WasmBindingName } from "./core-orchestrate.js";

/**
 * Final output formats. Single-WASM internal routing:
 * - HTML input: resources are resolved on the instance first
 *   (`satoru_collect_resources` -> fetch -> `satoru_add_resource`), then
 *   `satoru_render` direct (svg/pdf) or `satoru_render` PNG intermediate ->
 *   `converter_encode`. The unified `html_to_image` binding is only a legacy
 *   fallback for builds without instance render bindings.
 * - Image input: render stage skipped, straight to `converter_*`
 *   (`converter_load_image` -> optional crop/resize -> `converter_encode`,
 *   or `converter_encode_svg` / `converter_encode_pdf`).
 */
export type OutputFormat =
  | "svg"
  | "png"
  | "pdf"
  | "jpeg"
  | "webp"
  | "apng"
  | "gif"
  | "tiff"
  | "avif"
  | "jxl"
  | "raw"
  | "thumbhash"
  | "none";

/** Result of rendering an HTML document or converting an image. */
export interface RenderResult<T = Uint8Array | string> {
  /** Output binary or text (string for svg, Uint8Array for all others). */
  data: T;
  /** Result image width in pixels. */
  width: number;
  /** Result image height in pixels. */
  height: number;
  /** Output format. */
  format: OutputFormat;
  /** Original input image width (image inputs only). */
  originalWidth?: number;
  /** Original input image height (image inputs only). */
  originalHeight?: number;
  /** Original input image format (image inputs only). */
  originalFormat?: string;
  /** Whether the original input image is animated (image inputs only). */
  originalAnimation?: boolean;
  /** Whether the output is animated. */
  animation?: boolean;
}

/**
 * Render input (self-defined; no `satoru-render` dependency).
 * `value` accepts HTML (`string` / `string[]`), a `data:image/` URL string,
 * or raw image bytes (`Uint8Array` / `ArrayBuffer`).
 * Extra keys are passed through to the WASM binding options object.
 */
export interface RenderOptions {
  value?: string | string[] | Uint8Array | ArrayBuffer;
  url?: string;
  baseUrl?: string;
  /** Layout viewport width in CSS px (HTML) or target width (image resize). Defaults to 800. */
  width?: number;
  height?: number;
  format?: OutputFormat;
}

/**
 * Unified options for HTML and image inputs.
 *
 * - HTML input: `width`/`height` are the layout viewport; `crop`/`fit`
 *   are forwarded to the satoru render options.
 * - Image input: render stage is skipped; `width`/`height`/`crop`/`fit`
 *   are applied as output resize on the encode stage.
 */
/** One element's border box from `onLayout` (page coordinates, CSS px). */
export interface LayoutBox {
  /** Path of element-child indexes from the root, e.g. "0.1.3". */
  p: string;
  /** Lower-case tag name. */
  t: string;
  /** `id` attribute ("" when absent). */
  i: string;
  /** `class` attribute, truncated ("" when absent). */
  c: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HtmlToImageOptions extends RenderOptions {
  /**
   * Render a Mermaid diagram instead of `value` / `url`: `{ source, theme, padding, ... }` (see `MermaidInput`). The image is sized to the
   * diagram unless `width` is given; `format` defaults to `"svg"`. The other options (fonts, limits, logging, ...) apply as for a page.
   */
  mermaid?: MermaidInput;
  /**
   * Run the page's scripts before rendering (Node only; `single` entry point and the CLI's `--js`).
   * The page is loaded into jsdom (optional dependency `jsdom`), its scripts run, and the resulting
   * DOM is rendered. `true` waits for `load` plus 1 s; pass `{ timeout, settleMs, waitFor }` to tune it.
   * jsdom has no layout and is not a security sandbox: only use it with pages you trust.
   */
  javascript?: boolean | import("./js-page.js").JavaScriptOptions;
  /** Encode quality 0-100 (encode stage only, default 85; ignored for svg/pdf). */
  quality?: number;
  /** Encode speed 0-10 for AVIF, JXL and animated (lossy) WebP (encode stage only; default 8 for AVIF, 6 otherwise). Animated WebP uses libwebp method `8 - speed`: the default 6 is method 2, 5 is method 3 (Skia's, smaller by ~4%), 9 is method 0 (fastest, ~30% larger). */
  speed?: number;
  /**
   * Animation handling.
   * - `true`: keep animation frames where supported (image input / encode stage).
   * - `{ duration, fps, loop }` (HTML input only): sample the document's
   *   `@keyframes` animation into frames. `duration` is one loop length in ms
   *   (clamped to 5000), `fps` defaults to 15 (frame count capped at ~75).
   *   The CSS `animation-duration` (including the `animation` shorthand)
   *   is the length of one iteration; `animation-delay` /
   *   `animation-iteration-count` define the sampled timeline, capped by
   *   `duration`; `fps` is the upper frame rate. `loop` is how many times the
   *   animated WebP / APNG / GIF repeats: `0` (the default) means infinite, `1` means play
   *   once. `opacity`, `transform` (`translate` / `rotate` / `scale` only) and
   *   `color` / `background-color` keyframes are animated; their values may
   *   use `var()` (resolved against the element's custom properties).
   *   `animation-timing-function` (per keyframe or element-level:
   *   `linear` / `ease*` / `cubic-bezier()` / `steps()` / `step-*`),
   *   `animation-direction` and `animation-fill-mode` are honoured.
   *   Several animations on one element (`animation-name: a, b`) are out of
   *   scope.
   */
  animation?: boolean | { duration: number; fps?: number; loop?: number };
  /** Crop rectangle (encode stage for image input, render options for HTML). */
  crop?: { x: number; y: number; width: number; height: number };
  /** Resize strategy (encode stage for image input, render options for HTML). */
  fit?: "contain" | "cover" | "fill";
  /**
   * Generic family -> font URL map (upstream `DEFAULT_FONT_MAP` strategy).
   * Applied via `satoru_set_font_map` before resource discovery, so
   * `@font-face`-less text (sans-serif/serif/...) resolves through Google
   * Fonts instead of rendering blank. Defaults to `DEFAULT_FONT_MAP`.
   */
  fontMap?: Record<string, string>;
  /** User-Agent for resource fetches (default: Chrome, for woff2 CSS). */
  userAgent?: string;
  /**
   * User-supplied fallback font(s), applied to the instance before resource
   * discovery (upstream `fallbackFonts` idiom). Entries may be raw bytes
   * (`Uint8Array` / `ArrayBuffer`), a `data:` URL, or a fetchable URL
   * (http(s) or baseUrl-relative file on Node).
   */
  fallbackFonts?: (Uint8Array | ArrayBuffer | string)[];
  /**
   * Log severity gate for `onLog` (satoru `LogLevel` parity; default
   * `None` silences all JS-side log calls). Also forwarded to the WASM
   * `satoru_set_log_level` binding when set.
   */
  logLevel?: LogLevel;
  /** JS-side log hook, called at stage boundaries, warnings, and errors. */
  onLog?: (level: LogLevel, message: string) => void;
  /** Collect a full `RenderDiagnostics` report (delivered to `onDiagnostics`). */
  diagnostics?: boolean;
  /** Receives the diagnostics report when `diagnostics` is enabled. */
  onDiagnostics?: (report: RenderDiagnostics) => void;
  /**
   * Debug aid for comparing against a reference browser: receives every laid-out element's border
   * box in page coordinates (HTML input only; `html-to-image` instance pipeline). `p` is the
   * element's path among element children of the shadow-flattened tree ("0.1.3"), so a browser
   * walk produces the same keys. Inline boxes are omitted except replaced ones (img, svg, ...).
   */
  onLayout?: (boxes: LayoutBox[]) => void;
  /**
   * Override hook for resource resolution, applied to every fetch path
   * (discovery fetches, fallback-font URLs, HTML `url` fetch). Return
   * bytes to inject, or `null` to skip the resource.
   */
  resolveResource?: ResolveResourceHook;
  /** Media type for CSS `@media` queries (default `"screen"`). */
  mediaType?: "screen" | "print";
  /** Render SVG text as paths (default `true`, satoru parity). */
  textToPaths?: boolean;
  /** Extra CSS pre-scanned on the instance before discovery. */
  css?: string;
  /** Named fonts pre-loaded on the instance before discovery. */
  fonts?: { name: string; data: Uint8Array }[];
  /** Safety/performance limits, enforced in JS around resource resolution. */
  limits?: RenderLimits;
  /**
   * Pixel density of raster output from HTML input (default `1`). The page is laid out at
   * `width` CSS px and drawn `scale` times larger, so `scale: 3.125` turns an 800px layout
   * into a 2500px bitmap (300 dpi for an 8.33in page) with text and shapes re-rasterized
   * sharply. `width` / `height` / `crop` stay in CSS px; the result's `width` / `height` are
   * the bitmap size. Range 0-16; ignored for `svg` / `pdf` and for image input.
   */
  scale?: number;
  /**
   * Resolution written to the `tiff` file, in pixels per inch (default `96 * scale`, rounded:
   * one CSS px is 1/96 in). A print shop reads the physical size from it.
   */
  dpi?: number;
  /**
   * Output color space of `tiff` and `pdf` (default `"srgb"`).
   *
   * - `"srgb"`: RGB (TIFF keeps the alpha channel).
   * - `"cmyk"`: CMYK for print. TIFF is written as a separated image with transparency
   *   flattened onto white; PDF has every fill / stroke color and image rewritten to
   *   DeviceCMYK. The conversion is the plain device formula (K = 1 - max(R, G, B), pure
   *   black stays K only); it applies no ICC profile, so saturated screen colors are not
   *   gamut-mapped. Other formats ignore it.
   */
  colorSpace?: "srgb" | "cmyk";
  /**
   * PDF outline (bookmarks) built from the document's `h1`-`h6`. On by default; `false` leaves it out.
   */
  pdfOutline?: boolean;
  /**
   * PDF page background, painted over the whole page (margins included) before the content: `#rrggbb`
   * or `#rrggbbaa`. Without it only the content area takes the document's `background`, so a dark page
   * would show white margins. Other formats ignore it.
   */
  pdfBackground?: string;
  /** PDF Title metadata. */
  pdfTitle?: string;
  /** PDF Author metadata. */
  pdfAuthor?: string;
  /** PDF Subject metadata. */
  pdfSubject?: string;
  /** PDF Keywords metadata. */
  pdfKeywords?: string;
  /** PDF Creator metadata. */
  pdfCreator?: string;
  /** PDF Producer metadata. */
  pdfProducer?: string;
  /** PDF page margins in pixels. */
  pdfMargin?: { top?: number; right?: number; bottom?: number; left?: number };
  /** PDF header HTML template. */
  pdfHeader?: string;
  /** PDF footer HTML template. */
  pdfFooter?: string;
  /** Number of leading PDF pages printed without header and footer (a cover, a contents page). Defaults to 0. */
  pdfSkipRunning?: number;
  /** Extra keys are forwarded to the WASM render options object. */
  [key: string]: unknown;
}

const EMOJI_URL =
  "https://cdn.jsdelivr.net/npm/@fontsource/noto-color-emoji/files/noto-color-emoji-emoji-400-normal.woff2";

/**
 * Upstream default font strategy (verbatim from satoru `DEFAULT_FONT_MAP`):
 * generic families resolve to Google Fonts css2 URLs (fetched with a browser
 * UA so woff2 is served); fetched at render time, nothing bundled.
 */
export const DEFAULT_FONT_MAP: Record<string, string> = {
  "sans-serif": "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900",
  serif: "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@200..900",
  monospace: "https://fonts.googleapis.com/css2?family=M+PLUS+1+Code",
  cursive: "https://fonts.googleapis.com/css2?family=Yuji+Syuku",
  fantasy: "https://fonts.googleapis.com/css2?family=Reggae+One",
  "Noto Color Emoji": EMOJI_URL,
  emoji: EMOJI_URL,
  "Noto Emoji": EMOJI_URL,
  notocoloremoji: EMOJI_URL,
  notoemoji: EMOJI_URL,
};

/**
 * Render HTML — or convert an image — through the single unified WASM
 * module. Image input skips the render stage and goes straight to
 * `converter_encode`. Returns bytes (`Uint8Array`); only `svg` resolves
 * to `string`.
 *
 * Thin orchestration: context comes from `./core-orchestrate.ts`, resource
 * discovery from `./core-resources.ts`, satoru options from
 * `./encode-args.ts` (canonical builder). Branch selection uses
 * `isImageInput` (`./input.ts`).
 */
export async function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions & { format: "svg" },
): Promise<RenderResult<string>>;
export async function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>>;
export async function htmlToImage(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>> {
  if (options.mermaid) return renderMermaidInput((o) => htmlToImage(module, o), { ...options, mermaid: options.mermaid });
  const orch = createOrchestration(module, options);
  const { format, width, emitLog, logged, loggedBinding } = orch;
  emitLog(LogLevel.Info, `render start: format=${format} width=${width}`);

  // ---- Image input: skip rendering, straight to converter_* ----
  if (isImageInput(options.value)) {
    // An SVG with text goes through the page pipeline first: the converter has no fonts to draw it with.
    if (format !== "none") {
      const bytes = imageBytesFromUnknown(options.value);
      const text = sniffImageFormat(bytes) === "svg" ? new TextDecoder().decode(bytes) : "";
      if (text && svgHasText(text)) {
        const size = svgIntrinsicSize(text);
        const drawn = await htmlToImage(module, {
          ...options,
          value: svgPage(bytes, size),
          width: Math.ceil(size.width),
          height: Math.ceil(size.height),
          format: "png",
          crop: undefined,
          fit: undefined,
          scale: undefined,
        });
        const out = await htmlToImage(module, { ...options, value: drawn.data as Uint8Array });
        return { ...out, originalFormat: "svg" };
      }
    }
    return runImageInput(module, options.value, orch);
  }

  // ---- HTML input: resolve resources on the instance, then render ----
  // (unified `html_to_image` builds its own instance internally and cannot
  // see pre-resolved fonts/images, so it is only a legacy fallback here).
  if (format === "none") {
    throw logged(
      "wasm-html-to-image: 'none' format is only supported for image inputs",
    );
  }
  const htmls = await resolveHtmlSource(orch);
  const satoruOpts = buildFullSatoruOptions({
    crop: orch.crop,
    fit: orch.fit,
    textToPaths: orch.textToPaths,
    mediaTypeInt: orch.mediaTypeInt,
    colorSpace: orch.colorSpace,
    scale: orch.scale,
    pdfOutline: orch.pdfOutline,
    pdfBackground: orch.pdfBackground,
    pdfTitle: orch.pdfTitle,
    pdfAuthor: orch.pdfAuthor,
    pdfSubject: orch.pdfSubject,
    pdfKeywords: orch.pdfKeywords,
    pdfCreator: orch.pdfCreator,
    pdfProducer: orch.pdfProducer,
    pdfMargin: orch.pdfMargin,
    pdfHeader: orch.pdfHeader,
    pdfFooter: orch.pdfFooter,
    pdfSkipRunning: orch.pdfSkipRunning,
  });

  const inst = await tryRunHtmlInstance(
    module,
    htmls,
    satoruOpts,
    DEFAULT_FONT_MAP,
    orch,
  );
  if (inst) return inst;

  // Legacy fallback for builds without instance render bindings.
  const legacy = await tryRunLegacyFallback(module, htmls, satoruOpts, orch);
  if (legacy) return legacy;
  throw loggedBinding("satoru_render");
}
