/**
 * What every engine of the `javascript` option shares: its options, the result of the script phase, and how the
 * result replaces the render input. No engine is imported here (jsdom, QuickJS), so the edge entry points can use
 * this without a bundler following an import to jsdom.
 */
import type { FetchLimits } from "wasm-quickjs-dom";
import type { HtmlToImageOptions } from "./core.js";

/** Options of the `javascript` render option. */
export interface JavaScriptOptions {
  /** Upper bound for the whole script phase in ms (default 10000). The page is rendered as it is when it expires. */
  timeout?: number;
  /** Extra time after the `load` event for timers and fetches to finish, in ms (default 1000). */
  settleMs?: number;
  /** CSS selector to wait for after `load`; replaces `settleMs` when given. */
  waitFor?: string;
  /**
   * What runs the scripts. `"jsdom"` (default, Node only, needs `jsdom`) or `"quickjs"`: QuickJS compiled to
   * WebAssembly on a linkedom DOM, which also works where `eval` is not allowed (Cloudflare Workers; see
   * `wasm-html-to-image/javascript`). It is a smaller DOM than jsdom's and an interpreter, so heavy pages are slower.
   */
  engine?: "jsdom" | "quickjs";
  /**
   * What the page's scripts may fetch (QuickJS engine): the same names as the render `limits` (`allowedHosts`, ...) plus
   * `blockPrivateHosts`. The render `limits` of the same call are the defaults, so `limits.allowedHosts` applies to the
   * scripts' requests too; set this to give the scripts different limits.
   */
  limits?: FetchLimits;
}

/** What the script phase produced. */
export interface ScriptedPage {
  /** The DOM after the scripts ran, serialized as HTML. */
  html: string;
  /** The document's final URL (after redirects), for resolving relative resources. */
  baseUrl: string;
}

/** Runs a page's scripts and returns the resulting HTML (the jsdom engine, or the QuickJS one). */
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
