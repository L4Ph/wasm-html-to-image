/**
 * A Vitest environment: the test file's globals (`document`, `window`, `HTMLElement`, `Event`, ...) are the page's.
 *
 * ```ts
 * // vitest.config.ts
 * export default { test: { environment: "./node_modules/wasm-quickjs-dom/dist/vitest.js" } };
 * ```
 *
 * Options go in `test.environmentOptions.wasmQuickjsDom` (those of {@link JSDOMOptions}: `url`, `html`, ...).
 */
import { installWindow } from "./globals.js";
import { JSDOM, type JSDOMOptions } from "./jsdom.js";

interface VitestEnvironment {
  name: string;
  viteEnvironment: "client";
  setup(global: Record<string, any>, options: Record<string, any>): { teardown(global: Record<string, any>): void };
}

export default {
  name: "wasm-quickjs-dom",
  viteEnvironment: "client",
  setup(global, options) {
    const given = (options?.wasmQuickjsDom ?? {}) as JSDOMOptions & { html?: string };
    const jsdomOpts = (options?.jsdom ?? {}) as JSDOMOptions & { html?: string };
    // html, url and the defaults are settled here, not left in the spreads: an explicit `undefined` in one source
    // must not erase the fallback the other offers (or the default), so they are taken out of both option objects
    // and set last.
    const { html: givenHtml, url: givenUrl, runScripts: givenRunScripts, resources: givenResources, pretendToBeVisual: givenVisual, ...givenRest } = given;
    const { html: jsdomHtml, url: jsdomUrl, runScripts: jsdomRunScripts, resources: jsdomResources, pretendToBeVisual: jsdomVisual, ...jsdomRest } = jsdomOpts;
    // External resources are not supported by this environment: setup returns while `dom.ready` is still pending, so
    // `resources: "usable"` (external scripts and stylesheets) may arrive after the test file has started. Markup and
    // inline scripts are settled by the JSDOM constructor.
    const dom = new JSDOM(givenHtml ?? jsdomHtml ?? "<!DOCTYPE html>", {
      ...jsdomRest,
      ...givenRest,
      pretendToBeVisual: givenVisual ?? jsdomVisual ?? true,
      runScripts: givenRunScripts ?? jsdomRunScripts ?? "dangerously",
      resources: givenResources ?? jsdomResources,
      url: givenUrl ?? jsdomUrl ?? options?.url ?? "http://localhost/",
    });
    const uninstall = installWindow(global, dom.window);
    return {
      teardown() {
        // Teardown target: the synchronous close of this page only. The timer is unref'd where it is armed,
        // and the shared fragment context is left alone.
        uninstall();
        dom.close();
      },
    };
  },
} satisfies VitestEnvironment;
