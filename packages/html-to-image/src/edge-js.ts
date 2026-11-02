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
import { runPageScriptsQuickJS, type EdgeJavaScriptEngine, type QuickJSDOM } from "wasm-quickjs-dom";
import type { HtmlToImageOptions, LayoutBox } from "./core.js";
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

/**
 * Lay the page out with the image engine and give the numbers to the page: afterwards `getBoundingClientRect()`,
 * `offsetWidth` and the like answer from the real layout instead of 0 (see {@link QuickJSDOM.setLayout}). Returns how
 * many elements got a box.
 *
 * `render` is the `render` of the entry you use (`wasm-html-to-image/workerd`, `/single`, ...); only its layout pass
 * runs, nothing is drawn or encoded. `options` are the render options that shape the layout (`width`, `height`,
 * `css`, `fontMap`, `mediaType`, ...). The layout is a snapshot: measure again after the page changed.
 *
 * An inline element (`<span>`, `<a>`, ...) gets the box that encloses all the line fragments it is broken into.
 *
 * ```ts
 * const dom = await createDOM({ url }, { width: 1200 });
 * await measureLayout(dom, render, { width: 1200 });
 * const h = await dom.eval("document.querySelector('main').getBoundingClientRect().height");
 * ```
 */
export async function measureLayout(
  dom: QuickJSDOM,
  render: (options: HtmlToImageOptions) => Promise<unknown>,
  options: Omit<HtmlToImageOptions, "value" | "url" | "javascript" | "onLayout" | "layoutInline"> = {},
): Promise<number> {
  const boxes: Record<number, [number, number, number, number]> = {};
  let measured = false;
  try {
    await render({
      ...(options as object),
      layoutInline: true,
      value: dom.markForLayout(),
      baseUrl: (options as { baseUrl?: string }).baseUrl ?? dom.baseUrl,
      onLayout(list: LayoutBox[]) {
        for (const b of list) {
          const m = /(?:^|\s)qjsl-(\d+)(?:\s|$)/.exec(b.c);
          if (m) boxes[Number(m[1])] = [b.x, b.y, b.w, b.h];
        }
        measured = true;
        throw new Error("layout measured"); // the boxes are all that is wanted: skip drawing and encoding
      },
    } as HtmlToImageOptions);
  } catch (error) {
    if (!measured) throw error;
  }
  dom.setLayout(boxes);
  return Object.keys(boxes).length;
}
