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
  def(P.Element, "insertAdjacentHTML", function (where, html) { adjacent(this, where, D.parseFragment(String(html), this.ownerDocument)); });

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
  var toAttr = function (key) { return "data-" + String(key).replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); }); };
  var toKey = function (attr) { return attr.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); };
  var DS = Symbol("dataset");
  getter(P.Element, "dataset", function () {
    if (this[DS]) return this[DS];
    var el = this;
    return (this[DS] = new Proxy({}, {
      get: function (_, key) { if (typeof key !== "string") return undefined; var v = el.getAttribute(toAttr(key)); return v === null ? undefined : v; },
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
    for (var i = 0; i < list.length; i++) if (list[i].fn === fn && list[i].capture === capture) return;
    var entry = { fn: fn, capture: capture, once: !!opts.once, passive: !!opts.passive, removed: false };
    list.push(entry);
    var node = this;
    if (opts.signal) opts.signal.addEventListener("abort", function () { removeListener.call(node, type, fn, { capture: capture }); });
  };
  var removeListener = function (type, fn, opts) {
    var all = LISTENERS.get(this), list = all && all[type], capture = !!listenerOptions(opts).capture;
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      if (list[i].fn === fn && list[i].capture === capture) {
        list[i].removed = true;
        list.splice(i, 1);
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
    Promise.resolve().then(function () {
      o._scheduled = false;
      var recs = o._records.splice(0);
      if (recs.length) o._callback.call(o, recs, o);
    });
  };
  var record = function (type, target, extra) {
    var base = { type: type, target: target, addedNodes: [], removedNodes: [], previousSibling: null, nextSibling: null, attributeName: null, attributeNamespace: null, oldValue: null };
    interested(target, function (o, opt) {
      if (type === "childList" && !opt.childList) return;
      if (type === "attributes" && (!opt.attributes || (opt.attributeFilter && opt.attributeFilter.indexOf(extra.attributeName) < 0))) return;
      if (type === "characterData" && !opt.characterData) return;
      var rec = Object.assign({}, base, extra);
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
  var defs = new Map(), byClass = new Map(), waiting = new Map(), UPGRADED = Symbol("upgraded"), pending = null, ceOn = false;
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
        if (defs.size && defOf(el)) upgrade(el);
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
      el = globalThis.document.createElement(d_.extend || d_.name);
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
  var liveCollection = function (compute) {
    var cache = null, ver = -1;
    var arr = function () {
      var v = D.version();
      if (v !== ver || !cache) { cache = compute(); ver = v; }
      return cache;
    };
    return new Proxy({}, {
      get: function (_, k) {
        if (k === "item") return function (i) { return arr()[i] || null; };
        if (k === "namedItem") return function (name) {
          var a = arr();
          for (var i = 0; i < a.length; i++) if (a[i].getAttribute && (a[i].getAttribute("id") === name || a[i].getAttribute("name") === name)) return a[i];
          return null;
        };
        var a2 = arr(), v2 = a2[k];
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
  // SVG is told by the namespace, not by tag, so these answer instanceof by it
  ["SVGElement", "SVGSVGElement", "SVGGraphicsElement"].forEach(function (name) {
    var C = { [name]: function () { illegal(); } }[name];
    C.prototype = Object.create(P.Element, { constructor: { value: C, writable: true, configurable: true } });
    Object.setPrototypeOf(C, D.ctors.Element);
    Object.defineProperty(C, Symbol.hasInstance, {
      value: function (x) {
        if (!x || x.nodeType !== 1 || x.namespaceURI !== "http://www.w3.org/2000/svg") return false;
        return name === "SVGSVGElement" ? x.localName === "svg" : true;
      },
    });
    D.ctors[name] = C;
  });

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
        return this[key] || Object.defineProperty(this, key, { value: liveCollection(function () { return get.call(self); }) })[key];
      },
      configurable: true,
    });
  };
  [P.Element, P.Document, P.DocumentFragment].forEach(function (p) { liveGetter(p, "children"); });
  liveGetter(P.Node, "childNodes");
  var liveMethod = function (proto, name) {
    var d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== "function") return;
    var orig = d.value;
    Object.defineProperty(proto, name, {
      value: function (arg) {
        var self = this;
        return liveCollection(function () { return orig.call(self, arg); });
      },
      writable: true, configurable: true,
    });
  };
  [P.Element, P.Document, P.DocumentFragment].forEach(function (p) { liveMethod(p, "getElementsByTagName"); liveMethod(p, "getElementsByClassName"); });

  // ---- the rest of a window's classes: events, EventTarget, DOMParser, ShadowRoot, ... (D.window: what boot.js installs)
  var W = (D.window = {});
  Object.keys(D.ctors).forEach(function (k) { W[k] = D.ctors[k]; });
  W.MutationObserver = MutationObserver;
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
  def(DOMParser.prototype, "parseFromString", function (markup) { return D.parse(String(markup)); });
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
    }) })[ATTRS];
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
  W.NodeFilter = { FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, SHOW_ALL: 0xFFFFFFFF, SHOW_ELEMENT: 1, SHOW_ATTRIBUTE: 2, SHOW_TEXT: 4, SHOW_CDATA_SECTION: 8, SHOW_COMMENT: 128, SHOW_DOCUMENT: 256 };
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

  var ShadowRoot = function ShadowRoot() { illegal(); };
  Object.setPrototypeOf(ShadowRoot, D.ctors.DocumentFragment);
  ShadowRoot.prototype = Object.create(P.DocumentFragment, { constructor: { value: ShadowRoot, writable: true, configurable: true } });
  Object.defineProperty(ShadowRoot, Symbol.hasInstance, { value: function (x) { return !!x && x.nodeType === 11 && !!x.host; } });
  W.ShadowRoot = ShadowRoot;
  // a shadow root has an innerHTML like an element's
  if (!Object.getOwnPropertyDescriptor(P.DocumentFragment, "innerHTML")) {
    getter(P.DocumentFragment, "innerHTML", function () { return D.serialize(this); }, function (html) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.appendChild(D.parseFragment(String(html), this.ownerDocument));
    });
  }
})();
