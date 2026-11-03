// The parts of the native DOM (csrc/nativedom*.h) that are easier in JavaScript, on top of the C nodes:
// ChildNode / ParentNode mixins, classList, dataset, attributes, insertAdjacent*, outerHTML.
// It only adds to the prototypes in __native.dom.protos, so it is harmless when nothing uses them.
(function () {
  var D = globalThis.__native && globalThis.__native.dom;
  if (!D || D.__layered) return;
  D.__layered = true;
  var P = D.protos;
  var def = function (proto, name, value) {
    Object.defineProperty(proto, name, { value: value, writable: true, configurable: true });
  };
  var getter = function (proto, name, get, set) {
    Object.defineProperty(proto, name, { get: get, set: set, configurable: true });
  };
  var isNode = function (x) { return x !== null && typeof x === "object" && typeof x.nodeType === "number"; };
  var docOf = function (n) { return n.nodeType === 9 ? n : n.ownerDocument; };
  // strings become text nodes; several nodes travel in a fragment
  var toNode = function (doc, args) {
    if (args.length === 1) return isNode(args[0]) ? args[0] : doc.createTextNode(String(args[0]));
    var f = doc.createDocumentFragment();
    for (var i = 0; i < args.length; i++) f.appendChild(isNode(args[i]) ? args[i] : doc.createTextNode(String(args[i])));
    return f;
  };

  // ParentNode
  [P.Element, P.Document, P.DocumentFragment].forEach(function (proto) {
    def(proto, "append", function () { this.appendChild(toNode(docOf(this), arguments)); });
    def(proto, "prepend", function () {
      if (arguments.length) this.insertBefore(toNode(docOf(this), arguments), this.firstChild);
    });
    def(proto, "replaceChildren", function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      if (arguments.length) this.appendChild(toNode(docOf(this), arguments));
    });
  });

  // ChildNode
  [P.Element, P.CharacterData, P.DocumentType].forEach(function (proto) {
    def(proto, "remove", function () { if (this.parentNode) this.parentNode.removeChild(this); });
    def(proto, "before", function () {
      var p = this.parentNode;
      if (!p || !arguments.length) return;
      // the arguments may include this node's own previous siblings: find the anchor that stays
      var args = Array.prototype.slice.call(arguments);
      var anchor = this.previousSibling;
      while (anchor && args.indexOf(anchor) >= 0) anchor = anchor.previousSibling;
      p.insertBefore(toNode(docOf(this), args), anchor ? anchor.nextSibling : p.firstChild);
    });
    def(proto, "after", function () {
      var p = this.parentNode;
      if (!p || !arguments.length) return;
      var args = Array.prototype.slice.call(arguments);
      var anchor = this.nextSibling;
      while (anchor && args.indexOf(anchor) >= 0) anchor = anchor.nextSibling;
      p.insertBefore(toNode(docOf(this), args), anchor);
    });
    def(proto, "replaceWith", function () {
      var p = this.parentNode;
      if (!p) return;
      var args = Array.prototype.slice.call(arguments);
      var anchor = this.nextSibling;
      while (anchor && args.indexOf(anchor) >= 0) anchor = anchor.nextSibling;
      if (args.indexOf(this) >= 0) {
        p.insertBefore(toNode(docOf(this), args.filter(function (a) { return a !== this; }, this)), anchor);
        return;
      }
      p.removeChild(this);
      if (args.length) p.insertBefore(toNode(docOf(this), args), anchor);
    });
  });

  // insertAdjacent*
  var adjacent = function (el, where, node) {
    switch (String(where).toLowerCase()) {
      case "beforebegin": if (!el.parentNode) return null; el.parentNode.insertBefore(node, el); return node;
      case "afterbegin": el.insertBefore(node, el.firstChild); return node;
      case "beforeend": el.appendChild(node); return node;
      case "afterend": if (!el.parentNode) return null; el.parentNode.insertBefore(node, el.nextSibling); return node;
    }
    var e = new Error("The value provided ('" + where + "') is not one of 'beforeBegin', 'afterBegin', 'beforeEnd', or 'afterEnd'.");
    e.name = "SyntaxError";
    throw e;
  };
  def(P.Element, "insertAdjacentElement", function (where, el) { return adjacent(this, where, el); });
  def(P.Element, "insertAdjacentText", function (where, text) { adjacent(this, where, this.ownerDocument.createTextNode(String(text))); });
  // HTML set inside script, style, textarea ...: their content is text, not markup (what a "<" starts there is not a tag)
  var RAW_TEXT = { script: 1, style: 1, xmp: 1, iframe: 1, noembed: 1, noframes: 1, noscript: 1, plaintext: 1, textarea: 2, title: 2 };
  var rawTextOf = function (ctx, html) {
    var kind = ctx && ctx.nodeType === 1 ? RAW_TEXT[ctx.localName] : 0;
    if (!kind) return null;
    if (kind === 1) return html;
    var tmp = D.parseFragment("<" + ctx.localName + ">" + html + "</" + ctx.localName + ">", ctx.ownerDocument); // character references
    return tmp.firstChild ? tmp.firstChild.textContent : "";
  };
  (function () {
    var d = Object.getOwnPropertyDescriptor(P.Element, "innerHTML");
    if (!d || !d.set) return;
    var set = d.set;
    Object.defineProperty(P.Element, "innerHTML", {
      get: d.get, configurable: true,
      set: function (v) {
        var text = RAW_TEXT[this.localName] ? rawTextOf(this, v === null ? "" : String(v)) : null;
        if (text === null) set.call(this, v); else this.textContent = text;
      },
    });
  })();
  def(P.Element, "insertAdjacentHTML", function (where, html) {
    html = String(html);
    var w = String(where).toLowerCase(), text = rawTextOf(w === "beforebegin" || w === "afterend" ? this.parentNode : this, html);
    var frag;
    if (text === null) frag = D.parseFragment(html, this.ownerDocument);
    else { frag = this.ownerDocument.createDocumentFragment(); if (text) frag.appendChild(this.ownerDocument.createTextNode(text)); }
    adjacent(this, where, frag);
  });

  var outerDesc = Object.getOwnPropertyDescriptor(P.Element, "outerHTML");
  getter(P.Element, "outerHTML", outerDesc.get, function (html) {
    var p = this.parentNode;
    if (!p) return;
    if (p.nodeType === 9) {
      var e = new Error("Failed to set the 'outerHTML' property on 'Element': This element's parent is of type '#document'.");
      e.name = "NoModificationAllowedError";
      throw e;
    }
    p.replaceChild(D.parseFragment(String(html), this.ownerDocument), this);
  });
  getter(P.Element, "innerText", function () { return this.textContent; }, function (v) { this.textContent = v; });

  // attributes: a snapshot with the shape of a NamedNodeMap
  getter(P.Element, "attributes", function () {
    var el = this, names = el.getAttributeNames(), map = { length: names.length };
    names.forEach(function (name, i) {
      var attr = { name: name, localName: name, value: el.getAttribute(name), ownerElement: el, nodeType: 2, specified: true };
      map[i] = attr;
      map[name] = attr;
    });
    def(map, "item", function (i) { return map[i] || null; });
    def(map, "getNamedItem", function (n) { return Object.prototype.hasOwnProperty.call(map, n) && typeof map[n] === "object" ? map[n] : null; });
    def(map, Symbol.iterator, function () { return Array.prototype.slice.call(map, 0)[Symbol.iterator](); });
    return map;
  });
  def(P.Element, "toggleAttribute", function (name, force) {
    var has = this.hasAttribute(name);
    if (force === undefined ? has : !force) {
      this.removeAttribute(name);
      return false;
    }
    if (!has) this.setAttribute(name, "");
    return true;
  });

  // classList: a DOMTokenList over the class attribute
  var tokens = function (el) {
    var v = el.getAttribute("class");
    return v ? v.split(/[ \t\n\f\r]+/).filter(Boolean) : [];
  };
  var check = function (t) {
    t = String(t);
    if (t === "") { var e = new Error("The token provided must not be empty."); e.name = "SyntaxError"; throw e; }
    if (/[ \t\n\f\r]/.test(t)) { var e2 = new Error("The token provided ('" + t + "') contains HTML space characters, which are not valid in tokens."); e2.name = "InvalidCharacterError"; throw e2; }
    return t;
  };
  var TokenList = function (el) { Object.defineProperty(this, "_el", { value: el }); };
  var write = function (list, arr) {
    var seen = [];
    arr.forEach(function (t) { if (seen.indexOf(t) < 0) seen.push(t); });
    // an element without a class attribute and nothing to put in it stays without one
    if (!seen.length && !list._el.hasAttribute("class")) return;
    list._el.setAttribute("class", seen.join(" "));
  };
  def(TokenList.prototype, "contains", function (t) { return tokens(this._el).indexOf(String(t)) >= 0; });
  def(TokenList.prototype, "add", function () {
    var cur = tokens(this._el);
    for (var i = 0; i < arguments.length; i++) { var t = check(arguments[i]); if (cur.indexOf(t) < 0) cur.push(t); }
    write(this, cur);
  });
  def(TokenList.prototype, "remove", function () {
    var cur = tokens(this._el);
    for (var i = 0; i < arguments.length; i++) { var t = check(arguments[i]); cur = cur.filter(function (x) { return x !== t; }); }
    write(this, cur);
  });
  def(TokenList.prototype, "toggle", function (t, force) {
    t = check(t);
    var has = tokens(this._el).indexOf(t) >= 0;
    if (has && force !== true) { this.remove(t); return false; }
    if (!has && force !== false) { this.add(t); return true; }
    return has;
  });
  def(TokenList.prototype, "replace", function (a, b) {
    a = check(a); b = check(b);
    var cur = tokens(this._el), i = cur.indexOf(a);
    if (i < 0) return false;
    cur[i] = b;
    write(this, cur);
    return true;
  });
  def(TokenList.prototype, "item", function (i) { var c = tokens(this._el); return i in c ? c[i] : null; });
  def(TokenList.prototype, "forEach", function (fn, thisArg) { tokens(this._el).forEach(function (t, i) { fn.call(thisArg, t, i, this); }, this); });
  def(TokenList.prototype, "toString", function () { return this._el.getAttribute("class") || ""; });
  def(TokenList.prototype, Symbol.iterator, function () { return tokens(this._el)[Symbol.iterator](); });
  getter(TokenList.prototype, "length", function () { return tokens(this._el).length; });
  getter(TokenList.prototype, "value", function () { return this._el.getAttribute("class") || ""; }, function (v) { this._el.setAttribute("class", String(v)); });
  var CL = Symbol("classList");
  getter(P.Element, "classList", function () { return this[CL] || (this[CL] = new TokenList(this)); });

  // dataset: data-* attributes as camelCase properties
  var DOMStringMap = function DOMStringMap() { throw new TypeError("Illegal constructor"); };
  var toAttr = function (key) { return "data-" + String(key).replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); }); };
  var toKey = function (attr) { return attr.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); };
  var DS = Symbol("dataset");
  getter(P.Element, "dataset", function () {
    if (this[DS]) return this[DS];
    var el = this;
    return (this[DS] = new Proxy(Object.create(DOMStringMap.prototype), {
      // a data-* attribute wins; anything else (constructor, toString, ...) falls through to the prototype
      get: function (target, key) { if (typeof key !== "string") return Reflect.get(target, key); var v = el.getAttribute(toAttr(key)); return v === null ? Reflect.get(target, key) : v; },
      set: function (_, key, value) { if (typeof key === "string") el.setAttribute(toAttr(key), String(value)); return true; },
      has: function (_, key) { return typeof key === "string" && el.hasAttribute(toAttr(key)); },
      deleteProperty: function (_, key) { if (typeof key === "string") el.removeAttribute(toAttr(key)); return true; },
      ownKeys: function () { return el.getAttributeNames().filter(function (n) { return n.indexOf("data-") === 0; }).map(toKey); },
      getOwnPropertyDescriptor: function (_, key) {
        if (typeof key !== "string" || !el.hasAttribute(toAttr(key))) return undefined;
        return { value: el.getAttribute(toAttr(key)), writable: true, enumerable: true, configurable: true };
      },
    }));
  });

  // EventTarget: listeners per node, dispatch through the capture / target / bubble phases along the parent chain
  var LISTENERS = new WeakMap();
  var listenerOptions = function (o) {
    return typeof o === "boolean" ? { capture: o } : o && typeof o === "object" ? o : {};
  };
  var addListener = function (type, fn, opts) {
    if (fn == null) return;
    opts = listenerOptions(opts);
    var all = LISTENERS.get(this);
    if (!all) LISTENERS.set(this, (all = {}));
    var list = all[type] || (all[type] = []), capture = !!opts.capture;
    // an index by function keeps the duplicate check (and removal) from walking a list of thousands
    var idx = list.idx || Object.defineProperty(list, "idx", { value: new Map() }).idx, same = idx.get(fn);
    if (same) for (var i = 0; i < same.length; i++) if (same[i].capture === capture) return;
    var entry = { fn: fn, capture: capture, once: !!opts.once, passive: !!opts.passive, removed: false };
    list.push(entry);
    if (same) same.push(entry); else idx.set(fn, [entry]);
    var node = this;
    if (opts.signal) opts.signal.addEventListener("abort", function () { removeListener.call(node, type, fn, { capture: capture }); });
  };
  var removeListener = function (type, fn, opts) {
    var all = LISTENERS.get(this), list = all && all[type], capture = !!listenerOptions(opts).capture;
    if (!list || !list.idx) return;
    var same = list.idx.get(fn);
    if (!same) return;
    for (var i = 0; i < same.length; i++) {
      if (same[i].capture === capture) {
        var entry = same[i];
        entry.removed = true;
        same.splice(i, 1);
        if (!same.length) list.idx.delete(fn);
        // left in place (invoke skips it) and swept out once they are half the list: a splice per removal is quadratic
        list.idx.dead = (list.idx.dead || 0) + 1;
        if (list.idx.dead > 32 && list.idx.dead * 2 > list.length) {
          var live = list.filter(function (x) { return !x.removed; });
          list.length = 0;
          for (var k = 0; k < live.length; k++) list.push(live[k]);
          list.idx.dead = 0;
        }
        return;
      }
    }
  };
  var invoke = function (node, ev, phase) {
    var all = LISTENERS.get(node), list = all && all[ev.type];
    ev.currentTarget = node;
    ev.eventPhase = phase;
    if (list) {
      list = list.slice();
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (entry.removed) continue;
        if (phase === 1 && !entry.capture) continue;
        if (phase === 3 && entry.capture) continue;
        if (entry.once) removeListener.call(node, ev.type, entry.fn, { capture: entry.capture });
        try {
          if (typeof entry.fn === "function") entry.fn.call(node, ev);
          else if (entry.fn && typeof entry.fn.handleEvent === "function") entry.fn.handleEvent(ev);
        } catch (e) {
          // an exception in a listener is reported and does not stop the others
          if (typeof globalThis.reportError === "function") globalThis.reportError(e);
          else if (globalThis.console) globalThis.console.error(e);
        }
        if (ev._stopImmediatePropagationFlag) return;
      }
    }
    // on<type> handler properties
    var handler = node["on" + ev.type];
    if (phase !== 1 && typeof handler === "function") {
      try { handler.call(node, ev); } catch (e) { if (globalThis.console) globalThis.console.error(e); }
    }
  };
  var parentOf = function (n) {
    if (n.parentNode) return n.parentNode;
    if (n.nodeType === 9) return n.defaultView && n.defaultView !== n ? n.defaultView : null;
    return null;
  };
  var dispatch = function (ev) {
    if (!ev || typeof ev.type !== "string") throw new TypeError("The event provided is not an Event.");
    var path = [], n = this;
    for (; n; n = parentOf(n)) path.push(n);
    ev.target = ev.srcElement = this;
    ev._path = path.map(function (x) { return { currentTarget: x }; });
    ev.cancelBubble = false;
    ev._stopImmediatePropagationFlag = false;
    var i;
    for (i = path.length - 1; i > 0 && !ev.cancelBubble; i--) invoke(path[i], ev, 1);
    if (!ev.cancelBubble) invoke(this, ev, 2);
    if (ev.bubbles) for (i = 1; i < path.length && !ev.cancelBubble; i++) invoke(path[i], ev, 3);
    ev.currentTarget = null;
    ev.eventPhase = 0;
    return !ev.defaultPrevented;
  };
  [P.Node].forEach(function (proto) {
    def(proto, "addEventListener", addListener);
    def(proto, "removeEventListener", removeListener);
    def(proto, "dispatchEvent", dispatch);
  });
  var fire = function (el, type, bubbles) {
    var E = globalThis.Event;
    return el.dispatchEvent(new E(type, { bubbles: bubbles, cancelable: true }));
  };
  def(P.HTMLElement, "click", function () { if (!this.disabled) fire(this, "click", true); });
  def(P.HTMLElement, "focus", function () { fire(this, "focus", false); fire(this, "focusin", true); });
  def(P.HTMLElement, "blur", function () { fire(this, "blur", false); fire(this, "focusout", true); });

  // MutationObserver. The C nodes have no hooks, so the primitive mutators are wrapped, and only once an observer
  // exists: pages that never observe pay nothing.
  var observers = [];
  var wrapped = false;
  var interested = function (target, init, node) {
    // an observer sees a mutation at `node` when it observes it, or an ancestor with `subtree`
    for (var n = node; n; n = n.parentNode) {
      for (var i = 0; i < observers.length; i++) {
        var o = observers[i], opt = o._nodes.get(n);
        if (opt && (n === node || opt.subtree)) init(o, opt);
      }
    }
  };
  var queue = function (o, rec) {
    o._records.push(rec);
    if (o._scheduled) return;
    o._scheduled = true;
    globalThis.__nativePromise.resolve().then(function () {
      o._scheduled = false;
      var recs = o._records.splice(0);
      if (recs.length) o._callback.call(o, recs, o);
    });
  };
  var MutationRecord = function MutationRecord() { throw new TypeError("Illegal constructor"); };
  var record = function (type, target, extra) {
    var base = { type: type, target: target, addedNodes: [], removedNodes: [], previousSibling: null, nextSibling: null, attributeName: null, attributeNamespace: null, oldValue: null };
    interested(target, function (o, opt) {
      if (type === "childList" && !opt.childList) return;
      if (type === "attributes" && (!opt.attributes || (opt.attributeFilter && opt.attributeFilter.indexOf(extra.attributeName) < 0))) return;
      if (type === "characterData" && !opt.characterData) return;
      var rec = Object.assign(Object.create(MutationRecord.prototype), base, extra);
      if (!((type === "attributes" && opt.attributeOldValue) || (type === "characterData" && opt.characterDataOldValue))) rec.oldValue = null;
      queue(o, rec);
    }, target);
  };
  var kids = function (n) { return n.nodeType === 11 ? Array.prototype.slice.call(n.childNodes) : [n]; };
  var wrap = function (proto, name, make) {
    var d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d) return;
    if (typeof d.value === "function") {
      var orig = d.value;
      Object.defineProperty(proto, name, { value: make(orig), writable: true, configurable: true });
    } else if (d.set) {
      var set = d.set;
      Object.defineProperty(proto, name, { get: d.get, set: make(set), configurable: true });
    }
  };
  var removedFrom = function (node) {
    var p = node.parentNode;
    if (p) record("childList", p, { removedNodes: [node], previousSibling: node.previousSibling, nextSibling: node.nextSibling });
  };
  var install = function () {
    if (wrapped) return;
    wrapped = true;
    [P.Node].forEach(function (proto) {
      wrap(proto, "appendChild", function (orig) {
        return function (node) {
          var added = kids(node), before = this.lastChild;
          if (node.nodeType !== 11) removedFrom(node);
          var r = orig.call(this, node);
          if (added.length) record("childList", this, { addedNodes: added, previousSibling: before });
          return r;
        };
      });
      wrap(proto, "insertBefore", function (orig) {
        return function (node, ref) {
          var added = kids(node), prev = ref ? ref.previousSibling : this.lastChild;
          if (node.nodeType !== 11 && node !== ref) removedFrom(node);
          var r = orig.call(this, node, ref);
          if (added.length) record("childList", this, { addedNodes: added, previousSibling: prev, nextSibling: ref || null });
          return r;
        };
      });
      wrap(proto, "removeChild", function (orig) {
        return function (node) {
          var prev = node.previousSibling, next = node.nextSibling, r = orig.call(this, node);
          record("childList", this, { removedNodes: [node], previousSibling: prev, nextSibling: next });
          return r;
        };
      });
      wrap(proto, "replaceChild", function (orig) {
        return function (node, old) {
          var added = kids(node), prev = old.previousSibling, next = old.nextSibling;
          if (node.nodeType !== 11 && node !== old) removedFrom(node);
          var r = orig.call(this, node, old);
          record("childList", this, { addedNodes: added, removedNodes: [old], previousSibling: prev, nextSibling: next });
          return r;
        };
      });
      wrap(proto, "textContent", function (set) {
        return function (v) {
          if (this.nodeType === 3 || this.nodeType === 8) {
            var old = this.data;
            set.call(this, v);
            record("characterData", this, { oldValue: old });
            return;
          }
          var removed = Array.prototype.slice.call(this.childNodes);
          set.call(this, v);
          var added = Array.prototype.slice.call(this.childNodes);
          if (removed.length || added.length) record("childList", this, { addedNodes: added, removedNodes: removed });
        };
      });
    });
    wrap(P.Element, "innerHTML", function (set) {
      return function (v) {
        var removed = Array.prototype.slice.call(this.childNodes);
        set.call(this, v);
        var added = Array.prototype.slice.call(this.childNodes);
        if (removed.length || added.length) record("childList", this, { addedNodes: added, removedNodes: removed });
      };
    });
    wrap(P.CharacterData, "data", function (set) {
      return function (v) {
        var old = this.data;
        set.call(this, v);
        record("characterData", this, { oldValue: old });
      };
    });
    wrap(P.Element, "setAttribute", function (orig) {
      return function (name, value) {
        var old = this.getAttribute(name);
        orig.call(this, name, value);
        record("attributes", this, { attributeName: String(name).toLowerCase(), oldValue: old });
      };
    });
    wrap(P.Element, "removeAttribute", function (orig) {
      return function (name) {
        var old = this.getAttribute(name);
        orig.call(this, name);
        if (old !== null) record("attributes", this, { attributeName: String(name).toLowerCase(), oldValue: old });
      };
    });
  };
  var MutationObserver = function MutationObserver(callback) {
    if (typeof callback !== "function") throw new TypeError("The callback provided as parameter 1 is not a function.");
    Object.defineProperties(this, {
      _callback: { value: callback },
      _nodes: { value: new Map() },
      _records: { value: [] },
      _scheduled: { value: false, writable: true },
    });
  };
  def(MutationObserver.prototype, "observe", function (target, options) {
    install();
    var opt = Object.assign({}, options);
    if (opt.attributeOldValue || opt.attributeFilter) opt.attributes = opt.attributes === undefined ? true : opt.attributes;
    if (opt.characterDataOldValue) opt.characterData = opt.characterData === undefined ? true : opt.characterData;
    if (!opt.childList && !opt.attributes && !opt.characterData) {
      throw new TypeError("The options object must set at least one of 'attributes', 'characterData', or 'childList' to true.");
    }
    this._nodes.set(target, opt);
    if (observers.indexOf(this) < 0) observers.push(this);
  });
  def(MutationObserver.prototype, "disconnect", function () {
    this._nodes.clear();
    this._records.splice(0);
    var i = observers.indexOf(this);
    if (i >= 0) observers.splice(i, 1);
  });
  def(MutationObserver.prototype, "takeRecords", function () { return this._records.splice(0); });
  D.MutationObserver = MutationObserver;

  // layout: none until the host gives one (boot.js's __edgeSetLayout replaces these), so every box is empty
  var zeroRect = function () {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: function () { return this; } };
  };
  def(P.Element, "getBoundingClientRect", zeroRect);
  def(P.Element, "getClientRects", function () { return []; });
  ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop", "clientWidth", "clientHeight", "scrollWidth", "scrollHeight", "scrollTop", "scrollLeft"].forEach(function (k) {
    getter(P.Element, k, function () { return 0; });
  });

  // scrolling, animation and the like: there is no viewport, so these do nothing (and do not throw)
  ["scrollTop", "scrollLeft"].forEach(function (k) {
    getter(P.Element, k, function () { return 0; }, function () {});
  });
  ["scroll", "scrollTo", "scrollBy", "scrollIntoView", "scrollIntoViewIfNeeded", "setPointerCapture", "releasePointerCapture", "requestFullscreen", "requestPointerLock"].forEach(function (k) {
    def(P.Element, k, function () {});
  });
  def(P.Element, "hasPointerCapture", function () { return false; });
  def(P.Element, "checkVisibility", function () { return true; });
  def(P.Element, "getAnimations", function () { return []; });
  def(P.Element, "animate", function () {
    var done = Promise.resolve();
    return { finished: done, ready: done, playState: "finished", currentTime: 0, effect: null, timeline: null,
      play: function () {}, pause: function () {}, cancel: function () {}, finish: function () {}, reverse: function () {}, commitStyles: function () {},
      addEventListener: function () {}, removeEventListener: function () {}, onfinish: null, oncancel: null };
  });
  def(P.HTMLElement, "showModal", function () { this.setAttribute("open", ""); });
  def(P.HTMLElement, "show", function () { this.setAttribute("open", ""); });
  def(P.HTMLElement, "close", function () { this.removeAttribute("open"); });
  def(P.HTMLElement, "showPopover", function () {});
  def(P.HTMLElement, "hidePopover", function () {});
  def(P.HTMLElement, "togglePopover", function () { return false; });
  def(P.HTMLElement, "attachInternals", function () { return { setFormValue: function () {}, setValidity: function () {}, states: new Set(), shadowRoot: null }; });

  // Custom elements. An upgraded element gets its class's prototype and runs its constructor (the page's
  // `class X extends HTMLElement` reaches the element through the HTMLElement below, which hands out the node being
  // upgraded); connected / disconnected / attributeChanged callbacks follow insertion, removal and attribute writes.
  // Hooks are installed on the first define(), so a page without custom elements pays nothing.
  var defs = new Map(), byClass = new Map(), waiting = new Map(), UPGRADED = Symbol("upgraded"), pending = null, byHand = false, ceOn = false;
  var report = function (e) {
    if (typeof globalThis.reportError === "function") globalThis.reportError(e);
    else if (globalThis.console) globalThis.console.error(e);
  };
  var defOf = function (el) {
    var is = el.getAttribute && el.getAttribute("is");
    return defs.get(el.localName) || (is && defs.get(is) && defs.get(is).extend === el.localName ? defs.get(is) : null);
  };
  var callback = function (el, name, args) {
    var f = el[name];
    if (typeof f === "function") { try { f.apply(el, args || []); } catch (e) { report(e); } }
  };
  var upgrade = function (el) {
    if (el[UPGRADED]) return;
    var def_ = defOf(el);
    if (!def_) return;
    Object.defineProperty(el, UPGRADED, { value: true });
    Object.setPrototypeOf(el, def_.Class.prototype);
    pending = el;
    try { new def_.Class(); } catch (e) { report(e); }
    pending = null;
    var observed = def_.Class.observedAttributes || [];
    el.getAttributeNames().forEach(function (n) { if (observed.indexOf(n) >= 0) callback(el, "attributeChangedCallback", [n, null, el.getAttribute(n)]); });
    if (el.isConnected) callback(el, "connectedCallback");
  };
  var customIn = function (root) {
    var out = [];
    if (root.nodeType === 1 && (root.localName.indexOf("-") >= 0 || root.hasAttribute("is"))) out.push(root);
    if (root.querySelectorAll) {
      var all = root.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) if (all[i].localName.indexOf("-") >= 0 || all[i].hasAttribute("is")) out.push(all[i]);
    }
    return out;
  };
  var connected = function (root) {
    customIn(root).forEach(function (el) {
      if (el[UPGRADED]) callback(el, "connectedCallback");
      else upgrade(el);
    });
  };
  var disconnected = function (list) { list.forEach(function (el) { if (el[UPGRADED]) callback(el, "disconnectedCallback"); }); };
  var ceInstall = function () {
    if (ceOn) return;
    ceOn = true;
    var live = function (parent) { return parent.isConnected; };
    wrap(P.Node, "appendChild", function (orig) {
      return function (node) {
        var kidsOf = node.nodeType === 11 ? Array.prototype.slice.call(node.childNodes) : [node];
        var leaving = node.nodeType !== 11 && node.isConnected ? customIn(node) : [];
        var r = orig.call(this, node);
        if (leaving.length && !node.isConnected) disconnected(leaving);
        if (live(this)) kidsOf.forEach(connected);
        return r;
      };
    });
    wrap(P.Node, "insertBefore", function (orig) {
      return function (node, ref) {
        var kidsOf = node.nodeType === 11 ? Array.prototype.slice.call(node.childNodes) : [node];
        var leaving = node.nodeType !== 11 && node.isConnected ? customIn(node) : [];
        var r = orig.call(this, node, ref);
        if (leaving.length && !node.isConnected) disconnected(leaving);
        if (live(this)) kidsOf.forEach(connected);
        return r;
      };
    });
    wrap(P.Node, "removeChild", function (orig) {
      return function (node) {
        var leaving = node.isConnected ? customIn(node) : [];
        var r = orig.call(this, node);
        disconnected(leaving);
        return r;
      };
    });
    wrap(P.Node, "replaceChild", function (orig) {
      return function (node, old) {
        var leaving = old.isConnected ? customIn(old) : [];
        var kidsOf = node.nodeType === 11 ? Array.prototype.slice.call(node.childNodes) : [node];
        var r = orig.call(this, node, old);
        disconnected(leaving);
        if (live(this)) kidsOf.forEach(connected);
        return r;
      };
    });
    var replaceAll = function (set) {
      return function (v) {
        var leaving = this.isConnected ? customIn(this).filter(function (e) { return e !== this; }, this) : [];
        set.call(this, v);
        disconnected(leaving);
        if (this.isConnected) Array.prototype.slice.call(this.childNodes).forEach(connected);
      };
    };
    wrap(P.Node, "textContent", replaceAll);
    wrap(P.Element, "innerHTML", replaceAll);
    wrap(P.Document, "createElement", function (orig) {
      return function (name) {
        var el = orig.apply(this, arguments);
        if (defs.size && !byHand && defOf(el)) upgrade(el);
        return el;
      };
    });
    var attrChange = function (el, name, old) {
      if (!el[UPGRADED]) return;
      var observed = (defOf(el) || { Class: {} }).Class.observedAttributes || [];
      name = String(name).toLowerCase();
      if (observed.indexOf(name) >= 0) callback(el, "attributeChangedCallback", [name, old, el.getAttribute(name)]);
    };
    wrap(P.Element, "setAttribute", function (orig) {
      return function (name, value) { var old = this.getAttribute(name); orig.call(this, name, value); attrChange(this, name, old); };
    });
    wrap(P.Element, "removeAttribute", function (orig) {
      return function (name) { var old = this.getAttribute(name); orig.call(this, name); if (old !== null) attrChange(this, name, old); };
    });
  };
  var HTMLElementShim = function HTMLElement() {
    var el = pending;
    if (!el) {
      // `new X()` by hand: make the element the class was defined for
      var d_ = byClass.get(new.target);
      if (!d_) throw new TypeError("Illegal constructor");
      byHand = true;
      try { el = globalThis.document.createElement(d_.extend || d_.name); } finally { byHand = false; }
      Object.defineProperty(el, UPGRADED, { value: true }); // the constructor that called us is the upgrade
      Object.setPrototypeOf(el, new.target.prototype);
    }
    pending = null;
    return el;
  };
  HTMLElementShim.prototype = P.HTMLElement;
  var registry = {
    define: function (name, Class, options) {
      name = String(name);
      if (typeof Class !== "function") throw new TypeError("The constructor provided is not a constructor.");
      if (!/^[a-z][^\sA-Z]*-[^\sA-Z]*$/.test(name)) { var e1 = new Error("'" + name + "' is not a valid custom element name."); e1.name = "SyntaxError"; throw e1; }
      if (defs.has(name) || byClass.has(Class)) { var e2 = new Error("The name '" + name + "' has already been used with this registry."); e2.name = "NotSupportedError"; throw e2; }
      var info = { name: name, Class: Class, extend: options && options.extends };
      defs.set(name, info);
      byClass.set(Class, info);
      ceInstall();
      var doc = globalThis.document;
      if (doc) {
        var all = doc.querySelectorAll(info.extend ? info.extend + '[is="' + name + '"]' : name);
        for (var i = 0; i < all.length; i++) upgrade(all[i]);
      }
      (waiting.get(name) || []).forEach(function (resolve) { resolve(Class); });
      waiting.delete(name);
    },
    get: function (name) { var d_ = defs.get(String(name)); return d_ ? d_.Class : undefined; },
    getName: function (Class) { var d_ = byClass.get(Class); return d_ ? d_.name : null; },
    whenDefined: function (name) {
      name = String(name);
      if (defs.has(name)) return Promise.resolve(defs.get(name).Class);
      return new Promise(function (resolve) { (waiting.get(name) || (waiting.set(name, []), waiting.get(name))).push(resolve); });
    },
    upgrade: function (root) { customIn(root).forEach(upgrade); },
  };
  D.customElements = registry;
  D.HTMLElement = HTMLElementShim;

  // style: a CSSStyleDeclaration over the style attribute (camelCase and kebab-case names, cssText)
  var kebab = function (k) { return k.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); }); };
  var parseStyle = function (text) {
    var out = [];
    String(text || "").split(";").forEach(function (decl) {
      var i = decl.indexOf(":");
      if (i < 0) return;
      var name = decl.slice(0, i).trim().toLowerCase(), value = decl.slice(i + 1).trim();
      if (!name || !value) return;
      for (var j = 0; j < out.length; j++) if (out[j][0] === name) { out.splice(j, 1); break; }
      out.push([name, value]);
    });
    return out;
  };
  var StyleDecl = function (el) { Object.defineProperty(this, "_el", { value: el }); };
  var styleItems = function (s) { return parseStyle(s._el.getAttribute("style")); };
  var styleWrite = function (s, items) {
    var text = items.map(function (d) { return d[0] + ": " + d[1] + ";"; }).join(" ");
    if (text || s._el.hasAttribute("style")) s._el.setAttribute("style", text);
  };
  var styleSet = function (s, name, value) {
    name = name.indexOf("--") === 0 ? name : kebab(name);
    var items = styleItems(s).filter(function (d) { return d[0] !== name; });
    value = value == null ? "" : String(value);
    if (value !== "") items.push([name, value]);
    styleWrite(s, items);
  };
  def(StyleDecl.prototype, "getPropertyValue", function (name) {
    name = String(name).indexOf("--") === 0 ? String(name) : kebab(String(name));
    var items = styleItems(this);
    for (var i = 0; i < items.length; i++) if (items[i][0] === name) return items[i][1];
    return "";
  });
  def(StyleDecl.prototype, "setProperty", function (name, value) { styleSet(this, String(name), value); });
  def(StyleDecl.prototype, "removeProperty", function (name) { var old = this.getPropertyValue(name); styleSet(this, String(name), ""); return old; });
  def(StyleDecl.prototype, "getPropertyPriority", function () { return ""; });
  def(StyleDecl.prototype, "item", function (i) { var it = styleItems(this)[i]; return it ? it[0] : ""; });
  def(StyleDecl.prototype, "toString", function () { return this.cssText; });
  getter(StyleDecl.prototype, "length", function () { return styleItems(this).length; });
  getter(StyleDecl.prototype, "cssText", function () {
    return styleItems(this).map(function (d) { return d[0] + ": " + d[1] + ";"; }).join(" ");
  }, function (v) { this._el.setAttribute("style", String(v)); });
  var STYLE = Symbol("style");
  getter(P.HTMLElement, "style", function () {
    if (this[STYLE]) return this[STYLE];
    return (this[STYLE] = new Proxy(new StyleDecl(this), {
      get: function (t, key, recv) {
        if (typeof key !== "string" || key in t) return Reflect.get(t, key, t);
        return t.getPropertyValue(key);
      },
      set: function (t, key, value) {
        if (key === "cssText") t.cssText = value;
        else if (typeof key === "string") styleSet(t, key, value);
        return true;
      },
      has: function (t, key) { return key in t; },
    }));
  }, function (v) { this.style.cssText = v; });

  // form controls and common reflected properties
  var reflectString = function (proto, prop, attr) {
    getter(proto, prop, function () { var v = this.getAttribute(attr || prop); return v === null ? "" : v; }, function (v) { this.setAttribute(attr || prop, String(v)); });
  };
  var reflectBool = function (proto, prop, attr) {
    getter(proto, prop, function () { return this.hasAttribute(attr || prop); }, function (v) { if (v) this.setAttribute(attr || prop, ""); else this.removeAttribute(attr || prop); });
  };
  ["title", "lang", "dir", "slot", "href", "src", "alt", "name", "type", "rel", "target", "placeholder", "htmlFor:for", "accessKey:accesskey", "tabIndex:tabindex"].forEach(function (spec) {
    var parts = spec.split(":");
    if (!Object.getOwnPropertyDescriptor(P.HTMLElement, parts[0])) reflectString(P.HTMLElement, parts[0], parts[1]);
  });
  ["hidden", "disabled", "checked", "selected", "required", "readOnly:readonly", "multiple", "autofocus", "open", "async", "defer"].forEach(function (spec) {
    var parts = spec.split(":");
    if (!Object.getOwnPropertyDescriptor(P.HTMLElement, parts[0])) reflectBool(P.HTMLElement, parts[0], parts[1]);
  });
  // value: a textarea's is its text, a select's the selected option's, the others' the attribute
  var valueDesc = Object.getOwnPropertyDescriptor(P.HTMLElement, "value");
  if (!valueDesc) {
    var VAL = Symbol("value");
    getter(P.HTMLElement, "value", function () {
      var tag = this.localName;
      if (tag === "textarea") return this.textContent;
      if (tag === "select") {
        var o = this.querySelector("option[selected]") || this.querySelector("option");
        return o ? o.value : "";
      }
      if (tag === "option") { var v = this.getAttribute("value"); return v === null ? this.textContent : v; }
      if (this[VAL] !== undefined) return this[VAL];
      var a = this.getAttribute("value");
      return a === null ? "" : a;
    }, function (v) {
      var tag = this.localName;
      if (tag === "textarea") this.textContent = String(v);
      else if (tag === "select") {
        var opts = this.querySelectorAll("option");
        for (var i = 0; i < opts.length; i++) { if (opts[i].value === String(v)) opts[i].setAttribute("selected", ""); else opts[i].removeAttribute("selected"); }
      } else this.setAttribute("value", String(v));
    });
  }
  getter(P.HTMLElement, "form", function () { return this.closest("form"); });
  getter(P.HTMLElement, "isContentEditable", function () { return this.getAttribute("contenteditable") !== null && this.getAttribute("contenteditable") !== "false"; });

  // Shadow DOM: a shadow root is a fragment hanging off the host (it is not a child, and not serialised)
  var SHADOW = Symbol("shadow");
  def(P.Element, "attachShadow", function (init) {
    if (this[SHADOW]) {
      var e = new Error("Failed to execute 'attachShadow' on 'Element': Shadow root cannot be created on a host which already hosts a shadow tree.");
      e.name = "NotSupportedError";
      throw e;
    }
    var root = this.ownerDocument.createDocumentFragment();
    Object.defineProperties(root, { host: { value: this }, mode: { value: (init && init.mode) || "open" } });
    Object.defineProperty(this, SHADOW, { value: root });
    return root;
  });
  getter(P.Element, "shadowRoot", function () { var r = this[SHADOW]; return r && r.mode === "open" ? r : null; });
  // events leave a shadow tree through its host
  var plainParent = parentOf;
  parentOf = function (n) { return n.parentNode || (n.nodeType === 11 && n.host) || plainParent(n); };

  // HTMLCollection / NodeList are live: a read-through proxy that re-reads the C answer when any tree or attribute
  // has changed since (D.version()). It is not an Array (as in a browser) but has the length, indices, item,
  // namedItem and the array methods.
  var liveCollection = function (compute, named, kind, namedItem) {
    var cache = null, ver = -1;
    var arr = function () {
      var v = D.version();
      if (v !== ver || !cache) { cache = compute(); ver = v; }
      return cache;
    };
    var kindProto = kind && W[kind] && W[kind].prototype;
    return new Proxy(kindProto ? Object.create(kindProto) : {}, {
      get: function (_, k) {
        if (k === "item") return function (i) { return arr()[i] || null; };
        if (k === "namedItem") return function (name) {
          var a = arr();
          if (namedItem) { var r = namedItem(String(name), a); if (r !== undefined) return r; }
          for (var i = 0; i < a.length; i++) if (a[i].getAttribute && (a[i].getAttribute("id") === name || a[i].getAttribute("name") === name)) return a[i];
          return null;
        };
        var a2 = arr(), v2 = a2[k];
        if (v2 === undefined && named && typeof k === "string") {
          if (namedItem) { var r2 = namedItem(k, a2); if (r2 !== undefined) return r2; }
          for (var j = 0; j < a2.length; j++) if (a2[j].getAttribute("id") === k || a2[j].getAttribute("name") === k) return a2[j];
        }
        return typeof v2 === "function" ? v2.bind(a2) : v2;
      },
      has: function (_, k) { return k in arr(); },
      ownKeys: function () { return Reflect.ownKeys(arr()).filter(function (k) { return k !== "length"; }); },
      getOwnPropertyDescriptor: function (_, k) {
        if (k === "length") return undefined;
        var d = Object.getOwnPropertyDescriptor(arr(), k);
        if (d) d.configurable = true;
        return d;
      },
    });
  };
  // The element interfaces pages test with instanceof or take prototypes from (HTMLInputElement for input, ...):
  // each is a class between HTMLElement and the element, and the C side gives new elements of its tags that prototype.
  var illegal = function () { throw new TypeError("Illegal constructor"); };
  var classes = [
    ["HTMLInputElement", "input"], ["HTMLAnchorElement", "a"], ["HTMLImageElement", "img"], ["HTMLButtonElement", "button"],
    ["HTMLSelectElement", "select"], ["HTMLOptionElement", "option"], ["HTMLTextAreaElement", "textarea"], ["HTMLFormElement", "form"],
    ["HTMLDivElement", "div"], ["HTMLSpanElement", "span"], ["HTMLParagraphElement", "p"], ["HTMLScriptElement", "script"],
    ["HTMLStyleElement", "style"], ["HTMLLinkElement", "link"], ["HTMLMetaElement", "meta"], ["HTMLTemplateElement", "template"],
    ["HTMLBodyElement", "body"], ["HTMLHeadElement", "head"], ["HTMLHtmlElement", "html"], ["HTMLCanvasElement", "canvas"],
    ["HTMLIFrameElement", "iframe"], ["HTMLTableElement", "table"], ["HTMLLabelElement", "label"], ["HTMLUListElement", "ul"],
    ["HTMLOListElement", "ol"], ["HTMLLIElement", "li"], ["HTMLBRElement", "br"], ["HTMLTitleElement", "title"],
    ["HTMLHeadingElement", "h1", "h2", "h3", "h4", "h5", "h6"], ["HTMLTableRowElement", "tr"], ["HTMLTableCellElement", "td", "th"],
    ["HTMLVideoElement", "video"], ["HTMLAudioElement", "audio"], ["HTMLSourceElement", "source"], ["HTMLPreElement", "pre"],
    ["HTMLHRElement", "hr"], ["HTMLDialogElement", "dialog"], ["HTMLDetailsElement", "details"], ["HTMLFieldSetElement", "fieldset"],
  ];
  classes.forEach(function (spec) {
    var C = { [spec[0]]: function () { illegal(); } }[spec[0]];
    C.prototype = Object.create(P.HTMLElement, { constructor: { value: C, writable: true, configurable: true } });
    Object.setPrototypeOf(C, D.ctors.HTMLElement);
    D.ctors[spec[0]] = C;
    P[spec[0]] = C.prototype;
    for (var i = 1; i < spec.length; i++) D.setTagProto(spec[i], C.prototype);
  });
  // type: an input without a known one is a text field, a button without one submits
  var INPUT_TYPES = ["hidden", "text", "search", "tel", "url", "email", "password", "date", "month", "week", "time", "datetime-local", "number", "range", "color", "checkbox", "radio", "file", "submit", "image", "reset", "button"];
  getter(P.HTMLInputElement, "type", function () {
    var t = (this.getAttribute("type") || "").toLowerCase();
    return INPUT_TYPES.indexOf(t) >= 0 ? t : "text";
  }, function (v) { this.setAttribute("type", String(v)); });
  getter(P.HTMLButtonElement, "type", function () {
    var t = (this.getAttribute("type") || "").toLowerCase();
    return t === "button" || t === "reset" ? t : "submit";
  }, function (v) { this.setAttribute("type", String(v)); });
  getter(P.HTMLSelectElement, "type", function () { return this.hasAttribute("multiple") ? "select-multiple" : "select-one"; });
  getter(P.HTMLTextAreaElement, "type", function () { return "textarea"; });
  // .text is the text of the element (an option's with its white space collapsed)
  ["HTMLScriptElement", "HTMLAnchorElement", "HTMLTitleElement"].forEach(function (name) {
    getter(P[name], "text", function () { return this.textContent; }, function (v) { this.textContent = String(v); });
  });
  getter(P.HTMLOptionElement, "text", function () { return this.textContent.replace(/[ \t\n\f\r]+/g, " ").trim(); }, function (v) { this.textContent = String(v); });

  // an option that is selected deselects the others of a single select
  getter(P.HTMLOptionElement, "selected", function () { return this.hasAttribute("selected"); }, function (v) {
    if (v) {
      var select = this.closest("select");
      if (select && !select.hasAttribute("multiple")) {
        var all = select.querySelectorAll("option");
        for (var i = 0; i < all.length; i++) if (all[i] !== this) all[i].removeAttribute("selected");
      }
      this.setAttribute("selected", "");
    } else this.removeAttribute("selected");
  });
  getter(P.HTMLOptionElement, "defaultSelected", function () { return this.hasAttribute("selected"); }, function (v) { if (v) this.setAttribute("selected", ""); else this.removeAttribute("selected"); });

  // on<event> properties (onclick, oninput, ...): a handler you set, or the one the on<event> attribute holds. Code asks
  // "'oninput' in document" to find out which events exist (React does), so every event is listed.
  var HANDLER_EVENTS = ("abort animationcancel animationend animationiteration animationstart auxclick beforeinput blur cancel canplay canplaythrough change " +
    "click close contextmenu copy cut dblclick drag dragend dragenter dragleave dragover dragstart drop durationchange emptied ended error focus focusin focusout " +
    "formdata gotpointercapture input invalid keydown keypress keyup load loadeddata loadedmetadata loadstart lostpointercapture mousedown mouseenter mouseleave " +
    "mousemove mouseout mouseover mouseup paste pause play playing pointercancel pointerdown pointerenter pointerleave pointermove pointerout pointerover pointerup " +
    "progress ratechange reset resize scroll scrollend securitypolicyviolation seeked seeking select selectionchange selectstart slotchange stalled submit suspend " +
    "timeupdate toggle touchcancel touchend touchmove touchstart transitioncancel transitionend transitionrun transitionstart volumechange waiting wheel").split(" ");
  var HANDLER = Symbol("handlers");
  [P.HTMLElement, P.Document].forEach(function (proto) {
    HANDLER_EVENTS.forEach(function (type) {
      var name = "on" + type;
      if (Object.getOwnPropertyDescriptor(proto, name)) return;
      getter(proto, name, function () {
        var h = this[HANDLER] && this[HANDLER][type];
        if (h !== undefined) return h;
        var code = this.nodeType === 1 ? this.getAttribute(name) : null;
        if (code === null) return null;
        var fn;
        try { fn = new Function("event", code); } catch (e) { return null; }
        (this[HANDLER] || (this[HANDLER] = {}))[type] = fn;
        return fn;
      }, function (v) {
        (this[HANDLER] || Object.defineProperty(this, HANDLER, { value: {}, configurable: true })[HANDLER])[type] = typeof v === "function" ? v : null;
      });
    });
  });

  // a form's controls (by name too, as in form.elements.email) and a select's options
  var CONTROLS = "input, select, textarea, button, fieldset, object, output";
  // a name shared by several radio buttons answers a RadioNodeList, not the first of them
  var RadioNodeList = function RadioNodeList() { illegal(); };
  var makeRadioNodeList = function (nodes) {
    var list = Object.create(RadioNodeList.prototype);
    nodes.forEach(function (n, i) { list[i] = n; });
    list.length = nodes.length;
    return list;
  };
  Object.defineProperty(RadioNodeList.prototype, "value", {
    configurable: true,
    get: function () { for (var i = 0; i < this.length; i++) if (this[i].checked) return this[i].value; return ""; },
    set: function (v) {
      v = String(v);
      for (var i = 0; i < this.length; i++) if (this[i].value === v) { this[i].checked = true; return; }
      if (v === "") for (var j = 0; j < this.length; j++) this[j].checked = false;
    },
  });
  RadioNodeList.prototype.item = function (i) { return i >= 0 && i < this.length ? this[i] : null; };
  RadioNodeList.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
  var formNamedItem = function (name, a) {
    var matches = a.filter(function (el) { return el.getAttribute && (el.getAttribute("id") === name || el.getAttribute("name") === name); });
    if (matches.length > 1 && matches.every(function (el) { return el.type === "radio"; })) return makeRadioNodeList(matches);
    return undefined;
  };
  getter(P.HTMLFormElement, "elements", function () {
    var form = this;
    return liveCollection(function () { return Array.prototype.slice.call(form.querySelectorAll(CONTROLS)); }, true, "HTMLFormControlsCollection", formNamedItem);
  });
  getter(P.HTMLFormElement, "length", function () { return this.querySelectorAll(CONTROLS).length; });
  getter(P.HTMLSelectElement, "options", function () {
    var select = this;
    return liveCollection(function () { return Array.prototype.slice.call(select.querySelectorAll("option")); }, false, "HTMLOptionsCollection");
  });
  getter(P.HTMLSelectElement, "length", function () { return this.querySelectorAll("option").length; }, function (n) {
    var opts = this.querySelectorAll("option");
    n = n >>> 0;
    for (var i = opts.length - 1; i >= n; i--) opts[i].remove();
    for (var j = opts.length; j < n; j++) this.appendChild(this.ownerDocument.createElement("option"));
  });
  getter(P.HTMLSelectElement, "selectedIndex", function () {
    var opts = this.querySelectorAll("option");
    for (var i = 0; i < opts.length; i++) if (opts[i].hasAttribute("selected")) return i;
    return opts.length && !this.hasAttribute("multiple") ? 0 : -1;
  }, function (v) {
    var opts = this.querySelectorAll("option");
    for (var i = 0; i < opts.length; i++) { if (i === Number(v)) opts[i].setAttribute("selected", ""); else opts[i].removeAttribute("selected"); }
  });
  getter(P.HTMLSelectElement, "selectedOptions", function () {
    var select = this;
    return liveCollection(function () {
      var chosen = Array.prototype.filter.call(select.querySelectorAll("option"), function (o) { return o.hasAttribute("selected"); });
      if (!chosen.length && !select.hasAttribute("multiple")) { var first = select.querySelector("option"); if (first) chosen = [first]; }
      return chosen;
    });
  });
  getter(P.HTMLOptionElement, "index", function () {
    var select = this.closest("select");
    return select ? Array.prototype.indexOf.call(select.querySelectorAll("option"), this) : 0;
  });
  def(P.HTMLFormElement, "reset", function () {
    var controls = this.querySelectorAll(CONTROLS);
    for (var i = 0; i < controls.length; i++) { var c = controls[i]; if (c.localName === "input") c.value = c.getAttribute("value") || ""; }
    this.dispatchEvent(new W.Event("reset", { bubbles: true, cancelable: true }));
  });
  def(P.HTMLFormElement, "requestSubmit", function () {
    if (this.dispatchEvent(new W.Event("submit", { bubbles: true, cancelable: true }))) { /* navigation: none here */ }
  });
  def(P.HTMLFormElement, "submit", function () { /* navigation: none here */ });

  // an anchor's address, taken apart (protocol, host, pathname, ...); empty strings when it has none that parses
  ["protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin", "username", "password"].forEach(function (part) {
    Object.defineProperty(P.HTMLAnchorElement, part, {
      configurable: true, enumerable: true,
      get: function () { try { return new URL(this.href)[part]; } catch (e) { return part === "protocol" ? ":" : ""; } },
      set: function (v) { try { var u = new URL(this.href); u[part] = v; this.setAttribute("href", u.href); } catch (e) {} },
    });
  });
  // frameworks read these descriptors from the control's own prototype (React wraps input.value that way)
  ["HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLOptionElement"].forEach(function (name) {
    ["value", "checked", "disabled"].forEach(function (prop) {
      if (prop === "checked" && name !== "HTMLInputElement") return;
      var d = Object.getOwnPropertyDescriptor(P.HTMLElement, prop);
      if (d) Object.defineProperty(P[name], prop, d);
    });
  });
  // SVG. The elements of SVG's own tags (svg, g, path, rect, ...) get their interfaces by tag like HTML's; an element the
  // HTML tags overlap with (a, script, style, title) stays an HTML one. SVGElement and SVGGraphicsElement also answer
  // instanceof by the namespace, so that those count too. (The interfaces sit on HTMLElement's prototype, which brings
  // style, dataset, focus and the on<event> properties that SVG elements have as well.)
  var svgClass = function (name, parent, tags) {
    var C = { [name]: function () { illegal(); } }[name];
    C.prototype = Object.create(parent ? P[parent] : P.HTMLElement, { constructor: { value: C, writable: true, configurable: true } });
    Object.setPrototypeOf(C, parent ? D.ctors[parent] : D.ctors.HTMLElement);
    Object.defineProperty(C, Symbol.hasInstance, { value: Function.prototype[Symbol.hasInstance], configurable: true }); // not the parent's
    D.ctors[name] = C;
    P[name] = C.prototype;
    (tags || []).forEach(function (t) { D.setTagProto(t, C.prototype); });
    return C;
  };
  var SVG_URI = "http://www.w3.org/2000/svg";
  ["SVGElement", "SVGGraphicsElement"].forEach(function (name) {
    var C = svgClass(name, name === "SVGElement" ? null : "SVGElement");
    Object.defineProperty(C, Symbol.hasInstance, {
      value: function (x) { return !!x && x.nodeType === 1 && x.namespaceURI === SVG_URI; },
    });
  });
  svgClass("SVGSVGElement", "SVGGraphicsElement", ["svg"]);
  Object.defineProperty(D.ctors.SVGSVGElement, Symbol.hasInstance, {
    value: function (x) { return !!x && x.nodeType === 1 && x.namespaceURI === SVG_URI && x.localName === "svg"; },
  });
  svgClass("SVGGElement", "SVGGraphicsElement", ["g"]);
  svgClass("SVGUseElement", "SVGGraphicsElement", ["use"]);
  svgClass("SVGImageElement", "SVGGraphicsElement", ["image"]);
  svgClass("SVGForeignObjectElement", "SVGGraphicsElement", ["foreignobject"]);
  svgClass("SVGTextElement", "SVGGraphicsElement", ["text"]);
  svgClass("SVGTSpanElement", "SVGGraphicsElement", ["tspan"]);
  svgClass("SVGGeometryElement", "SVGGraphicsElement");
  [["SVGPathElement", "path"], ["SVGRectElement", "rect"], ["SVGCircleElement", "circle"], ["SVGEllipseElement", "ellipse"],
    ["SVGLineElement", "line"], ["SVGPolylineElement", "polyline"], ["SVGPolygonElement", "polygon"]].forEach(function (e) { svgClass(e[0], "SVGGeometryElement", [e[1]]); });
  [["SVGDefsElement", "defs"], ["SVGSymbolElement", "symbol"], ["SVGClipPathElement", "clippath"], ["SVGMaskElement", "mask"],
    ["SVGLinearGradientElement", "lineargradient"], ["SVGRadialGradientElement", "radialgradient"], ["SVGStopElement", "stop"],
    ["SVGPatternElement", "pattern"], ["SVGMarkerElement", "marker"], ["SVGFilterElement", "filter"], ["SVGDescElement", "desc"],
    ["SVGMetadataElement", "metadata"]].forEach(function (e) { svgClass(e[0], "SVGElement", [e[1]]); });

  // what scripts read of SVG elements: animated attributes (className, href, x / y / width / height ...), the owner and
  // viewport, and geometry (getBBox, getTotalLength, getPointAtLength) worked out from the attributes
  (function () {
    var SE = P.SVGElement, SG = P.SVGGraphicsElement;
    var animated = function (read, write) {
      var o = {};
      Object.defineProperty(o, "baseVal", { get: read, set: write, enumerable: true });
      Object.defineProperty(o, "animVal", { get: read, enumerable: true });
      return o;
    };
    getter(SE, "className", function () {
      var el = this;
      return animated(function () { return el.getAttribute("class") || ""; }, function (v) { el.setAttribute("class", String(v)); });
    }, function (v) { this.setAttribute("class", String(v)); });
    var UNITS = [[/%$/, 2, 0], [/em$/, 3, 16], [/ex$/, 4, 8], [/px$/, 5, 1], [/cm$/, 6, 96 / 2.54], [/mm$/, 7, 96 / 25.4], [/in$/, 8, 96], [/pt$/, 9, 4 / 3], [/pc$/, 10, 16]];
    var unitOf = function (s) {
      for (var i = 0; i < UNITS.length; i++) if (UNITS[i][0].test(s)) return UNITS[i];
      return [null, 1, 1];
    };
    var length = function (el, attr) {
      var text = function () { var s = el.getAttribute(attr); return s === null ? "0" : s.trim(); };
      var num = function () { var n = parseFloat(text()); return isFinite(n) ? n : 0; };
      var len = {};
      Object.defineProperties(len, {
        value: { get: function () { return unitOf(text())[1] === 2 ? 0 : num() * unitOf(text())[2]; }, set: function (v) { el.setAttribute(attr, String(v)); }, enumerable: true },
        valueInSpecifiedUnits: { get: num, set: function (v) { el.setAttribute(attr, String(v) + text().replace(/^[-+.\d]+(e[-+]?\d+)?/i, "")); }, enumerable: true },
        valueAsString: { get: text, set: function (v) { el.setAttribute(attr, String(v)); }, enumerable: true },
        unitType: { get: function () { return unitOf(text())[1]; }, enumerable: true },
      });
      return len;
    };
    ["x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "x2", "y1", "y2"].forEach(function (attr) {
      getter(SE, attr, function () { var l = length(this, attr); return { baseVal: l, animVal: l }; });
    });
    getter(SE, "viewBox", function () {
      var el = this;
      var read = function () {
        var p = (el.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(parseFloat);
        return p.length === 4 && p.every(isFinite) ? { x: p[0], y: p[1], width: p[2], height: p[3] } : { x: 0, y: 0, width: 0, height: 0 };
      };
      return animated(read);
    });
    getter(SE, "href", function () {
      var el = this;
      return animated(function () { var v = el.getAttribute("href"); return v !== null ? v : el.getAttribute("xlink:href") || ""; }, function (v) { el.setAttribute("href", String(v)); });
    });
    getter(SE, "ownerSVGElement", function () {
      for (var n = this.parentNode; n && n.nodeType === 1; n = n.parentNode) if (n.localName === "svg") return n;
      return null;
    });
    getter(SE, "viewportElement", function () {
      for (var n = this.parentNode; n && n.nodeType === 1; n = n.parentNode) if (n.localName === "svg") return n;
      return null;
    });
    var matrix = function () {
      var m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      m.inverse = m.multiply = m.translate = m.scale = m.rotate = function () { return matrix(); };
      return m;
    };
    var point = function (x, y) {
      return { x: x, y: y, matrixTransform: function () { return point(this.x, this.y); } };
    };
    def(SG, "getCTM", function () { return matrix(); });
    def(SG, "getScreenCTM", function () { return matrix(); });
    getter(SG, "transform", function () {
      var list = { numberOfItems: 0, length: 0, clear: function () {}, consolidate: function () { return null; }, getItem: function () { throw new RangeError("Index out of range"); } };
      return { baseVal: list, animVal: list };
    });
    def(P.SVGSVGElement, "createSVGPoint", function () { return point(0, 0); });
    def(P.SVGSVGElement, "createSVGMatrix", function () { return matrix(); });
    def(P.SVGSVGElement, "createSVGNumber", function () { return { value: 0 }; });
    def(P.SVGSVGElement, "getElementById", function (id) { return this.querySelector("#" + (globalThis.CSS && CSS.escape ? CSS.escape(String(id)) : String(id))); });
    def(P.SVGSVGElement, "getCurrentTime", function () { return 0; });
    ["pauseAnimations", "unpauseAnimations", "suspendRedraw", "unsuspendRedraw", "forceRedraw"].forEach(function (n) { def(P.SVGSVGElement, n, function () { return 0; }); });
    getter(P.SVGSVGElement, "currentScale", function () { return 1; });

    // ---- geometry
    var attrNum = function (el, a) { var n = parseFloat(el.getAttribute(a)); return isFinite(n) ? n : 0; };
    var pairs = function (s) {
      var n = (s || "").trim().split(/[\s,]+/).map(parseFloat).filter(isFinite), out = [];
      for (var i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
      return out;
    };
    // a path flattened: points, each with m true when it starts a subpath
    var pathPoints = function (d) {
      var toks = String(d || "").match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
      var i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, pts = [], c2 = null, q1 = null, guard = 0;
      var num = function () { var n = parseFloat(toks[i++]); return isFinite(n) ? n : 0; };
      var add = function (a, b) { pts.push({ x: a, y: b }); x = a; y = b; };
      var cubic = function (x1, y1, x2, y2, x3, y3) {
        var x0 = x, y0 = y;
        for (var t = 1; t <= 16; t++) {
          var u = t / 16, v = 1 - u;
          add(v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3, v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3);
        }
      };
      var quad = function (x1, y1, x2, y2) { cubic(x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), x2 + 2 / 3 * (x1 - x2), y2 + 2 / 3 * (y1 - y2), x2, y2); };
      while (i < toks.length && guard++ < 100000) {
        if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
        else if (cmd === "M") cmd = "L";
        else if (cmd === "m") cmd = "l";
        var rel = cmd !== cmd.toUpperCase(), K = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0, p, q, r, s, t2, u2;
        var keepC = false, keepQ = false;
        if (K === "M") { x = ox + num(); y = oy + num(); sx = x; sy = y; pts.push({ x: x, y: y, m: true }); }
        else if (K === "L") add(ox + num(), oy + num());
        else if (K === "H") add(ox + num(), y);
        else if (K === "V") add(x, oy + num());
        else if (K === "C") { p = ox + num(); q = oy + num(); r = ox + num(); s = oy + num(); t2 = ox + num(); u2 = oy + num(); cubic(p, q, r, s, t2, u2); c2 = [r, s]; keepC = true; }
        else if (K === "S") { var rx0 = c2 ? 2 * x - c2[0] : x, ry0 = c2 ? 2 * y - c2[1] : y; r = ox + num(); s = oy + num(); t2 = ox + num(); u2 = oy + num(); cubic(rx0, ry0, r, s, t2, u2); c2 = [r, s]; keepC = true; }
        else if (K === "Q") { p = ox + num(); q = oy + num(); r = ox + num(); s = oy + num(); quad(p, q, r, s); q1 = [p, q]; keepQ = true; }
        else if (K === "T") { var tx = q1 ? 2 * x - q1[0] : x, ty = q1 ? 2 * y - q1[1] : y; r = ox + num(); s = oy + num(); quad(tx, ty, r, s); q1 = [tx, ty]; keepQ = true; }
        else if (K === "A") { num(); num(); num(); num(); num(); add(ox + num(), oy + num()); } // an arc is taken as its chord
        else if (K === "Z") { add(sx, sy); }
        else { i++; }
        if (!keepC) c2 = null;
        if (!keepQ) q1 = null;
        if (K === "Z" && i < toks.length && !/^[a-zA-Z]$/.test(toks[i])) cmd = "L";
      }
      return pts;
    };
    var shapePoints = function (el) {
      var t = el.localName, n = function (a) { return attrNum(el, a); }, pts;
      if (t === "rect") { var x = n("x"), y = n("y"), w = n("width"), h = n("height"); return [{ x: x, y: y, m: true }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }, { x: x, y: y }]; }
      if (t === "line") return [{ x: n("x1"), y: n("y1"), m: true }, { x: n("x2"), y: n("y2") }];
      if (t === "polyline" || t === "polygon") {
        pts = pairs(el.getAttribute("points"));
        if (pts.length) pts[0].m = true;
        if (t === "polygon" && pts.length) pts.push({ x: pts[0].x, y: pts[0].y });
        return pts;
      }
      if (t === "path") return pathPoints(el.getAttribute("d"));
      if (t === "circle" || t === "ellipse") {
        var rx = t === "circle" ? n("r") : n("rx"), ry = t === "circle" ? n("r") : n("ry"), cx = n("cx"), cy = n("cy"), out = [];
        for (var k = 0; k <= 64; k++) out.push({ x: cx + rx * Math.cos(k / 32 * Math.PI), y: cy + ry * Math.sin(k / 32 * Math.PI), m: k === 0 });
        return out;
      }
      return [];
    };
    var lengthOf = function (pts) {
      var sum = 0;
      for (var i = 1; i < pts.length; i++) if (!pts[i].m) sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return sum;
    };
    var GEOMETRY = ["rect", "line", "polyline", "polygon", "path", "circle", "ellipse"];
    def(P.SVGGeometryElement, "getTotalLength", function () {
      var t = this.localName;
      if (t === "circle") return 2 * Math.PI * attrNum(this, "r");
      if (t === "ellipse") { var a = attrNum(this, "rx"), b = attrNum(this, "ry"), h = Math.pow(a - b, 2) / Math.pow(a + b, 2); return a + b === 0 ? 0 : Math.PI * (a + b) * (1 + 3 * h / (10 + Math.sqrt(4 - 3 * h))); }
      return lengthOf(shapePoints(this));
    });
    def(P.SVGGeometryElement, "getPointAtLength", function (len) {
      var pts = shapePoints(this), left = Math.max(0, +len || 0), last = pts.length ? point(pts[0].x, pts[0].y) : point(0, 0);
      for (var i = 1; i < pts.length; i++) {
        if (pts[i].m) { last = point(pts[i].x, pts[i].y); continue; }
        var seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (left <= seg && seg > 0) { var f = left / seg; return point(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f); }
        left -= seg;
        last = point(pts[i].x, pts[i].y);
      }
      return last;
    });
    var box = function (x, y, w, h) { return { x: x, y: y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h }; };
    def(SG, "getBBox", function () {
      var t = this.localName;
      if (GEOMETRY.indexOf(t) >= 0) {
        var pts = shapePoints(this);
        if (!pts.length) return box(0, 0, 0, 0);
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
        return box(x0, y0, x1 - x0, y1 - y0);
      }
      if (t === "g" || t === "svg" || t === "a") { // the union of the children (their transforms are not applied)
        var ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity, any = false;
        for (var c = this.firstElementChild; c; c = c.nextElementSibling) {
          if (typeof c.getBBox !== "function") continue;
          var b = c.getBBox();
          if (!b.width && !b.height && GEOMETRY.indexOf(c.localName) < 0) continue;
          any = true;
          ax0 = Math.min(ax0, b.x); ay0 = Math.min(ay0, b.y); ax1 = Math.max(ax1, b.x + b.width); ay1 = Math.max(ay1, b.y + b.height);
        }
        return any ? box(ax0, ay0, ax1 - ax0, ay1 - ay0) : box(0, 0, 0, 0);
      }
      if (t === "image" || t === "foreignobject" || t === "use") return box(attrNum(this, "x"), attrNum(this, "y"), attrNum(this, "width"), attrNum(this, "height"));
      return box(attrNum(this, "x"), attrNum(this, "y"), 0, 0); // text: no layout
    });
  })();

  // Namespaces, as far as pages need them: an element is SVG or MathML by the root it sits in (or was made with
  // createElementNS), and the *NS attribute methods work on qualified names.
  var NS = { html: "http://www.w3.org/1999/xhtml", svg: "http://www.w3.org/2000/svg", math: "http://www.w3.org/1998/Math/MathML" };
  var NSKEY = Symbol("ns");
  getter(P.Element, "namespaceURI", function () {
    if (this[NSKEY]) return this[NSKEY];
    for (var n = this; n && n.nodeType === 1; n = n.parentNode) {
      var t = n.localName;
      if (t === "svg") return NS.svg;
      if (t === "math") return NS.math;
      if (n.localName === "foreignobject") return NS.html;
    }
    return NS.html;
  });
  getter(P.Element, "prefix", function () { return null; });
  def(P.Document, "createElementNS", function (ns, name) {
    var el = this.createElement(String(name));
    if (ns && ns !== NS.html) Object.defineProperty(el, NSKEY, { value: String(ns) });
    return el;
  });
  def(P.Element, "setAttributeNS", function (ns, name, value) { this.setAttribute(name, value); });
  def(P.Element, "getAttributeNS", function (ns, name) {
    var v = this.getAttribute(name);
    return v === null && ns === "http://www.w3.org/1999/xlink" ? this.getAttribute("xlink:" + name) : v;
  });
  def(P.Element, "hasAttributeNS", function (ns, name) { return this.hasAttribute(name); });
  def(P.Element, "removeAttributeNS", function (ns, name) { this.removeAttribute(name); });
  var liveGetter = function (proto, name) {
    var d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.get) return;
    var get = d.get, key = Symbol(name);
    Object.defineProperty(proto, name, {
      get: function () {
        var self = this;
        return this[key] || Object.defineProperty(this, key, { value: liveCollection(function () { return get.call(self); }, false, name === "childNodes" ? "NodeList" : "HTMLCollection") })[key];
      },
      configurable: true,
    });
  };
  [P.Element, P.Document, P.DocumentFragment].forEach(function (p) { liveGetter(p, "children"); });
  liveGetter(P.Node, "childNodes");
  // the data methods of Text / Comment (all through `data`, so observers and ranges see them)
  (function () {
    var range = function (self, offset, count, name) {
      var len = self.data.length;
      offset = offset >>> 0;
      if (offset > len) { var e = new Error("Failed to execute '" + name + "' on 'CharacterData': The offset " + offset + " is greater than the node's length (" + len + ")."); e.name = "IndexSizeError"; throw e; }
      return Math.min(count === undefined ? len : count >>> 0, len - offset);
    };
    def(P.CharacterData, "substringData", function (o, c) { var n = range(this, o, c, "substringData"); return this.data.substr(o >>> 0, n); });
    def(P.CharacterData, "appendData", function (d) { this.data = this.data + String(d); });
    def(P.CharacterData, "insertData", function (o, d) { range(this, o, 0, "insertData"); this.data = this.data.slice(0, o >>> 0) + String(d) + this.data.slice(o >>> 0); });
    def(P.CharacterData, "deleteData", function (o, c) { var n = range(this, o, c, "deleteData"); this.data = this.data.slice(0, o >>> 0) + this.data.slice((o >>> 0) + n); });
    def(P.CharacterData, "replaceData", function (o, c, d) { var n = range(this, o, c, "replaceData"); this.data = this.data.slice(0, o >>> 0) + String(d) + this.data.slice((o >>> 0) + n); });
  })();
  var equalNodes = function (a, b) {
    if (a === b) return true;
    if (!a || !b || a.nodeType !== b.nodeType) return false;
    var t = a.nodeType;
    if (t === 10) { if (a.name !== b.name || a.publicId !== b.publicId || a.systemId !== b.systemId) return false; }
    else if (t === 1) {
      if (a.namespaceURI !== b.namespaceURI || a.prefix !== b.prefix || a.localName !== b.localName || a.attributes.length !== b.attributes.length) return false;
      for (var i = 0; i < a.attributes.length; i++) {
        var x = a.attributes[i];
        if (b.getAttributeNS(x.namespaceURI, x.localName) !== x.value || !b.hasAttributeNS(x.namespaceURI, x.localName)) return false;
      }
    } else if (t === 7) { if (a.target !== b.target || a.data !== b.data) return false; }
    else if (t === 3 || t === 8 || t === 4) { if (a.data !== b.data) return false; }
    var ca = a.childNodes, cb = b.childNodes;
    if (ca.length !== cb.length) return false;
    for (var j = 0; j < ca.length; j++) if (!equalNodes(ca[j], cb[j])) return false;
    return true;
  };
  def(P.Node, "isEqualNode", function (other) { return other != null && equalNodes(this, other); });
  def(P.Node, "isSameNode", function (other) { return this === other; });
  def(P.Node, "lookupNamespaceURI", function (prefix) {
    prefix = prefix || null;
    for (var n = this.nodeType === 9 ? this.documentElement : this; n && n.nodeType === 1; n = n.parentNode) {
      if (n.namespaceURI && n.prefix === prefix) return n.namespaceURI;
      var attrs = n.attributes;
      for (var i = 0; i < attrs.length; i++) {
        var at = attrs[i];
        if (at.namespaceURI === "http://www.w3.org/2000/xmlns/" && ((prefix === null && at.name === "xmlns") || (at.prefix === "xmlns" && at.localName === prefix))) return at.value || null;
      }
    }
    return null;
  });
  def(P.Node, "lookupPrefix", function (ns) {
    if (!ns) return null;
    for (var n = this.nodeType === 9 ? this.documentElement : this; n && n.nodeType === 1; n = n.parentNode) {
      if (n.namespaceURI === ns && n.prefix) return n.prefix;
      var attrs = n.attributes;
      for (var i = 0; i < attrs.length; i++) if (attrs[i].prefix === "xmlns" && attrs[i].value === ns) return attrs[i].localName;
    }
    return null;
  });
  def(P.Node, "isDefaultNamespace", function (ns) { return (ns || null) === this.lookupNamespaceURI(null); });
  getter(P.Node, "baseURI", function () {
    var doc = this.nodeType === 9 ? this : this.ownerDocument;
    var page = globalThis.location ? globalThis.location.href : "";
    var b = doc && doc.querySelector ? doc.querySelector("base[href]") : null;
    if (!b) return page;
    try { return new URL(b.getAttribute("href"), page).href; } catch (e) { return page; }
  });
  var liveMethod = function (proto, name) {
    var d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== "function") return;
    var orig = d.value;
    Object.defineProperty(proto, name, {
      value: function (arg) {
        var self = this;
        return liveCollection(function () { return orig.call(self, arg); }, false, "HTMLCollection");
      },
      writable: true, configurable: true,
    });
  };
  [P.Element, P.Document, P.DocumentFragment].forEach(function (p) { liveMethod(p, "getElementsByTagName"); liveMethod(p, "getElementsByClassName"); });

  // ---- the rest of a window's classes: events, EventTarget, DOMParser, ShadowRoot, ... (D.window: what boot.js installs)
  var W = (D.window = {});
  Object.keys(D.ctors).forEach(function (k) { W[k] = D.ctors[k]; });
  W.MutationObserver = MutationObserver;
  W.MutationRecord = MutationRecord;
  W.HTMLElement = HTMLElementShim;
  W.customElements = registry;

  var Event = function Event(type, init) {
    if (arguments.length === 0) throw new TypeError("Failed to construct 'Event': 1 argument required, but only 0 present.");
    init = init || {};
    this.type = String(type);
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
    this.defaultPrevented = false;
    this.cancelBubble = false;
    this.eventPhase = 0;
    this.target = this.currentTarget = this.srcElement = null;
    this.isTrusted = false;
    this.timeStamp = typeof performance !== "undefined" ? performance.now() : Date.now();
    Object.defineProperty(this, "_stopImmediatePropagationFlag", { value: false, writable: true });
    Object.defineProperty(this, "_path", { value: [], writable: true });
  };
  [["NONE", 0], ["CAPTURING_PHASE", 1], ["AT_TARGET", 2], ["BUBBLING_PHASE", 3]].forEach(function (c) {
    Object.defineProperty(Event, c[0], { value: c[1] });
    Object.defineProperty(Event.prototype, c[0], { value: c[1] });
  });
  def(Event.prototype, "preventDefault", function () { if (this.cancelable) this.defaultPrevented = true; });
  def(Event.prototype, "stopPropagation", function () { this.cancelBubble = true; });
  def(Event.prototype, "stopImmediatePropagation", function () { this.cancelBubble = true; this._stopImmediatePropagationFlag = true; });
  def(Event.prototype, "composedPath", function () { return this._path.map(function (p) { return p.currentTarget; }); });
  def(Event.prototype, "initEvent", function (type, bubbles, cancelable) { this.type = String(type); this.bubbles = !!bubbles; this.cancelable = !!cancelable; });
  getter(Event.prototype, "returnValue", function () { return !this.defaultPrevented; }, function (v) { if (!v) this.preventDefault(); });
  W.Event = Event;

  // subclasses: the init dictionary's members become properties (with the defaults a browser gives them)
  var subclass = function (name, parent, defaults) {
    var C = { [name]: function (type, init) {
      parent.call(this, type, init);
      init = init || {};
      for (var k in defaults) this[k] = k in init ? init[k] : defaults[k];
    } }[name];
    C.prototype = Object.create(parent.prototype, { constructor: { value: C, writable: true, configurable: true } });
    Object.setPrototypeOf(C, parent);
    W[name] = C;
    return C;
  };
  subclass("CustomEvent", Event, { detail: null });
  var UIEvent = subclass("UIEvent", Event, { detail: 0, view: null });
  var MouseEvent = subclass("MouseEvent", UIEvent, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, offsetX: 0, offsetY: 0, button: 0, buttons: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, relatedTarget: null });
  subclass("PointerEvent", MouseEvent, { pointerId: 0, width: 1, height: 1, pressure: 0, pointerType: "", isPrimary: false });
  subclass("WheelEvent", MouseEvent, { deltaX: 0, deltaY: 0, deltaZ: 0, deltaMode: 0 });
  subclass("KeyboardEvent", UIEvent, { key: "", code: "", location: 0, repeat: false, isComposing: false, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
  subclass("FocusEvent", UIEvent, { relatedTarget: null });
  subclass("InputEvent", UIEvent, { data: null, inputType: "", isComposing: false, dataTransfer: null });
  subclass("CompositionEvent", UIEvent, { data: "" });
  subclass("TouchEvent", UIEvent, { touches: [], targetTouches: [], changedTouches: [], ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
  subclass("MessageEvent", Event, { data: null, origin: "", lastEventId: "", source: null, ports: [] });
  subclass("StorageEvent", Event, { key: null, oldValue: null, newValue: null, url: "", storageArea: null });
  subclass("TransitionEvent", Event, { propertyName: "", elapsedTime: 0, pseudoElement: "" });
  subclass("AnimationEvent", Event, { animationName: "", elapsedTime: 0, pseudoElement: "" });
  subclass("ClipboardEvent", Event, { clipboardData: null });
  subclass("DragEvent", MouseEvent, { dataTransfer: null });
  subclass("SubmitEvent", Event, { submitter: null });
  subclass("HashChangeEvent", Event, { oldURL: "", newURL: "" });
  subclass("PopStateEvent", Event, { state: null });
  subclass("PageTransitionEvent", Event, { persisted: false });
  subclass("ErrorEvent", Event, { message: "", filename: "", lineno: 0, colno: 0, error: null });
  subclass("ProgressEvent", Event, { lengthComputable: false, loaded: 0, total: 0 });

  var EventTarget = function EventTarget() {};
  def(EventTarget.prototype, "addEventListener", addListener);
  def(EventTarget.prototype, "removeEventListener", removeListener);
  def(EventTarget.prototype, "dispatchEvent", dispatch);
  W.EventTarget = EventTarget;
  Object.setPrototypeOf(P.Node, EventTarget.prototype);
  Object.setPrototypeOf(D.ctors.Node, EventTarget);

  // Media elements. Nothing is decoded or played: the state a page reads is that of an element that has no usable source
  // (paused, duration NaN, readyState 0), and play() is refused the way a browser refuses it.
  (function () {
    var C = { HTMLMediaElement: function () { illegal(); } }.HTMLMediaElement;
    C.prototype = Object.create(P.HTMLElement, { constructor: { value: C, writable: true, configurable: true } });
    Object.setPrototypeOf(C, D.ctors.HTMLElement);
    D.ctors.HTMLMediaElement = C; P.HTMLMediaElement = C.prototype; W.HTMLMediaElement = C;
    ["HTMLVideoElement", "HTMLAudioElement"].forEach(function (n) {
      Object.setPrototypeOf(P[n], C.prototype);
      Object.setPrototypeOf(D.ctors[n], C);
    });
    var MP = C.prototype, state = new WeakMap();
    var st = function (el) {
      var s = state.get(el);
      if (!s) state.set(el, s = { muted: el.hasAttribute("muted"), volume: 1, time: 0, rate: 1, defaultRate: 1, srcObject: null });
      return s;
    };
    ["autoplay", "loop", "controls"].forEach(function (p) { reflectBool(MP, p, p); });
    reflectBool(MP, "playsInline", "playsinline");
    reflectBool(MP, "defaultMuted", "muted");
    reflectBool(MP, "disableRemotePlayback", "disableremoteplayback");
    getter(MP, "preload", function () { var v = (this.getAttribute("preload") || "").toLowerCase(); return v === "none" || v === "metadata" || v === "auto" ? v : "metadata"; }, function (v) { this.setAttribute("preload", String(v)); });
    getter(MP, "crossOrigin", function () { return this.getAttribute("crossorigin"); }, function (v) { if (v === null) this.removeAttribute("crossorigin"); else this.setAttribute("crossorigin", String(v)); });
    getter(MP, "muted", function () { return st(this).muted; }, function (v) { st(this).muted = !!v; });
    getter(MP, "volume", function () { return st(this).volume; }, function (v) {
      v = +v;
      if (!(v >= 0 && v <= 1)) throw domError("IndexSizeError", "The volume provided (" + v + ") is outside the range [0, 1].");
      st(this).volume = v;
    });
    getter(MP, "currentTime", function () { return st(this).time; }, function (v) { st(this).time = +v || 0; });
    getter(MP, "playbackRate", function () { return st(this).rate; }, function (v) { st(this).rate = +v; });
    getter(MP, "defaultPlaybackRate", function () { return st(this).defaultRate; }, function (v) { st(this).defaultRate = +v; });
    getter(MP, "srcObject", function () { return st(this).srcObject; }, function (v) { st(this).srcObject = v; });
    getter(MP, "currentSrc", function () { var s = this.getAttribute("src"); return s ? new URL(s, this.ownerDocument.baseURI || undefined).href : ""; });
    var constant = function (name, value) { getter(MP, name, function () { return value; }); };
    [["paused", true], ["ended", false], ["seeking", false], ["duration", NaN], ["readyState", 0], ["networkState", 0], ["error", null], ["videoWidth", 0], ["videoHeight", 0]].forEach(function (e) { constant(e[0], e[1]); });
    var ranges = function () {
      return {
        length: 0,
        start: function () { throw domError("IndexSizeError", "The index provided is greater than or equal to the maximum bound."); },
        end: function () { throw domError("IndexSizeError", "The index provided is greater than or equal to the maximum bound."); },
      };
    };
    ["buffered", "played", "seekable"].forEach(function (n) { getter(MP, n, ranges); });
    getter(MP, "textTracks", function () { return Object.assign(Object.create(EventTarget.prototype), { length: 0 }); });
    ["HAVE_NOTHING", "HAVE_METADATA", "HAVE_CURRENT_DATA", "HAVE_FUTURE_DATA", "HAVE_ENOUGH_DATA"].forEach(function (n, i) { C[n] = i; MP[n] = i; });
    ["NETWORK_EMPTY", "NETWORK_IDLE", "NETWORK_LOADING", "NETWORK_NO_SOURCE"].forEach(function (n, i) { C[n] = i; MP[n] = i; });
    def(MP, "play", function () { return Promise.reject(domError("NotSupportedError", "The element has no supported sources.")); });
    def(MP, "pause", function () {});
    def(MP, "load", function () {});
    def(MP, "canPlayType", function () { return ""; });
    def(MP, "fastSeek", function (t) { st(this).time = +t || 0; });
    def(MP, "addTextTrack", function () { return { kind: "subtitles", label: "", language: "", mode: "disabled", cues: null, addCue: function () {}, removeCue: function () {} }; });
    reflectString(P.HTMLVideoElement, "poster", "poster");
  })();

  // more element interfaces (the plain ones that have no members of their own here)
  ["HTMLUnknownElement", "HTMLMediaElement", "HTMLOptGroupElement", "HTMLSlotElement", "HTMLBaseElement", "HTMLDListElement",
   "HTMLEmbedElement", "HTMLMapElement", "HTMLObjectElement", "HTMLOutputElement", "HTMLParamElement", "HTMLPictureElement",
   "HTMLProgressElement", "HTMLQuoteElement", "HTMLTimeElement", "HTMLTrackElement", "HTMLMeterElement", "HTMLLegendElement",
   "HTMLDataElement", "HTMLDataListElement", "HTMLModElement", "HTMLAreaElement", "HTMLFontElement", "HTMLMenuElement"].forEach(function (name) {
    if (W[name]) return;
    var C = { [name]: function () { illegal(); } }[name];
    C.prototype = Object.create(P.HTMLElement, { constructor: { value: C, writable: true, configurable: true } });
    Object.setPrototypeOf(C, D.ctors.HTMLElement);
    W[name] = C;
  });

  // NodeIterator and TreeWalker (document order, live: they read the tree as it is when asked)
  var verdict = function (node, what, filter) {
    if (!(what & (1 << (node.nodeType - 1)))) return 3;
    if (!filter) return 1;
    return typeof filter === "function" ? filter(node) : filter.acceptNode(node);
  };
  // the next node in document order inside root, of a type in the mask (all, without one): the step is made in C
  var following = D.following;
  var preceding = function (node, root) {
    if (node === root) return null;
    var sib = node.previousSibling;
    if (!sib) return node.parentNode;
    while (sib.lastChild) sib = sib.lastChild;
    return sib;
  };
  def(P.Document, "createNodeIterator", function (root, what, filter) {
    what = what === undefined ? 0xFFFFFFFF : what >>> 0;
    var cur = null;
    return {
      root: root, whatToShow: what, filter: filter || null,
      get referenceNode() { return cur || root; },
      pointerBeforeReference: false,
      nextNode: function () {
        // without a filter the mask in C decides, in one call
        if (!filter && cur !== null) { var m = following(cur, root, false, what); if (m) cur = m; return m; }
        for (var n = cur === null ? root : following(cur, root, false, what); n; n = following(n, root, false, what)) if (verdict(n, what, filter) === 1) { cur = n; return n; }
        return null;
      },
      previousNode: function () {
        for (var n = cur === null ? null : preceding(cur, root); n; n = preceding(n, root)) if (verdict(n, what, filter) === 1) { cur = n; return n; }
        return null;
      },
      detach: function () {},
    };
  });
  def(P.Document, "createTreeWalker", function (root, what, filter) {
    what = what === undefined ? 0xFFFFFFFF : what >>> 0;
    var w = { root: root, whatToShow: what, filter: filter || null, currentNode: root };
    var ok = function (n) { return verdict(n, what, filter); };
    var walkNext = function () {
      if (!filter) { var m = following(w.currentNode, root, false, what); if (m) w.currentNode = m; return m; }
      var n = w.currentNode, skip = false;
      for (;;) {
        n = following(n, root, skip, what);
        if (!n) return null;
        var v = ok(n);
        if (v === 1) { w.currentNode = n; return n; }
        skip = v === 2;
      }
    };
    var walkPrev = function () {
      for (var n = preceding(w.currentNode, root); n; n = preceding(n, root)) if (ok(n) === 1) { w.currentNode = n; return n; }
      return null;
    };
    var child = function (first) {
      for (var n = first ? w.currentNode.firstChild : w.currentNode.lastChild; n; n = first ? n.nextSibling : n.previousSibling) {
        if (ok(n) === 1) { w.currentNode = n; return n; }
      }
      return null;
    };
    var sibling = function (next) {
      for (var n = next ? w.currentNode.nextSibling : w.currentNode.previousSibling; n; n = next ? n.nextSibling : n.previousSibling) {
        if (ok(n) === 1) { w.currentNode = n; return n; }
      }
      return null;
    };
    w.nextNode = walkNext;
    w.previousNode = walkPrev;
    w.firstChild = function () { return child(true); };
    w.lastChild = function () { return child(false); };
    w.nextSibling = function () { return sibling(true); };
    w.previousSibling = function () { return sibling(false); };
    w.parentNode = function () {
      for (var n = w.currentNode.parentNode; n && n !== root.parentNode; n = n.parentNode) if (ok(n) === 1) { w.currentNode = n; return n; }
      return null;
    };
    return w;
  });

  // The parser (a port of htmlparser2) builds what the markup says; a browser's tree builder also supplies the html, head
  // and body that the markup leaves out, and drops the blank text before <head>. This does that to a parsed document.
  var HEAD_TAGS = { base: 1, basefont: 1, bgsound: 1, link: 1, meta: 1, noscript: 1, script: 1, style: 1, template: 1, title: 1 };
  var isBlank = function (n) { return n.nodeType === 3 && !/[^\t\n\f\r ]/.test(n.data); };
  var fixStructure = function (doc) {
    var c, next, html = null, trailing = "";
    // blank text before <html> is dropped; after </html> it belongs to the body
    for (c = doc.firstChild; c; c = next) {
      next = c.nextSibling;
      if (c.nodeType === 1) html = html || c;
      if (isBlank(c) && (!html || html.localName === "html")) {
        if (html) trailing += c.data;
        doc.removeChild(c);
      }
    }
    if (!html || html.localName !== "html") {
      var start = doc.firstChild;
      while (start && (start.nodeType === 8 || start.nodeType === 10)) start = start.nextSibling;
      html = doc.createElement("html");
      doc.insertBefore(html, start);
      while (html.nextSibling) html.appendChild(html.nextSibling);
    }
    var head = null, body = null;
    for (c = html.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.localName === "head" && !head && !body) head = c;
      else if ((c.localName === "body" || c.localName === "frameset") && !body) body = c;
    }
    if (head) {
      for (c = html.firstChild; c && c !== head; c = next) {
        next = c.nextSibling;
        if (isBlank(c)) html.removeChild(c);
      }
    } else {
      for (c = html.firstChild; c && isBlank(c); c = next) {
        next = c.nextSibling;
        html.removeChild(c);
      }
      head = doc.createElement("head");
      html.insertBefore(head, html.firstChild);
      for (c = head.nextSibling; c && c !== body; c = next) {
        next = c.nextSibling;
        if (c.nodeType === 8 || isBlank(c) || (c.nodeType === 1 && HEAD_TAGS[c.localName])) head.appendChild(c);
        else break;
      }
    }
    if (!body) {
      body = doc.createElement("body");
      for (c = head.nextSibling; c; c = next) {
        next = c.nextSibling;
        body.appendChild(c);
      }
      html.appendChild(body);
    } else if (body.localName === "body") {
      // blank text after </body> is part of the body
      for (c = body.nextSibling; c && isBlank(c); c = next) {
        next = c.nextSibling;
        trailing = c.data + trailing;
        html.removeChild(c);
      }
    }
    if (trailing && body.localName === "body") {
      var last = body.lastChild;
      if (last && last.nodeType === 3) last.data += trailing;
      else body.appendChild(doc.createTextNode(trailing));
    }
    // a <tr> straight under a <table> sits in a <tbody> the parser makes
    var rows = doc.querySelectorAll("table > tr");
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      if (tr.parentNode.localName !== "table") continue;
      var prev = tr.previousElementSibling, tbody;
      if (prev && prev.localName === "tbody" && prev.__implied && prev.nextElementSibling === tr) tbody = prev;
      else {
        tbody = doc.createElement("tbody");
        Object.defineProperty(tbody, "__implied", { value: true, configurable: true });
        tr.parentNode.insertBefore(tbody, tr);
      }
      tbody.appendChild(tr);
      while (tbody.nextSibling && isBlank(tbody.nextSibling)) tbody.appendChild(tbody.nextSibling);
    }
  };
  var rawParse = D.parse;
  D.parseLoose = rawParse; // the parser's tree as it is, without the structure a browser adds
  D.parse = function (markup) {
    var doc = rawParse(markup);
    fixStructure(doc);
    return doc;
  };
  var DOMParser = function DOMParser() {};
  def(DOMParser.prototype, "parseFromString", function (markup, type) {
    var doc = D.parse(String(markup));
    // HTMLDocument is defined further down; at call time it exists, and text/html results are HTML documents
    if ((type === undefined || type === "text/html") && typeof HTMLDocument !== "undefined") Object.setPrototypeOf(doc, HTMLDocument.prototype);
    return doc;
  });
  W.DOMParser = DOMParser;
  W.XMLSerializer = function XMLSerializer() {};
  def(W.XMLSerializer.prototype, "serializeToString", function (node) { return D.serialize(node); });

  // Attr nodes: views of one attribute of an element (detached ones keep their own value)
  var Attr = function Attr() { illegal(); };
  var ATTR = Symbol("attr");
  var makeAttr = function (name, owner, value) {
    var at = Object.create(Attr.prototype);
    Object.defineProperty(at, ATTR, { value: { owner: owner, value: value === undefined ? "" : String(value) }, writable: true });
    Object.defineProperties(at, { name: { value: name, enumerable: true }, localName: { value: name, enumerable: true } });
    return at;
  };
  def(Attr.prototype, "nodeType", 2);
  getter(Attr.prototype, "nodeName", function () { return this.name; });
  getter(Attr.prototype, "specified", function () { return true; });
  getter(Attr.prototype, "namespaceURI", function () { return null; });
  getter(Attr.prototype, "prefix", function () { return null; });
  getter(Attr.prototype, "ownerElement", function () { return this[ATTR].owner; });
  getter(Attr.prototype, "value", function () {
    var st = this[ATTR];
    if (!st.owner) return st.value;
    var v = st.owner.getAttribute(this.name);
    return v === null ? st.value : v;
  }, function (v) {
    var st = this[ATTR];
    st.value = String(v);
    if (st.owner) st.owner.setAttribute(this.name, st.value);
  });
  getter(Attr.prototype, "nodeValue", function () { return this.value; }, function (v) { this.value = v; });
  getter(Attr.prototype, "textContent", function () { return this.value; }, function (v) { this.value = v; });
  W.Attr = Attr;
  def(P.Element, "getAttributeNode", function (name) {
    var v = this.getAttribute(name);
    return v === null ? null : makeAttr(String(name).toLowerCase(), this, v);
  });
  def(P.Element, "setAttributeNode", function (attr) {
    var old = this.getAttributeNode(attr.name);
    this.setAttribute(attr.name, attr.value);
    attr[ATTR].owner = this;
    return old;
  });
  def(P.Element, "removeAttributeNode", function (attr) {
    if (this.getAttribute(attr.name) === null) { var e = new Error("The node to be removed is not an attribute of this element."); e.name = "NotFoundError"; throw e; }
    attr[ATTR].value = this.getAttribute(attr.name);
    this.removeAttribute(attr.name);
    attr[ATTR].owner = null;
    return attr;
  });
  def(P.Document, "createAttribute", function (name) { return makeAttr(String(name).toLowerCase(), null, ""); });
  // attributes: a live NamedNodeMap (index, name, length, item, getNamedItem, ...) over the element's attributes
  var ATTRS = Symbol("attributes");
  getter(P.Element, "attributes", function () {
    var el = this;
    if (el[ATTRS]) return el[ATTRS];
    return Object.defineProperty(el, ATTRS, { value: liveCollection(function () {
      var list = el.getAttributeNames().map(function (name) { return makeAttr(name, el, el.getAttribute(name)); });
      list.forEach(function (at) { if (!(at.name in list)) list[at.name] = at; });
      Object.defineProperty(list, "getNamedItem", { value: function (n) { return el.getAttributeNode(n); } });
      Object.defineProperty(list, "removeNamedItem", { value: function (n) { var at = el.getAttributeNode(n); if (at) el.removeAttribute(n); return at; } });
      Object.defineProperty(list, "setNamedItem", { value: function (at) { return el.setAttributeNode(at); } });
      return list;
    }, false, "NamedNodeMap") })[ATTRS];
  });
  // document.implementation: one DOMImplementation per document. The C parser keeps no doctype
  // name/ids (a recorded gap), so createDocumentType parses a declaration for a real DocumentType
  // node and shadows the three fields with the values it was asked for.
  var DOMImplementation = function DOMImplementation() { illegal(); };
  W.DOMImplementation = DOMImplementation;
  // HTMLDocument: a Document subclass in name and prototype only — the C layer makes every document
  // with Document.prototype, so HTML documents (the page's own, createHTMLDocument's, DOMParser's
  // text/html results) have their prototype swapped for this one, which inherits Document's.
  var HTMLDocument = function HTMLDocument() { illegal(); };
  Object.setPrototypeOf(HTMLDocument.prototype, P.Document);
  Object.setPrototypeOf(HTMLDocument, D.ctors.Document);
  W.HTMLDocument = HTMLDocument;
  def(DOMImplementation.prototype, "hasFeature", function () { return true; });
  def(DOMImplementation.prototype, "createDocumentType", function (name, publicId, systemId) {
    name = String(name); publicId = String(publicId || ""); systemId = String(systemId || "");
    var decl = "<!DOCTYPE " + name +
      (publicId ? " PUBLIC \"" + publicId + "\"" + (systemId ? " \"" + systemId + "\"" : "") : systemId ? " SYSTEM \"" + systemId + "\"" : "") +
      "><html></html>";
    var dt = D.parse(decl).doctype;
    Object.defineProperties(dt, {
      name: { value: name, configurable: true, enumerable: true },
      publicId: { value: publicId, configurable: true, enumerable: true },
      systemId: { value: systemId, configurable: true, enumerable: true },
    });
    return dt;
  });
  def(DOMImplementation.prototype, "createDocument", function (ns, qname, doctype) {
    var doc = D.createDocument();
    if (doctype) doc.appendChild(doctype);
    if (qname) doc.appendChild(ns ? doc.createElementNS(ns, String(qname)) : doc.createElement(String(qname)));
    return doc;
  });
  def(DOMImplementation.prototype, "createHTMLDocument", function (title) {
    var doc = D.parse("<!doctype html><html><head></head><body></body></html>");
    Object.setPrototypeOf(doc, HTMLDocument.prototype);
    if (title !== undefined) doc.title = String(title);
    return doc;
  });
  var IMPL = new WeakMap();
  getter(P.Document, "implementation", function () {
    var im = IMPL.get(this);
    if (!im) IMPL.set(this, (im = Object.create(DOMImplementation.prototype)));
    return im;
  });
  // document.title is the text of the first <title>
  getter(P.Document, "title", function () {
    var t = this.querySelector("title");
    return t ? t.textContent.replace(/[ \t\n\f\r]+/g, " ").trim() : "";
  }, function (v) {
    var t = this.querySelector("title");
    if (!t) {
      t = this.createElement("title");
      var head = this.head;
      if (head) head.appendChild(t);
    }
    t.textContent = String(v);
  });
  var NodeList = function NodeList() { illegal(); };
  W.NodeList = NodeList;
  W.HTMLCollection = function HTMLCollection() { illegal(); };
  W.HTMLOptionsCollection = function HTMLOptionsCollection() { illegal(); };
  Object.setPrototypeOf(W.HTMLOptionsCollection.prototype, W.HTMLCollection.prototype);
  W.HTMLFormControlsCollection = function HTMLFormControlsCollection() { illegal(); };
  Object.setPrototypeOf(W.HTMLFormControlsCollection.prototype, W.HTMLCollection.prototype);
  W.NamedNodeMap = function NamedNodeMap() { illegal(); };
  W.RadioNodeList = RadioNodeList;
  Object.setPrototypeOf(RadioNodeList.prototype, NodeList.prototype);
  // NOT on the window table: the bridge would classify dataset objects as a known interface, and its class
  // wrappers keep host-side sets local (for expando properties) instead of forwarding them to the page —
  // but a DOMStringMap is nothing but named properties. boot.js picks the constructor up from here and
  // puts it on the global directly, like the other named-property objects (style) that stay unregistered.
  D.DOMStringMapCtor = DOMStringMap;
  // classList (and relList) objects are TokenList instances; the DOMTokenList name is the public one
  W.DOMTokenList = function DOMTokenList() { illegal(); };
  W.DOMTokenList.prototype = TokenList.prototype;
  Object.defineProperty(TokenList.prototype, "constructor", { value: W.DOMTokenList, writable: true, configurable: true });
  W.NodeFilter = { FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, SHOW_ALL: 0xFFFFFFFF, SHOW_ELEMENT: 1, SHOW_ATTRIBUTE: 2, SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8, SHOW_COMMENT: 128, SHOW_DOCUMENT: 256 };
  // ---- what user interaction needs: focus, the activation behaviour of a click, the selection of a text control, labels,
  // Range and Selection. (Ranges are not adjusted when the tree changes under them.)
  var domError = function (name, message) {
    var e = new Error(message);
    e.name = name;
    e.code = { IndexSizeError: 1, HierarchyRequestError: 3, InvalidStateError: 11, InvalidNodeTypeError: 24, WrongDocumentError: 4 }[name] || 0;
    return e;
  };

  // focus
  var focused = null;
  var FOCUS_TAGS = { input: 1, select: 1, textarea: 1, button: 1, summary: 1, iframe: 1 };
  var focusable = function (el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return false;
    if (el.hasAttribute("disabled") && (el.localName in FOCUS_TAGS)) return false;
    if (el.localName === "input" && el.getAttribute("type") === "hidden") return false;
    if (el.hasAttribute("tabindex")) return true;
    if (el.localName in FOCUS_TAGS) return true;
    if (el.localName === "a" && el.hasAttribute("href")) return true;
    var ce = el.getAttribute("contenteditable");
    return ce !== null && ce !== "false";
  };
  var focusEvent = function (type, bubbles, related) {
    var E = W.FocusEvent || W.Event;
    return new E(type, { bubbles: bubbles, cancelable: false, relatedTarget: related || null });
  };
  var activeOf = function (doc) { return focused && focused.isConnected && focused.ownerDocument === doc ? focused : doc.body; };
  getter(P.Document, "activeElement", function () { return activeOf(this); });
  def(P.HTMLElement, "focus", function () {
    if (!focusable(this) || focused === this) return;
    var prev = focused && focused.isConnected ? focused : null;
    focused = this;
    if (prev) { prev.dispatchEvent(focusEvent("blur", false, this)); prev.dispatchEvent(focusEvent("focusout", true, this)); }
    this.dispatchEvent(focusEvent("focus", false, prev));
    this.dispatchEvent(focusEvent("focusin", true, prev));
  });
  def(P.HTMLElement, "blur", function () {
    if (focused !== this) return;
    focused = null;
    this.dispatchEvent(focusEvent("blur", false, null));
    this.dispatchEvent(focusEvent("focusout", true, null));
  });

  // labels and the control of a label
  // the labels of a control: those whose for= is its id, and the label it is inside of (in tree order)
  var cssQuote = function (v) {
    var bs = String.fromCharCode(92);
    return '"' + v.split(bs).join(bs + bs).split('"').join(bs + '"') + '"';
  };
  var labelsOf = function (el) {
    var id = el.getAttribute("id"), out = [];
    if (id) out = Array.prototype.slice.call(el.getRootNode().querySelectorAll("label[for=" + cssQuote(id) + "]"));
    var wrap = el.closest("label");
    if (wrap && !wrap.hasAttribute("for") && out.indexOf(wrap) < 0 && controlOf(wrap) === el) out.push(wrap);
    if (out.length > 1) out.sort(function (a, b) { return a.compareDocumentPosition(b) & 4 ? -1 : 1; });
    return out;
  };
  var LABELABLE = "input, select, textarea, button, meter, output, progress";
  var controlOf = function (label) {
    var f = label.getAttribute("for");
    if (f !== null) {
      var byId = label.getRootNode().getElementById ? label.getRootNode().getElementById(f) : label.getRootNode().querySelector("[id=\"" + f + "\"]");
      return byId && byId.matches(LABELABLE) && !(byId.localName === "input" && byId.getAttribute("type") === "hidden") ? byId : null;
    }
    var inner = label.querySelector(LABELABLE);
    return inner && !(inner.localName === "input" && inner.getAttribute("type") === "hidden") ? inner : null;
  };
  ["HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLButtonElement"].forEach(function (name) {
    var LABELS = Symbol("labels");
    getter(P[name], "labels", function () {
      var el = this;
      return el[LABELS] || Object.defineProperty(el, LABELS, { value: liveCollection(function () { return labelsOf(el); }, false, "NodeList") })[LABELS];
    });
  });
  getter(P.HTMLLabelElement, "control", function () { return controlOf(this); });
  getter(P.HTMLLabelElement, "htmlFor", function () { return this.getAttribute("for") || ""; }, function (v) { this.setAttribute("for", String(v)); });

  // the selection of a text control
  var SEL = Symbol("selection");
  var textValue = function (el) { return String(el.value); };
  var selOf = function (el) {
    var len = textValue(el).length, s = el[SEL];
    if (!s) return { start: len, end: len, dir: "none" };
    return { start: Math.min(s.start, len), end: Math.min(s.end, len), dir: s.dir };
  };
  var TEXTY = ["text", "search", "url", "tel", "password", ""];
  var selectable = function (el) { return el.localName === "textarea" || (el.localName === "input" && TEXTY.indexOf((el.getAttribute("type") || "").toLowerCase()) >= 0); };
  ["HTMLInputElement", "HTMLTextAreaElement"].forEach(function (name) {
    var proto = P[name];
    getter(proto, "selectionStart", function () { return selectable(this) ? selOf(this).start : null; }, function (v) {
      var s = selOf(this); v = Math.max(0, Math.min(Number(v) || 0, textValue(this).length));
      this[SEL] = { start: v, end: Math.max(v, s.end), dir: s.dir };
    });
    getter(proto, "selectionEnd", function () { return selectable(this) ? selOf(this).end : null; }, function (v) {
      var s = selOf(this); v = Math.max(0, Math.min(Number(v) || 0, textValue(this).length));
      this[SEL] = { start: Math.min(s.start, v), end: v, dir: s.dir };
    });
    getter(proto, "selectionDirection", function () { return selectable(this) ? selOf(this).dir : null; }, function (v) {
      var s = selOf(this); this[SEL] = { start: s.start, end: s.end, dir: String(v) };
    });
    def(proto, "setSelectionRange", function (start, end, dir) {
      var len = textValue(this).length;
      start = Math.max(0, Math.min(Number(start) || 0, len)); end = Math.max(0, Math.min(Number(end) || 0, len));
      if (end < start) start = end;
      this[SEL] = { start: start, end: end, dir: dir || "none" };
      this.dispatchEvent(new W.Event("select", { bubbles: true }));
    });
    def(proto, "select", function () {
      this[SEL] = { start: 0, end: textValue(this).length, dir: "none" };
      this.dispatchEvent(new W.Event("select", { bubbles: true }));
    });
    def(proto, "setRangeText", function (text, start, end, mode) {
      var s = selOf(this), v = textValue(this);
      if (start === undefined) { start = s.start; end = s.end; }
      start = Math.max(0, Math.min(start, v.length)); end = Math.max(start, Math.min(end, v.length));
      var before = v.slice(0, start), after = v.slice(end);
      this.value = before + text + after;
      var at = start + String(text).length;
      mode = mode || "preserve";
      if (mode === "select") this[SEL] = { start: start, end: at, dir: "none" };
      else if (mode === "start") this[SEL] = { start: start, end: start, dir: "none" };
      else if (mode === "end") this[SEL] = { start: at, end: at, dir: "none" };
      else this[SEL] = { start: s.start >= end ? s.start + (at - end) : Math.min(s.start, at), end: s.end >= end ? s.end + (at - end) : Math.min(s.end, at), dir: "none" };
    });
  });
  // setting the value puts the caret at its end
  ["HTMLInputElement", "HTMLTextAreaElement"].forEach(function (name) {
    var d = Object.getOwnPropertyDescriptor(P[name], "value");
    if (!d || !d.set) return;
    Object.defineProperty(P[name], "value", { configurable: true, enumerable: true, get: d.get, set: function (v) { d.set.call(this, v); this[SEL] = undefined; } });
  });

  // the activation behaviour of a click: a checkbox toggles, a radio is chosen, a label clicks its control, a submit button
  // submits the form (nothing navigates), a summary opens its details
  var activatable = function (el) {
    if (el.nodeType !== 1) return false;
    var tag = el.localName, type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input") return !el.hasAttribute("disabled") && (type === "checkbox" || type === "radio" || type === "submit" || type === "reset");
    if (tag === "button") return !el.hasAttribute("disabled");
    if (tag === "label") return true;
    if (tag === "summary") return !!el.parentNode && el.parentNode.localName === "details";
    return false;
  };
  var radiosOf = function (el) {
    var name = el.getAttribute("name");
    if (!name) return [el];
    var scope = el.form || el.getRootNode();
    return Array.prototype.filter.call(scope.querySelectorAll("input[type=radio]"), function (r) { return r.getAttribute("name") === name && r.form === el.form; });
  };
  var preActivate = function (el, ev) {
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (el.localName === "input" && type === "checkbox") { var was = el.checked; el.checked = !was; return { restore: function () { el.checked = was; } }; }
    if (el.localName === "input" && type === "radio") {
      var group = radiosOf(el), before = group.map(function (r) { return r.checked; });
      group.forEach(function (r) { r.checked = r === el; });
      return { restore: function () { group.forEach(function (r, i) { r.checked = before[i]; }); } };
    }
    return null;
  };
  var activate = function (el, ev) {
    var type = (el.getAttribute("type") || "").toLowerCase(), tag = el.localName;
    if (tag === "input" && (type === "checkbox" || type === "radio")) {
      if (el.isConnected) {
        el.dispatchEvent(new W.Event("input", { bubbles: true }));
        el.dispatchEvent(new W.Event("change", { bubbles: true }));
      }
    } else if ((tag === "input" && (type === "submit" || type === "reset")) || tag === "button") {
      var kind = tag === "button" ? (type || "submit") : type, form = el.form;
      if (form && kind === "submit") form.requestSubmit(el);
      else if (form && kind === "reset") form.reset();
    } else if (tag === "label") {
      var control = controlOf(el);
      if (control && !control.contains(ev.target)) {
        control.focus();
        control.dispatchEvent(new (W.MouseEvent || W.Event)("click", { bubbles: true, cancelable: true }));
      }
    } else if (tag === "summary") {
      el.parentNode.open = !el.parentNode.open;
      el.parentNode.dispatchEvent(new W.Event("toggle"));
    }
  };
  var rawDispatch = dispatch;
  var activating = function (ev) {
    var target = null;
    if (ev && ev.type === "click" && this.nodeType === 1 && (!W.MouseEvent || ev instanceof W.MouseEvent)) {
      for (var n = this; n; n = n.parentNode) {
        if (activatable(n)) { target = n; break; }
        if (!ev.bubbles) break;
      }
    }
    var pre = target ? preActivate(target, ev) : null;
    var result = rawDispatch.call(this, ev);
    if (target) {
      if (ev.defaultPrevented) { if (pre) pre.restore(); }
      else activate(target, ev);
    }
    return result;
  };
  dispatch = activating;
  [P.Node].forEach(function (proto) { def(proto, "dispatchEvent", activating); });
  def(P.HTMLElement, "click", function () {
    if (this.hasAttribute("disabled") && (this.localName in FOCUS_TAGS)) return;
    this.dispatchEvent(new (W.MouseEvent || W.Event)("click", { bubbles: true, cancelable: true }));
  });

  // Range
  var nodeLength = function (n) { return n.nodeType === 3 || n.nodeType === 8 ? n.data.length : n.childNodes.length; };
  var indexOf = function (n) { var i = 0; for (var c = n.previousSibling; c; c = c.previousSibling) i++; return i; };
  var rootOf = function (n) { while (n.parentNode) n = n.parentNode; return n; };
  var isInclusiveAncestor = function (a, n) { for (; n; n = n.parentNode) if (n === a) return true; return false; };
  // -1, 0, 1: where boundary point (a, ao) is against (b, bo)
  var comparePoints = function (a, ao, b, bo) {
    if (a === b) return ao < bo ? -1 : ao > bo ? 1 : 0;
    if (isInclusiveAncestor(a, b)) {
      var c = b; while (c.parentNode !== a) c = c.parentNode;
      return indexOf(c) < ao ? 1 : -1;
    }
    if (isInclusiveAncestor(b, a)) return -comparePoints(b, bo, a, ao);
    return a.compareDocumentPosition(b) & 4 ? -1 : 1;
  };
  var checkNode = function (n) {
    if (!n || typeof n.nodeType !== "number") throw new TypeError("The node provided is not a Node.");
    if (n.nodeType === 10) throw domError("InvalidNodeTypeError", "The node is a doctype.");
  };
  var checkOffset = function (n, o) { if (o > nodeLength(n) || o < 0) throw domError("IndexSizeError", "The offset " + o + " is larger than the node's length (" + nodeLength(n) + ")."); };
  // Live ranges: when the tree changes under a range its boundary points move as the specification says. The
  // primitive mutators are wrapped once the first range exists; ranges are held weakly.
  var liveRanges = [];
  var eachRange = function (fn) {
    for (var i = liveRanges.length - 1; i >= 0; i--) {
      var r = liveRanges[i].deref();
      if (!r) { liveRanges.splice(i, 1); continue; }
      var sc = r._sc, so = r._so, ec = r._ec, eo = r._eo;
      fn(r);
      if (r._selection && (sc !== r._sc || so !== r._so || ec !== r._ec || eo !== r._eo)) r._selection._changed();
    }
  };
  var rangesRemove = function (node) {
    var p = node.parentNode;
    if (!p || !liveRanges.length) return;
    var i = indexOf(node);
    eachRange(function (r) {
      if (isInclusiveAncestor(node, r._sc)) { r._sc = p; r._so = i; } else if (r._sc === p && r._so > i) r._so--;
      if (isInclusiveAncestor(node, r._ec)) { r._ec = p; r._eo = i; } else if (r._ec === p && r._eo > i) r._eo--;
    });
  };
  var rangesInsert = function (p, i, count) {
    if (!count || !liveRanges.length) return;
    eachRange(function (r) {
      if (r._sc === p && r._so > i) r._so += count;
      if (r._ec === p && r._eo > i) r._eo += count;
    });
  };
  var rangesReplaceAll = function (node) {
    // all children of node replaced: boundaries inside it (or after its start) collapse to its start
    if (!liveRanges.length) return;
    eachRange(function (r) {
      if (isInclusiveAncestor(node, r._sc) && (r._sc !== node || r._so > 0)) { r._sc = node; r._so = 0; }
      if (isInclusiveAncestor(node, r._ec) && (r._ec !== node || r._eo > 0)) { r._ec = node; r._eo = 0; }
    });
  };
  var rangesReplaceData = function (node) {
    if (!liveRanges.length) return;
    var len = node.data.length;
    eachRange(function (r) {
      if (r._sc === node && r._so > 0 && r._so <= len) r._so = 0;
      if (r._ec === node && r._eo > 0 && r._eo <= len) r._eo = 0;
    });
  };
  var rangesInstalled = false;
  var installRanges = function () {
    rangesInstalled = true;
    var count = function (n) { return n.nodeType === 11 ? n.childNodes.length : 1; };
    wrap(P.Node, "appendChild", function (orig) {
      return function (node) {
        if (node.nodeType !== 11) rangesRemove(node);
        var i = this.childNodes.length, c = count(node);
        var r = orig.call(this, node);
        rangesInsert(this, i, c);
        return r;
      };
    });
    wrap(P.Node, "insertBefore", function (orig) {
      return function (node, ref) {
        if (node.nodeType !== 11 && node !== ref) rangesRemove(node);
        var i = ref ? indexOf(ref) : this.childNodes.length, c = count(node);
        var r = orig.call(this, node, ref);
        rangesInsert(this, i, c);
        return r;
      };
    });
    wrap(P.Node, "removeChild", function (orig) {
      return function (node) {
        if (node && node.parentNode === this) rangesRemove(node);
        return orig.call(this, node);
      };
    });
    wrap(P.Node, "replaceChild", function (orig) {
      return function (node, old) {
        if (old && old.parentNode === this && node !== old) {
          if (node.nodeType !== 11) rangesRemove(node);
          var i = indexOf(old), c = count(node);
          rangesRemove(old);
          var r = orig.call(this, node, old);
          rangesInsert(this, i, c);
          return r;
        }
        return orig.call(this, node, old);
      };
    });
    wrap(P.Node, "textContent", function (set) {
      return function (v) {
        if (this.nodeType === 3 || this.nodeType === 8) rangesReplaceData(this); else rangesReplaceAll(this);
        set.call(this, v);
      };
    });
    wrap(P.Element, "innerHTML", function (set) {
      return function (v) { rangesReplaceAll(this); set.call(this, v); };
    });
    wrap(P.CharacterData, "data", function (set) {
      return function (v) { rangesReplaceData(this); set.call(this, v); };
    });
  };
  var Range = function Range() {
    var doc = globalThis.document;
    this._sc = this._ec = doc; this._so = this._eo = 0;
    if (!rangesInstalled) installRanges();
    liveRanges.push(new WeakRef(this));
  };
  var rangeProto = Range.prototype;
  var setBoundary = function (range, isStart, node, offset) {
    checkNode(node); offset = offset >>> 0; checkOffset(node, offset);
    if (isStart) {
      if (rootOf(node) !== rootOf(range._ec) || comparePoints(node, offset, range._ec, range._eo) > 0) { range._ec = node; range._eo = offset; }
      range._sc = node; range._so = offset;
    } else {
      if (rootOf(node) !== rootOf(range._sc) || comparePoints(node, offset, range._sc, range._so) < 0) { range._sc = node; range._so = offset; }
      range._ec = node; range._eo = offset;
    }
    if (range._selection) range._selection._changed();
  };
  [["startContainer", "_sc"], ["startOffset", "_so"], ["endContainer", "_ec"], ["endOffset", "_eo"]].forEach(function (p) {
    getter(rangeProto, p[0], function () { return this[p[1]]; });
  });
  getter(rangeProto, "collapsed", function () { return this._sc === this._ec && this._so === this._eo; });
  getter(rangeProto, "commonAncestorContainer", function () { var c = this._sc; while (!isInclusiveAncestor(c, this._ec)) c = c.parentNode; return c; });
  def(rangeProto, "setStart", function (n, o) { setBoundary(this, true, n, o); });
  def(rangeProto, "setEnd", function (n, o) { setBoundary(this, false, n, o); });
  def(rangeProto, "setStartBefore", function (n) { if (!n.parentNode) throw domError("InvalidNodeTypeError", "No parent."); setBoundary(this, true, n.parentNode, indexOf(n)); });
  def(rangeProto, "setStartAfter", function (n) { if (!n.parentNode) throw domError("InvalidNodeTypeError", "No parent."); setBoundary(this, true, n.parentNode, indexOf(n) + 1); });
  def(rangeProto, "setEndBefore", function (n) { if (!n.parentNode) throw domError("InvalidNodeTypeError", "No parent."); setBoundary(this, false, n.parentNode, indexOf(n)); });
  def(rangeProto, "setEndAfter", function (n) { if (!n.parentNode) throw domError("InvalidNodeTypeError", "No parent."); setBoundary(this, false, n.parentNode, indexOf(n) + 1); });
  def(rangeProto, "collapse", function (toStart) {
    if (toStart) { this._ec = this._sc; this._eo = this._so; } else { this._sc = this._ec; this._so = this._eo; }
    if (this._selection) this._selection._changed();
  });
  def(rangeProto, "selectNode", function (n) {
    var p = n.parentNode;
    if (!p) throw domError("InvalidNodeTypeError", "The node has no parent.");
    var i = indexOf(n);
    this._sc = this._ec = p; this._so = i; this._eo = i + 1;
    if (this._selection) this._selection._changed();
  });
  def(rangeProto, "selectNodeContents", function (n) {
    checkNode(n);
    this._sc = this._ec = n; this._so = 0; this._eo = nodeLength(n);
    if (this._selection) this._selection._changed();
  });
  def(rangeProto, "cloneRange", function () {
    var r = new Range();
    r._sc = this._sc; r._so = this._so; r._ec = this._ec; r._eo = this._eo;
    return r;
  });
  def(rangeProto, "detach", function () {});
  def(rangeProto, "isPointInRange", function (n, o) {
    checkNode(n);
    if (rootOf(n) !== rootOf(this._sc)) return false;
    checkOffset(n, o);
    return comparePoints(n, o, this._sc, this._so) >= 0 && comparePoints(n, o, this._ec, this._eo) <= 0;
  });
  def(rangeProto, "comparePoint", function (n, o) {
    checkNode(n);
    if (rootOf(n) !== rootOf(this._sc)) throw domError("WrongDocumentError", "The node is in another tree.");
    checkOffset(n, o);
    if (comparePoints(n, o, this._sc, this._so) < 0) return -1;
    return comparePoints(n, o, this._ec, this._eo) > 0 ? 1 : 0;
  });
  def(rangeProto, "intersectsNode", function (n) {
    if (rootOf(n) !== rootOf(this._sc)) return false;
    var p = n.parentNode;
    if (!p) return true;
    var i = indexOf(n);
    return comparePoints(p, i, this._ec, this._eo) < 0 && comparePoints(p, i + 1, this._sc, this._so) > 0;
  });
  def(rangeProto, "compareBoundaryPoints", function (how, source) {
    var a, ao, b, bo;
    if (how === 0) { a = this._sc; ao = this._so; b = source._sc; bo = source._so; }
    else if (how === 1) { a = this._ec; ao = this._eo; b = source._sc; bo = source._so; }
    else if (how === 2) { a = this._ec; ao = this._eo; b = source._ec; bo = source._eo; }
    else if (how === 3) { a = this._sc; ao = this._so; b = source._ec; bo = source._eo; }
    else throw domError("NotSupportedError", "The comparison method provided must be one of START_TO_START, START_TO_END, END_TO_END, END_TO_START.");
    return comparePoints(a, ao, b, bo);
  });
  ["START_TO_START", "START_TO_END", "END_TO_END", "END_TO_START"].forEach(function (k, i) { Range[k] = i; rangeProto[k] = i; });
  // the nodes the range takes whole, in order, and the text nodes it cuts into
  var contained = function (range) {
    var out = [], root = range.commonAncestorContainer;
    var walk = function (n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        var whole = comparePoints(c.parentNode, indexOf(c), range._sc, range._so) >= 0 && comparePoints(c.parentNode, indexOf(c) + 1, range._ec, range._eo) <= 0;
        if (whole) out.push(c); else walk(c);
      }
    };
    walk(root);
    return out;
  };
  def(rangeProto, "toString", function () {
    var s = this._sc, e = this._ec;
    if (s === e && s.nodeType === 3) return s.data.slice(this._so, this._eo);
    var out = "";
    if (s.nodeType === 3) out += s.data.slice(this._so);
    var text = function (n) {
      if (n.nodeType === 3) out += n.data;
      else for (var c = n.firstChild; c; c = c.nextSibling) text(c);
    };
    contained(this).forEach(function (n) { if (n.nodeType === 3 || n.nodeType === 1) text(n); });
    if (e.nodeType === 3 && s !== e) out += e.data.slice(0, this._eo);
    return out;
  });
  def(rangeProto, "deleteContents", function () {
    if (this.collapsed) return;
    var s = this._sc, e = this._ec, so = this._so, eo = this._eo;
    if (s === e && (s.nodeType === 3 || s.nodeType === 8)) { s.data = s.data.slice(0, so) + s.data.slice(eo); this._eo = so; return; }
    var nodes = contained(this), newNode, newOffset;
    if (isInclusiveAncestor(s, e)) { newNode = s; newOffset = so; }
    else {
      var ref = s; while (ref.parentNode && !isInclusiveAncestor(ref.parentNode, e)) ref = ref.parentNode;
      newNode = ref.parentNode; newOffset = indexOf(ref) + 1;
    }
    if (s.nodeType === 3 || s.nodeType === 8) s.data = s.data.slice(0, so);
    nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    if (e.nodeType === 3 || e.nodeType === 8) e.data = e.data.slice(eo);
    this._sc = this._ec = newNode; this._so = this._eo = newOffset;
    if (this._selection) this._selection._changed();
  });
  def(rangeProto, "cloneContents", function () {
    var frag = this.commonAncestorContainer.ownerDocument ? this.commonAncestorContainer.ownerDocument.createDocumentFragment() : document.createDocumentFragment();
    if (this.collapsed) return frag;
    var s = this._sc, e = this._ec;
    if (s === e && (s.nodeType === 3 || s.nodeType === 8)) {
      var one = s.cloneNode(false); one.data = s.data.slice(this._so, this._eo); frag.appendChild(one); return frag;
    }
    if (s.nodeType === 3) { var head = s.cloneNode(false); head.data = s.data.slice(this._so); frag.appendChild(head); }
    contained(this).forEach(function (n) { frag.appendChild(n.cloneNode(true)); });
    if (e.nodeType === 3 && s !== e) { var tail = e.cloneNode(false); tail.data = e.data.slice(0, this._eo); frag.appendChild(tail); }
    return frag;
  });
  def(rangeProto, "extractContents", function () {
    var frag = this.cloneContents();
    this.deleteContents();
    return frag;
  });
  def(rangeProto, "insertNode", function (node) {
    var s = this._sc, o = this._so;
    if (s.nodeType === 3) {
      var rest = s.splitText ? s.splitText(o) : null;
      if (rest) { s.parentNode.insertBefore(node, rest); return; }
    }
    var before = s.nodeType === 3 ? s.nextSibling : s.childNodes[o] || null;
    var parent = s.nodeType === 3 ? s.parentNode : s;
    parent.insertBefore(node, before);
    if (this.collapsed) { this._ec = parent; this._eo = indexOf(node) + 1; }
  });
  def(rangeProto, "surroundContents", function (wrapper) {
    var contents = this.extractContents();
    wrapper.appendChild(contents);
    this.insertNode(wrapper);
    this.selectNode(wrapper);
  });
  def(rangeProto, "createContextualFragment", function (html) { return D.parseFragment(String(html), this._sc.ownerDocument || this._sc); });
  def(rangeProto, "getBoundingClientRect", function () { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; });
  def(rangeProto, "getClientRects", function () { return []; });
  W.Range = Range;
  def(P.Document, "createRange", function () {
    var r = new Range();
    r._sc = r._ec = this;
    return r;
  });

  // Selection (one range at most, as in Chrome)
  var Selection = function Selection() { illegal(); };
  var selections = new WeakMap();
  var makeSelection = function (doc) {
    var s = Object.create(Selection.prototype);
    Object.defineProperty(s, "_doc", { value: doc });
    Object.defineProperty(s, "_range", { value: null, writable: true });
    Object.defineProperty(s, "_backward", { value: false, writable: true });
    Object.defineProperty(s, "_changed", { value: function () {}, writable: true });
    return s;
  };
  var selProto = Selection.prototype;
  var setRange = function (sel, range, backward) {
    if (sel._range) sel._range._selection = null;
    sel._range = range;
    sel._backward = !!backward;
    if (range) Object.defineProperty(range, "_selection", { value: sel, configurable: true, writable: true });
    sel._doc.dispatchEvent(new W.Event("selectionchange"));
  };
  getter(selProto, "rangeCount", function () { return this._range ? 1 : 0; });
  getter(selProto, "isCollapsed", function () { return !this._range || this._range.collapsed; });
  getter(selProto, "type", function () { return !this._range ? "None" : this._range.collapsed ? "Caret" : "Range"; });
  getter(selProto, "direction", function () { return !this._range || this._range.collapsed ? "none" : this._backward ? "backward" : "forward"; });
  getter(selProto, "anchorNode", function () { return this._range ? (this._backward ? this._range._ec : this._range._sc) : null; });
  getter(selProto, "anchorOffset", function () { return this._range ? (this._backward ? this._range._eo : this._range._so) : 0; });
  getter(selProto, "focusNode", function () { return this._range ? (this._backward ? this._range._sc : this._range._ec) : null; });
  getter(selProto, "focusOffset", function () { return this._range ? (this._backward ? this._range._so : this._range._eo) : 0; });
  def(selProto, "getRangeAt", function (i) {
    if (i !== 0 || !this._range) throw domError("IndexSizeError", "This selection has no range at index " + i + ".");
    return this._range;
  });
  def(selProto, "addRange", function (range) { if (!this._range && rootOf(range._sc) === this._doc) setRange(this, range, false); });
  def(selProto, "removeRange", function (range) {
    if (this._range !== range) throw domError("NotFoundError", "The range is not in the selection.");
    setRange(this, null, false);
  });
  def(selProto, "removeAllRanges", function () { if (this._range) setRange(this, null, false); });
  def(selProto, "empty", function () { if (this._range) setRange(this, null, false); });
  var pointRange = function (sel, an, ao, fn, fo) {
    checkNode(an); checkNode(fn); checkOffset(an, ao); checkOffset(fn, fo);
    var r = new Range(), backward = comparePoints(fn, fo, an, ao) < 0;
    r._sc = backward ? fn : an; r._so = backward ? fo : ao; r._ec = backward ? an : fn; r._eo = backward ? ao : fo;
    setRange(sel, r, backward);
  };
  def(selProto, "setBaseAndExtent", function (an, ao, fn, fo) { pointRange(this, an, ao >>> 0, fn, fo >>> 0); });
  def(selProto, "collapse", function (node, offset) {
    if (node === null || node === undefined) { this.removeAllRanges(); return; }
    pointRange(this, node, (offset || 0) >>> 0, node, (offset || 0) >>> 0);
  });
  def(selProto, "setPosition", selProto.collapse);
  def(selProto, "collapseToStart", function () { if (!this._range) throw domError("InvalidStateError", "There is no selection."); this._range.collapse(true); });
  def(selProto, "collapseToEnd", function () { if (!this._range) throw domError("InvalidStateError", "There is no selection."); this._range.collapse(false); });
  def(selProto, "extend", function (node, offset) {
    if (!this._range) throw domError("InvalidStateError", "There is no selection.");
    var an = this.anchorNode, ao = this.anchorOffset;
    pointRange(this, an, ao, node, (offset || 0) >>> 0);
  });
  def(selProto, "selectAllChildren", function (node) { pointRange(this, node, 0, node, nodeLength(node)); });
  def(selProto, "deleteFromDocument", function () { if (this._range) this._range.deleteContents(); });
  def(selProto, "containsNode", function (node, partial) {
    if (!this._range) return false;
    var r = this._range, p = node.parentNode;
    if (!p || rootOf(node) !== rootOf(r._sc)) return false;
    var i = indexOf(node), startsBefore = comparePoints(p, i, r._sc, r._so) < 0, endsAfter = comparePoints(p, i + 1, r._ec, r._eo) > 0;
    return partial ? comparePoints(p, i, r._ec, r._eo) < 0 && comparePoints(p, i + 1, r._sc, r._so) > 0 : !startsBefore && !endsAfter;
  });
  def(selProto, "modify", function () {});
  def(selProto, "toString", function () { return this._range ? this._range.toString() : ""; });
  W.Selection = Selection;
  var selectionOfDoc = function (doc) {
    var s = selections.get(doc);
    if (!s) selections.set(doc, (s = makeSelection(doc)));
    return s;
  };
  def(P.Document, "getSelection", function () { return selectionOfDoc(this); });
  W.getSelection = function getSelection() { return selectionOfDoc(globalThis.document); };

  // ---- XPath 1.0: document.evaluate, XPathEvaluator, XPathResult (the axes, predicates and the core functions)
  var XPathResult = function XPathResult() { illegal(); };
  var XPR = { ANY_TYPE: 0, NUMBER_TYPE: 1, STRING_TYPE: 2, BOOLEAN_TYPE: 3, UNORDERED_NODE_ITERATOR_TYPE: 4, ORDERED_NODE_ITERATOR_TYPE: 5, UNORDERED_NODE_SNAPSHOT_TYPE: 6, ORDERED_NODE_SNAPSHOT_TYPE: 7, ANY_UNORDERED_NODE_TYPE: 8, FIRST_ORDERED_NODE_TYPE: 9 };
  Object.keys(XPR).forEach(function (k) { XPathResult[k] = XPR[k]; XPathResult.prototype[k] = XPR[k]; });
  W.XPathResult = XPathResult;
  var xpStr = function (v) {
    if (Array.isArray(v)) return v.length ? xpNodeStr(v[0]) : "";
    if (typeof v === "number") return v !== v ? "NaN" : v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : String(v);
    return String(v);
  };
  var xpNodeStr = function (n) { return n.nodeType === 2 ? n.value : n.textContent == null ? "" : n.textContent; };
  var xpNum = function (v) { return typeof v === "number" ? v : Array.isArray(v) || typeof v === "string" ? (function (s) { s = s.trim(); return s === "" ? NaN : Number(s); })(xpStr(v)) : v ? 1 : 0; };
  var xpBool = function (v) { return Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.length > 0 : typeof v === "number" ? v !== 0 && v === v : !!v; };
  var xpOrder = function (list) {
    var out = [], seen = new Set();
    list.forEach(function (n) { if (!seen.has(n)) { seen.add(n); out.push(n); } });
    return out.sort(function (a, b) {
      if (a === b) return 0;
      if (a.nodeType === 2 || b.nodeType === 2) return 0;
      return a.compareDocumentPosition(b) & 4 ? -1 : 1;
    });
  };
  var xpAxis = function (axis, n) {
    var out = [], c, p;
    switch (axis) {
      case "child": for (c = n.firstChild; c; c = c.nextSibling) out.push(c); break;
      case "descendant": case "descendant-or-self":
        if (axis === "descendant-or-self") out.push(n);
        for (c = following(n, n, false); c; c = following(c, n, false)) out.push(c);
        break;
      case "parent": if (n.nodeType === 2) { if (n.ownerElement) out.push(n.ownerElement); } else if (n.parentNode) out.push(n.parentNode); break;
      case "ancestor": case "ancestor-or-self":
        if (axis === "ancestor-or-self") out.push(n);
        for (p = n.nodeType === 2 ? n.ownerElement : n.parentNode; p; p = p.parentNode) out.push(p);
        break;
      case "following-sibling": for (c = n.nextSibling; c; c = c.nextSibling) out.push(c); break;
      case "preceding-sibling": for (c = n.previousSibling; c; c = c.previousSibling) out.push(c); break;
      case "following":
        for (p = n; p; p = p.parentNode) for (c = p.nextSibling; c; c = c.nextSibling) { out.push(c); for (var d = following(c, c, false); d; d = following(d, c, false)) out.push(d); }
        break;
      case "preceding":
        for (p = n; p; p = p.parentNode) for (c = p.previousSibling; c; c = c.previousSibling) { out.push(c); for (var e = following(c, c, false); e; e = following(e, c, false)) out.push(e); }
        break;
      case "attribute": if (n.nodeType === 1) for (var i = 0; i < n.attributes.length; i++) out.push(n.attributes[i]); break;
      case "self": out.push(n); break;
      default: throw new SyntaxError("XPath: unknown axis " + axis);
    }
    return out;
  };
  var xpReverse = { ancestor: 1, "ancestor-or-self": 1, "preceding-sibling": 1, preceding: 1 };
  var xpIsName = function (ch) { return ch !== "" && "()[],@|=<>!+*/:\"' \t\r\n".indexOf(ch) < 0; };
  var xpTokens = function (src) {
    var toks = [], i = 0, ch;
    var operand = function () {
      var t = toks[toks.length - 1];
      return !!t && !(t.t === "op" || (t.t === "p" && "([,@".indexOf(t.v) >= 0) || (t.t === "p" && (t.v === "/" || t.v === "//" || t.v === "::")));
    };
    while (i < src.length) {
      ch = src.charAt(i);
      if (" \t\r\n".indexOf(ch) >= 0) { i++; continue; }
      if (ch === "\"" || ch === "'") {
        var j = src.indexOf(ch, i + 1);
        if (j < 0) throw new SyntaxError("XPath: unterminated string");
        toks.push({ t: "s", v: src.slice(i + 1, j) }); i = j + 1; continue;
      }
      if ((ch >= "0" && ch <= "9") || (ch === "." && src.charAt(i + 1) >= "0" && src.charAt(i + 1) <= "9")) {
        var k = i; while ((src.charAt(k) >= "0" && src.charAt(k) <= "9") || src.charAt(k) === ".") k++;
        toks.push({ t: "n", v: Number(src.slice(i, k)) }); i = k; continue;
      }
      var two = src.substr(i, 2);
      if (two === "//" || two === "::" || two === "..") { toks.push({ t: "p", v: two }); i += 2; continue; }
      if (two === "!=" || two === "<=" || two === ">=") { toks.push({ t: "op", v: two }); i += 2; continue; }
      if ("=<>+-|".indexOf(ch) >= 0 && !(ch === "-" && false)) { toks.push({ t: "op", v: ch }); i++; continue; }
      if (ch === "*") { toks.push(operand() ? { t: "op", v: "*" } : { t: "name", v: "*" }); i++; continue; }
      if ("()[],@/.".indexOf(ch) >= 0) { toks.push({ t: "p", v: ch }); i++; continue; }
      if (xpIsName(ch)) {
        var m = i; while (m < src.length && (xpIsName(src.charAt(m)) || (src.charAt(m) === ":" && src.charAt(m + 1) !== ":" && src.charAt(m - 1) !== ":"))) m++;
        if (src.charAt(m) === ":" && src.charAt(m + 1) !== ":" && src.charAt(m + 1) === "*") m += 2;
        var word = src.slice(i, m);
        if (operand() && (word === "and" || word === "or" || word === "div" || word === "mod")) toks.push({ t: "op", v: word });
        else toks.push({ t: "name", v: word });
        i = m; continue;
      }
      throw new SyntaxError("XPath: unexpected " + ch);
    }
    return toks;
  };
  var xpCompile = function (src) {
    var toks = xpTokens(src), pos = 0;
    var peek = function () { return toks[pos]; };
    var isP = function (v) { var t = toks[pos]; return t && t.t === "p" && t.v === v; };
    var isOp = function (v) { var t = toks[pos]; return t && t.t === "op" && t.v === v; };
    var need = function (v) { if (!isP(v)) throw new SyntaxError("XPath: expected " + v); pos++; };
    var cmp = function (op, a, b) {
      var an = Array.isArray(a), bn = Array.isArray(b);
      var one = function (x, y) {
        if (op === "=" || op === "!=") {
          var r;
          if (typeof x === "boolean" || typeof y === "boolean") r = xpBool(x) === xpBool(y);
          else if (typeof x === "number" || typeof y === "number") r = xpNum(x) === xpNum(y);
          else r = xpStr(x) === xpStr(y);
          return op === "=" ? r : !r;
        }
        var p = xpNum(x), q = xpNum(y);
        return op === "<" ? p < q : op === ">" ? p > q : op === "<=" ? p <= q : p >= q;
      };
      if (an && bn) return a.some(function (x) { return b.some(function (y) { return one(xpNodeStr(x), xpNodeStr(y)); }); });
      if (an) return typeof b === "boolean" ? one(xpBool(a), b) : a.some(function (x) { return one(typeof b === "number" ? xpNum(xpNodeStr(x)) : xpNodeStr(x), b); });
      if (bn) return typeof a === "boolean" ? one(a, xpBool(b)) : b.some(function (y) { return one(a, typeof a === "number" ? xpNum(xpNodeStr(y)) : xpNodeStr(y)); });
      return one(a, b);
    };
    var fns = {
      last: function (c) { return c.size; },
      position: function (c) { return c.pos; },
      count: function (c, a) { return a[0].length; },
      "local-name": function (c, a) { var n = a.length ? a[0][0] : c.node; return n ? (n.localName || n.nodeName || "").toLowerCase() : ""; },
      name: function (c, a) { var n = a.length ? a[0][0] : c.node; return n ? (n.nodeName || "").toLowerCase() : ""; },
      "namespace-uri": function () { return ""; },
      string: function (c, a) { return a.length ? xpStr(a[0]) : xpNodeStr(c.node); },
      concat: function (c, a) { return a.map(xpStr).join(""); },
      "starts-with": function (c, a) { return xpStr(a[0]).indexOf(xpStr(a[1])) === 0; },
      contains: function (c, a) { return xpStr(a[0]).indexOf(xpStr(a[1])) >= 0; },
      "substring-before": function (c, a) { var s = xpStr(a[0]), i = s.indexOf(xpStr(a[1])); return i < 0 ? "" : s.slice(0, i); },
      "substring-after": function (c, a) { var s = xpStr(a[0]), t = xpStr(a[1]), i = s.indexOf(t); return i < 0 ? "" : s.slice(i + t.length); },
      substring: function (c, a) {
        var s = xpStr(a[0]), from = Math.round(xpNum(a[1])), to = a.length > 2 ? from + Math.round(xpNum(a[2])) : Infinity, out = "";
        for (var i = 0; i < s.length; i++) if (i + 1 >= from && i + 1 < to) out += s.charAt(i);
        return out;
      },
      "string-length": function (c, a) { return (a.length ? xpStr(a[0]) : xpNodeStr(c.node)).length; },
      "normalize-space": function (c, a) { return (a.length ? xpStr(a[0]) : xpNodeStr(c.node)).split(/\s+/).filter(Boolean).join(" "); },
      translate: function (c, a) {
        var s = xpStr(a[0]), from = xpStr(a[1]), to = xpStr(a[2]), out = "";
        for (var i = 0; i < s.length; i++) { var k = from.indexOf(s.charAt(i)); if (k < 0) out += s.charAt(i); else if (k < to.length) out += to.charAt(k); }
        return out;
      },
      not: function (c, a) { return !xpBool(a[0]); },
      "true": function () { return true; },
      "false": function () { return false; },
      boolean: function (c, a) { return xpBool(a[0]); },
      number: function (c, a) { return a.length ? xpNum(a[0]) : xpNum(xpNodeStr(c.node)); },
      sum: function (c, a) { return a[0].reduce(function (s, n) { return s + xpNum(xpNodeStr(n)); }, 0); },
      floor: function (c, a) { return Math.floor(xpNum(a[0])); },
      ceiling: function (c, a) { return Math.ceil(xpNum(a[0])); },
      round: function (c, a) { return Math.round(xpNum(a[0])); },
      lang: function () { return false; },
    };
    var pred = function (list, ps, reverse) {
      // the axes that run backwards are listed nearest first already, so a position is the index in the list
      ps.forEach(function (p) {
        var size = list.length;
        list = list.filter(function (n, i) {
          var v = p({ node: n, pos: i + 1, size: size });
          return typeof v === "number" ? v === i + 1 : xpBool(v);
        });
      });
      return list;
    };
    var step = function () {
      var axis = "child", test, ps = [];
      if (isP(".")) { pos++; return function (c) { return [c.node]; }; }
      if (isP("..")) { pos++; return function (c) { return xpAxis("parent", c.node); }; }
      if (isP("@")) { pos++; axis = "attribute"; }
      else if (peek() && peek().t === "name" && toks[pos + 1] && toks[pos + 1].t === "p" && toks[pos + 1].v === "::") { axis = peek().v; pos += 2; }
      var t = peek();
      if (!t || t.t !== "name") throw new SyntaxError("XPath: expected a name test");
      pos++;
      if (isP("(") && ["text", "node", "comment", "processing-instruction"].indexOf(t.v) >= 0) {
        pos++; if (peek() && peek().t === "s") pos++; need(")");
        test = t.v === "node" ? function () { return true; } : t.v === "text" ? function (n) { return n.nodeType === 3 || n.nodeType === 4; } : t.v === "comment" ? function (n) { return n.nodeType === 8; } : function (n) { return n.nodeType === 7; };
      } else {
        var want = t.v, kind = axis === "attribute" ? 2 : 1;
        var local = want.indexOf(":") >= 0 ? want.slice(want.indexOf(":") + 1) : want;
        test = want === "*" ? function (n) { return n.nodeType === kind; } : function (n) {
          return n.nodeType === kind && (n.localName || n.nodeName).toLowerCase() === local.toLowerCase();
        };
      }
      while (isP("[")) { pos++; ps.push(orExpr()); need("]"); }
      return function (c) { return pred(xpAxis(axis, c.node).filter(test), ps, !!xpReverse[axis]); };
    };
    var relPath = function () {
      var steps = [step()];
      for (;;) {
        if (isP("/")) { pos++; steps.push(step()); }
        else if (isP("//")) { pos++; steps.push(function (c) { return xpAxis("descendant-or-self", c.node); }, step()); }
        else break;
      }
      return function (c) {
        var cur = [c.node];
        steps.forEach(function (s) {
          var next = [];
          cur.forEach(function (n) { s({ node: n, pos: 1, size: 1 }).forEach(function (r) { next.push(r); }); });
          cur = xpOrder(next);
        });
        return cur;
      };
    };
    var root = function (n) { while (n.parentNode) n = n.parentNode; return n; };
    var primary = function () {
      var t = peek();
      if (!t) throw new SyntaxError("XPath: unexpected end");
      if (t.t === "s" || t.t === "n") { pos++; return function () { return t.v; }; }
      if (isP("(")) { pos++; var e = orExpr(); need(")"); return e; }
      if (t.t === "name" && toks[pos + 1] && toks[pos + 1].t === "p" && toks[pos + 1].v === "(" && ["text", "node", "comment", "processing-instruction"].indexOf(t.v) < 0) {
        var f = fns[t.v];
        if (!f) throw new SyntaxError("XPath: unknown function " + t.v);
        pos += 2;
        var args = [];
        if (!isP(")")) { args.push(orExpr()); while (isP(",")) { pos++; args.push(orExpr()); } }
        need(")");
        return function (c) { return f(c, args.map(function (a) { return a(c); })); };
      }
      return null;
    };
    var pathExpr = function () {
      var p = primary();
      if (p) {
        var ps = [];
        while (isP("[")) { pos++; ps.push(orExpr()); need("]"); }
        var rest = null;
        if (isP("/") || isP("//")) { var dbl = isP("//"); pos++; var r = relPath(); rest = dbl ? function (c) { return relPath2(c, r, true); } : r; }
        return function (c) {
          var v = p(c);
          if (ps.length) v = pred(v, ps, false);
          if (!rest) return v;
          var out = [];
          v.forEach(function (n) { rest({ node: n, pos: 1, size: 1 }).forEach(function (m) { out.push(m); }); });
          return xpOrder(out);
        };
      }
      if (isP("/")) {
        pos++;
        var t = peek();
        if (!t || (t.t === "op") || (t.t === "p" && t.v !== "." && t.v !== ".." && t.v !== "@")) return function (c) { return [root(c.node)]; };
        var rp = relPath();
        return function (c) { return rp({ node: root(c.node), pos: 1, size: 1 }); };
      }
      if (isP("//")) {
        pos++;
        var rp2 = relPath();
        return function (c) {
          var out = [];
          xpAxis("descendant-or-self", root(c.node)).forEach(function (n) { rp2({ node: n, pos: 1, size: 1 }).forEach(function (m) { out.push(m); }); });
          return xpOrder(out);
        };
      }
      return relPath();
    };
    var relPath2 = function (c, r) {
      var out = [];
      xpAxis("descendant-or-self", c.node).forEach(function (n) { r({ node: n, pos: 1, size: 1 }).forEach(function (m) { out.push(m); }); });
      return xpOrder(out);
    };
    var unary = function () {
      if (isOp("-")) { pos++; var u = unary(); return function (c) { return -xpNum(u(c)); }; }
      var a = pathExpr();
      while (isOp("|")) {
        pos++;
        var b = pathExpr(), left = a;
        a = function (c) { return xpOrder(left(c).concat(b(c))); };
      }
      return a;
    };
    var binary = function (next, ops, apply) {
      return function () {
        var a = next();
        while (peek() && peek().t === "op" && ops.indexOf(peek().v) >= 0) {
          var op = peek().v; pos++;
          var b = next(), left = a;
          a = (function (l, r, o) { return function (c) { return apply(o, l(c), r(c)); }; })(left, b, op);
        }
        return a;
      };
    };
    var mul = binary(unary, ["*", "div", "mod"], function (o, a, b) { var x = xpNum(a), y = xpNum(b); return o === "*" ? x * y : o === "div" ? x / y : x % y; });
    var add = binary(mul, ["+", "-"], function (o, a, b) { return o === "+" ? xpNum(a) + xpNum(b) : xpNum(a) - xpNum(b); });
    var rel = binary(add, ["<", ">", "<=", ">="], cmp);
    var eq = binary(rel, ["=", "!="], cmp);
    var andExpr = function () {
      var a = eq();
      while (isOp("and")) { pos++; var b = eq(), l = a; a = (function (x, y) { return function (c) { return xpBool(x(c)) && xpBool(y(c)); }; })(l, b); }
      return a;
    };
    var orExpr = function () {
      var a = andExpr();
      while (isOp("or")) { pos++; var b = andExpr(), l = a; a = (function (x, y) { return function (c) { return xpBool(x(c)) || xpBool(y(c)); }; })(l, b); }
      return a;
    };
    var fn = orExpr();
    if (pos < toks.length) throw new SyntaxError("XPath: unexpected " + toks[pos].v);
    return fn;
  };
  var xpResult = function (value, type) {
    var r = Object.create(XPathResult.prototype), nodes = Array.isArray(value) ? value : null, i = 0;
    if (!type) type = nodes ? 4 : typeof value === "number" ? 1 : typeof value === "string" ? 2 : 3;
    if (type === 1 && nodes) value = xpNum(value); else if (type === 2) value = xpStr(value); else if (type === 3) value = xpBool(value);
    if (type > 3 && !nodes) throw new TypeError("XPath: the expression does not give nodes");
    r.resultType = type; r.invalidIteratorState = false;
    if (type === 1) r.numberValue = value; else if (type === 2) r.stringValue = value; else if (type === 3) r.booleanValue = value;
    else {
      r.singleNodeValue = nodes[0] || null; r.snapshotLength = nodes.length;
      r.snapshotItem = function (k) { return nodes[k] || null; };
      r.iterateNext = function () { return i < nodes.length ? nodes[i++] : null; };
    }
    return r;
  };
  var xpEvaluate = function (src, ctx, type) {
    var fn = xpCompile(String(src));
    return xpResult(fn({ node: ctx, pos: 1, size: 1 }), type | 0);
  };
  def(P.Document, "evaluate", function (src, ctx, resolver, type) { return xpEvaluate(src, ctx || this, type); });
  def(P.Document, "createExpression", function (src) {
    var text = String(src);
    xpCompile(text);
    return { evaluate: function (ctx, type) { return xpEvaluate(text, ctx, type); } };
  });
  def(P.Document, "createNSResolver", function (n) { return { lookupNamespaceURI: function () { return null; } }; });
  var XPathEvaluator = function XPathEvaluator() {};
  def(XPathEvaluator.prototype, "evaluate", function (src, ctx, resolver, type) { return xpEvaluate(src, ctx, type); });
  def(XPathEvaluator.prototype, "createExpression", function (src) { return P.Document.createExpression.call(null, src); });
  def(XPathEvaluator.prototype, "createNSResolver", function (n) { return { lookupNamespaceURI: function () { return null; } }; });
  W.XPathEvaluator = XPathEvaluator;

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
    getter(P.HTMLImageElement, "naturalWidth", function () { return 0; });
    getter(P.HTMLImageElement, "naturalHeight", function () { return 0; });
    getter(P.HTMLImageElement, "complete", function () { return !this.getAttribute("src"); });
    getter(P.HTMLImageElement, "currentSrc", function () { return this.src || ""; });
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
    attrNumber(P.HTMLInputElement, "maxLength", "maxlength", -1, 0);
    attrNumber(P.HTMLInputElement, "minLength", "minlength", -1, 0);
    attrNumber(P.HTMLTextAreaElement, "maxLength", "maxlength", -1, 0);
    attrNumber(P.HTMLTextAreaElement, "minLength", "minlength", -1, 0);
    attrNumber(P.HTMLTextAreaElement, "rows", "rows", 2, 1);
    attrNumber(P.HTMLTextAreaElement, "cols", "cols", 20, 1);
    attrNumber(P.HTMLSelectElement, "size", "size", 0, 0);
    reflectString(P.HTMLTextAreaElement, "wrap", "wrap");
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
    var barred = function (el) { return el.hasAttribute("disabled") || el.hasAttribute("readonly") && el.localName !== "select" || (el.localName === "input" && /^(hidden|reset|button|image|submit)$/.test(el.type)) || el.localName === "button" && el.type !== "submit" || !!el.closest("datalist"); };
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
    ["HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLButtonElement", "HTMLFieldSetElement"].forEach(function (n) {
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
    getter(P.HTMLOptionElement, "label", function () { var l = this.getAttribute("label"); return l !== null ? l : this.text; }, function (v) { this.setAttribute("label", String(v)); });
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
    nullable(P.Element, "ariaLabel", "aria-label");
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
