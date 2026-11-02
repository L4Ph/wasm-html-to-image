// Builds the page in linkedom and exposes the hooks the host drives (see src/edge-js.ts).
// Runs after shims.js, the Web Streams polyfill and linkedom (`globalThis.__linkedom`).
(function (g) {
  var done = new WeakSet(), list = [], current = null;

  g.__edgeBoot = function (html, url, width) {
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
    g.history = {
      state: null, length: 1, scrollRestoration: "auto",
      pushState: function (s) { this.state = s; }, replaceState: function (s) { this.state = s; },
      back: function () {}, forward: function () {}, go: function () {},
    };
    g.screen = { width: width, height: Math.round(width * 0.75) };
    g.innerWidth = g.outerWidth = width;
    g.innerHeight = g.outerHeight = Math.round(width * 0.75);
    g.devicePixelRatio = 1;
    g.scrollTo = g.scroll = g.scrollBy = function () {};

    g.addEventListener = function (t, f, o) { return d.defaultView.addEventListener(t, f, o); };
    g.removeEventListener = function (t, f, o) { return d.defaultView.removeEventListener(t, f, o); };
    g.dispatchEvent = function (e) { return d.defaultView.dispatchEvent(e); };
    g.matchMedia = function (q) {
      return { matches: false, media: q, onchange: null, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } };
    };
    g.getComputedStyle = g.getComputedStyle || function (el) { return el.style || {}; };
    g.localStorage = g.sessionStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {}, clear: function () {} };
    ["ResizeObserver", "IntersectionObserver", "MutationObserver"].forEach(function (n) {
      if (!g[n]) g[n] = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
    });
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
      if (s.hasAttribute("nomodule") || s.hasAttribute("noModule") || (type && type !== "text/javascript" && type !== "application/javascript")) continue;
      var src = s.getAttribute("src");
      out.push({ idx: list.push(s) - 1, src: src, text: src ? "" : s.textContent });
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
    } catch (x) { __host.log("error", "load handler: " + ((x && x.stack) || x)); }
  };
  g.__edgeDocumentEvents = function () {
    g.document.dispatchEvent(new g.Event("DOMContentLoaded"));
    g.document.defaultView.dispatchEvent(new g.Event("load"));
  };
  g.__edgeHas = function (selector) { return !!g.document.querySelector(selector); };
  g.__edgeSerialize = function () {
    var d = g.document, n = d.querySelectorAll("noscript");
    for (var i = 0; i < n.length; i++) n[i].remove();
    return d.toString().replace(/^<!DOCTYPE\s*>/i, "<!DOCTYPE html>");
  };
})(globalThis);
