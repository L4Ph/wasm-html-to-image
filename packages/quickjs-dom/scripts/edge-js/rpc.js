// The guest side of the bridge (src/bridge.ts): Node calls __rpc(request) with a JSON array [op, ...] and gets a JSON
// answer {v} or {x}. Values cross as JSON; what cannot (nodes, events, functions) crosses as a handle: a number that
// stands for the object in the table here, kept alive until the host lets go of it.
(function (g) {
  var D = g.__native.dom;
  // handle table: arrays by id (a Map keyed by small integers is slow in QuickJS), ids of let-go objects are reused
  var byId = [undefined], sent = [0], free = [], live = 0, byObj = new Map();
  var callbacks = new Map(); // id of a function of the host's -> the function that calls it from here
  var protoNames = null, ctorNames = null, ctorByName = null, interfaces = null;

  // The language's and the runtime's own globals. They are non-enumerable like the page's defineProperty-installed
  // ones, so the scan of g below must know them by name: they are values of the language, not interfaces of the page.
  // (The Web Streams polyfill's classes are here too: shims.js installs the polyfill, not the DOM.)
  var BUILTINS = {};
  ("Object Function Array Number Boolean String Symbol BigInt Date RegExp Error EvalError RangeError ReferenceError " +
    "SyntaxError TypeError URIError AggregateError InternalError SuppressedError Math JSON Promise Proxy Reflect Map Set " +
    "WeakMap WeakSet WeakRef FinalizationRegistry ArrayBuffer SharedArrayBuffer DataView Atomics Intl Iterator " +
    "DisposableStack AsyncDisposableStack Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array " +
    "Uint32Array Float16Array Float32Array Float64Array BigInt64Array BigUint64Array WebAssembly " +
    "ReadableStream ReadableStreamDefaultReader ReadableStreamBYOBReader ReadableStreamDefaultController " +
    "ReadableByteStreamController ReadableStreamBYOBRequest WritableStream WritableStreamDefaultWriter " +
    "WritableStreamDefaultController TransformStream TransformStreamDefaultController ByteLengthQueuingStrategy " +
    "CountQueuingStrategy")
    .split(" ").forEach(function (k) { BUILTINS[k] = 1; });

  // Installed as globals by boot.js but kept off the class table on purpose: a dataset, a style declaration and an
  // animated SVG value are nothing but named properties, so a class wrapper would keep host-side sets on the wrapper
  // instead of forwarding them to the page (see DOMStringMap in dom/01-core.js and 02-classes.js, style in 01-core.js,
  // and the SVG value interfaces in 01-core.js). getOwnPropertyNames would find them; they must stay excluded.
  var UNBRIDGED = {};
  ["DOMStringMap", "CSSStyleDeclaration", "SVGAnimatedString", "SVGAnimatedRect", "SVGRect", "SVGNumber", "SVGStringList",
    "SVGPreserveAspectRatio", "SVGAnimatedPreserveAspectRatio"].forEach(function (k) { UNBRIDGED[k] = 1; });

  var collect = function () {
    protoNames = new Map(); ctorNames = new Map(); ctorByName = new Map(); interfaces = [];
    var add = function (name, C) {
      if (typeof C !== "function" || !C.prototype || typeof C.prototype !== "object" || !/^[A-Z]/.test(name)) return; // window.getSelection is a function, not an interface
      if (protoNames.has(C.prototype)) { ctorNames.set(C, protoNames.get(C.prototype)); return; } // a shim of an interface is that interface
      protoNames.set(C.prototype, name); ctorNames.set(C, name); ctorByName.set(name, C); interfaces.push([name, C]);
    };
    Object.keys(D.ctors).forEach(function (k) { add(k, D.ctors[k]); });
    Object.keys(D.window).forEach(function (k) { add(k, D.window[k]); });
    // interfaces boot.js and shims.js define on the guest's globals after nativedom.js built D: without them the host
    // gets their instances as dynamic wrappers (no prototype, no methods) instead of instances of their class.
    // getOwnPropertyNames, not Object.keys: the page's interfaces installed with defineProperty (DOMException from the
    // QuickJS runtime, and anything boot.js adds that way) are non-enumerable, just like the language's globals. The
    // two are told apart by name: BUILTINS is not the page's; UNBRIDGED is the page's but deliberately has no class.
    // The "names" op (below) uses getOwnPropertyNames for the same reason; "keys" stays Object.keys because the host
    // uses it for its Object.keys trap over a window/object wrapper, which must report enumerable members only.
    Object.getOwnPropertyNames(g).forEach(function (k) {
      if (BUILTINS[k] || UNBRIDGED[k]) return;
      add(k, g[k]);
    });
  };
  var INDEXED = ["NodeList", "HTMLCollection", "NamedNodeMap", "DOMTokenList", "HTMLOptionsCollection", "HTMLFormControlsCollection", "RadioNodeList"];

  // what the host builds its classes from: per interface the parent, how each member behaves (0 value, 1 read-only
  // accessor, 2 accessor, 3 method), the constants, and whether it iterates or is indexed
  var schema = function () {
    if (!interfaces) collect();
    return interfaces.map(function (e) {
      var name = e[0], C = e[1], proto = C.prototype, props = {}, consts = {}, statics = {};
      Object.getOwnPropertyNames(proto).forEach(function (p) {
        if (p === "constructor") return;
        var d = Object.getOwnPropertyDescriptor(proto, p);
        if (d.get || d.set) props[p] = d.set ? 2 : 1;
        else if (typeof d.value === "function") props[p] = 3;
        else if (typeof d.value === "number" || typeof d.value === "string" || typeof d.value === "boolean") consts[p] = d.value;
      });
      Object.getOwnPropertyNames(C).forEach(function (p) {
        if (p === "length" || p === "name" || p === "prototype") return;
        var v = C[p];
        if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") statics[p] = v;
      });
      var parent = Object.getPrototypeOf(proto);
      return {
        n: name, p: protoNames.get(parent) || null, props: props, consts: consts, st: statics,
        it: Object.prototype.hasOwnProperty.call(proto, Symbol.iterator) || INDEXED.indexOf(name) >= 0, ix: INDEXED.indexOf(name) >= 0,
      };
    });
  };

  var classOf = function (v) {
    if (!protoNames) collect();
    for (var p = Object.getPrototypeOf(v); p; p = Object.getPrototypeOf(p)) {
      var n = protoNames.get(p);
      if (n) return n;
    }
    return null;
  };

  var idFor = function (v) {
    var id = byObj.get(v);
    if (id === undefined) {
      id = free.length ? free.pop() : byId.length;
      byObj.set(v, id); byId[id] = v; sent[id] = 0; live++;
    }
    sent[id]++;
    return id;
  };
  var infos = []; // id -> the handle in the string form of an answer (see reply)
  var SEP = "\u0001";
  var infoOf = function (v, id, cls) {
    if (cls === undefined && (cls = classOf(v)) === null) return null;
    var nt = v.nodeType;
    if (typeof nt === "number") {
      if (nt === 1) {
        var tn = v.tagName;
        return "h" + id + SEP + cls + SEP + "1" + SEP + tn + SEP + v.localName + SEP + tn;
      }
      return "h" + id + SEP + cls + SEP + nt + SEP + v.nodeName;
    }
    return "h" + id + SEP + cls + SEP;
  };
  // the handle of an object whose class is known, as a string; null for anything else
  var handleString = function (v) {
    var id = byObj.get(v);
    if (id !== undefined && infos[id] !== undefined) {
      sent[id]++;
      return "h" + id;
    }
    if (v === g || typeof v === "function") return null;
    var cls = classOf(v);
    if (cls === null) return null;
    id = idFor(v);
    var s = infoOf(v, id, cls);
    if (s === null) {
      sent[id]--;
      if (sent[id] === 0) { byObj.delete(v); byId[id] = undefined; free.push(id); live--; }
      return null;
    }
    infos[id] = s;
    return s;
  };
  var handle = function (v, fn) {
    var id = idFor(v);
    var out = { $: "h", i: id };
    if (fn) out.c = "Function";
    else if (v === g) out.c = "Window";
    else if (D.CSSStyleDeclarationCtor && v instanceof D.CSSStyleDeclarationCtor) out.c = "CSSStyleDeclaration";
    else {
      var cls = classOf(v);
      if (cls) {
        out.c = cls;
        if (typeof v.nodeType === "number") { out.t = v.nodeType; out.n = v.nodeName; }
      }
    }
    return out;
  };

  var enc = function (v) {
    switch (typeof v) {
      case "undefined": case "symbol": return { $: "u" };
      case "number": return v !== v || v === Infinity || v === -Infinity || (v === 0 && 1 / v < 0) ? { $: "n", v: String(v === 0 ? "-0" : v) } : v;
      case "bigint": return { $: "n", v: String(v), b: 1 };
      case "string": case "boolean": return v;
      case "function":
        // a function of the host's, echoed back (a custom element class read from the
        // registry, say): it returns as the same function, not as a handle to its wrapper here
        if (typeof v.__hostFn === "number") return { $: "f", i: v.__hostFn };
        if (!ctorNames) collect();
        return ctorNames.has(v) ? { $: "c", n: ctorNames.get(v) } : handle(v, true);
      default:
        if (v === null) return null;
        if (Array.isArray(v)) return v.map(enc);
        if (v instanceof Date) return { $: "d", v: v.getTime() };
        return handle(v, false);
    }
  };

  // the names of DOMException that are not an Error of the language (SyntaxError and TypeError are those too)
  var DOM_ERRORS = ["IndexSizeError", "HierarchyRequestError", "WrongDocumentError", "InvalidCharacterError", "NoModificationAllowedError", "NotFoundError", "NotSupportedError", "InUseAttributeError", "InvalidStateError", "InvalidModificationError", "NamespaceError", "InvalidAccessError", "SecurityError", "NetworkError", "AbortError", "URLMismatchError", "QuotaExceededError", "TimeoutError", "DataCloneError"];
  var errorInfo = function (e) {
    var isError = e !== null && typeof e === "object";
    return {
      n: isError ? e.name : "Error", m: isError ? String(e.message) : String(e), s: isError ? e.stack : undefined,
      c: isError ? e.code : undefined, d: isError && DOM_ERRORS.indexOf(e.name) >= 0 ? 1 : 0,
    };
  };
  var rebuild = function (x) {
    var e = new Error(x.m);
    e.name = x.n || "Error";
    if (x.c !== undefined) e.code = x.c;
    return e;
  };

  // A value that goes to the host as a compact token without being looked at twice: a primitive, or an object whose own
  // interface is known (a node, an event). Nothing is numbered here, so a value that is not one costs nothing.
  var plainTokenOk = function (v) {
    switch (typeof v) {
      case "undefined": case "boolean": return true;
      case "number": return v === v && v !== Infinity && v !== -Infinity && !(v === 0 && 1 / v < 0);
      case "string": return v.indexOf(SEP) < 0 && v.indexOf("") < 0;
      case "object": return v === null || (v !== g && protoNames !== null && protoNames.has(Object.getPrototypeOf(v)) && !Array.isArray(v) && !(v instanceof Date));
      default: return false;
    }
  };
  var plainToken = function (v) {
    switch (typeof v) {
      case "undefined": return "U";
      case "boolean": return v ? "T" : "F";
      case "number": return "n" + v;
      case "string": return "s" + v;
      default: return v === null ? "N" : handleString(v, protoNames.get(Object.getPrototypeOf(v)));
    }
  };
  var callHost = function (id, self, args) {
    var plain = plainTokenOk(self);
    for (var pi = 0; plain && pi < args.length; pi++) plain = plainTokenOk(args[pi]);
    if (plain) {
      // the handles go with their class when the host has not seen them (an event listener's event, on its first call)
      var ptoks = [plainToken(self)];
      for (pi = 0; pi < args.length; pi++) ptoks.push(plainToken(args[pi]));
      var preply = g.__host.callback(String(id), "" + ptoks.join(""));
      if (preply === undefined) throw new Error("the host has no function " + id);
      if (preply.charCodeAt(0) === 6) return tokenValue(preply.slice(1));
      var pr = JSON.parse(preply);
      if (pr.x) throw rebuild(pr.x);
      return dec(pr.v);
    }
    var selfEnc = enc(self), list = Array.prototype.map.call(args, enc);
    // A callback whose values are all handles, strings, numbers, booleans or null/undefined (an event listener)
    // goes as compact tokens; anything else falls back to the JSON form both sides already understand.
    var toks = tokenOf(selfEnc);
    if (toks !== null) {
      toks = [toks];
      for (var i = 0; i < list.length; i++) {
        var t = tokenOf(list[i]);
        if (t === null) { toks = null; break; }
        toks.push(t);
      }
    }
    var reply = g.__host.callback(String(id), toks ? "\u0005" + toks.join("\u0002") : JSON.stringify([selfEnc, list]));
    if (reply === undefined) throw new Error("the host has no function " + id);
    if (reply.charCodeAt(0) === 6) return tokenValue(reply.slice(1));
    var r = JSON.parse(reply);
    if (r.x) throw rebuild(r.x);
    return dec(r.v);
  };
  var tokenOf = function (e) {
    switch (typeof e) {
      case "undefined": return "U";
      case "boolean": return e ? "T" : "F";
      case "number": return e === e && e !== Infinity && e !== -Infinity && !(e === 0 && 1 / e < 0) ? "n" + e : null;
      case "string": return e.indexOf(SEP) < 0 && e.indexOf("\u0002") < 0 ? "s" + e : null;
      default:
        if (e === null) return "N";
        return e.$ === "h" ? "h" + e.i : null;
    }
  };
  var tokenValue = function (t) {
    switch (t.charCodeAt(0)) {
      case 85: return undefined; // U
      case 78: return null; // N
      case 84: return true; // T
      case 70: return false; // F
      case 110: return +t.slice(1); // n
      case 115: return t.slice(1); // s
      case 104: return target(+t.slice(1)); // h
      default: return undefined;
    }
  };
  var hostFunction = function (id) {
    var ref = callbacks.get(id), f = ref && ref.deref();
    if (!f) {
      f = function () { return callHost(id, this, arguments); };
      f.__hostFn = id;
      callbacks.set(id, new WeakRef(f));
    }
    return f;
  };

  var dec = function (x) {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map(dec);
    switch (x.$) {
      case "u": return undefined;
      case "n": return x.b ? BigInt(x.v) : Number(x.v);
      case "d": return new Date(x.v);
      case "h": return target(x.i);
      case "f": return hostFunction(x.i);
      case "c": return ctorOf(x.n);
      default: {
        var out = {}, v = x.v || {};
        Object.keys(v).forEach(function (k) { out[k] = dec(v[k]); });
        return out;
      }
    }
  };
  var target = function (id) {
    var o = byId[id];
    if (o === undefined) throw new Error("stale handle " + id);
    return o;
  };
  var ctorOf = function (name) {
    if (!ctorByName) collect();
    var C = ctorByName.get(name);
    if (C) return C;
    // a name the schema does not know (a late global): search the interfaces once, then remember it
    for (var i = 0; i < interfaces.length; i++) if (interfaces[i][0] === name) { C = interfaces[i][1]; ctorByName.set(name, C); return C; }
    throw new Error("no interface " + name);
  };
  var decAll = function (list) { return list.map(dec); };

  // An answer is a string whose first character says what follows: s string, n number, T/F/N/U true, false, null,
  // undefined, h a handle (id, class, nodeType, nodeName apart by \u0001), j encoded JSON, k plain JSON, x an error.
  // A request is "g<id>\u0001<key>" (read), "s<id>\u0001<key>\u0001<value>" (write), "c<id>\u0001<key>\u0001<args>"
  // (method call), or "J" and a JSON array [op, ...]. The first three are what the host does all day: no JSON in them
  // unless a value needs it.
  var Raw = function (s) { this.s = s; };
  var reply = function (v) {
    switch (typeof v) {
      case "string": return "s" + v;
      case "number": return v === v && v !== Infinity && v !== -Infinity && !(v === 0 && 1 / v < 0) ? "n" + v : "j" + JSON.stringify(enc(v));
      case "boolean": return v ? "T" : "F";
      case "undefined": return "U";
      default:
        if (v === null) return "N";
        if (v instanceof Raw) return v.s;
        if (Array.isArray(v)) {
          // a list of objects of known classes (the nodes of a query) goes as their handles, one after the other
          var parts = [];
          for (var i = 0; i < v.length; i++) {
            var item = v[i], s = item !== null && typeof item === "object" && !Array.isArray(item) && !(item instanceof Date) ? handleString(item) : null;
            if (s === null) { for (var j = 0; j < parts.length; j++) release1(parts[j]); parts = null; break; }
            parts.push(s);
          }
          if (parts) return "a" + parts.join("\u0002");
          return "j" + JSON.stringify(enc(v));
        }
        if (!(v instanceof Date)) {
          var hs = handleString(v);
          if (hs !== null) return hs;
        }
        var e = enc(v);
        if (e !== null && typeof e === "object" && e.$ === "h") return "h" + e.i + SEP + (e.c || "") + SEP + (e.t === undefined ? "" : e.t) + SEP + (e.n || "");
        return "j" + JSON.stringify(e);
    }
  };
  var release1 = function (s) { var id = +s.slice(1, s.indexOf(SEP)); if (sent[id] > 0) sent[id]--; };
  var json = function (v) { return new Raw("k" + JSON.stringify(v)); }; // plain data, not to be decoded

  var ops = {
    root: function () { return g; },
    schema: function () { return json(schema()); },
    ce: function () { return !!g.__ceOn; },
    has: function (r) { return r[2] in Object(target(r[1])); },
    del: function (r) { return delete target(r[1])[r[2]]; },
    // Object.keys for the host's Object.keys trap (ownKeys over a dynamic wrapper): enumerable members only.
    keys: function (r) { return json(Object.keys(Object(target(r[1])))); },
    // every own name, for installing a page's window as a test environment's globals (non-enumerable interfaces too)
    names: function (r) { return json(Object.getOwnPropertyNames(Object(target(r[1])))); },
    apply: function (r) { return target(r[1]).apply(dec(r[2]), decAll(r[3])); },
    construct: function (r) { return Reflect.construct(target(r[1]), decAll(r[2])); },
    "new": function (r) { return Reflect.construct(ctorOf(r[1]), decAll(r[2])); },
    array: function (r) { return Array.from(target(r[1])); },
    // the children of a node (r[2]: elements only), without making the page build a live collection for them
    kids: function (r) {
      var out = [], n = target(r[1]);
      for (var c = n.firstChild; c; c = c.nextSibling) if (!r[2] || c.nodeType === 1) out.push(c);
      return out;
    },
    // Several operations in one call, in order: ["call", target, method, args], ["set", target, key, value],
    // ["new", interface, args], ["tree", parent, descriptor]. A target or argument that is {$:"r", i} is the
    // answer of operation i (a node a previous operation made), so a host can build a subtree without a bridge
    // call per node. The tree descriptor is the shape a host-side render has anyway: {tag, attrs, text, children}.
    batch: function (r) {
      var list = r[1], out = [];
      var value = function (x) {
        if (x !== null && typeof x === "object") {
          if (x.$ === "r") return out[x.i];
          if (Array.isArray(x)) return x.map(value);
        }
        return dec(x);
      };
      var build = function (doc, d) {
        if (typeof d === "string") return doc.createTextNode(d);
        var el = doc.createElement(d.tag), k;
        if (d.attrs) for (k in d.attrs) el.setAttribute(k, d.attrs[k]);
        if (d.text !== undefined) el.textContent = d.text;
        if (d.children) for (var i = 0; i < d.children.length; i++) el.appendChild(build(doc, d.children[i]));
        return el;
      };
      for (var i = 0; i < list.length; i++) {
        var o = list[i], kind = o[0], t, res;
        if (kind === "call") {
          t = value(o[1]);
          res = t[o[2]].apply(t, value(o[3] || []));
        } else if (kind === "set") {
          t = value(o[1]);
          res = t[o[2]] = value(o[3]);
        } else if (kind === "new") {
          res = Reflect.construct(ctorOf(o[1]), value(o[2] || []));
        } else if (kind === "tree") {
          t = value(o[1]);
          res = build(t.ownerDocument || t, o[2]);
          if (t && t.nodeType !== 9) t.appendChild(res);
        } else {
          throw new Error("batch: unknown operation " + kind);
        }
        out.push(res);
      }
      return out;
    },
    // A transaction of mutations in one call, in the bridge's compact spelling (not JSON per
    // operation — that is what batch pays, and why batch is not faster per operation): records
    // apart by \u0005, fields by \u0001 — "c<target>\u0001<method>\u0001<args>" (the args in the
    // call spelling: \u0003 strings, \u0004/\u0006 tokens, or JSON), "C" the same for a document
    // creation call, whose handle the host is waiting for, and "s<target>\u0001<key>\u0001<value>".
    // A target or token "r<i>" is the answer of operation i. The answer is one line per call
    // operation, apart by \u0005: the created node's handle for a "C", "-" for any other call
    // (its answer is a node the host already holds, or nothing). On a failure the answer is
    // "!<index>\u0001<message>" followed by the lines of the operations before it; the ones
    // before it stand, as they would have had the host made the calls itself.
    txn: function (r) {
      var records = String(r[1]).split("\u0005"), results = [], lines = [];
      var resolve = function (tok) { return tok.charCodeAt(0) === 114 ? results[+tok.slice(1)] : target(+tok.slice(1)); };
      var token = function (tok) {
        var tc = tok.charCodeAt(0);
        if (tc === 78) return null;
        if (tc === 84) return true;
        if (tc === 70) return false;
        if (tc === 110) return +tok.slice(1);
        if (tc === 115) return tok.slice(1);
        if (tc === 104) return target(+tok.slice(1));
        if (tc === 102) return hostFunction(+tok.slice(1));
        if (tc === 114) return results[+tok.slice(1)];
        return undefined;
      };
      var argsOf = function (a) {
        if (!a) return [];
        var c = a.charCodeAt(0);
        if (c === 3) return a.slice(1).split("\u0002");
        if (c === 4 || c === 6) return a.slice(1).split("\u0002").map(token);
        return decAll(JSON.parse(a));
      };
      var valueOf = function (a) {
        var c = a.charCodeAt(0);
        if (c === 3) return a.slice(1);
        if (c === 4 || c === 6) return token(a.slice(1));
        return dec(JSON.parse(a));
      };
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (!rec) { results.push(undefined); continue; }
        var kind = rec.charCodeAt(0), i1 = rec.indexOf(SEP), i2 = rec.indexOf(SEP, i1 + 1);
        try {
          var tok = rec.slice(1, i1);
          var tgt = tok.charCodeAt(0) === 114 ? results[+tok.slice(1)] : target(+tok.slice(1));
          var key = rec.slice(i1 + 1, i2), rest = rec.slice(i2 + 1);
          if (kind === 115) { // s — the common case (a plain string value) stays inline
            tgt[key] = rest.charCodeAt(0) === 3 ? rest.slice(1) : valueOf(rest);
            results.push(undefined);
          } else { // c / C
            var res = tgt[key].apply(tgt, argsOf(rest));
            results.push(res);
            lines.push(kind === 67 ? handleString(res) || "-" : "-");
          }
        } catch (e) {
          return json("!" + i + SEP + (e && e.message !== undefined ? String(e.message) : String(e)) + "\u0005" + lines.join("\u0005"));
        }
      }
      return json(lines.join("\u0005"));
    },
    // A sequence of events at one target in one call: the guest makes each one and runs the ordinary dispatch,
    // so bubbling, cancelation, activation and listeners (the host's included) behave exactly as when the host
    // dispatches them itself.
    fire: function (r) {
      var t = target(r[1]), evs = r[2], out = [];
      for (var i = 0; i < evs.length; i++) {
        var e = evs[i], C = e.ctor ? g[e.ctor] : g.Event;
        out.push(t.dispatchEvent(new (typeof C === "function" ? C : g.Event)(e.type, dec(e.init || {}))));
      }
      return out;
    },
    release: function (r) {
      r[1].forEach(function (e) {
        var id = e[0], o = byId[id];
        if (o === undefined) return;
        var left = sent[id] - e[1];
        if (left > 0) { sent[id] = left; return; }
        byObj.delete(o); byId[id] = undefined; infos[id] = undefined; sent[id] = 0; free.push(id); live--;
      });
      return null;
    },
    live: function () { return live; },
    // of these objects, the ids of the nodes that are not in a document (the host may stop pinning their wrappers)
    detached: function (r) {
      return json(r[1].filter(function (id) {
        var o = byId[id];
        return o !== undefined && o !== null && typeof o === "object" && o.isConnected === false;
      }));
    },
    // of these functions of the host's, the ones the page no longer holds (the host may let them go)
    deadfns: function (r) {
      return json(r[1].filter(function (id) {
        var ref = callbacks.get(id);
        if (ref && ref.deref()) return false;
        callbacks.delete(id);
        return true;
      }));
    },
    liveFns: function () { return callbacks.size; },
  };

  var callMethod = function (id, key, args) {
    var o = target(id), f = o[key];
    if (typeof f !== "function") throw new TypeError(key + " is not a function");
    return f.apply(o, args);
  };

  // for the fast path in C (qd_rpc): the handle table, how an object is answered, how an error is
  g.__byId = byId;
  g.__reply = reply;
  g.__rpcError = function (e) { return "x" + JSON.stringify(errorInfo(e)); };

  g.__rpc = function (s) {
    try {
      var c = s.charCodeAt(0), i = s.indexOf(SEP), j;
      if (c === 107) { // k: kids (k<id>\1<elementsOnly: 0|1>)
        var kidNodes = [], kn = target(+s.slice(1, i)), elOnly = s.charCodeAt(i + 1) === 49;
        for (var kc = kn.firstChild; kc; kc = kc.nextSibling) if (!elOnly || kc.nodeType === 1) kidNodes.push(kc);
        return reply(kidNodes);
      }
      if (c === 103) return reply(target(+s.slice(1, i))[s.slice(i + 1)]); // g
      if (c === 99) { // c
        j = s.indexOf(SEP, i + 1);
        var a = s.slice(j + 1);
        var parsedArgs;
        if (!a) {
          parsedArgs = [];
        } else if (a.charCodeAt(0) === 3) { // \u0003: strings separated by \u0002
          parsedArgs = a.slice(1).split("\u0002");
        } else if (a.charCodeAt(0) === 4 || a.charCodeAt(0) === 6) { // \u0004: simple typed tokens separated by \u0002
          parsedArgs = a.slice(1).split("\u0002").map(function (tok) {
            var tc = tok.charCodeAt(0);
            if (tc === 78) return null; // N
            if (tc === 84) return true; // T
            if (tc === 70) return false; // F
            if (tc === 110) return +tok.slice(1); // n
            if (tc === 115) return tok.slice(1); // s
            if (tc === 104) return target(+tok.slice(1)); // h
            if (tc === 102) return hostFunction(+tok.slice(1)); // f
            return undefined;
          });
        } else {
          parsedArgs = decAll(JSON.parse(a));
        }
        return reply(callMethod(+s.slice(1, i), s.slice(i + 1, j), parsedArgs));
      }
      if (c === 115) { // s
        j = s.indexOf(SEP, i + 1);
        var valStr = s.slice(j + 1);
        var val;
        var vc = valStr.charCodeAt(0);
        if (vc === 3) {
          val = valStr.slice(1);
        } else if (vc === 4 || vc === 6) {
          var tok = valStr.slice(1), tc = tok.charCodeAt(0);
          if (tc === 78) val = null;
          else if (tc === 84) val = true;
          else if (tc === 70) val = false;
          else if (tc === 110) val = +tok.slice(1);
          else if (tc === 115) val = tok.slice(1);
          else if (tc === 104) val = target(+tok.slice(1));
          else if (tc === 102) val = hostFunction(+tok.slice(1));
          else val = undefined;
        } else {
          val = dec(JSON.parse(valStr));
        }
        target(+s.slice(1, i))[s.slice(i + 1, j)] = val;
        return "N";
      }
      var r = JSON.parse(s.slice(1));
      return reply(ops[r[0]](r));
    } catch (e) {
      return "x" + JSON.stringify(errorInfo(e));
    }
  };

  // Pre-collect interface and constructor names into the memory snapshot. This runs once, when the guest is compiled
  // (before any page): it is not a live view. Anything that installs a new global interface after this point (a later
  // shim, a lazily defined class) will not be in the schema until something calls collect() again; if such a late
  // addition ever becomes possible, reset protoNames/ctorNames/interfaces here (and let the host rebuild its classes).
  collect();
})(globalThis);
