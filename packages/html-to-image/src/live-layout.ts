/**
 * Live layout: a page running in QuickJS (`createDOM`) reads `getBoundingClientRect()`, `offsetWidth`, `getComputedStyle()` and
 * the like, and the image engine answers them from its own layout, synchronously, at the moment of the read.
 *
 * The engine keeps the laid-out document and applies what the page changed to it (attributes, text, inserted / removed /
 * moved nodes) instead of laying the whole page out again. See doc/design/live-layout-incremental.md.
 */
import { resolveHtmlResources, now } from "./core-resources.js";
import type { ResolveContext } from "./core-resources.js";
import type { RenderLimits } from "./diagnostics.js";
import type { ResolveResourceHook } from "./core.js";
import type { HtmlToImageModule } from "./loader.js";
import type { LogLevel } from "./diagnostics.js";
import type { QuickJSDOM } from "wasm-quickjs-dom";

export interface LiveLayoutOptions {
  /** Viewport width the page is laid out at, CSS px (default 800). */
  width?: number;
  /** Viewport height (default: the engine's). */
  height?: number;
  /** Base for relative URLs of the page's stylesheets, fonts and images (default: the page's own). */
  baseUrl?: string;
  /** CSS `@media` type (default `"screen"`). */
  mediaType?: "screen" | "print";
  /** Extra CSS, as for a render. */
  css?: string;
  /** Fonts loaded up front, as for a render. */
  fonts?: { name: string; data: Uint8Array }[];
  /** Generic family to font URL map, as `fontMap` of a render. */
  fontMap?: Record<string, string>;
  /** Fallback fonts, as `fallbackFonts` of a render. */
  fallbackFonts?: (Uint8Array | ArrayBuffer | string)[];
  /** What the page's resources may be fetched from, and how many; as `limits` of a render. */
  limits?: RenderLimits;
  /** Override hook for resource resolution, as `resolveResource` of a render. */
  resolveResource?: ResolveResourceHook;
  /** User agent of the resource requests. */
  userAgent?: string;
  /**
   * A page with more elements than this is not laid out (boxes stay 0, `getComputedStyle` is the cascade's alone), with one
   * `console.warn`. The engine's document costs about 3 to 6 KB per element: on Cloudflare Workers (128 MB for both wasm modules)
   * about 13000 elements fit (measured on a plain page), so keep this at 10000 or less there. Default: no limit.
   */
  maxElements?: number;
}

export interface LiveLayout {
  /** Release the engine's document. Call it when the page is closed (the page must not read layout afterwards). */
  dispose(): void;
}

const PRINT = 1;

/**
 * Turn live layout on for a page. `module` is the engine of the entry you use (`getDefaultModule()` of
 * `wasm-html-to-image/workerd`, `loadHtmlToImageModule()` in Node, ...).
 *
 * The page's stylesheets, fonts and images are resolved once, here, from the page as it is now; resources a script adds
 * later are not fetched (their text and images lay out as if empty). From then on every read is answered from the layout
 * of the page as it is at that moment. If the engine fails or the page is too big (`maxElements`), layout turns itself off:
 * boxes read 0 and the page keeps running.
 *
 * ```ts
 * const dom = await createDOM({ url }, { width: 1200 });
 * const layout = await enableLiveLayout(dom, await getDefaultModule(), { width: 1200, maxElements: 5000 });
 * await dom.eval("document.querySelector('main').getBoundingClientRect().height");
 * layout.dispose();
 * dom.close();
 * ```
 */
export async function enableLiveLayout(
  dom: QuickJSDOM,
  module: HtmlToImageModule,
  options: LiveLayoutOptions = {},
): Promise<LiveLayout> {
  if (typeof module.satoru_live_open !== "function" || typeof module.satoru_live_apply !== "function" || typeof module.satoru_live_sync !== "function") {
    throw new Error("This build of the image engine has no live layout (satoru_live_*); rebuild the wasm module.");
  }
  const open = module.satoru_live_open.bind(module);
  const apply = module.satoru_live_apply.bind(module);
  const sync = module.satoru_live_sync.bind(module);
  const width = options.width ?? 800;
  const mediaTypeInt = options.mediaType === "print" ? PRINT : 0;
  const inst = module.satoru_create_instance();
  let disposed = false;
  try {
    // Stylesheets, fonts and images of the page, once. The layout calls that follow are synchronous and fetch nothing.
    const ctx: ResolveContext = {
      mediaTypeInt,
      css: options.css,
      fonts: options.fonts,
      limits: options.limits ?? {},
      resolveResource: options.resolveResource,
      diag: null,
      usage: { resourceCount: 0, totalResourceBytes: 0, fontsSkippedByCount: 0 },
      t0: now(),
      emitLog: (_level: LogLevel, _message: string) => {},
      addTime: () => {},
      checkTimeout: () => {},
    };
    await resolveHtmlResources(
      module,
      inst,
      dom.serialize(),
      width,
      options.height,
      options.baseUrl ?? dom.baseUrl,
      options.fontMap,
      options.userAgent,
      options.fallbackFonts,
      ctx,
    );
  } catch (error) {
    module.satoru_destroy_instance(inst);
    throw error;
  }

  // The page calls this as `window.__layoutProvider(html, ops)`: with `ops` (its journal of changes) it patches the held
  // document, with `html` it opens the document anew. The answer is `=` + all boxes, `+` + the boxes that changed, or "rebuild".
  const provider = (html: string, ops: string): string => {
    if (disposed) throw new Error("live layout was disposed");
    if (ops) return apply(inst, ops, width) === "rebuild" ? "rebuild" : "+" + sync(inst, true);
    open(inst, html, width, mediaTypeInt);
    return "=" + sync(inst, false);
  };
  try {
    (dom.bridge().window as unknown as Record<string, unknown>).__layoutProvider = provider;
    const max = options.maxElements && options.maxElements > 0 ? Math.floor(options.maxElements) : "";
    await dom.eval(`__edgeEnableLiveLayout(${max})`);
  } catch (error) {
    disposed = true;
    module.satoru_destroy_instance(inst);
    throw error;
  }
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      module.satoru_destroy_instance(inst);
    },
  };
}
