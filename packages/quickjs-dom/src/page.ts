// @ts-expect-error — dist/edge-js-payload.js is generated at build time
import { guestBytecode } from "../dist/edge-js-payload.js";
import { createGuard } from "./limits.js";
import { Bridge, type BridgeOptions } from "./bridge.js";
import { QuickJSInstance } from "./runtime.js";
import { ModuleLoader } from "./module-loader.js";
import { normalizeTimeout } from "./timeout.js";
import type {
  CreateDOMOptions,
  OpenedPage,
  PageLogEntry,
  QuickJSDOM,
  PageInput,
} from "./types.js";

export { DEFAULT_TIMEOUT } from "./timeout.js";
export const DEFAULT_SETTLE_MS = 1000;
export const MEMORY_LIMIT = 256 * 1024 * 1024;
export const MAX_MODULES = 1000;
export const MAX_LOGS = 1000;

// a fetched body crosses into the page as base64, so binary data survives
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// QuickJS recurses on the wasm's own stack, so its limit must stop a runaway script before that stack runs out (the host
// has one too: about 1 MB on V8). quickjs.wasm is linked with a 1 MB stack (scripts/build-quickjs.mjs checks it and
// records the size), leaving this much plus headroom for the frames the host calls back through.
export const STACK_LIMIT = 192 * 1024;

/** Bytes of stack `wasm` was linked with, from the custom section scripts/build-quickjs.mjs records. */
function wasmStackBytes(wasm: WebAssembly.Module): number | undefined {
  const [section] = WebAssembly.Module.customSections(wasm, "quickjs-stack");
  if (!section || section.byteLength < 4) return undefined;
  const bytes = new DataView(section).getUint32(0, true);
  return bytes > 0 ? bytes : undefined;
}

const clampWarned = new WeakSet<WebAssembly.Module>();
// Never let QuickJS's limit sit above the real stack: when it does, QuickJS's overflow check cannot fire before the wasm
// stack is gone. A module without the record (an older build) keeps the default; a smaller stack is clamped to half.
function stackLimitFor(wasm: WebAssembly.Module): number {
  const bytes = wasmStackBytes(wasm);
  if (bytes === undefined || STACK_LIMIT <= bytes / 2) return STACK_LIMIT;
  const limit = Math.min(STACK_LIMIT, Math.floor(bytes / 2));
  if (!clampWarned.has(wasm)) {
    clampWarned.add(wasm);
    console.warn(`quickjs.wasm has only ${bytes} bytes of stack; limiting scripts to ${limit} (rebuild it with scripts/build-quickjs.mjs)`);
  }
  return limit;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// four random words for the page's Math.random (the guest is copied from one start, so it must not keep its own)
export function randomSeed(): number[] {
  const words = new Uint32Array(4);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(words);
  else for (let i = 0; i < 4; i++) words[i] = (Math.random() * 4294967296) >>> 0;
  return Array.from(words);
}

// the guest program as QuickJS bytecode (made at build time by scripts/build-edge-js.mjs with this very QuickJS)
let guestBytes: Uint8Array | undefined;
export const guest = (): Uint8Array => (guestBytes ??= Uint8Array.from(atob(guestBytecode as string), (c) => c.charCodeAt(0)));

/**
 * Open a page from markup you have, synchronously: the DOM is built and the bridge works at once. The scripts have not
 * run until {@link OpenedPage.start} (which the caller may await or let run behind). `createDOM` is this, awaited.
 */
export function openPage(
  html: string,
  baseUrl: string,
  wasm: WebAssembly.Module,
  opts: CreateDOMOptions = {},
  first: PageLogEntry[] = [],
  sharedGuard?: ReturnType<typeof createGuard>,
): OpenedPage {
  const options = opts;
  const viewportWidth = options.width ?? 800;
  // 0 and Infinity both mean "no limit" (Infinity here); the default 10 s is kept when none is given
  const timeout = normalizeTimeout(opts.timeout);
  let started = Date.now();
  // QuickJS reads a deadline of 0 as "no limit", which is how it must hear "Infinity"
  const deadlineOf = () => (timeout === Infinity ? 0 : started + timeout);
  let vmDeadline: ((ms: number) => void) | undefined;
  // every call into the page gets a fresh `timeout`
  const begin = () => {
    started = Date.now();
    vmDeadline?.(deadlineOf());
  };
  const guard = sharedGuard ?? createGuard(opts.limits);
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
  for (const entry of first) log(entry);
  const loggedFetch = async (input: string | URL, init: RequestInit = {}, isPage = false): Promise<Response> => {
    const entry = { type: "request" as const, method: init.method ?? "GET", url: String(input) };
    try {
      if (!isPage && opts.skip?.(entry.url)) throw new Error(`Skipped by the skip option: ${entry.url}`);
      // a page with a jar sends its cookies and keeps the ones it is given, as a browser does
      const jar = options.cookieJar;
      let sent = init;
      if (jar) {
        const headers = new Headers(init.headers);
        if (!headers.has("cookie")) {
          const cookies = jar.getCookieStringSync(entry.url);
          if (cookies) headers.set("cookie", cookies);
        }
        sent = { ...init, headers };
      }
      const res = await guard.fetch(input, sent);
      if (jar) for (const sc of res.headers.getSetCookie?.() ?? []) jar.setCookieSync(sc, res.url || entry.url);
      log({ ...entry, status: res.status });
      return res;
    } catch (error) {
      log({ ...entry, error: String(error) });
      throw error;
    }
  };
  // a body refused by the byte limits is not silent: loggedFetch has already reported the request (with its status),
  // so the refusal itself becomes an error entry, carrying the URL, the size and the limit from limits.ts
  const bodyBytes = async (res: Response): Promise<Uint8Array> => {
    try {
      return await guard.bytes(res);
    } catch (error) {
      log({ type: "error", message: String(error), source: res.url || "fetch" });
      throw error;
    }
  };
  const text = async (res: Response) => new TextDecoder().decode(await bodyBytes(res));
  const remaining = () => (timeout === Infinity ? Infinity : Math.max(0, timeout - (Date.now() - started)));
  // AbortSignal.timeout refuses Infinity (and the largest finite values) with a RangeError: an unlimited call has no
  // abort signal at all, and one bounded beyond what a signal can take keeps its deadline in QuickJS.
  const ABORT_MAX = 2 ** 31 - 1;
  const abortSignal = (): AbortSignal | undefined => {
    if (timeout === Infinity) return undefined;
    const ms = remaining();
    return ms > ABORT_MAX ? undefined : AbortSignal.timeout(Math.max(1, ms));
  };

  let closed = false;
  const timers: { id: number; at: number }[] = [];
  const exposed = new Map<string, (...args: any[]) => unknown>();
  const inflight = new Set<Promise<void>>();
  const debug = typeof process !== "undefined" && !!process.env?.WASM_HTML_TO_IMAGE_DEBUG;

  const loader = new ModuleLoader(baseUrl);

  // the objects of the page, for the host's own code (see dom.bridge())
  let bridge: Bridge | undefined;
  let bridgeActivity = () => {};

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
      fetch(id, target, packed) {
        // a plain method, or {m, h, b}: method, headers, body
        let method = packed;
        let init: { headers?: Record<string, string>; body?: string } = {};
        if (packed.startsWith("{")) {
          const p = JSON.parse(packed) as { m: string; h: Record<string, string>; b: string | null };
          method = p.m;
          init = { headers: p.h, ...(p.b !== null ? { body: p.b } : {}) };
        }
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
          loggedFetch(new URL(target, baseUrl), { method, ...init })
            .then(async (r) => ({ status: r.status, url: r.url, headers: Object.fromEntries(r.headers), body: toBase64(await bodyBytes(r)) }))
            .then(
              (o) => settle(true, JSON.stringify(o)),
              (e) => settle(false, String(e)),
            ),
        );
      },
      module(kind, base, name) {
        if (kind === 2) return bridge?.callback(Number(base), name);
        if (kind === 0) return loader.resolve(base, name);
        const m = loader.modules.get(base);
        if (typeof m === "string") return m;
        loader.askLazy(base);
        return undefined;
      },
    },
    MEMORY_LIMIT,
    stackLimitFor(wasm),
    // the guest program is started once per module and copied from then on (see QuickJSInstance.create)
    (instance) => {
      const loaded = instance.evalBytecode(guest());
      if (loaded.type === "error") throw new Error(`The QuickJS engine could not load its guest program: ${loaded.value}`);
    },
  );
  vm.setDeadline(deadlineOf());
  vmDeadline = (ms) => vm.setDeadline(ms);
  pump = () => {
    if (!closed) vm.jobs();
  };
  // evaluate code; false when it threw (a page's script error never stops the render)
  const run = (code: string, name: string, module = false): boolean => {
    if (closed) return false;
    bridge?.invalidate();
    const result = vm.eval(code, name, module);
    if (result.type === "error") log({ type: "error", message: result.value, source: name });
    pump();
    return result.type !== "error";
  };
  // the error of the most recent call(), kept for its caller: serialize() explains why the page could not be serialized
  let callFailure: string | undefined;
  const call = (expression: string): unknown => {
    if (closed) return undefined;
    bridge?.invalidate();
    callFailure = undefined;
    const result = vm.eval(expression, "call.js");
    if (result.type === "error") {
      callFailure = result.value;
      // a task cut off by the time limit is worth showing: its stack says where the page (or this engine) spent the time
      if (/interrupted/.test(result.value)) log({ type: "error", message: result.value, source: "task" });
      return undefined;
    }
    pump();
    return result.type === "undefined" ? undefined : result.type === "json" ? JSON.parse(result.value) : result.value;
  };

  // the instance owns everything it allocated: letting go of it frees the runtime. A fetch still in flight finds
  // `closed` and does nothing.
  const close = () => {
    closed = true;
    bridge?.dispose();
  };

  try {
    // QuickJS gives `import.meta` no `url`, so the module's own URL is written into its source
    // `dynamicOnly`: a classic script, whose import("./x.js") calls are prefetched but which is not a module itself
    const prefetchModules = async (source: string, name: string, dynamicOnly = false): Promise<string> => {
      const code = dynamicOnly ? source : source.replace(/\bimport\.meta\.url\b/g, JSON.stringify(name));
      if (!dynamicOnly) loader.modules.set(name, code);
      const pending: string[] = [];
      const imports = dynamicOnly ? /\bimport\s*\(\s*(["'`])((?:\.{0,2}\/|https?:)[^"'`$\s]*)\1/g : /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'`])([^"'`$\s]+)\1/g;
      for (const m of code.matchAll(imports)) {
        if (/[,;(){}<>=]/.test(m[2])) continue; // a string of the code that only looks like a specifier
        const target = loader.resolve(name, m[2]);
        if (/^https?:/.test(target) && !target.endsWith("/") && !loader.modules.has(target) && loader.modules.size < MAX_MODULES) {
          loader.modules.set(target, new Error(`could not load module ${target}`));
          pending.push(target);
        }
      }
      await Promise.all(
        pending.map(async (target) => {
          try {
            const res = await loggedFetch(target, { signal: abortSignal() });
            if (!res.ok) return;
            await prefetchModules(await text(res), target);
          } catch {
            // left as the load error set above
          }
        }),
      );
      return code;
    };

    const boot = vm.eval(`__edgeBoot(${JSON.stringify(html)}, ${JSON.stringify(baseUrl)}, ${Math.round(viewportWidth)}, ${JSON.stringify(randomSeed())}, ${options.visual !== false}, ${options.height ? Math.round(options.height) : 0})`, "boot.js");
    if (boot.type === "error") throw new Error(`The QuickJS engine could not build the page: ${boot.value}`);
    // with a jar of the host's, the page's document.cookie goes through it (boot.js looks the
    // hooks up on the global at each access, so installing them now, before any script, is enough)
    if (options.cookieJar) {
      const jar = options.cookieJar;
      bridge ??= new Bridge(vm, { timeout, onCall: () => bridgeActivity() });
      // the hooks ride on the engine's own __host object: no new name appears on the window
      (bridge.window as any).__host.cookieJar = {
        get: (url: string) => jar.getCookieStringSync(url, { httpOnly: false }),
        set: (cookie: string, url: string) => {
          jar.setCookieSync(cookie, url, { script: true });
        },
      };
    }
    [opts.beforeScripts ?? []].flat().forEach((code, i) => run(code, `before-scripts-${i + 1}.js`));

    // scripts in document order, the ones that scripts add included; each external one is fetched by the host
    const mode = { scripts: true, external: true };
    const runScripts = async () => {
      for (;;) {
        const raw = call("__edgeNextScripts()");
        const list: { idx: number; src: string | null; text: string; module?: boolean; importmap?: boolean }[] = typeof raw === "string" ? JSON.parse(raw) : [];
        if (!list.length || remaining() <= 0 || !mode.scripts) return;
        // module scripts are deferred: they run after the classic scripts of the document (each group in order)
        list.sort((a, b) => (a.module ? 1 : 0) - (b.module ? 1 : 0) || a.idx - b.idx);
        // the external ones are all requested at once; they still run one by one, in document order
        const sources = list.map((s) => {
          if (!s.src || !mode.external) return undefined;
          const name = new URL(s.src, baseUrl).href;
          return loggedFetch(name, { signal: abortSignal() })
            .then(text)
            .then(
              (code) => ({ name, code }),
              () => undefined,
            );
        });
        for (const [i, s] of list.entries()) {
          if (s.importmap) {
            loader.addImportMap(s.text);
            continue;
          }
          let code = s.text;
          let name = "inline";
          if (s.src && !mode.external) continue;
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
          if (!s.module && code.includes("import(")) await prefetchModules(code, s.src ? name : baseUrl, true);
          const ok = run(code, name, s.module);
          call("__edgeSetCurrent(-1)");
          if (s.src) call(`__edgeScriptEvent(${s.idx}, ${ok})`);
        }
      }
    };
    // timers that are due, scripts that were added, then a short sleep
    // the modules the page asked for and did not get: fetched now, for the retry it makes (see lazyModules)
    const loadLazyModules = async () => {
      const wanted = loader.lazyModules.splice(0).filter((u) => typeof loader.modules.get(u) !== "string");
      await Promise.all(
        wanted.map(async (target) => {
          try {
            const res = await loggedFetch(target, { signal: abortSignal() });
            if (res.ok) await prefetchModules(await text(res), target);
          } catch {
            // the page's retry fails the same way
          }
        }),
      );
    };
    const step = async (fresh = false) => {
      if (fresh) begin(); // a page that lives on gets a fresh budget each time
      pump();
      const now = Date.now();
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
      for (const t of due) {
        timers.splice(timers.indexOf(t), 1);
        call(`__fire(${t.id})`);
      }
      if (loader.lazyModules.length) await loadLazyModules();
      await runScripts();
    };
    const tick = async () => {
      await step();
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
    // a rough size of the page, for the error a failed serialize() throws: a page that cannot answer leaves it out
    const elementCount = (): number | undefined => {
      if (closed) return undefined;
      try {
        bridge?.invalidate();
        const result = vm.eval("document.querySelectorAll('*').length", "serialize-count.js");
        if (result.type !== "json" && result.type !== "string") return undefined;
        const n = Number(result.type === "json" ? JSON.parse(result.value) : result.value);
        return Number.isFinite(n) ? n : undefined;
      } catch {
        return undefined;
      }
    };
    const serialize = () => {
      if (closed) throw new Error("The DOM is closed.");
      begin();
      const out = call("__edgeSerialize()");
      if (typeof out === "string") return out;
      const failure = callFailure;
      if (failure === undefined) throw new Error("The QuickJS engine could not serialize the page.");
      // an interrupted task was already logged by call() as a task error, so it is not reported twice
      const interrupted = /interrupted/.test(failure);
      const count = interrupted ? undefined : elementCount();
      const message = `The QuickJS engine could not serialize the page: ${failure}${count === undefined ? "" : ` (about ${count} elements)`}`;
      if (!interrupted) log({ type: "error", message, source: "serialize" });
      throw new Error(message);
    };

    // <link rel=stylesheet> sheets, fetched by the host and handed to the page for getComputedStyle
    const loadStyleSheets = async () => {
      const raw = call("__edgeLinks()");
      const list: { i: number; href: string }[] = typeof raw === "string" ? JSON.parse(raw) : [];
      const sheets = await Promise.all(
        list.map((l) =>
          loggedFetch(new URL(l.href, baseUrl).href, { signal: abortSignal() })
            .then(text)
            .then(
              (css) => ({ i: l.i, css }),
              () => undefined,
            ),
        ),
      );
      for (const s of sheets) if (s) call(`__edgeSetSheet(${s.i}, ${JSON.stringify(s.css)})`);
    };

    const start = async (how: { scripts?: boolean; external?: boolean; settle?: boolean } = {}) => {
      mode.scripts = how.scripts ?? true;
      mode.external = how.external ?? true;
      begin();
      const scripts = runScripts(); // the inline scripts run before this returns; only the ones that fetch wait
      await scripts;
      if (opts.stylesheets !== false) await loadStyleSheets();
      call("__edgeDocumentEvents()");
      if (how.settle ?? true) await wait(opts.settleMs ?? DEFAULT_SETTLE_MS, opts.waitFor);
    };
    const nextWake = () => {
      if (closed) return -1;
      if (timers.length) return Math.max(0, Math.min(...timers.map((t) => t.at)) - Date.now());
      return inflight.size ? 5 : -1;
    };

    // eval(): the result lands in a global once the page's promise settles; the host ticks until it is there
    let queue: Promise<unknown> = Promise.resolve();
    const evaluate = async (code: string): Promise<unknown> => {
      if (closed) throw new Error("The DOM is closed.");
      begin();
      call("globalThis.__edgeResult = undefined");
      run(
        `__nativePromise.resolve().then(() => (0, eval)(${JSON.stringify(code)}))` +
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
      setImageResource(url, record) {
        if (closed) throw new Error("The DOM is closed.");
        begin();
        // The renderer owns the fetch of every image URL: it publishes that one transition here, and
        // boot.js/05-html.js turn it into complete/naturalWidth, the load|error event and decode().
        // Nothing in the page fetches the image, so the renderer's fetch is the only one.
        const value = record === null ? "null" : JSON.stringify({ status: record.status, width: record.width, height: record.height });
        if (!run(`__edgeImageResource(${JSON.stringify(url)}, ${value})`, "image-resource.js")) {
          throw new Error("The QuickJS engine could not publish the image resource.");
        }
      },
      bridge(options?: BridgeOptions) {
        if (closed) throw new Error("The DOM is closed.");
        return (bridge ??= new Bridge(vm, { timeout, onCall: () => bridgeActivity(), ...options }));
      },
      toOptions<T extends PageInput>(options: T): T {
        const { javascript: _javascript, ...rest } = options;
        return { ...rest, url: undefined, value: serialize(), baseUrl: options.baseUrl ?? baseUrl } as unknown as T;
      },
      close,
    };
    const opened: OpenedPage = { dom, start, step, nextWake };
    bridgeActivity = () => opened.onActivity?.();
    return opened;
  } catch (error) {
    close();
    throw error;
  }
}
