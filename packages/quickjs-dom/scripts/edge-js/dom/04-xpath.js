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
  var XPathExpression = function XPathExpression() { illegal(); };
  W.XPathExpression = XPathExpression;
  var XPathException = function XPathException(message) {
    Object.defineProperties(this, {
      message: { value: String(message || ""), enumerable: true },
      name: { value: "XPathException", enumerable: true },
      code: { value: 0, enumerable: true },
    });
  };
  Object.setPrototypeOf(XPathException.prototype, Error.prototype);
  XPathException.INVALID_EXPRESSION_ERR = 51;
  XPathException.TYPE_ERR = 52;
  Object.defineProperty(XPathException.prototype, "INVALID_EXPRESSION_ERR", { value: 51 });
  Object.defineProperty(XPathException.prototype, "TYPE_ERR", { value: 52 });
  W.XPathException = XPathException;
  def(P.Document, "createExpression", function (src) {
    var text = String(src);
    xpCompile(text);
    return Object.setPrototypeOf({ evaluate: function (ctx, type) { return xpEvaluate(text, ctx, type); } }, XPathExpression.prototype);
  });
  def(P.Document, "createNSResolver", function (n) { return { lookupNamespaceURI: function () { return null; } }; });
  var XPathEvaluator = function XPathEvaluator() {};
  def(XPathEvaluator.prototype, "evaluate", function (src, ctx, resolver, type) { return xpEvaluate(src, ctx, type); });
  def(XPathEvaluator.prototype, "createExpression", function (src) { return P.Document.createExpression.call(null, src); });
  def(XPathEvaluator.prototype, "createNSResolver", function (n) { return { lookupNamespaceURI: function () { return null; } }; });
  W.XPathEvaluator = XPathEvaluator;
