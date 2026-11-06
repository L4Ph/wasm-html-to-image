
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
  };
  [["NONE", 0], ["CAPTURING_PHASE", 1], ["AT_TARGET", 2], ["BUBBLING_PHASE", 3]].forEach(function (c) {
    Object.defineProperty(Event, c[0], { value: c[1] });
    Object.defineProperty(Event.prototype, c[0], { value: c[1] });
  });
  def(Event.prototype, "preventDefault", function () { if (this.cancelable) this.defaultPrevented = true; });
  def(Event.prototype, "stopPropagation", function () { this.cancelBubble = true; });
  // stopImmediatePropagation is rare: the flag is made (non-enumerable) when it is used, so no event pays for it
  def(Event.prototype, "stopImmediatePropagation", function () { this.cancelBubble = true; Object.defineProperty(this, "_stopImmediatePropagationFlag", { value: true, configurable: true }); });
  // the propagation path of the running dispatch, kept out of the event's own properties (see dispatch)
  var eventPaths = new WeakMap();
  def(Event.prototype, "composedPath", function () { var p = eventPaths.get(this); return p ? p.slice() : []; });
  def(Event.prototype, "initEvent", function (type, bubbles, cancelable) { this.type = String(type); this.bubbles = !!bubbles; this.cancelable = !!cancelable; });
  getter(Event.prototype, "returnValue", function () { return !this.defaultPrevented; }, function (v) { if (!v) this.preventDefault(); });
  W.Event = Event;

  // subclasses: the init dictionary's members become properties (with the defaults a browser gives them)
  var subclass = function (name, parent, defaults) {
    var members = Object.keys(defaults);
    var C = { [name]: function (type, init) {
      parent.call(this, type, init);
      init = init || {};
      for (var i = 0; i < members.length; i++) { var k = members[i]; this[k] = k in init ? init[k] : defaults[k]; }
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
  subclass("BeforeUnloadEvent", Event, {});
  subclass("BlobEvent", Event, { data: null, timecode: 0 });
  subclass("CloseEvent", Event, { wasClean: false, code: 0, reason: "" });
  subclass("PromiseRejectionEvent", Event, { promise: null, reason: undefined });
  subclass("DeviceOrientationEvent", Event, { alpha: null, beta: null, gamma: null, absolute: false });
  subclass("DeviceMotionEvent", Event, { acceleration: null, accelerationIncludingGravity: null, rotationRate: null, interval: 0 });
  // the motion component interfaces: never constructed, their values ride on a DeviceMotionEvent
  [["DeviceMotionEventAcceleration", ["x", "y", "z"]], ["DeviceMotionEventRotationRate", ["alpha", "beta", "gamma"]]].forEach(function (pair) {
    var C = { [pair[0]]: function () { illegal(); } }[pair[0]];
    pair[1].forEach(function (k) { getter(C.prototype, k, function () { return null; }); });
    W[pair[0]] = C;
  });

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
  // the tags each of the plain interfaces owns (a slot must be an HTMLSlotElement, not a generic one)
  var PLAIN_TAGS = {
    HTMLOptGroupElement: ["optgroup"], HTMLSlotElement: ["slot"], HTMLBaseElement: ["base"], HTMLDListElement: ["dl"],
    HTMLEmbedElement: ["embed"], HTMLMapElement: ["map"], HTMLParamElement: ["param"], HTMLPictureElement: ["picture"],
    HTMLProgressElement: ["progress"], HTMLQuoteElement: ["blockquote", "q"], HTMLTimeElement: ["time"], HTMLTrackElement: ["track"],
    HTMLMeterElement: ["meter"], HTMLLegendElement: ["legend"], HTMLDataElement: ["data"], HTMLModElement: ["ins", "del"],
    HTMLAreaElement: ["area"], HTMLFontElement: ["font"], HTMLMenuElement: ["menu"],
  };
  ["HTMLUnknownElement", "HTMLMediaElement", "HTMLOptGroupElement", "HTMLSlotElement", "HTMLBaseElement", "HTMLDListElement",
   "HTMLEmbedElement", "HTMLMapElement", "HTMLObjectElement", "HTMLOutputElement", "HTMLParamElement", "HTMLPictureElement",
   "HTMLProgressElement", "HTMLQuoteElement", "HTMLTimeElement", "HTMLTrackElement", "HTMLMeterElement", "HTMLLegendElement",
   "HTMLDataElement", "HTMLDataListElement", "HTMLModElement", "HTMLAreaElement", "HTMLFontElement", "HTMLMenuElement"].forEach(function (name) {
    if (W[name]) return;
    var C = { [name]: function () { illegal(); } }[name];
    C.prototype = Object.create(P.HTMLElement, { constructor: { value: C, writable: true, configurable: true } });
    Object.setPrototypeOf(C, D.ctors.HTMLElement);
    W[name] = C;
    // these interfaces are also constructors of the native layer's schema: register the proto and
    // class so instanceof and the bridge see the same objects the window exposes
    D.ctors[name] = C;
    P[name] = C.prototype;
    (PLAIN_TAGS[name] || []).forEach(function (tag) { D.setTagProto(tag, C.prototype); });
  });

  // ---- unknown elements, dialog, slot distribution -------------------------------------------
  // The C layer gives every tag without an interface the plain HTMLElement prototype. The
  // HTMLUnknownElement distinction is therefore made after creation (the parser, createElement,
  // cloneNode and importNode all pass through the two helpers below): a tag the HTML spec does not
  // define, and that is not a valid custom-element name, answers HTMLUnknownElement as in browsers.
  // Declarative shadow DOM stays out of scope (a <template shadowrootmode> is a plain template).
  var XHTML_NS = "http://www.w3.org/1999/xhtml";
  var KNOWN_HTML_TAGS = Object.create(null);
  ("a abbr acronym address applet area article aside audio b base basefont bdi bdo big blockquote body br button canvas caption " +
   "center cite code col colgroup data datalist dd del details dfn dialog dir div dl dt em embed fieldset figcaption figure font " +
   "footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe image img input ins isindex kbd keygen label " +
   "legend li link listing main map mark marquee menu menuitem meta meter nav nobr noembed noframes noscript object ol optgroup " +
   "option output p param picture plaintext pre progress q rb rp rt rtc ruby s samp script search section select slot small source " +
   "spacer span strike strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track tt u ul " +
   "var video wbr xmp").split(" ").forEach(function (n) { KNOWN_HTML_TAGS[n] = true; });
  var isUnknownElement = function (el) {
    return el && el.nodeType === 1 && el.namespaceURI === XHTML_NS &&
      !KNOWN_HTML_TAGS[el.localName] && el.localName.indexOf("-") < 0 &&
      Object.getPrototypeOf(el) === P.HTMLElement;
  };
  var fixUnknown = function (root) {
    if (!root) return;
    if (root.nodeType === 1 && isUnknownElement(root)) Object.setPrototypeOf(root, P.HTMLUnknownElement);
    // createElement makes a childless element: there is nothing below it to classify, and asking for
    // its descendants would be a scan per created node (the host-driven build's shape)
    if (!root.firstChild || !root.getElementsByTagName) return;
    var all = root.getElementsByTagName("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i], name = el.localName;
      if (KNOWN_HTML_TAGS[name] || name.indexOf("-") >= 0) continue;
      if (isUnknownElement(el)) Object.setPrototypeOf(el, P.HTMLUnknownElement);
    }
  };
  var rawCreateElement = P.Document.createElement;
  def(P.Document, "createElement", function () {
    var el = rawCreateElement.apply(this, arguments);
    fixUnknown(el);
    return el;
  });
  var rawCreateElementNS = P.Document.createElementNS;
  def(P.Document, "createElementNS", function (ns, name) {
    var el = rawCreateElementNS.apply(this, arguments);
    if (!ns || ns === XHTML_NS) fixUnknown(el);
    // createElementNS runs the plain factory first, so a foreign unknown tag would have been
    // classified as HTML: it is a generic Element in SVG/MathML.
    else if (Object.getPrototypeOf(el) === P.HTMLUnknownElement) Object.setPrototypeOf(el, P.Element);
    return el;
  });
  var rawCloneNode = P.Node.cloneNode;
  def(P.Node, "cloneNode", function () {
    var node = rawCloneNode.apply(this, arguments);
    fixUnknown(node);
    return node;
  });
  var rawImportNode = P.Document.importNode;
  def(P.Document, "importNode", function () {
    var node = rawImportNode.apply(this, arguments);
    fixUnknown(node);
    return node;
  });
  // the element innerHTML setter is native (01-core.js only wraps its raw-text branch), so its
  // parsed children need the same pass
  var rawInnerHTML = Object.getOwnPropertyDescriptor(P.Element, "innerHTML");
  if (rawInnerHTML && rawInnerHTML.set) {
    getter(P.Element, "innerHTML", rawInnerHTML.get, function (v) {
      rawInnerHTML.set.call(this, v);
      fixUnknown(this);
    });
  }

  // Slot distribution: the assignment is computed from the flat tree as it is now (it is not
  // cached), so appending a child, changing its slot attribute or adding a slot is visible at once.
  var MANUAL_SLOT = new WeakMap();
  var isSlottable = function (n) { return !!n && (n.nodeType === 1 || n.nodeType === 3); };
  var slotNameOf = function (slot) { return slot.getAttribute ? (slot.getAttribute("name") || "") : ""; };
  var slotsIn = function (root) { return root && root.querySelectorAll ? root.querySelectorAll("slot") : []; };
  var assignedSlotOf = function (node) {
    if (!isSlottable(node)) return null;
    var host = node.parentNode;
    if (!host || host.nodeType !== 1) return null;
    var root = host[SHADOW];
    if (!root || root.mode !== "open") return null;
    var slots = slotsIn(root), i, list;
    // an explicit HTMLSlotElement.assign() wins over the slot name
    for (i = 0; i < slots.length; i++) {
      list = MANUAL_SLOT.get(slots[i]);
      if (list && list.indexOf(node) >= 0) return slots[i];
    }
    var wanted = node.nodeType === 1 ? (node.getAttribute("slot") || "") : "";
    for (i = 0; i < slots.length; i++) if (slotNameOf(slots[i]) === wanted) return slots[i];
    return null;
  };
  var assignedNodesOf = function (slot, flatten) {
    var out = [], manual = MANUAL_SLOT.get(slot), n;
    if (manual) out = manual.slice();
    else {
      var root = slot.getRootNode ? slot.getRootNode() : null;
      var host = root && root.host;
      if (host) for (n = host.firstChild; n; n = n.nextSibling) if (isSlottable(n) && assignedSlotOf(n) === slot) out.push(n);
    }
    if (flatten && out.length === 0) {
      for (n = slot.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 1 && n.localName === "slot") out = out.concat(assignedNodesOf(n, true));
        else out.push(n);
      }
    }
    return out;
  };
  reflectString(P.HTMLSlotElement, "name", "name");
  def(P.HTMLSlotElement, "assignedNodes", function (options) { return assignedNodesOf(this, !!(options && options.flatten)); });
  def(P.HTMLSlotElement, "assignedElements", function (options) {
    return assignedNodesOf(this, !!(options && options.flatten)).filter(function (n) { return n.nodeType === 1; });
  });
  def(P.HTMLSlotElement, "assign", function () {
    var nodes = Array.prototype.slice.call(arguments);
    for (var i = 0; i < nodes.length; i++) {
      if (!isSlottable(nodes[i])) throw domError("HierarchyRequestError", "The node provided is not a slottable node.");
    }
    MANUAL_SLOT.set(this, nodes);
    try { this.dispatchEvent(new Event("slotchange")); } catch (e) {}
  });

  // HTMLDialogElement: the open/returnValue state and the show/showModal/close family. The close
  // event is dispatched synchronously, as the spec's close() does.
  var DIALOG_RETURN = new WeakMap();
  var dialogReturn = function (el) { return DIALOG_RETURN.get(el) || ""; };
  reflectBool(P.HTMLDialogElement, "open", "open");
  getter(P.HTMLDialogElement, "returnValue", function () { return dialogReturn(this); }, function (v) { DIALOG_RETURN.set(this, String(v)); });
  getter(P.HTMLDialogElement, "closedBy", function () {
    var v = (this.getAttribute("closedby") || "").toLowerCase();
    return v === "closerequest" || v === "any" || v === "none" ? v : "none";
  }, function (v) { this.setAttribute("closedby", String(v)); });
  def(P.HTMLDialogElement, "show", function () { if (!this.hasAttribute("open")) this.setAttribute("open", ""); });
  def(P.HTMLDialogElement, "showModal", function () {
    if (this.hasAttribute("open")) throw domError("InvalidStateError", "Failed to execute 'showModal' on 'HTMLDialogElement': The dialog is already open.");
    this.setAttribute("open", "");
    this.__modal = true;
  });
  def(P.HTMLDialogElement, "close", function (value) {
    if (!this.hasAttribute("open")) return;
    if (value !== undefined) DIALOG_RETURN.set(this, String(value));
    this.removeAttribute("open");
    this.__modal = false;
    this.dispatchEvent(new Event("close"));
  });
  def(P.HTMLDialogElement, "requestClose", function (value) {
    if (!this.hasAttribute("open")) return;
    if (value !== undefined) DIALOG_RETURN.set(this, String(value));
    this.removeAttribute("open");
    this.__modal = false;
    this.dispatchEvent(new Event("close"));
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
  var NodeIterator = function NodeIterator() { illegal(); };
  W.NodeIterator = NodeIterator;
  var TreeWalker = function TreeWalker() { illegal(); };
  W.TreeWalker = TreeWalker;
  def(P.Document, "createNodeIterator", function (root, what, filter) {
    what = what === undefined ? 0xFFFFFFFF : what >>> 0;
    var cur = null;
    return Object.setPrototypeOf({
      root: root, whatToShow: what, filter: filter || null,
      get referenceNode() { return cur || root; },
      pointerBeforeReferenceNode: false,
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
    }, NodeIterator.prototype);
  });
  def(P.Document, "createTreeWalker", function (root, what, filter) {
    what = what === undefined ? 0xFFFFFFFF : what >>> 0;
    var w = Object.setPrototypeOf({ root: root, whatToShow: what, filter: filter || null, currentNode: root }, TreeWalker.prototype);
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
    fixUnknown(doc);
    return doc;
  };
  // innerHTML, insertAdjacentHTML and the other fragment parses use this path too
  var rawParseFragment = D.parseFragment;
  D.parseFragment = function (markup, doc) {
    var frag = rawParseFragment(markup, doc);
    fixUnknown(frag);
    return frag;
  };
  var DOMParser = function DOMParser() {};
  // A small strict XML parser for DOMParser's XML types. The HTML parser cannot serve them (it
  // would wrap the content in html/head/body): well-formed input becomes a real tree of the XML
  // document, anything else the parsererror document browsers and jsdom answer. CDATA sections
  // become text (there is no CDATA node kind here, so they serialise escaped — a recorded
  // remainder), processing instructions are skipped, and namespaces are not resolved: names
  // keep their qualified spelling.
  var parseXMLDocument = function (markup, type) {
    var doc = D.createXMLDocument();
    Object.setPrototypeOf(doc, XMLDocument.prototype);
    Object.defineProperty(doc, "contentType", { value: type, configurable: true });
    var fail = function (msg) {
      // the error document replaces the parse entirely (a partial tree may already hang off doc)
      var fresh = D.createXMLDocument();
      Object.setPrototypeOf(fresh, XMLDocument.prototype);
      Object.defineProperty(fresh, "contentType", { value: type, configurable: true });
      var err = fresh.createElement("parsererror");
      err.setAttribute("xmlns", "http://www.mozilla.org/newlayout/xml/parsererror.xml");
      err.textContent = "XML Parsing Error: " + msg;
      fresh.appendChild(err);
      return fresh;
    };
    var s = String(markup), i = 0, n = s.length;
    var stack = [doc], names = [null], rootSeen = false;
    var ENT = { lt: "<", gt: ">", amp: "&", apos: "'", quot: "\"" };
    var expand = function (text) {
      if (/&(?!(#x[0-9a-fA-F]+|#\d+|[A-Za-z_][\w.-]*);)/.test(text)) throw new Error("bare & in content");
      return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z_][\w.-]*);/g, function (m, body) {
        if (body.charAt(0) === "#") { var cp = body.charAt(1) === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10); return String.fromCodePoint(cp); }
        if (!(body in ENT)) throw new Error("undefined entity &" + body + ";");
        return ENT[body];
      });
    };
    var top = function () { return stack[stack.length - 1]; };
    var addText = function (text, raw) {
      if (!text) return;
      if (stack.length === 1) { if (/\S/.test(text)) throw new Error("text outside the root element"); return; }
      top().appendChild(doc.createTextNode(raw ? text : expand(text)));
    };
    try {
      while (i < n) {
        var lt = s.indexOf("<", i);
        if (lt < 0) { addText(s.slice(i)); i = n; break; }
        if (lt > i) addText(s.slice(i, lt));
        i = lt;
        if (s.startsWith("<!--", i)) {
          var e1 = s.indexOf("-->", i + 4);
          if (e1 < 0) throw new Error("unterminated comment");
          top().appendChild(doc.createComment(s.slice(i + 4, e1)));
          i = e1 + 3;
        } else if (s.startsWith("<![CDATA[", i)) {
          var e2 = s.indexOf("]]>", i + 9);
          if (e2 < 0) throw new Error("unterminated CDATA section");
          addText(s.slice(i + 9, e2), true);
          i = e2 + 3;
        } else if (s.startsWith("<?", i)) {
          var e3 = s.indexOf("?>", i + 2);
          if (e3 < 0) throw new Error("unterminated processing instruction");
          i = e3 + 2;
        } else if (s.startsWith("<!DOCTYPE", i)) {
          var j = i + 9, depth = 0;
          while (j < n && (s[j] !== ">" || depth > 0)) { if (s[j] === "[") depth++; else if (s[j] === "]") depth--; j++; }
          if (j >= n) throw new Error("unterminated doctype");
          var decl = s.slice(i + 9, j).trim();
          var dm = decl.match(/^([^\s[]+)(?:\s+(PUBLIC|SYSTEM)\s+"([^"]*)"(?:\s+"([^"]*)")?)?/);
          if (dm && stack.length === 1) {
            var dt = doc.implementation.createDocumentType(dm[1], dm[2] === "PUBLIC" ? dm[3] : "", dm[2] === "PUBLIC" ? (dm[4] || "") : (dm[2] === "SYSTEM" ? dm[3] : ""));
            doc.appendChild(dt);
          }
          i = j + 1;
        } else if (s.startsWith("</", i)) {
          var e4 = s.indexOf(">", i + 2);
          if (e4 < 0) throw new Error("unterminated end tag");
          var cname = s.slice(i + 2, e4).trim();
          if (stack.length === 1 || names[names.length - 1] !== cname) throw new Error("mismatched end tag </" + cname + ">");
          stack.pop(); names.pop();
          i = e4 + 1;
        } else if (s[i + 1] === "!") {
          throw new Error("unsupported markup declaration");
        } else {
          var m = /^<([A-Za-z_][\w.:-]*)/.exec(s.slice(i, i + 256));
          if (!m) throw new Error("malformed tag");
          var el = doc.createElement(m[1]);
          var j2 = i + m[0].length, seen = {}, selfClose = false;
          for (;;) {
            while (j2 < n && /\s/.test(s[j2])) j2++;
            if (s.startsWith("/>", j2)) { selfClose = true; j2 += 2; break; }
            if (s[j2] === ">") { j2++; break; }
            if (j2 >= n) throw new Error("unterminated start tag");
            var am = /^([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(s.slice(j2, j2 + 512));
            if (!am) throw new Error("malformed attribute in <" + m[1] + ">");
            if (seen[am[1]]) throw new Error("duplicate attribute " + am[1]);
            seen[am[1]] = 1;
            el.setAttribute(am[1], expand(am[3] !== undefined ? am[3] : am[4]));
            j2 += am[0].length;
          }
          if (stack.length === 1) { if (rootSeen) throw new Error("multiple root elements"); rootSeen = true; }
          top().appendChild(el);
          if (!selfClose) { stack.push(el); names.push(m[1]); }
          i = j2;
        }
      }
      if (stack.length !== 1) throw new Error("unclosed element <" + names[names.length - 1] + ">");
      if (!rootSeen) throw new Error("no root element");
    } catch (e) {
      return fail(e && e.message ? e.message : String(e));
    }
    return doc;
  };
  def(DOMParser.prototype, "parseFromString", function (markup, type) {
    if (type && type !== "text/html" && (/(^|\/)xml$/.test(type) || type === "image/svg+xml" || /\+xml$/.test(type))) return parseXMLDocument(markup, type);
    var doc = D.parse(String(markup));
    // HTMLDocument and XMLDocument are defined further down; at call time they exist, and the
    // result takes the class of the type it was parsed as (the parsing itself is the one parser)
    if (typeof HTMLDocument !== "undefined") {
      if (type === undefined || type === "text/html") Object.setPrototypeOf(doc, HTMLDocument.prototype);
      else if (/(^|\/)xml$/.test(type || "") || type === "image/svg+xml") Object.setPrototypeOf(doc, XMLDocument.prototype);
    }
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
      Object.defineProperty(list, "getNamedItemNS", { value: function (ns, n) { var at = el.getAttributeNode(n); if (at) return at; for (var i = 0; i < this.length; i++) if (this[i].localName === n) return this[i]; return null; } });
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
  // the same treatment for the other document class and the node classes no HTML document can
  // hold: their interfaces exist (and createCDATASection rightly refuses for HTML documents),
  // instances arrive only through createDocument and XML parsing paths
  var XMLDocument = function XMLDocument() { illegal(); };
  Object.setPrototypeOf(XMLDocument.prototype, P.Document);
  Object.setPrototypeOf(XMLDocument, D.ctors.Document);
  W.XMLDocument = XMLDocument;
  var CDATASection = function CDATASection() { illegal(); };
  Object.setPrototypeOf(CDATASection.prototype, P.Text);
  Object.setPrototypeOf(CDATASection, D.ctors.Text);
  W.CDATASection = CDATASection;
  var ProcessingInstruction = function ProcessingInstruction() { illegal(); };
  Object.setPrototypeOf(ProcessingInstruction.prototype, P.CharacterData);
  Object.setPrototypeOf(ProcessingInstruction, D.ctors.CharacterData);
  W.ProcessingInstruction = ProcessingInstruction;
  // the custom elements registry object gets its interface
  var CustomElementRegistry = function CustomElementRegistry() { illegal(); };
  W.CustomElementRegistry = CustomElementRegistry;
  Object.setPrototypeOf(registry, CustomElementRegistry.prototype);
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
    var doc = D.createXMLDocument();
    Object.setPrototypeOf(doc, XMLDocument.prototype);
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
  // ---- the Document members jsdom answers and this layer had not: identity, state, the legacy
  // collections, and the legacy write/open family. defaultView and cookie live here too, so that
  // documents beyond the page's own (DOMParser, createHTMLDocument) answer them as well; boot.js
  // still defines the page document's own defaultView/cookie, which shadow these.
  getter(P.Document, "defaultView", function () { return null; });
  getter(P.Document, "URL", function () { var v = this.defaultView; return v ? v.location.href : "about:blank"; });
  getter(P.Document, "documentURI", function () { return this.URL; });
  getter(P.Document, "contentType", function () { return "application/xml"; });
  getter(HTMLDocument.prototype, "contentType", function () { return "text/html"; });
  getter(P.Document, "compatMode", function () { return this.doctype ? "CSS1Compat" : "BackCompat"; });
  ["characterSet", "charset", "inputEncoding"].forEach(function (k) { getter(P.Document, k, function () { return "UTF-8"; }); });
  var LASTMOD = new WeakMap();
  getter(P.Document, "lastModified", function () {
    var s = LASTMOD.get(this);
    if (!s) {
      var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
      LASTMOD.set(this, (s = p(d.getMonth() + 1) + "/" + p(d.getDate()) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())));
    }
    return s;
  });
  getter(P.Document, "referrer", function () { return ""; });
  getter(P.Document, "readyState", function () { return "complete"; });
  // a document nobody renders is prerendering and unfocused; the page's own document is told
  // otherwise by the boot code, through D.setVisual (jsdom's pretendToBeVisual, plumbed down)
  var DOCVIS = Symbol("visual");
  D.setVisual = function (doc, visual) { doc[DOCVIS] = visual ? { hidden: false, state: "visible" } : { hidden: true, state: "prerender" }; };
  getter(P.Document, "hidden", function () { var v = this[DOCVIS]; return v ? v.hidden : true; });
  getter(P.Document, "visibilityState", function () { var v = this[DOCVIS]; return v ? v.state : "prerender"; });
  getter(P.Document, "currentScript", function () { return null; });
  def(P.Document, "hasFocus", function () { return FOCUSED_DOCS.has(this); });
  getter(P.Document, "dir", function () { var r = this.documentElement; return r ? r.getAttribute("dir") || "" : ""; }, function (v) { var r = this.documentElement; if (r) r.setAttribute("dir", String(v)); });
  var DOCJARS = new WeakMap();
  getter(P.Document, "cookie", function () {
    var jar = DOCJARS.get(this);
    return jar ? Array.from(jar.entries()).map(function (e) { return e[0] + "=" + e[1]; }).join("; ") : "";
  }, function (v) {
    var jar = DOCJARS.get(this);
    if (!jar) DOCJARS.set(this, (jar = new Map()));
    var parts = String(v).split(";"), kv = parts[0], i = kv.indexOf("=");
    var name = (i < 0 ? "" : kv.slice(0, i)).trim(), value = i < 0 ? kv.trim() : kv.slice(i + 1).trim();
    var expired = parts.slice(1).some(function (p) {
      var m = /^\s*(max-age|expires)\s*=\s*(.*)$/.exec(p);
      return m && (m[1].toLowerCase() === "max-age" ? parseInt(m[2], 10) <= 0 : Date.parse(m[2]) < Date.now());
    });
    if (expired) jar.delete(name); else if (name) jar.set(name, value);
  });
  var docCollection = function (doc, selector) {
    return liveCollection(function () { return Array.prototype.slice.call(doc.querySelectorAll(selector)); }, false, "HTMLCollection");
  };
  [["forms", "form"], ["images", "img"], ["scripts", "script"], ["embeds", "embed"], ["plugins", "embed"], ["applets", "applet"], ["anchors", "a[name]"], ["links", "a[href], area[href]"]].forEach(function (pair) {
    getter(P.Document, pair[0], function () { return docCollection(this, pair[1]); });
  });
  def(P.Document, "getElementsByName", function (n) { return this.querySelectorAll('[name="' + String(n).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]'); });
  def(P.Document, "captureEvents", function () {});
  def(P.Document, "releaseEvents", function () {});
  def(P.Document, "open", function () { while (this.firstChild) this.removeChild(this.firstChild); return this; });
  def(P.Document, "close", function () {});
  var docWrite = function (doc, markup) {
    var parsed = D.parse(markup);
    if (!doc.documentElement) {
      while (parsed.firstChild) doc.appendChild(parsed.firstChild);
    } else {
      var src = parsed.body, dst = doc.body || doc.documentElement;
      if (src) while (src.firstChild) dst.appendChild(src.firstChild);
    }
  };
  def(P.Document, "write", function () { docWrite(this, Array.prototype.map.call(arguments, String).join("")); });
  def(P.Document, "writeln", function () { docWrite(this, Array.prototype.map.call(arguments, String).join("") + "\n"); });
  def(P.Document, "clear", function () {});
  def(P.Document, "createAttributeNS", function (ns, qname) {
    qname = String(qname);
    var at = Object.create(Attr.prototype), i = qname.indexOf(":");
    Object.defineProperty(at, ATTR, { value: { owner: null, value: "" }, writable: true });
    Object.defineProperties(at, {
      name: { value: qname, enumerable: true },
      localName: { value: i < 0 ? qname : qname.slice(i + 1), enumerable: true },
      prefix: { value: i < 0 ? null : qname.slice(0, i), enumerable: true },
      namespaceURI: { value: ns ? String(ns) : null, enumerable: true },
    });
    return at;
  });
  def(P.Document, "createCDATASection", function () { var e = new Error("This operation is not supported for HTML documents."); e.name = "NotSupportedError"; throw e; });
  // createEvent: the legacy factory, over the window's own event classes
  def(P.Document, "createEvent", function (type) {
    var table = { Event: "Event", Events: "Event", HTMLEvents: "Event", UIEvent: "UIEvent", UIEvents: "UIEvent", MouseEvent: "MouseEvent", MouseEvents: "MouseEvent", KeyboardEvent: "KeyboardEvent", KeyboardEvents: "KeyboardEvent", FocusEvent: "FocusEvent", InputEvent: "InputEvent", CustomEvent: "CustomEvent", MessageEvent: "MessageEvent", ProgressEvent: "ProgressEvent", MutationEvents: "MutationEvent" };
    var C = W[table[type] || "Event"] || W.Event;
    return new C("");
  });
  // the Document's own extra handler properties (the window list's document half)
  defHandlers(P.Document, ["beforematch", "beforetoggle", "contextlost", "contextrestored", "cuechange", "pointerrawupdate", "readystatechange", "visibilitychange", "webkitanimationend", "webkitanimationiteration", "webkitanimationstart", "webkittransitionend"]);
  // ---- member gaps the surface walk shows on elements generally, and on the table/legacy
  // interfaces exposed alongside: the element handler extras, the NS attribute-node pair,
  // webkitMatchesSelector, translate, and the legacy elements' own reflections.
  defHandlers(P.HTMLElement, ["beforematch", "beforetoggle", "contextlost", "contextrestored", "cuechange", "pointerrawupdate", "webkitanimationend", "webkitanimationiteration", "webkitanimationstart", "webkittransitionend"]);
  // a frameset carries the window's handlers (the spec puts them on the frameset element)
  defHandlers(P.HTMLFrameSetElement, ["afterprint", "beforeprint", "beforeunload", "hashchange", "languagechange", "message", "messageerror", "offline", "online", "pagehide", "pageshow", "popstate", "rejectionhandled", "storage", "unhandledrejection", "unload", "beforematch", "beforetoggle", "contextlost", "contextrestored", "cuechange", "pointerrawupdate", "webkitanimationend", "webkitanimationiteration", "webkitanimationstart", "webkittransitionend"]);
  def(P.Element, "webkitMatchesSelector", function (s) { return this.matches(s); });
  def(P.Element, "getAttributeNodeNS", function (ns, local) {
    var list = this.attributes;
    for (var i = 0; i < list.length; i++) { var at = list[i]; if (at.localName === String(local) && (at.namespaceURI || null) === (ns || null)) return at; }
    return null;
  });
  def(P.Element, "setAttributeNodeNS", function (at) {
    var old = this.getAttributeNodeNS(at.namespaceURI, at.localName);
    this.setAttribute(at.name, at.value);
    return old;
  });
  reflectBool(P.HTMLElement, "translate", "translate");
  reflectString(P.HTMLTableCaptionElement, "align", "align");
  [["align", "align"], ["ch", "char"], ["chOff", "charoff"], ["vAlign", "valign"]].forEach(function (pair) {
    reflectString(P.HTMLTableSectionElement, pair[0], pair[1]);
    reflectString(P.HTMLTableColElement, pair[0], pair[1]);
  });
  reflectString(P.HTMLTableColElement, "width", "width");
  getter(P.HTMLTableColElement, "span", function () { var n = parseInt(this.getAttribute("span"), 10); return isNaN(n) || n < 1 ? 1 : n; }, function (v) { this.setAttribute("span", String(v)); });
  reflectBool(P.HTMLDirectoryElement, "compact", "compact");
  ["frameBorder", "longDesc", "marginHeight", "marginWidth", "scrolling"].forEach(function (k) { reflectString(P.HTMLFrameElement, k, k.toLowerCase()); });
  reflectBool(P.HTMLFrameElement, "noResize", "noresize");
  // Nested browsing contexts are not loaded, but a frame still owns a document: a separate,
  // blank HTML document (an iframe's srcdoc seeds it) that pages can write into with
  // doc.open()/write()/close(). This is what renderers such as modern-screenshot expect from
  // iframe.contentDocument; the page's own document is never touched. contentWindow is the small
  // window-like object carrying that document (document.defaultView points back at it).
  // opt-in: iframe "navigation" is off by default, so the blank-document behaviour above stays
  // exactly as it was. With the flag on, an iframe with a src but no srcdoc gives its frame window
  // the resolved URL (still no fetch and no scripts: the document remains the blank one).
  D.iframeEnabled = false;
  D.setIframeEnabled = function (on) { D.iframeEnabled = !!on; };
  var FRAME_DOC = Symbol("frameDocument"), FRAME_SRC = Symbol("frameSrcdoc"), FRAME_URL = Symbol("frameUrl"), FRAME_WIN = Symbol("frameWindow");
  var frameURL = function (el) {
    if (!D.iframeEnabled || el.localName !== "iframe" || el.getAttribute("srcdoc") !== null) return null;
    var src = el.getAttribute("src");
    if (!src) return null;
    try { return new URL(src, (el.ownerDocument && el.ownerDocument.baseURI) || (globalThis.location && globalThis.location.href) || "about:blank").href; }
    catch (e) { return src; }
  };
  var frameLocation = function (el) {
    var href = el[FRAME_URL] || frameURL(el) || "about:blank";
    try {
      var u = new URL(href);
      return { href: u.href, origin: u.origin, protocol: u.protocol, host: u.host, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash };
    } catch (e) {
      return { href: "about:blank", origin: "null", protocol: "about:", host: "", hostname: "", pathname: "blank", search: "", hash: "" };
    }
  };
  var frameDocumentOf = function (el) {
    var src = el.localName === "iframe" ? el.getAttribute("srcdoc") : null;
    var url = frameURL(el);
    var cached = el[FRAME_DOC];
    if (!cached || el[FRAME_SRC] !== src || el[FRAME_URL] !== url) {
      cached = D.parse(src === null ? "<!doctype html><html><head></head><body></body></html>" : String(src));
      if (W.HTMLDocument) Object.setPrototypeOf(cached, W.HTMLDocument.prototype);
      Object.defineProperty(el, FRAME_DOC, { value: cached, configurable: true });
      Object.defineProperty(el, FRAME_SRC, { value: src, configurable: true, writable: true });
      Object.defineProperty(el, FRAME_URL, { value: url, configurable: true, writable: true });
      Object.defineProperty(cached, "defaultView", { get: function () { return frameWindowOf(el); }, configurable: true });
    }
    return cached;
  };
  var frameWindowOf = function (el) {
    var win = el[FRAME_WIN];
    if (!win) {
      win = {};
      var location = {};
      ["href", "origin", "protocol", "host", "hostname", "pathname", "search", "hash"].forEach(function (k) {
        Object.defineProperty(location, k, { get: function () { return frameLocation(el)[k]; }, enumerable: true });
      });
      Object.defineProperty(location, "toString", { value: function () { return this.href; } });
      Object.defineProperties(win, {
        document: { get: function () { return frameDocumentOf(el); }, enumerable: true },
        window: { value: win, enumerable: true },
        self: { value: win, enumerable: true },
        frames: { value: win, enumerable: true },
        top: { value: win, enumerable: true },
        parent: { value: win, enumerable: true },
        frameElement: { value: el, enumerable: true },
        location: { value: location, enumerable: true },
      });
      Object.defineProperty(el, FRAME_WIN, { value: win, configurable: true });
    }
    return win;
  };
  getter(P.HTMLFrameElement, "contentDocument", function () { return frameDocumentOf(this); });
  getter(P.HTMLFrameElement, "contentWindow", function () { return frameWindowOf(this); });
  reflectString(P.HTMLFrameSetElement, "cols", "cols");
  reflectString(P.HTMLFrameSetElement, "rows", "rows");
  ["behavior", "bgColor", "direction", "width", "height"].forEach(function (k) { reflectString(P.HTMLMarqueeElement, k, k.toLowerCase()); });
  ["hspace", "vspace", "scrollAmount", "scrollDelay"].forEach(function (k) {
    getter(P.HTMLMarqueeElement, k, function () { var n = parseInt(this.getAttribute(k.toLowerCase()), 10); return isNaN(n) ? 0 : n; }, function (v) { this.setAttribute(k.toLowerCase(), String(v)); });
  });
  reflectBool(P.HTMLMarqueeElement, "trueSpeed", "truespeed");
  def(P.HTMLMarqueeElement, "start", function () {});
  def(P.HTMLMarqueeElement, "stop", function () {});
  // small legacy members the surface inventory found missing, each a line or two over what exists:
  // the six Node constants for node kinds this engine never creates (on the constructor and, as in
  // jsdom, on the prototype, so instances answer them too)
  [["ATTRIBUTE_NODE", 2], ["CDATA_SECTION_NODE", 4], ["ENTITY_REFERENCE_NODE", 5], ["ENTITY_NODE", 6], ["PROCESSING_INSTRUCTION_NODE", 7], ["NOTATION_NODE", 12]].forEach(function (kv) {
    if (!(kv[0] in W.Node)) Object.defineProperty(W.Node, kv[0], { value: kv[1], enumerable: true });
    if (!(kv[0] in P.Node)) Object.defineProperty(P.Node, kv[0], { value: kv[1], enumerable: true });
  });
  // getElementsByTagNameNS: namespaces are not distinguished in HTML documents here, so the
  // namespace is accepted and the plain search runs (jsdom answers the same nodes for HTML content)
  def(P.Document, "getElementsByTagNameNS", function (ns, name) { return this.getElementsByTagName(name); });
  def(P.Element, "getElementsByTagNameNS", function (ns, name) { return this.getElementsByTagName(name); });
  // Text: splitText, wholeText, assignedSlot (never assigned outside a shadow tree, and a text node
  // in one reads its slot through the flattened tree only in browsers with full shadow support)
  def(P.Text, "splitText", function (offset) {
    offset = offset >>> 0;
    var data = this.data;
    if (offset > data.length) { var e = new Error("Failed to execute 'splitText' on 'Text': The offset " + offset + " is greater than the length " + data.length + "."); e.name = "IndexSizeError"; throw e; }
    var rest = this.ownerDocument.createTextNode(data.slice(offset));
    this.data = data.slice(0, offset);
    if (this.parentNode) this.parentNode.insertBefore(rest, this.nextSibling);
    return rest;
  });
  getter(P.Text, "wholeText", function () {
    var out = this.data, n;
    for (n = this.previousSibling; n && n.nodeType === 3; n = n.previousSibling) out = n.data + out;
    for (n = this.nextSibling; n && n.nodeType === 3; n = n.nextSibling) out += n.data;
    return out;
  });
  getter(P.Text, "assignedSlot", function () { return assignedSlotOf(this); });
  // CharacterData is a child node too: the element siblings skip non-elements
  var elemSibling = function (node, dir) {
    for (var n = node[dir]; n; n = n[dir]) if (n.nodeType === 1) return n;
    return null;
  };
  getter(P.CharacterData, "previousElementSibling", function () { return elemSibling(this, "previousSibling"); });
  getter(P.CharacterData, "nextElementSibling", function () { return elemSibling(this, "nextSibling"); });
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
  // the interface's own remove(index); a live options collection answers it through its proxy,
  // this copy keeps the member on the prototype (surface and prototype walks). index is a required
  // long: no argument throws TypeError, undefined converts to 0 (WebIDL), out of range does nothing.
  Object.defineProperty(W.HTMLOptionsCollection.prototype, "remove", {
    value: function (index) {
      if (arguments.length === 0) throw new TypeError("Failed to execute 'remove' on 'HTMLOptionsCollection': 1 argument required, but only 0 present.");
      index = +index;
      if (index !== index) index = 0;
      index = index < 0 ? Math.ceil(index) : Math.floor(index);
      var el = this[index];
      if (el) el.remove();
    },
    writable: true, configurable: true,
  });
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