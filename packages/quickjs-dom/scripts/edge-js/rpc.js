// The guest side of the bridge (src/bridge.ts): Node calls __rpc(request) with a JSON array [op, ...] and gets a JSON
// answer {v} or {x}. Values cross as JSON; what cannot (nodes, events, functions) crosses as a handle: a number that
// stands for the object in the table here, kept alive until the host lets go of it.
(function (g) {
  var D = g.__native.dom;
  // handle table: arrays by id (a Map keyed by small integers is slow in QuickJS), ids of let-go objects are reused
  var byId = [undefined], sent = [0], free = [], live = 0, byObj = new Map();
  var callbacks = new Map(); // id of a function of the host's -> the function that calls it from here
  var protoNames = null, ctorNames = null, interfaces = null;

  var collect = function () {
    protoNames = new Map(); ctorNames = new Map(); interfaces = [];
    var add = function (name, C) {
      if (typeof C !== "function" || !C.prototype || typeof C.prototype !== "object" || !/^[A-Z]/.test(name)) return; // window.getSelection is a function, not an interface
      if (protoNames.has(C.prototype)) { ctorNames.set(C, protoNames.get(C.prototype)); return; } // a shim of an interface is that interface
      protoNames.set(C.prototype, name); ctorNames.set(C, name); interfaces.push([name, C]);
    };
    Object.keys(D.ctors).forEach(function (k) { add(k, D.ctors[k]); });
    Object.keys(D.window).forEach(function (k) { add(k, D.window[k]); });
  };
  var INDEXED = ["NodeList", "HTMLCollection", "NamedNodeMap", "DOMTokenList", "HTMLOptionsCollection", "HTMLFormControlsCollection"];

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
  var infoOf = function (v, id) {
    var cls = classOf(v);
    if (!cls) return null;
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
    id = idFor(v);
    var s = infoOf(v, id);
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

  var callHost = function (id, self, args) {
    var reply = g.__host.callback(String(id), JSON.stringify([enc(self), Array.prototype.map.call(args, enc)]));
    if (reply === undefined) throw new Error("the host has no function " + id);
    var r = JSON.parse(reply);
    if (r.x) throw rebuild(r.x);
    return dec(r.v);
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
    if (!protoNames) collect();
    for (var i = 0; i < interfaces.length; i++) if (interfaces[i][0] === name) return interfaces[i][1];
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
    has: function (r) { return r[2] in Object(target(r[1])); },
    del: function (r) { return delete target(r[1])[r[2]]; },
    keys: function (r) { return json(Object.getOwnPropertyNames(Object(target(r[1])))); },
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
        } else if (a.charCodeAt(0) === 4) { // \u0004: simple typed tokens separated by \u0002
          parsedArgs = a.slice(1).split("\u0002").map(function (tok) {
            var tc = tok.charCodeAt(0);
            if (tc === 78) return null; // N
            if (tc === 84) return true; // T
            if (tc === 70) return false; // F
            if (tc === 110) return +tok.slice(1); // n
            if (tc === 115) return tok.slice(1); // s
            if (tc === 104) return target(+tok.slice(1)); // h
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
        } else if (vc === 4) {
          var tok = valStr.slice(1), tc = tok.charCodeAt(0);
          if (tc === 78) val = null;
          else if (tc === 84) val = true;
          else if (tc === 70) val = false;
          else if (tc === 110) val = +tok.slice(1);
          else if (tc === 115) val = tok.slice(1);
          else if (tc === 104) val = target(+tok.slice(1));
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

  // Pre-collect interface and constructor names into the memory snapshot
  collect();
})(globalThis);
