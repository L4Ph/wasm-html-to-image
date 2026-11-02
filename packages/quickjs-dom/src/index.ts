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
import { QuickJSInstance } from "./runtime.js";

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

// a fetched body crosses into the page as base64, so binary data survives
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// QuickJS recurses on the host's own stack, which is about 1 MB on V8: its limit must stop a runaway script first
const STACK_LIMIT = 192 * 1024;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  /** `window.innerWidth` of the page (default 800). */
  width?: number;
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
  /**
   * Run code in the page (global scope, like `window.eval`) and return its value as JSON. A promise is awaited, so
   * `fetch(...).then((r) => r.text())` works. A DOM node cannot be returned: return what you read from it
   * (`document.querySelector("h1").textContent`). Throws what the code threw. Calls run one after another.
   */
  eval(code: string): Promise<unknown>;
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
  const remaining = () => Math.max(0, timeout - (Date.now() - started));

  let html = source.html ?? "";
  let baseUrl = source.baseUrl || "about:blank";
  if (source.url) {
    const res = await Promise.race([
      fetch(source.url),
      sleep(timeout).then(() => {
        throw new Error(`Timed out loading ${source.url} for the \`javascript\` option (${timeout} ms).`);
      }),
    ]);
    html = await res.text();
    baseUrl = res.url || source.url;
  }

  const wasm = await loadModule(opts.quickjsWasm);

  let closed = false;
  const timers: { id: number; at: number }[] = [];
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
        const task: Promise<void> = fetch(new URL(target, baseUrl), { method })
          .then(async (r) => ({ status: r.status, url: r.url, headers: Object.fromEntries(r.headers), body: toBase64(new Uint8Array(await r.arrayBuffer())) }))
          .then(
            (o) => settle(true, JSON.stringify(o)),
            (e) => settle(false, String(e)),
          )
          .finally(() => {
            inflight.delete(task);
            pump();
          });
        inflight.add(task);
      },
      module(kind, base, name) {
        if (kind === 0) return resolveModule(base, name);
        const m = modules.get(base);
        return typeof m === "string" ? m : undefined;
      },
    },
    MEMORY_LIMIT,
    STACK_LIMIT,
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
            const res = await fetch(target, { signal: AbortSignal.timeout(Math.max(1, remaining())) });
            if (!res.ok) return;
            await prefetchModules(await res.text(), target);
          } catch {
            // left as the load error set above
          }
        }),
      );
      return code;
    };

    const loaded = vm.evalBytecode(guest());
    if (loaded.type === "error") throw new Error(`The QuickJS engine could not load its guest program: ${loaded.value}`);
    const boot = vm.eval(`__edgeBoot(${JSON.stringify(html)}, ${JSON.stringify(baseUrl)}, ${Math.round(viewportWidth)})`, "boot.js");
    if (boot.type === "error") throw new Error(`The QuickJS engine could not build the page: ${boot.value}`);

    // scripts in document order, the ones that scripts add included; each external one is fetched by the host
    const runScripts = async () => {
      for (;;) {
        const raw = call("__edgeNextScripts()");
        const list: { idx: number; src: string | null; text: string; module?: boolean }[] = typeof raw === "string" ? JSON.parse(raw) : [];
        if (!list.length || remaining() <= 0) return;
        for (const s of list) {
          let code = s.text;
          let name = "inline";
          if (s.src) {
            name = new URL(s.src, baseUrl).href;
            try {
              code = await (await fetch(name, { signal: AbortSignal.timeout(Math.max(1, remaining())) })).text();
            } catch {
              call(`__edgeScriptEvent(${s.idx}, false)`);
              continue;
            }
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
    const wait = async (ms: number, waitFor?: string) => {
      if (waitFor) {
        while (remaining() > 0 && !call(`__edgeHas(${JSON.stringify(waitFor)})`)) await tick();
        return;
      }
      const until = Date.now() + Math.min(ms, remaining());
      while (Date.now() < until || (inflight.size > 0 && remaining() > 0)) {
        if (remaining() <= 0) break;
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

    return {
      baseUrl,
      eval(code: string) {
        const next = queue.then(() => evaluate(code));
        queue = next.catch(() => undefined);
        return next;
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
  } catch (error) {
    close();
    throw error;
  }
}

/**
 * Run a page's scripts in QuickJS and return the resulting HTML.
 * Give `url` to fetch the page, or `html` (with an optional `baseUrl`) for markup you already have.
 */
export async function runPageScriptsQuickJS(
  source: { url?: string; html?: string; baseUrl?: string },
  option: true | JavaScriptOptions,
  viewportWidth = 800,
  engine: EdgeJavaScriptEngine = {},
): Promise<ScriptedPage> {
  const dom = await createDOM(source, { ...(option === true ? {} : option), width: viewportWidth, quickjsWasm: engine.quickjsWasm });
  try {
    return { html: dom.serialize(), baseUrl: dom.baseUrl };
  } finally {
    dom.close();
  }
}
