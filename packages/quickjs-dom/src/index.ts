/**
 * A small JSDOM for runtimes without Node: a page's scripts run in QuickJS (compiled to WebAssembly) on a linkedom DOM.
 *
 * Runs wherever WebAssembly does, `eval` or not, so it also works on Cloudflare Workers, Vercel Edge, Deno, Bun and
 * browsers. The guest program (`dist/edge-js-payload.js`, built by `scripts/build-edge-js.mjs`) holds the DOM and the
 * browser globals a bare QuickJS lacks; this host fetches scripts, keeps time for the timers and serializes the DOM.
 *
 * It is a smaller DOM than jsdom's and an interpreter: no layout (like jsdom), no canvas, and heavy pages are slower.
 * It is for trusted pages: the page's scripts can `fetch`.
 *
 * The QuickJS wasm is chosen by the runtime (`#quickjs-wasm` in package.json), so nothing needs importing for it:
 *
 * ```ts
 * import { createDOM } from "wasm-quickjs-dom";
 * const dom = await createDOM({ url: "https://example.com/" });
 * console.log(await dom.eval("document.title"));
 * dom.close();
 * ```
 *
 * Nothing here knows about images: `toOptions()` only fills `value` / `baseUrl` of an options object.
 */
// @ts-expect-error — dist/edge-js-payload.js is generated at build time
import { guestBytecode } from "../dist/edge-js-payload.js";
import defaultQuickJSWasm from "#quickjs-wasm";
import { createGuard, type FetchLimits } from "./limits.js";
import { QuickJSInstance } from "./runtime.js";

export { isPrivateHost, type FetchLimits } from "./limits.js";

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
}

/** What the script phase produced. */
export interface ScriptedPage {
  /** The DOM after the scripts ran, serialized as HTML. */
  html: string;
  /** The document's final URL (after redirects), for resolving relative resources. */
  baseUrl: string;
}

/** What {@link QuickJSDOM.toOptions} reads and writes of an options object (render options fit). */
interface PageInput {
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

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_SETTLE_MS = 1000;
const MEMORY_LIMIT = 256 * 1024 * 1024;
const MAX_MODULES = 300;
const MAX_LOGS = 1000;

// a fetched body crosses into the page as base64, so binary data survives
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// QuickJS recurses on the host's own stack, which is about 1 MB on V8: its limit must stop a runaway script first
const STACK_LIMIT = 192 * 1024;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// four random words for the page's Math.random (the guest is copied from one start, so it must not keep its own)
function randomSeed(): number[] {
  const words = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(words);
  else for (let i = 0; i < 4; i++) words[i] = (Math.random() * 4294967296) >>> 0;
  return Array.from(words);
}

// the guest program as QuickJS bytecode (made at build time by scripts/build-edge-js.mjs with this very QuickJS)
let guestBytes: Uint8Array | undefined;
const guest = () => (guestBytes ??= Uint8Array.from(atob(guestBytecode as string), (c) => c.charCodeAt(0)));

// every page runs in an instance of its own: a compiled module is all that is shared
async function loadModule(wasm: WebAssembly.Module | undefined): Promise<WebAssembly.Module> {
  const compiled = wasm ?? (await defaultQuickJSWasm());
  if (!compiled) throw new Error("The QuickJS wasm (quickjs.wasm of wasm-quickjs-dom) could not be loaded; pass a compiled module as `quickjsWasm`.");
  return compiled;
}

/** Options of {@link createDOM}: the script phase's, the viewport width and the QuickJS module. */
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
   * The DOM implementation: `"native"` is the one written in C inside the QuickJS wasm (much faster),
   * `"linkedom"` the JavaScript one (default for now).
   */
  dom?: "native" | "linkedom";
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
  /** The document as it is now, as HTML. */
  serialize(): string;
  /**
   * The page as HTML for a layout engine: every element's `class` starts with `qjsl-<n>` (its number, in document
   * order), so boxes that report `class` can be matched back to elements. The page itself is not changed.
   * Pair it with {@link QuickJSDOM.setLayout}; `wasm-html-to-image/javascript` has `measureLayout()` doing both.
   */
  markForLayout(): string;
  /**
   * Give the page a layout: `boxes` maps an element number (see {@link QuickJSDOM.markForLayout}) to its
   * `[x, y, width, height]` in page coordinates. Afterwards `getBoundingClientRect()`, `getClientRects()`,
   * `offsetWidth` / `offsetHeight` / `offsetLeft` / `offsetTop`, `clientWidth` / `clientHeight` and
   * `scrollWidth` / `scrollHeight` answer from it (the offsets are measured from the page, not from an offset
   * parent). An element without a box is 0 x 0. The layout is not kept in step with later changes to the page:
   * measure again.
   */
  setLayout(boxes: Record<number, [number, number, number, number]>): void;
  /** Options for a renderer that draws this page: `value` is the serialized DOM and `baseUrl` is this page's. */
  toOptions<T extends PageInput>(options: T): T;
  /** Free the QuickJS runtime. The page cannot be used afterwards. */
  close(): void;
}

/**
 * Run a page's scripts in QuickJS and keep the page for further use.
 * Give `url` to fetch the page, or `html` (with an optional `baseUrl`) for markup you already have.
 * Call `close()` when done.
 *
 * ```ts
 * const dom = await createDOM({ html: "<h1>Hi</h1><script>document.title = 'x'</script>" });
 * await dom.eval("document.title"); // "x"
 * dom.close();
 * ```
 */
export async function createDOM(
  source: { url?: string; html?: string; baseUrl?: string },
  options: CreateDOMOptions = {},
): Promise<QuickJSDOM> {
  const opts = options;
  const viewportWidth = options.width ?? 800;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  let started = Date.now();
  let deadline = started + timeout;
  let vmDeadline: ((ms: number) => void) | undefined;
  // every call into the page gets a fresh `timeout`
  const begin = () => {
    started = Date.now();
    deadline = started + timeout;
    vmDeadline?.(deadline);
  };
  const guard = createGuard(opts.limits);
  const logs: PageLogEntry[] = [];
  const log = (entry: PageLogEntry) => {
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    try {
      opts.onLog?.(entry);
    } catch {
      // a listener's failure is not the page's
    }
  };
  const loggedFetch = async (input: string | URL, init: RequestInit = {}, isPage = false): Promise<Response> => {
    const entry = { type: "request" as const, method: init.method ?? "GET", url: String(input) };
    try {
      if (!isPage && opts.skip?.(entry.url)) throw new Error(`Skipped by the skip option: ${entry.url}`);
      const res = await guard.fetch(input, init);
      log({ ...entry, status: res.status });
      return res;
    } catch (error) {
      log({ ...entry, error: String(error) });
      throw error;
    }
  };
  const text = async (res: Response) => new TextDecoder().decode(await guard.bytes(res));
  const remaining = () => Math.max(0, timeout - (Date.now() - started));

  let html = source.html ?? "";
  let baseUrl = source.baseUrl || "about:blank";
  if (source.url) {
    const res = await Promise.race([
      loggedFetch(source.url, {}, true),
      sleep(timeout).then(() => {
        throw new Error(`Timed out loading ${source.url} for the \`javascript\` option (${timeout} ms).`);
      }),
    ]);
    html = await text(res);
    baseUrl = res.url || source.url;
  }

  const wasm = await loadModule(opts.quickjsWasm);

  let closed = false;
  const timers: { id: number; at: number }[] = [];
  const exposed = new Map<string, (...args: any[]) => unknown>();
  const inflight = new Set<Promise<void>>();
  const debug = typeof process !== "undefined" && !!process.env?.WASM_HTML_TO_IMAGE_DEBUG;

  // ES modules: QuickJS loads them synchronously, so the host fetches a module's whole import graph first
  // (static imports and `import("literal")`), then serves the sources from memory
  const modules = new Map<string, string | Error>();
  const resolveModule = (base: string, name: string) => {
    try {
      return new URL(name, base).href;
    } catch {
      return name;
    }
  };

  // let the page's reactions to what happened run
  let pump = () => {};
  const vm = QuickJSInstance.create(
    wasm,
    {
      log(level, message) {
        if (debug) console.error("[page " + level + "]", message);
        log({ type: "console", level: level === "warn" || level === "error" ? level : "log", message });
      },
      rejection(message) {
        if (debug) console.error("[page unhandled rejection]", message);
        log({ type: "rejection", message });
      },
      timer(id, ms) {
        timers.push({ id, at: Date.now() + ms });
      },
      fetch(id, target, method) {
        const settle = (ok: boolean, text: string) => {
          if (closed) return;
          vm.settle(id, ok, text);
          pump();
        };
        const track = (work: Promise<void>) => {
          const task: Promise<void> = work.finally(() => {
            inflight.delete(task);
            pump();
          });
          inflight.add(task);
        };
        // expose(): the page's call arrives as a fetch of "expose:<name>" whose "method" is the JSON arguments
        if (target.startsWith("expose:")) {
          const fn = exposed.get(target.slice("expose:".length));
          track(
            (async () => {
              try {
                if (!fn) throw new Error(`${target.slice("expose:".length)} is not exposed`);
                settle(true, JSON.stringify({ v: await fn(...(JSON.parse(method) as unknown[])) }));
              } catch (error) {
                settle(false, error instanceof Error ? error.message : String(error));
              }
            })(),
          );
          return;
        }
        track(
          loggedFetch(new URL(target, baseUrl), { method })
            .then(async (r) => ({ status: r.status, url: r.url, headers: Object.fromEntries(r.headers), body: toBase64(await guard.bytes(r)) }))
            .then(
              (o) => settle(true, JSON.stringify(o)),
              (e) => settle(false, String(e)),
            ),
        );
      },
      module(kind, base, name) {
        if (kind === 0) return resolveModule(base, name);
        const m = modules.get(base);
        return typeof m === "string" ? m : undefined;
      },
    },
    MEMORY_LIMIT,
    STACK_LIMIT,
    // the guest program is started once per module and copied from then on (see QuickJSInstance.create)
    (instance) => {
      const loaded = instance.evalBytecode(guest());
      if (loaded.type === "error") throw new Error(`The QuickJS engine could not load its guest program: ${loaded.value}`);
    },
  );
  vm.setDeadline(deadline);
  vmDeadline = (ms) => vm.setDeadline(ms);
  pump = () => {
    if (!closed) vm.jobs();
  };
  // evaluate code; false when it threw (a page's script error never stops the render)
  const run = (code: string, name: string, module = false): boolean => {
    if (closed) return false;
    const result = vm.eval(code, name, module);
    if (result.type === "error") log({ type: "error", message: result.value, source: name });
    pump();
    return result.type !== "error";
  };
  const call = (expression: string): unknown => {
    if (closed) return undefined;
    const result = vm.eval(expression, "call.js");
    if (result.type === "error") return undefined;
    pump();
    return result.type === "undefined" ? undefined : result.type === "json" ? JSON.parse(result.value) : result.value;
  };

  // the instance owns everything it allocated: letting go of it frees the runtime. A fetch still in flight finds
  // `closed` and does nothing.
  const close = () => {
    closed = true;
  };

  try {

    // QuickJS gives `import.meta` no `url`, so the module's own URL is written into its source
    const prefetchModules = async (source: string, name: string): Promise<string> => {
      const code = source.replace(/\bimport\.meta\.url\b/g, JSON.stringify(name));
      modules.set(name, code);
      const pending: string[] = [];
      for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(["'`])(\.{0,2}\/[^"'`$]+|https?:[^"'`$]+)\1/g)) {
        const target = resolveModule(name, m[2]);
        if (!modules.has(target) && modules.size < MAX_MODULES) {
          modules.set(target, new Error(`could not load module ${target}`));
          pending.push(target);
        }
      }
      await Promise.all(
        pending.map(async (target) => {
          try {
            const res = await loggedFetch(target, { signal: AbortSignal.timeout(Math.max(1, remaining())) });
            if (!res.ok) return;
            await prefetchModules(await text(res), target);
          } catch {
            // left as the load error set above
          }
        }),
      );
      return code;
    };

    const boot = vm.eval(`__edgeBoot(${JSON.stringify(html)}, ${JSON.stringify(baseUrl)}, ${Math.round(viewportWidth)}, ${JSON.stringify(randomSeed())}, ${options.dom === "native"})`, "boot.js");
    if (boot.type === "error") throw new Error(`The QuickJS engine could not build the page: ${boot.value}`);

    // scripts in document order, the ones that scripts add included; each external one is fetched by the host
    const runScripts = async () => {
      for (;;) {
        const raw = call("__edgeNextScripts()");
        const list: { idx: number; src: string | null; text: string; module?: boolean }[] = typeof raw === "string" ? JSON.parse(raw) : [];
        if (!list.length || remaining() <= 0) return;
        // the external ones are all requested at once; they still run one by one, in document order
        const sources = list.map((s) => {
          if (!s.src) return undefined;
          const name = new URL(s.src, baseUrl).href;
          return loggedFetch(name, { signal: AbortSignal.timeout(Math.max(1, remaining())) })
            .then(text)
            .then(
              (code) => ({ name, code }),
              () => undefined,
            );
        });
        for (const [i, s] of list.entries()) {
          let code = s.text;
          let name = "inline";
          if (s.src) {
            const loaded = await sources[i];
            if (!loaded) {
              call(`__edgeScriptEvent(${s.idx}, false)`);
              continue;
            }
            ({ name, code } = loaded);
          }
          call(`__edgeSetCurrent(${s.idx})`);
          if (s.module) {
            if (!s.src) name = `${baseUrl}#module-${s.idx}`;
            code = await prefetchModules(code, name);
          }
          const ok = run(code, name, s.module);
          call("__edgeSetCurrent(-1)");
          if (s.src) call(`__edgeScriptEvent(${s.idx}, ${ok})`);
        }
      }
    };
    // timers that are due, scripts that were added, then a short sleep
    const tick = async () => {
      pump();
      const now = Date.now();
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
      for (const t of due) {
        timers.splice(timers.indexOf(t), 1);
        call(`__fire(${t.id})`);
      }
      await runScripts();
      await sleep(4);
    };

    // let the page run for `ms`, or until `waitFor` matches, and until its fetches are done
    // Nothing can change the page unless a timer fires or a request answers (or a script is added, which a tick
    // finds), so a page with neither pending is finished: waiting out the rest of the time would change nothing.
    const wait = async (ms: number, waitFor?: string) => {
      if (waitFor) {
        const found = () => !!call(`__edgeHas(${JSON.stringify(waitFor)})`);
        while (remaining() > 0 && !found()) {
          await tick();
          if (inflight.size === 0 && timers.length === 0 && !found()) break; // it can no longer appear
        }
        return;
      }
      const until = Date.now() + Math.min(ms, remaining());
      let first = true;
      while (remaining() > 0 && (Date.now() < until || inflight.size > 0)) {
        if (!first && inflight.size === 0 && !timers.some((t) => t.at <= until)) break;
        first = false;
        await tick();
      }
    };
    const serialize = () => {
      if (closed) throw new Error("The DOM is closed.");
      begin();
      const out = call("__edgeSerialize()");
      if (typeof out !== "string") throw new Error("The QuickJS engine could not serialize the page.");
      return out;
    };

    await runScripts();
    call("__edgeDocumentEvents()");
    await wait(opts.settleMs ?? DEFAULT_SETTLE_MS, opts.waitFor);

    // eval(): the result lands in a global once the page's promise settles; the host ticks until it is there
    let queue: Promise<unknown> = Promise.resolve();
    const evaluate = async (code: string): Promise<unknown> => {
      if (closed) throw new Error("The DOM is closed.");
      begin();
      call("globalThis.__edgeResult = undefined");
      run(
        `Promise.resolve().then(() => (0, eval)(${JSON.stringify(code)}))` +
          `.then((v) => { try { return { ok: true, v: JSON.stringify(v) }; } catch (e) { return { ok: false, v: String(e) }; } },` +
          ` (e) => ({ ok: false, v: (e && e.message ? (e.name || 'Error') + ': ' + e.message : String(e)) }))` +
          `.then((r) => { globalThis.__edgeResult = r; });`,
        "eval.js",
      );
      for (;;) {
        const raw = call("globalThis.__edgeResult ? JSON.stringify(globalThis.__edgeResult) : undefined");
        if (typeof raw === "string") {
          const r = JSON.parse(raw) as { ok: boolean; v?: string };
          if (!r.ok) throw new Error(r.v);
          return r.v === undefined ? undefined : JSON.parse(r.v);
        }
        if (closed) throw new Error("The DOM is closed.");
        if (remaining() <= 0) throw new Error(`eval() did not finish within ${timeout} ms.`);
        await tick();
      }
    };

    const dom: QuickJSDOM = {
      baseUrl,
      logs,
      eval(code: string | ((...args: any[]) => unknown), ...args: unknown[]) {
        let source: string;
        if (typeof code === "function") source = `(${code.toString()})(...${JSON.stringify(args)})`;
        else if (args.length) throw new TypeError("eval(code, ...args): arguments need a function; a string of code takes none");
        else source = code;
        const next = queue.then(() => evaluate(source));
        queue = next.catch(() => undefined);
        return next as Promise<any>;
      },
      async waitForSelector(selector: string) {
        if (closed) throw new Error("The DOM is closed.");
        begin();
        await wait(0, selector);
        return !!call(`__edgeHas(${JSON.stringify(selector)})`);
      },
      click(selector: string) {
        return dom.eval((s: string) => {
          const el = document.querySelector(s);
          if (!el) return false;
          el.dispatchEvent(typeof MouseEvent === "function" ? new MouseEvent("click", { bubbles: true, cancelable: true }) : new Event("click", { bubbles: true, cancelable: true }));
          return true;
        }, selector);
      },
      type(selector: string, text: string) {
        return dom.eval(
          (s: string, t: string) => {
            const el = document.querySelector(s) as (HTMLElement & { value?: string }) | null;
            if (!el) return false;
            if ("value" in el) el.value = t;
            else el.textContent = t;
            for (const name of ["input", "change"]) el.dispatchEvent(new Event(name, { bubbles: true }));
            return true;
          },
          selector,
          text,
        );
      },
      expose(name: string, fn: (...args: any[]) => unknown) {
        if (closed) throw new Error("The DOM is closed.");
        exposed.set(name, fn);
        run(
          `globalThis[${JSON.stringify(name)}] = (...args) => __host.fetch("expose:" + ${JSON.stringify(name)}, JSON.stringify(args)).then((t) => JSON.parse(t).v, (e) => { throw new Error(String(e)); });`,
          "expose.js",
        );
      },
      async settle(ms?: number) {
        if (closed) throw new Error("The DOM is closed.");
        begin();
        await wait(ms ?? opts.settleMs ?? DEFAULT_SETTLE_MS);
      },
      serialize,
      markForLayout() {
        if (closed) throw new Error("The DOM is closed.");
        begin();
        const out = call("__edgeMarkLayout()");
        if (typeof out !== "string") throw new Error("The QuickJS engine could not mark the page for layout.");
        return out;
      },
      setLayout(boxes) {
        if (closed) throw new Error("The DOM is closed.");
        begin();
        if (!run(`__edgeSetLayout(${JSON.stringify(JSON.stringify(boxes))})`, "layout.js")) throw new Error("The QuickJS engine could not apply the layout.");
      },
      toOptions<T extends PageInput>(options: T): T {
        const { javascript: _javascript, ...rest } = options;
        return { ...rest, url: undefined, value: serialize(), baseUrl: options.baseUrl ?? baseUrl } as unknown as T;
      },
      close,
    };
    return dom;
  } catch (error) {
    close();
    throw error;
  }
}

/**
 * Run a page's scripts in QuickJS and return the resulting HTML.
 * Give `url` to fetch the page, or `html` (with an optional `baseUrl`) for markup you already have.
 * `option` is what {@link createDOM} takes (`true` or omitted: the defaults); the page is closed for you.
 * `viewportWidth` and `engine.quickjsWasm` are the older way of passing `width` and `quickjsWasm`.
 */
export async function runPageScriptsQuickJS(
  source: { url?: string; html?: string; baseUrl?: string },
  option: true | CreateDOMOptions = {},
  viewportWidth?: number,
  engine: EdgeJavaScriptEngine = {},
): Promise<ScriptedPage> {
  const given = option === true ? {} : option;
  const dom = await createDOM(source, { ...given, width: viewportWidth ?? given.width, quickjsWasm: engine.quickjsWasm ?? given.quickjsWasm });
  try {
    return { html: dom.serialize(), baseUrl: dom.baseUrl };
  } finally {
    dom.close();
  }
}
