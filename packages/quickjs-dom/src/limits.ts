/**
 * What a page may fetch. The page's scripts can `fetch`, and so can the script and module tags it loads: without limits
 * a page can reach any host this runtime can, internal ones included. The names follow the `limits` of
 * `wasm-html-to-image`'s `render()`.
 */
export interface FetchLimits {
  /** Allowed URL protocols, e.g. `["https:"]`. */
  allowedProtocols?: string[];
  /** Only these hostnames may be fetched (exact match). */
  allowedHosts?: string[];
  /** These hostnames may not be fetched (exact match). */
  blockedHosts?: string[];
  /**
   * Refuse `localhost`, `*.localhost` / `*.local` / `*.internal` and addresses of private, loopback and link-local
   * networks (IPv4 and IPv6 literals). A hostname that merely resolves to such an address cannot be told apart in
   * here: pair this with `allowedHosts` when the target must be trusted.
   */
  blockPrivateHosts?: boolean;
  /** At most this many requests for the whole page (counted per call, redirects not counted again). */
  maxResourceCount?: number;
  /** A response over this many bytes is refused. */
  maxResourceBytes?: number;
  /** All responses together over this many bytes are refused. */
  maxTotalResourceBytes?: number;
}

const MAX_REDIRECTS = 10;

/** True for localhost and private, loopback and link-local addresses (`host` as `URL.hostname` gives it). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true;
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (dotted) return isPrivateHost(dotted[1]);
    // `new URL` writes an IPv4-mapped address in hex: ::ffff:7f00:1
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return isPrivateHost([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
  }
  return false;
}

/** `fetch` and body reading that obey {@link FetchLimits}. With no limits they are plain `fetch` and `arrayBuffer`. */
export function createGuard(limits: FetchLimits = {}) {
  const restricted = !!(limits.allowedProtocols || limits.allowedHosts || limits.blockedHosts || limits.blockPrivateHosts);
  let requests = 0;
  let total = 0;

  const check = (url: URL) => {
    const deny = (why: string) => {
      throw new Error(`Blocked by the fetch limits (${why}): ${url.href}`);
    };
    if (limits.allowedProtocols && !limits.allowedProtocols.includes(url.protocol)) deny(`protocol ${url.protocol}`);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (limits.allowedHosts && !limits.allowedHosts.includes(host)) deny("host not allowed");
    if (limits.blockedHosts && limits.blockedHosts.includes(host)) deny("host blocked");
    if (limits.blockPrivateHosts && isPrivateHost(host)) deny("private host");
  };

  return {
    /** Fetch `input`; with host or protocol limits every redirect is checked before it is followed. */
    async fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
      if (limits.maxResourceCount !== undefined && ++requests > limits.maxResourceCount) {
        throw new Error(`Blocked by the fetch limits (more than ${limits.maxResourceCount} requests): ${String(input)}`);
      }
      let url = new URL(input);
      let method = init.method;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        check(url);
        if (!restricted) return fetch(url, init);
        const res = await fetch(url, { ...init, method, redirect: "manual" });
        if (res.type === "opaqueredirect") throw new Error(`Blocked by the fetch limits (this runtime hides the redirect target, so it cannot be checked): ${url.href}`);
        if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
          await res.body?.cancel();
          url = new URL(res.headers.get("location")!, url);
          if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) method = "GET";
          continue;
        }
        return res;
      }
      throw new Error(`Blocked by the fetch limits (more than ${MAX_REDIRECTS} redirects): ${String(input)}`);
    },

    /** The body of `res`, refused when it is over the size limits. */
    async bytes(res: Response): Promise<Uint8Array> {
      const max = limits.maxResourceBytes;
      // the size and the limit that refused it, so a caller can say what happened without guessing
      const tooBig = (limit: string, size: number) =>
        new Error(`Blocked by the fetch limits (${limit}: a response is ${size} bytes, over ${max} bytes): ${res.url}`);
      const contentLength = Number(res.headers.get("content-length"));
      if (max !== undefined && contentLength > max) {
        await res.body?.cancel();
        throw tooBig("maxResourceBytes", contentLength);
      }
      let bytes: Uint8Array;
      if (max !== undefined && res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > max) {
            await reader.cancel();
            throw tooBig("maxResourceBytes", size);
          }
          chunks.push(value);
        }
        bytes = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          bytes.set(c, at);
          at += c.length;
        }
      } else {
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      total += bytes.length;
      if (limits.maxTotalResourceBytes !== undefined && total > limits.maxTotalResourceBytes) {
        throw new Error(`Blocked by the fetch limits (maxTotalResourceBytes: responses together are ${total} bytes, over ${limits.maxTotalResourceBytes} bytes): ${res.url}`);
      }
      return bytes;
    },
  };
}
