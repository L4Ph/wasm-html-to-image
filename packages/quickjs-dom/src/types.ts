import type { FetchLimits } from "./limits.js";
import type { Bridge, BridgeOptions } from "./bridge.js";
import type { CookieJarLike } from "./cookies.js";

/** Something that happened in the page, for finding out why it rendered the way it did. */
export type PageLogEntry =
  /** `console.log` / `warn` / `error` (and the page's timer callbacks that threw). */
  | { type: "console"; level: "log" | "warn" | "error"; message: string }
  /** A script (inline, external, module, or code run by `eval()`'s page-side hooks) threw. `source` is its URL or `inline`. */
  | { type: "error"; message: string; source: string }
  /** A promise was rejected and nothing handled it (the browser's `unhandledrejection`). */
  | { type: "rejection"; message: string }
  /** A request the page made (`fetch`, `XMLHttpRequest`, scripts, modules, the page itself), with its outcome. */
  | { type: "request"; method: string; url: string; status?: number; error?: string };

/** Options of the script phase. */
export interface JavaScriptOptions {
  /** Upper bound for the script phase in ms (default 10000). */
  timeout?: number;
  /** Extra time after the `load` event for timers and fetches to finish, in ms (default 1000). */
  settleMs?: number;
  /** CSS selector to wait for after `load`; replaces `settleMs` when given. */
  waitFor?: string;
  /**
   * Fetch the `<link rel=stylesheet>` sheets so that `getComputedStyle` cascades them too (default true).
   * A page whose scripts read computed styles must see its linked CSS, and the render path (`applyJavaScript`)
   * serializes that same page. Set false to skip those requests when only the scripts' own DOM changes matter;
   * `<style>` elements and style attributes are cascaded either way.
   */
  stylesheets?: boolean;
  /**
   * Script(s) to run in the page before any of its own: the document exists (parsed) but no `<script>` has run, so a
   * patch of a global, a probe on `setTimeout` or a flag the page checks is in place when the page starts. Runs as a
   * classic script; an error it throws is logged like a page's and the page goes on.
   */
  beforeScripts?: string | string[];
}

/** What the script phase produced. */
export interface ScriptedPage {
  /** The DOM after the scripts ran, serialized as HTML. */
  html: string;
  /** The document's final URL (after redirects), for resolving relative resources. */
  baseUrl: string;
}

/** What {@link QuickJSDOM.toOptions} reads and writes of an options object (render options fit). */
export interface PageInput {
  url?: string;
  value?: unknown;
  baseUrl?: string;
  javascript?: unknown;
}

/** Where the QuickJS engine comes from. */
export interface EdgeJavaScriptEngine {
  /**
   * A compiled QuickJS module of your own. Omit it: the package supplies its own, chosen by the runtime
   * (`#quickjs-wasm` in package.json: pre-compiled on Cloudflare Workers, read or fetched elsewhere).
   */
  quickjsWasm?: WebAssembly.Module;
}

/** Options of `createDOM`: the script phase's, the viewport width and the QuickJS module. */
export interface CreateDOMOptions extends JavaScriptOptions, EdgeJavaScriptEngine {
  /**
   * What the page may fetch: its own `fetch` / `XMLHttpRequest`, the scripts and modules it loads, and `source.url`
   * itself. Unlimited by default, so set it for pages you do not control (see {@link FetchLimits}).
   */
  limits?: FetchLimits;
  /**
   * Return true for a URL the page should not get: its request fails (and a script's `error` event fires) without
   * going to the network. Analytics, ads and the like are most of what a real site spends its time on, and a render
   * rarely needs them. The page itself (`source.url`) is never skipped.
   */
  skip?: (url: string) => boolean;
  /** Called for every {@link PageLogEntry} as it happens; they are also kept in {@link QuickJSDOM.logs}. */
  onLog?: (entry: PageLogEntry) => void;
  /** `window.innerWidth` of the page (default 800). */
  width?: number;
  /**
   * The cookie jar the page uses: `document.cookie` reads and writes it (scoped by the page's URL,
   * `HttpOnly` hidden from the page), the page's requests carry its cookies, and the `Set-Cookie`
   * headers of responses land in it. Any jar with the synchronous surface of {@link CookieJar} —
   * a tough-cookie jar, say — works, so a jar can be shared between pages. Without one the page
   * keeps a small jar of its own.
   */
  cookieJar?: CookieJarLike;
  /**
   * Whether the page pretends to be visual: `requestAnimationFrame` exists, `document.visibilityState` is
   * `\"visible\"` and the document has focus (default true). False removes the animation-frame functions and
   * reports `\"prerender\"` / no focus, as jsdom does without `pretendToBeVisual`.
   */
  visual?: boolean;
}

/**
 * A page living in QuickJS, kept open after its scripts ran (a small JSDOM for runtimes without `eval`).
 *
 * The DOM is inside the QuickJS sandbox, so it is reached with {@link QuickJSDOM.eval} and JSON values rather than
 * through live objects. The page's clock runs only while one of these methods is waiting: timers and fetches of the
 * page progress during `eval()` and `settle()`, not in between. Each call may take up to `timeout` ms.
 */
export interface QuickJSDOM {
  /** The document's URL (after redirects when it was fetched). */
  readonly baseUrl: string;
  /** What happened in the page so far: console output, script errors, unhandled rejections and requests (the last 1000). */
  readonly logs: readonly PageLogEntry[];
  /**
   * Run code in the page (global scope, like `window.eval`) and return its value as JSON. A promise is awaited, so
   * `fetch(...).then((r) => r.text())` works. A DOM node cannot be returned: return what you read from it
   * (`document.querySelector("h1").textContent`). Throws what the code threw. Calls run one after another.
   */
  eval<T = unknown>(code: string): Promise<T>;
  /**
   * Run a function in the page, with JSON-able arguments: `dom.eval((sel) => document.querySelectorAll(sel).length, "a")`.
   * The function is sent as its source text, so it must not use anything from the surrounding scope (and a transpiler
   * must leave its body alone: no helpers injected from the outside, no renamed globals).
   */
  eval<T = unknown>(fn: (...args: any[]) => T | Promise<T>, ...args: unknown[]): Promise<T>;
  /** Wait (up to `timeout`) until a CSS selector matches something; false when it never did. */
  waitForSelector(selector: string): Promise<boolean>;
  /** Dispatch a bubbling `click` on the first match of the selector. False when nothing matched. */
  click(selector: string): Promise<boolean>;
  /** Set the `value` of the first match (or its text, for an element without one) and fire `input` and `change`. False when nothing matched. */
  type(selector: string, text: string): Promise<boolean>;
  /**
   * Make a function of yours callable from the page as `await window[name](...args)`. Arguments and the result
   * travel as JSON; a throw becomes a rejection with the same message. The page's call counts as a request in flight, so
   * `settle()` waits for it.
   */
  expose(name: string, fn: (...args: any[]) => unknown): void;
  /** Let the page's timers and fetches run for `ms` (default `settleMs`) and until its fetches are done. */
  settle(ms?: number): Promise<void>;
  /** The document as it is now, as HTML. Shadow trees live outside the document tree and are not serialized. */
  serialize(): string;
  /**
   * The page as HTML for a layout engine: every element's `class` starts with `qjsl-<n>` (its number, in document
   * order), so boxes that report `class` can be matched back to elements. The page's markup is not changed (an
   * internal `__qi` number is written onto each element for {@link QuickJSDOM.setLayout}).
   * Pair it with {@link QuickJSDOM.setLayout}; `wasm-html-to-image/javascript` has `measureLayout()` doing both.
   *
   * The numbers belong to the DOM at this call. If the page changes afterwards (nodes added, removed or moved),
   * call `markForLayout()` again and measure again before `setLayout()`: `__qi` is reassigned in the new document
   * order, so boxes keyed by the old numbers would land on other elements.
   */
  markForLayout(): string;
  /**
   * Give the page a layout: `boxes` maps an element number (see {@link QuickJSDOM.markForLayout}) to its
   * `[x, y, width, height]` in page coordinates. Afterwards `getBoundingClientRect()`, `getClientRects()`,
   * `offsetWidth` / `offsetHeight` / `offsetLeft` / `offsetTop`, `clientWidth` / `clientHeight` and
   * `scrollWidth` / `scrollHeight` answer from it (the offsets are measured from the page, not from an offset
   * parent). An element without a box is 0 x 0.
   *
   * The layout is a snapshot, not kept in step with the page: once the DOM changes, the old boxes (and the `__qi`
   * numbers they are keyed by) are stale, so call `markForLayout()` again and `setLayout()` with the fresh boxes.
   * Until then the old numbers may even point at different elements.
   *
   * `getComputedStyle()` does not depend on this layout: a `width` / `height` that is `auto` or a percentage (say
   * `50%`) is returned unresolved, exactly as computed from the CSS (this DOM has no layout pass). A renderer
   * downstream is expected to resolve those values against the page; they are not pixels here.
   */
  setLayout(boxes: Record<number, [number, number, number, number]>): void;
  /** Options for a renderer that draws this page: `value` is the serialized DOM and `baseUrl` is this page's. */
  toOptions<T extends PageInput>(options: T): T;
  /**
   * The page's objects for the host's own code, synchronously: `bridge().window.document.querySelector("a").href`. Every
   * property read or method call is a call into the page; nodes are the same objects each time, and a function you give
   * the page (an event listener) is called back at once. Made on first use; `close()` ends it.
   */
  bridge(options?: BridgeOptions): Bridge;
  /** Free the QuickJS runtime. The page cannot be used afterwards. */
  close(): void;
}

/** A page that is open: its scripts have not necessarily run (see `openPage`). */
export interface OpenedPage {
  dom: QuickJSDOM;
  /**
   * Run the page's scripts, fire its load events and let it settle. `scripts` false runs none; `external` false skips
   * the ones with a `src`; `settle` false returns once the scripts have run (the caller keeps the page going with
   * {@link OpenedPage.step}).
   */
  start(mode?: { scripts?: boolean; external?: boolean; settle?: boolean }): Promise<void>;
  /** Fire what is due (timers, scripts that were added) once. */
  step(fresh?: boolean): Promise<void>;
  /** Milliseconds until something is due (0 now); -1 when nothing is waiting for time or a request. */
  nextWake(): number;
  /** Set by the owner: called after the host used the page on its own (the bridge), when something may have become due. */
  onActivity?: () => void;
}
