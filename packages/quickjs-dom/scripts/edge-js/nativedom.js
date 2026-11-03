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
})();
