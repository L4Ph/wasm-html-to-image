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

/**
 * What the page has but a test must not get from it. An ImageData's pixels cannot cross to the host (a typed array
 * arrives as a plain object), and jsdom has none either: tests install their own.
 */
const HIDDEN = new Set(["ImageData"]);

/** A FileReader of the host's Blobs, for what Node has not got (the page's cannot read them). */
class HostFileReader {
  static readonly EMPTY = 0;
  static readonly LOADING = 1;
  static readonly DONE = 2;
  readonly EMPTY = 0;
  readonly LOADING = 1;
  readonly DONE = 2;
  readyState = 0;
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onloadstart: ((e: unknown) => void) | null = null;
  onprogress: ((e: unknown) => void) | null = null;
  onload: ((e: unknown) => void) | null = null;
  onabort: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onloadend: ((e: unknown) => void) | null = null;
  private readonly listeners = new Map<string, Set<(e: unknown) => void>>();
  private aborted = false;
  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  private fire(type: string): void {
    const event = { type, target: this, currentTarget: this, lengthComputable: false, loaded: 0, total: 0 };
    (this as any)["on" + type]?.call(this, event);
    for (const fn of this.listeners.get(type) ?? []) fn.call(this, event);
  }
  private read(blob: Blob, convert: (bytes: ArrayBuffer) => string | ArrayBuffer): void {
    this.readyState = 1;
    this.result = null;
    this.aborted = false;
    this.fire("loadstart");
    blob.arrayBuffer().then(
      (bytes) => {
        if (this.aborted) return;
        this.result = convert(bytes);
        this.readyState = 2;
        this.fire("load");
        this.fire("loadend");
      },
      (error: Error) => {
        if (this.aborted) return;
        this.error = error;
        this.readyState = 2;
        this.fire("error");
        this.fire("loadend");
      },
    );
  }
  readAsArrayBuffer(blob: Blob): void {
    this.read(blob, (bytes) => bytes);
  }
  readAsText(blob: Blob, encoding?: string): void {
    this.read(blob, (bytes) => new TextDecoder(encoding).decode(bytes));
  }
  readAsBinaryString(blob: Blob): void {
    this.read(blob, (bytes) => String.fromCharCode(...new Uint8Array(bytes)));
  }
  readAsDataURL(blob: Blob): void {
    this.read(blob, (bytes) => `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(bytes).toString("base64")}`);
  }
  abort(): void {
    if (this.readyState !== 1) return;
    this.aborted = true;
    this.result = null;
    this.readyState = 2;
    this.fire("abort");
    this.fire("loadend");
  }
}

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

import { WIN_CALL, WIN_KEYS } from "./bridge.js";

/** Define the page's globals on `global`; the result takes them off again. */
export function installWindow(global: Record<string, any>, win: Record<string, any>): () => void {
  // Reading FormData loads Node's undici, whose classes extend the global `Event` when it loads: this must be Node's
  // Event, so before the page's names are defined (a WebSocket's error event could not be made otherwise).
  const HostFormData = global.FormData as (typeof FormData) | undefined;
  const defined: string[] = [];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  // Node's own event targets (undici's WebSocket, AbortSignal) make events with the global `Event`, which is the page's
  // here, and cannot take them: they get a Node event of the same type.
  const HostEvent = global.Event as typeof Event | undefined;
  const hostDispatch = (global.EventTarget as typeof EventTarget | undefined)?.prototype.dispatchEvent;
  if (HostEvent && hostDispatch) {
    global.EventTarget.prototype.dispatchEvent = function (this: EventTarget, event: Event) {
      if (event instanceof HostEvent) return hostDispatch.call(this, event);
      const page = event as Event;
      return hostDispatch.call(this, new HostEvent(page.type, { bubbles: page.bubbles, cancelable: page.cancelable }));
    };
  }
  const hostEventTarget = global.EventTarget;
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
    if (key.startsWith("__") || KEEP.has(key) || HIDDEN.has(key) || key === "close") continue;
    // what Node has under the same name (the language's own: Object, Array, Promise, ...) stays
    if (key in global && !/^[A-Z]/.test(key)) continue;
    if (key in global && !isDomName(key)) continue;
    // What a test assigns stays what it reads back (a fake's identity and own properties: sinon's fake timers keep
    // `hadOwnProperty` on the function they installed and would delete the global on uninstall without it). The page
    // gets it too.
    let assigned = false;
    let value: unknown;
    let boundFrom: unknown;
    let bound: unknown;
    const isClass = /^[A-Z]/.test(key);
    define(key, {
      get: () => {
        if (assigned) return value;
        const v = win[key];
        if (isClass || typeof v !== "function") return v;
        // a function of the window (addEventListener, getComputedStyle, ...) is called with the page's window as `this`
        if (v !== boundFrom) {
          boundFrom = v;
          const call = (win as any)[WIN_CALL] as ((name: string, args: unknown[]) => unknown) | undefined;
          // by name only while the page's own function is what the name holds: a test that wraps it keeps this one as the
          // original, and asking for the name would call the wrapper again
          const direct = v.bind(win);
          bound = call ? (...args: unknown[]) => (assigned ? direct(...args) : call(key, args)) : direct;
        }
        return bound;
      },
      set: (v: unknown) => {
        assigned = true;
        value = v;
        win[key] = v;
      },
    });
  }
  if (typeof global.FileReader !== "function") define("FileReader", { value: HostFileReader, writable: true });
  // Node's FormData stays (fetch takes it), but it knows no forms: one made from a form reads its fields from the page
  if (typeof HostFormData === "function") {
    define("FormData", {
      writable: true,
      value: class FormData extends HostFormData {
        constructor(form?: unknown, submitter?: unknown) {
          super();
          if (form === undefined || form === null) return;
          new win.FormData(form, submitter).forEach((value: unknown, name: string) => {
            // ponytail: a file of the page arrives as an empty File; read its bytes when a test needs them
            if (typeof value === "string") this.append(name, value);
            else this.append(name, new File([], String((value as { name?: string })?.name ?? "")));
          });
        }
      },
    });
  }
  define("window", { value: global, writable: true });
  define("self", { value: global, writable: true });
  // the window object itself: reads go to the page, and so do the writes tests make (window.scrollTo = ..., window.matchMedia = ...)
  let doc: unknown;
  define("document", { get: () => (doc ??= win.document) });
  define("navigator", { get: () => win.navigator });
  return () => {
    if (hostDispatch) hostEventTarget.prototype.dispatchEvent = hostDispatch;
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
