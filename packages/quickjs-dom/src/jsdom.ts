/**
 * `new JSDOM(html, options)`: the shape of jsdom's API over the page in QuickJS. The constructor is synchronous (the
 * markup is parsed and the inline scripts have run when it returns) and `dom.window` is the bridge's window, so the
 * host's code reads and writes the page's objects directly. Node.js and Bun only (it reads `quickjs.wasm` from disk);
 * pass `quickjsWasm` elsewhere.
 *
 * ```ts
 * import { JSDOM } from "wasm-quickjs-dom/jsdom";
 * const dom = new JSDOM("<p>Hello</p>");
 * dom.window.document.querySelector("p").textContent; // "Hello"
 * ```
 */
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { openPage, type CreateDOMOptions, type OpenedPage, type PageLogEntry } from "./index.js";
import { decodeHtml } from "./decode.js";
import { CookieJar, type CookieJarLike } from "./cookies.js";
import type { DOMWindow } from "./bridge.js";

export type { DOMWindow };
export { CookieJar, type Cookie, type CookieJarLike } from "./cookies.js";

/** jsdom's VirtualConsole: the page's console output and errors as events. */
export class VirtualConsole extends EventEmitter {
  /**
   * Forward `log` / `info` / `warn` / `error` / `debug` to a console, and (unless `omitJSDOMErrors`) `jsdomError`
   * to its `error`.
   */
  sendTo(anyConsole: Pick<Console, "log" | "info" | "warn" | "error" | "debug">, options: { omitJSDOMErrors?: boolean } = {}): this {
    for (const method of ["log", "info", "warn", "error", "debug"] as const) this.on(method, (...args: unknown[]) => anyConsole[method](...args));
    if (!options.omitJSDOMErrors) this.on("jsdomError", (error: Error) => anyConsole.error(error.stack ?? String(error)));
    return this;
  }
}

export interface JSDOMOptions {
  /** The page's URL (what `location` and relative addresses use). Default `about:blank`. */
  url?: string;
  referrer?: string;
  contentType?: string;
  /** `"dangerously"` runs the page's scripts, `"outside-only"` only `window.eval`; unset runs none, as in jsdom. */
  runScripts?: "dangerously" | "outside-only";
  /** `"usable"` loads the scripts with a `src` (the only subresource that is loaded). */
  resources?: "usable";
  /**
   * The page pretends to be visual: `requestAnimationFrame` exists, the document is `"visible"` and focused.
   * Without it (jsdom's default) there are no animation frames, `visibilityState` is `"prerender"` and
   * `document.hasFocus()` is false.
   */
  pretendToBeVisual?: boolean;
  /**
   * The cookie jar of the page, shared or injected: `document.cookie`, the cookies of the page's
   * requests and the `Set-Cookie` headers of its responses all go through it. Any jar with the
   * synchronous surface of {@link CookieJar} — tough-cookie's own included. Without one, a fresh
   * {@link CookieJar} of this package is used (and is readable as `dom.cookieJar`, as in jsdom).
   */
  cookieJar?: CookieJarLike;
  virtualConsole?: VirtualConsole | null;
  /** Called with the window before the scripts run. */
  beforeParse?(window: DOMWindow): void;
  /** Wasm, scripts and other options of the engine behind it (see {@link CreateDOMOptions}). */
  engine?: CreateDOMOptions;
}

let compiled: WebAssembly.Module | undefined;
function defaultWasm(): WebAssembly.Module {
  if (compiled) return compiled;
  // beside this file when built (dist/), one folder up when run from src/
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(new URL("./quickjs.wasm", import.meta.url));
  } catch {
    bytes = readFileSync(new URL("../dist/quickjs.wasm", import.meta.url));
  }
  return (compiled = new WebAssembly.Module(bytes as BufferSource));
}

/** An error for the virtual console, classified the way jsdom classifies them (its `type` field). */
const classified = (error: unknown, type: string): Error => {
  const e = (error instanceof Error ? error : new Error(String(error))) as Error & { type?: string };
  e.type = type;
  return e;
};

export class JSDOM {
  readonly virtualConsole: VirtualConsole;
  /** The jar this page's cookies live in (the one passed in, or a fresh one). */
  readonly cookieJar: CookieJarLike;
  private readonly page: OpenedPage;
  private readonly bridgeWindow: DOMWindow;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** Resolves when the scripts have run and the `load` event has fired. */
  readonly ready: Promise<void>;

  constructor(html?: string | Uint8Array, options: JSDOMOptions = {}) {
    this.virtualConsole = options.virtualConsole === null ? new VirtualConsole() : (options.virtualConsole ?? new VirtualConsole().sendTo(console));
    const engine = options.engine ?? {};
    const report = (entry: PageLogEntry) => {
      try {
        engine.onLog?.(entry);
      } catch {
        // a listener's failure is not the page's
      }
      if (entry.type === "console") this.virtualConsole.emit(entry.level, entry.message);
      else if (entry.type === "error" || entry.type === "rejection") {
        // jsdom classifies the errors it reports on the virtual console with a `type` of its own
        const error = new Error(entry.message) as Error & { type?: string };
        error.type = "unhandled-exception";
        this.virtualConsole.emit("jsdomError", error);
      }
    };
    const url = options.url ?? "about:blank";
    this.cookieJar = options.cookieJar ?? engine.cookieJar ?? new CookieJar();
    this.page = openPage(decodeHtml(html, options.contentType), url, engine.quickjsWasm ?? defaultWasm(), { ...engine, cookieJar: this.cookieJar, onLog: report, stylesheets: options.resources === "usable", visual: options.pretendToBeVisual ?? false });
    const bridge = this.page.dom.bridge({ timeout: engine.timeout });
    this.bridgeWindow = bridge.window;
    // the page's `window.close()` ends the page
    this.bridgeWindow.close = () => this.close();
    this.page.onActivity = () => this.arm();
    options.beforeParse?.(this.bridgeWindow);
    // the inline scripts run before start() returns its promise; the rest (fetched scripts, load events, timers)
    // goes on behind the caller
    const scripts = options.runScripts === "dangerously";
    this.ready = this.page
      .start({ scripts, external: scripts && options.resources === "usable", settle: false })
      .catch((error) => {
        this.virtualConsole.emit("jsdomError", classified(error, "unhandled-exception"));
      })
      .then(() => this.arm());
  }

  /** The page's `window`. */
  get window(): DOMWindow {
    return this.bridgeWindow;
  }

  /** The document as HTML, doctype included. */
  serialize(): string {
    return this.page.dom.serialize();
  }

  /** jsdom keeps source locations of nodes when asked; this does not. */
  nodeLocation(): never {
    throw new Error("nodeLocation() is not supported: the parser does not keep source locations.");
  }

  getInternalVMContext(): never {
    throw new Error("getInternalVMContext() is not supported: the page does not run in a Node vm context. Use window.eval(code).");
  }

  /** Stop the page: its timers end and its objects stop working. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.page.dom.close();
  }

  /** Reconfigure aspects of the window that JSDOM supports changing after construction. */
  reconfigure(options: { url?: string; windowTop?: DOMWindow }): void {
    if (options.url) {
      this.bridgeWindow.history.replaceState(null, "", options.url);
    }
    if (options.windowTop) {
      this.bridgeWindow.top = options.windowTop;
    }
  }

  /** Parse HTML into a DocumentFragment using a lightweight synchronous JSDOM context. */
  static fragment(html = ""): any {
    const dom = new JSDOM("");
    return dom.window.document.createRange().createContextualFragment(html);
  }

  // The page's timers and requests go on after the constructor returns, and after every call the host makes into it.
  // They do not keep the process alive (a page nobody closed must not hold a test run open).
  private arm(): void {
    if (this.closed || this.timer) return;
    const wait = this.page.nextWake();
    if (wait < 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.page.step(true).then(
        () => this.arm(),
        (error) => {
          this.virtualConsole.emit("jsdomError", classified(error, "unhandled-exception"));
          this.arm();
        },
      );
    }, wait);
    this.timer.unref?.();
  }

  /** Fetch a page and make it a JSDOM (the scripts load and run behind, as in the constructor). */
  static async fromURL(url: string, options: JSDOMOptions = {}): Promise<JSDOM> {
    const jar = options.cookieJar ?? options.engine?.cookieJar ?? new CookieJar();
    const headers = new Headers(options.referrer ? { referer: options.referrer } : undefined);
    const cookies = jar.getCookieStringSync(url);
    if (cookies && !headers.has("cookie")) headers.set("cookie", cookies);
    const res = await fetch(url, { headers });
    for (const sc of res.headers.getSetCookie?.() ?? []) jar.setCookieSync(sc, res.url || url);
    const body = new Uint8Array(await res.arrayBuffer());
    return new JSDOM(body, { ...options, cookieJar: jar, url: res.url || url, contentType: options.contentType ?? res.headers.get("content-type") ?? undefined });
  }

  /** Read a file and make it a JSDOM, with a `file:` URL unless one is given. */
  static async fromFile(file: string, options: JSDOMOptions = {}): Promise<JSDOM> {
    const { pathToFileURL } = await import("node:url");
    return new JSDOM(readFileSync(file), { ...options, url: options.url ?? pathToFileURL(file).href });
  }
}
