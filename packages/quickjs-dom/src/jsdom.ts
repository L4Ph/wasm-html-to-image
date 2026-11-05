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
import { createGuard } from "./limits.js";
import { CookieJar, type CookieJarLike } from "./cookies.js";
import { registerGlobals } from "./globals.js";
import type { DOMWindow } from "./bridge.js";
import { normalizeTimeout } from "./timeout.js";
import type { HappyDOMSettings } from "./types.js";

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

export interface ResourcesOptions {
  /** Not read: see {@link JSDOMOptions.resources}. */
  [option: string]: unknown;
}

export interface JSDOMOptions extends HappyDOMSettings {
  /** The page's URL (what `location` and relative addresses use). Default `about:blank`. */
  url?: string;
  /**
   * happy-dom's `settings` object, accepted as a nested form of {@link HappyDOMSettings}. A top-level field wins
   * over the same field here, and every field defaults to `true` (the quickjs behaviour).
   */
  settings?: HappyDOMSettings;
  /**
   * What `document.referrer` reports. `JSDOM.fromURL` also sends it as the request's `Referer` header.
   */
  referrer?: string;
  contentType?: string;
  /** `"dangerously"` runs the page's scripts, `"outside-only"` only `window.eval`; unset runs none, as in jsdom. */
  runScripts?: "dangerously" | "outside-only";
  /**
   * `"usable"` loads the scripts with a `src` (the only subresource that is loaded).
   * jsdom's `ResourcesOptions` object form (a custom `ResourceLoader` and its fetch options) is not supported:
   * only the string `"usable"` is honoured. The object form is accepted so that a jsdom config can be reused, but
   * it emits a `jsdomError` of type `"not-implemented"` on the virtual console instead of being ignored silently.
   */
  resources?: "usable" | ResourcesOptions;
  /**
   * Not supported: jsdom's quota for `localStorage` / `sessionStorage`. This page's storage is in-memory and
   * unquota'd; the option is accepted and ignored.
   */
  storageQuota?: number;
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

let sharedFragmentDom: JSDOM | undefined;

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
    const settings = options.settings ?? {};
    // happy-dom's toggles are vetoes over the jsdom switches (which stay in charge of asking for a subresource):
    // a top-level field wins over the nested `settings` form, and both default to true.
    const cssFileLoading = options.enableCSSFileLoading ?? settings.enableCSSFileLoading ?? true;
    const javascriptEvaluation = options.enableJavaScriptEvaluation ?? settings.enableJavaScriptEvaluation ?? true;
    this.virtualConsole = options.virtualConsole === null ? new VirtualConsole() : (options.virtualConsole ?? new VirtualConsole().sendTo(console));
    // jsdom's object form of `resources` (a custom ResourceLoader) cannot be honoured: only the string "usable" is.
    // Say so on the virtual console rather than ignoring the option silently.
    if (options.resources !== undefined && typeof options.resources === "object" && options.resources !== null) {
      this.virtualConsole.emit(
        "jsdomError",
        classified(new Error('resources: the ResourcesOptions object form is not supported; pass "usable" to load scripts with a src.'), "not-implemented"),
      );
    }
    const engine = options.engine ?? {};
    // the one place this facade settles the timeout: 0 / Infinity mean no limit, and a bad value fails here
    const timeout = normalizeTimeout(engine.timeout);
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
    const referrer = options.referrer;
    // document.referrer: the page has no referrer of its own, so it is written into the document before any of its
    // scripts run. beforeScripts runs after the markup is parsed and before the page's own scripts, which is the
    // earliest point the page side offers; the engine's own beforeScripts still run, after this one.
    const beforeScripts =
      referrer === undefined
        ? engine.beforeScripts
        : [`Object.defineProperty(document, "referrer", { value: ${JSON.stringify(referrer)}, configurable: true });`, ...[engine.beforeScripts ?? []].flat()];
    this.cookieJar = options.cookieJar ?? engine.cookieJar ?? new CookieJar();
    this.page = openPage(decodeHtml(html, options.contentType), url, engine.quickjsWasm ?? defaultWasm(), {
      ...engine,
      timeout,
      beforeScripts,
      cookieJar: this.cookieJar,
      onLog: report,
      // CSS files follow jsdom's subresource switch, and enableCSSFileLoading can veto them within it
      stylesheets: options.resources === "usable" && cssFileLoading,
      visual: options.pretendToBeVisual ?? false,
    });
    const bridge = this.page.dom.bridge({ timeout });
    this.bridgeWindow = bridge.window;
    // the page's `window.close()` ends the page
    this.bridgeWindow.close = () => this.close();
    // jsdom's window stubs do nothing useful but say so on the virtual console; ours were silent. Keep the page's
    // no-answers (alert/focus/scroll still do not throw) and add the one line jsdom adds: a "not-implemented" error.
    // Only this class of error is emitted; a failed subresource ("resource-loading") is still not classified.
    for (const name of ["alert", "blur", "confirm", "focus", "moveBy", "moveTo", "open", "print", "prompt", "resizeBy", "resizeTo", "scroll", "scrollBy", "scrollTo"] as const) {
      const stub = (this.bridgeWindow as any)[name];
      if (typeof stub !== "function") continue;
      (this.bridgeWindow as any)[name] = (...args: unknown[]) => {
        this.virtualConsole.emit("jsdomError", classified(new Error(`Not implemented: Window's ${name}() method`), "not-implemented"));
        return stub.apply(this.bridgeWindow, args);
      };
    }
    this.page.onActivity = () => this.arm();
    options.beforeParse?.(this.bridgeWindow);
    // the inline scripts run before start() returns its promise; the rest (fetched scripts, load events, timers)
    // goes on behind the caller
    const scripts = options.runScripts === "dangerously" && javascriptEvaluation;
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

  /**
   * happy-dom's `goto()`, reduced to a new page: `JSDOM.fromURL` (`file:` URLs go through `JSDOM.fromFile`) and
   * then `await ready`. One JSDOM is one QuickJS realm, so the current page is not navigated in place and is left
   * open for the caller (`dom.close()`); the returned page is the one that loaded.
   */
  async goto(url: string, options: JSDOMOptions = {}): Promise<JSDOM> {
    const next = /^file:/i.test(url)
      ? await JSDOM.fromFile((await import("node:url")).fileURLToPath(url), options)
      : await JSDOM.fromURL(url, options);
    await next.ready;
    return next;
  }

  /** happy-dom's `waitUntilComplete()`, reduced to waiting for `dom.ready` (external scripts and the `load` event). */
  waitUntilComplete(): Promise<void> {
    return this.ready;
  }

  /** happy-dom's `window.happyDOM` calls, reduced to the two this facade offers. */
  get happyDOM(): { goto: (url: string, options?: JSDOMOptions) => Promise<JSDOM>; waitUntilComplete: () => Promise<void> } {
    return { goto: (url, options) => this.goto(url, options), waitUntilComplete: () => this.waitUntilComplete() };
  }

  /** Parse HTML into a DocumentFragment using a shared synchronous JSDOM context. */
  static fragment(html = ""): any {
    sharedFragmentDom ??= new JSDOM("");
    return sharedFragmentDom.window.document.createRange().createContextualFragment(html);
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
    const guard = createGuard(options.engine?.limits);
    const timeout = normalizeTimeout(options.engine?.timeout);
    const fetchPromise = guard.fetch(url, { headers });
    // no race at all when unlimited: a 10 s timer would end a page meant to wait forever
    const res =
      timeout === Infinity
        ? await fetchPromise
        : await Promise.race([
            fetchPromise,
            new Promise<Response>((_, reject) => setTimeout(() => reject(new Error(`Timed out loading ${url} (${timeout} ms).`)), timeout)),
          ]);
    for (const sc of res.headers?.getSetCookie?.() ?? []) jar.setCookieSync(sc, res.url || url);
    const body = await guard.bytes(res);
    return new JSDOM(body, { ...options, cookieJar: jar, url: res.url || url, contentType: options.contentType ?? res.headers?.get?.("content-type") ?? undefined });
  }

  /** Read a file and make it a JSDOM, with a `file:` URL unless one is given. */
  static async fromFile(file: string, options: JSDOMOptions = {}): Promise<JSDOM> {
    const { pathToFileURL } = await import("node:url");
    return new JSDOM(readFileSync(file), { ...options, url: options.url ?? pathToFileURL(file).href });
  }
}

/** Options of {@link register}: {@link JSDOMOptions} plus the markup of the registered page. */
export interface RegisterOptions extends JSDOMOptions {
  /** The markup of the page (default `<!DOCTYPE html>`). */
  html?: string;
}

let registered: { dom: JSDOM; uninstall: () => void } | undefined;

/**
 * happy-dom's `GlobalRegistrator.register()`: make a page the process globals (`document`, `window`, `HTMLElement`,
 * ...). The page is a fresh {@link JSDOM}; registering again replaces (and closes) the previous one.
 * `unregister()` takes the globals off again and closes the page.
 *
 * ```ts
 * import { register, unregister } from "wasm-quickjs-dom/jsdom";
 * register({ url: "http://localhost/", runScripts: "dangerously" });
 * // ... tests use document / window ...
 * unregister();
 * ```
 */
export function register(options: RegisterOptions = {}): JSDOM {
  const { html = "<!DOCTYPE html>", ...rest } = options;
  unregister();
  const dom = new JSDOM(html, rest);
  const uninstall = registerGlobals(globalThis as unknown as Record<string, any>, dom.window as unknown as Record<string, any>);
  registered = { dom, uninstall };
  return dom;
}

/** Take the globals registered by {@link register} off `globalThis` and close the page (no-op when none is). */
export function unregister(): void {
  const current = registered;
  if (!current) return;
  registered = undefined;
  current.uninstall();
  current.dom.close();
}

/** Whether {@link register} currently owns the process globals. */
export function isRegistered(): boolean {
  return registered !== undefined;
}

/** happy-dom's `GlobalRegistrator` object: the same three functions, for a config written against it. */
export const GlobalRegistrator = { register, unregister, isRegistered } as const;
