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
  // an on<type> handler is a listener of its own (jsdom's model, and the one pages observe):
  // it takes a slot in the list the first time it is set — by the IDL property or by being
  // read from a content attribute — and keeps that slot when set to null and back, the null
  // simply leaving the slot inert. ensureHandlerEntry claims the slot.
  var ensureHandlerEntry = function (node, type) {
    var all = LISTENERS.get(node);
    if (!all) LISTENERS.set(node, (all = {}));
    var list = all[type] || (all[type] = []);
    for (var i = 0; i < list.length; i++) if (list[i].handler) return;
    list.push({ handler: true, capture: false, once: false, passive: false, removed: false });
  };
  var invoke = function (node, ev, phase, seenTarget) {
    // an attribute handler claims its slot the first time a dispatch reaches its node
    if (phase !== 1 && node.nodeType === 1 && node.hasAttribute && node.hasAttribute("on" + ev.type)) ensureHandlerEntry(node, ev.type);
    var all = LISTENERS.get(node), list = all && all[ev.type];
    ev.currentTarget = node;
    ev.eventPhase = phase;
    if (seenTarget) { ev.target = seenTarget; ev.srcElement = seenTarget; }
    var sawHandler = false;
    if (list) {
      list = list.slice();
      // (at the target the list runs in registration order: jsdom runs capture listeners first
      // there, which departs from the spec and from this package's own event test — adjudicated
      // in the parity ledger, Phase 2 — so it is deliberately not copied)
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (entry.removed) continue;
        if (phase === 1 && !entry.capture) continue;
        if (phase === 3 && entry.capture) continue;
        if (entry.handler) {
          sawHandler = true;
          var h = node["on" + ev.type];
          if (typeof h === "function") {
            try { h.call(node, ev); } catch (e) { if (globalThis.console) globalThis.console.error(e); }
          }
        } else {
          if (entry.once) removeListener.call(node, ev.type, entry.fn, { capture: entry.capture });
          try {
            if (typeof entry.fn === "function") entry.fn.call(node, ev);
            else if (entry.fn && typeof entry.fn.handleEvent === "function") entry.fn.handleEvent(ev);
          } catch (e) {
            // an exception in a listener is reported and does not stop the others
            if (typeof globalThis.reportError === "function") globalThis.reportError(e);
            else if (globalThis.console) globalThis.console.error(e);
          }
        }
        if (ev._stopImmediatePropagationFlag) return;
      }
    }
    // a handler assigned as a plain property on an object that has no on* accessor (the
    // EventTarget subclasses of the shims — WebSocket, ports) still fires, after the list
    if (!sawHandler && phase !== 1) {
      var own = Object.getOwnPropertyDescriptor(node, "on" + ev.type);
      if (own && typeof own.value === "function") {
        try { own.value.call(node, ev); } catch (e) { if (globalThis.console) globalThis.console.error(e); }
      }
    }
  };
  var parentOf = function (n) {
    if (n.parentNode) return n.parentNode;
    if (n.nodeType === 9) return n.defaultView && n.defaultView !== n ? n.defaultView : null;
    return null;
  };
  var dispatch = function (ev) {
    if (!ev || typeof ev.type !== "string") throw new TypeError("The event provided is not an Event.");
    // the propagation path crosses a shadow boundary only for a composed event (parentOf steps
    // from a shadow root to its host); the last node inside the tree is where it stops otherwise
    var path = [], n = this;
    for (; n; n = parentOf(n)) {
      path.push(n);
      if (n.nodeType === 11 && n.host && !ev.composed) break;
    }
    // what a listener sees as the target: the first node of its own tree's stretch of the path —
    // a listener outside a shadow tree sees the host, not the node inside (the document's stretch
    // runs on up to the window, which sees the same target as the document does)
    var seen = [], seg = 0;
    for (i = 0; i < path.length; i++) {
      if (i > 0 && path[i - 1].nodeType === 11 && path[i - 1].host) seg = i;
      seen.push(path[seg]);
    }
    ev.target = ev.srcElement = this;
    ev._path = path.map(function (x, i) { return { currentTarget: x, target: seen[i] }; });
    ev.cancelBubble = false;
    ev._stopImmediatePropagationFlag = false;
    var i;
    for (i = path.length - 1; i > 0 && !ev.cancelBubble; i--) invoke(path[i], ev, 1, seen[i]);
    if (!ev.cancelBubble) invoke(this, ev, 2, this);
    // the bubble pass: a node the event is retargeted onto (the host of a tree the event came
    // out of) hears it even when the event does not bubble — in its own tree the host IS the
    // target — while ordinary ancestors of a non-bubbling event hear nothing
    for (i = 1; i < path.length && !ev.cancelBubble; i++) {
      if (ev.bubbles || seen[i] === path[i]) invoke(path[i], ev, 3, seen[i]);
    }
    ev.target = ev.srcElement = this;
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
  ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop", "clientWidth", "clientHeight", "scrollWidth", "scrollHeight"].forEach(function (k) {
    getter(P.Element, k, function () { return 0; });
  });

  // Scroll offsets are state, even without layout: pages write them (scrollToElementById reads
  // container.scrollTop, CategoryChipNav adds to scrollLeft) and read back what they wrote.
  // Browsers clamp to the scrollable range; with no layout there is no range, so only negatives
  // clamp to zero. No scroll event is fired (the page never sees a paint).
  var SCROLL = Symbol("scroll");
  var scrollOf = function (el) {
    var s = el[SCROLL];
    if (!s) Object.defineProperty(el, SCROLL, { value: { top: 0, left: 0 }, configurable: true });
    return el[SCROLL];
  };
  var scrollNumber = function (v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  };
  var setScroll = function (el, axis, v) { scrollOf(el)[axis] = scrollNumber(v); };
  ["scrollTop", "scrollLeft"].forEach(function (k) {
    var axis = k === "scrollTop" ? "top" : "left";
    getter(P.Element, k, function () { return scrollOf(this)[axis]; }, function (v) { setScroll(this, axis, v); });
  });
  var scrollDeltas = function (x, y) {
    if (x && typeof x === "object") return { left: x.left, top: x.top };
    return { left: x, top: y };
  };
  // scrollTo/scroll: set (both axes, or only the ones given), scrollBy: add. A dict without
  // left/top leaves that axis alone, as the CSSOM View spec says.
  var scrollTo = function (el, x, y) {
    var d = scrollDeltas(x, y);
    if (d.left !== undefined) setScroll(el, "left", d.left);
    if (d.top !== undefined) setScroll(el, "top", d.top);
  };
  def(P.Element, "scrollTo", function (x, y) { scrollTo(this, x, y); });
  def(P.Element, "scroll", function (x, y) { scrollTo(this, x, y); });
  def(P.Element, "scrollBy", function (x, y) {
    var d = scrollDeltas(x, y), s = scrollOf(this);
    if (d.left !== undefined) s.left = Math.max(0, s.left + (isFinite(Number(d.left)) ? Number(d.left) : 0));
    if (d.top !== undefined) s.top = Math.max(0, s.top + (isFinite(Number(d.top)) ? Number(d.top) : 0));
  });
  // scrolling into view, animation and the like: there is no viewport, so these do nothing (and do not throw)
  ["scrollIntoView", "scrollIntoViewIfNeeded", "setPointerCapture", "releasePointerCapture", "requestFullscreen", "requestPointerLock"].forEach(function (k) {
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
  var StyleDecl = function CSSStyleDeclaration(el) { Object.defineProperty(this, "_el", { value: el }); };
  // the one CSSStyleDeclaration for both el.style (here) and getComputedStyle (computed.js picks
  // it up from here). It stays off the bridge's window table, like DOMStringMap: a style object is
  // all named properties, and the bridge's class wrappers would keep host-side sets local.
  D.CSSStyleDeclarationCtor = StyleDecl;
  Object.defineProperty(StyleDecl.prototype, "parentRule", { value: null, writable: true, configurable: true });
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
  ["hidden", "disabled", "required", "readOnly:readonly", "multiple", "autofocus", "open", "async", "defer"].forEach(function (spec) {
    var parts = spec.split(":");
    if (!Object.getOwnPropertyDescriptor(P.HTMLElement, parts[0])) reflectBool(P.HTMLElement, parts[0], parts[1]);
  });
  // value: a control's value is state of its own, seeded by its default (the value attribute for
  // an input, the text for a textarea) and parting from it once set — the dirty flag the spec
  // keeps. Before, value and the attribute were one thing, so form.reset() had nothing to
  // restore and a late attribute write moved a value the page had already typed over.
  var VAL = Symbol("value");
  // an output's defaultValue override: set by a value write, cleared by form.reset (jsdom's model)
  var OUTDEF = Symbol("outputDefault");
  var leapYear = function (y) { return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0); };
  var validDateString = function (s) {
    var m = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
    var days = [31, leapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
    return d <= days;
  };
  var validMonthString = function (s) {
    var m = /^(\d{4,})-(\d{2})$/.exec(s);
    return !!m && +m[1] >= 1 && +m[2] >= 1 && +m[2] <= 12;
  };
  var validWeekString = function (s) {
    var m = /^(\d{4,})-W(\d{2})$/.exec(s);
    return !!m && +m[1] >= 1 && +m[2] >= 1 && +m[2] <= 53;
  };
  var validTimeString = function (s) {
    var m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(s);
    return !!m && +m[1] <= 23 && +m[2] <= 59 && (m[3] === undefined || +m[3] <= 59);
  };
  var normalizeLocalDateAndTimeString = function (s) {
    var m = /^(\d{4,}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/.exec(s);
    return m && validDateString(m[1]) && validTimeString(m[2]) ? m[1] + "T" + m[2] : "";
  };
  var sanitizeValue = function (el, v) {
    var type = el.localName === "input" ? el.type : "";
    if (type === "number") return /^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(v) ? v : "";
    if (type === "range") {
      // the spec's range sanitisation: an unparsable value becomes the default (midpoint, or
      // the minimum in a reversed range), then the value is clamped to [min, max]
      var min = parseFloat(el.getAttribute("min")), max = parseFloat(el.getAttribute("max"));
      if (!isFinite(min)) min = 0;
      if (!isFinite(max)) max = 100;
      var n = /^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(v) ? parseFloat(v) : NaN;
      // a reversed range (max < min) has its default at min, and clamping to it must not pick max:
      // Math.min(max, Math.max(min, n)) would always answer max there
      if (max < min) return String(min);
      if (!isFinite(n)) n = (min + max) / 2;
      return String(Math.min(max, Math.max(min, n)));
    }
    if (type === "date") return validDateString(v) ? v : "";
    if (type === "month") return validMonthString(v) ? v : "";
    if (type === "week") return validWeekString(v) ? v : "";
    if (type === "time") return validTimeString(v) ? v : "";
    if (type === "datetime-local") return normalizeLocalDateAndTimeString(v);
    if (/^(text|search|tel|url|email|password)$/.test(type)) return v.replace(/[\r\n]/g, "");
    return v;
  };
  var valueDesc = Object.getOwnPropertyDescriptor(P.HTMLElement, "value");
  if (!valueDesc) {
    getter(P.HTMLElement, "value", function () {
      var tag = this.localName;
      if (tag === "textarea") return this[VAL] !== undefined ? this[VAL] : this.textContent;
      if (tag === "select") {
        var opts = this.querySelectorAll("option");
        for (var i = 0; i < opts.length; i++) if (opts[i].selected) return opts[i].value;
        return "";
      }
      if (tag === "option") { var v = this.getAttribute("value"); return v === null ? this.textContent : v; }
      if (this[VAL] !== undefined) return this[VAL];
      var a = this.getAttribute("value");
      return tag === "input" ? sanitizeValue(this, a === null ? "" : a) : a === null ? "" : a;
    }, function (v) {
      var tag = this.localName;
      if (tag === "textarea") this[VAL] = String(v);
      else if (tag === "select") {
        var opts = this.querySelectorAll("option");
        for (var i = 0; i < opts.length; i++) opts[i].selected = opts[i].value === String(v);
      } else if (tag === "input") this[VAL] = sanitizeValue(this, String(v));
      else this.setAttribute("value", String(v));
    });
  }
  getter(P.HTMLElement, "defaultValue", function () {
    if (this.localName === "textarea") return this.textContent;
    var a = this.getAttribute("value");
    return a === null ? "" : a;
  }, function (v) {
    if (this.localName === "textarea") this.textContent = String(v);
    else this.setAttribute("value", String(v));
  });
  // checkedness is state too, seeded by the checked attribute; checking a radio unchecks its group
  var CHK = Symbol("checked");
  var uncheckRadioGroup = function (el) {
    var group = radiosOf(el);
    for (var i = 0; i < group.length; i++) if (group[i] !== el) group[i][CHK] = false;
  };
  // the form owner (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-owner):
  // a form-associated element with a form attribute belongs to the form whose id that is, in its own
  // tree — and to no form at all when there is none (no fallback to an ancestor); without the attribute
  // it belongs to its nearest form ancestor.
  // Backward compatibility: an element outside the category (a div, say) answers its nearest ancestor form,
  // as it did before the form-owner rules; the owner rules only bind the form-associated elements above.
  // The over-exposure is deliberate: pages and libraries (and earlier versions of this engine) read
  // `.form` off any element, so tightening the getter to the form-associated category would break them.
  // Kept as is; the spec's answer is available through formOwnerOf for the elements that do belong.
  var FORM_ASSOCIATED = { button: true, input: true, select: true, textarea: true, fieldset: true, object: true, output: true };
  var firstElementWithId = function (root, id) {
    if (!root) return null;
    if (typeof root.getElementById === "function") return root.getElementById(id);
    var found = root.querySelectorAll("[id]");
    for (var i = 0; i < found.length; i++) if (found[i].getAttribute("id") === id) return found[i];
    return null;
  };
  var formOwnerOf = function (el) {
    if (!FORM_ASSOCIATED[el.localName]) return el.closest("form");
    var id = el.getAttribute("form");
    if (id === null) return el.closest("form");
    if (id === "") return null;
    var form = firstElementWithId(el.getRootNode ? el.getRootNode() : el.ownerDocument, id);
    return form && form.localName === "form" ? form : null;
  };
  getter(P.HTMLElement, "form", function () { return formOwnerOf(this); });
  getter(P.HTMLElement, "isContentEditable", function () { return this.getAttribute("contenteditable") !== null && this.getAttribute("contenteditable") !== "false"; });

  // Shadow DOM: a shadow root is a fragment hanging off the host (it is not a child, and not serialised).
  // The snapshot therefore silently loses everything inside it, so say so in the page log.
  // TODO: emit the tree as declarative shadow DOM (<template shadowrootmode="open">...), which is
  // the (a) path: walk SHADOW roots while serialising and inline the root's children. Until then,
  // this warning is the contract; keep it even if serialisation starts including shadow roots.
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
    if (globalThis.console && globalThis.console.warn) {
      globalThis.console.warn(
        "attachShadow: a shadow tree is not serialised, so its content is missing from the snapshot (" +
          (this.localName || "element") + ")"
      );
    }
    return root;
  });
  getter(P.Element, "shadowRoot", function () { var r = this[SHADOW]; return r && r.mode === "open" ? r : null; });
  // ElementInternals: what a custom element reports about itself. The shadow root is the real
  // one (a closed root is visible here, as it should be); the form side is inert — these elements
  // are not form-associated in this engine, so validity is a standing all-valid state and the
  // setters have nothing to set.
  var ElementInternals = function ElementInternals() { illegal(); };
  D.ctors.ElementInternals = ElementInternals;
  var INTERNALS = new WeakMap();
  def(P.HTMLElement, "attachInternals", function () {
    // only a custom element has internals (the spec's condition), and only once
    if (!defs.has(this.localName)) { var e0 = new Error("Failed to execute 'attachInternals' on 'HTMLElement': The target element is not a custom element."); e0.name = "NotSupportedError"; throw e0; }
    if (INTERNALS.has(this)) { var e = new Error("Failed to execute 'attachInternals' on 'HTMLElement': This element has already been attached to an internals object."); e.name = "NotSupportedError"; throw e; }
    var el = this;
    var internals = Object.create(ElementInternals.prototype);
    var validity = Object.create(W.ValidityState.prototype);
    ["valueMissing", "typeMismatch", "patternMismatch", "tooLong", "tooShort", "rangeUnderflow", "rangeOverflow", "stepMismatch", "badInput", "customError"].forEach(function (k) {
      Object.defineProperty(validity, k, { value: false, enumerable: true });
    });
    Object.defineProperty(validity, "valid", { value: true, enumerable: true });
    Object.defineProperties(internals, {
      shadowRoot: { get: function () { return el[SHADOW] || null; }, enumerable: true },
      form: { value: null, enumerable: true },
      labels: { value: null, enumerable: true },
      willValidate: { value: false, enumerable: true },
      validationMessage: { value: "", enumerable: true },
      validity: { value: validity, enumerable: true },
      checkValidity: { value: function () { return true; } },
      reportValidity: { value: function () { return true; } },
      setValidity: { value: function () {} },
      setFormValue: { value: function () {} },
    });
    INTERNALS.set(this, internals);
    return internals;
  });
  // events leave a shadow tree through its host
  var plainParent = parentOf;
  parentOf = function (n) { return n.parentNode || (n.nodeType === 11 && n.host) || plainParent(n); };
  // and a node of a shadow tree is connected when its host is: the native walk stops at the
  // root, which for a shadow tree is the fragment, so the last step goes through the host
  var nativeConnected = Object.getOwnPropertyDescriptor(P.Node, "isConnected");
  if (nativeConnected && nativeConnected.get) {
    var nativeGet = nativeConnected.get;
    getter(P.Node, "isConnected", function () {
      if (nativeGet.call(this)) return true;
      var r = this.getRootNode ? this.getRootNode() : null;
      return !!(r && r.nodeType === 11 && r.host && r.host.isConnected);
    });
  }

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
        // HTMLOptionsCollection.remove(index): its own method, which the array the proxy reads
        // through does not have. index is a required WebIDL long: called with no argument it throws
        // a TypeError (as browsers do), and an explicit undefined converts to 0, so it removes the
        // first option; an index outside the collection removes nothing.
        if (k === "remove" && kind === "HTMLOptionsCollection") return function (index) {
          if (arguments.length === 0) throw new TypeError("Failed to execute 'remove' on 'HTMLOptionsCollection': 1 argument required, but only 0 present.");
          index = +index;
          if (index !== index) index = 0; // ToNumber(undefined) is NaN, and WebIDL's long conversion of NaN is 0
          index = index < 0 ? Math.ceil(index) : Math.floor(index);
          var a = arr();
          if (a[index]) a[index].remove();
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
  // querySelectorAll answers a static NodeList. The C side already gives a snapshot (a plain array); this is the thin
  // wrapper collection() uses on the host: the interface's prototype (so instanceof NodeList holds), length and
  // indices, item(), and the iteration methods. It re-reads nothing: a live collection would be wrong for qSA.
  var staticNodeList = function (nodes) {
    // 02-classes.js installs NodeList after this file; a call before then (there is none today) keeps the array
    if (!W.NodeList) return nodes;
    var proto = W.NodeList.prototype;
    var index = /^(?:0|[1-9][0-9]*)$/;
    return new Proxy(Object.create(proto), {
      get: function (t, k, r) {
        if (typeof k === "string") {
          if (k === "length") return nodes.length;
          if (index.test(k)) return nodes[Number(k)];
          if (k === "item") return function (i) { return i >= 0 && i < nodes.length ? nodes[i] : null; };
          if (k === "forEach" || k === "entries" || k === "keys" || k === "values") return Array.prototype[k].bind(nodes);
        } else if (k === Symbol.iterator) {
          return function () { return nodes[Symbol.iterator](); };
        } else if (k === Symbol.toStringTag) {
          return "NodeList";
        }
        return Reflect.get(t, k, r);
      },
      // length is not on NodeList.prototype, and chai's `toHaveLength` asks `"length" in list`
      has: function (t, k) { return k === "length" ? true : typeof k === "string" && index.test(k) ? Number(k) < nodes.length : Reflect.has(t, k); },
      ownKeys: function () {
        var keys = [];
        for (var i = 0; i < nodes.length; i++) keys.push(String(i));
        return keys;
      },
      getOwnPropertyDescriptor: function (t, k) {
        if (typeof k === "string" && index.test(k) && Number(k) < nodes.length) return { value: nodes[Number(k)], enumerable: true, configurable: true, writable: false };
        return undefined;
      },
    });
  };
  var staticQuery = function (proto) {
    var d = Object.getOwnPropertyDescriptor(proto, "querySelectorAll");
    if (!d || typeof d.value !== "function") return;
    var orig = d.value;
    Object.defineProperty(proto, "querySelectorAll", {
      value: function (selector) { return staticNodeList(orig.call(this, selector)); },
      writable: true, configurable: true,
    });
  };
  [P.Element, P.Document, P.DocumentFragment].forEach(staticQuery);
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
    ["HTMLObjectElement", "object"], ["HTMLOutputElement", "output"], ["HTMLDataListElement", "datalist"],
    ["HTMLTableCaptionElement", "caption"], ["HTMLTableColElement", "col", "colgroup"], ["HTMLTableSectionElement", "thead", "tbody", "tfoot"],
    ["HTMLDirectoryElement", "dir"], ["HTMLFrameElement", "frame"], ["HTMLFrameSetElement", "frameset"], ["HTMLMarqueeElement", "marquee"],
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
  getter(P.HTMLInputElement, "checked", function () {
    return this[CHK] !== undefined ? this[CHK] : this.hasAttribute("checked");
  }, function (v) {
    this[CHK] = !!v;
    if (v && this.type === "radio") uncheckRadioGroup(this);
  });
  getter(P.HTMLInputElement, "defaultChecked", function () { return this.hasAttribute("checked"); }, function (v) {
    if (v) this.setAttribute("checked", ""); else this.removeAttribute("checked");
  });
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

  // an option's selectedness is state of its own, seeded by the selected attribute (its
  // defaultSelected): before, the two were one attribute, so a select could not hold a
  // deselected state (selectedIndex = -1 read back 0) and reset had no defaults to return to.
  // An untouched single select shows its first option, as browsers and jsdom do.
  var SEL = Symbol("selectedness");
  var optionSelected = function (o) {
    if (o[SEL] !== undefined) return o[SEL];
    if (o.hasAttribute("selected")) return true;
    var select = o.closest("select");
    if (!select || select.hasAttribute("multiple")) return false;
    var opts = select.querySelectorAll("option");
    if (opts[0] !== o) return false;
    for (var i = 0; i < opts.length; i++) if (opts[i][SEL] || opts[i].hasAttribute("selected")) return false;
    return true;
  };
  getter(P.HTMLOptionElement, "selected", function () { return optionSelected(this); }, function (v) {
    this[SEL] = !!v;
    if (v) {
      var select = this.closest("select");
      if (select && !select.hasAttribute("multiple")) {
        var all = select.querySelectorAll("option");
        for (var i = 0; i < all.length; i++) if (all[i] !== this) all[i][SEL] = false;
      }
    }
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
  var defHandlers = function (target, events) {
    events.forEach(function (type) {
      var name = "on" + type;
      if (Object.getOwnPropertyDescriptor(target, name)) return;
      getter(target, name, function () {
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
        if (typeof v === "function") ensureHandlerEntry(this, type);
      });
    });
  };
  [P.HTMLElement, P.Document].forEach(function (proto) { defHandlers(proto, HANDLER_EVENTS); });
  // the window has its own handler list on top of the shared one (print, unload, message, storage, ...)
  defHandlers(globalThis, HANDLER_EVENTS.concat(("afterprint beforematch beforeprint beforetoggle beforeunload contextlost contextrestored cuechange hashchange " +
    "languagechange message messageerror offline online pagehide pageshow pointerrawupdate popstate rejectionhandled storage unhandledrejection unload " +
    "webkitanimationend webkitanimationiteration webkitanimationstart webkittransitionend").split(" ")));

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
    // listed elements whose form owner is this form, including the ones outside it that name it
    // with form="id", in tree order
    var form = this;
    return liveCollection(function () {
      var root = form.getRootNode ? form.getRootNode() : form.ownerDocument;
      var all = root.querySelectorAll(CONTROLS);
      return Array.prototype.filter.call(all, function (el) { return el.form === form; });
    }, true, "HTMLFormControlsCollection", formNamedItem);
  });
  getter(P.HTMLFormElement, "length", function () { return this.elements.length; });
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
    for (var i = 0; i < opts.length; i++) if (optionSelected(opts[i])) return i;
    return -1;
  }, function (v) {
    var opts = this.querySelectorAll("option");
    for (var i = 0; i < opts.length; i++) opts[i][SEL] = i === Number(v);
  });
  getter(P.HTMLSelectElement, "selectedOptions", function () {
    var select = this;
    return liveCollection(function () {
      return Array.prototype.filter.call(select.querySelectorAll("option"), function (o) { return optionSelected(o); });
    });
  });
  getter(P.HTMLOptionElement, "index", function () {
    var select = this.closest("select");
    return select ? Array.prototype.indexOf.call(select.querySelectorAll("option"), this) : 0;
  });
  def(P.HTMLFormElement, "reset", function () {
    // the event goes first and can cancel the reset; the reset itself returns every control to
    // its defaults by clearing the state that parted from them (value, checkedness, selectedness)
    if (!this.dispatchEvent(new W.Event("reset", { bubbles: true, cancelable: true }))) return;
    // by form owner, not by containment: controls outside the form that name it with form="id" reset too
    var controls = this.elements;
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i];
      if (c.localName === "input" || c.localName === "textarea") { c[VAL] = undefined; if (c.localName === "input") c[CHK] = undefined; }
      else if (c.localName === "select") {
        var opts = c.querySelectorAll("option");
        for (var j = 0; j < opts.length; j++) opts[j][SEL] = undefined;
      }
      else if (c.localName === "output") {
        // an output's value is its text; reset restores the default text and forgets the
        // override a value write left behind (jsdom's model)
        c.textContent = c.defaultValue;
        c[OUTDEF] = undefined;
      }
    }
  });
  // a submit button is the only thing requestSubmit accepts as the submitter
  var isSubmitButton = function (el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.localName === "button") return el.type === "submit";
    if (el.localName === "input") return el.type === "submit" || el.type === "image";
    return false;
  };
  def(P.HTMLFormElement, "requestSubmit", function (submitter) {
    // as jsdom (and the spec): reject a submitter that is not a submit button, or that belongs to
    // another form, then fire a SubmitEvent carrying it (null when none was given)
    submitter = submitter === undefined ? null : submitter;
    if (submitter !== null) {
      if (!isSubmitButton(submitter)) {
        throw new TypeError("Failed to execute 'requestSubmit' on 'HTMLFormElement': The specified element is not a submit button.");
      }
      if (formOwnerOf(submitter) !== this) {
        throw new DOMException("Failed to execute 'requestSubmit' on 'HTMLFormElement': The specified element is not owned by this form element.", "NotFoundError");
      }
    }
    this.dispatchEvent(new W.SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: submitter }));
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
  svgClass("SVGSwitchElement", "SVGGraphicsElement", ["switch"]);
  // <title> stays an HTML tag for the tag mapping (see above), so SVGTitleElement is recognised
  // by namespace and name instead, the way SVGSVGElement is
  svgClass("SVGTitleElement", "SVGElement");
  Object.defineProperty(D.ctors.SVGTitleElement, Symbol.hasInstance, {
    value: function (x) { return !!x && x.nodeType === 1 && x.namespaceURI === SVG_URI && x.localName === "title"; },
  });
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
    // the SVG value interfaces: the animated pairs below wear them where a value actually arises.
    // They are stashed for boot.js to install as globals, NOT registered as ctors: an animated
    // value is all named properties (baseVal/animVal), and the bridge's class wrappers would keep
    // host-side writes (className.baseVal = ...) local instead of forwarding them — the
    // DOMStringMap lesson.
    var svgValue = function (name) { var C = { [name]: function () { illegal(); } }[name]; (D.svgValueCtors || (D.svgValueCtors = {}))[name] = C; return C; };
    var SVGAnimatedString = svgValue("SVGAnimatedString");
    var SVGAnimatedRect = svgValue("SVGAnimatedRect");
    var SVGRect = svgValue("SVGRect");
    svgValue("SVGNumber");
    svgValue("SVGStringList");
    var SVGPreserveAspectRatio = svgValue("SVGPreserveAspectRatio");
    [["SVG_PRESERVEASPECTRATIO_UNKNOWN", 0], ["SVG_PRESERVEASPECTRATIO_NONE", 1], ["SVG_PRESERVEASPECTRATIO_XMINYMIN", 2], ["SVG_PRESERVEASPECTRATIO_XMIDYMIN", 3], ["SVG_PRESERVEASPECTRATIO_XMAXYMIN", 4], ["SVG_PRESERVEASPECTRATIO_XMINYMID", 5], ["SVG_PRESERVEASPECTRATIO_XMIDYMID", 6], ["SVG_PRESERVEASPECTRATIO_XMAXYMID", 7], ["SVG_PRESERVEASPECTRATIO_XMINYMAX", 8], ["SVG_PRESERVEASPECTRATIO_XMIDYMAX", 9], ["SVG_PRESERVEASPECTRATIO_XMAXYMAX", 10], ["SVG_MEETORSLICE_UNKNOWN", 0], ["SVG_MEETORSLICE_MEET", 1], ["SVG_MEETORSLICE_SLICE", 2]].forEach(function (p) {
      SVGPreserveAspectRatio[p[0]] = p[1];
      Object.defineProperty(SVGPreserveAspectRatio.prototype, p[0], { value: p[1] });
    });
    svgValue("SVGAnimatedPreserveAspectRatio");
    var animated = function (read, write, proto) {
      var o = {};
      if (proto) Object.setPrototypeOf(o, proto);
      Object.defineProperty(o, "baseVal", { get: read, set: write, enumerable: true });
      Object.defineProperty(o, "animVal", { get: read, enumerable: true });
      return o;
    };
    getter(SE, "className", function () {
      var el = this;
      return animated(function () { return el.getAttribute("class") || ""; }, function (v) { el.setAttribute("class", String(v)); }, SVGAnimatedString.prototype);
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
        var r = p.length === 4 && p.every(isFinite) ? { x: p[0], y: p[1], width: p[2], height: p[3] } : { x: 0, y: 0, width: 0, height: 0 };
        return Object.setPrototypeOf(r, SVGRect.prototype);
      };
      return animated(read, undefined, SVGAnimatedRect.prototype);
    });
    getter(SE, "href", function () {
      var el = this;
      return animated(function () { var v = el.getAttribute("href"); return v !== null ? v : el.getAttribute("xlink:href") || ""; }, function (v) { el.setAttribute("href", String(v)); }, SVGAnimatedString.prototype);
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
      if (t === "image" || t === "foreignObject" || t === "use") return box(attrNum(this, "x"), attrNum(this, "y"), attrNum(this, "width"), attrNum(this, "height"));
      return box(attrNum(this, "x"), attrNum(this, "y"), 0, 0); // text: no layout
    });
  })();

  // Namespaces, as far as pages need them: an element is SVG or MathML by the root it sits in (or was made with
  // createElementNS), and the *NS attribute methods work on qualified names.
  var NS = { html: "http://www.w3.org/1999/xhtml", svg: "http://www.w3.org/2000/svg", math: "http://www.w3.org/1998/Math/MathML" };
  var NSKEY = Symbol("ns");
  getter(P.Element, "namespaceURI", function () {
    if (this[NSKEY]) return this[NSKEY];
    // the element itself is foreign when it is (or sits in) an svg/math root; an integration
    // point (foreignObject, an annotation-xml serving HTML, an svg desc/title) makes its
    // CHILDREN HTML, not itself — so those are only met walking up from the parent
    var t = this.localName;
    if (t === "svg") return NS.svg;
    if (t === "math") return NS.math;
    for (var n = this.parentNode; n && n.nodeType === 1; n = n.parentNode) {
      var lt = n.localName;
      if (lt === "svg") return NS.svg;
      if (lt === "math") return NS.math;
      if (lt === "foreignObject" || lt === "desc" || lt === "title") return NS.html;
      if (lt === "annotation-xml" && n.getAttribute("encoding") === "text/html") return NS.html;
    }
    return NS.html;
  });
  // tagName (and with it nodeName) is upper-cased for an HTML element in an HTML document only;
  // a foreign element keeps its adjusted name (foreignObject), an XML document's its own case.
  // The native getter upper-cases everything, so the two are answered here.
  var elementName = function (el) {
    var ln = el.localName;
    var d = el.ownerDocument;
    if (el.namespaceURI === NS.html && d && !(typeof XMLDocument !== "undefined" && d instanceof XMLDocument)) return ln.toUpperCase();
    return ln;
  };
  getter(P.Element, "tagName", function () { return elementName(this); });
  getter(P.Element, "nodeName", function () { return elementName(this); });
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