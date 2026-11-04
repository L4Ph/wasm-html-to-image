// Builds the page on the native DOM (csrc/nativedom*.h, scripts/edge-js/nativedom.js) and exposes the hooks the host
// drives (see src/index.ts). Runs after shims.js, the Web Streams polyfill, nativedom.js and computed.js.
(function (g) {
  var illegal = function () { throw new TypeError("Illegal constructor"); };

  // ==========================================
  // 1. Static Web APIs (evaluated once into WASM snapshot)
  // ==========================================
  var N = (g.__native && g.__native.dom) || {};
  var w = N.window || {};

  // Copy window classes from nativedom.js to globals
  Object.keys(w).forEach(function (k) {
    if (!(k in g)) Object.defineProperty(g, k, { configurable: true, writable: true, value: w[k] });
  });
  if (N.DOMStringMapCtor && !("DOMStringMap" in g)) Object.defineProperty(g, "DOMStringMap", { configurable: true, writable: true, value: N.DOMStringMapCtor });
  if (N.CSSStyleDeclarationCtor && !("CSSStyleDeclaration" in g)) Object.defineProperty(g, "CSSStyleDeclaration", { configurable: true, writable: true, value: N.CSSStyleDeclarationCtor });
  if (N.svgValueCtors) for (var vk in N.svgValueCtors) if (!(vk in g)) Object.defineProperty(g, vk, { configurable: true, writable: true, value: N.svgValueCtors[vk] });

  // Navigator and Plugin interfaces
  g.Navigator = function Navigator() { illegal(); };
  g.Plugin = function Plugin() { illegal(); };
  g.MimeType = function MimeType() { illegal(); };
  g.PluginArray = function PluginArray() { illegal(); };
  g.MimeTypeArray = function MimeTypeArray() { illegal(); };
  Object.assign(g.PluginArray.prototype, { item: function () { return null; }, namedItem: function () { return null; }, refresh: function () {} });
  Object.assign(g.MimeTypeArray.prototype, { item: function () { return null; }, namedItem: function () { return null; } });

  // History, Screen, BarProp, External, Location constructors
  g.Location = function Location() { throw new TypeError("Illegal constructor"); };
  g.History = function History() { illegal(); };
  Object.assign(g.History.prototype, {
    pushState: function (s, t, u) { this.state = s; this.length++; this._moveTo?.(u); },
    replaceState: function (s, t, u) { this.state = s; this._moveTo?.(u); },
    back: function () {}, forward: function () {}, go: function () {},
  });
  g.Screen = function Screen() { illegal(); };
  g.BarProp = function BarProp() { illegal(); };
  g.External = function External() { illegal(); };

  // Crypto constructor
  if (g.crypto && !g.Crypto) {
    g.Crypto = function Crypto() { throw new TypeError("Illegal constructor"); };
    Object.setPrototypeOf(g.crypto, g.Crypto.prototype);
  }

  // Storage
  var storageMaps = new WeakMap();
  var Storage = function Storage() { throw new TypeError("Illegal constructor"); };
  var sp = Storage.prototype;
  var storageItems = function (s) { return storageMaps.get(s); };
  Object.defineProperties(sp, {
    getItem: { value: function getItem(k) { k = String(k); var m = storageItems(this); return m.has(k) ? m.get(k) : null; }, writable: true, configurable: true },
    setItem: { value: function setItem(k, v) { storageItems(this).set(String(k), String(v)); }, writable: true, configurable: true },
    removeItem: { value: function removeItem(k) { storageItems(this).delete(String(k)); }, writable: true, configurable: true },
    clear: { value: function clear() { storageItems(this).clear(); }, writable: true, configurable: true },
    key: { value: function key(i) { var ks = Array.from(storageItems(this).keys()); return ks[i] === undefined ? null : ks[i]; }, writable: true, configurable: true },
    length: { get: function () { return storageItems(this).size; }, configurable: true },
  });
  g.Storage = Storage;
  function createStorage() {
    var target = Object.create(sp);
    var data = new Map();
    storageMaps.set(target, data);
    var proxy = new Proxy(target, {
      get: function (t, k, r) {
        if (typeof k !== "string" || k in t) return Reflect.get(t, k, t);
        var m = storageItems(t);
        return m.has(k) ? m.get(k) : undefined;
      },
      set: function (t, k, v) { if (typeof k !== "string") return Reflect.set(t, k, v); storageItems(t).set(k, String(v)); return true; },
      deleteProperty: function (t, k) { if (typeof k === "string") storageItems(t).delete(k); return true; },
      has: function (t, k) { return k in t || (typeof k === "string" && storageItems(t).has(k)); },
      ownKeys: function (t) { return Array.from(storageItems(t).keys()); },
      getOwnPropertyDescriptor: function (t, k) {
        return typeof k === "string" && storageItems(t).has(k) ? { value: storageItems(t).get(k), writable: true, enumerable: true, configurable: true } : undefined;
      },
    });
    storageMaps.set(proxy, data);
    return proxy;
  }

  // Observers
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
  var observerBox = function (r) { return [{ inlineSize: r.width, blockSize: r.height }]; };
  if (!g.IntersectionObserver) {
    g.IntersectionObserver = observer("IntersectionObserver", function (el) {
      var r = el.getBoundingClientRect();
      return { target: el, isIntersecting: true, intersectionRatio: 1, boundingClientRect: r, intersectionRect: r, rootBounds: null, time: g.performance.now() };
    });
  }
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
      return { target: el, contentRect: r, borderBoxSize: observerBox(r), contentBoxSize: observerBox(r), devicePixelContentBoxSize: observerBox(r) };
    });
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

  // Network / worker stubs (fail gracefully)
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
          // the constructor already warned; the failure that follows is a separate line in the log,
          // so a page that only sees the error/close handlers still leaves a trace of why
          if (g.console && g.console.warn) g.console.warn(Name + " closed with an error; network and worker APIs are not available in wasm-quickjs-dom (" + self.url + ")");
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

  // AbortSignal additions
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

  // CSS
  if (!g.CSS) {
    // CSS.supports: the property names litehtml knows (its string_id.h), checked the way stylesheet.cpp evaluates
    // @supports. The value grammar is NOT checked: like litehtml's "property ID means supported" shortcut, any
    // non-empty value of a known property answers true. TODO: mirror style::add_property for values as well.
    // computed.js asks this same function for @supports, so a style sheet and a script agree.
    var SUPPORTS_PROPS = Object.create(null);
    ("background background-color background-image background-image-baseurl background-repeat background-origin background-clip background-attachment background-size background-position background-position-x background-position-y background-gradient border border-width border-style border-color border-spacing litehtml-border-spacing-x litehtml-border-spacing-y border-top border-right border-bottom border-left border-top-style border-right-style border-bottom-style border-left-style border-top-width border-right-width border-bottom-width border-left-width border-top-color border-right-color border-bottom-color border-left-color border-radius border-radius-x border-radius-y border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius border-start-start-radius border-start-end-radius border-end-start-radius border-end-end-radius border-top-left-radius-x border-top-right-radius-x border-bottom-right-radius-x border-bottom-left-radius-x border-top-left-radius-y border-top-right-radius-y border-bottom-right-radius-y border-bottom-left-radius-y border-image border-image-source border-image-slice border-image-slice-top border-image-slice-right border-image-slice-bottom border-image-slice-left border-image-width border-image-width-top border-image-width-right border-image-width-bottom border-image-width-left border-image-outset border-image-outset-top border-image-outset-right border-image-outset-bottom border-image-outset-left border-image-repeat " +
      "list-style list-style-type list-style-position list-style-image list-style-image-baseurl margin margin-top margin-right margin-bottom margin-left margin-trim padding padding-top padding-right padding-bottom padding-left font font-family font-style font-variant font-variant-ligatures font-variant-numeric font-variant-east-asian font-variant-caps font-variant-position font-feature-settings font-kerning font-variation-settings font-stretch font-weight font-size line-height line-clamp webkit-line-clamp max-lines block-ellipsis webkit-hyphens moz-orient webkit-appearance webkit-box-orient text-decoration text-decoration-style text-decoration-line text-decoration-color text-decoration-thickness text-underline-offset text-decoration-skip-ink text-underline-position text-emphasis text-emphasis-style text-emphasis-color text-emphasis-position outline outline-width outline-style outline-color outline-offset " +
      "white-space white-space-collapse text-wrap text-wrap-mode text-wrap-style word-break overflow-wrap word-wrap break-before break-after break-inside page-break-before page-break-after page-break-inside orphans widows text-align vertical-align color width height min-width min-height max-width max-height block-size min-inline-size min-block-size max-inline-size max-block-size contain-intrinsic-size container container-type container-name position overflow overflow-x overflow-y text-overflow display direction unicode-bidi writing-mode text-orientation text-combine-upright visibility appearance box-sizing z-index float clear text-indent top right bottom left cursor content border-collapse table-layout text-transform " +
      "flex flex-flow flex-direction flex-wrap justify-content justify-items align-items align-content align-self place-items place-content place-self flex-grow flex-shrink flex-basis column-count column-width columns column-rule column-rule-width column-rule-style column-rule-color stroke stroke-linejoin corner-shape corner-top-left-shape corner-top-right-shape corner-bottom-right-shape corner-bottom-left-shape text-fit scrollbar-gutter grid-template grid line-break text-align-last text-justify hyphens hyphenate-character tab-size font-optical-sizing font-synthesis font-synthesis-weight font-synthesis-style font-synthesis-small-caps font-synthesis-position box-decoration-break webkit-box-decoration-break clip-rule gap column-gap row-gap grid-gap grid-column-gap grid-row-gap letter-spacing word-spacing grid-template-columns grid-template-rows grid-template-areas grid-auto-columns grid-auto-rows grid-auto-flow grid-area satoru-grid-columns-tokens satoru-grid-rows-tokens grid-column grid-column-start grid-column-end grid-row grid-row-start grid-row-end justify-self " +
      "caption-side object-fit object-position image-rendering fill contain cover scale-down isolation order filter backdrop-filter webkit-backdrop-filter mix-blend-mode background-blend-mode clip-path mask webkit-mask mask-image webkit-mask-image mask-size webkit-mask-size mask-repeat webkit-mask-repeat mask-position webkit-mask-position pointer-events user-select webkit-user-select webkit-background-clip webkit-text-fill-color webkit-text-stroke webkit-text-stroke-width webkit-text-stroke-color scroll-behavior transform-style perspective backface-visibility counter-reset counter-increment box-shadow text-shadow opacity transform transform-origin translate rotate scale " +
      "margin-inline margin-inline-start margin-inline-end margin-block margin-block-start margin-block-end padding-inline padding-inline-start padding-inline-end padding-block padding-block-start padding-block-end inset inset-inline inset-inline-start inset-inline-end inset-block inset-block-start inset-block-end border-inline border-inline-start border-inline-end border-inline-width border-inline-start-width border-inline-end-width border-inline-style border-inline-start-style border-inline-end-style border-inline-color border-inline-start-color border-inline-end-color border-block border-block-start border-block-end border-block-width border-block-start-width border-block-end-width border-block-style border-block-start-style border-block-end-style border-block-color border-block-start-color border-block-end-color " +
      "offset offset-path offset-distance offset-rotate offset-anchor offset-position inline-size size")
      .split(" ")
      .forEach(function (p) { SUPPORTS_PROPS[p] = true; });
    var supportsDecl = function (prop, value) {
      prop = String(prop == null ? "" : prop).trim().toLowerCase();
      value = String(value == null ? "" : value).trim();
      if (!prop || !value) return false;
      if (prop.slice(0, 2) === "--") return true; // any custom property with a value is supported
      // the same features litehtml rejects to follow Chromium (Tailwind's old-Safari hacks, for one)
      if (prop === "margin-trim" || prop === "-webkit-hyphens" || prop.slice(0, 5) === "-moz-" || prop.slice(0, 4) === "-ms-") return false;
      var known = SUPPORTS_PROPS[prop];
      if (!known && prop.slice(0, 8) === "-webkit-") known = SUPPORTS_PROPS[prop.slice(1)];
      return !!known;
    };
    var supportsCondition = function (text) {
      var s = String(text == null ? "" : text), pos = 0;
      var ws = function () { while (pos < s.length && /\s/.test(s.charAt(pos))) pos++; };
      var ident = function () { var from = pos; while (pos < s.length && /[\w-]/.test(s.charAt(pos))) pos++; return s.slice(from, pos).toLowerCase(); };
      var block = function () {
        if (s.charAt(pos) !== "(") return null;
        var depth = 0, from = pos;
        for (; pos < s.length; pos++) {
          var c = s.charAt(pos);
          if (c === '"' || c === "'") {
            var q = c;
            for (pos++; pos < s.length; pos++) {
              var d = s.charAt(pos);
              if (d === "\\") pos++;
              else if (d === q) break;
            }
          } else if (c === "(") depth++;
          else if (c === ")") {
            depth--;
            if (depth === 0) { var inner = s.slice(from + 1, pos); pos++; return inner; }
          }
        }
        pos = s.length;
        return null;
      };
      var colonAt = function (t) {
        var depth = 0;
        for (var i = 0; i < t.length; i++) {
          var c = t.charAt(i);
          if (c === '"' || c === "'") {
            var q = c;
            for (i++; i < t.length; i++) {
              var d = t.charAt(i);
              if (d === "\\") i++;
              else if (d === q) break;
            }
          } else if (c === "(" || c === "[") depth++;
          else if (c === ")" || c === "]") depth--;
          else if (c === ":" && depth === 0) return i;
        }
        return -1;
      };
      var term = function () {
        ws();
        if (s.charAt(pos) === "(") {
          var inner = block();
          if (inner === null) return false;
          var c = colonAt(inner);
          return c >= 0 ? supportsDecl(inner.slice(0, c), inner.slice(c + 1)) : supportsCondition(inner);
        }
        var name = ident();
        ws();
        if (name === "not") return !term();
        if (s.charAt(pos) === "(") {
          var arg = block();
          return name === "selector" ? !!arg && arg.trim() !== "" : false;
        }
        return false;
      };
      var andExpr = function () {
        var v = term();
        for (;;) {
          ws();
          var save = pos, op = ident();
          if (op !== "and") { pos = save; return v; }
          v = term() && v;
        }
      };
      var orExpr = function () {
        var v = andExpr();
        for (;;) {
          ws();
          var save = pos, op = ident();
          if (op !== "or") { pos = save; return v; }
          v = andExpr() || v;
        }
      };
      return orExpr();
    };
    g.CSS = {
      escape: function (v) {
        v = String(v);
        var out = "";
        for (var i = 0; i < v.length; i++) {
          var c = v.charCodeAt(i), ch = v.charAt(i);
          if (c === 0) out += "";
          else if ((c >= 1 && c <= 31) || c === 127 || (i === 0 && c >= 48 && c <= 57) || (i === 1 && c >= 48 && c <= 57 && v.charCodeAt(0) === 45)) out += "\\" + c.toString(16) + " ";
          else if (i === 0 && c === 45 && v.length === 1) out += "\\" + ch;
          else if (c >= 128 || c === 45 || c === 95 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) out += ch;
          else out += "\\" + ch;
        }
        return out;
      },
      supports: function (a, b) { return arguments.length > 1 ? supportsDecl(a, b) : supportsCondition(a); },
      registerProperty: function () {},
      px: function (n) { return { value: n, unit: "px", toString: function () { return n + "px"; } }; },
    };
  }

  // Geometry: DOMRect, DOMPoint, DOMMatrix
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
    var matrixIdentity = function () { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
    var matrixMul = function (a, b) {
      var o = new Array(16);
      for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
      return o;
    };
    var parseTransform = function (text) {
      var m = matrixIdentity(), re = /([a-z0-9]+)\(([^)]*)\)/gi, t;
      text = String(text).trim();
      if (text === "" || text === "none") return m;
      while ((t = re.exec(text))) {
        var n = t[1].toLowerCase(), a = t[2].split(",").map(function (x) { return parseFloat(x); }), f = matrixIdentity();
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
        m = matrixMul(m, f);
      }
      return m;
    };
    var matrixNames = ["m11", "m12", "m13", "m14", "m21", "m22", "m23", "m24", "m31", "m32", "m33", "m34", "m41", "m42", "m43", "m44"];
    var matrixAlias = { a: "m11", b: "m12", c: "m21", d: "m22", e: "m41", f: "m42" };
    g.DOMMatrixReadOnly = class DOMMatrixReadOnly {
      constructor(init) {
        var v = typeof init === "string" ? parseTransform(init) : Array.isArray(init) || (init && typeof init.length === "number") ? (init.length === 6 ? [init[0], init[1], 0, 0, init[2], init[3], 0, 0, 0, 0, 1, 0, init[4], init[5], 0, 1] : Array.prototype.slice.call(init)) : matrixIdentity();
        Object.defineProperty(this, "_m", { value: v.length === 16 ? v.map(Number) : matrixIdentity(), writable: true });
      }
      get is2D() { var m = this._m; return !(m[2] || m[3] || m[6] || m[7] || m[8] || m[9] || m[11] || m[14]) && m[10] === 1 && m[15] === 1; }
      get isIdentity() { var m = this._m, i = matrixIdentity(); return m.every(function (x, k) { return x === i[k]; }); }
      static fromMatrix(o) { return new this(o && o._m ? o._m : [o.a, o.b, o.c, o.d, o.e, o.f]); }
      multiply(o) { return new g.DOMMatrix(matrixMul(this._m, new g.DOMMatrix(o && o._m ? o._m : o)._m)); }
      translate(x, y, z) { var f = matrixIdentity(); f[12] = x || 0; f[13] = y || 0; f[14] = z || 0; return new g.DOMMatrix(matrixMul(this._m, f)); }
      scale(sx, sy, sz) { var f = matrixIdentity(); f[0] = sx === undefined ? 1 : sx; f[5] = sy === undefined ? f[0] : sy; f[10] = sz === undefined ? 1 : sz; return new g.DOMMatrix(matrixMul(this._m, f)); }
      rotate(deg) { var r = (deg || 0) * Math.PI / 180, f = matrixIdentity(); f[0] = Math.cos(r); f[1] = Math.sin(r); f[4] = -Math.sin(r); f[5] = Math.cos(r); return new g.DOMMatrix(matrixMul(this._m, f)); }
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
      toJSON() { var o = { is2D: this.is2D, isIdentity: this.isIdentity }, m = this; matrixNames.forEach(function (n) { o[n] = m[n]; }); Object.keys(matrixAlias).forEach(function (k) { o[k] = m[k]; }); return o; }
      toString() { var m = this._m; return this.is2D ? "matrix(" + [m[0], m[1], m[4], m[5], m[12], m[13]].join(", ") + ")" : "matrix3d(" + m.join(", ") + ")"; }
    };
    matrixNames.forEach(function (n, i) {
      Object.defineProperty(g.DOMMatrixReadOnly.prototype, n, { get: function () { return this._m[i]; }, configurable: true });
    });
    Object.keys(matrixAlias).forEach(function (k) {
      var i = matrixNames.indexOf(matrixAlias[k]);
      Object.defineProperty(g.DOMMatrixReadOnly.prototype, k, { get: function () { return this._m[i]; }, configurable: true });
    });
    g.DOMMatrix = class DOMMatrix extends g.DOMMatrixReadOnly {};
    matrixNames.forEach(function (n, i) {
      Object.defineProperty(g.DOMMatrix.prototype, n, { get: function () { return this._m[i]; }, set: function (v) { this._m[i] = +v || 0; }, configurable: true });
    });
    Object.keys(matrixAlias).forEach(function (k) {
      var i = matrixNames.indexOf(matrixAlias[k]);
      Object.defineProperty(g.DOMMatrix.prototype, k, { get: function () { return this._m[i]; }, set: function (v) { this._m[i] = +v || 0; }, configurable: true });
    });
    ["multiply", "translate", "scale", "rotate"].forEach(function (op) {
      g.DOMMatrix.prototype[op + "Self"] = function () { this._m = g.DOMMatrixReadOnly.prototype[op].apply(this, arguments)._m; return this; };
    });
    g.DOMMatrix.prototype.invertSelf = function () { this._m = this.inverse()._m; return this; };
    g.WebKitCSSMatrix = g.DOMMatrix;
  }

  // Performance prototype
  if (!g.Performance) g.Performance = function Performance() { throw new TypeError("Illegal constructor"); };
  if (g.performance) Object.setPrototypeOf(g.performance, g.Performance.prototype);
  if (g.performance && !g.performance.timing) {
    g.performance.timing = { navigationStart: g.performance.timeOrigin, fetchStart: g.performance.timeOrigin, responseStart: g.performance.timeOrigin, domLoading: g.performance.timeOrigin, domInteractive: g.performance.timeOrigin, domContentLoadedEventStart: g.performance.timeOrigin, domContentLoadedEventEnd: g.performance.timeOrigin, loadEventStart: 0, loadEventEnd: 0 };
    g.performance.navigation = { type: 0, redirectCount: 0 };
    g.performance.toJSON = function () { return {}; };
  }

  // Canvas stubs
  // A canvas here has no backing store: getContext hands back null and toDataURL an empty data: URL.
  // Both are silent data loss in a snapshot, so each canvas says so once, in the page log.
  var canvasWarned = typeof WeakMap === "function" ? new WeakMap() : null;
  var warnCanvasOnce = function (el, key, message) {
    if (canvasWarned) {
      var keys = canvasWarned.get(el);
      if (!keys) { keys = {}; canvasWarned.set(el, keys); }
      if (keys[key]) return;
      keys[key] = true;
    }
    if (g.console && g.console.warn) g.console.warn(message);
  };
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
      getContext() {
        warnCanvasOnce(this, "getContext", "OffscreenCanvas.getContext: 2D canvas is not available in wasm-quickjs-dom; the call returns null");
        return null;
      }
      convertToBlob() { return Promise.reject(new Error("OffscreenCanvas has no drawing here")); }
    };
  }
  var canvasProto = N.protos && N.protos.HTMLCanvasElement;
  if (canvasProto) {
    Object.defineProperty(canvasProto, "getContext", { configurable: true, writable: true, value: function () {
      warnCanvasOnce(this, "getContext", "HTMLCanvasElement.getContext: 2D canvas is not available in wasm-quickjs-dom; the call returns null");
      return null;
    } });
    Object.defineProperty(canvasProto, "toDataURL", { configurable: true, writable: true, value: function () {
      warnCanvasOnce(this, "toDataURL", "HTMLCanvasElement.toDataURL: there is no canvas drawing to encode; the call returns \"data:,\"");
      return "data:,";
    } });
    Object.defineProperty(canvasProto, "toBlob", { configurable: true, writable: true, value: function (cb) { if (typeof cb === "function") g.setTimeout(function () { cb(null); }, 0); } });
    ["width", "height"].forEach(function (k, i) {
      Object.defineProperty(canvasProto, k, {
        configurable: true,
        get: function () { var v = parseInt(this.getAttribute(k), 10); return v >= 0 ? v : (i ? 150 : 300); },
        set: function (v) { this.setAttribute(k, String(v)); },
      });
    });
  }

  // XHR prototype chaining
  if (g.XMLHttpRequestEventTarget && g.EventTarget) {
    Object.setPrototypeOf(g.XMLHttpRequestEventTarget.prototype, g.EventTarget.prototype);
    Object.setPrototypeOf(g.XMLHttpRequestEventTarget, g.EventTarget);
    Object.setPrototypeOf(g.XMLHttpRequestUpload.prototype, g.XMLHttpRequestEventTarget.prototype);
    Object.setPrototypeOf(g.XMLHttpRequestUpload, g.XMLHttpRequestEventTarget);
  }

  // Window function stubs
  g.alert = function () {};
  g.confirm = function () { return false; };
  g.prompt = function () { return null; };
  g.focus = g.blur = function () {};
  g.captureEvents = g.releaseEvents = function () {};
  g.moveBy = g.moveTo = g.resizeBy = g.resizeTo = g.print = g.stop = function () {};
  g.open = function () { return null; };
  g.scrollTo = g.scroll = g.scrollBy = function () {};
  if (!g.webkitURL) g.webkitURL = g.URL;
  g.devicePixelRatio = 1;
  g.pageXOffset = g.scrollX = g.pageYOffset = g.scrollY = 0;
  g.screenX = g.screenLeft = g.screenY = g.screenTop = 0;
  g.name = "";
  g.status = "";
  g.frameElement = null;
  g.length = 0;
  g.event = undefined;

  // Media queries
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

  // ==========================================
  // 2. Page Boot (runs per page on __edgeBoot)
  // ==========================================
  var done = new WeakSet(), list = [], current = null;

  g.__edgeBoot = function (html, url, width, seed, visual) {
    g.__edgeStart(seed);
    var isVisual = visual !== false;
    if (!isVisual) { delete g.requestAnimationFrame; delete g.cancelAnimationFrame; }
    var d = N.parse(html);
    if (N.setVisual) N.setVisual(d, isVisual);
    if (w.HTMLDocument) Object.setPrototypeOf(d, w.HTMLDocument.prototype);

    ["addEventListener", "removeEventListener", "dispatchEvent"].forEach(function (k) {
      Object.defineProperty(g, k, { configurable: true, writable: true, value: N.protos.Node[k] });
    });
    Object.defineProperty(d, "defaultView", { configurable: true, value: g });

    // cookies
    var jar = new Map();
    Object.defineProperty(d, "cookie", {
      configurable: true,
      get: function () {
        var hooks = g.__host && g.__host.cookieJar;
        if (hooks) return hooks.get(String(g.location.href));
        return Array.from(jar.entries()).map(function (e) { return e[0] + "=" + e[1]; }).join("; ");
      },
      set: function (v) {
        var hooks = g.__host && g.__host.cookieJar;
        if (hooks) { hooks.set(String(v), String(g.location.href)); return; }
        var parts = String(v).split(";"), kv = parts[0], i = kv.indexOf("=");
        var name = (i < 0 ? "" : kv.slice(0, i)).trim(), value = i < 0 ? kv.trim() : kv.slice(i + 1).trim();
        var expired = parts.slice(1).some(function (p) {
          var m = /^\s*(max-age|expires)\s*=\s*(.*)$/i.exec(p);
          return m && (m[1].toLowerCase() === "max-age" ? parseInt(m[2], 10) <= 0 : Date.parse(m[2]) < Date.now());
        });
        if (expired) jar.delete(name); else jar.set(name, value);
      },
    });

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

    g.document = d;
    ["window", "self", "top", "parent", "frames"].forEach(function (k) {
      Object.defineProperty(g, k, { configurable: true, writable: true, value: g });
    });

    // Location
    var loc = new g.URL(url);
    Object.setPrototypeOf(g.Location.prototype, Object.getPrototypeOf(loc));
    Object.setPrototypeOf(loc, g.Location.prototype);
    loc.assign = loc.replace = loc.reload = function () {};
    g.location = loc;
    g.origin = loc.origin;

    // Navigator
    var emptyList = function (ctor) {
      var o = Object.create(ctor.prototype);
      Object.defineProperty(o, "length", { value: 0, enumerable: true });
      return o;
    };
    g.navigator = Object.create(g.Navigator.prototype);
    Object.assign(g.navigator, {
      userAgent: "Mozilla/5.0 (compatible; wasm-html-to-image) AppleWebKit/537.36 Chrome/120.0",
      language: "en-US", languages: ["en-US"], platform: "Linux", hardwareConcurrency: 1, onLine: true, cookieEnabled: false,
      webdriver: false, doNotTrack: null, vendor: "Google Inc.", appVersion: "5.0 (X11)", maxTouchPoints: 0, pdfViewerEnabled: false,
      plugins: emptyList(g.PluginArray), mimeTypes: emptyList(g.MimeTypeArray),
      sendBeacon: function () { return true; },
      storage: { estimate: function () { return Promise.resolve({ quota: 0, usage: 0 }); }, persist: function () { return Promise.resolve(false); }, persisted: function () { return Promise.resolve(false); } },
      clipboard: { writeText: function () { return Promise.resolve(); }, readText: function () { return Promise.reject(new g.DOMException("Read permission denied.", "NotAllowedError")); } },
    });

    // History
    function moveTo(u) {
      if (u == null || u === "") return;
      var n = new g.URL(String(u), loc.href);
      ["protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin", "searchParams"].forEach(function (k) { loc[k] = n[k]; });
    }
    g.history = Object.create(g.History.prototype);
    Object.assign(g.history, { state: null, length: 1, scrollRestoration: "auto", _moveTo: moveTo });

    // Screen
    g.screen = Object.create(g.Screen.prototype);
    Object.assign(g.screen, { width: width, height: Math.round(width * 0.75) });

    // BarProp & External
    ["locationbar", "menubar", "personalbar", "scrollbars", "statusbar", "toolbar"].forEach(function (k) {
      var bar = Object.create(g.BarProp.prototype);
      Object.defineProperty(bar, "visible", { value: true, enumerable: true });
      g[k] = bar;
    });
    g.external = Object.create(g.External.prototype);

    // Dimensions
    g.innerWidth = g.outerWidth = width;
    g.innerHeight = g.outerHeight = Math.round(width * 0.75);

    // PostMessage
    g.postMessage = function (message) {
      var ev = new g.MessageEvent("message", { data: message, origin: loc.origin === "null" ? "" : loc.origin });
      setTimeout(function () { g.dispatchEvent(ev); }, 0);
    };

    // Storage instances
    g.localStorage = createStorage();
    g.sessionStorage = createStorage();

    // DOM constructors tied to document
    g.Image = function (w, h) {
      var i = d.createElement("img");
      if (w != null) i.setAttribute("width", w);
      if (h != null) i.setAttribute("height", h);
      return i;
    };
    g.Image.prototype = w.HTMLImageElement ? w.HTMLImageElement.prototype : Object.getPrototypeOf(d.createElement("img"));
    // Images: the page's view of the renderer's image resources. Fetching and decoding belong to
    // the renderer's ResourceManager (src/cpp/core/resource_manager.h), so the host publishes each
    // record here under its absolute URL and 05-html.js reads it for naturalWidth/naturalHeight,
    // complete, currentSrc and decode(). The record is
    //   { status: "idle" | "loading" | "loaded" | "error", width, height, promise }
    // __edgeImageSettle (05-html.js) turns a settled record into the load/error event of every
    // <img> showing the URL and settles the decode() waiters.
    // TODO(onload): both the event and the decode() promise are synthesized from this registry;
    // once the resource_manager bridge knows the timing they should be shared with its onload
    // transition instead of fired here.
    g.__edgeImageResources = new Map();
    g.__edgeImageResource = function (url, record) {
      url = String(url);
      try { url = new URL(url, g.location.href).href; } catch (e) { /* a data: URL stays as it is */ }
      if (record == null) g.__edgeImageResources.delete(url);
      else g.__edgeImageResources.set(url, record);
      // the <img> load/error events and the decode() waiters settle from this record
      if (g.__edgeImageSettle) g.__edgeImageSettle(url, record);
    };
    g.Option = function (text, value, defaultSelected, selected) {
      var o = d.createElement("option");
      if (text !== undefined) o.textContent = String(text);
      if (value !== undefined) o.setAttribute("value", String(value));
      if (defaultSelected) o.setAttribute("selected", "");
      if (selected) o.selected = true;
      return o;
    };
    g.Option.prototype = w.HTMLOptionElement ? w.HTMLOptionElement.prototype : Object.getPrototypeOf(d.createElement("option"));
    g.Audio = function (src) {
      var a = d.createElement("audio");
      if (src !== undefined) a.setAttribute("src", String(src));
      return a;
    };
    g.Audio.prototype = w.HTMLAudioElement ? w.HTMLAudioElement.prototype : Object.getPrototypeOf(d.createElement("audio"));

    // document.fonts is a stub: ready resolves at once, check() always says true and load() resolves with no
    // fonts. There is no font loading here, so a page must not use this for text measurement (or to wait for
    // webfonts): it gets no chance to settle first. Text is measured by the image engine, not by this DOM.
    // TODO: make load() and ready wait for the renderer's fonts with a timeout, so measurement after
    // fonts.ready is meaningful.
    d.fonts = d.fonts || { ready: Promise.resolve(), check: function () { return true; }, load: function () { return Promise.resolve([]); }, add: function () {}, forEach: function () {}, addEventListener: function () {}, removeEventListener: function () {} };
    var state = "loading";
    Object.defineProperty(d, "readyState", { configurable: true, get: function () { return state; } });
    g.__edgeSetReady = function (s) { state = s; };

    if (!d.timeline) d.timeline = { get currentTime() { return g.performance.now(); } };

    // URL-valued properties read back absolute
    [["HTMLScriptElement", "src", "script"], ["HTMLImageElement", "src", "img"], ["HTMLLinkElement", "href", "link"], ["HTMLAnchorElement", "href", "a"], ["HTMLIFrameElement", "src", "iframe"]].forEach(function (triple) {
      var C = w[triple[0]], P = C ? C.prototype : Object.getPrototypeOf(d.createElement(triple[2])), prop = triple[1];
      while (P && !Object.getOwnPropertyDescriptor(P, prop)) P = Object.getPrototypeOf(P);
      P = P || (C ? C.prototype : Object.getPrototypeOf(d.createElement(triple[2])));
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

    if (!("designMode" in d)) Object.defineProperty(d, "designMode", { configurable: true, writable: true, value: "off" });
    [["location", function () { return g.location; }], ["baseURI", function () { return g.location.href; }],
     ["domain", function () { return g.location.hostname; }], ["activeElement", function () { return d.body; }],
     ["scrollingElement", function () { return d.documentElement; }], ["all", function () { return d.getElementsByTagName("*"); }]].forEach(function (p) {
      if (!(p[0] in d)) Object.defineProperty(d, p[0], { configurable: true, get: p[1] });
    });
    if (!("elementFromPoint" in d)) Object.defineProperty(d, "elementFromPoint", { configurable: true, writable: true, value: function () { return null; } });
    if (!("elementsFromPoint" in d)) Object.defineProperty(d, "elementsFromPoint", { configurable: true, writable: true, value: function () { return []; } });
  };

  // ==========================================
  // 3. Execution, Layout and Serialization Hooks
  // ==========================================
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

  var boxes = null;
  // `__qi` is a snapshot of document order, and the native DOM's version moves on every tree or attribute change.
  // A layout is therefore valid only at the revision it was measured from: after a change the numbers may point
  // at other elements, so the old boxes are stale and must be measured again from a fresh markForLayout().
  var markRevision = -1, layoutRevision = -1, staleWarned = false;
  var layoutWarn = function (message) { if (g.console && g.console.warn) g.console.warn(message); };
  var checkLayoutRevision = function () {
    if (boxes === null || staleWarned) return;
    if (g.__native.dom.version() !== layoutRevision) {
      staleWarned = true;
      layoutWarn("layout is stale: the DOM changed after setLayout(), so getBoundingClientRect(), offset*, client* and scroll* still report the old boxes; call markForLayout() and setLayout() again");
    }
  };
  g.__edgeMarkLayout = function () {
    // A mark only invalidates the boxes of an earlier one when the document changed in between: the numbers are
    // reassigned in the new document order, so they can point at other elements. Marking an unchanged document
    // assigns the same numbers again and leaves those boxes valid, so there is nothing to warn about.
    // `markRevision` is the revision right after the clone was marked, so this compares the document alone and not
    // the clone work the previous mark did.
    if (markRevision !== -1 && markRevision !== g.__native.dom.version()) {
      layoutWarn("markForLayout(): the DOM changed after an earlier markForLayout(), so boxes measured from it may no longer match the elements; measure again");
    }
    var d = g.document, clone = d.cloneNode(true);
    var a = Array.prototype.slice.call(d.querySelectorAll("*")), b = Array.prototype.slice.call(clone.querySelectorAll("*"));
    boxes = null;
    staleWarned = false;
    for (var i = 0; i < a.length && i < b.length; i++) {
      a[i].__qi = i;
      var had = b[i].getAttribute("class");
      b[i].setAttribute("class", "qjsl-" + i + (had ? " " + had : ""));
    }
    var n = clone.querySelectorAll("noscript");
    for (var j = 0; j < n.length; j++) n[j].remove();
    var html = g.__native.dom.serialize(clone);
    markRevision = g.__native.dom.version();
    return /^<!DOCTYPE/i.test(html) ? html.replace(/^<!DOCTYPE\s*(?:html)?\s*>/i, "<!DOCTYPE html>") : "<!DOCTYPE html>" + html;
  };
  g.__edgeSetLayout = function (json) {
    var current = g.__native.dom.version();
    if (markRevision !== -1 && markRevision !== current) {
      layoutWarn("setLayout(): the DOM changed after markForLayout(), so these boxes were measured from a different document; call markForLayout() again and pass its fresh boxes");
    }
    boxes = JSON.parse(json);
    layoutRevision = current;
    staleWarned = false;
    var P = g.Element.prototype;
    var box = function (el) { checkLayoutRevision(); return (boxes && el.__qi !== undefined && boxes[el.__qi]) || [0, 0, 0, 0]; };
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
