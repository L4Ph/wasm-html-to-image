import { render } from "wasm-html-to-image/workerd";
import { applyJavaScript } from "wasm-html-to-image/javascript";

/**
 * Screenshot a web page, scripts included:
 *
 *   GET /?url=https://example.com&width=1280&format=png
 *
 * The page's scripts run in QuickJS (WebAssembly) on a DOM written in C, because a Worker cannot `eval`.
 * Set ALLOW_PRIVATE_HOSTS=1 (a `.dev.vars` entry, for local tests only) to let it reach localhost and private addresses.
 * That is not a browser: there is no layout, no canvas, and heavy pages are slow. Static HTML renders as is.
 */

const FORMATS = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;
type Format = keyof typeof FORMATS;

const MAX_SETTLE_MS = 5_000;
const MAX_TIMEOUT_MS = 20_000;

const json = (status: number, error: string) =>
  Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );

const int = (v: string | null, fallback: number, min: number, max: number) => {
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
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
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return "Only http and https pages can be captured";
  if (allowPrivate) return u;
  const host = u.hostname.toLowerCase();
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  const privateV4 =
    ipv4 &&
    (+ipv4[1] === 10 ||
      +ipv4[1] === 127 ||
      +ipv4[1] === 0 ||
      (+ipv4[1] === 169 && +ipv4[2] === 254) ||
      (+ipv4[1] === 172 && +ipv4[2] >= 16 && +ipv4[2] <= 31) ||
      (+ipv4[1] === 192 && +ipv4[2] === 168));
  if (
    privateV4 ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.startsWith("[") ||
    !host.includes(".")
  ) {
    return "That host is not allowed";
  }
  return u;
}

export default {
  async fetch(
    request: Request,
    env: { ALLOW_PRIVATE_HOSTS?: string },
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD")
      return json(405, "Use GET");
    if (url.pathname !== "/") return json(404, "Not found");

    const allowPrivate = env.ALLOW_PRIVATE_HOSTS === "1";
    const target = checkTarget(url.searchParams.get("url"), allowPrivate);
    if (typeof target === "string") return json(400, target);

    const q = url.searchParams;
    const format = (q.get("format") ?? "png") as Format;
    if (!(format in FORMATS))
      return json(400, "format must be png, jpeg or webp");
    const width = int(q.get("width"), 1280, 200, 2400);
    const heightParam = q.get("height");
    const height = heightParam
      ? int(heightParam, 0, 100, 8000) || undefined
      : undefined;
    const quality = int(q.get("quality"), 85, 1, 100);
    const script = q.get("js") !== "0";
    const settleMs = int(q.get("settle"), 1000, 0, MAX_SETTLE_MS);
    const timeout = int(q.get("timeout"), 10_000, 1000, MAX_TIMEOUT_MS);
    const waitFor = q.get("wait") || undefined;

    const cache = (caches as unknown as { default: Cache }).default;
    const cacheKey = new Request(url.toString());
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    try {
      let options = {
        url: target.href,
        width,
        height,
        format,
        quality,
      } as Parameters<typeof render>[0];
      if (script) {
        options = await applyJavaScript({
          ...options,
          // the page's scripts, and what they load, get no further than the page itself may: checkTarget only
          // saw the first URL, a redirect or a script could still point inside
          javascript: {
            settleMs,
            timeout,
            waitFor,
            limits: {
              allowedProtocols: ["http:", "https:"],
              blockPrivateHosts: !allowPrivate,
              maxResourceCount: 100,
              maxResourceBytes: 5_000_000,
              maxTotalResourceBytes: 25_000_000,
            },
          },
        });
      }
      const { data } = await render(options);
      const res = new Response(data as unknown as BodyInit, {
        headers: {
          "content-type": FORMATS[format],
          "cache-control": "public, max-age=300",
        },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return json(
        /timed out/i.test(message) ? 504 : 502,
        `Could not capture the page: ${message}`,
      );
    }
  },
} satisfies ExportedHandler<{ ALLOW_PRIVATE_HOSTS?: string }>;
