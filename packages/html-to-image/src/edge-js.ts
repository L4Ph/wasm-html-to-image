/**
 * The `javascript` option without Node: a page's scripts run in QuickJS (compiled to WebAssembly) on a linkedom DOM.
 *
 * The engine is the package `wasm-quickjs-dom` (a small JSDOM that knows nothing about images); this entry re-exports
 * it, and adds `applyJavaScript`, which hands its result to `render()`. It runs wherever WebAssembly does, `eval` or
 * not, so it also works on Cloudflare Workers and Vercel Edge. The QuickJS wasm is chosen by the runtime, so nothing
 * needs importing for it:
 *
 * ```ts
 * import { applyJavaScript } from "wasm-html-to-image/javascript";
 * import { render } from "wasm-html-to-image/workerd";
 * const png = await render(await applyJavaScript({ url: "https://example.com/", javascript: true, format: "png" }));
 * ```
 *
 * `createDOM()` keeps the page open (a small JSDOM): `await dom.eval("document.title")`, `dom.serialize()`,
 * `dom.toOptions({ format: "png" })`.
 */
import { runPageScriptsQuickJS, type EdgeJavaScriptEngine } from "wasm-quickjs-dom";
import type { HtmlToImageOptions } from "./core.js";
import { applyScripted } from "./js-apply.js";

export { createDOM, runPageScriptsQuickJS } from "wasm-quickjs-dom";
export type { CreateDOMOptions, EdgeJavaScriptEngine, QuickJSDOM } from "wasm-quickjs-dom";
export type { JavaScriptOptions, ScriptedPage } from "./js-apply.js";

/**
 * Apply the `javascript` option with the QuickJS engine: HTML and URL inputs are replaced by the scripted DOM.
 * Image and binary inputs, and options without `javascript`, pass through untouched.
 */
export function applyJavaScript<T extends HtmlToImageOptions>(options: T, engine: EdgeJavaScriptEngine = {}): Promise<T> {
  return applyScripted(options, (source, option, width) => runPageScriptsQuickJS(source, option, width, engine));
}
