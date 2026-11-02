/**
 * Single-WASM loader for the unified `html-to-image` Emscripten module.
 *
 * Build assumptions (see `src/cpp/main.cpp`, C++ lane owns them):
 * - Emscripten `MODULARIZE` + `EXPORT_ES6` → `dist/html-to-image.js`
 *   with `export default createHtmlToImageModule`.
 * - Single `EMSCRIPTEN_BINDINGS(html_to_image)` with `satoru_*` /
 *   `converter_*` prefixed JS names (no bare `create_instance` etc.).
 *
 * Registered bindings: instance lifecycle + log level, render/encode
 * (`satoru_render`, `converter_encode`, ...), resource discovery/injection
 * (`satoru_collect_resources`, `satoru_get_pending_resources`,
 * `satoru_add_resource`, `satoru_load_font`, `satoru_load_fallback_font`,
 * `satoru_set_font_map`, ...), and the unified `html_to_image` call.
 * Bindings added over time stay optional in the type below; callers must
 * feature-check at runtime (see `./core.ts`).
 *
 * Node and browser share this minimal shape: dynamic `import()` of the glue
 * file URL, then invoking the factory. No `node:` builtins are used so the
 * same file works in both runtimes.
 */

import { checkWasmBinary } from "./wasm-binary.js";

/** Opaque WASM instance handle (Embind `allow_raw_pointers` raw pointer). */
export type WasmInstancePtr = unknown;

/** Extra Emscripten `Module` arguments passed to the factory. */
export interface EmscriptenModuleArg extends Record<string, unknown> {
  locateFile?: (path: string, scriptDirectory: string) => string;
}

/**
 * Structural view of the instantiated unified module.
 * Lifecycle bindings are required; feature bindings added over time stay
 * optional and are probed with `typeof` before use.
 */
export interface HtmlToImageModule {
  satoru_create_instance(): WasmInstancePtr;
  satoru_destroy_instance(inst: WasmInstancePtr): void;
  satoru_set_log_level(level: number): void;
  converter_create_instance(): WasmInstancePtr;
  converter_destroy_instance(inst: WasmInstancePtr): void;
  converter_set_log_level(level: number): void;
  /** Registered converter instance ops (real bodies, always present). */
  converter_load_image(
    inst: WasmInstancePtr,
    data: Uint8Array | ArrayBuffer,
  ): boolean;
  converter_crop(
    inst: WasmInstancePtr,
    x: number,
    y: number,
    width: number,
    height: number,
  ): boolean;
  converter_resize(
    inst: WasmInstancePtr,
    width: number,
    height: number,
    fit: number,
  ): boolean;
  /** Image-input svg/pdf wrappers (registered; probed at runtime). */
  converter_encode_svg?(inst: WasmInstancePtr): string | Promise<string>;
  converter_encode_pdf?(inst: WasmInstancePtr): unknown;
  /** TIFF resolution tag for the next `converter_encode` (pixels per inch). */
  converter_set_dpi?(inst: WasmInstancePtr, dpi: number): void;
  /** Same as `converter_encode_pdf`, rewritten to DeviceCMYK. */
  converter_encode_pdf_cmyk?(inst: WasmInstancePtr): unknown;
  /** Converter metadata getters */
  converter_get_original_width?(inst: WasmInstancePtr): number;
  converter_get_original_height?(inst: WasmInstancePtr): number;
  converter_is_original_animation?(inst: WasmInstancePtr): boolean;
  converter_get_original_format?(inst: WasmInstancePtr): string;
  converter_get_width?(inst: WasmInstancePtr): number;
  converter_get_height?(inst: WasmInstancePtr): number;
  converter_is_animation?(inst: WasmInstancePtr): boolean;
  converter_get_format?(inst: WasmInstancePtr): string;
  /**
   * HTML resource discovery/injection (registered; probed at runtime).
   * `collect` gathers pending URLs for the HTML, `get_pending_resources`
   * returns them in the binary form (u32 count, then per entry: u8 type
   * 1=font/2=image/3=css, u8 redraw flag, u32+url, u32+name, u32+characters),
   * and `add_resource` injects fetched bytes back (same type ints).
   */
  satoru_collect_resources?(
    inst: WasmInstancePtr,
    /** One page, or an array with one entry per page (all collected in this call). */
    html: string | string[],
    width: number,
    height: number,
    mediaType: number,
  ): unknown;
  /** Debug: JSON array of every element's border box (see `onLayout`). */
  satoru_layout_json?(
    inst: WasmInstancePtr,
    html: string | string[],
    width: number,
    height: number,
    mediaType: number,
    includeInline: boolean,
  ): string;
  satoru_get_pending_resources?(inst: WasmInstancePtr): unknown;
  satoru_add_resource?(
    inst: WasmInstancePtr,
    url: string,
    type: number,
    data: Uint8Array,
  ): unknown;
  satoru_load_font?(
    inst: WasmInstancePtr,
    name: string,
    data: Uint8Array,
  ): unknown;
  /** Pre-scan a CSS string (registered; probed at runtime). */
  satoru_scan_css?(inst: WasmInstancePtr, css: string): unknown;
  /** Named image preload (registered; takes a `data:` URL). */
  satoru_load_image?(
    inst: WasmInstancePtr,
    name: string,
    dataUrl: string,
    width: number,
    height: number,
  ): unknown;
  /** Family -> URL map for generic font resolution (registered). */
  satoru_set_font_map?(
    inst: WasmInstancePtr,
    fontMap: Record<string, string>,
  ): unknown;
  /** User-supplied fallback font bytes (registered; upstream idiom). */
  satoru_load_fallback_font?(inst: WasmInstancePtr, data: Uint8Array): unknown;
  /** Collect-phase profile (registered; JSON string, probed at runtime). */
  satoru_get_collect_profile?(inst: WasmInstancePtr): unknown;
  satoru_set_collect_profile_enabled?(
    inst: WasmInstancePtr,
    enabled: boolean,
  ): unknown;
  /** HTML render wrapper (positional: instance, htmls, w, h, format, options). */
  satoru_render?: (...args: unknown[]) => unknown;
  /**
   * Render HTML straight into a converter instance's frame (no PNG round
   * trip): `(satoruInst, converterInst, htmls, width, height, options)`.
   * Returns false on failure. Probed at runtime; PNG path is the fallback.
   */
  satoru_render_to_converter?: (...args: unknown[]) => boolean;
  /**
   * Animated (opacity / transform / color) HTML render into a converter's
   * frames, additive: `(satoruInst, converterInst, htmls, width, height,
   * options, durationMs, fps)`. Frames come from `@keyframes` + `animation` in
   * the document (loop infinite); returns the number of frames appended
   * (0 on failure).
   */
  satoru_render_animation_to_converter?: (...args: unknown[]) => number;
  /**
   * Image encode wrapper (positional: instance, format, quality, speed,
   * animation, animationLoop). `animationLoop` is the animated WebP loop
   * count (0 = infinite, the default).
   */
  converter_encode?: (...args: unknown[]) => unknown;
  /**
   * Unified Bitmap-direct call (`render_bitmap_to_encoded` exposed to JS,
   * no PNG intermediate round-trip through JS).
   */
  html_to_image?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

/** `MODULARIZE` factory shape (`export default createHtmlToImageModule`). */
export type CreateHtmlToImageModule = (
  moduleArg?: EmscriptenModuleArg,
) => Promise<HtmlToImageModule>;

export interface LoadOptions {
  /**
   * Explicit glue file URL/path (`dist/html-to-image.js`).
   * Default: `./html-to-image.js` next to the compiled loader.
   */
  glueUrl?: string | URL;
  /** Emscripten `locateFile` override (`.wasm` resolution). */
  locateFile?: (path: string, scriptDirectory: string) => string;
  /** Extra Emscripten `Module` arguments. */
  moduleArg?: EmscriptenModuleArg;
  /**
   * Pre-bundled MODULARIZE factory (workerd: statically imported glue).
   * When set, the dynamic `import()` of the glue file is skipped.
   * Non-breaking addition; existing callers are unaffected.
   */
  factory?: CreateHtmlToImageModule;
  /** Bypass the process-wide cache (tests). */
  noCache?: boolean;
}

/**
 * Process-wide module cache, keyed by factory then moduleArg: different
 * factories, or different WASM payloads (e.g. workerd/edge-light calls
 * with distinct `WebAssembly.Module`s), must not share an instance.
 * Callers with their own scoping (workerd/edge-light per-wasm maps,
 * single.ts default path, `*-workers` lazy vars) are unaffected.
 */
const moduleCache = new Map<
  CreateHtmlToImageModule | undefined,
  Map<EmscriptenModuleArg | undefined, HtmlToImageModule>
>();

/**
 * In-flight loads, keyed like {@link moduleCache} (factory then moduleArg).
 *
 * The resolved-module cache only helps *after* the first load finished, so
 * N parallel calls (a worker pool starting up, a burst of requests) each
 * instantiated their own copy of the module — a 12 MB binary plus its
 * linear memory, N times over. Sharing the pending promise makes parallel
 * initialization instantiate exactly once.
 */
const pendingLoads = new Map<
  CreateHtmlToImageModule | undefined,
  Map<EmscriptenModuleArg | undefined, Promise<HtmlToImageModule>>
>();

/**
 * How many times a load is attempted before the error is reported.
 *
 * A truncated `.wasm` (read while a concurrent build was still writing it)
 * is transient: re-reading the file a moment later usually yields the
 * complete binary. Two attempts are enough to cover that window without
 * hiding a real failure.
 */
const LOAD_ATTEMPTS = 2;

/** Delay before the retry of a transient (truncated binary) failure. */
const LOAD_RETRY_DELAY_MS = 150;

/**
 * A failure that is likely to disappear on a second attempt (the `.wasm`
 * was read while it was still being written).
 */
export class TransientWasmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientWasmError";
  }
}


/** Default glue URL: `./html-to-image.js` next to the compiled loader. */
export function defaultGlueUrl(): URL {
  return new URL("./html-to-image.js", import.meta.url);
}

function isModuleNotFound(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  if (code === "ERR_MODULE_NOT_FOUND") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /Cannot find (module|package)/.test(msg);
}

type GlueNamespace = {
  default?: CreateHtmlToImageModule;
  createHtmlToImageModule?: CreateHtmlToImageModule;
};

/**
 * Import glue by URL, tolerating bundlers that hijack dynamic `import()`.
 * Webpack rewrites even variable `import(url)` into chunk loading, which
 * cannot resolve runtime URLs ("Cannot find module"). The native attempt
 * runs first (unchanged behavior everywhere it already works, including
 * strict-CSP pages); only on failure is an indirect import (invisible to
 * bundlers' static analysis) retried. The original error is rethrown when
 * both attempts fail, preserving existing error semantics (e.g. the
 * src→dist dev fallback branching below).
 */
async function importGlueModule(glue: string): Promise<GlueNamespace> {
  // `webpackIgnore` keeps Turbopack (Next.js 16 default builder) from trying
  // to resolve the runtime URL at build time; webpack/vite honor it too.
  try {
    return (await import(
      /* @vite-ignore, webpackIgnore: true */ glue
    )) as GlueNamespace;
  } catch (first) {
    try {
      const indirect = new Function("u", "return import(u)") as (
        u: string,
      ) => Promise<GlueNamespace>;
      return await indirect(glue);
    } catch {
      throw first;
    }
  }
}

/** `file://` directory URL to a plain fs path (browser URLs pass through). */
function glueDirToFsPath(glueDir: string): string {
  if (!glueDir.startsWith("file://")) return glueDir;
  let p = decodeURIComponent(glueDir.slice("file://".length));
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // Windows drive letter
  return p;
}

function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } })
    .process;
  return typeof proc?.versions?.node === "string";
}

/**
 * Runtime-only load of a `node:` builtin (e.g. `importNode("fs/promises")`).
 * Uses `process.getBuiltinModule` (Node 22.3+/20.16+) so there is NO `import`
 * syntax at all: bundlers with static analysis (webpack/vite/rollup, and
 * Turbopack — the Next.js 16 default builder, which rejects both dynamic
 * `` `node:${name}` `` requests and literal `import("node:*")` inside Edge
 * graphs) have nothing to resolve or rewrite. Only the builtins actually
 * used by this package are supported. All call sites are guarded to run on
 * Node only; other runtimes never evaluate these branches. A `new Function`
 * indirect-import fallback keeps older Node working without adding any
 * statically analyzable import.
 */
export function importNode<T = unknown>(name: string): Promise<T> {
  if (name !== "fs/promises" && name !== "path" && name !== "module") {
    throw new Error(`wasm-html-to-image: unsupported node builtin "${name}"`);
  }
  const proc = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => T };
    }
  ).process;
  try {
    const mod = proc?.getBuiltinModule?.(`node:${name}`);
    if (mod) return Promise.resolve(mod);
  } catch {
    // fall through to the indirect dynamic import below
  }
  const indirect = new Function("s", "return import(s)") as (
    s: string,
  ) => Promise<T>;
  return indirect(`node:${name}`);
}

/**
 * Node-only: pre-read the sibling `.wasm` bytes. The web/worker-oriented
 * glue has no `fs` reader, so `file://` fetching fails under Node; handing
 * over `wasmBinary` bypasses fetching entirely. Browsers skip this (fetch
 * works there). No static `node:` import keeps browser bundles clean.
 */
async function readWasmBinaryNode(
  glueDir: string,
): Promise<Uint8Array | undefined> {
  if (!isNodeRuntime()) return undefined;
  try {
    const fs =
      await importNode<typeof import("node:fs/promises")>("fs/promises");
    const data = await fs.readFile(
      glueDirToFsPath(glueDir) + "html-to-image.wasm",
    );
    return new Uint8Array(data);
  } catch {
    return undefined;
  }
}

/**
 * Load and instantiate the unified module (cached per process, keyed by
 * factory then moduleArg — see `moduleCache`).
 * Works in Node (file URL import) and browsers (served URL import).
 *
 * Parallel calls with the same key share one instantiation (see
 * {@link pendingLoads}); a failed load is not cached, so a later call
 * retries.
 */
export async function loadHtmlToImageModule(
  options: LoadOptions = {},
): Promise<HtmlToImageModule> {
  const cacheKeyFactory = options.factory ?? undefined;
  const cacheKeyModuleArg = options.moduleArg ?? undefined;
  if (!options.noCache) {
    const hit = moduleCache.get(cacheKeyFactory)?.get(cacheKeyModuleArg);
    if (hit) return hit;
    // A load is already running for this key: share it instead of
    // instantiating a second copy of the module.
    const pending = pendingLoads.get(cacheKeyFactory)?.get(cacheKeyModuleArg);
    if (pending) return pending;
  }
  const promise = loadHtmlToImageModuleOnce(
    options,
    cacheKeyFactory,
    cacheKeyModuleArg,
  );
  if (!options.noCache) {
    let inner = pendingLoads.get(cacheKeyFactory);
    if (!inner) {
      inner = new Map();
      pendingLoads.set(cacheKeyFactory, inner);
    }
    inner.set(cacheKeyModuleArg, promise);
    // A rejected load must not poison the cache: drop it so a later call
    // retries (a truncated `.wasm` may be complete by then).
    promise.catch(() => {
      if (inner?.get(cacheKeyModuleArg) === promise) {
        inner.delete(cacheKeyModuleArg);
      }
    });
  }
  return promise;
}

/**
 * Load the module, retrying once when the failure is transient (the
 * `.wasm` was read while it was still being written).
 */
async function loadHtmlToImageModuleOnce(
  options: LoadOptions,
  cacheKeyFactory: CreateHtmlToImageModule | undefined,
  cacheKeyModuleArg: EmscriptenModuleArg | undefined,
): Promise<HtmlToImageModule> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await loadHtmlToImageModuleUncached(
        options,
        cacheKeyFactory,
        cacheKeyModuleArg,
      );
    } catch (e) {
      if (attempt >= LOAD_ATTEMPTS || !isTransientWasmFailure(e)) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, LOAD_RETRY_DELAY_MS));
    }
  }
}

/**
 * True when the failure looks like a corrupt/truncated binary (retryable).
 *
 * The engine reports a truncated module as `CompileError`; the emscripten
 * glue wraps it into `RuntimeError("Aborted(CompileError: ...)")`, so the
 * message is inspected as well.
 */
function isTransientWasmFailure(e: unknown): boolean {
  if (e instanceof TransientWasmError) return true;
  if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.CompileError)
    return true;
  const message = e instanceof Error ? e.message : String(e);
  return /CompileError/.test(message);
}

/**
 * Explain a load failure in terms of the artifact that is actually broken:
 * a truncated `.wasm` (read while a build was writing it) or a
 * glue/binary mismatch (the two come from different builds).
 */
function explainWasmLoadFailure(e: unknown, glueLabel: string): Error {
  const message = e instanceof Error ? e.message : String(e);
  if (/Import #\d+/.test(message)) {
    return new Error(
      `wasm-html-to-image: the WebAssembly binary and the JavaScript ` +
        `glue do not match (${message}). The artifacts in ${glueLabel} ` +
        `are probably from different builds - rebuild the glue and the ` +
        `.wasm together.`,
      { cause: e },
    );
  }
  if (e instanceof Error) return e;
  return new Error(message);
}

async function loadHtmlToImageModuleUncached(
  options: LoadOptions,
  cacheKeyFactory: CreateHtmlToImageModule | undefined,
  cacheKeyModuleArg: EmscriptenModuleArg | undefined,
): Promise<HtmlToImageModule> {
  let factory = options.factory;
  let glueLabel = "(pre-bundled factory)";
  let glueDir = "";
  if (!factory) {
    let glue = String(options.glueUrl ?? defaultGlueUrl());
    let ns: GlueNamespace;
    try {
      ns = await importGlueModule(glue);
    } catch (e) {
      if (options.glueUrl || !isModuleNotFound(e)) throw e;
      // Dev-layout fallback: running from `src/` (tsx) while the glue
      // lives in `../dist/` next to the compiled loader.
      const fallback = String(
        new URL("../dist/html-to-image.js", import.meta.url),
      );
      try {
        ns = await importGlueModule(fallback);
      } catch {
        throw e; // report the original error
      }
      glue = fallback;
    }
    glueLabel = glue;
    glueDir = glue.slice(0, glue.lastIndexOf("/") + 1);
    factory = ns.default ?? ns.createHtmlToImageModule;
  }
  if (typeof factory !== "function") {
    throw new Error(
      `wasm-html-to-image: no MODULARIZE factory in ${glueLabel} ` +
        `(expected default export createHtmlToImageModule)`,
    );
  }
  // Node-only: hand over pre-read `.wasm` bytes (factory path, e.g.
  // workerd with `instantiateWasm`, is left untouched).
  let moduleArg = options.moduleArg;
  if (!options.factory && glueDir && moduleArg?.wasmBinary === undefined) {
    const wasmPath = glueDirToFsPath(glueDir) + "html-to-image.wasm";
    const wasmBinary = await readWasmBinaryNode(glueDir);
    if (wasmBinary) {
      // A file that is still being written yields a truncated binary and
      // a cryptic `section Data extends past end` deep inside the engine.
      const check = checkWasmBinary(wasmBinary);
      if (!check.ok) {
        throw new TransientWasmError(
          `wasm-html-to-image: invalid WebAssembly binary at ${wasmPath}: ` +
            `${check.reason} - the file was probably read while it was ` +
            `still being written (concurrent build); retry once the ` +
            `build finished.`,
        );
      }
      moduleArg = { ...moduleArg, wasmBinary };
    } else if (isNodeRuntime()) {
      throw new TransientWasmError(
        `wasm-html-to-image: cannot read the WebAssembly binary at ` +
          `${wasmPath}`,
      );
    }
  }
  const provided = moduleArg?.wasmBinary;
  const providedBytes =
    provided instanceof Uint8Array
      ? provided
      : provided instanceof ArrayBuffer
        ? new Uint8Array(provided)
        : undefined;
  if (providedBytes) {
    // Caller-supplied bytes (browser worker payload, edge runtimes) get
    // the same structural check.
    const check = checkWasmBinary(providedBytes);
    if (!check.ok) {
      throw new TransientWasmError(
        `wasm-html-to-image: invalid WebAssembly binary: ${check.reason}`,
      );
    }
  }
  let module: HtmlToImageModule;
  try {
    module = await factory({
      ...moduleArg,
      locateFile:
        options.locateFile ??
        moduleArg?.locateFile ??
        ((path: string) => glueDir + path),
    });
  } catch (e) {
    throw explainWasmLoadFailure(e, glueLabel);
  }
  if (!options.noCache) {
    let inner = moduleCache.get(cacheKeyFactory);
    if (!inner) {
      inner = new Map();
      moduleCache.set(cacheKeyFactory, inner);
    }
    inner.set(cacheKeyModuleArg, module);
  }
  return module;
}


/** Drop all cached instances (tests / HMR). */
export function dropCachedModule(): void {
  moduleCache.clear();
  pendingLoads.clear();
}

/**
 * Build Emscripten module args for a pre-compiled `WebAssembly.Module`.
 * Shared adapter for workerd / edge-light entry points (behavior unchanged:
 * `WebAssembly.instantiate` + success-callback override, empty object return
 * for emscripten). The `label` only selects the console-error prefix.
 *
 * `onFailure` (optional) is notified when the instantiation fails. The
 * emscripten glue only offers a success callback, so without it a failed
 * instantiation leaves the module promise pending forever; the caller uses
 * this hook to turn the failure into a rejected promise.
 */
export function precompiledModuleArg(
  wasm: WebAssembly.Module,
  label: string,
  onFailure?: (e: unknown) => void,
): EmscriptenModuleArg {
  return {
    instantiateWasm: (imports: unknown, successCallback: unknown) => {
      WebAssembly.instantiate(wasm, imports as WebAssembly.Imports)
        .then((instance) => {
          (successCallback as (inst: unknown, mod: unknown) => void)(
            instance,
            wasm,
          );
        })
        .catch((e) => {
          console.error(
            `wasm-html-to-image [${label}]: Wasm instantiation failed:`,
            e,
          );
          onFailure?.(e);
        });
      return {}; // Return empty object as emscripten expects
    },
  };
}

/**
 * Load (and reuse) the unified module for a pre-compiled `WebAssembly.Module`.
 * Per-`wasm` cache with failure eviction (a second call with a different
 * `wasm` must not reuse the first one; failed loads are evicted for retry).
 * Thin adapter over {@link loadHtmlToImageModule} — environment differences
 * between workerd / edge-light stay isolated here.
 */
export async function loadPrecompiledModule(
  factory: CreateHtmlToImageModule,
  wasm: WebAssembly.Module,
  cache: Map<WebAssembly.Module, Promise<HtmlToImageModule>>,
  label: string,
): Promise<HtmlToImageModule> {
  let pending = cache.get(wasm);
  if (!pending) {
    // The glue only reports instantiation failures through the console,
    // so the failure is mirrored into a rejected promise: otherwise the
    // module promise never settles and the caller waits forever.
    let reportFailure: (e: unknown) => void = () => {};
    const failure = new Promise<never>((_resolve, reject) => {
      reportFailure = reject;
    });
    pending = Promise.race([
      loadHtmlToImageModule({
        factory,
        moduleArg: precompiledModuleArg(wasm, label, reportFailure),
      }),
      failure,
    ]);
    cache.set(wasm, pending);
    pending.catch(() => {
      if (cache.get(wasm) === pending) cache.delete(wasm);
    });
  }
  return pending;
}
