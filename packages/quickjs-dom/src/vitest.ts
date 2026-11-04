/**
 * A Vitest environment: the test file's globals (`document`, `window`, `HTMLElement`, `Event`, ...) are the page's.
 *
 * ```ts
 * // vitest.config.ts
 * import { defineConfig } from "vitest/config";
 * export default defineConfig({ test: { environment: "wasm-quickjs-dom/vitest" } });
 * ```
 *
 * Prefer the `wasm-quickjs-dom/vitest` subpath export: it resolves the installed copy (including pnpm's
 * non-hoisted layout). Pointing at `./node_modules/wasm-quickjs-dom/dist/vitest.js` directly still works
 * but is deprecated.
 *
 * Options go in `test.environmentOptions.wasmQuickjsDom` (those of {@link JSDOMOptions}: `url`, `html`, ...).
 */
import { installWindow } from "./globals.js";
import { JSDOM, type JSDOMOptions } from "./jsdom.js";

/** Options this environment adds to {@link JSDOMOptions}. */
interface EnvironmentOptions extends JSDOMOptions {
  html?: string;
  /**
   * Wait for `dom.ready` (external scripts, the `load` event and the page's microtasks) before setup returns.
   * Off by default: setup stays synchronous and external resources are then unsupported (see docs/known-gaps.md).
   * When on, setup is asynchronous and gives up after the engine timeout (the default 10 s).
   */
  awaitReady?: boolean;
}

interface VitestEnvironmentReturn {
  teardown(global: Record<string, any>): Promise<void>;
}

interface VitestEnvironment {
  name: string;
  viteEnvironment: "client";
  setup(global: Record<string, any>, options: Record<string, any>): VitestEnvironmentReturn | Promise<VitestEnvironmentReturn>;
}

export default {
  name: "wasm-quickjs-dom",
  viteEnvironment: "client",
  setup(global, options) {
    const given = (options?.wasmQuickjsDom ?? {}) as EnvironmentOptions;
    const jsdomOpts = (options?.jsdom ?? {}) as EnvironmentOptions;
    // html, url and the defaults are settled here, not left in the spreads: an explicit `undefined` in one source
    // must not erase the fallback the other offers (or the default), so they are taken out of both option objects
    // and set last.
    const { html: givenHtml, url: givenUrl, runScripts: givenRunScripts, resources: givenResources, pretendToBeVisual: givenVisual, awaitReady: givenAwaitReady, ...givenRest } = given;
    const { html: jsdomHtml, url: jsdomUrl, runScripts: jsdomRunScripts, resources: jsdomResources, pretendToBeVisual: jsdomVisual, awaitReady: jsdomAwaitReady, ...jsdomRest } = jsdomOpts;
    const awaitReady = givenAwaitReady ?? jsdomAwaitReady ?? false;
    // External resources are not supported by this environment by default: setup returns while `dom.ready` is still
    // pending, so `resources: "usable"` (external scripts and stylesheets) may arrive after the test file has started.
    // Markup and inline scripts are settled by the JSDOM constructor. `awaitReady: true` opts into waiting (and into
    // the asynchronous setup that costs); off keeps the synchronous setup and no timeout runs.
    const dom = new JSDOM(givenHtml ?? jsdomHtml ?? "<!DOCTYPE html>", {
      ...jsdomRest,
      ...givenRest,
      pretendToBeVisual: givenVisual ?? jsdomVisual ?? true,
      runScripts: givenRunScripts ?? jsdomRunScripts ?? "dangerously",
      resources: givenResources ?? jsdomResources,
      url: givenUrl ?? jsdomUrl ?? options?.url ?? "http://localhost/",
    });
    const uninstall = installWindow(global, dom.window);
    const teardown = async () => {
      // The disposal procedure of docs/environment-triage.md section 5: let the in-flight load finish (or fail),
      // close the page, restore the globals, then let the host queue turn once so a callback armed by the page
      // cannot land in the next test.
      await dom.ready.catch(() => {});
      uninstall();
      dom.close();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    };
    if (!awaitReady) return { teardown };
    const timeout = (givenRest as JSDOMOptions).engine?.timeout ?? (jsdomRest as JSDOMOptions).engine?.timeout ?? 10000;
    return (async () => {
      await Promise.race([
        dom.ready.catch(() => {}),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeout);
          timer.unref?.();
        }),
      ]);
      return { teardown };
    })();
  },
} satisfies VitestEnvironment;
