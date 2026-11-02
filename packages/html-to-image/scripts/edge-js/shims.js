// Browser-ish globals that a bare QuickJS context lacks. Runs first, as a plain script.
// Timers and fetch call out to the host through `__host` (see src/edge-js.ts).
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

  // the one use in linkedom is number formatting without grouping
  if (!g.Intl) {
    g.Intl = {
      NumberFormat: class {
        constructor(l, o) { this.max = o && o.maximumFractionDigits != null ? o.maximumFractionDigits : 3; }
        format(n) { return String(+Number(n).toFixed(this.max)); }
      },
    };
  }
  if (!g.DOMException) {
    g.DOMException = class DOMException extends Error {
      constructor(m, n) { super(m || ""); this.name = n || "Error"; this.code = 0; }
    };
  }
  if (!g.queueMicrotask) g.queueMicrotask = function (fn) { Promise.resolve().then(fn); };
  g.performance = g.performance || { now: function () { return Date.now() - t0; }, timeOrigin: t0 };

  // timers: the host sleeps, then calls __fire(id)
  var tid = 1, timers = new Map();
  g.setTimeout = function (fn, ms) { var id = tid++; timers.set(id, { fn: fn, args: Array.prototype.slice.call(arguments, 2), rep: 0 }); __host.timer(id, +ms || 0); return id; };
  g.setInterval = function (fn, ms) { var id = tid++; timers.set(id, { fn: fn, args: Array.prototype.slice.call(arguments, 2), rep: +ms || 1 }); __host.timer(id, +ms || 1); return id; };
  g.clearTimeout = g.clearInterval = function (id) { timers.delete(id); };
  g.setImmediate = function (fn) { return g.setTimeout.apply(g, [fn, 0].concat(Array.prototype.slice.call(arguments, 1))); };
  g.clearImmediate = g.clearTimeout;
  g.requestAnimationFrame = function (fn) { return g.setTimeout(function () { fn(g.performance.now()); }, 16); };
  g.cancelAnimationFrame = g.clearTimeout;
  g.requestIdleCallback = function (fn) { return g.setTimeout(function () { fn({ didTimeout: false, timeRemaining: function () { return 10; } }); }, 1); };
  g.__fire = function (id) {
    var t = timers.get(id);
    if (!t) return;
    if (t.rep) __host.timer(id, t.rep); else timers.delete(id);
    try { t.fn.apply(null, t.args); } catch (e) { __host.log("error", "timer: " + ((e && e.stack) || e)); }
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
          var bb = new g.URL(b);
          if (u.startsWith("//")) u = bb.protocol + u;
          else if (u.startsWith("/")) u = bb.origin + u;
          else if (u.startsWith("?") || u.startsWith("#")) u = bb.origin + bb.pathname + (u.startsWith("#") ? bb.search : "") + u;
          else u = bb.origin + bb.pathname.replace(/[^/]*$/, "") + u;
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
    return __host.fetch(String((input && input.url) || input), (init && init.method) || "GET")
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
  g.XMLHttpRequest = g.XMLHttpRequest || class {
    constructor() { this.readyState = 0; this.status = 0; this.statusText = ""; this.responseText = ""; this.response = null; this.responseType = ""; this.l = {}; this.h = {}; }
    open(m, u) { this.m = m; this.u = u; this.set(1); }
    setRequestHeader() {}
    getResponseHeader(k) { return this.h[String(k).toLowerCase()] == null ? null : this.h[String(k).toLowerCase()]; }
    getAllResponseHeaders() { var h = this.h; return Object.keys(h).map(function (k) { return k + ": " + h[k]; }).join("\r\n"); }
    addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
    removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter(function (x) { return x !== f; }); }
    set(n) { this.readyState = n; this.emit("readystatechange"); }
    emit(t) {
      var e = { type: t, target: this }, h = this["on" + t];
      if (typeof h === "function") h.call(this, e);
      (this.l[t] || []).forEach(function (f) { f.call(this, e); }, this);
    }
    send() {
      var x = this;
      g.fetch(new g.URL(x.u, g.location.href).href, { method: x.m }).then(function (r) {
        x.status = r.status; x.statusText = r.statusText; r.headers.forEach(function (v, k) { x.h[k] = v; });
        return r.text();
      }).then(function (t) {
        x.responseText = t; x.response = x.responseType === "json" ? JSON.parse(t) : t;
        x.set(4); x.emit("load"); x.emit("loadend");
      }, function () { x.set(4); x.emit("error"); x.emit("loadend"); });
    }
    abort() {}
  };
})(globalThis);
