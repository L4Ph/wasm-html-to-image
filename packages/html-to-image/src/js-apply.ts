/**
 * What the `javascript` option shares across entry points: its options, the result of the script phase, and how the
 * result replaces the render input. The engine itself (QuickJS) is imported by the entry points, so this module stays
 * free of the wasm bundle.
 */
import type { FetchLimits } from "wasm-quickjs-dom";
import type { HtmlToImageOptions } from "./core.js";

/**
 * Image fetching policy of the script phase: the DOM never fetches image bytes.
 *
 * A page's `<img>` takes `complete`, natural size, load/error events and `decode()` from the renderer's
 * resource manager (`QuickJSDOM.setImageResource`), so the render that follows is the one request per
 * URL. Preloading images here would fetch them a second time in the render, and would spend the script
 * timeout on bytes the render fetches anyway, so none is done.
 *
 * The timing therefore reaches the page only while a render runs with the DOM still open
 * (`measureLayout()` does this). `applyScripted` serializes the page and closes the DOM, so an
 * `img.decode()` awaited by a script cannot observe the renderer's fetch; the records start at the render.
 *
 * `<link rel=stylesheet>` is the one resource the script phase does fetch (so `getComputedStyle` sees the
 * cascade while the scripts run); the render fetches that sheet again. Images get no such pre-pass: one
 * fetch in the render is the whole policy.
 */

/** Options of the `javascript` render option. */
export interface JavaScriptOptions {
  /** Upper bound for the whole script phase in ms (default 10000). The page is rendered as it is when it expires. */
  timeout?: number;
  /** Extra time after the `load` event for timers and fetches to finish, in ms (default 1000). */
  settleMs?: number;
  /** CSS selector to wait for after `load`; replaces `settleMs` when given. */
  waitFor?: string;
  /**
   * Script engine: always `"quickjs"` (QuickJS compiled to WebAssembly on a native C DOM, which works where `eval` is
   * not allowed). The key only remains for one release: `"jsdom"` is rejected at runtime.
   */
  engine?: "quickjs";
  /**
   * What the page's scripts may fetch (QuickJS engine): the same names as the render `limits` (`allowedHosts`, ...) plus
   * `blockPrivateHosts`. The render `limits` of the same call are the defaults, so `limits.allowedHosts` applies to the
   * scripts' requests too; set this to give the scripts different limits.
   */
  limits?: FetchLimits;
  /**
   * QuickJS engine: return true for a URL the page should not get (analytics, ads, ...): the request fails without going
   * to the network. Most of a real site's script time goes to those, and a render rarely needs them.
   */
  skip?: (url: string) => boolean;
}

/** What the script phase produced. */
export interface ScriptedPage {
  /** The DOM after the scripts ran, serialized as HTML. */
  html: string;
  /** The document's final URL (after redirects), for resolving relative resources. */
  baseUrl: string;
}

/** Runs a page's scripts in QuickJS and returns the resulting HTML. */
export type ScriptRunner = (
  source: { url?: string; html?: string; baseUrl?: string },
  option: true | JavaScriptOptions,
  viewportWidth: number,
) => Promise<ScriptedPage>;

/**
 * Apply the `javascript` option to render options with the script runner given: HTML and URL inputs are replaced by
 * the scripted DOM. Image and binary inputs, and options without `javascript`, pass through untouched.
 */
export async function applyScripted<T extends HtmlToImageOptions>(options: T, run: ScriptRunner): Promise<T> {
  const { javascript, ...rest } = options;
  if (!javascript) return options;
  const base = javascript === true ? {} : javascript;
  // One-release guard: the option used to choose a Node jsdom engine. JS callers can still send the old value even
  // though the type no longer allows it, so fail loudly instead of silently running QuickJS.
  const requestedEngine = (base as { engine?: string }).engine;
  if (requestedEngine !== undefined && requestedEngine !== "quickjs") {
    throw new Error(
      `wasm-html-to-image: \`javascript.engine: "${requestedEngine}"\` is no longer supported; scripts always run in QuickJS.`,
    );
  }
  const l = options.limits;
  const fromRender: FetchLimits | undefined = l && {
    allowedProtocols: l.allowedProtocols,
    allowedHosts: l.allowedHosts,
    blockedHosts: l.blockedHosts,
    maxResourceCount: l.maxResourceCount,
    maxResourceBytes: l.maxResourceBytes,
    maxTotalResourceBytes: l.maxTotalResourceBytes,
  };
  const config: JavaScriptOptions = fromRender || base.limits ? { ...base, limits: { ...fromRender, ...base.limits } } : base;
  const width = options.width || 800;
  if (options.url) {
    const page = await run({ url: options.url }, config, width);
    return { ...rest, url: undefined, value: page.html, baseUrl: options.baseUrl ?? page.baseUrl } as unknown as T;
  }
  if (typeof options.value === "string" && !options.value.startsWith("data:image/")) {
    const page = await run({ html: options.value, baseUrl: options.baseUrl }, config, width);
    return { ...rest, value: page.html, baseUrl: options.baseUrl ?? page.baseUrl } as unknown as T;
  }
  return rest as unknown as T;
}
