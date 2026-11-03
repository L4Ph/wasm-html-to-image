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
})();
