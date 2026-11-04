import { createDOM, decodeHtml, isPrivateHost } from "wasm-quickjs-dom";
import { computeLineDiff } from "./diff.js";
import { extractText, extractTitle } from "./text.js";
import { renderHome, renderViewer } from "./viewer.js";

/**
 * Compare a web page's text and HTML between when JavaScript is disabled (initial fetch)
 * and when JavaScript is enabled (rendered in QuickJS on WebAssembly DOM).
 *
 *   GET /                                -> Top page with URL input form
 *   GET /?url=https://example.com        -> Diff Viewer UI
 *   GET /?url=https://example.com&format=json (or &debug=1)
 *   GET /?url=https://example.com&format=raw
 */

const MAX_SETTLE_MS = 5_000;
const MAX_TIMEOUT_MS = 20_000;

const json = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

const int = (v: string | null, fallback: number, min: number, max: number) => {
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** http(s) only, and nothing that names this machine or a private network. */
function checkTarget(raw: string | null, allowPrivate: boolean): URL | string {
  if (!raw) return "Give the page in ?url=";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "?url= is not a URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Only http and https pages can be fetched";
  if (!allowPrivate && (isPrivateHost(u.hostname) || !u.hostname.includes("."))) return "That host is not allowed";
  return u;
}

const TRACKER_HOSTS = [
  "google-analytics.com", "googletagmanager.com", "googlesyndication.com", "doubleclick.net", "adservice.google.com",
  "facebook.net", "hotjar.com", "clarity.ms", "segment.io", "segment.com", "mixpanel.com", "amplitude.com",
  "fullstory.com", "sentry.io", "newrelic.com", "nr-data.net", "taboola.com", "outbrain.com", "criteo.com", "criteo.net",
  "scorecardresearch.com",
];

function isTracker(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return TRACKER_HOSTS.some((t) => host === t || host.endsWith("." + t));
  } catch {
    return false;
  }
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Add `<base href>` so relative URLs in the returned raw HTML still point at the page, unless it has one. */
function withBase(html: string, href: string): string {
  if (/<base[\s>]/i.test(html)) return html;
  const base = `<base href="${escapeAttr(href)}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + base + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? html.slice(0, doctype[0].length) + base + html.slice(doctype[0].length) : base + html;
}

export default {
  async fetch(request: Request, env: { ALLOW_PRIVATE_HOSTS?: string }, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return json(405, "Use GET");
    if (url.pathname !== "/") return json(404, "Not found");

    const q = url.searchParams;
    const rawUrl = q.get("url");
    const debug = q.get("debug") === "1";
    const format = (q.get("format") || (debug ? "json" : "ui")).toLowerCase();

    // If no URL is provided, render the home page form (or return 400 for JSON API requests)
    if (!rawUrl) {
      if (format === "json") return json(400, "Give the page in ?url=");
      const homeHtml = renderHome();
      return new Response(request.method === "HEAD" ? null : homeHtml, {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    const allowPrivate = env.ALLOW_PRIVATE_HOSTS === "1";
    const target = checkTarget(rawUrl, allowPrivate);
    if (typeof target === "string") {
      if (format === "json") return json(400, target);
      return new Response(request.method === "HEAD" ? null : renderHome(target), {
        status: 400,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    const settleMs = int(q.get("settle"), 1000, 0, MAX_SETTLE_MS);
    const timeout = int(q.get("timeout"), 10_000, 1000, MAX_TIMEOUT_MS);
    const waitFor = q.get("wait") || undefined;
    const addBase = q.get("base") !== "0";
    const trackers = q.get("trackers") === "1";

    const cache = (caches as unknown as { default: Cache }).default;
    const cacheKey = new Request(url.toString());
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let dom: Awaited<ReturnType<typeof createDOM>> | undefined;
    try {
      // 1. Fetch initial HTML (JavaScript disabled state)
      const fetchSignal = AbortSignal.timeout(timeout);
      const initialRes = await fetch(target.href, {
        signal: fetchSignal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; CloudflarePrerenderDiff/1.0)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      const initialUrl = initialRes.url || target.href;
      if (!allowPrivate) {
        const parsedFinal = new URL(initialUrl);
        if (isPrivateHost(parsedFinal.hostname) || !parsedFinal.hostname.includes(".")) {
          return json(400, "Redirected to disallowed host");
        }
      }

      const initialBytes = new Uint8Array(await initialRes.arrayBuffer());
      const rawHtml = decodeHtml(initialBytes, initialRes.headers.get("content-type") ?? undefined);

      // 2. Render page in QuickJS (JavaScript enabled state)
      dom = await createDOM(
        { html: rawHtml, baseUrl: initialUrl },
        {
          settleMs,
          timeout,
          waitFor,
          skip: trackers ? undefined : isTracker,
          limits: {
            allowedProtocols: ["http:", "https:"],
            blockPrivateHosts: !allowPrivate,
            maxResourceCount: 100,
            maxResourceBytes: 5_000_000,
            maxTotalResourceBytes: 25_000_000,
          },
        },
      );

      const serialized = dom.serialize();
      const finalUrl = dom.baseUrl || initialUrl;

      // If raw format is requested, respond with rendered HTML (backward compatibility)
      if (format === "raw") {
        const html = addBase ? withBase(serialized, finalUrl) : serialized;
        const res = new Response(request.method === "HEAD" ? null : html, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
            "x-final-url": finalUrl,
          },
        });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      }

      // 3. Extract text and titles for comparison
      const noJsText = extractText(rawHtml);
      const withJsText = extractText(serialized);
      const noJsTitle = extractTitle(rawHtml);
      const withJsTitle = extractTitle(serialized);

      // 4. Compute diffs
      const textDiff = computeLineDiff(noJsText, withJsText);
      const htmlDiff = computeLineDiff(rawHtml, serialized);

      const data = {
        url: target.href,
        finalUrl,
        titles: {
          noJs: noJsTitle,
          withJs: withJsTitle,
        },
        stats: {
          text: {
            noJsChars: noJsText.length,
            withJsChars: withJsText.length,
          },
          html: {
            noJsChars: rawHtml.length,
            withJsChars: serialized.length,
          },
        },
        textDiff,
        htmlDiff,
      };

      // 5. Respond with JSON or UI Viewer
      if (format === "json") {
        return Response.json(
          {
            ...data,
            noJs: { html: rawHtml, text: noJsText },
            withJs: { html: serialized, text: withJsText },
            logs: dom.logs,
          },
          {
            headers: {
              "cache-control": "no-store",
              "x-final-url": finalUrl,
            },
          },
        );
      }

      // Default: HTML Diff Viewer UI
      const viewerHtml = renderViewer(data);
      const res = new Response(request.method === "HEAD" ? null : viewerHtml, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          "x-final-url": finalUrl,
        },
      });

      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const isTimeout = /timed out/i.test(message);
      const status = isTimeout ? 504 : 502;
      const errorMsg = `Could not render or compare the page: ${message}`;
      if (format === "json" || format === "raw") {
        return json(status, errorMsg);
      }
      return new Response(request.method === "HEAD" ? null : renderHome(errorMsg), {
        status,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    } finally {
      dom?.close();
    }
  },
} satisfies ExportedHandler<{ ALLOW_PRIVATE_HOSTS?: string }>;
