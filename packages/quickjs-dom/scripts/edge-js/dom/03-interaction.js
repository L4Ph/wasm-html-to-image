  // ---- what user interaction needs: focus, the activation behaviour of a click, the selection of a text control, labels,
  // Range and Selection. (Ranges are live: their boundary points move as the tree changes under them.)
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
    return new E(type, { bubbles: bubbles, cancelable: false, composed: true, relatedTarget: related || null });
  };
  var activeOf = function (doc) { return focused && focused.isConnected && focused.ownerDocument === doc ? focused : doc.body; };
  getter(P.Document, "activeElement", function () { return activeOf(this); });
  var FOCUSED_DOCS = new WeakSet();
  def(P.HTMLElement, "focus", function () {
    if (!focusable(this) || focused === this) return;
    var prev = focused && focused.isConnected ? focused : null;
    focused = this;
    if (this.ownerDocument) FOCUSED_DOCS.add(this.ownerDocument); // a document that has been focused stays focused (jsdom's answer after blur, too)
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
  ["HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLButtonElement", "HTMLOutputElement"].forEach(function (name) {
    var LABELS = Symbol("labels");
    getter(P[name], "labels", function () {
      var el = this;
      // a hidden input is not labelable, and its labels are null, not an empty list (the spec,
      // jsdom, and the libraries that branch on it)
      if (name === "HTMLInputElement" && el.type === "hidden") return null;
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
    if (tag === "input") return !el.hasAttribute("disabled") && (type === "checkbox" || type === "radio" || type === "submit" || type === "image" || type === "reset");
    if (tag === "button") return !el.hasAttribute("disabled");
    if (tag === "label") return true;
    if (tag === "summary") return !!el.parentNode && el.parentNode.localName === "details";
    return false;
  };
  var radiosOf = function (el) {
    var name = el.getAttribute("name");
    if (!name) return [el];
    var form = el.form, scope = form || el.getRootNode();
    var radios = form ? form.elements : scope.querySelectorAll("input[type=radio]");
    return Array.prototype.filter.call(radios, function (r) { return r.localName === "input" && r.type === "radio" && r.getAttribute("name") === name && r.form === form; });
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
    } else if ((tag === "input" && (type === "submit" || type === "image" || type === "reset")) || tag === "button") {
      var kind = tag === "button" ? (type || "submit") : type, form = el.form;
      if (form && (kind === "submit" || kind === "image")) form.requestSubmit(el);
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
    // the spec (and jsdom, and comparePoint above): different roots are an error, not a number
    if (rootOf(this._sc) !== rootOf(source._sc)) throw domError("WrongDocumentError", "The source range is in another tree.");
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
    var s = this._sc, e = this._ec, range = this;
    if (s === e && (s.nodeType === 3 || s.nodeType === 8)) {
      var one = s.cloneNode(false); one.data = s.data.slice(this._so, this._eo); frag.appendChild(one); return frag;
    }
    // the spec's clone: a node the range cuts into is cloned shallowly and filled with the part
    // that lies inside, so partial ancestors appear in the fragment (the old code took only the
    // wholly-contained nodes and the two cut texts, and lost every wrapper around them)
    var cloneInto = function (container, out) {
      for (var c = container.firstChild; c; c = c.nextSibling) {
        var p = c.parentNode, i = indexOf(c);
        if (comparePoints(p, i + 1, range._sc, range._so) <= 0) continue; // ends at or before the start
        if (comparePoints(p, i, range._ec, range._eo) >= 0) continue; // begins at or after the end
        var whole = comparePoints(p, i, range._sc, range._so) >= 0 && comparePoints(p, i + 1, range._ec, range._eo) <= 0;
        if (whole) { out.appendChild(c.cloneNode(true)); continue; }
        if (c.nodeType === 3 || c.nodeType === 8) {
          var t = c.cloneNode(false);
          t.data = c.data.slice(c === range._sc ? range._so : 0, c === range._ec ? range._eo : c.data.length);
          out.appendChild(t);
          continue;
        }
        var shallow = c.cloneNode(false);
        cloneInto(c, shallow);
        out.appendChild(shallow);
      }
    };
    cloneInto(this.commonAncestorContainer, frag);
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
  // AbstractRange: the layer above Range (its boundary members stay on Range.prototype, where
  // they were built; this adds the name and the instanceof). StaticRange is a real constructor
  // over an init dictionary, immutable in practice because nothing writes its fields afterwards.
  var AbstractRange = function AbstractRange() { illegal(); };
  Object.setPrototypeOf(Range.prototype, AbstractRange.prototype);
  Object.setPrototypeOf(Range, AbstractRange);
  W.AbstractRange = AbstractRange;
  var StaticRange = function StaticRange(init) {
    init = init || {};
    var miss = ["startContainer", "startOffset", "endContainer", "endOffset"].filter(function (k) { return !(k in init); });
    if (miss.length) throw new TypeError("Failed to construct 'StaticRange': " + miss.map(function (k) { return "property " + k; }).join(", ") + " missing.");
    this._sc = init.startContainer; this._so = init.startOffset >>> 0;
    this._ec = init.endContainer; this._eo = init.endOffset >>> 0;
  };
  Object.setPrototypeOf(StaticRange.prototype, AbstractRange.prototype);
  Object.setPrototypeOf(StaticRange, AbstractRange);
  [["startContainer", "_sc"], ["startOffset", "_so"], ["endContainer", "_ec"], ["endOffset", "_eo"]].forEach(function (p) {
    getter(StaticRange.prototype, p[0], function () { return this[p[1]]; });
  });
  getter(StaticRange.prototype, "collapsed", function () { return this._sc === this._ec && this._so === this._eo; });
  W.StaticRange = StaticRange;
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
