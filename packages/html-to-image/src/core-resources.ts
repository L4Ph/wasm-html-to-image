/**
 * Resource layer split from `./core.ts` (behavior unchanged).
 *
 * Owns: fetched-bytes cache, `fetchResourceBytes`, pending-resources
 * parsing, allow-list checks, and the `resolveHtmlResources` discovery loop.
 * Orchestration context types (`DiagState`, `ResolveContext`) live here so
 * both the loop and the orchestration/pipeline layer share them.
 */
import { importNode, type HtmlToImageModule } from "./loader.js";
import type { ImageResourceRecord } from "wasm-quickjs-dom";
import { dataUrlToBytes, toBytes } from "./input.js";
import {
  DIAGNOSTIC_CODES,
  LogLevel,
  errorToDiagnostic,
  type DiagnosticMessage,
  type FontDiagnostic,
  type RenderLimits,
  type ResolveResourceHook,
  type ResourceDiagnostic,
} from "./diagnostics.js";

/** Cache bounds: a long-lived server must not grow without limit. */
const CACHE_MAX_ENTRIES = 256;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Process-wide fetched-bytes cache (upstream `resourceCache` parity),
 * bounded by entry count and total bytes with least-recently-used eviction.
 */
class ResourceCache {
  private readonly map = new Map<string, Uint8Array>();
  private bytes = 0;

  get(key: string): Uint8Array | undefined {
    const hit = this.map.get(key);
    if (hit) {
      // Re-insert so Map order tracks recency (oldest first).
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: Uint8Array): void {
    if (value.length > CACHE_MAX_BYTES) return;
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.length;
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.bytes += value.length;
    for (const [k, v] of this.map) {
      if (this.map.size <= CACHE_MAX_ENTRIES && this.bytes <= CACHE_MAX_BYTES) {
        break;
      }
      this.map.delete(k);
      this.bytes -= v.length;
    }
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}

const resourceCache = new ResourceCache();

/** Drop every cached resource (e.g. after the source assets changed). */
export function clearResourceCache(): void {
  resourceCache.clear();
}

export function isNodeRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } })
    .process;
  return typeof proc?.versions?.node === "string";
}

/**
 * Whether `fetch` may send a `User-Agent` of our choosing: Node and Cloudflare Workers can; browsers
 * cannot (and Firefox preflights it, which breaks Google Fonts / jsDelivr CORS). The UA decides what
 * Google Fonts serves: a browser UA gets woff2 split by unicode-range (a few KB per page), anything
 * else (a Worker's own UA, none) gets the whole `.ttf` per weight (about 5 MB each, embedded whole
 * into a PDF).
 */
export function canSetUserAgent(): boolean {
  if (isNodeRuntime()) return true;
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent === "Cloudflare-Workers";
}

function fileUrlToFsPath(p: string): string {
  if (!p.startsWith("file://")) return p;
  let out = decodeURIComponent(p.slice("file://".length));
  if (/^\/[A-Za-z]:\//.test(out)) out = out.slice(1);
  return out;
}

/**
 * Fetch external resource bytes. `data:` URLs resolve inline in C++
 * (`request()`), so they are skipped here. Relative URLs resolve against
 * `baseUrl` (http base via fetch, fs path via node:fs on Node).
 */
export async function fetchResourceBytes(
  url: string,
  baseUrl?: string,
  userAgent?: string,
  resolveResource?: ResolveResourceHook,
  timeoutMs?: number,
  confineFiles?: boolean,
): Promise<Uint8Array | null> {
  if (url.startsWith("data:")) return null;
  const fallback = (): Promise<Uint8Array | null> =>
    fetchResourceBytesInner(url, baseUrl, userAgent, timeoutMs, confineFiles);
  if (resolveResource) {
    try {
      return await resolveResource(url, fallback);
    } catch {
      return null;
    }
  }
  return fallback();
}

/** True when `target` resolves (symlinks included) inside `root`. */
async function isInsideDir(
  fs: typeof import("node:fs/promises"),
  path: typeof import("node:path"),
  root: string,
  target: string,
): Promise<boolean> {
  try {
    const realRoot = await fs.realpath(path.resolve(root));
    const realTarget = await fs.realpath(path.resolve(target));
    const rel = path.relative(realRoot, realTarget);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/** Built-in resolution behind the `resolveResource` hook (see above). */
async function fetchResourceBytesInner(
  url: string,
  baseUrl?: string,
  userAgent?: string,
  timeoutMs?: number,
  confineFiles?: boolean,
): Promise<Uint8Array | null> {
  // Browser fetch forbids overriding User-Agent (and Firefox preflights it,
  // breaking Google Fonts/jsDelivr CORS). Spoof only where we control the UA
  // (Node, Workers) to get woff2 CSS.
  const headers =
    userAgent && canSetUserAgent() ? { "User-Agent": userAgent } : undefined;
  // Abort hung connections so one stalled server cannot outlive `timeoutMs`.
  const signal =
    timeoutMs !== undefined
      ? // Node >= 24 requires an integer delay; the remaining budget is fractional.
        AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)))
      : undefined;
  const fetchBytes = async (target: string): Promise<Uint8Array | null> => {
    // Servers may vary the body by User-Agent (e.g. woff2 vs ttf CSS).
    const cacheKey = `${userAgent ?? ""}
${target}`;
    const cached = resourceCache.get(cacheKey);
    if (cached) return cached;
    try {
      const res = await fetch(target, {
        ...(headers ? { headers } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) return null;
      const bytes = toBytes(await res.arrayBuffer());
      resourceCache.set(cacheKey, bytes);
      return bytes;
    } catch {
      return null;
    }
  };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    return fetchBytes(url);
  }
  if (baseUrl !== undefined) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(baseUrl)) {
      try {
        return await fetchBytes(new URL(url, baseUrl).href);
      } catch {
        return null;
      }
    }
    if (isNodeRuntime()) {
      try {
        const fs =
          await importNode<typeof import("node:fs/promises")>("fs/promises");
        const path = await importNode<typeof import("node:path")>("path");
        const root = fileUrlToFsPath(baseUrl);
        const joined = path.join(root, url);
        if (confineFiles && !(await isInsideDir(fs, path, root, joined))) {
          return null;
        }
        const cached = resourceCache.get(joined);
        if (cached) return cached;
        // Keep an owning copy: fs Buffers may ride a shared pool.
        const bytes = new Uint8Array(await fs.readFile(joined));
        resourceCache.set(joined, bytes);
        return bytes;
      } catch {
        return null;
      }
    }
    return null;
  }
  // Without a baseUrl there is no directory to confine reads to.
  if (isNodeRuntime() && !confineFiles) {
    try {
      const cached = resourceCache.get(url);
      if (cached) return cached;
      const fs =
        await importNode<typeof import("node:fs/promises")>("fs/promises");
      // Keep an owning copy: fs Buffers may ride a shared pool.
      const bytes = new Uint8Array(await fs.readFile(url));
      resourceCache.set(url, bytes);
      return bytes;
    } catch {
      return null;
    }
  }
  return null;
}

export interface PendingResource {
  type: "font" | "image" | "css";
  url: string;
  name: string;
}

/** Parse the `get_pending_resources` binary form (see loader.ts). */
export function parsePendingResources(
  bin: Uint8Array | null | undefined,
): PendingResource[] {
  if (!bin || bin.length < 4) return [];
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const dec = new TextDecoder();
  let off = 0;
  const readStr = (): string | null => {
    if (off + 4 > bin.byteLength) return null;
    const len = view.getUint32(off, true);
    off += 4;
    if (off + len > bin.byteLength) return null;
    const s = dec.decode(new Uint8Array(bin.buffer, bin.byteOffset + off, len));
    off += len;
    return s;
  };
  const count = view.getUint32(off, true);
  off += 4;
  const out: PendingResource[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 2 > bin.byteLength) break;
    const typeInt = view.getUint8(off);
    off += 2; // type + redraw_on_ready
    const url = readStr();
    const name = readStr();
    if (readStr() === null || url === null || name === null) break;
    out.push({
      type: typeInt === 2 ? "image" : typeInt === 3 ? "css" : "font",
      url,
      name,
    });
  }
  return out;
}

/** Monotonic-ish clock for timings (satoru parity). */
export function now(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** Mutable diagnostics collection state (internal, `diagnostics: true` only). */
export interface DiagState {
  resources: ResourceDiagnostic[];
  fonts: FontDiagnostic[];
  warnings: DiagnosticMessage[];
  errors: DiagnosticMessage[];
}

/** Resource usage counters enforced by `limits` (always tracked). */
export interface ResourceUsage {
  resourceCount: number;
  totalResourceBytes: number;
  /** Font files dropped because `maxResourceCount` was reached (across all rounds). */
  fontsSkippedByCount: number;
}

/** Resolution context threaded through HTML discovery (internal). */
export interface ResolveContext {
  mediaTypeInt: number;
  css?: string;
  fonts?: { name: string; data: Uint8Array }[];
  limits: RenderLimits;
  resolveResource?: ResolveResourceHook;
  /**
   * Publish an image's fetch state to a live page (the QuickJS registry). `loading` goes out before the
   * fetch, then `loaded` once the bytes are in the engine, or `error`. The renderer is the only fetch:
   * the page learns the result from this hook instead of requesting the image a second time.
   */
  onImageResource?: (url: string, record: ImageResourceRecord) => void;
  diag: DiagState | null;
  usage: ResourceUsage;
  t0: number;
  emitLog: (level: LogLevel, message: string) => void;
  /** Accumulate a timing (no-op unless diagnostics are enabled). */
  addTime: (name: string, ms: number) => void;
  /** Throw a timeout error when `limits.timeoutMs` is exceeded. */
  checkTimeout: () => void;
}

/**
 * Protocol/host allow-list check. Returns a block reason, or `null` when
 * allowed. Relative URLs skip the check (satoru parity).
 */
export function checkResourceAllowed(
  url: string,
  limits: RenderLimits,
): string | null {
  if (
    !limits.allowedProtocols &&
    !limits.allowedHosts &&
    !limits.blockedHosts
  ) {
    return null;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    limits.allowedProtocols &&
    !limits.allowedProtocols.includes(parsed.protocol)
  ) {
    return `Protocol ${parsed.protocol} is blocked`;
  }
  if (limits.allowedHosts && !limits.allowedHosts.includes(parsed.hostname)) {
    return `Host ${parsed.hostname} is not in allowed list`;
  }
  if (limits.blockedHosts && limits.blockedHosts.includes(parsed.hostname)) {
    return `Host ${parsed.hostname} is blocked`;
  }
  return null;
}

/** Limit-violation code for a block reason (satoru parity). */
export function limitCodeForReason(reason: string): string {
  if (reason.startsWith("Protocol "))
    return DIAGNOSTIC_CODES.LIMIT_PROTOCOL_BLOCKED;
  return DIAGNOSTIC_CODES.LIMIT_HOST_BLOCKED;
}

/**
 * Max resource fetches in flight at once. All pages of a document are discovered
 * together, so this bounds the connection burst for many-page documents.
 */
export const FETCH_CONCURRENCY = 16;

/**
 * Resolve the relative `url(...)` and `@import` references of a fetched stylesheet against
 * the stylesheet's own URL. The engine resolves them against the page, which is wrong as soon
 * as the sheet lives in another directory (`url(../fonts/a.woff)` in `/static/css/a.css`).
 * Absolute, protocol-relative, `data:`, `#` and root-relative references are left alone, and a
 * root-relative sheet URL keeps its root-relative form.
 */
export function absolutizeCssUrls(css: string, cssUrl: string): string {
  if (!css.includes("url(") && !css.includes("@import")) return css;
  const dummy = "http://css-base.invalid/";
  let base: URL;
  try {
    base = new URL(cssUrl, dummy);
  } catch {
    return css;
  }
  const keepRootRelative = cssUrl.startsWith("/");
  const absoluteCssUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cssUrl);
  const resolve = (ref: string): string => {
    const t = ref.trim();
    if (
      t === "" ||
      t.startsWith("#") ||
      t.startsWith("/") ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)
    )
      return ref;
    try {
      const u = new URL(t, base);
      if (absoluteCssUrl) return u.href;
      if (u.origin !== base.origin) return u.href;
      const path = u.pathname + u.search + u.hash;
      return keepRootRelative ? path : path.slice(1);
    } catch {
      return ref;
    }
  };
  return css
    .replace(
      /url\(\s*(['"]?)([^'")]*)\1\s*\)/g,
      (_m, q: string, ref: string) => `url(${q}${resolve(ref)}${q})`,
    )
    .replace(
      /@import\s+(['"])([^'"]+)\1/g,
      (_m, q: string, ref: string) => `@import ${q}${resolve(ref)}${q}`,
    );
}

/** Run `fn` over `items` with at most `limit` calls in flight (`fn` must not reject). */
export async function mapWithLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

/** Remaining `timeoutMs` budget for one fetch (undefined = unlimited). */
function fetchTimeoutOf(ctx: ResolveContext): number | undefined {
  return ctx.limits.timeoutMs === undefined
    ? undefined
    : ctx.limits.timeoutMs - (now() - ctx.t0);
}

/**
 * Upstream-style discovery loop: collect pending URLs on the satoru
 * instance, fetch them (file/http), and inject the bytes back, so the
 * subsequent render on the SAME instance sees cached fonts/images.
 * Missing bindings (old builds) skip the loop silently.
 */
export async function resolveHtmlResources(
  module: HtmlToImageModule,
  satoruInst: unknown,
  htmls: string | string[],
  width: number,
  height: number | undefined,
  baseUrl: string | undefined,
  fontMap: Record<string, string> | undefined,
  userAgent: string | undefined,
  fallbackFonts: (Uint8Array | ArrayBuffer | string)[] | undefined,
  ctx: ResolveContext,
): Promise<void> {
  const collect = module.satoru_collect_resources;
  const getPending = module.satoru_get_pending_resources;
  const addRes = module.satoru_add_resource;
  if (
    typeof collect !== "function" ||
    typeof getPending !== "function" ||
    typeof addRes !== "function"
  )
    return;
  // Upstream default: generic families resolve via fontMap before discovery.
  if (fontMap) {
    const setFontMap = module.satoru_set_font_map;
    if (typeof setFontMap === "function") {
      (await setFontMap(satoruInst, { ...fontMap })) as unknown;
      ctx.emitLog(LogLevel.Debug, "fontMap applied");
    }
  }
  // Upstream idiom: user-supplied fallback fonts go in before discovery.
  if (fallbackFonts && fallbackFonts.length > 0) {
    const loadFallback = module.satoru_load_fallback_font;
    if (typeof loadFallback === "function") {
      for (const entry of fallbackFonts) {
        try {
          const bytes =
            typeof entry === "string"
              ? entry.startsWith("data:")
                ? dataUrlToBytes(entry)
                : await fetchResourceBytes(
                    entry,
                    baseUrl,
                    userAgent,
                    ctx.resolveResource,
                    fetchTimeoutOf(ctx),
                    ctx.limits.confineFilesToBaseUrl,
                  )
              : entry instanceof Uint8Array
                ? entry
                : new Uint8Array(entry);
          if (!bytes || bytes.length === 0) continue;
          (await loadFallback(satoruInst, bytes)) as unknown;
          ctx.diag?.fonts.push({
            family: "(fallback)",
            status: "loaded",
            source: typeof entry === "string" ? entry : "(bytes)",
          });
        } catch {
          // Per-font failure is non-fatal; discovery proceeds regardless.
          ctx.diag?.warnings.push({
            code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
            message: "Failed to load fallback font entry",
          });
        }
      }
    }
  }
  // Named font preloads (`fonts` option), before discovery (satoru parity).
  if (ctx.fonts && ctx.fonts.length > 0) {
    const loadFont = module.satoru_load_font;
    if (typeof loadFont === "function") {
      for (const f of ctx.fonts) {
        try {
          (await loadFont(satoruInst, f.name, f.data)) as unknown;
          ctx.diag?.fonts.push({
            family: f.name,
            status: "loaded",
            source: "fonts option",
          });
        } catch (e) {
          ctx.diag?.warnings.push(
            errorToDiagnostic(
              e,
              DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
              f.name,
            ),
          );
        }
      }
    }
  }
  // Extra CSS pre-scan (`css` option), before discovery (satoru parity).
  if (ctx.css) {
    const scanCss = module.satoru_scan_css;
    if (typeof scanCss === "function") {
      try {
        (await scanCss(satoruInst, ctx.css)) as unknown;
        ctx.emitLog(LogLevel.Debug, "css pre-scanned");
      } catch (e) {
        ctx.diag?.warnings.push(
          errorToDiagnostic(
            e,
            DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
            "(css option)",
          ),
        );
      }
    }
  }
  // Collect-phase profiling (merged into timings when diagnostics on).
  const setProfile = module.satoru_set_collect_profile_enabled;
  const profileEnabled = ctx.diag !== null && typeof setProfile === "function";
  if (profileEnabled) {
    try {
      (await setProfile(satoruInst, true)) as unknown;
    } catch {
      // Non-fatal; timings simply miss the C++ breakdown.
    }
  }
  // The page and the render share one fetch per image: the renderer fetches here and publishes the
  // transition to a live QuickJS page (`onImageResource` -> `QuickJSDOM.setImageResource`), which fires
  // that page's load/error event and settles decode(). The page never fetches image bytes itself, so this
  // request is not repeated there. `imageStates` is the last state published per URL: an image the engine
  // asks for again in a later round does not fire the same event twice.
  // TODO(size): the decoded width/height are not available from the engine yet (no binding exposes them),
  // so a loaded record leaves naturalWidth/naturalHeight at 0. Add them here once the engine reports them;
  // the timing (this hook) is what the bridge shares today.
  const imageStates = new Map<string, ImageResourceRecord["status"]>();
  const publishImage = (url: string, status: ImageResourceRecord["status"]): void => {
    const publish = ctx.onImageResource;
    if (!publish || imageStates.get(url) === status) return;
    imageStates.set(url, status);
    try {
      publish(url, { status });
    } catch {
      // A listener's failure must not fail the render.
    }
  };
  for (let round = 0; round < 10; round++) {
    ctx.checkTimeout();
    // One wasm call covers every page: the C++ side lays each page out in turn and
    // accumulates its requests, so a single read returns the union for all pages and
    // their fetches run in parallel (previously: collect, fetch, repeat per page).
    (await collect(
      satoruInst,
      htmls,
      width,
      height ?? 0,
      ctx.mediaTypeInt,
    )) as unknown;
    const bin = (await getPending(satoruInst)) as Uint8Array | null | undefined;
    const pending = parsePendingResources(
      bin instanceof Uint8Array ? bin : undefined,
    );
    if (pending.length === 0) break;
    // Stylesheets cascade by document order, not by fetch completion order: a small
    // later sheet must not land before (and so lose to) a large earlier one. They are
    // buffered here and injected in discovery order once the whole round has settled.
    const loadedCss: { index: number; url: string; bytes: Uint8Array }[] = [];
    // When maxResourceCount cuts a round short, what is dropped should be the least harmful: a missing
    // image leaves a hole, a missing font turns the whole text into tofu. Stylesheets go first (they
    // cascade by document order and may reveal more), then fonts, then images; discovery order is
    // kept within each kind.
    const rank = (t: string): number => (t === "css" ? 0 : t === "font" ? 1 : 2);
    const ordered = pending
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r.type) - rank(b.r.type) || a.i - b.i)
      .map((e) => e.r);
    await mapWithLimit(ordered, FETCH_CONCURRENCY, async (r) => {
      const diag = ctx.diag;
      const entry: ResourceDiagnostic | undefined = diag
        ? {
            type: r.type,
            url: r.url,
            name: r.name || undefined,
            status: "pending",
          }
        : undefined;
      if (diag && entry) diag.resources.push(entry);
      const settle = (
        status: ResourceDiagnostic["status"],
        bytes?: number,
        reason?: string,
      ): void => {
        if (!entry) return;
        entry.status = status;
        if (bytes !== undefined) entry.bytes = bytes;
        if (reason !== undefined) entry.reason = reason;
      };
      const skipWithError = (code: string, message: string): void => {
        settle("skipped", undefined, message);
        diag?.errors.push({ code, message, source: r.url });
        ctx.emitLog(LogLevel.Warning, `${message} (${r.url})`);
      };
      try {
        if (r.url.startsWith("data:")) {
          // Inline data: URLs resolve inside C++; nothing to fetch.
          settle("skipped", undefined, "inline data URL (resolved in C++)");
          return;
        }
        const blocked = checkResourceAllowed(r.url, ctx.limits);
        if (blocked) {
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(limitCodeForReason(blocked), blocked);
          return;
        }
        // Reserve the slot before awaiting so parallel fetches cannot
        // all pass the count check; released again if the fetch fails.
        if (
          ctx.limits.maxResourceCount !== undefined &&
          ctx.usage.resourceCount >= ctx.limits.maxResourceCount
        ) {
          const message = `Maximum resource count (${ctx.limits.maxResourceCount}) exceeded`;
          if (r.type === "font") ctx.usage.fontsSkippedByCount++;
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(DIAGNOSTIC_CODES.LIMIT_RESOURCE_COUNT, message);
          return;
        }
        ctx.usage.resourceCount++;
        if (r.type === "image") publishImage(r.url, "loading");
        const bytes = await fetchResourceBytes(
          r.url,
          baseUrl,
          userAgent,
          ctx.resolveResource,
          fetchTimeoutOf(ctx),
          ctx.limits.confineFilesToBaseUrl,
        );
        if (!bytes) {
          ctx.usage.resourceCount--;
          if (r.type === "image") publishImage(r.url, "error");
          settle("failed");
          const message = `Failed to fetch resource: ${r.url}`;
          diag?.warnings.push({
            code: DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
            message,
            source: r.url,
          });
          ctx.emitLog(LogLevel.Warning, message);
          return;
        }
        if (
          ctx.limits.maxResourceBytes !== undefined &&
          bytes.length > ctx.limits.maxResourceBytes
        ) {
          const message =
            `Resource size (${bytes.length} bytes) exceeds limit ` +
            `(${ctx.limits.maxResourceBytes})`;
          ctx.usage.resourceCount--;
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(DIAGNOSTIC_CODES.LIMIT_RESOURCE_SIZE, message);
          return;
        }
        // Check-and-add without an intervening await keeps this atomic.
        if (
          ctx.limits.maxTotalResourceBytes !== undefined &&
          ctx.usage.totalResourceBytes + bytes.length >
            ctx.limits.maxTotalResourceBytes
        ) {
          const message = `Total resource size exceeds limit (${ctx.limits.maxTotalResourceBytes})`;
          ctx.usage.resourceCount--;
          if (r.type === "image") publishImage(r.url, "error");
          skipWithError(DIAGNOSTIC_CODES.LIMIT_TOTAL_SIZE, message);
          return;
        }
        ctx.usage.totalResourceBytes += bytes.length;
        settle("loaded", bytes.length);
        if (r.type === "css") {
          loadedCss.push({ index: pending.indexOf(r), url: r.url, bytes });
          return;
        }
        (await addRes(
          satoruInst,
          r.url,
          r.type === "image" ? 2 : 1,
          bytes,
        )) as unknown;
        // The engine now owns the bytes: the page's image is "loaded" from this real transition, not a
        // synthetic one. No second fetch happens in the page.
        if (r.type === "image") publishImage(r.url, "loaded");
        if (r.type === "font") {
          diag?.fonts.push({
            family: r.name || r.url,
            status: "loaded",
            source: r.url,
          });
        }
      } catch (e) {
        // Per-resource failure is non-fatal; render proceeds regardless.
        if (r.type === "image") publishImage(r.url, "error");
        const d = errorToDiagnostic(
          e,
          DIAGNOSTIC_CODES.RESOURCE_FETCH_FAILED,
          r.url,
        );
        settle("failed", undefined, d.message);
        diag?.warnings.push(d);
      }
    });
    loadedCss.sort((a, b) => a.index - b.index);
    for (const css of loadedCss) {
      const text = new TextDecoder().decode(css.bytes);
      const fixed = absolutizeCssUrls(text, css.url);
      const bytes = fixed === text ? css.bytes : new TextEncoder().encode(fixed);
      (await addRes(satoruInst, css.url, 3, bytes)) as unknown;
    }
  }
  if (ctx.usage.fontsSkippedByCount > 0) {
    // Text in those fonts renders as tofu: say what to change instead of leaving a silent bad image.
    // One message for the whole render, however many discovery rounds hit the limit.
    const message =
      `${ctx.usage.fontsSkippedByCount} font file(s) were not loaded because maxResourceCount ` +
      `(${ctx.limits.maxResourceCount}) was reached; text using them may render as missing glyphs. ` +
      "Raise limits.maxResourceCount (a Google Fonts stylesheet alone can reference over a hundred files).";
    ctx.diag?.warnings.push({
      code: DIAGNOSTIC_CODES.LIMIT_RESOURCE_COUNT,
      message,
    });
    ctx.emitLog(LogLevel.Warning, message);
    if (ctx.limits.strictFonts) {
      throw new Error(`[${DIAGNOSTIC_CODES.LIMIT_RESOURCE_COUNT}] ${message}`);
    }
  }
  // Merge the C++ collect-phase breakdown into the JS timings.
  if (profileEnabled && ctx.diag) {
    const getProfile = module.satoru_get_collect_profile;
    if (typeof getProfile === "function") {
      try {
        const parsed = JSON.parse(
          (await getProfile(satoruInst)) as string,
        ) as Record<string, number>;
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "number") {
            ctx.addTime(key, value);
          }
        }
      } catch {
        // Non-fatal; timings simply miss the C++ breakdown.
      }
    }
  }
}
