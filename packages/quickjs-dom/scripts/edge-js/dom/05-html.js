  // ---- reflected attributes and form validation, tables: the members of the HTML interfaces that pages read
  (function () {
    var attrNumber = function (proto, prop, attr, dflt, min) {
      getter(proto, prop, function () {
        var n = parseInt(this.getAttribute(attr), 10);
        return isFinite(n) && (min === undefined || n >= min) ? n : dflt;
      }, function (v) { this.setAttribute(attr, String(Math.trunc(+v) || 0)); });
    };
    var nullable = function (proto, prop, attr) {
      getter(proto, prop, function () { return this.getAttribute(attr); }, function (v) { if (v === null) this.removeAttribute(attr); else this.setAttribute(attr, String(v)); });
    };
    var each = function (names, protos, fn) { names.forEach(function (n) { protos.forEach(function (p) { fn(P[p], n, n.toLowerCase()); }); }); };
    each(["hreflang", "download", "coords", "shape", "ping", "referrerPolicy", "type"], ["HTMLAnchorElement"], function (p, n, a) { if (!Object.getOwnPropertyDescriptor(p, n) && !Object.getOwnPropertyDescriptor(P.HTMLElement, n)) reflectString(p, n, a); });
    each(["hreflang", "media", "integrity", "referrerPolicy", "imageSrcset", "imageSizes", "fetchPriority"], ["HTMLLinkElement"], function (p, n, a) { if (!Object.getOwnPropertyDescriptor(p, n)) reflectString(p, n, a === "imagesrcset" ? "imagesrcset" : a === "imagesizes" ? "imagesizes" : a === "fetchpriority" ? "fetchpriority" : a === "referrerpolicy" ? "referrerpolicy" : a); });
    [P.HTMLLinkElement, P.HTMLScriptElement, P.HTMLImageElement, P.HTMLMediaElement].forEach(function (p) { if (p && !Object.getOwnPropertyDescriptor(p, "crossOrigin")) nullable(p, "crossOrigin", "crossorigin"); });
    // feature detection of script types: classic, module and importmap are what the engine runs
    D.ctors.HTMLScriptElement.supports = function (type) { return ["classic", "module", "importmap"].indexOf(String(type)) >= 0; };
    reflectString(P.HTMLScriptElement, "charset", "charset");
    reflectString(P.HTMLScriptElement, "event", "event");
    reflectString(P.HTMLImageElement, "srcset", "srcset");
    reflectString(P.HTMLImageElement, "sizes", "sizes");
    reflectString(P.HTMLImageElement, "useMap", "usemap");
    reflectString(P.HTMLImageElement, "lowsrc", "lowsrc");
    reflectBool(P.HTMLImageElement, "isMap", "ismap");
    // ---- image source selection and the resource record the renderer fills in ----
    // The resource record is the shape the renderer's ResourceManager (src/cpp/core/resource_manager.h)
    // can publish once it has fetched and decoded an image:
    //   { url, status: "idle" | "loading" | "loaded" | "error", width, height, promise }
    // boot.js creates one registry per page and exposes __edgeImageResource(url, record) to the host.
    // With no record the snapshot renderer loads the file itself: the DOM has nothing to wait for.
    var imageUrl = function (el, value) {
      if (!value) return "";
      try {
        var base = el.ownerDocument && el.ownerDocument.baseURI;
        return base ? new URL(value, base).href : value;
      } catch (e) {
        return value;
      }
    };
    // srcset candidates: a URL runs to the next whitespace (so commas inside a data: URL stay in
    // it), then descriptor tokens run to the next comma, as the HTML parser does.
    var srcsetCandidates = function (text) {
      var out = [], p = 0, n = String(text).length, space = function (c) { return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f"; };
      while (p < n) {
        while (p < n && (space(text.charAt(p)) || text.charAt(p) === ",")) p++;
        if (p >= n) break;
        var start = p;
        while (p < n && !space(text.charAt(p))) p++;
        var cand = { url: text.slice(start, p), width: 0, density: 0 };
        while (p < n && space(text.charAt(p))) p++;
        var descStart = p;
        while (p < n && text.charAt(p) !== ",") p++;
        var desc = text.slice(descStart, p);
        if (p < n && text.charAt(p) === ",") p++;
        var tokens = desc.split(/[\t\n\r\f ]+/);
        for (var i = 0; i < tokens.length; i++) {
          var tok = tokens[i], last = tok.charAt(tok.length - 1);
          if (!tok || (last !== "w" && last !== "x")) continue;
          var v = parseFloat(tok);
          if (!(v > 0)) continue;
          if (last === "w") cand.width = v; else cand.density = v;
        }
        if (cand.url) out.push(cand);
      }
      return out;
    };
    // One sizes length token (px, vw, % of the viewport, em/rem at 16px, or a bare number as px).
    var sizesLength = function (tok, viewport) {
      var m = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*(px|vw|%|em|rem)?\s*$/.exec(String(tok));
      if (!m) return null;
      var v = parseFloat(m[1]), unit = m[2] || "px";
      if (unit === "vw" || unit === "%") return v * viewport / 100;
      if (unit === "em" || unit === "rem") return v * 16;
      return v;
    };
    // The sizes slot: the first entry whose media condition matches wins; a bare length is the
    // default. Only the common (max-width: N) / (min-width: N) conditions are understood, as in
    // the renderer's litehtml el_image.cpp; an entry with any other condition is skipped.
    var sizesSlot = function (sizes, viewport) {
      if (!sizes) return viewport;
      var text = String(sizes), pos = 0, n = text.length;
      while (pos < n) {
        var depth = 0, end = pos;
        while (end < n) {
          var c = text.charAt(end);
          if (c === "(") depth++;
          else if (c === ")") depth--;
          else if (c === "," && depth === 0) break;
          end++;
        }
        var entry = text.slice(pos, end) || "";
        pos = end + 1;
        entry = entry.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
        if (!entry) continue;
        var matches = true, length = entry;
        if (entry.charAt(0) === "(") {
          var close = entry.lastIndexOf(")");
          if (close < 0) continue;
          var cond = entry.slice(1, close);
          length = entry.slice(close + 1).replace(/^[\t\n\r ]+/, "");
          if (!length) continue;
          var colon = cond.indexOf(":");
          if (colon < 0) continue;
          var condValue = sizesLength(cond.slice(colon + 1), viewport);
          if (condValue === null) continue;
          var name = cond.slice(0, colon).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
          if (name === "max-width") matches = viewport <= condValue;
          else if (name === "min-width") matches = viewport >= condValue;
          else continue;
        }
        if (matches) {
          var value = sizesLength(length, viewport);
          if (value !== null) return value;
        }
      }
      return viewport;
    };
    // The candidate a DPR-1 browser would load (the renderer lays out at scale 1): with w
    // descriptors the smallest width covering the sizes slot (else the largest), with x
    // descriptors the smallest density >= 1 (else the largest). "" when nothing is selectable.
    var selectSrcset = function (srcset, sizes, viewport) {
      var cands = srcsetCandidates(srcset), i;
      if (!cands.length) return "";
      var hasWidth = false;
      for (i = 0; i < cands.length; i++) hasWidth = hasWidth || cands[i].width > 0;
      if (hasWidth) {
        var slot = sizesSlot(sizes, viewport), best = null, largest = null;
        for (i = 0; i < cands.length; i++) {
          var c = cands[i];
          if (!(c.width > 0)) continue;
          if (!largest || c.width > largest.width) largest = c;
          if (c.width >= slot && (!best || c.width < best.width)) best = c;
        }
        return (best || largest || {}).url || "";
      }
      var bestDensity = null, largestDensity = null, largestValue = 0;
      for (i = 0; i < cands.length; i++) {
        var cand = cands[i], density = cand.density > 0 ? cand.density : 1;
        if (!largestDensity || density > largestValue) { largestDensity = cand; largestValue = density; }
        if (density >= 1 && (!bestDensity || density < (bestDensity.density > 0 ? bestDensity.density : 1))) bestDensity = cand;
      }
      return (bestDensity || largestDensity || {}).url || "";
    };
    var imageSource = function (el) {
      var srcset = el.getAttribute("srcset");
      if (srcset) {
        var selected = selectSrcset(srcset, el.getAttribute("sizes"), globalThis.innerWidth || 0);
        if (selected) return imageUrl(el, selected);
      }
      var src = el.getAttribute("src");
      return src ? imageUrl(el, src) : "";
    };
    var imageRecord = function (url) {
      var registry = globalThis.__edgeImageResources;
      return registry && url ? registry.get(url) : undefined;
    };
    // decode() waits while the renderer still owns the source: boot.js calls __edgeImageSettle
    // after publishing a loaded (or failed) record. The same settle transition fires the
    // load/error event of every <img> showing the URL (non-bubbling, target = currentTarget),
    // before the decode() waiters resolve or reject.
    var imageWaiters = new Map();
    // the last settled status each element was told about, so a repeated record is one event
    var imageEvents = new WeakMap();
    var imageError = function () { return new DOMException("The source image cannot be decoded.", "EncodingError"); };
    var imageWait = function (url, record) {
      if (!record || record.status === "loaded") return Promise.resolve();
      if (record.status === "error") return Promise.reject(imageError());
      return new Promise(function (resolve, reject) {
        var list = imageWaiters.get(url);
        if (list) list.push({ resolve: resolve, reject: reject });
        else imageWaiters.set(url, [{ resolve: resolve, reject: reject }]);
      });
    };
    var imageElements = function (url) {
      var doc = globalThis.document, out = [];
      if (!doc || !doc.images) return out;
      for (var i = 0; i < doc.images.length; i++) if (imageSource(doc.images[i]) === url) out.push(doc.images[i]);
      return out;
    };
    var imageNotify = function (url, record) {
      var type = record.status === "error" ? "error" : "load";
      var els = imageElements(url);
      for (var i = 0; i < els.length; i++) {
        var el = els[i], key = url + "\n" + record.status;
        if (imageEvents.get(el) === key) continue;
        imageEvents.set(el, key);
        el.dispatchEvent(new W.Event(type, { bubbles: false }));
      }
    };
    var imageReset = function (url) {
      var els = imageElements(url);
      for (var i = 0; i < els.length; i++) imageEvents.delete(els[i]);
    };
    globalThis.__edgeImageSettle = function (url, record) {
      if (!record || (record.status !== "loaded" && record.status !== "error")) {
        // the renderer starts owning the source again: the next settle fires once more
        imageReset(url);
        return;
      }
      imageNotify(url, record);
      var list = imageWaiters.get(url);
      if (!list) return;
      imageWaiters.delete(url);
      var error = record.status === "error";
      for (var i = 0; i < list.length; i++) {
        if (error) list[i].reject(imageError());
        else list[i].resolve();
      }
    };
    var imageNumber = function (record, key, alias) {
      if (!record) return 0;
      var n = record[key];
      if (n == null) n = record[alias];
      n = Number(n);
      return isFinite(n) && n > 0 ? Math.round(n) : 0;
    };
    getter(P.HTMLImageElement, "naturalWidth", function () {
      return imageNumber(imageRecord(imageSource(this)), "width", "naturalWidth");
    });
    getter(P.HTMLImageElement, "naturalHeight", function () {
      return imageNumber(imageRecord(imageSource(this)), "height", "naturalHeight");
    });
    // complete is false only while the renderer's record says the source is still queued or
    // loading; a loaded or failed record (or no record at all, the snapshot path) is complete.
    getter(P.HTMLImageElement, "complete", function () {
      var src = imageSource(this);
      if (!src) return true;
      var record = imageRecord(src);
      return !record || (record.status !== "loading" && record.status !== "idle");
    });
    getter(P.HTMLImageElement, "currentSrc", function () { return imageSource(this); });
    def(P.HTMLImageElement, "decode", function () {
      var src = imageSource(this);
      if (!src) return Promise.reject(imageError());
      var record = imageRecord(src);
      // Decoding belongs to the renderer's resource_manager: the host publishes its real transition with
      // QuickJSDOM.setImageResource, and this function turns that transition into the load/error event and
      // the decode() result. TODO(size): the record's width/height are still missing (no engine binding
      // exposes the decoded size), so naturalWidth/naturalHeight stay 0 for now.
      if (record && record.promise && typeof record.promise.then === "function") return Promise.resolve(record.promise).then(function () {});
      return imageWait(src, record);
    });
    [P.HTMLImageElement, P.HTMLVideoElement, P.HTMLIFrameElement].forEach(function (p) {
      if (!Object.getOwnPropertyDescriptor(p, "width")) attrNumber(p, "width", "width", 0, 0);
      if (!Object.getOwnPropertyDescriptor(p, "height")) attrNumber(p, "height", "height", 0, 0);
    });
    reflectString(P.HTMLIFrameElement, "srcdoc", "srcdoc");
    reflectBool(P.HTMLIFrameElement, "allowFullscreen", "allowfullscreen");
    getter(P.HTMLIFrameElement, "contentWindow", function () { return null; });
    getter(P.HTMLIFrameElement, "contentDocument", function () { return null; });
    ["min", "max", "step", "pattern", "accept", "autocomplete"].forEach(function (n) { if (!Object.getOwnPropertyDescriptor(P.HTMLInputElement, n)) reflectString(P.HTMLInputElement, n, n); });
    reflectString(P.HTMLInputElement, "formTarget", "formtarget");
    reflectBool(P.HTMLInputElement, "formNoValidate", "formnovalidate");
    reflectString(P.HTMLInputElement, "dirName", "dirname");
    reflectString(P.HTMLInputElement, "inputMode", "inputmode");
    reflectString(P.HTMLInputElement, "useMap", "usemap");
    reflectString(P.HTMLInputElement, "align", "align");
    // input.size: the positive-integer reflection with a default of 20 and IndexSizeError on 0
    getter(P.HTMLInputElement, "size", function () {
      var n = parseInt(this.getAttribute("size"), 10);
      return isFinite(n) && n >= 1 && n <= 2147483647 ? n : 20;
    }, function (v) {
      var n = Number(v) >>> 0;
      if (n === 0) throw domError("IndexSizeError", "The value " + n + " cannot be set for the size property.");
      this.setAttribute("size", String(n >= 1 && n <= 2147483647 ? n : 20));
    });
    attrNumber(P.HTMLInputElement, "maxLength", "maxlength", -1, 0);
    attrNumber(P.HTMLInputElement, "minLength", "minlength", -1, 0);
    attrNumber(P.HTMLTextAreaElement, "maxLength", "maxlength", -1, 0);
    attrNumber(P.HTMLTextAreaElement, "minLength", "minlength", -1, 0);
    attrNumber(P.HTMLTextAreaElement, "rows", "rows", 2, 1);
    attrNumber(P.HTMLTextAreaElement, "cols", "cols", 20, 1);
    attrNumber(P.HTMLSelectElement, "size", "size", 0, 0);
    reflectString(P.HTMLTextAreaElement, "wrap", "wrap");
    reflectString(P.HTMLTextAreaElement, "autocomplete", "autocomplete");
    reflectString(P.HTMLTextAreaElement, "dirName", "dirname");
    reflectString(P.HTMLTextAreaElement, "inputMode", "inputmode");
    reflectString(P.HTMLSelectElement, "autocomplete", "autocomplete");
    reflectString(P.HTMLButtonElement, "formTarget", "formtarget");
    reflectBool(P.HTMLButtonElement, "formNoValidate", "formnovalidate");
    // the button's form overrides: formAction is a URL (absolute, as form.action), formMethod and
    // formEnctype are enumerated with the form's defaults for a value that is not one of theirs
    getter(P.HTMLButtonElement, "formAction", function () {
      var a = this.getAttribute("formaction");
      return a ? new URL(a, this.ownerDocument.baseURI || undefined).href : (this.ownerDocument.URL || "");
    }, function (v) { this.setAttribute("formaction", String(v)); });
    getter(P.HTMLButtonElement, "formMethod", function () {
      var m = (this.getAttribute("formmethod") || "").toLowerCase();
      return m === "post" || m === "dialog" ? m : "get";
    }, function (v) { this.setAttribute("formmethod", String(v)); });
    getter(P.HTMLButtonElement, "formEnctype", function () {
      var m = (this.getAttribute("formenctype") || "").toLowerCase();
      return m === "multipart/form-data" || m === "text/plain" ? m : "application/x-www-form-urlencoded";
    }, function (v) { this.setAttribute("formenctype", String(v)); });
    getter(P.HTMLInputElement, "defaultValue", function () { return this.getAttribute("value") || ""; }, function (v) { this.setAttribute("value", String(v)); });
    getter(P.HTMLInputElement, "defaultChecked", function () { return this.hasAttribute("checked"); }, function (v) { if (v) this.setAttribute("checked", ""); else this.removeAttribute("checked"); });
    getter(P.HTMLTextAreaElement, "defaultValue", function () { return this.textContent; }, function (v) { this.textContent = String(v); });
    getter(P.HTMLTextAreaElement, "textLength", function () { return this.value.length; });
    var INDET = new WeakMap();
    getter(P.HTMLInputElement, "indeterminate", function () { return !!INDET.get(this); }, function (v) { INDET.set(this, !!v); });
    getter(P.HTMLInputElement, "valueAsNumber", function () { var n = parseFloat(this.value); return isFinite(n) ? n : NaN; }, function (v) { this.value = String(v); });
    getter(P.HTMLInputElement, "valueAsDate", function () { var t = Date.parse(this.value); return isNaN(t) ? null : new Date(t); });
    // files: a FileList per input, empty until something can put files in (there is no DataTransfer yet)
    var FileList = function FileList() { illegal(); };
    FileList.prototype.item = function (i) { return i >= 0 && i < this.length ? this[i] : null; };
    FileList.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
    W.FileList = FileList;
    var FILES = new WeakMap();
    getter(P.HTMLInputElement, "files", function () {
      if (this.type !== "file") return null;
      var l = FILES.get(this);
      if (!l) { l = Object.create(FileList.prototype); l.length = 0; FILES.set(this, l); }
      return l;
    });
    getter(P.HTMLInputElement, "list", function () { var id = this.getAttribute("list"); return id ? this.ownerDocument.getElementById(id) : null; });
    var step = function (el, dir, n) {
      var cur = parseFloat(el.value), s = parseFloat(el.getAttribute("step")) || 1;
      el.value = String((isFinite(cur) ? cur : 0) + dir * s * (n === undefined ? 1 : n));
    };
    def(P.HTMLInputElement, "stepUp", function (n) { step(this, 1, n); });
    def(P.HTMLInputElement, "stepDown", function (n) { step(this, -1, n); });
    def(P.HTMLInputElement, "showPicker", function () {});
    // forms
    getter(P.HTMLFormElement, "action", function () { var a = this.getAttribute("action"); return a ? new URL(a, this.ownerDocument.baseURI || undefined).href : (this.ownerDocument.URL || ""); }, function (v) { this.setAttribute("action", String(v)); });
    getter(P.HTMLFormElement, "method", function () { var m = (this.getAttribute("method") || "").toLowerCase(); return m === "post" || m === "dialog" ? m : "get"; }, function (v) { this.setAttribute("method", String(v)); });
    getter(P.HTMLFormElement, "enctype", function () { var m = (this.getAttribute("enctype") || "").toLowerCase(); return m === "multipart/form-data" || m === "text/plain" ? m : "application/x-www-form-urlencoded"; }, function (v) { this.setAttribute("enctype", String(v)); });
    reflectBool(P.HTMLFormElement, "noValidate", "novalidate");
    reflectString(P.HTMLFormElement, "acceptCharset", "accept-charset");
    // validity: the constraints that need no locale
    var CUSTOM = new WeakMap();
    var flags = function (el) {
      var v = el.value === undefined || el.value === null ? "" : String(el.value), t = el.localName === "input" ? el.type : el.localName;
      var f = { valueMissing: false, typeMismatch: false, patternMismatch: false, tooLong: false, tooShort: false, rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false, customError: !!CUSTOM.get(el) };
      if (el.hasAttribute("required")) f.valueMissing = t === "checkbox" ? !el.checked : t === "radio" ? !(el.form || el.ownerDocument).querySelector('input[type=radio][name="' + el.name + '"]:checked') : v === "";
      if (v !== "") {
        var pat = el.getAttribute("pattern");
        if (pat && (t === "text" || t === "search" || t === "url" || t === "tel" || t === "email" || t === "password")) { try { f.patternMismatch = !new RegExp("^(?:" + pat + ")$", "u").test(v); } catch (e) { /* an invalid pattern is ignored */ } }
        if (t === "email") f.typeMismatch = !/^[^\s@]+@[^\s@]+$/.test(v);
        if (t === "url") { try { new URL(v); } catch (e) { f.typeMismatch = true; } }
        if (t === "number" || t === "range") {
          var n = parseFloat(v);
          if (!isFinite(n)) f.badInput = true;
          else {
            if (el.hasAttribute("min") && n < parseFloat(el.getAttribute("min"))) f.rangeUnderflow = true;
            if (el.hasAttribute("max") && n > parseFloat(el.getAttribute("max"))) f.rangeOverflow = true;
          }
        }
        var min = parseInt(el.getAttribute("minlength"), 10), max = parseInt(el.getAttribute("maxlength"), 10);
        if (isFinite(min) && v.length < min) f.tooShort = true;
        if (isFinite(max) && v.length > max) f.tooLong = true;
      }
      return f;
    };
    var barred = function (el) { return el.hasAttribute("disabled") || el.hasAttribute("readonly") && el.localName !== "select" || (el.localName === "input" && /^(hidden|reset|button|image|submit)$/.test(el.type)) || el.localName === "button" && el.type !== "submit" || el.localName === "fieldset" || el.localName === "output" || !!el.closest("datalist"); };
    var ValidityState = function ValidityState() { illegal(); };
    var VS = new WeakMap();
    var validity = function (el) {
      var o = VS.get(el);
      if (o) return o;
      o = Object.create(ValidityState.prototype);
      ["valueMissing", "typeMismatch", "patternMismatch", "tooLong", "tooShort", "rangeUnderflow", "rangeOverflow", "stepMismatch", "badInput", "customError"].forEach(function (k) {
        Object.defineProperty(o, k, { get: function () { return !barred(el) && flags(el)[k]; }, enumerable: true });
      });
      Object.defineProperty(o, "valid", { get: function () { if (barred(el)) return true; var f = flags(el); return !Object.keys(f).some(function (k) { return f[k]; }); }, enumerable: true });
      VS.set(el, o);
      return o;
    };
    W.ValidityState = ValidityState;
    ["HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLButtonElement", "HTMLFieldSetElement", "HTMLOutputElement"].forEach(function (n) {
      var p = P[n];
      getter(p, "validity", function () { return validity(this); });
      getter(p, "willValidate", function () { return !barred(this); });
      getter(p, "validationMessage", function () { return CUSTOM.get(this) || (this.validity.valid ? "" : "Please fill out this field."); });
      def(p, "setCustomValidity", function (m) { CUSTOM.set(this, String(m)); });
      def(p, "checkValidity", function () {
        if (this.validity.valid) return true;
        this.dispatchEvent(new W.Event("invalid", { cancelable: true }));
        return false;
      });
      def(p, "reportValidity", function () { return this.checkValidity(); });
    });
    var controls = function (form) { return Array.prototype.slice.call(form.elements).filter(function (e) { return typeof e.checkValidity === "function" && e.localName !== "fieldset"; }); };
    def(P.HTMLFormElement, "checkValidity", function () { return controls(this).map(function (c) { return c.checkValidity(); }).every(Boolean); });
    def(P.HTMLFormElement, "reportValidity", function () { return this.checkValidity(); });
    // select
    def(P.HTMLSelectElement, "add", function (opt, before) {
      if (typeof before === "number") before = this.options[before] || null;
      this.insertBefore(opt, before && before.parentNode === this ? before : null);
    });
    def(P.HTMLSelectElement, "item", function (i) { return this.options[i] || null; });
    def(P.HTMLSelectElement, "namedItem", function (n) { return Array.prototype.find.call(this.options, function (o) { return o.id === n || o.getAttribute("name") === n; }) || null; });
    // HTMLSelectElement.remove(index): an index outside the options removes nothing; with no
    // argument it is ChildNode.remove(), which removes the select itself (it must not be shadowed
    // by an early return, or select.remove() would silently keep the element in the tree)
    def(P.HTMLSelectElement, "remove", function (index) {
      if (arguments.length === 0) { P.Element.remove.call(this); return; }
      var opts = this.querySelectorAll("option");
      index = +index;
      if (opts[index]) opts[index].remove();
    });
    getter(P.HTMLOptionElement, "label", function () { var l = this.getAttribute("label"); return l !== null ? l : this.text; }, function (v) { this.setAttribute("label", String(v)); });
    // fieldset: its own type, and the listed elements inside it
    getter(P.HTMLFieldSetElement, "type", function () { return "fieldset"; });
    getter(P.HTMLFieldSetElement, "elements", function () {
      var fs = this;
      return liveCollection(function () { return Array.prototype.slice.call(fs.querySelectorAll(CONTROLS)); }, false, "HTMLCollection");
    });
    // output: value is its text, the default is the text until a value write takes an override
    var OUTPUT_FOR = Symbol("outputFor");
    getter(P.HTMLOutputElement, "type", function () { return "output"; });
    getter(P.HTMLOutputElement, "value", function () { return this.textContent; }, function (v) {
      this[OUTDEF] = this.defaultValue;
      this.textContent = String(v);
    });
    getter(P.HTMLOutputElement, "defaultValue", function () {
      return this[OUTDEF] !== undefined ? this[OUTDEF] : this.textContent;
    }, function (v) {
      if (this[OUTDEF] !== undefined) this[OUTDEF] = String(v);
      else this.textContent = String(v);
    });
    getter(P.HTMLOutputElement, "htmlFor", function () {
      var el = this;
      return this[OUTPUT_FOR] || Object.defineProperty(this, OUTPUT_FOR, {
        value: new TokenList({
          getAttribute: function () { return el.getAttribute("for"); },
          hasAttribute: function () { return el.hasAttribute("for"); },
          setAttribute: function (n, v) { el.setAttribute("for", v); },
        }),
      })[OUTPUT_FOR];
    });
    // datalist: the options inside it
    getter(P.HTMLDataListElement, "options", function () {
      var dl = this;
      return liveCollection(function () { return Array.prototype.slice.call(dl.querySelectorAll("option")); }, false, "HTMLCollection");
    });
    // tables
    var rowsOf = function (table) {
      var out = [];
      for (var c = table.firstElementChild; c; c = c.nextElementSibling) if (c.localName === "thead") out.push.apply(out, Array.prototype.slice.call(c.children).filter(function (r) { return r.localName === "tr"; }));
      for (c = table.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName === "tr") out.push(c);
        else if (c.localName === "tbody") out.push.apply(out, Array.prototype.slice.call(c.children).filter(function (r) { return r.localName === "tr"; }));
      }
      for (c = table.firstElementChild; c; c = c.nextElementSibling) if (c.localName === "tfoot") out.push.apply(out, Array.prototype.slice.call(c.children).filter(function (r) { return r.localName === "tr"; }));
      return out;
    };
    var child = function (el, name) { for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c; return null; };
    getter(P.HTMLTableElement, "rows", function () { var t = this; return liveCollection(function () { return rowsOf(t); }, false, "HTMLCollection"); });
    getter(P.HTMLTableElement, "tBodies", function () { var t = this; return liveCollection(function () { return Array.prototype.filter.call(t.children, function (c) { return c.localName === "tbody"; }); }, false, "HTMLCollection"); });
    getter(P.HTMLTableElement, "tHead", function () { return child(this, "thead"); });
    getter(P.HTMLTableElement, "tFoot", function () { return child(this, "tfoot"); });
    getter(P.HTMLTableElement, "caption", function () { return child(this, "caption"); });
    var section = function (table, name, before) {
      var s = child(table, name);
      if (!s) { s = table.ownerDocument.createElement(name); table.insertBefore(s, before ? before(table) : null); }
      return s;
    };
    def(P.HTMLTableElement, "createTHead", function () { return section(this, "thead", function (t) { return child(t, "caption") ? child(t, "caption").nextSibling : t.firstChild; }); });
    def(P.HTMLTableElement, "createTFoot", function () { return section(this, "tfoot"); });
    def(P.HTMLTableElement, "createCaption", function () { return section(this, "caption", function (t) { return t.firstChild; }); });
    def(P.HTMLTableElement, "createTBody", function () {
      var b = this.ownerDocument.createElement("tbody"), last = null;
      for (var c = this.firstElementChild; c; c = c.nextElementSibling) if (c.localName === "tbody") last = c;
      this.insertBefore(b, last ? last.nextSibling : child(this, "tfoot"));
      return b;
    });
    def(P.HTMLTableElement, "deleteTHead", function () { var s = child(this, "thead"); if (s) s.remove(); });
    def(P.HTMLTableElement, "deleteTFoot", function () { var s = child(this, "tfoot"); if (s) s.remove(); });
    def(P.HTMLTableElement, "deleteCaption", function () { var s = child(this, "caption"); if (s) s.remove(); });
    def(P.HTMLTableElement, "insertRow", function (index) {
      index = index === undefined ? -1 : +index;
      var rows = rowsOf(this);
      if (index < -1 || index > rows.length) throw domError("IndexSizeError", "The provided index (" + index + ") is outside the range [-1, " + rows.length + "].");
      var tr = this.ownerDocument.createElement("tr");
      if (index === -1 || index === rows.length) {
        var parent = rows.length ? rows[rows.length - 1].parentNode : null;
        if (!parent) { parent = this.querySelector("tbody") || (function (t) { var b = t.ownerDocument.createElement("tbody"); t.appendChild(b); return b; })(this); }
        parent.appendChild(tr);
      } else rows[index].parentNode.insertBefore(tr, rows[index]);
      return tr;
    });
    def(P.HTMLTableElement, "deleteRow", function (index) {
      var rows = rowsOf(this);
      index = +index;
      if (index === -1) index = rows.length - 1;
      if (index < -1 || index >= rows.length) throw domError("IndexSizeError", "The provided index (" + index + ") is outside the range [-1, " + (rows.length - 1) + "].");
      if (rows[index]) rows[index].remove();
    });
    // a section's own rows and row editing (the table's work over all of them)
    var sectionRows = function (s) { return Array.prototype.filter.call(s.children, function (c) { return c.localName === "tr"; }); };
    getter(P.HTMLTableSectionElement, "rows", function () { var s = this; return liveCollection(function () { return sectionRows(s); }, false, "HTMLCollection"); });
    def(P.HTMLTableSectionElement, "insertRow", function (index) {
      index = index === undefined ? -1 : +index;
      var rows = sectionRows(this);
      if (index < -1 || index > rows.length) throw domError("IndexSizeError", "The provided index (" + index + ") is outside the range [-1, " + rows.length + "].");
      var tr = this.ownerDocument.createElement("tr");
      this.insertBefore(tr, index === -1 || index === rows.length ? null : rows[index]);
      return tr;
    });
    def(P.HTMLTableSectionElement, "deleteRow", function (index) {
      var rows = sectionRows(this);
      index = +index;
      if (index === -1) index = rows.length - 1;
      if (index < -1 || index >= rows.length) throw domError("IndexSizeError", "The provided index (" + index + ") is outside the range [-1, " + (rows.length - 1) + "].");
      if (rows[index]) rows[index].remove();
    });
    var cellsOf = function (tr) { return Array.prototype.filter.call(tr.children, function (c) { return c.localName === "td" || c.localName === "th"; }); };
    getter(P.HTMLTableRowElement, "cells", function () { var t = this; return liveCollection(function () { return cellsOf(t); }, false, "HTMLCollection"); });
    getter(P.HTMLTableRowElement, "rowIndex", function () {
      var t = this.closest("table");
      return t ? rowsOf(t).indexOf(this) : -1;
    });
    getter(P.HTMLTableRowElement, "sectionRowIndex", function () { return Array.prototype.filter.call(this.parentNode ? this.parentNode.children : [], function (c) { return c.localName === "tr"; }).indexOf(this); });
    def(P.HTMLTableRowElement, "insertCell", function (index) {
      index = index === undefined ? -1 : +index;
      var cells = cellsOf(this);
      if (index < -1 || index > cells.length) throw domError("IndexSizeError", "The provided index (" + index + ") is outside the range [-1, " + cells.length + "].");
      var td = this.ownerDocument.createElement("td");
      this.insertBefore(td, index === -1 || index === cells.length ? null : cells[index]);
      return td;
    });
    def(P.HTMLTableRowElement, "deleteCell", function (index) {
      var cells = cellsOf(this);
      index = +index;
      if (index === -1) index = cells.length - 1;
      if (index < -1 || index >= cells.length) throw domError("IndexSizeError", "The provided index (" + index + ") is outside the range [-1, " + (cells.length - 1) + "].");
      if (cells[index]) cells[index].remove();
    });
    attrNumber(P.HTMLTableCellElement, "colSpan", "colspan", 1, 1);
    attrNumber(P.HTMLTableCellElement, "rowSpan", "rowspan", 1, 0);
    getter(P.HTMLTableCellElement, "cellIndex", function () { return this.parentNode ? cellsOf(this.parentNode).indexOf(this) : -1; });
    reflectString(P.HTMLTableCellElement, "abbr", "abbr");
    reflectString(P.HTMLTableCellElement, "scope", "scope");
    reflectString(P.HTMLTableCellElement, "headers", "headers");
    reflectString(P.HTMLMetaElement, "httpEquiv", "http-equiv");
    reflectString(P.HTMLMetaElement, "content", "content");
    reflectString(P.HTMLBodyElement, "background", "background");
    // relList: the rel attribute as a token list
    var RL = Symbol("relList");
    var relProxy = function (el) {
      return { getAttribute: function () { return el.getAttribute("rel"); }, hasAttribute: function () { return el.hasAttribute("rel"); }, setAttribute: function (n, v) { el.setAttribute("rel", v); } };
    };
    ["HTMLAnchorElement", "HTMLLinkElement"].forEach(function (n) {
      getter(P[n], "relList", function () { return this[RL] || Object.defineProperty(this, RL, { value: new TokenList(relProxy(this)) })[RL]; });
    });
    // members every element has
    getter(P.Element, "assignedSlot", function () { return null; });
    getter(P.HTMLElement, "offsetParent", function () { return null; });
    getter(P.Element, "clientTop", function () { return 0; });
    getter(P.Element, "clientLeft", function () { return 0; });
    nullable(P.HTMLElement, "nonce", "nonce");
    nullable(P.Element, "role", "role");
    // the ARIAMixin string reflections: every aria* IDL property mirrors its aria-* attribute.
    // The attribute names are NOT a mechanical kebab-casing of the IDL names (ariaValueNow mirrors
    // aria-valuenow, ariaReadOnly mirrors aria-readonly, ...), so the pairs are spelled out.
    // (The element-reference ones — ariaControls, ariaLabelledBy, ... — are not string reflections
    // and jsdom does not define them either.)
    [["ariaAtomic", "aria-atomic"], ["ariaAutoComplete", "aria-autocomplete"], ["ariaBusy", "aria-busy"], ["ariaChecked", "aria-checked"], ["ariaColCount", "aria-colcount"], ["ariaColIndex", "aria-colindex"], ["ariaColIndexText", "aria-colindextext"], ["ariaColSpan", "aria-colspan"], ["ariaCurrent", "aria-current"], ["ariaDescription", "aria-description"], ["ariaDisabled", "aria-disabled"], ["ariaExpanded", "aria-expanded"], ["ariaHasPopup", "aria-haspopup"], ["ariaHidden", "aria-hidden"], ["ariaInvalid", "aria-invalid"], ["ariaKeyShortcuts", "aria-keyshortcuts"], ["ariaLabel", "aria-label"], ["ariaLevel", "aria-level"], ["ariaLive", "aria-live"], ["ariaModal", "aria-modal"], ["ariaMultiLine", "aria-multiline"], ["ariaMultiSelectable", "aria-multiselectable"], ["ariaOrientation", "aria-orientation"], ["ariaPlaceholder", "aria-placeholder"], ["ariaPosInSet", "aria-posinset"], ["ariaPressed", "aria-pressed"], ["ariaReadOnly", "aria-readonly"], ["ariaRelevant", "aria-relevant"], ["ariaRequired", "aria-required"], ["ariaRoleDescription", "aria-roledescription"], ["ariaRowCount", "aria-rowcount"], ["ariaRowIndex", "aria-rowindex"], ["ariaRowIndexText", "aria-rowindextext"], ["ariaRowSpan", "aria-rowspan"], ["ariaSelected", "aria-selected"], ["ariaSetSize", "aria-setsize"], ["ariaSort", "aria-sort"], ["ariaValueMax", "aria-valuemax"], ["ariaValueMin", "aria-valuemin"], ["ariaValueNow", "aria-valuenow"], ["ariaValueText", "aria-valuetext"]].forEach(function (pair) {
      nullable(P.Element, pair[0], pair[1]);
    });
    getter(P.HTMLElement, "draggable", function () { return this.getAttribute("draggable") === "true"; }, function (v) { this.setAttribute("draggable", v ? "true" : "false"); });
  })();

  var ShadowRoot = function ShadowRoot() { illegal(); };
  Object.setPrototypeOf(ShadowRoot, D.ctors.DocumentFragment);
  ShadowRoot.prototype = Object.create(P.DocumentFragment, { constructor: { value: ShadowRoot, writable: true, configurable: true } });
  Object.defineProperty(ShadowRoot, Symbol.hasInstance, { value: function (x) { return !!x && x.nodeType === 11 && !!x.host; } });
  W.ShadowRoot = ShadowRoot;
  // adopted sheets are kept (a shadow root is a native fragment, so the property lives there)
  [P.DocumentFragment, P.Document].forEach(function (proto) {
    if (Object.getOwnPropertyDescriptor(proto, "adoptedStyleSheets")) return;
    getter(proto, "adoptedStyleSheets", function () { return this.__adopted || (this.__adopted = []); }, function (v) { this.__adopted = Array.prototype.slice.call(v); });
  });
  // a shadow root has an innerHTML like an element's
  if (!Object.getOwnPropertyDescriptor(P.DocumentFragment, "innerHTML")) {
    getter(P.DocumentFragment, "innerHTML", function () { return D.serialize(this); }, function (html) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.appendChild(D.parseFragment(String(html), this.ownerDocument));
    });
  }
})();
