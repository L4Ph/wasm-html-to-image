/**
 * A small JSDOM for runtimes without Node: a page's scripts run in QuickJS (compiled to WebAssembly) on a DOM written in C.
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
import defaultQuickJSWasm from "#quickjs-wasm";
import { createGuard } from "./limits.js";
import { decodeHtml } from "./decode.js";
import { openPage, DEFAULT_TIMEOUT, sleep } from "./page.js";
import type {
  CreateDOMOptions,
  EdgeJavaScriptEngine,
  PageLogEntry,
  QuickJSDOM,
  ScriptedPage,
} from "./types.js";

export type {
  PageLogEntry,
  JavaScriptOptions,
  ScriptedPage,
  CreateDOMOptions,
  QuickJSDOM,
  ImageResourceRecord,
  OpenedPage,
  EdgeJavaScriptEngine,
} from "./types.js";

export { openPage } from "./page.js";
export type { Bridge, BridgeOptions, DOMWindow } from "./bridge.js";
export { CookieJar, type Cookie, type CookieJarLike } from "./cookies.js";
export { isPrivateHost, type FetchLimits } from "./limits.js";
export { decodeHtml, sniffCharset } from "./decode.js";

// every page runs in an instance of its own: a compiled module is all that is shared
async function loadModule(wasm: WebAssembly.Module | undefined): Promise<WebAssembly.Module> {
  const compiled = wasm ?? (await defaultQuickJSWasm());
  if (!compiled) throw new Error("The QuickJS wasm (quickjs.wasm of wasm-quickjs-dom) could not be loaded; pass a compiled module as `quickjsWasm`.");
  return compiled;
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
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const guard = createGuard(options.limits);
  let html = source.html ?? "";
  let baseUrl = source.baseUrl || "about:blank";
  const first: PageLogEntry[] = [];
  if (source.url) {
    const entry = { type: "request" as const, method: "GET", url: source.url };
    try {
      const res = await Promise.race([
        guard.fetch(source.url, {}),
        sleep(timeout).then(() => {
          throw new Error(`Timed out loading ${source.url} for the \`javascript\` option (${timeout} ms).`);
        }),
      ]);
      first.push({ ...entry, status: res.status });
      html = decodeHtml(await guard.bytes(res), res.headers?.get?.("content-type") ?? undefined);
      baseUrl = res.url || source.url;
      const hash = source.url.indexOf("#");
      if (hash !== -1 && baseUrl.indexOf("#") === -1) baseUrl += source.url.slice(hash);
    } catch (error) {
      try {
        options.onLog?.({ ...entry, error: String(error) });
      } catch {
        // a listener's failure is not the page's
      }
      throw error;
    }
  }
  const wasm = await loadModule(options.quickjsWasm);
  const page = openPage(html, baseUrl, wasm, options, first, guard);
  try {
    await page.start();
  } catch (error) {
    page.dom.close();
    throw error;
  }
  return page.dom;
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
