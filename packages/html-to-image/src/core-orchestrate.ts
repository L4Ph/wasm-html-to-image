/**
 * Orchestration + pipeline layer split from `./core.ts` (behavior unchanged).
 *
 * Owns: binding-error helper, orchestration context (log gate, timings,
 * diagnostics state), HTML source resolution (`value`/`url`), the image-input
 * pipeline (`converter_*`), the HTML instance pipeline (`satoru_render` +
 * `converter_encode`), and the legacy `html_to_image` fallback.
 *
 * `core.ts` keeps public types and the `htmlToImage` overloads and delegates
 * here. `isImageInput` (`./input.ts`) is the single branch selector;
 * satoru option objects come from `./encode-args.ts` (canonical builder).
 */
import { pdfFirstPageSize, svgRootHeight } from "./output-size.js";
import type { HtmlToImageModule } from "./loader.js";
import { FIT_INT, FORMAT_INT, TIFF_CMYK_INT } from "./encode-args.js";
import {
  imageBytesFromUnknown,
  toBytes,
} from "./input.js";
import {
  DIAGNOSTIC_CODES,
  LogLevel,
  parseCppLogToDiagnostic,
  type RenderDiagnostics,
  type RenderLimits,
  type ResolveResourceHook,
} from "./diagnostics.js";
import {
  canSetUserAgent,
  now,
  resolveHtmlResources,
  type DiagState,
  type ResolveContext,
} from "./core-resources.js";
import type {
  HtmlToImageOptions,
  LayoutBox,
  OutputFormat,
  RenderResult,
} from "./core.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export { DEFAULT_USER_AGENT };

/** Binding names reported by {@link requireBindingError}. */
export type WasmBindingName =
  | "satoru_render"
  | "converter_encode"
  | "converter_encode_svg"
  | "converter_encode_pdf"
  | "converter_encode_pdf_cmyk"
  | "converter_load_image"
  | "html_to_image";

export function requireBindingError(name: WasmBindingName): Error {
  return new Error(
    `wasm-html-to-image: single-WASM binding "${name}" is required but not exposed by this build ` +
      `(rebuild the unified module; single-WASM only).`,
  );
}

/** Mutable orchestration state for one `htmlToImage` call. */
export interface Orchestration {
  format: OutputFormat;
  quality: number;
  speed: number;
  animation: boolean;
  /**
   * HTML animated-output request (`animation: { duration, fps, loop }`). When
   * set, the HTML pipeline samples the document's `@keyframes` animation
   * (opacity / transform / color) into converter frames before encoding.
   */
  animationFrames: { duration: number; fps?: number; loop?: number } | undefined;
  /**
   * Animated WebP loop count handed to the encode stage (libwebp
   * `anim_params.loop_count`). `0` = infinite (the historical default).
   */
  animationLoop: number;
  width: number;
  /** The caller's explicit `width` (image input skips resize when width/height are both omitted). */
  widthOption: number | undefined;
  height: number | undefined;
  crop: HtmlToImageOptions["crop"];
  fit: HtmlToImageOptions["fit"];
  value: unknown;
  url: string | undefined;
  baseUrl: string | undefined;
  fontMap: Record<string, string> | undefined;
  userAgent: string | undefined;
  fallbackFonts: (Uint8Array | ArrayBuffer | string)[] | undefined;
  logLevel: LogLevel;
  onLog: HtmlToImageOptions["onLog"];
  diagnostics: boolean;
  onDiagnostics: HtmlToImageOptions["onDiagnostics"];
  onLayout: HtmlToImageOptions["onLayout"];
  layoutInline: boolean;
  fitContent: HtmlToImageOptions["fitContent"];
  resolveResource: ResolveResourceHook | undefined;
  mediaType: "screen" | "print";
  textToPaths: boolean | undefined;
  css: string | undefined;
  preloadFonts: { name: string; data: Uint8Array }[] | undefined;
  limits: RenderLimits;
  pdfOutline: boolean | undefined;
  pdfBackground: string | undefined;
  pdfTitle: string | undefined;
  pdfAuthor: string | undefined;
  pdfSubject: string | undefined;
  pdfKeywords: string | undefined;
  pdfCreator: string | undefined;
  pdfProducer: string | undefined;
  pdfMargin: HtmlToImageOptions["pdfMargin"];
  pdfHeader: string | undefined;
  pdfFooter: string | undefined;
  pdfSkipRunning: number | undefined;
  fmtInt: number;
  /** Output color space of `tiff` / `pdf`. */
  colorSpace: "srgb" | "cmyk";
  /** Raster pixel density of HTML input (1 = CSS px). */
  scale: number;
  /** TIFF resolution tag in pixels per inch (image input: 96 unless set). */
  dpi: number;
  /** The caller's explicit `dpi` (image input has no `scale`, so it falls back to 96). */
  dpiOption: number | undefined;
  mediaTypeInt: number;
  t0: number;
  diag: DiagState | null;
  timings: Record<string, number>;
  emitLog: (level: LogLevel, message: string) => void;
  logged: (message: string) => Error;
  loggedBinding: (name: WasmBindingName) => Error;
  addTime: (name: string, ms: number) => void;
  checkTimeout: () => void;
  deliverReport: () => void;
  resolveCtx: ResolveContext;
}

/** Default `speed` for formats other than AVIF (JXL maps it to effort 10 - speed). */
export const DEFAULT_SPEED = 6;

/**
 * Default AVIF `speed`. At 6, a typical 800px page takes 1.4-3 s; at 8 it takes
 * 0.3-0.4 s for ~15-20% larger files. JXL is already fast at 6, so it keeps it.
 */
export const DEFAULT_AVIF_SPEED = 8;

/** Default `speed` for an output format when the caller does not set one. */
export function defaultSpeed(format: string): number {
  return format === "avif" ? DEFAULT_AVIF_SPEED : DEFAULT_SPEED;
}

/** Build per-call orchestration state (log gate, timings, diag, resolve ctx). */
export function createOrchestration(
  module: HtmlToImageModule,
  options: HtmlToImageOptions,
): Orchestration {
  const {
    format = "png",
    quality = 85,
    speed: speedOption,
    height,
    crop,
    fit,
    value,
    url,
    baseUrl,
    fontMap,
    userAgent,
    fallbackFonts,
    logLevel = LogLevel.None,
    onLog,
    diagnostics = false,
    onDiagnostics,
    onLayout,
    layoutInline = false,
    fitContent,
    resolveResource,
    mediaType = "screen",
    textToPaths,
    css,
    fonts: preloadFonts,
    limits = {},
    pdfOutline,
    pdfBackground,
    pdfTitle,
    pdfAuthor,
    pdfSubject,
    pdfKeywords,
    pdfCreator,
    pdfProducer,
    pdfMargin,
    pdfHeader,
    pdfFooter,
    pdfSkipRunning,
  } = options;
  // `animation` accepts a boolean (image input: keep frames) or, for HTML
  // input, an object requesting keyframe sampling. The object form turns on
  // the boolean flag for the encode stage and enables the frame path.
  const rawAnimation = options.animation;
  const animationFrames =
    rawAnimation !== null && typeof rawAnimation === "object"
      ? rawAnimation
      : undefined;
  const animation = animationFrames ? true : rawAnimation === true;
  // Loop count of the produced animated WebP (0 = infinite = legacy default).
  const animationLoop = Math.max(0, Math.trunc(animationFrames?.loop ?? 0));
  const speed = speedOption ?? defaultSpeed(format);
  const colorSpace = options.colorSpace === "cmyk" ? "cmyk" : "srgb";
  const width = options.width ?? 800;
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(
      `wasm-html-to-image: width must be a positive finite number, got ${String(options.width)}`,
    );
  }
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 16) {
    throw new Error(
      `wasm-html-to-image: scale must be a number in (0, 16], got ${String(options.scale)}`,
    );
  }
  if (
    options.dpi !== undefined &&
    (!Number.isFinite(options.dpi) || options.dpi < 1 || options.dpi > 65535)
  ) {
    throw new Error(
      `wasm-html-to-image: dpi must be a number in [1, 65535], got ${String(options.dpi)}`,
    );
  }
  // One CSS px is 1/96 in, so a scaled HTML render carries 96 * scale ppi by default.
  const dpi = Math.round(options.dpi ?? 96 * scale);
  const fmtInt =
    format === "tiff" && colorSpace === "cmyk"
      ? TIFF_CMYK_INT
      : FORMAT_INT[format];
  const mediaTypeInt = mediaType === "print" ? 1 : 0;

  /** JS-side log hook, gated by `logLevel` (satoru parity). */
  const emitLog = (level: LogLevel, message: string): void => {
    if (onLog && logLevel !== LogLevel.None && level <= logLevel) {
      try {
        onLog(level, message);
      } catch {
        // User hooks must not break rendering.
      }
    }
  };
  /** Build an Error with an Error-level log line (`throw logged(...)`). */
  const logged = (message: string): Error => {
    emitLog(LogLevel.Error, message);
    return new Error(message);
  };
  const loggedBinding = (name: WasmBindingName): Error => {
    const e = requireBindingError(name);
    emitLog(LogLevel.Error, e.message);
    return e;
  };

  const t0 = now();
  const diag: DiagState | null = diagnostics
    ? {
        resources: [],
        fonts: [],
        warnings: [],
        errors: [],
      }
    : null;
  const timings: Record<string, number> = {};
  const addTime = (name: string, ms: number): void => {
    if (diag) timings[name] = (timings[name] ?? 0) + ms;
  };
  const checkTimeout = (): void => {
    if (limits.timeoutMs !== undefined && now() - t0 >= limits.timeoutMs) {
      const message = `Render timed out after ${limits.timeoutMs}ms`;
      diag?.errors.push({ code: DIAGNOSTIC_CODES.LIMIT_TIMEOUT, message });
      throw logged(message);
    }
  };
  /** Deliver the diagnostics report on success (satoru parity). */
  const deliverReport = (): void => {
    if (!diag || !onDiagnostics) return;
    try {
      onDiagnostics({
        version: 1,
        format: format as RenderDiagnostics["format"],
        width,
        height,
        mediaType,
        timings,
        resources: diag.resources,
        fonts: diag.fonts,
        warnings: diag.warnings,
        errors: diag.errors,
      });
    } catch {
      // User hooks must not break rendering.
    }
  };
  const resolveCtx: ResolveContext = {
    mediaTypeInt,
    css,
    fonts: preloadFonts,
    limits,
    resolveResource,
    diag,
    usage: { resourceCount: 0, totalResourceBytes: 0, fontsSkippedByCount: 0 },
    t0,
    emitLog,
    addTime,
    checkTimeout,
  };

  if (logLevel !== LogLevel.None) {
    try {
      module.satoru_set_log_level(logLevel);
    } catch {
      // Non-fatal; JS-side logging still works.
    }
  }
  // What the engine logs (`[CODE] detail`, see src/cpp/utils/logging.h) reaches the `onLog` hook, and, when a
  // report is asked for, becomes a warning or an error in it. The engine calls `Module.onLog`.
  (module as unknown as { onLog?: (level: number, message: string) => void }).onLog =
    logLevel !== LogLevel.None
      ? (level, message) => {
          emitLog(level as LogLevel, message);
          if (diag && level <= LogLevel.Warning) {
            (level === LogLevel.Error ? diag.errors : diag.warnings).push(
              parseCppLogToDiagnostic(message, "ENGINE_LOG"),
            );
          }
        }
      : undefined;

  return {
    format: format as OutputFormat,
    quality,
    speed,
    animation,
    animationFrames,
    animationLoop,
    width,
    widthOption: options.width,
    height,
    crop,
    fit,
    value,
    url,
    baseUrl,
    fontMap,
    userAgent,
    fallbackFonts,
    logLevel,
    onLog,
    diagnostics,
    onDiagnostics,
    onLayout,
    layoutInline,
    fitContent,
    resolveResource,
    mediaType,
    textToPaths,
    css,
    preloadFonts,
    limits,
    pdfOutline,
    pdfBackground,
    pdfTitle,
    pdfAuthor,
    pdfSubject,
    pdfKeywords,
    pdfCreator,
    pdfProducer,
    pdfMargin,
    pdfHeader,
    pdfFooter,
    pdfSkipRunning,
    fmtInt,
    colorSpace,
    scale,
    dpi,
    dpiOption: options.dpi,
    mediaTypeInt,
    t0,
    diag,
    timings,
    emitLog,
    logged,
    loggedBinding,
    addTime,
    checkTimeout,
    deliverReport,
    resolveCtx,
  };
}

/**
 * Resolve `value`/`url` to HTML source. `isImageInput` callers branch before
 * this; HTML `value` passes through, `url` is fetched (hook-aware).
 */
export async function resolveHtmlSource(
  orch: Orchestration,
): Promise<string | string[]> {
  const { value, url, userAgent, resolveResource, addTime, logged } = orch;
  if (value !== undefined) {
    return value as string | string[];
  }
  if (typeof url === "string") {
    // Same as resource fetch: User-Agent override is Node/Workers-only. In browsers
    // it is forbidden and triggers a Firefox preflight that breaks CORS.
    const headers = canSetUserAgent()
      ? { "User-Agent": userAgent ?? DEFAULT_USER_AGENT }
      : undefined;
    const fetchStart = now();
    // Post-redirect document URL (`Response.url`). Relative resources must
    // resolve against the final URL, not the stale request URL: a 301 to a new
    // host otherwise leaves every stylesheet/font/image on the old host.
    let finalUrl: string | undefined;
    let htmls: string;
    if (resolveResource) {
      const fallbackFetch = async (): Promise<Uint8Array | null> => {
        const res = await fetch(url, { headers });
        if (!res.ok) return null;
        if (res.url) finalUrl = res.url;
        return toBytes(await res.arrayBuffer());
      };
      const raw = await resolveResource(url, fallbackFetch);
      if (!raw) {
        throw logged(
          `wasm-html-to-image: failed to fetch HTML from URL: ${url}`,
        );
      }
      htmls = new TextDecoder().decode(raw);
    } else {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw logged(
          `wasm-html-to-image: failed to fetch HTML from URL: ${url} (${res.status})`,
        );
      }
      if (res.url) finalUrl = res.url;
      htmls = await res.text();
    }
    // An explicit `baseUrl` always wins; otherwise adopt the document URL so
    // relative resource resolution follows redirects.
    if (orch.baseUrl === undefined && finalUrl !== undefined) {
      orch.baseUrl = finalUrl;
    }
    addTime("fetchHtml", now() - fetchStart);
    return htmls;
  }
  throw logged(
    "wasm-html-to-image: either 'value' or 'url' must be provided.",
  );
}

/**
 * Image-input pipeline: skip rendering, straight to `converter_*`.
 * Call only when `isImageInput(value)` holds; byte normalization uses
 * `imageBytesFromUnknown` (`unknown` in, no `as` casts).
 */
export async function runImageInput(
  module: HtmlToImageModule,
  value: unknown,
  orch: Orchestration,
): Promise<RenderResult<Uint8Array | string>> {
  const {
    format,
    quality,
    speed,
    animation,
    animationLoop,
    widthOption,
    height,
    crop,
    fit,
    fmtInt,
    colorSpace,
    dpiOption,
    t0,
    emitLog,
    logged,
    loggedBinding,
    addTime,
    deliverReport,
  } = orch;
  // Narrowed here: caller selected this branch via `isImageInput(value)`.
  const loadImage = module.converter_load_image;
  if (typeof loadImage !== "function")
    throw loggedBinding("converter_load_image");
  const bytes = imageBytesFromUnknown(value);
  const inst = module.converter_create_instance();
  try {
    if (!loadImage(inst, bytes)) {
      throw logged(
        "wasm-html-to-image: failed to load image input (unsupported or corrupt)",
      );
    }
    const originalWidth = module.converter_get_original_width?.(inst) ?? 0;
    const originalHeight = module.converter_get_original_height?.(inst) ?? 0;
    const originalFormat = module.converter_get_original_format?.(inst) ?? "";
    const originalAnimation =
      module.converter_is_original_animation?.(inst) ?? false;

    if (format === "none") {
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, "render done (image input, none/passthrough)");
      deliverReport();
      return {
        data: bytes,
        width: originalWidth,
        height: originalHeight,
        format: "none",
        originalWidth,
        originalHeight,
        originalFormat,
        originalAnimation,
        animation: originalAnimation,
      };
    }

    if (crop) {
      module.converter_crop(inst, crop.x, crop.y, crop.width, crop.height);
    }
    if (widthOption !== undefined || height !== undefined) {
      module.converter_resize(
        inst,
        widthOption ?? 0,
        height ?? 0,
        FIT_INT[fit ?? "contain"],
      );
    }
    const outWidth =
      module.converter_get_width?.(inst) ?? widthOption ?? originalWidth;
    const outHeight =
      module.converter_get_height?.(inst) ?? height ?? originalHeight;
    const outAnimation = module.converter_is_animation?.(inst) ?? animation;
    const outFormat =
      (module.converter_get_format?.(inst) as OutputFormat) || format;

    if (format === "svg") {
      const svgBinding = module.converter_encode_svg;
      if (typeof svgBinding !== "function")
        throw loggedBinding("converter_encode_svg");
      const encodeStart = now();
      const svg = (await svgBinding(inst)) as string;
      addTime("encode", now() - encodeStart);
      if (!svg) {
        throw logged("wasm-html-to-image: failed to encode image to svg");
      }
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, "render done (image input, svg)");
      deliverReport();
      return {
        data: svg,
        width: outWidth,
        height: outHeight,
        format: "svg",
        originalWidth,
        originalHeight,
        originalFormat,
        originalAnimation,
        animation: false,
      };
    }
    if (format === "pdf") {
      const pdfBindingName =
        colorSpace === "cmyk" ? "converter_encode_pdf_cmyk" : "converter_encode_pdf";
      const pdfBinding = module[pdfBindingName];
      if (typeof pdfBinding !== "function") throw loggedBinding(pdfBindingName);
      const encodeStart = now();
      const out = (await pdfBinding(inst)) as Uint8Array | null | undefined;
      addTime("encode", now() - encodeStart);
      if (out == null) {
        throw logged("wasm-html-to-image: failed to encode image to pdf");
      }
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, "render done (image input, pdf)");
      deliverReport();
      return {
        data: new Uint8Array(
          out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
        ),
        width: outWidth,
        height: outHeight,
        format: "pdf",
        originalWidth,
        originalHeight,
        originalFormat,
        originalAnimation,
        animation: false,
      };
    }
    const encodeBinding = module.converter_encode;
    if (typeof encodeBinding !== "function")
      throw loggedBinding("converter_encode");
    if (format === "tiff") module.converter_set_dpi?.(inst, Math.round(dpiOption ?? 96));
    const encodeStart = now();
    const out = (await encodeBinding(
      inst,
      fmtInt,
      quality,
      speed,
      animation,
      animationLoop,
    )) as Uint8Array | null | undefined;
    addTime("encode", now() - encodeStart);
    if (out == null) {
      throw logged("wasm-html-to-image: failed to encode image");
    }
    addTime("total", now() - t0);
    emitLog(LogLevel.Info, `render done (image input, ${format})`);
    deliverReport();
    return {
      data: new Uint8Array(
        out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
      ),
      width: outWidth,
      height: outHeight,
      format: outFormat,
      originalWidth,
      originalHeight,
      originalFormat,
      originalAnimation,
      animation: outAnimation,
    };
  } finally {
    module.converter_destroy_instance(inst);
  }
}

/**
 * HTML instance pipeline (`satoru_render` direct for svg/pdf, PNG
 * intermediate + `converter_encode` otherwise). Returns `null` when the
 * instance render bindings are absent so the caller can try the legacy
 * fallback (unified `html_to_image` builds its own instance and cannot see
 * pre-resolved resources, so it stays a fallback only).
 */
export async function tryRunHtmlInstance(
  module: HtmlToImageModule,
  htmls: string | string[],
  satoruOpts: Record<string, unknown>,
  defaultFontMap: Record<string, string>,
  orch: Orchestration,
): Promise<RenderResult<Uint8Array | string> | null> {
  const {
    format,
    quality,
    speed,
    animation,
    animationFrames,
    animationLoop,
    width: pageWidth,
    height,
    baseUrl,
    fontMap,
    userAgent,
    fallbackFonts,
    fmtInt,
    dpi,
    t0,
    emitLog,
    logged,
    loggedBinding,
    addTime,
    deliverReport,
    resolveCtx,
  } = orch;
  const renderBinding = module.satoru_render;
  const encodeBinding = module.converter_encode;
  if (
    typeof renderBinding !== "function" ||
    typeof encodeBinding !== "function"
  ) {
    return null;
  }
  const loadImage = module.converter_load_image;
  if (typeof loadImage !== "function")
    throw loggedBinding("converter_load_image");
  let width = pageWidth;
  const sInst = module.satoru_create_instance();
  try {
    const resolveStart = now();
    await resolveHtmlResources(
      module,
      sInst,
      htmls,
      pageWidth,
      height,
      baseUrl,
      fontMap ?? defaultFontMap,
      userAgent ?? DEFAULT_USER_AGENT,
      fallbackFonts,
      resolveCtx,
    );
    addTime("resolveResources", now() - resolveStart);
    emitLog(LogLevel.Info, "resources resolved");

    // Fit to the content: the page was laid out at `pageWidth` to load what it needs; the image is as wide as the diagram in it
    // (plus the padding), which the layout says. No second pass over the resources.
    if (orch.fitContent !== undefined && typeof module.satoru_layout_json === "function") {
      const page = Array.isArray(htmls) ? htmls[0] : htmls;
      const boxes = JSON.parse(
        module.satoru_layout_json(sInst, page, pageWidth, height ?? 0, orch.mediaTypeInt, false),
      ) as LayoutBox[];
      const box = boxes.find((b) => /(^|\s)mermaid(\s|$)/.test(b.c));
      if (box) width = Math.ceil(box.w + 2 * orch.fitContent);
    }

    if (orch.onLayout && typeof module.satoru_layout_json === "function") {
      const page = Array.isArray(htmls) ? htmls[0] : htmls;
      orch.onLayout(
        JSON.parse(
          module.satoru_layout_json(
            sInst,
            page,
            width,
            height ?? 0,
            orch.mediaTypeInt,
            orch.layoutInline,
          ),
        ) as LayoutBox[],
      );
    }

    if (format === "svg" || format === "pdf") {
      const renderStart = now();
      const out = (await renderBinding(
        sInst,
        htmls,
        width,
        height ?? 0,
        fmtInt,
        satoruOpts,
      )) as Uint8Array | null | undefined;
      addTime("render", now() - renderStart);
      if (out == null) {
        throw logged("wasm-html-to-image: satoru_render returned null");
      }
      const bytes = new Uint8Array(
        out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
      );
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, `render done: format=${format}`);
      deliverReport();
      if (format === "svg") {
        const svgStr = new TextDecoder().decode(bytes);
        const outHeight = height || (svgRootHeight(svgStr) ?? 0);
        return {
          data: svgStr,
          width,
          height: outHeight,
          format: "svg",
        };
      }
      return {
        data: bytes,
        width,
        height: height || (pdfFirstPageSize(bytes)?.height ?? 0),
        format: "pdf",
      };
    }

    const renderStart = now();
    const cInst = module.converter_create_instance();
    try {
      // Animated HTML: sample the document's @keyframes animation (opacity /
      // transform / color) straight into the converter's frames (additive).
      // Falls back to the single-frame path when no frames were produced.
      let renderedFrames = false;
      const renderAnimationToConverter =
        module.satoru_render_animation_to_converter;
      if (
        animationFrames &&
        typeof renderAnimationToConverter === "function"
      ) {
        const frames = (await renderAnimationToConverter(
          sInst,
          cInst,
          htmls,
          width,
          height ?? 0,
          satoruOpts,
          animationFrames.duration,
          animationFrames.fps ?? 15,
        )) as number;
        addTime("render", now() - renderStart);
        renderedFrames = frames > 0;
      }

      const renderToConverter = module.satoru_render_to_converter;
      if (renderedFrames) {
        // converter already holds the sampled frames.
      } else if (typeof renderToConverter === "function") {
        // Bitmap goes straight into the converter: no PNG encode/decode.
        const ok = await renderToConverter(
          sInst,
          cInst,
          htmls,
          width,
          height ?? 0,
          satoruOpts,
        );
        addTime("render", now() - renderStart);
        if (!ok) {
          throw logged("wasm-html-to-image: satoru_render returned null");
        }
      } else {
        const png = (await renderBinding(
          sInst,
          htmls,
          width,
          height ?? 0,
          FORMAT_INT.png,
          satoruOpts,
        )) as Uint8Array | null | undefined;
        addTime("render", now() - renderStart);
        if (png == null) {
          throw logged("wasm-html-to-image: satoru_render returned null");
        }
        if (!loadImage(cInst, png)) {
          throw logged("wasm-html-to-image: failed to load render output");
        }
      }
      const outWidth = module.converter_get_width?.(cInst) ?? width;
      const outHeight = module.converter_get_height?.(cInst) ?? height ?? 0;

      if (format === "tiff") module.converter_set_dpi?.(cInst, dpi);
      const encodeStart = now();
      const out = (await encodeBinding(
        cInst,
        fmtInt,
        quality,
        speed,
        animation,
        animationLoop,
      )) as Uint8Array | null | undefined;
      addTime("encode", now() - encodeStart);
      if (out == null) {
        throw logged("wasm-html-to-image: failed to encode image");
      }
      // Read the post-encode metadata: `is_animation`/`get_format` are only
      // meaningful after `converter_encode` has run.
      const outAnimation =
        module.converter_is_animation?.(cInst) ?? animation;
      const outFormat =
        (module.converter_get_format?.(cInst) as OutputFormat) || format;
      addTime("total", now() - t0);
      emitLog(LogLevel.Info, `render done: format=${format}`);
      deliverReport();
      return {
        data: new Uint8Array(
          out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
        ),
        width: outWidth,
        height: outHeight,
        format: outFormat,
        animation: outAnimation,
      };
    } finally {
      module.converter_destroy_instance(cInst);
    }
  } finally {
    module.satoru_destroy_instance(sInst);
  }
}

/**
 * Legacy fallback for builds without instance render bindings.
 * Returns `null` when the unified binding is absent.
 */
export async function tryRunLegacyFallback(
  module: HtmlToImageModule,
  htmls: string | string[],
  satoruOpts: Record<string, unknown>,
  orch: Orchestration,
): Promise<RenderResult<Uint8Array | string> | null> {
  const {
    format,
    quality,
    speed,
    animation,
    width,
    height,
    fmtInt,
    t0,
    emitLog,
    logged,
    addTime,
    deliverReport,
  } = orch;
  const unified = module.html_to_image;
  if (typeof unified !== "function") {
    return null;
  }
  const out = (await unified(
    htmls,
    width,
    height ?? 0,
    fmtInt,
    satoruOpts,
    quality,
    speed,
    animation,
  )) as Uint8Array | null | undefined;
  if (out == null) {
    throw logged("wasm-html-to-image: html_to_image returned null");
  }
  const bytes = new Uint8Array(
    out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer),
  );
  addTime("total", now() - t0);
  emitLog(LogLevel.Info, `render done (legacy): format=${format}`);
  deliverReport();
  return {
    data: format === "svg" ? new TextDecoder().decode(bytes) : bytes,
    width,
    height: height ?? 0,
    format,
  };
}
