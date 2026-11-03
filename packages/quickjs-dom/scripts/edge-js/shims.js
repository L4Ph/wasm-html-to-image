// Browser-ish globals that a bare QuickJS context lacks. Runs first, as a plain script.
// Timers and fetch call out to the host through `__host` (see src/index.ts).
(function (g) {
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var t0 = Date.now();

  g.atob = function (s) {
    s = String(s).replace(/[\t\n\f\r ]+/g, "").replace(/=+$/, "");
    var out = "", bits = 0, acc = 0;
    for (var i = 0; i < s.length; i++) {
      var v = B64.indexOf(s[i]);
      if (v < 0) throw new Error("InvalidCharacterError");
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((acc >> bits) & 0xff);
      }
    }
    return out;
  };
  g.btoa = function (s) {
    s = String(s);
    var out = "";
    for (var i = 0; i < s.length; i += 3) {
      var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2);
      out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4 || 0)] + (isNaN(b) ? "=" : B64[((b & 15) << 2) | (c >> 6 || 0)]) + (isNaN(c) ? "=" : B64[c & 63]);
    }
    return out;
  };

  g.console = {
    log: function () { __host.log("log", Array.prototype.map.call(arguments, String).join(" ")); },
    info: function () { __host.log("log", Array.prototype.map.call(arguments, String).join(" ")); },
    warn: function () { __host.log("warn", Array.prototype.map.call(arguments, String).join(" ")); },
    debug: function () {},
    error: function () {
      __host.log("error", Array.prototype.map.call(arguments, function (x) { return (x && x.message ? x.name + ": " + x.message + " | " : "") + ((x && x.stack) || String(x)); }).join(" "));
    },
  };

  // Intl in English only (QuickJS has no locale data). NumberFormat can be called without new, as in a browser.
  if (!g.Intl) {
    var CURRENCIES = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "CN¥", INR: "₹", KRW: "₩", CAD: "CA$", AUD: "A$" };
    var NumberFormat = function NumberFormat(l, o) {
      if (!(this instanceof NumberFormat)) return new NumberFormat(l, o);
      o = o || {};
      this._o = o;
      this._style = o.style || "decimal";
      var currencyDigits = o.currency === "JPY" || o.currency === "KRW" ? 0 : 2;
      var defMin = this._style === "currency" ? currencyDigits : 0;
      var defMax = this._style === "currency" ? currencyDigits : this._style === "percent" ? 0 : 3;
      this._min = o.minimumFractionDigits != null ? o.minimumFractionDigits : Math.min(defMin, o.maximumFractionDigits != null ? o.maximumFractionDigits : defMin);
      this._max = o.maximumFractionDigits != null ? Math.max(o.maximumFractionDigits, this._min) : Math.max(defMax, this._min);
    };
    NumberFormat.prototype.format = function (n) {
      n = Number(n);
      if (n !== n) return "NaN";
      var o = this._o, neg = n < 0 || Object.is(n, -0) && false;
      if (!isFinite(n)) return (neg ? "-" : "") + "∞";
      if (this._style === "percent") n *= 100;
      var abs = Math.abs(n), suffix = "";
      if (o.notation === "compact") {
        var units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
        for (var i = 0; i < units.length; i++) if (abs >= units[i][0]) { abs /= units[i][0]; suffix = units[i][1]; break; }
        if (!(o.maximumFractionDigits != null)) { var s0 = abs >= 100 || !suffix ? 0 : abs >= 10 ? 0 : 1; abs = +abs.toFixed(s0); }
      }
      var fixed = abs.toFixed(Math.min(100, this._max));
      var parts = fixed.split("."), int = parts[0], frac = parts[1] || "";
      while (frac.length > this._min && frac.charAt(frac.length - 1) === "0") frac = frac.slice(0, -1);
      if (o.useGrouping !== false) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      var text = int + (frac ? "." + frac : "") + suffix;
      if (this._style === "percent") text += "%";
      if (this._style === "currency") text = (CURRENCIES[o.currency] || (o.currency ? o.currency + " " : "")) + text;
      if (this._style === "unit" && o.unit) text += " " + o.unit;
      return (neg && +fixed !== 0 ? "-" : "") + text;
    };
    NumberFormat.prototype.formatToParts = function (n) { return [{ type: "literal", value: this.format(n) }]; };
    NumberFormat.prototype.resolvedOptions = function () { return { locale: "en-US", numberingSystem: "latn", style: this._style, minimumFractionDigits: this._min, maximumFractionDigits: this._max, useGrouping: this._o.useGrouping !== false }; };
    NumberFormat.supportedLocalesOf = function (l) { return [].concat(l || []); };
    g.Intl = { NumberFormat: NumberFormat };
  }
  // The rest of Intl that pages touch, in English only (QuickJS has no locale data): enough for a page not to fail
  (function (I) {
    var define = function (name, C) { if (!I[name]) Object.defineProperty(I, name, { value: C, writable: true, configurable: true }); };
    var locale = function (l) { return typeof l === "string" ? l : Array.isArray(l) && l.length ? l[0] : "en-US"; };
    define("Segmenter", class Segmenter {
      constructor(l, o) { this._l = locale(l); this._g = (o && o.granularity) || "grapheme"; }
      segment(str) {
        str = String(str);
        var gran = this._g, out = [], re;
        if (gran === "word") re = /[\p{L}\p{N}_']+|\s+|[^\p{L}\p{N}_'\s]/gu;
        else if (gran === "sentence") re = /[^.!?]*[.!?]+\s*|[^.!?]+$/gu;
        else re = /\p{RI}\p{RI}|(?:\p{Emoji_Presentation}|\p{Emoji}️?)(?:\p{EMod}|‍(?:\p{Emoji_Presentation}|\p{Emoji}️?)|️|⃣)*|\P{M}\p{M}*|[\s\S]/gu;
        var m;
        while ((m = re.exec(str)) && m[0] !== "") {
          var seg = { segment: m[0], index: m.index, input: str };
          if (gran === "word") seg.isWordLike = /[\p{L}\p{N}]/u.test(m[0]);
          out.push(seg);
        }
        var res = { containing: function (i) { i = i || 0; return out.find(function (s) { return i >= s.index && i < s.index + s.segment.length; }); } };
        res[Symbol.iterator] = function () { return out[Symbol.iterator](); };
        return res;
      }
      resolvedOptions() { return { locale: this._l, granularity: this._g }; }
      static supportedLocalesOf(l) { return [].concat(l || []); }
    });
    define("PluralRules", class PluralRules {
      constructor(l, o) { this._l = locale(l); this._t = (o && o.type) || "cardinal"; }
      select(n) {
        n = Number(n);
        if (this._t === "ordinal") { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? "one" : a === 2 && b !== 12 ? "two" : a === 3 && b !== 13 ? "few" : "other"; }
        return n === 1 ? "one" : "other";
      }
      resolvedOptions() { return { locale: this._l, type: this._t }; }
      static supportedLocalesOf(l) { return [].concat(l || []); }
    });
    define("Collator", class Collator {
      constructor(l, o) {
        this._l = locale(l); this._o = o || {};
        var self = this;
        this.compare = function (a, b) { return self._o.numeric || self._o.sensitivity === "base" ? String(a).localeCompare(String(b), undefined, self._o) : String(a).localeCompare(String(b)); };
      }
      resolvedOptions() { return { locale: this._l, usage: "sort", sensitivity: "variant", ignorePunctuation: false, collation: "default", numeric: !!this._o.numeric, caseFirst: "false" }; }
      static supportedLocalesOf(l) { return [].concat(l || []); }
    });
    define("ListFormat", class ListFormat {
      constructor(l, o) { this._o = o || {}; }
      format(list) {
        var a = Array.from(list, String), word = this._o.type === "disjunction" ? "or" : "and";
        if (this._o.type === "unit") return a.join(this._o.style === "narrow" ? " " : ", ");
        return a.length < 2 ? a.join("") : a.length === 2 ? a[0] + " " + word + " " + a[1] : a.slice(0, -1).join(", ") + ", " + word + " " + a[a.length - 1];
      }
    });
    define("RelativeTimeFormat", class RelativeTimeFormat {
      constructor(l, o) { this._o = o || {}; }
      format(v, unit) {
        v = Number(v); unit = String(unit).replace(/s$/, "");
        if (this._o.numeric === "auto") {
          if (v === 0) return unit === "day" ? "today" : "this " + unit;
          if (v === 1) return unit === "day" ? "tomorrow" : "next " + unit;
          if (v === -1) return unit === "day" ? "yesterday" : "last " + unit;
        }
        var n = Math.abs(v), label = n + " " + unit + (n === 1 ? "" : "s");
        return v < 0 || Object.is(v, -0) ? label + " ago" : "in " + label;
      }
    });
    define("DateTimeFormat", class DateTimeFormat {
      constructor(l, o) { this._l = locale(l); this._o = o || {}; }
      format(d) {
        d = d === undefined ? new Date() : new Date(d);
        var o = this._o, utc = o.timeZone === "UTC";
        var get = function (k) { return utc ? d["getUTC" + k]() : d["get" + k](); };
        var date = (get("Month") + 1) + "/" + get("Date") + "/" + get("FullYear");
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        var h = get("Hours"), time = (h % 12 || 12) + ":" + pad(get("Minutes")) + ":" + pad(get("Seconds")) + " " + (h < 12 ? "AM" : "PM");
        var wantsTime = o.timeStyle || o.hour || o.minute || o.second, wantsDate = o.dateStyle || o.year || o.month || o.day || o.weekday || !wantsTime;
        return wantsDate && wantsTime ? date + ", " + time : wantsTime ? time : date;
      }
      formatToParts(d) { return [{ type: "literal", value: this.format(d) }]; }
      resolvedOptions() { return { locale: this._l, calendar: "gregory", numberingSystem: "latn", timeZone: this._o.timeZone || "UTC" }; }
      static supportedLocalesOf(l) { return [].concat(l || []); }
    });
    define("getCanonicalLocales", function (l) { return [].concat(l || []); });
    if (!I.supportedValuesOf) define("supportedValuesOf", function () { return []; });
  })(g.Intl);
  if (!g.DOMException) {
    g.DOMException = class DOMException extends Error {
      constructor(m, n) { super(m || ""); this.name = n || "Error"; this.code = 0; }
    };
  }
  if (!g.queueMicrotask) g.queueMicrotask = function (fn) { Promise.resolve().then(fn); };
  // QuickJS-ng has its own `performance`, whose origin is the moment the context was made: here that is the moment the
  // guest was started once for all pages, so the page gets one counted from its own start
  var perf = {
    now: function () { return Date.now() - t0; },
    timeOrigin: t0,
    mark: function () {}, measure: function () {}, clearMarks: function () {}, clearMeasures: function () {},
    getEntries: function () { return []; }, getEntriesByName: function () { return []; }, getEntriesByType: function () { return []; },
  };
  g.performance = perf;
  // The guest is started once and copied for every page (see src/runtime.ts), so what depends on when a page begins is
  // set again in __edgeBoot: the clock's origin, and the random number generator (Math.random).
  g.__edgeStart = function (seed) {
    t0 = Date.now();
    perf.timeOrigin = t0;
    if (seed && seed.length === 4) {
      var s0 = seed[0] | 0, s1 = seed[1] | 0, s2 = seed[2] | 0, s3 = seed[3] | 0;
      if (!(s0 | s1 | s2 | s3)) s0 = 1;
      // xoshiro128**
      Math.random = function () {
        var r = Math.imul(Math.imul(s1, 5) << 7 | Math.imul(s1, 5) >>> 25, 9);
        var t = s1 << 9;
        s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t;
        s3 = (s3 << 11) | (s3 >>> 21);
        return (r >>> 0) / 4294967296;
      };
    }
  };

  // timers: the host sleeps, then calls __fire(id)
  var tid = 1, timers = new Map();
  g.setTimeout = function (fn, ms) { var id = tid++; timers.set(id, { fn: fn, args: Array.prototype.slice.call(arguments, 2), rep: 0 }); __host.timer(id, +ms || 0); return id; };
  g.setInterval = function (fn, ms) { var id = tid++; timers.set(id, { fn: fn, args: Array.prototype.slice.call(arguments, 2), rep: +ms || 1 }); __host.timer(id, +ms || 1); return id; };
  g.clearTimeout = g.clearInterval = function (id) { timers.delete(id); };
  g.setImmediate = function (fn) { return g.setTimeout.apply(g, [fn, 0].concat(Array.prototype.slice.call(arguments, 1))); };
  g.clearImmediate = g.clearTimeout;
  g.requestAnimationFrame = function (fn) { return g.setTimeout(function () { fn(g.performance.now()); }, 16); };
  g.cancelAnimationFrame = g.clearTimeout;
  g.cancelIdleCallback = g.clearTimeout;
  g.requestIdleCallback = function (fn) { return g.setTimeout(function () { fn({ didTimeout: false, timeRemaining: function () { return 10; } }); }, 1); };
  g.__fire = function (id) {
    var t = timers.get(id);
    if (!t) return;
    if (t.rep) __host.timer(id, t.rep); else timers.delete(id);
    try { t.fn.apply(null, t.args); } catch (e) { __host.log("error", "timer: " + (e && e.message ? e.name + ": " + e.message + " " + (e.stack || "") : String(e))); }
  };

  // text
  if (!g.TextEncoder) {
    g.TextEncoder = class {
      get encoding() { return "utf-8"; }
      encode(s) {
        var out = [];
        for (var ch of String(s == null ? "" : s)) {
          var c = ch.codePointAt(0);
          if (c < 0x80) out.push(c);
          else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
          else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
          else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
        return new Uint8Array(out);
      }
    };
  }
  if (!g.TextDecoder) {
    g.TextDecoder = class {
      constructor() { this.encoding = "utf-8"; }
      decode(b) {
        if (!b) return "";
        var u = b instanceof Uint8Array ? b : new Uint8Array(b.buffer || b), s = "";
        for (var i = 0; i < u.length;) {
          var c = u[i++];
          if (c < 0x80) s += String.fromCharCode(c);
          else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (u[i++] & 63));
          else if (c < 0xf0) s += String.fromCharCode(((c & 15) << 12) | ((u[i++] & 63) << 6) | (u[i++] & 63));
          else s += String.fromCodePoint(((c & 7) << 18) | ((u[i++] & 63) << 12) | ((u[i++] & 63) << 6) | (u[i++] & 63));
        }
        return s;
      }
    };
  }

  if (!g.AbortController) {
    g.AbortSignal = class {
      constructor() { this.aborted = false; this._l = []; }
      addEventListener(t, f) { this._l.push(f); }
      removeEventListener(t, f) { this._l = this._l.filter(function (x) { return x !== f; }); }
      throwIfAborted() { if (this.aborted) throw new Error("aborted"); }
    };
    g.AbortController = class {
      constructor() { this.signal = new g.AbortSignal(); }
      abort() { this.signal.aborted = true; this.signal._l.forEach(function (f) { f({ type: "abort" }); }); }
    };
  }
  if (!g.structuredClone) g.structuredClone = function (v) { return JSON.parse(JSON.stringify(v)); };

  if (!g.URLSearchParams) {
    g.URLSearchParams = class {
      constructor(i) {
        this.l = [];
        if (typeof i === "string") {
          i = i.replace(/^\?/, "");
          if (i) for (var p of i.split("&")) { var kv = p.split("="); this.l.push([decodeURIComponent(kv[0].replace(/\+/g, " ")), decodeURIComponent((kv[1] || "").replace(/\+/g, " "))]); }
        } else if (i) for (var k of Object.keys(i)) this.l.push([k, String(i[k])]);
      }
      get(k) { var e = this.l.find(function (x) { return x[0] === k; }); return e ? e[1] : null; }
      getAll(k) { return this.l.filter(function (x) { return x[0] === k; }).map(function (x) { return x[1]; }); }
      has(k) { return this.l.some(function (x) { return x[0] === k; }); }
      set(k, v) { this.delete(k); this.l.push([k, String(v)]); }
      append(k, v) { this.l.push([k, String(v)]); }
      delete(k) { this.l = this.l.filter(function (x) { return x[0] !== k; }); }
      forEach(f) { var s = this; this.l.forEach(function (e) { f(e[1], e[0], s); }); }
      entries() { return this.l[Symbol.iterator](); }
      keys() { return this.l.map(function (x) { return x[0]; })[Symbol.iterator](); }
      values() { return this.l.map(function (x) { return x[1]; })[Symbol.iterator](); }
      [Symbol.iterator]() { return this.entries(); }
      toString() { return this.l.map(function (e) { return encodeURIComponent(e[0]) + "=" + encodeURIComponent(e[1]); }).join("&"); }
    };
  }
  if (!g.URL) {
    g.URL = class {
      constructor(u, b) {
        u = String(u);
        if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) {
          if (!b) throw new TypeError("Invalid URL: " + u);
          var bb = new g.URL(b), root = bb.origin !== "null" ? bb.origin : bb.protocol + (bb.host ? "//" + bb.host : ""); // an opaque origin (x:/) still has a root
          if (u.startsWith("//")) u = bb.protocol + u;
          else if (u.startsWith("/")) u = root + u;
          else if (u.startsWith("?") || u.startsWith("#")) u = root + bb.pathname + (u.startsWith("#") ? bb.search : "") + u;
          else u = root + bb.pathname.replace(/[^/]*$/, "") + u;
        }
        var m = /^([a-z][a-z0-9+.-]*:)(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(u);
        if (!m) throw new TypeError("Invalid URL: " + u);
        this.protocol = m[1].toLowerCase();
        this.host = (m[2] || "").toLowerCase();
        this.hostname = this.host.replace(/:\d+$/, "");
        this.port = (/:(\d+)$/.exec(this.host) || [])[1] || "";
        var p = m[3] || (m[2] != null ? "/" : ""), out = [];
        for (var s of p.split("/")) { if (s === "..") { if (out.length > 1) out.pop(); } else if (s !== ".") out.push(s); }
        this.pathname = out.join("/") || "/";
        this.search = m[4] && m[4] !== "?" ? m[4] : "";
        this.hash = m[5] && m[5] !== "#" ? m[5] : "";
        this.origin = m[2] != null ? this.protocol + "//" + this.host : "null";
        this.searchParams = new g.URLSearchParams(this.search);
        this.username = "";
        this.password = "";
      }
      get href() { var s = this.searchParams.toString(); return this.protocol + (this.host || this.protocol === "file:" ? "//" + this.host : "") + this.pathname + (s ? "?" + s : this.search) + this.hash; }
      toString() { return this.href; }
      toJSON() { return this.href; }
    };
  }

  // fetch: the host does the network and hands back text
  g.Headers = g.Headers || class {
    constructor(i) { this.m = new Map(); if (i) for (var k of Object.keys(i)) this.m.set(k.toLowerCase(), String(i[k])); }
    get(k) { var v = this.m.get(String(k).toLowerCase()); return v == null ? null : v; }
    set(k, v) { this.m.set(String(k).toLowerCase(), String(v)); }
    append(k, v) { k = String(k).toLowerCase(); this.m.set(k, this.m.has(k) ? this.m.get(k) + ", " + v : String(v)); }
    delete(k) { this.m.delete(String(k).toLowerCase()); }
    has(k) { return this.m.has(String(k).toLowerCase()); }
    forEach(f) { this.m.forEach(function (v, k) { f(v, k); }); }
    entries() { return this.m.entries(); }
    keys() { return this.m.keys(); }
    values() { return this.m.values(); }
    [Symbol.iterator]() { return this.m.entries(); }
  };
  g.Blob = g.Blob || class {
    constructor(parts, opts) {
      var enc = new g.TextEncoder(), chunks = (parts || []).map(function (p) { return typeof p === "string" ? enc.encode(p) : p instanceof g.Blob ? p._u : p instanceof Uint8Array ? p : new Uint8Array(p.buffer || p); });
      var n = 0; chunks.forEach(function (c) { n += c.length; });
      this._u = new Uint8Array(n);
      var o = 0; chunks.forEach(function (c) { this._u.set(c, o); o += c.length; }, this);
      this.size = n;
      this.type = (opts && opts.type) || "";
    }
    async text() { return new g.TextDecoder().decode(this._u); }
    async arrayBuffer() { return this._u.slice().buffer; }
    slice(a, b, t) { var s = new g.Blob([this._u.slice(a, b)], { type: t || this.type }); return s; }
  };
  g.FormData = g.FormData || class {
    constructor() { this.l = []; }
    append(k, v) { this.l.push([String(k), v]); }
    set(k, v) { this.delete(k); this.append(k, v); }
    get(k) { var e = this.l.find(function (x) { return x[0] === k; }); return e ? e[1] : null; }
    getAll(k) { return this.l.filter(function (x) { return x[0] === k; }).map(function (x) { return x[1]; }); }
    has(k) { return this.l.some(function (x) { return x[0] === k; }); }
    delete(k) { this.l = this.l.filter(function (x) { return x[0] !== k; }); }
    entries() { return this.l[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
  };
  if (g.URL && !g.URL.createObjectURL) { g.URL.createObjectURL = function () { return "blob:null/" + Math.random().toString(16).slice(2); }; g.URL.revokeObjectURL = function () {}; }

  // crypto: random values only (no digest/subtle)
  g.crypto = g.crypto || {
    getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * Math.pow(2, 8 * a.BYTES_PER_ELEMENT)); return a; },
    randomUUID: function () { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }); },
  };
  g.Response = g.Response || class {
    constructor(body, init) {
      init = init || {};
      this._b = body == null ? "" : body;
      this.status = init.status != null ? init.status : 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.statusText = init.statusText || "";
      this.headers = new g.Headers(init.headers);
      this.url = init.url || "";
      this.bodyUsed = false;
    }
    async text() { return typeof this._b === "string" ? this._b : new g.TextDecoder().decode(this._b); }
    async json() { return JSON.parse(await this.text()); }
    async arrayBuffer() { var u = typeof this._b === "string" ? new g.TextEncoder().encode(this._b) : this._b; return u.buffer; }
    async blob() { return new g.Blob([this._b], { type: this.headers.get("content-type") || "" }); }
    clone() { return new g.Response(this._b, this); }
    get body() {
      var b = this._b;
      return typeof g.ReadableStream === "function"
        ? new g.ReadableStream({ start: function (c) { c.enqueue(typeof b === "string" ? new g.TextEncoder().encode(b) : b); c.close(); } })
        : null;
    }
  };
  g.Request = g.Request || class {
    constructor(u, init) { init = init || {}; this.url = String((u && u.url) || u); this.method = init.method || "GET"; this.headers = new g.Headers(init.headers); }
  };
  g.fetch = function (input, init) {
    // the host gets the URL and one string: a plain method, or {m, h, b} JSON when the request has headers or a body
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase(), headers = {}, body = init && init.body;
    var hs = (init && init.headers) || (input && input.headers);
    if (hs) {
      if (typeof hs.forEach === "function" && !Array.isArray(hs)) hs.forEach(function (v, k) { headers[k] = v; });
      else if (Array.isArray(hs)) hs.forEach(function (e) { headers[e[0]] = e[1]; });
      else Object.keys(hs).forEach(function (k) { headers[k] = String(hs[k]); });
    }
    if (body !== undefined && body !== null && typeof body !== "string") {
      if (typeof body.toString === "function" && g.URLSearchParams && body instanceof g.URLSearchParams) body = body.toString();
      else if (body instanceof Uint8Array || body instanceof ArrayBuffer) body = new g.TextDecoder().decode(body);
      else body = String(body);
    }
    var packed = Object.keys(headers).length || (body !== undefined && body !== null) ? JSON.stringify({ m: method, h: headers, b: body === undefined ? null : body }) : method;
    return __host.fetch(String((input && input.url) || input), packed)
      .then(function (j) { return JSON.parse(j); })
      .then(function (r) {
        var bin = g.atob(r.body), u = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        r.body = u;
        return r;
      })
      .then(function (r) { return new g.Response(r.body, { status: r.status, headers: r.headers, url: r.url }); });
  };

  // XMLHttpRequest on top of fetch (axios and older libraries)
  g.XMLHttpRequest = g.XMLHttpRequest || (function () {
    var XHR = class XMLHttpRequest {
      constructor() {
        this.readyState = 0; this.status = 0; this.statusText = ""; this.responseText = ""; this.response = null; this.responseType = ""; this.responseURL = "";
        this.timeout = 0; this.withCredentials = false; this.upload = { addEventListener: function () {}, removeEventListener: function () {} };
        this.l = {}; this.h = {}; this.rh = {};
      }
      open(m, u) { this.m = String(m).toUpperCase(); this.u = String(u); this.rh = {}; this.aborted = false; this.set(1); }
      setRequestHeader(k, v) { k = String(k); this.rh[k] = this.rh[k] === undefined ? String(v) : this.rh[k] + ", " + v; }
      overrideMimeType() {}
      getResponseHeader(k) { return this.h[String(k).toLowerCase()] == null ? null : this.h[String(k).toLowerCase()]; }
      getAllResponseHeaders() { var h = this.h; return this.readyState < 2 ? "" : Object.keys(h).map(function (k) { return k + ": " + h[k]; }).join("\r\n") + (Object.keys(h).length ? "\r\n" : ""); }
      addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
      removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter(function (x) { return x !== f; }); }
      dispatchEvent(e) { this.emit(e.type, e); return true; }
      set(n) { this.readyState = n; this.emit("readystatechange"); }
      emit(t, ev) {
        var e = ev || { type: t, lengthComputable: false, loaded: 0, total: 0 };
        e.type = t; e.target = this; e.currentTarget = this;
        var h = this["on" + t];
        if (typeof h === "function") h.call(this, e);
        (this.l[t] || []).slice().forEach(function (f) { typeof f === "function" ? f.call(this, e) : f.handleEvent(e); }, this);
      }
      send(body) {
        var x = this, init = { method: x.m, headers: x.rh };
        if (body != null && x.m !== "GET" && x.m !== "HEAD") init.body = body;
        var done = false, timer = x.timeout > 0 ? setTimeout(function () { if (!done && !x.aborted) { done = true; x.readyState = 4; x.emit("readystatechange"); x.emit("timeout"); x.emit("loadend"); } }, x.timeout) : null;
        x.emit("loadstart");
        g.fetch(new g.URL(x.u, g.location.href).href, init).then(function (r) {
          if (done || x.aborted) return null;
          x.status = r.status; x.statusText = r.statusText || ""; x.responseURL = r.url || ""; r.headers.forEach(function (v, k) { x.h[k] = v; });
          x.set(2); x.set(3);
          return x.responseType === "arraybuffer" ? r.arrayBuffer() : x.responseType === "blob" ? r.blob() : r.text();
        }).then(function (t) {
          if (t === null || done || x.aborted) return;
          done = true; if (timer) clearTimeout(timer);
          if (x.responseType === "arraybuffer" || x.responseType === "blob") x.response = t;
          else {
            x.responseText = t;
            try { x.response = x.responseType === "json" ? JSON.parse(t) : t; } catch (e) { x.response = null; }
          }
          x.set(4); x.emit("load"); x.emit("loadend");
        }, function () {
          if (done || x.aborted) return;
          done = true; if (timer) clearTimeout(timer);
          x.set(4); x.emit("error"); x.emit("loadend");
        });
      }
      abort() {
        if (this.readyState === 0 || this.aborted) return;
        this.aborted = true; this.status = 0;
        if (this.readyState !== 4) { this.readyState = 4; this.emit("readystatechange"); this.emit("abort"); this.emit("loadend"); }
        this.readyState = 0;
      }
    };
    [["UNSENT", 0], ["OPENED", 1], ["HEADERS_RECEIVED", 2], ["LOADING", 3], ["DONE", 4]].forEach(function (e) { XHR[e[0]] = e[1]; XHR.prototype[e[0]] = e[1]; });
    return XHR;
  })();
})(globalThis);
