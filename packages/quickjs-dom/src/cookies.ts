/**
 * A cookie jar with the shape of tough-cookie's (the jar jsdom uses), small enough for an edge runtime:
 * RFC 6265 storage — domain and path scoping, `Secure`, `HttpOnly`, expiry by `max-age` / `expires` — without
 * the public-suffix list or a persistent store. The facade accepts any jar with this one's synchronous
 * surface (a real tough-cookie jar included), and {@link JSDOM} uses one for `document.cookie`, for the
 * cookies a page's requests carry, and for the `Set-Cookie` headers its responses bring back.
 */

/** One cookie, as the jar hands them out (tough-cookie's field names). */
export interface Cookie {
  key: string;
  value: string;
  domain: string;
  path: string;
  /** True when the cookie belongs to exactly its host (no `Domain` attribute was given). */
  hostOnly: boolean;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  /** When the cookie goes away; absent for a session cookie. */
  expires?: Date;
  creation: Date;
  toString(): string;
}

/** The part of a jar the engine and the facade rely on — tough-cookie's synchronous methods. */
export interface CookieJarLike {
  setCookieSync(cookie: string, url: string, options?: { script?: boolean }): Cookie | undefined;
  getCookieStringSync(url: string, options?: { httpOnly?: boolean }): string;
  getCookiesSync(url: string, options?: { httpOnly?: boolean }): Cookie[];
}

interface Stored extends Cookie {
  seq: number;
  expiresAt?: number;
}

const defaultPath = (urlPath: string): string => {
  // RFC 6265 §5.1.4: the directory of the request path
  if (!urlPath.startsWith("/")) return "/";
  const dir = urlPath.slice(0, urlPath.lastIndexOf("/"));
  return dir === "" ? "/" : dir;
};

const pathMatches = (cookiePath: string, urlPath: string): boolean =>
  urlPath === cookiePath || (urlPath.startsWith(cookiePath) && (cookiePath.endsWith("/") || urlPath[cookiePath.length] === "/"));

const domainMatches = (cookie: Stored, host: string): boolean =>
  cookie.hostOnly ? host === cookie.domain : host === cookie.domain || host.endsWith("." + cookie.domain);

/** Parse a `Set-Cookie` (or `document.cookie`) string for `url`; undefined when it is not a cookie for there. */
function parse(raw: string, url: URL, script: boolean, seq: number): Stored | undefined {
  const parts = String(raw).split(";");
  const first = parts[0];
  const eq = first.indexOf("=");
  if (eq <= 0) return undefined;
  const key = first.slice(0, eq).trim();
  if (!key) return undefined;
  let value = first.slice(eq + 1).trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  const host = url.hostname.toLowerCase();
  const cookie: Stored = {
    key,
    value,
    domain: host,
    path: defaultPath(url.pathname),
    hostOnly: true,
    secure: false,
    httpOnly: false,
    creation: new Date(),
    seq,
    toString() {
      return `${this.key}=${this.value}`;
    },
  };
  let maxAge: number | undefined;
  let expires: number | undefined;
  for (const attr of parts.slice(1)) {
    const i = attr.indexOf("=");
    const name = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? "" : attr.slice(i + 1).trim();
    if (name === "domain") {
      const domain = val.replace(/^\./, "").toLowerCase();
      // a host may only set cookies for itself or a parent domain
      if (!domain || (host !== domain && !host.endsWith("." + domain))) return undefined;
      cookie.domain = domain;
      cookie.hostOnly = false;
    } else if (name === "path") {
      if (val.startsWith("/")) cookie.path = val;
    } else if (name === "max-age") {
      const n = Number.parseInt(val, 10);
      if (!Number.isNaN(n)) maxAge = n;
    } else if (name === "expires") {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) expires = t;
    } else if (name === "secure") cookie.secure = true;
    else if (name === "httponly") {
      // a script setting a cookie through document.cookie cannot make it HttpOnly (RFC 6265 §5.3
      // step 6 ignores the attribute on that path); a Set-Cookie header can
      if (!script) cookie.httpOnly = true;
    } else if (name === "samesite") cookie.sameSite = val;
  }
  const now = Date.now();
  if (maxAge !== undefined) cookie.expiresAt = now + maxAge * 1000;
  else if (expires !== undefined) cookie.expiresAt = expires;
  if (cookie.expiresAt !== undefined) cookie.expires = new Date(cookie.expiresAt);
  return cookie;
}

export class CookieJar implements CookieJarLike {
  private cookies: Stored[] = [];
  private seq = 0;

  /**
   * Store a cookie from a `Set-Cookie` string for `url`. With `options.script` the string came from
   * `document.cookie`, so its `HttpOnly` attribute is ignored. Returns the stored cookie, or
   * undefined when the string was rejected or it only deleted one.
   */
  setCookieSync(raw: string, url: string, options: { script?: boolean } = {}): Cookie | undefined {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return undefined;
    }
    const cookie = parse(raw, target, !!options.script, this.seq);
    const same = (c: Stored) => c.key === (cookie?.key ?? "") && c.domain === cookie?.domain && c.path === cookie?.path;
    if (!cookie || (cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now())) {
      if (cookie) this.cookies = this.cookies.filter((c) => !same(c));
      return undefined;
    }
    const old = this.cookies.findIndex(same);
    if (old >= 0) {
      // a replacement keeps the original's place in the order (RFC 6265 §5.3 step 11)
      cookie.seq = this.cookies[old].seq;
      cookie.creation = this.cookies[old].creation;
      this.cookies.splice(old, 1);
    } else cookie.seq = this.seq++;
    this.cookies.push(cookie);
    return cookie;
  }

  /** The cookies that apply to `url`, in the order a `Cookie` header carries them. */
  getCookiesSync(url: string, options: { httpOnly?: boolean } = {}): Cookie[] {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return [];
    }
    const now = Date.now();
    this.cookies = this.cookies.filter((c) => c.expiresAt === undefined || c.expiresAt > now);
    const host = target.hostname.toLowerCase();
    const secureOk = target.protocol === "https:" || target.protocol === "wss:";
    return this.cookies
      .filter(
        (c) =>
          domainMatches(c, host) &&
          pathMatches(c.path, target.pathname) &&
          (!c.secure || secureOk) &&
          (options.httpOnly !== false || !c.httpOnly),
      )
      .sort((a, b) => b.path.length - a.path.length || a.seq - b.seq);
  }

  /** `getCookiesSync` as a `Cookie` header (or a `document.cookie` string). */
  getCookieStringSync(url: string, options: { httpOnly?: boolean } = {}): string {
    return this.getCookiesSync(url, options)
      .map((c) => `${c.key}=${c.value}`)
      .join("; ");
  }

  /** Forget everything. */
  removeAllCookiesSync(): void {
    this.cookies = [];
  }

  /** The jar as plain data (the cookies, in storage order). */
  serializeSync(): { version: string; cookies: Stored[] } {
    return { version: "wasm-quickjs-dom@1", cookies: [...this.cookies] };
  }

  // tough-cookie's callback forms, for callers that use the jar that way
  setCookie(cookie: string, url: string, callback: (error: Error | null, cookie?: Cookie) => void): void {
    try {
      callback(null, this.setCookieSync(cookie, url));
    } catch (error) {
      callback(error as Error);
    }
  }

  getCookieString(url: string, callback: (error: Error | null, cookies?: string) => void): void {
    try {
      callback(null, this.getCookieStringSync(url));
    } catch (error) {
      callback(error as Error);
    }
  }

  getCookies(url: string, callback: (error: Error | null, cookies?: Cookie[]) => void): void {
    try {
      callback(null, this.getCookiesSync(url));
    } catch (error) {
      callback(error as Error);
    }
  }
}
