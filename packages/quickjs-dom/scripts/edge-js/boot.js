// Builds the page on the native DOM (csrc/nativedom*.h, scripts/edge-js/nativedom.js) and exposes the hooks the host
// drives (see src/index.ts). Runs after shims.js, the Web Streams polyfill and nativedom.js.
(function (g) {
  var done = new WeakSet(), list = [], current = null;

  g.__edgeBoot = function (html, url, width, seed) {
    g.__edgeStart(seed);
    var N = g.__native.dom;
    var d = N.parse(html), w = N.window;
    // the page's document is an HTML document (nativedom.js keeps the HTMLDocument prototype for this)
    if (w.HTMLDocument) Object.setPrototypeOf(d, w.HTMLDocument.prototype);
    // the window of the document is the global object itself: its event listeners are the nodes' own mechanism
    ["addEventListener", "removeEventListener", "dispatchEvent"].forEach(function (k) {
      Object.defineProperty(g, k, { configurable: true, writable: true, value: N.protos.Node[k] });
    });
    Object.defineProperty(d, "defaultView", { configurable: true, value: g });
    // cookies: a jar for the page's own use (nothing is sent anywhere)
    var jar = new Map();
    Object.defineProperty(d, "cookie", {
      configurable: true,
      get: function () { return Array.from(jar.entries()).map(function (e) { return e[0] + "=" + e[1]; }).join("; "); },
      set: function (v) {
        var parts = String(v).split(";"), kv = parts[0], i = kv.indexOf("=");
        var name = (i < 0 ? "" : kv.slice(0, i)).trim(), value = i < 0 ? kv.trim() : kv.slice(i + 1).trim();
        var expired = parts.slice(1).some(function (p) {
          var m = /^\s*(max-age|expires)\s*=\s*(.*)$/i.exec(p);
          return m && (m[1].toLowerCase() === "max-age" ? parseInt(m[2], 10) <= 0 : Date.parse(m[2]) < Date.now());
        });
        if (expired) jar.delete(name); else jar.set(name, value);
      },
    });
    // Markup is not given the html / head / body a browser adds, so these look for them and make what is missing
    // instead of answering null.
    var root = function () { return d.firstElementChild; };
    var section = function (tag) {
      var r = root(), el = r && (r.localName === tag ? r : null);
      if (el) return el;
      if (r) for (var c = r.firstElementChild; c; c = c.nextElementSibling) if (c.localName === tag) return c;
      el = r && r.querySelector(tag);
      if (el) return el;
      el = d.createElement(tag);
      if (!r) d.appendChild(el);
      else if (r.localName === "html") { if (tag === "head") r.insertBefore(el, r.firstChild); else r.appendChild(el); }
      else d.insertBefore(el, tag === "head" ? r : null);
      return el;
    };
    Object.defineProperty(d, "documentElement", { configurable: true, get: root });
    Object.defineProperty(d, "head", { configurable: true, get: function () { return section("head"); } });
    Object.defineProperty(d, "body", { configurable: true, get: function () { return section("body"); } });
    // the window's classes (nodes, events, DOMParser, ...) become globals
    Object.keys(w).forEach(function (k) {
      if (!(k in g)) Object.defineProperty(g, k, { configurable: true, writable: true, value: w[k] });
    });
    // DOMStringMap is a global too, but stays off the window table (nativedom.js explains why)
    if (N.DOMStringMapCtor && !("DOMStringMap" in g)) Object.defineProperty(g, "DOMStringMap", { configurable: true, writable: true, value: N.DOMStringMapCtor });
    g.document = d;
    ["window", "self", "top", "parent", "frames"].forEach(function (k) {
      Object.defineProperty(g, k, { configurable: true, writable: true, value: g });
    });

    // the location is a URL with the navigation methods tacked on; a Location prototype is inserted
    // between it and URL's, so it is an instance of both and the URL accessors keep working
    g.Location = function Location() { throw new TypeError("Illegal constructor"); };
    var loc = new g.URL(url);
    Object.setPrototypeOf(g.Location.prototype, Object.getPrototypeOf(loc));
    Object.setPrototypeOf(loc, g.Location.prototype);
    loc.assign = loc.replace = loc.reload = function () {};
    g.location = loc;
    // The window's singleton objects carry their interface prototypes, so instanceof and constructor lookups work
    var illegal = function () { throw new TypeError("Illegal constructor"); };
    g.Navigator = function Navigator() { illegal(); };
    g.navigator = Object.create(g.Navigator.prototype);
    Object.assign(g.navigator, { userAgent: "Mozilla/5.0 (compatible; wasm-html-to-image) AppleWebKit/537.36 Chrome/120.0", language: "en-US", languages: ["en-US"], platform: "Linux", hardwareConcurrency: 1, onLine: true, cookieEnabled: false });
    // pushState/replaceState move the location, as routers expect (no navigation happens)
    function moveTo(u) {
      if (u == null || u === "") return;
      var n = new g.URL(String(u), loc.href);
      ["protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin", "searchParams"].forEach(function (k) { loc[k] = n[k]; });
    }
    g.History = function History() { illegal(); };
    Object.assign(g.History.prototype, {
      pushState: function (s, t, u) { this.state = s; this.length++; moveTo(u); },
      replaceState: function (s, t, u) { this.state = s; moveTo(u); },
      back: function () {}, forward: function () {}, go: function () {},
    });
    g.history = Object.create(g.History.prototype);
    Object.assign(g.history, { state: null, length: 1, scrollRestoration: "auto" });
    g.Screen = function Screen() { illegal(); };
    g.screen = Object.create(g.Screen.prototype);
    Object.assign(g.screen, { width: width, height: Math.round(width * 0.75) });
    // the browser chrome bars, all visible as far as a page can tell, and the legacy external object
    g.BarProp = function BarProp() { illegal(); };
    ["locationbar", "menubar", "personalbar", "scrollbars", "statusbar", "toolbar"].forEach(function (k) {
      var bar = Object.create(g.BarProp.prototype);
      Object.defineProperty(bar, "visible", { value: true, enumerable: true });
      g[k] = bar;
    });
    g.External = function External() { illegal(); };
    g.external = Object.create(g.External.prototype);
    // the window's scalar properties a page reads: no scrolling, no frames, not framed itself
    g.pageXOffset = g.scrollX = g.pageYOffset = g.scrollY = 0;
    g.screenX = g.screenLeft = g.screenY = g.screenTop = 0;
    g.name = "";
    g.status = "";
    g.origin = loc.origin;
    g.frameElement = null;
    g.length = 0;
    g.event = undefined;
    g.innerWidth = g.outerWidth = width;
    g.innerHeight = g.outerHeight = Math.round(width * 0.75);
    g.devicePixelRatio = 1;
    g.scrollTo = g.scroll = g.scrollBy = function () {};

    // Media queries against this window: width / height features (px, em, rem), orientation, screen, and a light,
    // no-motion, hovering, fine-pointer user. Anything it does not know does not match.
    function mediaMatches(query) {
      var len = function (v) { var m = /^\s*(-?[0-9.]+)\s*(px|em|rem)?\s*$/.exec(v || ""); return m ? parseFloat(m[1]) * (m[2] && m[2] !== "px" ? 16 : 1) : NaN; };
      var one = function (part) {
        part = part.trim();
        var negate = /^not\s+/i.test(part);
        if (negate) part = part.replace(/^not\s+/i, "");
        var ok = part.split(/\s+and\s+/i).every(function (term) {
          term = term.trim();
          if (/^(all|screen)$/i.test(term)) return true;
          if (/^(print|speech)$/i.test(term)) return false;
          var m = /^\(\s*([a-z-]+)\s*(?::\s*([^)]*?))?\s*\)$/i.exec(term);
          if (!m) return false;
          var name = m[1].toLowerCase(), v = m[2], W = g.innerWidth, H = g.innerHeight;
          if (name === "min-width") return W >= len(v);
          if (name === "max-width") return W <= len(v);
          if (name === "width") return W === len(v);
          if (name === "min-height") return H >= len(v);
          if (name === "max-height") return H <= len(v);
          if (name === "height") return H === len(v);
          if (name === "orientation") return (W >= H ? "landscape" : "portrait") === (v || "").trim();
          if (name === "prefers-color-scheme") return (v || "").trim() === "light";
          if (name === "prefers-reduced-motion") return (v || "").trim() === "no-preference";
          if (name === "hover") return v == null || v.trim() === "hover";
          if (name === "pointer") return v == null || v.trim() === "fine";
          return false;
        });
        return negate ? !ok : ok;
      };
      return String(query).split(",").some(one);
    }
    g.matchMedia = function (q) {
      return { matches: mediaMatches(q), media: String(q), onchange: null, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } };
    };
    // The cascade is not computed: the element's own style, with the initial values a script usually asks about.
    var initial = { display: "block", visibility: "visible", opacity: "1", position: "static", overflow: "visible", "pointer-events": "auto", "z-index": "auto" };
    g.getComputedStyle = g.getComputedStyle || function (el) {
      var st = el.style || {};
      var get = function (name) {
        var v = typeof st.getPropertyValue === "function" ? st.getPropertyValue(name) : st[name];
        return v || initial[name] || "";
      };
      return new Proxy(st, {
        get: function (t, k) {
          if (k === "getPropertyValue") return get;
          if (typeof k !== "string") return t[k];
          var v = t[k];
          if (typeof v === "function") return v.bind(t);
          return v || initial[k.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); })] || (v === undefined ? undefined : "");
        },
      });
    };
    // Storage: an instance of its class, whose items also read, write and delete as properties (localStorage.theme = "x")
    var maps = new WeakMap();
    var Storage = function Storage() { throw new TypeError("Illegal constructor"); };
    var sp = Storage.prototype;
    var items = function (s) { return maps.get(s); };
    Object.defineProperties(sp, {
      getItem: { value: function getItem(k) { k = String(k); var m = items(this); return m.has(k) ? m.get(k) : null; }, writable: true, configurable: true },
      setItem: { value: function setItem(k, v) { items(this).set(String(k), String(v)); }, writable: true, configurable: true },
      removeItem: { value: function removeItem(k) { items(this).delete(String(k)); }, writable: true, configurable: true },
      clear: { value: function clear() { items(this).clear(); }, writable: true, configurable: true },
      key: { value: function key(i) { var ks = Array.from(items(this).keys()); return ks[i] === undefined ? null : ks[i]; }, writable: true, configurable: true },
      length: { get: function () { return items(this).size; }, configurable: true },
    });
    g.Storage = Storage;
    function storage() {
      var target = Object.create(sp);
      var data = new Map();
      maps.set(target, data);
      var proxy = new Proxy(target, {
        get: function (t, k, r) {
          if (typeof k !== "string" || k in t) return Reflect.get(t, k, t);
          var m = items(t);
          return m.has(k) ? m.get(k) : undefined;
        },
        set: function (t, k, v) { if (typeof k !== "string") return Reflect.set(t, k, v); items(t).set(k, String(v)); return true; },
        deleteProperty: function (t, k) { if (typeof k === "string") items(t).delete(k); return true; },
        has: function (t, k) { return k in t || (typeof k === "string" && items(t).has(k)); },
        ownKeys: function (t) { return Array.from(items(t).keys()); },
        getOwnPropertyDescriptor: function (t, k) {
          return typeof k === "string" && items(t).has(k) ? { value: items(t).get(k), writable: true, enumerable: true, configurable: true } : undefined;
        },
      });
      maps.set(proxy, data); // the methods are called with the proxy as this
      return proxy;
    }
    g.localStorage = storage();
    g.sessionStorage = storage();
    g.Image = function (width, height) {
      var i = d.createElement("img");
      if (width != null) i.setAttribute("width", width);
      if (height != null) i.setAttribute("height", height);
      return i;
    };
    d.fonts = d.fonts || { ready: Promise.resolve(), check: function () { return true; }, load: function () { return Promise.resolve([]); }, add: function () {}, forEach: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
    var state = "loading";
    Object.defineProperty(d, "readyState", { configurable: true, get: function () { return state; } });
    g.__edgeSetReady = function (s) { state = s; };
    // There is no scrolling and the page is meant to be seen whole, so everything is "intersecting" and lazy content
    // (infinite lists, images that load on view) gets its turn; like a browser, each observer reports once on observe().
    function observer(Name, entryOf) {
      var O = function (cb, opts) { this._cb = cb; this._seen = new Set(); this.root = (opts && opts.root) || null; this.rootMargin = (opts && opts.rootMargin) || "0px"; this.thresholds = [0]; };
      O.prototype.observe = function (el) {
        var self = this;
        if (this._seen.has(el)) return;
        this._seen.add(el);
        g.setTimeout(function () { if (self._seen.has(el)) self._cb.call(self, [entryOf(el)], self); }, 0);
      };
      O.prototype.unobserve = function (el) { this._seen.delete(el); };
      O.prototype.disconnect = function () { this._seen.clear(); };
      O.prototype.takeRecords = function () { return []; };
      Object.defineProperty(O, "name", { value: Name });
      return O;
    }
    var box = function (r) { return [{ inlineSize: r.width, blockSize: r.height }]; };
    if (!g.IntersectionObserver) {
      g.IntersectionObserver = observer("IntersectionObserver", function (el) {
        var r = el.getBoundingClientRect();
        return { target: el, isIntersecting: true, intersectionRatio: 1, boundingClientRect: r, intersectionRect: r, rootBounds: null, time: g.performance.now() };
      });
    }
    // the entry classes, which code feature-checks (`'intersectionRatio' in IntersectionObserverEntry.prototype`)
    if (!g.IntersectionObserverEntry) {
      g.IntersectionObserverEntry = function IntersectionObserverEntry() { throw new TypeError("Illegal constructor"); };
      ["time", "rootBounds", "boundingClientRect", "intersectionRect", "isIntersecting", "intersectionRatio", "target"].forEach(function (k) {
        Object.defineProperty(g.IntersectionObserverEntry.prototype, k, { configurable: true, enumerable: true, get: function () { return undefined; } });
      });
    }
    if (!g.ResizeObserverEntry) {
      g.ResizeObserverEntry = function ResizeObserverEntry() { throw new TypeError("Illegal constructor"); };
      ["target", "contentRect", "borderBoxSize", "contentBoxSize", "devicePixelContentBoxSize"].forEach(function (k) {
        Object.defineProperty(g.ResizeObserverEntry.prototype, k, { configurable: true, enumerable: true, get: function () { return undefined; } });
      });
    }
    if (!g.ResizeObserver) {
      g.ResizeObserver = observer("ResizeObserver", function (el) {
        var r = el.getBoundingClientRect();
        return { target: el, contentRect: r, borderBoxSize: box(r), contentBoxSize: box(r), devicePixelContentBoxSize: box(r) };
      });
    }
    // There is no WebSocket, EventSource or Worker here. Code that uses one should find out the way it does when the
    // connection fails (an `error` event, then closed) instead of dying on a ReferenceError, so these exist and fail.
    function unavailable(Name, init) {
      var C = class extends g.EventTarget {
        constructor(url) {
          super();
          if (arguments.length === 0) throw new TypeError("Failed to construct '" + Name + "': 1 argument required, but only 0 present.");
          var self = this;
          this.url = String(url);
          this.readyState = 0;
          init.call(this, arguments);
          g.console.warn(Name + " is not available in wasm-quickjs-dom (" + this.url + ")");
          g.setTimeout(function () {
            if (self.readyState === 3 || (Name === "EventSource" && self.readyState === 2)) return;
            self.readyState = Name === "EventSource" ? 2 : 3;
            self.__fire(new g.Event("error"));
            if (Name === "WebSocket") {
              var close = new g.Event("close");
              close.code = 1006;
              close.reason = "";
              close.wasClean = false;
              self.__fire(close);
            }
          }, 0);
        }
        __fire(event) {
          this.dispatchEvent(event);
        }
      };
      C.CONNECTING = C.prototype.CONNECTING = 0;
      Object.defineProperty(C, "name", { value: Name });
      return C;
    }
    if (!g.WebSocket) {
      g.WebSocket = unavailable("WebSocket", function () { this.bufferedAmount = 0; this.extensions = ""; this.protocol = ""; this.binaryType = "blob"; });
      g.WebSocket.OPEN = g.WebSocket.prototype.OPEN = 1;
      g.WebSocket.CLOSING = g.WebSocket.prototype.CLOSING = 2;
      g.WebSocket.CLOSED = g.WebSocket.prototype.CLOSED = 3;
      g.WebSocket.prototype.send = function () {
        if (this.readyState === 0) throw new g.DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", "InvalidStateError");
      };
      g.WebSocket.prototype.close = function () { this.readyState = 3; };
    }
    if (!g.EventSource) {
      g.EventSource = unavailable("EventSource", function (args) { this.withCredentials = !!(args[1] && args[1].withCredentials); });
      g.EventSource.OPEN = g.EventSource.prototype.OPEN = 1;
      g.EventSource.CLOSED = g.EventSource.prototype.CLOSED = 2;
      g.EventSource.prototype.close = function () { this.readyState = 2; };
    }
    ["Worker", "SharedWorker"].forEach(function (Name) {
      if (g[Name]) return;
      var W = unavailable(Name, function () { this.onmessage = null; this.onerror = null; this.port = this; });
      W.prototype.postMessage = function () {};
      W.prototype.terminate = function () {};
      W.prototype.start = function () {};
      g[Name] = W;
    });
    if (!g.BroadcastChannel) {
      g.BroadcastChannel = class extends g.EventTarget {
        constructor(name) { super(); this.name = String(name); this.onmessage = null; }
        postMessage() {}
        close() {}
      };
    }
    // more of the platform that scripts feature-detect or call and ignore the result of
    var AS = g.AbortSignal;
    if (AS && !AS.timeout) {
      AS.abort = function (reason) { var c = new g.AbortController(); c.abort(reason); return c.signal; };
      AS.timeout = function (ms) { var c = new g.AbortController(); setTimeout(function () { c.abort(new Error("The operation timed out.")); }, ms); return c.signal; };
      AS.any = function (signals) {
        var c = new g.AbortController();
        Array.from(signals).forEach(function (s) { if (s.aborted) c.abort(s.reason); else s.addEventListener("abort", function () { c.abort(s.reason); }); });
        return c.signal;
      };
    }
    if (!g.CSS) {
      g.CSS = {
        // the specification's serialize-an-identifier
        escape: function (v) {
          v = String(v);
          var out = "";
          for (var i = 0; i < v.length; i++) {
            var c = v.charCodeAt(i), ch = v.charAt(i);
            if (c === 0) out += "�";
            else if ((c >= 1 && c <= 31) || c === 127 || (i === 0 && c >= 48 && c <= 57) || (i === 1 && c >= 48 && c <= 57 && v.charCodeAt(0) === 45)) out += "\\" + c.toString(16) + " ";
            else if (i === 0 && c === 45 && v.length === 1) out += "\\" + ch;
            else if (c >= 128 || c === 45 || c === 95 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) out += ch;
            else out += "\\" + ch;
          }
          return out;
        },
        supports: function () { return true; },
        registerProperty: function () {},
        px: function (n) { return { value: n, unit: "px", toString: function () { return n + "px"; } }; },
      };
    }
    // geometry interfaces: DOMRect, DOMPoint, DOMMatrix (column-major 4x4, as the specification's m11..m44)
    if (!g.DOMRect) {
      var rectBase = function (C, writable) {
        C.prototype.toJSON = function () { return { x: this.x, y: this.y, width: this.width, height: this.height, top: this.top, right: this.right, bottom: this.bottom, left: this.left }; };
        ["top", "left", "right", "bottom"].forEach(function (k) {
          Object.defineProperty(C.prototype, k, { get: function () {
            var x = this.x, y = this.y, w = this.width, h = this.height;
            return k === "top" ? Math.min(y, y + h) : k === "left" ? Math.min(x, x + w) : k === "right" ? Math.max(x, x + w) : Math.max(y, y + h);
          }, configurable: true });
        });
      };
      g.DOMRectReadOnly = class DOMRectReadOnly {
        constructor(x, y, w, h) { this._r = [+x || 0, +y || 0, +w || 0, +h || 0]; }
        get x() { return this._r[0]; } get y() { return this._r[1]; } get width() { return this._r[2]; } get height() { return this._r[3]; }
        static fromRect(o) { o = o || {}; return new this(o.x, o.y, o.width, o.height); }
      };
      g.DOMRect = class DOMRect extends g.DOMRectReadOnly {
        get x() { return this._r[0]; } set x(v) { this._r[0] = +v || 0; }
        get y() { return this._r[1]; } set y(v) { this._r[1] = +v || 0; }
        get width() { return this._r[2]; } set width(v) { this._r[2] = +v || 0; }
        get height() { return this._r[3]; } set height(v) { this._r[3] = +v || 0; }
      };
      rectBase(g.DOMRectReadOnly);
      g.DOMPointReadOnly = class DOMPointReadOnly {
        constructor(x, y, z, w) { this.x = +x || 0; this.y = +y || 0; this.z = +z || 0; this.w = w === undefined ? 1 : +w; }
        static fromPoint(o) { o = o || {}; return new this(o.x, o.y, o.z, o.w); }
        matrixTransform(m) { return m.transformPoint(this); }
        toJSON() { return { x: this.x, y: this.y, z: this.z, w: this.w }; }
      };
      g.DOMPoint = class DOMPoint extends g.DOMPointReadOnly {};
      var identity = function () { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
      var mul = function (a, b) { // a * b, column-major
        var o = new Array(16);
        for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
        return o;
      };
      var parseTransform = function (text) {
        var m = identity(), re = /([a-z0-9]+)\(([^)]*)\)/gi, t;
        text = String(text).trim();
        if (text === "" || text === "none") return m;
        while ((t = re.exec(text))) {
          var n = t[1].toLowerCase(), a = t[2].split(",").map(function (x) { return parseFloat(x); }), f = identity();
          var rad = function (v, u) { return /rad/.test(u) ? v : /turn/.test(u) ? v * 2 * Math.PI : /grad/.test(u) ? v * Math.PI / 200 : v * Math.PI / 180; };
          if (n === "matrix" && a.length === 6) f = [a[0], a[1], 0, 0, a[2], a[3], 0, 0, 0, 0, 1, 0, a[4], a[5], 0, 1];
          else if (n === "matrix3d" && a.length === 16) f = a;
          else if (n === "translate" || n === "translate3d") { f[12] = a[0] || 0; f[13] = a[1] || 0; f[14] = a[2] || 0; }
          else if (n === "translatex") f[12] = a[0] || 0;
          else if (n === "translatey") f[13] = a[0] || 0;
          else if (n === "scale" || n === "scale3d") { f[0] = a[0]; f[5] = a.length > 1 ? a[1] : a[0]; f[10] = a.length > 2 ? a[2] : 1; }
          else if (n === "scalex") f[0] = a[0];
          else if (n === "scaley") f[5] = a[0];
          else if (n === "rotate" || n === "rotatez") { var r = rad(a[0], t[2]); f[0] = Math.cos(r); f[1] = Math.sin(r); f[4] = -Math.sin(r); f[5] = Math.cos(r); }
          else if (n === "skewx") f[4] = Math.tan(rad(a[0], t[2]));
          else if (n === "skewy") f[1] = Math.tan(rad(a[0], t[2]));
          else throw new SyntaxError("Failed to parse '" + text + "' as a transform list.");
          m = mul(m, f);
        }
        return m;
      };
      var names = ["m11", "m12", "m13", "m14", "m21", "m22", "m23", "m24", "m31", "m32", "m33", "m34", "m41", "m42", "m43", "m44"];
      var alias = { a: "m11", b: "m12", c: "m21", d: "m22", e: "m41", f: "m42" };
      g.DOMMatrixReadOnly = class DOMMatrixReadOnly {
        constructor(init) {
          var v = typeof init === "string" ? parseTransform(init) : Array.isArray(init) || (init && typeof init.length === "number") ? (init.length === 6 ? [init[0], init[1], 0, 0, init[2], init[3], 0, 0, 0, 0, 1, 0, init[4], init[5], 0, 1] : Array.prototype.slice.call(init)) : identity();
          Object.defineProperty(this, "_m", { value: v.length === 16 ? v.map(Number) : identity(), writable: true });
        }
        get is2D() { var m = this._m; return !(m[2] || m[3] || m[6] || m[7] || m[8] || m[9] || m[11] || m[14]) && m[10] === 1 && m[15] === 1; }
        get isIdentity() { var m = this._m, i = identity(); return m.every(function (x, k) { return x === i[k]; }); }
        static fromMatrix(o) { return new this(o && o._m ? o._m : [o.a, o.b, o.c, o.d, o.e, o.f]); }
        multiply(o) { return new g.DOMMatrix(mul(this._m, new g.DOMMatrix(o && o._m ? o._m : o)._m)); }
        translate(x, y, z) { var f = identity(); f[12] = x || 0; f[13] = y || 0; f[14] = z || 0; return new g.DOMMatrix(mul(this._m, f)); }
        scale(sx, sy, sz) { var f = identity(); f[0] = sx === undefined ? 1 : sx; f[5] = sy === undefined ? f[0] : sy; f[10] = sz === undefined ? 1 : sz; return new g.DOMMatrix(mul(this._m, f)); }
        rotate(deg) { var r = (deg || 0) * Math.PI / 180, f = identity(); f[0] = Math.cos(r); f[1] = Math.sin(r); f[4] = -Math.sin(r); f[5] = Math.cos(r); return new g.DOMMatrix(mul(this._m, f)); }
        inverse() {
          var m = this._m, det = m[0] * m[5] - m[1] * m[4];
          if (!this.is2D || det === 0) return new g.DOMMatrix([NaN, NaN, NaN, NaN, NaN, NaN]);
          return new g.DOMMatrix([m[5] / det, -m[1] / det, -m[4] / det, m[0] / det, (m[4] * m[13] - m[5] * m[12]) / det, (m[1] * m[12] - m[0] * m[13]) / det]);
        }
        transformPoint(p) {
          p = p || {}; var m = this._m, x = p.x || 0, y = p.y || 0, z = p.z || 0, w = p.w === undefined ? 1 : p.w;
          return new g.DOMPoint(m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w);
        }
        toFloat32Array() { return new Float32Array(this._m); }
        toFloat64Array() { return new Float64Array(this._m); }
        toJSON() { var o = { is2D: this.is2D, isIdentity: this.isIdentity }, m = this; names.forEach(function (n) { o[n] = m[n]; }); Object.keys(alias).forEach(function (k) { o[k] = m[k]; }); return o; }
        toString() { var m = this._m; return this.is2D ? "matrix(" + [m[0], m[1], m[4], m[5], m[12], m[13]].join(", ") + ")" : "matrix3d(" + m.join(", ") + ")"; }
      };
      names.forEach(function (n, i) {
        Object.defineProperty(g.DOMMatrixReadOnly.prototype, n, { get: function () { return this._m[i]; }, configurable: true });
      });
      Object.keys(alias).forEach(function (k) {
        var i = names.indexOf(alias[k]);
        Object.defineProperty(g.DOMMatrixReadOnly.prototype, k, { get: function () { return this._m[i]; }, configurable: true });
      });
      g.DOMMatrix = class DOMMatrix extends g.DOMMatrixReadOnly {};
      names.forEach(function (n, i) {
        Object.defineProperty(g.DOMMatrix.prototype, n, { get: function () { return this._m[i]; }, set: function (v) { this._m[i] = +v || 0; }, configurable: true });
      });
      Object.keys(alias).forEach(function (k) {
        var i = names.indexOf(alias[k]);
        Object.defineProperty(g.DOMMatrix.prototype, k, { get: function () { return this._m[i]; }, set: function (v) { this._m[i] = +v || 0; }, configurable: true });
      });
      ["multiply", "translate", "scale", "rotate"].forEach(function (op) {
        g.DOMMatrix.prototype[op + "Self"] = function () { this._m = g.DOMMatrixReadOnly.prototype[op].apply(this, arguments)._m; return this; };
      });
      g.DOMMatrix.prototype.invertSelf = function () { this._m = this.inverse()._m; return this; };
      g.WebKitCSSMatrix = g.DOMMatrix;
    }
    if (!g.PerformanceObserver) {
      g.PerformanceObserver = class PerformanceObserver {
        constructor(cb) { this._cb = cb; }
        observe() {}
        disconnect() {}
        takeRecords() { return []; }
        static get supportedEntryTypes() { return []; }
      };
    }
    if (!g.MessageChannel) {
      g.MessageChannel = class MessageChannel {
        constructor() {
          var mk = function () { var p = new g.EventTarget(); p.onmessage = null; p.start = function () {}; p.close = function () {}; return p; };
          var a = mk(), b = mk();
          var link = function (from, to) {
            from.postMessage = function (data) {
              setTimeout(function () {
                var ev = new g.Event("message"); ev.data = data;
                if (typeof to.onmessage === "function") to.onmessage(ev);
                to.dispatchEvent(ev);
              }, 0);
            };
          };
          link(a, b); link(b, a);
          this.port1 = a; this.port2 = b;
        }
      };
    }
    if (!g.Performance) g.Performance = function Performance() { throw new TypeError("Illegal constructor"); };
    if (g.performance) Object.setPrototypeOf(g.performance, g.Performance.prototype);
    if (g.performance && !g.performance.timing) {
      g.performance.timing = { navigationStart: g.performance.timeOrigin, fetchStart: g.performance.timeOrigin, responseStart: g.performance.timeOrigin, domLoading: g.performance.timeOrigin, domInteractive: g.performance.timeOrigin, domContentLoadedEventStart: g.performance.timeOrigin, domContentLoadedEventEnd: g.performance.timeOrigin, loadEventStart: 0, loadEventEnd: 0 };
      g.performance.navigation = { type: 0, redirectCount: 0 };
      g.performance.toJSON = function () { return {}; };
    }
    if (!g.navigator.sendBeacon) g.navigator.sendBeacon = function () { return true; };
    if (!g.navigator.storage) g.navigator.storage = { estimate: function () { return Promise.resolve({ quota: 0, usage: 0 }); }, persist: function () { return Promise.resolve(false); }, persisted: function () { return Promise.resolve(false); } };
    if (!g.navigator.clipboard) g.navigator.clipboard = { writeText: function () { return Promise.resolve(); }, readText: function () { return Promise.reject(new g.DOMException("Read permission denied.", "NotAllowedError")); } };
    if (!("webdriver" in g.navigator)) g.navigator.webdriver = false;
    if (!("doNotTrack" in g.navigator)) g.navigator.doNotTrack = null;
    if (!("vendor" in g.navigator)) { g.navigator.vendor = "Google Inc."; g.navigator.appVersion = "5.0 (X11)"; g.navigator.maxTouchPoints = 0; g.navigator.pdfViewerEnabled = false; }
    if (!d.timeline) d.timeline = { get currentTime() { return g.performance.now(); } };
    if (!d.getElementsByName) d.getElementsByName = function (n) { return d.querySelectorAll('[name="' + n + '"]'); };

    // URL-valued properties read back absolute, as in a browser (framework code does `new URL(script.src)`)
    [["script", "src"], ["img", "src"], ["link", "href"], ["a", "href"], ["iframe", "src"]].forEach(function (pair) {
      var P = Object.getPrototypeOf(d.createElement(pair[0])), prop = pair[1];
      while (P && !Object.getOwnPropertyDescriptor(P, prop)) P = Object.getPrototypeOf(P);
      P = P || Object.getPrototypeOf(d.createElement(pair[0]));
      Object.defineProperty(P, prop, {
        configurable: true,
        get: function () {
          var v = this.getAttribute(prop);
          if (v == null) return "";
          try { return new g.URL(v, g.location.href).href; } catch (e) { return v; }
        },
        set: function (v) { this.setAttribute(prop, v); },
      });
    });

    Object.defineProperty(d, "currentScript", { configurable: true, get: function () { return current; } });

    // the small document members that scripts read without a second thought
    var docProps = {
      referrer: "", hidden: false, visibilityState: "visible", characterSet: "UTF-8", charset: "UTF-8", inputEncoding: "UTF-8",
      compatMode: "CSS1Compat", contentType: "text/html", designMode: "off", dir: "", lastModified: "01/01/2024 00:00:00",
    };
    Object.keys(docProps).forEach(function (k) {
      if (!(k in d)) Object.defineProperty(d, k, { configurable: true, writable: true, value: docProps[k] });
    });
    [["location", function () { return g.location; }], ["URL", function () { return g.location.href; }], ["documentURI", function () { return g.location.href; }], ["baseURI", function () { return g.location.href; }],
     ["domain", function () { return g.location.hostname; }], ["activeElement", function () { return d.body; }],
     ["scrollingElement", function () { return d.documentElement; }], ["forms", function () { return d.getElementsByTagName("form"); }],
     ["images", function () { return d.getElementsByTagName("img"); }], ["links", function () { return d.querySelectorAll("a[href], area[href]"); }],
     ["scripts", function () { return d.getElementsByTagName("script"); }], ["all", function () { return d.getElementsByTagName("*"); }]].forEach(function (p) {
      if (!(p[0] in d)) Object.defineProperty(d, p[0], { configurable: true, get: p[1] });
    });
    var more = {
      hasFocus: function () { return true; },
      createEvent: function (type) { var C = /mouse/i.test(type) ? g.MouseEvent : /key/i.test(type) ? g.KeyboardEvent : /custom/i.test(type) ? g.CustomEvent : g.Event; var e = new C("x"); e.initEvent = function (t, b, c) { e.type = String(t); e.bubbles = !!b; e.cancelable = !!c; }; e.initCustomEvent = function (t, b, c, det) { e.initEvent(t, b, c); e.detail = det; }; return e; },
      elementFromPoint: function () { return null; },
      elementsFromPoint: function () { return []; },
      getSelection: function () { return g.getSelection(); },
      createRange: function () {
        var range = { startContainer: d, endContainer: d, startOffset: 0, endOffset: 0, collapsed: true, commonAncestorContainer: d };
        ["setStart", "setEnd", "setStartBefore", "setStartAfter", "setEndBefore", "setEndAfter", "selectNode", "selectNodeContents", "collapse", "detach", "deleteContents"].forEach(function (m) { range[m] = function () {}; });
        range.getBoundingClientRect = function () { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; };
        range.getClientRects = function () { return []; };
        range.createContextualFragment = function (html) { return g.__native.dom.parseFragment(String(html), d); };
        range.cloneContents = function () { return d.createDocumentFragment(); };
        range.toString = function () { return ""; };
        return range;
      },
    };
    Object.keys(more).forEach(function (k) { if (!(k in d)) Object.defineProperty(d, k, { configurable: true, writable: true, value: more[k] }); });
    g.getSelection = g.getSelection || function () {
      return { rangeCount: 0, isCollapsed: true, anchorNode: null, focusNode: null, type: "None", toString: function () { return ""; },
        removeAllRanges: function () {}, addRange: function () {}, getRangeAt: function () { return d.createRange(); }, collapse: function () {}, empty: function () {} };
    };
    // canvas has no drawing here: a context is not available, which is what code feature-checks for; the value classes exist
    if (!g.Path2D) {
      g.Path2D = class Path2D {
        constructor(d) { this._d = d instanceof Path2D ? d._d : typeof d === "string" ? d : ""; }
        addPath(p) { this._d += " " + p._d; }
      };
      ["moveTo", "lineTo", "bezierCurveTo", "quadraticCurveTo", "arc", "arcTo", "ellipse", "rect", "roundRect", "closePath"].forEach(function (m) { g.Path2D.prototype[m] = function () {}; });
    }
    if (!g.ImageData) {
      g.ImageData = class ImageData {
        constructor(a, b, c) {
          if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
          else { this.data = a; this.width = b; this.height = c || a.length / 4 / b; }
          this.colorSpace = "srgb";
        }
      };
    }
    if (!g.OffscreenCanvas) {
      g.OffscreenCanvas = class OffscreenCanvas {
        constructor(w, h) { this.width = w; this.height = h; }
        getContext() { return null; }
        convertToBlob() { return Promise.reject(new Error("OffscreenCanvas has no drawing here")); }
      };
    }
    var canvasProto = g.__native.dom.protos.HTMLCanvasElement;
    if (canvasProto) {
      Object.defineProperty(canvasProto, "getContext", { configurable: true, writable: true, value: function () { return null; } });
      Object.defineProperty(canvasProto, "toDataURL", { configurable: true, writable: true, value: function () { return "data:,"; } });
      Object.defineProperty(canvasProto, "toBlob", { configurable: true, writable: true, value: function (cb) { if (typeof cb === "function") g.setTimeout(function () { cb(null); }, 0); } });
      ["width", "height"].forEach(function (k, i) {
        Object.defineProperty(canvasProto, k, {
          configurable: true,
          get: function () { var v = parseInt(this.getAttribute(k), 10); return v >= 0 ? v : (i ? 150 : 300); },
          set: function (v) { this.setAttribute(k, String(v)); },
        });
      });
    }
  };

  // the scripts not run yet, in document order; dynamically added ones show up on the next call
  g.__edgeNextScripts = function () {
    var out = [], all = g.document.querySelectorAll("script");
    for (var i = 0; i < all.length; i++) {
      var s = all[i];
      if (done.has(s)) continue;
      done.add(s);
      var type = (s.getAttribute("type") || "").toLowerCase();
      if (type === "importmap") {
        out.push({ idx: list.push(s) - 1, src: null, text: s.textContent, importmap: true });
        continue;
      }
      // legacy-browser polyfills are marked `nomodule`; linkedom keeps the attribute name's case (`noModule`)
      if (s.hasAttribute("nomodule") || s.hasAttribute("noModule") || (type && type !== "module" && type !== "text/javascript" && type !== "application/javascript")) continue;
      var src = s.getAttribute("src");
      out.push({ idx: list.push(s) - 1, src: src, text: src ? "" : s.textContent, module: type === "module" });
    }
    return JSON.stringify(out);
  };
  g.__edgeSetCurrent = function (i) { current = i < 0 ? null : list[i]; };
  g.__edgeScriptEvent = function (i, ok) {
    var s = list[i], e = new g.Event(ok ? "load" : "error");
    try {
      s.dispatchEvent(e);
    } catch (x) { __host.log("error", "load handler: " + (x && x.message ? x.name + ": " + x.message + " " + (x.stack || "") : String(x))); }
  };
  g.__edgeDocumentEvents = function () {
    g.__edgeSetReady("interactive");
    g.document.dispatchEvent(new g.Event("DOMContentLoaded"));
    g.__edgeSetReady("complete");
    g.document.defaultView.dispatchEvent(new g.Event("load"));
  };
  g.__edgeHas = function (selector) { return !!g.document.querySelector(selector); };
  g.__edgeSerialize = function () {
    var d = g.document, n = d.querySelectorAll("noscript");
    for (var i = 0; i < n.length; i++) n[i].remove();
    var html = g.__native.dom.serialize(d);
    return html.replace(/^<!DOCTYPE\s*(?:html)?\s*>/i, "<!DOCTYPE html>");
  };

  // Layout: there is none in here, so the host lays the page out elsewhere and hands the boxes back.
  // __edgeMarkLayout() numbers every element (document order) and returns the page as HTML in which each element's
  // class starts with `qjsl-<number>`, so a layout engine's boxes (which report `class`) find their elements however
  // it re-parses the markup. The marks are on a clone: the page itself is not touched, no observer sees anything.
  var boxes = null;
  g.__edgeMarkLayout = function () {
    // the whole document is cloned: for markup without <html> its "documentElement" is only the first element
    var d = g.document, clone = d.cloneNode(true);
    var a = Array.prototype.slice.call(d.querySelectorAll("*")), b = Array.prototype.slice.call(clone.querySelectorAll("*"));
    boxes = null;
    for (var i = 0; i < a.length && i < b.length; i++) {
      a[i].__qi = i;
      var had = b[i].getAttribute("class");
      b[i].setAttribute("class", "qjsl-" + i + (had ? " " + had : ""));
    }
    var n = clone.querySelectorAll("noscript");
    for (var j = 0; j < n.length; j++) n[j].remove();
    var html = g.__native.dom.serialize(clone);
    return /^<!DOCTYPE/i.test(html) ? html.replace(/^<!DOCTYPE\s*(?:html)?\s*>/i, "<!DOCTYPE html>") : "<!DOCTYPE html>" + html;
  };
  // boxes: { "<number>": [x, y, width, height] } in page coordinates; an element without a box is 0 x 0
  g.__edgeSetLayout = function (json) {
    boxes = JSON.parse(json);
    var P = g.Element.prototype;
    var box = function (el) { return (boxes && el.__qi !== undefined && boxes[el.__qi]) || [0, 0, 0, 0]; };
    var def = function (name, get) { Object.defineProperty(P, name, { configurable: true, get: get }); };
    var rect = function (el) {
      var b = box(el);
      return { x: b[0], y: b[1], width: b[2], height: b[3], top: b[1], left: b[0], right: b[0] + b[2], bottom: b[1] + b[3],
        toJSON: function () { return { x: this.x, y: this.y, width: this.width, height: this.height, top: this.top, left: this.left, right: this.right, bottom: this.bottom }; } };
    };
    Object.defineProperty(P, "getBoundingClientRect", { configurable: true, writable: true, value: function () { return rect(this); } });
    Object.defineProperty(P, "getClientRects", { configurable: true, writable: true, value: function () { var b = box(this); return b[2] || b[3] ? [rect(this)] : []; } });
    def("offsetWidth", function () { return Math.round(box(this)[2]); });
    def("offsetHeight", function () { return Math.round(box(this)[3]); });
    def("offsetLeft", function () { return Math.round(box(this)[0]); });
    def("offsetTop", function () { return Math.round(box(this)[1]); });
    def("clientWidth", function () { return Math.round(box(this)[2]); });
    def("clientHeight", function () { return Math.round(box(this)[3]); });
    def("scrollWidth", function () { return Math.round(box(this)[2]); });
    def("scrollHeight", function () { return Math.round(box(this)[3]); });
  };
})(globalThis);
