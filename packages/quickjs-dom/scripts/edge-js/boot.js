// Builds the page on the native DOM (csrc/nativedom*.h, scripts/edge-js/nativedom.js) and exposes the hooks the host
// drives (see src/index.ts). Runs after shims.js, the Web Streams polyfill and nativedom.js.
(function (g) {
  var done = new WeakSet(), list = [], current = null;

  g.__edgeBoot = function (html, url, width, seed) {
    g.__edgeStart(seed);
    var N = g.__native.dom;
    var d = N.parse(html), w = N.window;
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
    g.document = d;
    ["window", "self", "top", "parent", "frames"].forEach(function (k) {
      Object.defineProperty(g, k, { configurable: true, writable: true, value: g });
    });

    var loc = new g.URL(url);
    loc.assign = loc.replace = loc.reload = function () {};
    g.location = loc;
    g.navigator = { userAgent: "Mozilla/5.0 (compatible; wasm-html-to-image) AppleWebKit/537.36 Chrome/120.0", language: "en-US", languages: ["en-US"], platform: "Linux", hardwareConcurrency: 1, onLine: true, cookieEnabled: false };
    // pushState/replaceState move the location, as routers expect (no navigation happens)
    function moveTo(u) {
      if (u == null || u === "") return;
      var n = new g.URL(String(u), loc.href);
      ["protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin", "searchParams"].forEach(function (k) { loc[k] = n[k]; });
    }
    g.history = {
      state: null, length: 1, scrollRestoration: "auto",
      pushState: function (s, t, u) { this.state = s; this.length++; moveTo(u); },
      replaceState: function (s, t, u) { this.state = s; moveTo(u); },
      back: function () {}, forward: function () {}, go: function () {},
    };
    g.screen = { width: width, height: Math.round(width * 0.75) };
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
    function storage() {
      var m = new Map();
      return {
        getItem: function (k) { k = String(k); return m.has(k) ? m.get(k) : null; },
        setItem: function (k, v) { m.set(String(k), String(v)); },
        removeItem: function (k) { m.delete(String(k)); },
        clear: function () { m.clear(); },
        key: function (i) { return Array.from(m.keys())[i] == null ? null : Array.from(m.keys())[i]; },
        get length() { return m.size; },
      };
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
    // canvas has no drawing here: a context is not available, which is what code feature-checks for
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
