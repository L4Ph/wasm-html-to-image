import { createDOM, isPrivateHost } from "wasm-quickjs-dom";

/**
 * The HTML of a page after its scripts ran:
 *
 *   GET /?url=https://example.com&wait=%23app&settle=1000
 *
 * The page's scripts run in QuickJS (WebAssembly) on a DOM written in C, because a Worker cannot `eval`. The response is
 * the DOM serialized as HTML, with a `<base href>` of the page's final URL so its relative links still resolve.
 * `?debug=1` answers JSON instead: the HTML plus what happened in the page (console, errors, requests).
 *
 * Set ALLOW_PRIVATE_HOSTS=1 (a `.dev.vars` entry, for local tests only) to let it reach localhost and private addresses.
 * That is not a browser: there is no layout, no canvas, and heavy pages are slow.
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

/** Add `<base href>` so relative URLs in the returned HTML still point at the page, unless it has one. */
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

    const allowPrivate = env.ALLOW_PRIVATE_HOSTS === "1";
    const target = checkTarget(url.searchParams.get("url"), allowPrivate);
    if (typeof target === "string") return json(400, target);

    const q = url.searchParams;
    const settleMs = int(q.get("settle"), 1000, 0, MAX_SETTLE_MS);
    const timeout = int(q.get("timeout"), 10_000, 1000, MAX_TIMEOUT_MS);
    const waitFor = q.get("wait") || undefined;
    const debug = q.get("debug") === "1";
    const addBase = q.get("base") !== "0";
    const trackers = q.get("trackers") === "1";

    const cache = (caches as unknown as { default: Cache }).default;
    const cacheKey = new Request(url.toString());
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let dom: Awaited<ReturnType<typeof createDOM>> | undefined;
    try {
      dom = await createDOM(
        { url: target.href },
        {
          settleMs,
          timeout,
          waitFor,
          // analytics, ads and the like are most of what a real page spends its time on; a render does not need them
          skip: trackers ? undefined : isTracker,
          // the page's scripts, and what they load, get no further than the page itself may: checkTarget only saw the
          // first URL, a redirect or a script could still point inside
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
      const html = addBase ? withBase(serialized, dom.baseUrl) : serialized;
      const res = debug
        ? Response.json({ url: target.href, finalUrl: dom.baseUrl, html, logs: dom.logs }, { headers: { "cache-control": "no-store" } })
        : new Response(request.method === "HEAD" ? null : html, {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "public, max-age=300",
              "x-final-url": dom.baseUrl,
            },
          });
      if (!debug) ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return json(/timed out/i.test(message) ? 504 : 502, `Could not render the page: ${message}`);
    } finally {
      dom?.close();
    }
  },
} satisfies ExportedHandler<{ ALLOW_PRIVATE_HOSTS?: string }>;
