/**
 * Edge-light entry point (Next.js Edge runtime, Vercel edge-light).
 *
 * Same engine as `./workerd.js`, but with NO static `.wasm` import:
 * bundlers outside workerd (notably Next.js edge-server compilation) cannot
 * resolve a bare `import wasm from "../dist/html-to-image.wasm"`, so that
 * line would force consumers to add a dedicated `asset/resource` rule.
 * Here the caller always supplies a pre-compiled `WebAssembly.Module`
 * (e.g. compiled from bytes served over HTTP), and instantiation is
 * overridden via `instantiateWasm` exactly like `./workerd.js`.
 *
 * Runtime separation is done in `package.json` `exports` conditions:
 * - `workerd` (Cloudflare) -> `./workerd.js` (static `.wasm` import)
 * - `edge-light` (Next.js Edge) -> `./edge-light.js` (this file)
 * The two conditions never overlap (verified against Next.js 15
 * `edgeConditionNames` and wrangler/miniflare build conditions), and
 * `edge-light` is listed before any `browser` key so Edge resolution wins.
 *
 * ```ts
 * import { render } from "wasm-html-to-image/workerd"; // edge-light resolves here on Edge
 * const wasm = await WebAssembly.compile(await (await fetch(wasmUrl)).arrayBuffer());
 * const png = await render({ value: "<h1>hi</h1>", width: 800, format: "png" }, wasm);
 * ```
 */
// @ts-expect-error — dist/html-to-image.js is generated at build time
import createHtmlToImageModule from "./html-to-image.js";
import {
  loadPrecompiledModule,
  type HtmlToImageModule,
} from "./loader.js";
import {
  htmlToImage,
  type HtmlToImageOptions,
  type RenderResult,
} from "./core.js";

export type {
  OutputFormat,
  RenderOptions,
  HtmlToImageOptions,
  LayoutBox,
  RenderResult,
  DiagnosticMessage,
  FontDiagnostic,
  RenderDiagnostics,
  RenderLimits,
  ResolveResourceHook,
  ResourceDiagnostic,
} from "./core.js";
export { DIAGNOSTIC_CODES, LogLevel, isImageInput } from "./core.js";
export { clearResourceCache } from "./core-resources.js";
export type {
  HtmlToImageModule,
  EmscriptenModuleArg,
  LoadOptions,
  WasmInstancePtr,
  CreateHtmlToImageModule,
} from "./loader.js";

/** Module instances keyed by WASM binary (cache owned here, loading in loader). */
const moduleByWasm = new Map<WebAssembly.Module, Promise<HtmlToImageModule>>();

/**
 * Load (and reuse) the unified module for a pre-compiled `WebAssembly.Module`.
 * @param wasm The compiled WASM module (always required — no bundled default)
 */
export function getDefaultModule(
  wasm: WebAssembly.Module,
): Promise<HtmlToImageModule> {
  return loadPrecompiledModule(
    createHtmlToImageModule,
    wasm,
    moduleByWasm,
    "edge-light",
  );
}

/**
 * Render HTML — or convert an image — on an edge runtime.
 * Returns RenderResult containing data and metadata.
 */
export async function render(
  options: HtmlToImageOptions & { format: "svg" },
  wasm: WebAssembly.Module,
): Promise<RenderResult<string>>;
export async function render(
  options: HtmlToImageOptions,
  wasm: WebAssembly.Module,
): Promise<RenderResult<Uint8Array | string>>;
export async function render(
  options: HtmlToImageOptions,
  wasm: WebAssembly.Module,
): Promise<RenderResult<Uint8Array | string>> {
  return htmlToImage(await getDefaultModule(wasm), options);
}

export type { MermaidInput, MermaidOptions, MermaidTheme, MermaidWarning, RenderFn, RenderMermaid } from "./mermaid.js";
// Mermaid: `render({ mermaid: { source: "graph LR; A --> B" }, format: "png" }, wasm)`
export { MERMAID_THEMES, mermaidToHtml } from "./mermaid.js";
