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
    const dom = new JSDOM(given.html ?? "<!DOCTYPE html>", {
      url: "http://localhost:3000",
      pretendToBeVisual: true,
      runScripts: "dangerously",
      ...given,
    });
    const uninstall = installWindow(global, dom.window);
    return {
      teardown() {
        uninstall();
        dom.close();
      },
    };
  },
} satisfies VitestEnvironment;
