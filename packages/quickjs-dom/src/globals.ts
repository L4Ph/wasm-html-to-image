/**
 * Make the page's window the globals of a test environment (Vitest, Jest): `document`, `window`, `HTMLElement`, `Event`
 * and the rest of the page's global names are defined on `global`, and taken off again by the function this returns.
 */

/** What Node already has and the tests keep using: these are not replaced by the page's. */
const KEEP = new Set([
  "AbortController", "AbortSignal", "Blob", "File", "FileReader", "FormData", "Headers", "Request", "Response", "URL", "URLSearchParams",
  "TextEncoder", "TextDecoder", "TextEncoderStream", "TextDecoderStream", "CompressionStream", "DecompressionStream",
  "DOMException", "ReadableStream", "WritableStream", "TransformStream", "ByteLengthQueuingStrategy", "CountQueuingStrategy",
  "MessageChannel", "MessagePort",
  "BroadcastChannel", "WebSocket", "fetch", "crypto", "performance", "queueMicrotask", "structuredClone", "setTimeout", "setInterval",
  "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "console", "process", "Buffer", "global", "globalThis", "navigator",
  "atob", "btoa",
]);

// the capitalised names of the DOM that Node has too (Event, EventTarget, ...) are the page's in a test of the DOM; the
// language's own (Object, Array, Map, ...) are not
const LANGUAGE = new Set([
  "Object", "Function", "Array", "Number", "Boolean", "String", "Symbol", "BigInt", "Date", "RegExp", "Error", "EvalError", "RangeError",
  "ReferenceError", "SyntaxError", "TypeError", "URIError", "AggregateError", "Math", "JSON", "Promise", "Proxy", "Reflect", "Map", "Set",
  "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "Intl", "Iterator",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "WebAssembly", "Infinity", "NaN",
]);
const isDomName = (key: string) => /^[A-Z]/.test(key) && !LANGUAGE.has(key);

import { WIN_KEYS } from "./bridge.js";

/** Define the page's globals on `global`; the result takes them off again. */
export function installWindow(global: Record<string, any>, win: Record<string, any>): () => void {
  const defined: string[] = [];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const define = (key: string, descriptor: PropertyDescriptor) => {
    const before = Object.getOwnPropertyDescriptor(global, key);
    if (!saved.has(key) && before && !before.configurable) return;
    // a name defined twice in one call (document, window, ... below are also the page's own) keeps the descriptor of
    // its first definition as the one to restore: saving the second would leave the page's getter installed after
    // the uninstaller ran.
    if (!saved.has(key)) saved.set(key, before);
    Object.defineProperty(global, key, { configurable: true, enumerable: false, ...descriptor });
    if (!defined.includes(key)) defined.push(key);
  };
  const keys: string[] = typeof (win as any)[WIN_KEYS] === "function" ? (win as any)[WIN_KEYS]() : Object.getOwnPropertyNames(win);
  for (const key of keys) {
    if (key.startsWith("__") || KEEP.has(key) || key === "close") continue;
    // what Node has under the same name (the language's own: Object, Array, Promise, ...) stays
    if (key in global && !/^[A-Z]/.test(key)) continue;
    if (key in global && !isDomName(key)) continue;
    if (/^[A-Z]/.test(key)) {
      define(key, {
        get: () => win[key],
        set: (v: unknown) => (win[key] = v),
      });
    } else {
      // a function of the window (addEventListener, getComputedStyle, ...) is called with the page's window as `this`
      define(key, {
        get: () => {
          const v = win[key];
          return typeof v === "function" ? v.bind(win) : v;
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
  return () => {
    for (const key of defined.reverse()) {
      const before = saved.get(key);
      if (before) Object.defineProperty(global, key, before);
      else delete global[key];
    }
  };
}

// The environment registered for the process, as happy-dom's GlobalRegistrator keeps one. `installWindow` itself is
// reentrant; this singleton is only for the `register()` / `unregister()` pair (src/jsdom.ts), which cannot return
// the uninstaller to its caller.
let current: { global: Record<string, any>; uninstall: () => void } | undefined;

/**
 * Install a page's globals as the process environment (a happy-dom `GlobalRegistrator` style singleton): the
 * previously registered window, if any, is taken off first. The returned function uninstalls this one and is a
 * no-op once {@link registerGlobals} has been called again.
 */
export function registerGlobals(global: Record<string, any>, win: Record<string, any>): () => void {
  if (current) {
    const previous = current;
    current = undefined;
    previous.uninstall();
  }
  const uninstall = installWindow(global, win);
  const entry = { global, uninstall };
  current = entry;
  return () => {
    if (current !== entry) return;
    current = undefined;
    uninstall();
  };
}

/** Take the window registered by {@link registerGlobals} off its global (no-op when none is registered). */
export function unregisterGlobals(global: Record<string, any> = globalThis as unknown as Record<string, any>): void {
  if (!current || current.global !== global) return;
  const { uninstall } = current;
  current = undefined;
  uninstall();
}

/** Whether a window is currently registered as the process globals. */
export function isGlobalsRegistered(): boolean {
  return current !== undefined;
}
