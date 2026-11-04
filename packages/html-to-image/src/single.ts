/**
 * Single-WASM entry point.
 *
 * Loads the unified `html-to-image` module once (local `./loader.js`)
 * and reuses the single connection for all calls.
 * `render()` accepts HTML (`string` / `string[]` / URL) or image input
 * (`Uint8Array` / `ArrayBuffer` / `data:image/` URL); image input skips
 * rendering and goes straight to `converter_encode`.
 */
import { mermaidRenderOptions, type RenderMermaid } from "./mermaid.js";
import { loadHtmlToImageModule, type HtmlToImageModule } from "./loader.js";
import {
  htmlToImage,
  type HtmlToImageOptions,
  type RenderResult,
} from "./core.js";
import { isImageInput } from "./input.js";
import { applyJavaScript } from "./edge-js.js";

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
export { DIAGNOSTIC_CODES, LogLevel, htmlToImage } from "./core.js";
export { isImageInput };
export type { JavaScriptOptions, ScriptedPage } from "./js-apply.js";
/**
 * Run a page's scripts in QuickJS and return the resulting HTML: an alias of `wasm-quickjs-dom`'s
 * `runPageScriptsQuickJS`. Its optional third argument `viewportWidth` defaults to `undefined` (the
 * `width` of the options is used, then 800), so `matchMedia` follows that width.
 */
export { runPageScriptsQuickJS as runPageScripts } from "wasm-quickjs-dom";
export { clearResourceCache } from "./core-resources.js";
export type { HtmlToImageModule } from "./loader.js";
export { dropCachedModule, loadHtmlToImageModule } from "./loader.js";

/** Default connection: thin delegation to the loader-owned cache. */
export function getDefaultModule(): Promise<HtmlToImageModule> {
  return loadHtmlToImageModule();
}

/**
 * Render HTML — or convert an image — with the default single-WASM
 * connection. Returns RenderResult containing data and metadata.
 */
export async function render(
  options: HtmlToImageOptions & { format: "svg" },
): Promise<RenderResult<string>>;
export async function render(
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>>;
export async function render(
  options: HtmlToImageOptions,
): Promise<RenderResult<Uint8Array | string>> {
  return htmlToImage(await getDefaultModule(), await applyJavaScript(options));
}

export type { MermaidInput, MermaidOptions, MermaidTheme, MermaidWarning, RenderMermaid } from "./mermaid.js";
export { MERMAID_THEMES, mermaidToHtml } from "./mermaid.js";
/** Render a Mermaid diagram as SVG text (default) or an image, sized to the diagram. */
export const renderMermaid: RenderMermaid = ((source, options) => render(mermaidRenderOptions(source, options))) as RenderMermaid;
