// Builds the page in linkedom and exposes the hooks the host drives (see src/index.ts).
// Runs after shims.js, the Web Streams polyfill and linkedom (`globalThis.__linkedom`).
(function (g) {
  var done = new WeakSet(), list = [], current = null;

  g.__edgeBoot = function (html, url, width, seed) {
    g.__edgeStart(seed);
    var L = g.__linkedom;
    var parsed = L.parseHTML(html);
    var d = parsed.document, w = parsed.window;
    // the window's own properties (constructors, event target, ...) become globals
    Object.getOwnPropertyNames(w).forEach(function (k) {
      if (!(k in g) || k === "document") {
        try { Object.defineProperty(g, k, { configurable: true, writable: true, value: w[k] }); } catch (e) {}
      }
    });
    Object.keys(L).forEach(function (k) { if (/^[A-Z]/.test(k) && !(k in g)) g[k] = L[k]; });
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
    ["PopStateEvent", "HashChangeEvent", "PageTransitionEvent", "ErrorEvent", "ProgressEvent"].forEach(function (n) {
      if (!g[n]) g[n] = class extends g.Event { constructor(t, i) { super(t, i); Object.assign(this, i || {}); } };
    });
    g.screen = { width: width, height: Math.round(width * 0.75) };
    g.innerWidth = g.outerWidth = width;
    g.innerHeight = g.outerHeight = Math.round(width * 0.75);
    g.devicePixelRatio = 1;
    g.scrollTo = g.scroll = g.scrollBy = function () {};

    g.addEventListener = function (t, f, o) { return d.defaultView.addEventListener(t, f, o); };
    g.removeEventListener = function (t, f, o) { return d.defaultView.removeEventListener(t, f, o); };
    g.dispatchEvent = function (e) { return d.defaultView.dispatchEvent(e); };
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
    if (!g.customElements && w.customElements) g.customElements = w.customElements;
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
    if (!g.MutationObserver) g.MutationObserver = w.MutationObserver || class { observe() {} disconnect() {} takeRecords() { return []; } };
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
  };

  // the scripts not run yet, in document order; dynamically added ones show up on the next call
  g.__edgeNextScripts = function () {
    var out = [], all = g.document.querySelectorAll("script");
    for (var i = 0; i < all.length; i++) {
      var s = all[i];
      if (done.has(s)) continue;
      done.add(s);
      var type = (s.getAttribute("type") || "").toLowerCase();
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
      var h = ok ? s.onload : s.onerror;
      if (typeof h === "function") h.call(s, e);
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
    return d.toString().replace(/^<!DOCTYPE\s*>/i, "<!DOCTYPE html>");
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
    var html = clone.toString();
    return /^<!DOCTYPE/i.test(html) ? html.replace(/^<!DOCTYPE\s*>/i, "<!DOCTYPE html>") : "<!DOCTYPE html>" + html;
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
