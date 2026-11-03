/**
 * A Vitest environment: the test file's globals (`document`, `window`, `HTMLElement`, `Event`, ...) are the page's.
 *
 * ```ts
 * // vitest.config.ts
 * export default { test: { environment: "wasm-quickjs-dom/vitest" } };
 * // or in one file: // @vitest-environment wasm-quickjs-dom/vitest
 * ```
 *
 * Options go in `test.environmentOptions.wasmQuickjsDom` (those of {@link JSDOMOptions}: `url`, `html`, ...).
 */
import { JSDOM, type JSDOMOptions } from "./jsdom.js";

interface VitestEnvironment {
  name: string;
  viteEnvironment: "client";
  setup(global: Record<string, any>, options: Record<string, any>): { teardown(global: Record<string, any>): void };
}

/** What Node already has and the tests keep using: these are not replaced by the page's. */
const KEEP = new Set([
  "AbortController", "AbortSignal", "Blob", "File", "FileReader", "FormData", "Headers", "Request", "Response", "URL", "URLSearchParams",
  "TextEncoder", "TextDecoder", "DOMException", "ReadableStream", "WritableStream", "TransformStream", "MessageChannel", "MessagePort",
  "BroadcastChannel", "WebSocket", "fetch", "crypto", "performance", "queueMicrotask", "structuredClone", "setTimeout", "setInterval",
  "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "console", "process", "Buffer", "global", "globalThis", "navigator",
  "atob", "btoa",
]);

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
    const win = dom.window;
    const defined: string[] = [];
    const saved = new Map<string, PropertyDescriptor | undefined>();
    const define = (key: string, descriptor: PropertyDescriptor) => {
      const before = Object.getOwnPropertyDescriptor(global, key);
      if (before && !before.configurable) return;
      saved.set(key, before);
      Object.defineProperty(global, key, { configurable: true, enumerable: false, ...descriptor });
      defined.push(key);
    };
    for (const key of Object.getOwnPropertyNames(win)) {
      if (key.startsWith("__") || KEEP.has(key) || key === "close") continue;
      // what Node has under the same name (the language's own: Object, Array, Promise, ...) stays
      if (key in global && !/^[A-Z]/.test(key)) continue;
      if (key in global && !isDomName(key)) continue;
      const value = win[key];
      if (typeof value === "function" && /^[A-Z]/.test(key)) define(key, { value, writable: true });
      else {
        // a function of the window (addEventListener, getComputedStyle, ...) is called with the page's window as `this`
        define(key, {
          get: () => {
            const v = win[key];
            return typeof v === "function" && !/^[A-Z]/.test(key) ? v.bind(win) : v;
          },
          set: (v: unknown) => (win[key] = v),
        });
      }
    }
    define("window", { value: global, writable: true });
    define("self", { value: global, writable: true });
    // the window object itself: reads go to the page, and so do the writes tests make (window.scrollTo = ..., window.matchMedia = ...)
    define("document", { get: () => win.document });
    define("navigator", { get: () => win.navigator });
    return {
      teardown(g) {
        for (const key of defined.reverse()) {
          const before = saved.get(key);
          if (before) Object.defineProperty(g, key, before);
          else delete g[key];
        }
        dom.close();
      },
    };
  },
} satisfies VitestEnvironment;

// the capitalised names of the DOM that Node has too (Event, EventTarget, ...) are the page's in a test of the DOM; the
// language's own (Object, Array, Map, ...) are not
const LANGUAGE = new Set([
  "Object", "Function", "Array", "Number", "Boolean", "String", "Symbol", "BigInt", "Date", "RegExp", "Error", "EvalError", "RangeError",
  "ReferenceError", "SyntaxError", "TypeError", "URIError", "AggregateError", "Math", "JSON", "Promise", "Proxy", "Reflect", "Map", "Set",
  "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "Intl", "Iterator",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "WebAssembly", "Infinity", "NaN",
]);
function isDomName(key: string): boolean {
  return /^[A-Z]/.test(key) && !LANGUAGE.has(key);
}
