/**
 * The `javascript` option without Node: a page's scripts run in QuickJS (compiled to WebAssembly) on a linkedom DOM.
 *
 * Runs wherever WebAssembly does, `eval` or not, so it also works on Cloudflare Workers and Vercel Edge. The guest
 * program (`dist/edge-js-payload.js`, built by `scripts/build-edge-js.mjs`) holds the DOM and the browser globals a
 * bare QuickJS lacks; this host fetches scripts, keeps time for the timers and serializes the DOM at the end.
 *
 * It is a smaller DOM than jsdom's and an interpreter: no layout (like jsdom), no canvas, `type="module"` scripts are
 * not run, and heavy pages are slower. Like the jsdom engine it is for trusted pages: the page's scripts can `fetch`.
 *
 * ```ts
 * import quickjsWasm from "wasm-html-to-image/quickjs.wasm"; // Workers: a pre-compiled module
 * import { applyJavaScript } from "wasm-html-to-image/javascript";
 * import { render } from "wasm-html-to-image/workerd";
 * const opts = await applyJavaScript({ url: "https://example.com/", javascript: true, format: "png" }, { quickjsWasm });
 * const png = await render(opts);
 * ```
 */
// @ts-expect-error — dist/edge-js-payload.js is generated at build time
import { guestSource } from "../dist/edge-js-payload.js";
import type { HtmlToImageOptions } from "./core.js";
import { applyScripted, type JavaScriptOptions, type ScriptedPage } from "./js-apply.js";

export type { JavaScriptOptions, ScriptedPage } from "./js-apply.js";

/** Where the QuickJS engine comes from. */
export interface EdgeJavaScriptEngine {
  /**
   * The compiled QuickJS module: `import wasm from "wasm-html-to-image/quickjs.wasm"` on Cloudflare Workers, where
   * WebAssembly cannot be compiled at run time. Omit it on Node, Deno, Bun and in browsers: the package loads its own copy.
   */
  quickjsWasm?: WebAssembly.Module;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_SETTLE_MS = 1000;
const MEMORY_LIMIT = 256 * 1024 * 1024;
const MAX_MODULES = 300;
// QuickJS recurses on the host's own stack, which is about 1 MB on V8: its limit must stop a runaway script first
const STACK_LIMIT = 192 * 1024;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let libraries: Promise<{ core: any; variant: any }> | undefined;
function loadLibraries() {
  libraries ??= (async () => {
    try {
      return {
        core: await import("quickjs-emscripten-core"),
        variant: (await import("@jitl/quickjs-wasmfile-release-sync")).default,
      };
    } catch (cause) {
      libraries = undefined;
      throw new Error(
        "The QuickJS engine of the `javascript` option needs the optional dependencies `quickjs-emscripten-core` and `@jitl/quickjs-wasmfile-release-sync`. Install them with `npm i quickjs-emscripten-core @jitl/quickjs-wasmfile-release-sync`.",
        { cause },
      );
    }
  })();
  return libraries;
}

// The package's own quickjs.wasm, compiled once, so each run only has to instantiate it (undefined when it cannot be
// read here, e.g. in a bundle: the library then loads its own copy every time).
let defaultWasm: Promise<WebAssembly.Module | undefined> | undefined;
function compileDefaultWasm() {
  defaultWasm ??= (async () => {
    try {
      const url = new URL("./quickjs.wasm", import.meta.url);
      let bytes: ArrayBuffer | Uint8Array;
      if (url.protocol === "file:" && (globalThis as any).process?.versions?.node) {
        const fs = "node:fs/promises", node = "node:url"; // not literals: edge bundlers must not try to resolve them
        bytes = await (await import(/* @vite-ignore */ fs)).readFile((await import(/* @vite-ignore */ node)).fileURLToPath(url));
      } else {
        bytes = await (await fetch(url)).arrayBuffer();
      }
      return await WebAssembly.compile(bytes as BufferSource);
    } catch {
      return undefined;
    }
  })();
  return defaultWasm;
}

// one QuickJS module (a WebAssembly instance) per compiled wasm; every run makes its own runtime in it
const quickjsModules = new WeakMap<object, Promise<any>>();
const defaultSlot = {};
function loadQuickJS(wasm: WebAssembly.Module | undefined): Promise<any> {
  const slot = wasm ?? defaultSlot;
  let loaded = quickjsModules.get(slot);
  if (!loaded) {
    loaded = (async () => {
      const { core, variant } = await loadLibraries();
      const compiled = wasm ?? (await compileDefaultWasm());
      return core.newQuickJSWASMModuleFromVariant(compiled ? core.newVariant(variant, { wasmModule: compiled }) : variant);
    })();
    loaded.catch(() => quickjsModules.delete(slot));
    quickjsModules.set(slot, loaded);
  }
  return loaded;
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
  const opts: JavaScriptOptions = option === true ? {} : option;
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const started = Date.now();
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

  const QuickJS = await loadQuickJS(engine.quickjsWasm);
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT);
  runtime.setMaxStackSize(STACK_LIMIT);
  const deadline = started + timeout;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();

  let closed = false;
  const timers: { id: number; at: number }[] = [];
  const inflight = new Set<Promise<void>>();
  // the promises handed to the page for its fetches
  const deferreds = new Set<{ dispose(): void }>();

  const pump = () => {
    if (!closed) runtime.executePendingJobs();
  };
  // evaluate code; false when it threw (a page's script error never stops the render)
  const run = (code: string, name: string, module = false): boolean => {
    if (closed) return false;
    const result = vm.evalCode(code, name, module ? { type: "module" } : undefined);
    if (result.error) {
      result.error.dispose();
      pump();
      return false;
    }
    result.value.dispose();
    pump();
    return true;
  };
  const call = (expression: string): unknown => {
    if (closed) return undefined;
    const result = vm.evalCode(expression, "call.js");
    if (result.error) {
      result.error.dispose();
      return undefined;
    }
    const value = vm.dump(result.value);
    result.value.dispose();
    pump();
    return value;
  };

  try {
    const host = vm.newObject();
    const define = (name: string, impl: (...args: any[]) => any) => {
      const fn = vm.newFunction(name, impl);
      vm.setProp(host, name, fn);
      fn.dispose();
    };
    const debug = typeof process !== "undefined" && !!process.env?.WASM_HTML_TO_IMAGE_DEBUG;
    define("log", (level: any, message: any) => {
      if (debug) console.error("[page " + vm.getString(level) + "]", vm.getString(message));
    });
    define("timer", (id: any, ms: any) => {
      timers.push({ id: vm.getNumber(id), at: Date.now() + vm.getNumber(ms) });
    });
    define("fetch", (target: any, method: any) => {
      const deferred = vm.newPromise();
      deferreds.add(deferred);
      const settle = (ok: boolean, text: string) => {
        if (closed || !deferreds.delete(deferred)) return;
        const handle = vm.newString(text);
        (ok ? deferred.resolve : deferred.reject)(handle);
        handle.dispose();
        pump();
        deferred.dispose();
      };
      const task: Promise<void> = fetch(new URL(vm.getString(target), baseUrl), { method: vm.getString(method) })
        .then(async (r) => ({ status: r.status, url: r.url, headers: Object.fromEntries(r.headers), body: await r.text() }))
        .then(
          (o) => settle(true, JSON.stringify(o)),
          (e) => settle(false, String(e)),
        )
        .finally(() => {
          inflight.delete(task);
          pump();
        });
      inflight.add(task);
      return deferred.handle;
    });
    vm.setProp(vm.global, "__host", host);
    host.dispose();

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
    runtime.setModuleLoader(
      (name: string) => {
        const m = modules.get(name);
        return m === undefined ? { error: new Error(`could not load module ${name}`) } : m instanceof Error ? { error: m } : m;
      },
      (base: string, name: string) => resolveModule(base, name),
    );
    const prefetchModules = async (code: string, name: string): Promise<void> => {
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
    };

    run(guestSource as string, "edge-js-guest.js");
    const boot = vm.evalCode(`__edgeBoot(${JSON.stringify(html)}, ${JSON.stringify(baseUrl)}, ${Math.round(viewportWidth)})`, "boot.js");
    if (boot.error) {
      const detail = JSON.stringify(vm.dump(boot.error));
      boot.error.dispose();
      throw new Error(`The QuickJS engine could not build the page: ${detail}`);
    }
    boot.value.dispose();

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
            await prefetchModules(code, name);
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

    await runScripts();
    call("__edgeDocumentEvents()");
    if (opts.waitFor) {
      while (remaining() > 0 && !call(`__edgeHas(${JSON.stringify(opts.waitFor)})`)) await tick();
    } else {
      const until = Date.now() + Math.min(opts.settleMs ?? DEFAULT_SETTLE_MS, remaining());
      while (Date.now() < until || (inflight.size > 0 && remaining() > 0)) {
        if (remaining() <= 0) break;
        await tick();
      }
    }
    const out = call("__edgeSerialize()");
    if (typeof out !== "string") throw new Error("The QuickJS engine could not serialize the page.");
    return { html: out, baseUrl };
  } finally {
    // a fetch still in flight finds `closed` and does nothing; the promises handed to the page are disposed here, or
    // QuickJS aborts when its runtime is freed
    closed = true;
    for (const d of deferreds) d.dispose();
    deferreds.clear();
    vm.dispose();
    runtime.dispose();
  }
}

/**
 * Apply the `javascript` option with the QuickJS engine: HTML and URL inputs are replaced by the scripted DOM.
 * Image and binary inputs, and options without `javascript`, pass through untouched.
 */
export function applyJavaScript<T extends HtmlToImageOptions>(options: T, engine: EdgeJavaScriptEngine = {}): Promise<T> {
  return applyScripted(options, (source, option, width) => runPageScriptsQuickJS(source, option, width, engine));
}
