// getComputedStyle and document.styleSheets: the style sheets of the page's <style> elements and the style attributes,
// cascaded (importance, specificity, order), inherited, with the browser's defaults for display and a few others.
// Not computed: layout (sizes stay "auto" or as declared), units (a length is as written), external sheets, pseudo-elements,
// custom properties' var() substitution, calc().
(function (g) {
  var D = g.__native.dom;

  // ---- CSS text -> rules
  var skipString = function (s, i) {
    var q = s.charAt(i);
    for (i++; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "\\") i++;
      else if (c === q) return i;
    }
    return s.length;
  };
  var stripComments = function (s) {
    var out = "", i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === "/" && s.charAt(i + 1) === "*") {
        var e = s.indexOf("*/", i + 2);
        i = e < 0 ? s.length : e + 2;
      } else if (c === '"' || c === "'") {
        var j = skipString(s, i);
        out += s.slice(i, j + 1);
        i = j + 1;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  };
  // index of the first `stop` outside strings, parentheses and brackets (or s.length)
  var findTop = function (s, from, stops) {
    var depth = 0;
    for (var i = from; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"' || c === "'") i = skipString(s, i);
      else if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (depth <= 0 && stops.indexOf(c) >= 0) return i;
    }
    return s.length;
  };
  var matchingBrace = function (s, open) {
    var depth = 0;
    for (var i = open; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"' || c === "'") i = skipString(s, i);
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return i;
    }
    return s.length;
  };
  var splitTop = function (s, sep) {
    var out = [], from = 0;
    for (;;) {
      var i = findTop(s, from, sep);
      out.push(s.slice(from, i));
      if (i >= s.length) return out;
      from = i + 1;
    }
  };

  var SIDES = ["top", "right", "bottom", "left"];
  var four = function (v) {
    var p = v.trim().split(/\s+/);
    if (p.length === 1) return [p[0], p[0], p[0], p[0]];
    if (p.length === 2) return [p[0], p[1], p[0], p[1]];
    if (p.length === 3) return [p[0], p[1], p[2], p[1]];
    return p.slice(0, 4);
  };
  var BORDER_STYLES = "none hidden dotted dashed solid double groove ridge inset outset".split(" ");
  var borderParts = function (v) {
    var width = "medium", style = "none", color = "currentcolor";
    splitTop(v.trim(), " ").filter(Boolean).forEach(function (t) {
      if (BORDER_STYLES.indexOf(t) >= 0) style = t;
      else if (/^[0-9.]|^(thin|medium|thick)$|^calc\(/.test(t)) width = t;
      else color = t;
    });
    return [width, style, color];
  };
  // a shorthand becomes its longhands
  var expand = function (prop, value) {
    var i, out = [], v = value.trim();
    if (prop === "margin" || prop === "padding") {
      var f = four(v);
      for (i = 0; i < 4; i++) out.push([prop + "-" + SIDES[i], f[i]]);
      return out;
    }
    if (prop === "inset") {
      var s = four(v);
      for (i = 0; i < 4; i++) out.push([SIDES[i], s[i]]);
      return out;
    }
    if (prop === "border-width" || prop === "border-style" || prop === "border-color") {
      var kind = prop.slice(7), b = four(v);
      for (i = 0; i < 4; i++) out.push(["border-" + SIDES[i] + "-" + kind, b[i]]);
      return out;
    }
    if (prop === "border") {
      var parts = borderParts(v);
      for (i = 0; i < 4; i++) out.push(["border-" + SIDES[i] + "-width", parts[0]], ["border-" + SIDES[i] + "-style", parts[1]], ["border-" + SIDES[i] + "-color", parts[2]]);
      return out;
    }
    var side = /^border-(top|right|bottom|left)$/.exec(prop);
    if (side) {
      var q = borderParts(v);
      return [[prop + "-width", q[0]], [prop + "-style", q[1]], [prop + "-color", q[2]]];
    }
    if (prop === "overflow") {
      var o = v.split(/\s+/);
      return [["overflow-x", o[0]], ["overflow-y", o[1] || o[0]]];
    }
    if (prop === "background") {
      var color = splitTop(v, " ").filter(Boolean).filter(function (t) { return /^(#|rgb|hsl)|^[a-z]+$/i.test(t) && !/^(none|repeat|no-repeat|fixed|scroll|local|center|top|left|right|bottom|cover|contain|inherit|initial|unset)$/i.test(t); });
      return [["background", v]].concat(color.length === 1 ? [["background-color", color[0]]] : []);
    }
    if (prop === "flex-flow") return [["flex-flow", v]];
    return [[prop, v]];
  };
  var parseDeclarations = function (block) {
    var out = [];
    splitTop(block, ";").forEach(function (d) {
      var c = findTop(d, 0, ":");
      if (c >= d.length) return;
      var prop = d.slice(0, c).trim().toLowerCase(), value = d.slice(c + 1).trim(), important = false;
      var m = /\s*!\s*important\s*$/i.exec(value);
      if (m) { important = true; value = value.slice(0, m.index).trim(); }
      if (!prop || value === "") return;
      if (prop.slice(0, 2) === "--") out.push([prop, value, important]);
      else expand(prop, value).forEach(function (e) { out.push([e[0], e[1], important]); });
    });
    return out;
  };

  // specificity of one complex selector: [ids, classes/attributes/pseudo-classes, types/pseudo-elements]
  var specificity = function (sel) {
    var a = 0, b = 0, c = 0, i = 0, n = sel.length;
    var ident = function () { var j = i; while (j < n && /[\w\- -￿]|\\./.test(sel.charAt(j))) j += sel.charAt(j) === "\\" ? 2 : 1; var t = sel.slice(i, j); i = j; return t; };
    while (i < n) {
      var ch = sel.charAt(i);
      if (ch === "#") { i++; ident(); a++; }
      else if (ch === ".") { i++; ident(); b++; }
      else if (ch === "[") { i = findTop(sel, i + 1, "]") + 1; b++; }
      else if (ch === ":") {
        if (sel.charAt(i + 1) === ":") { i += 2; ident(); c++; continue; }
        i++;
        var name = ident().toLowerCase();
        if (sel.charAt(i) === "(") {
          var close = findTop(sel, i + 1, ")");
          var arg = sel.slice(i + 1, close);
          i = close + 1;
          if (name === "where") continue;
          if (name === "is" || name === "not" || name === "has" || name === "matches") {
            var best = [0, 0, 0];
            splitTop(arg, ",").forEach(function (one) {
              var sp = specificity(one.trim());
              if (sp[0] > best[0] || (sp[0] === best[0] && (sp[1] > best[1] || (sp[1] === best[1] && sp[2] > best[2])))) best = sp;
            });
            a += best[0]; b += best[1]; c += best[2];
          } else b++;
        } else if (name === "before" || name === "after" || name === "first-line" || name === "first-letter") c++;
        else b++;
      } else if (ch === "*" || ch === ">" || ch === "+" || ch === "~" || ch === " " || ch === "\t" || ch === "\n" || ch === "|") i++;
      else if (/[\w\-\\]/.test(ch)) { ident(); c++; }
      else i++;
    }
    return [a, b, c];
  };
  var weight = function (sp) { return sp[0] * 1000000 + sp[1] * 1000 + sp[2]; };

  // rules: { selector, weight, decls, media }
  var parseSheet = function (text) {
    var rules = [];
    var run = function (s, media) {
      var i = 0;
      while (i < s.length) {
        while (i < s.length && /\s/.test(s.charAt(i))) i++;
        if (i >= s.length) break;
        if (s.charAt(i) === "@") {
          var nameEnd = i + 1;
          while (nameEnd < s.length && /[\w\-]/.test(s.charAt(nameEnd))) nameEnd++;
          var at = s.slice(i + 1, nameEnd).toLowerCase();
          var stop = findTop(s, nameEnd, ";{");
          if (s.charAt(stop) !== "{") { i = stop + 1; continue; }
          var end = matchingBrace(s, stop);
          if (at === "media") run(s.slice(stop + 1, end), media.concat([s.slice(nameEnd, stop).trim()]));
          else if (at === "supports" || at === "layer" || at === "container") run(s.slice(stop + 1, end), media);
          i = end + 1;
          continue;
        }
        var open = findTop(s, i, "{");
        if (open >= s.length) break;
        var close = matchingBrace(s, open);
        var prelude = s.slice(i, open).trim(), decls = parseDeclarations(s.slice(open + 1, close));
        i = close + 1;
        if (!prelude) continue;
        splitTop(prelude, ",").forEach(function (one) {
          one = one.trim();
          if (one) rules.push({ selector: one, weight: weight(specificity(one)), decls: decls, media: media, text: prelude });
        });
      }
    };
    run(stripComments(text), []);
    return rules;
  };
  var parsed = new Map();
  var rulesOf = function (text) {
    var r = parsed.get(text);
    if (!r) { r = parseSheet(text); if (parsed.size > 200) parsed.clear(); parsed.set(text, r); }
    return r;
  };
  var mediaOk = function (media) {
    for (var i = 0; i < media.length; i++) {
      try { if (typeof g.matchMedia === "function" && !g.matchMedia(media[i]).matches) return false; } catch (e) { return false; }
    }
    return true;
  };

  // the rules of a document's <style> elements in order, kept while the document is as it was
  var sheetCache = new WeakMap();
  var documentRules = function (doc) {
    var v = D.version(), have = sheetCache.get(doc);
    if (have && have.v === v) return have.rules;
    var rules = [], order = 0;
    var styles = doc.querySelectorAll("style");
    for (var i = 0; i < styles.length; i++) {
      var st = styles[i];
      if (st.hasAttribute("disabled")) continue;
      var type = st.getAttribute("type");
      if (type && type.toLowerCase() !== "text/css") continue;
      var m = st.getAttribute("media");
      var base = m ? [m] : [];
      rulesOf(st.textContent).forEach(function (r) { rules.push({ selector: r.selector, weight: r.weight, decls: r.decls, media: base.concat(r.media), order: order++ }); });
    }
    sheetCache.set(doc, { v: v, rules: rules });
    return rules;
  };

  // ---- defaults: the browser's own style sheet, as far as it matters to scripts
  var BLOCK = "address article aside blockquote body center dd details dialog dir div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr html legend main menu nav ol p pre section summary ul xmp".split(" ");
  var NONE = "area base basefont datalist head link meta noembed noframes param rp script style template title".split(" ");
  var uaDisplay = function (el) {
    var t = el.localName;
    if (el.hasAttribute("hidden") && !(t === "input" && el.getAttribute("type") === "hidden" && false)) return "none";
    if (t === "input" && (el.getAttribute("type") || "").toLowerCase() === "hidden") return "none";
    if (NONE.indexOf(t) >= 0) return "none";
    if (BLOCK.indexOf(t) >= 0) return "block";
    switch (t) {
      case "li": return "list-item";
      case "table": return "table";
      case "tr": return "table-row";
      case "thead": return "table-header-group";
      case "tbody": return "table-row-group";
      case "tfoot": return "table-footer-group";
      case "td": case "th": return "table-cell";
      case "caption": return "table-caption";
      case "col": return "table-column";
      case "colgroup": return "table-column-group";
      case "img": case "input": case "select": case "button": case "textarea": case "video": case "canvas": case "audio": case "iframe": case "object": case "svg": return "inline-block";
      default: return "inline";
    }
  };
  var uaStyle = function (el) {
    var t = el.localName, o = { display: uaDisplay(el) };
    if (t === "b" || t === "strong" || t === "th" || /^h[1-6]$/.test(t)) o["font-weight"] = "bold";
    if (t === "i" || t === "em" || t === "cite" || t === "var" || t === "dfn" || t === "address") o["font-style"] = "italic";
    if ((t === "a" && el.hasAttribute("href")) || t === "u" || t === "ins") o["text-decoration-line"] = "underline";
    if (t === "s" || t === "strike" || t === "del") o["text-decoration-line"] = "line-through";
    if (t === "pre" || t === "code" || t === "kbd" || t === "samp" || t === "tt") o["font-family"] = "monospace";
    if (t === "pre") o["white-space"] = "pre";
    if (t === "a" && el.hasAttribute("href")) o.color = "rgb(0, 0, 238)";
    if (t === "th") o["text-align"] = "center";
    if (t === "ul" || t === "ol" || t === "menu") o["list-style-type"] = t === "ol" ? "decimal" : "disc";
    if (t === "li") o["list-style-type"] = "inherit";
    if (t === "button" || t === "input" || t === "select" || t === "textarea") o.cursor = "default";
    return o;
  };
  var INHERITED = "color cursor direction font font-family font-size font-style font-variant font-weight letter-spacing line-height list-style list-style-image list-style-position list-style-type pointer-events quotes text-align text-indent text-transform text-shadow visibility white-space word-spacing word-break overflow-wrap tab-size caret-color".split(" ");
  var INITIAL = {
    "color": "rgb(0, 0, 0)", "background-color": "rgba(0, 0, 0, 0)", "background-image": "none", "visibility": "visible", "opacity": "1", "position": "static",
    "overflow-x": "visible", "overflow-y": "visible", "pointer-events": "auto", "z-index": "auto", "float": "none", "clear": "none", "cursor": "auto",
    "font-size": "16px", "font-weight": "400", "font-style": "normal", "font-family": "Times New Roman", "line-height": "normal", "letter-spacing": "normal",
    "text-align": "start", "text-decoration-line": "none", "text-transform": "none", "text-indent": "0px", "white-space": "normal", "word-spacing": "0px",
    "width": "auto", "height": "auto", "min-width": "auto", "min-height": "auto", "max-width": "none", "max-height": "none",
    "top": "auto", "right": "auto", "bottom": "auto", "left": "auto", "box-sizing": "content-box", "direction": "ltr", "vertical-align": "baseline",
    "margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px", "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px",
    "border-top-width": "0px", "border-right-width": "0px", "border-bottom-width": "0px", "border-left-width": "0px",
    "border-top-style": "none", "border-right-style": "none", "border-bottom-style": "none", "border-left-style": "none",
    "list-style-type": "disc", "flex-direction": "row", "flex-wrap": "nowrap", "justify-content": "normal", "align-items": "normal", "transform": "none", "content": "normal",
  };

  // ---- colours: a browser answers rgb() / rgba() whatever way the colour was written
  var NAMED = ("aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 " +
    "cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 " +
    "darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f " +
    "darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff " +
    "gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c " +
    "lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 " +
    "lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 " +
    "magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc " +
    "mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 " +
    "orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 " +
    "rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd " +
    "slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 " +
    "yellow:ffff00 yellowgreen:9acd32").split(" ").reduce(function (m, e) { var p = e.split(":"); m[p[0]] = p[1]; return m; }, {});
  var rgba = function (r, g2, b, a) {
    var c = function (x) { return Math.max(0, Math.min(255, Math.round(x))); };
    a = Math.max(0, Math.min(1, a));
    return a === 1 ? "rgb(" + c(r) + ", " + c(g2) + ", " + c(b) + ")" : "rgba(" + c(r) + ", " + c(g2) + ", " + c(b) + ", " + +a.toFixed(3) + ")";
  };
  var hslToRgb = function (h, sat, l) {
    h = ((h % 360) + 360) % 360 / 360;
    var q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    var f = function (t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  };
  var normColor = function (v) {
    var low = v.trim().toLowerCase(), m;
    if (low === "transparent") return "rgba(0, 0, 0, 0)";
    if (NAMED[low]) low = "#" + NAMED[low];
    if ((m = /^#([0-9a-f]{3,8})$/.exec(low))) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split("").map(function (x) { return x + x; }).join("");
      if (h.length === 6 || h.length === 8) return rgba(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1);
      return v;
    }
    if ((m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(low))) {
      var ch = function (x, pct) { return pct ? parseFloat(x) * 2.55 : parseFloat(x); };
      return rgba(ch(m[1], m[2]), ch(m[3], m[4]), ch(m[5], m[6]), m[7] === undefined ? 1 : m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7]));
    }
    if ((m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(low))) {
      var rgb = hslToRgb(parseFloat(m[1]), parseFloat(m[2]) / 100, parseFloat(m[3]) / 100);
      return rgba(rgb[0], rgb[1], rgb[2], m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    }
    return v;
  };

  // ---- the cascade for one element
  // what was computed since the document last changed
  var memo = { v: -1, m: new WeakMap() };
  var computedOf = function (el, depth) {
    var version = D.version();
    if (memo.v !== version) memo = { v: version, m: new WeakMap() };
    var known = memo.m.get(el);
    if (known) return known;
    var made = cascade(el, depth);
    memo.m.set(el, made);
    return made;
  };
  var cascade = function (el, depth) {
    var doc = el.ownerDocument, ua = uaStyle(el), win = {}, order = 0;
    var best = {}; // property -> { v, imp, inline, w, o }
    var offer = function (prop, value, imp, inline, w, o) {
      var b = best[prop];
      if (b) {
        if (b.imp !== imp) { if (!imp) return; }
        else if (b.inline !== inline) { if (!inline) return; }
        else if (b.w > w || (b.w === w && b.o > o)) return;
      }
      best[prop] = { v: value, imp: imp, inline: inline, w: w, o: o };
    };
    var rules = doc ? documentRules(doc) : [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.media.length && !mediaOk(r.media)) continue;
      var hit;
      try { hit = el.matches(r.selector); } catch (e) { hit = false; }
      if (!hit) continue;
      for (var j = 0; j < r.decls.length; j++) offer(r.decls[j][0], r.decls[j][1], r.decls[j][2], false, r.weight, r.order);
    }
    var inline = el.getAttribute("style");
    if (inline) parseDeclarations(inline).forEach(function (d) { offer(d[0], d[1], d[2], true, 0, ++order); });
    var parent = el.parentElement, parentStyle = parent && depth < 200 ? computedOf(parent, depth + 1) : null;
    var out = {}, k;
    for (k in INITIAL) out[k] = INITIAL[k];
    if (parentStyle) INHERITED.forEach(function (p) { if (parentStyle[p] !== undefined) out[p] = parentStyle[p]; });
    for (k in ua) out[k] = ua[k] === "inherit" && parentStyle ? parentStyle[k] : ua[k];
    for (k in best) {
      var v = best[k].v, low = v.toLowerCase();
      if (low === "inherit") out[k] = parentStyle && parentStyle[k] !== undefined ? parentStyle[k] : INITIAL[k] || "";
      else if (low === "initial") out[k] = INITIAL[k] || "";
      else if (low === "unset") out[k] = INHERITED.indexOf(k) >= 0 && parentStyle && parentStyle[k] !== undefined ? parentStyle[k] : INITIAL[k] || "";
      else if (low === "currentcolor" && (k === "border-top-color" || k === "border-right-color" || k === "border-bottom-color" || k === "border-left-color" || k === "background-color")) out[k] = out.color;
      else out[k] = v;
    }
    ["top", "right", "bottom", "left"].forEach(function (s) { if (out["border-" + s + "-color"] === undefined || out["border-" + s + "-color"] === "currentcolor") out["border-" + s + "-color"] = out.color; });
    // the lengths of the borders that have no style are 0
    ["top", "right", "bottom", "left"].forEach(function (s) { var st = out["border-" + s + "-style"]; if (st === "none" || st === "hidden") out["border-" + s + "-width"] = "0px"; });
    for (k in out) if (k === "color" || k.slice(-6) === "-color") { if (out[k] !== "currentcolor") out[k] = normColor(out[k]); }
    if (out["overflow-x"] === undefined) out["overflow-x"] = "visible";
    out.overflow = out["overflow-x"] === out["overflow-y"] ? out["overflow-x"] : out["overflow-x"] + " " + out["overflow-y"];
    // the display of a floated or absolutely positioned box is block-level
    if ((out.float !== "none" || out.position === "absolute" || out.position === "fixed") && out.display === "inline") out.display = "block";
    return out;
  };

  var kebab = function (k) { return k.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); }); };
  var camel = function (k) { return k.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); };
  var SHORT = { margin: "margin-", padding: "padding-" };

  var Computed = function CSSStyleDeclaration() {};
  var makeComputed = function (el, values) {
    var names = Object.keys(values).sort();
    var read = function (name) {
      name = name.toLowerCase();
      var v = values[name];
      if (v === undefined && SHORT[name]) {
        var f = SIDES.map(function (s) { return values[SHORT[name] + s]; });
        if (f.every(function (x) { return x !== undefined; })) v = f[0] === f[2] && f[1] === f[3] ? (f[0] === f[1] ? f[0] : f[0] + " " + f[1]) : f.join(" ");
      }
      return v === undefined ? "" : v;
    };
    var base = {};
    Object.defineProperties(base, {
      getPropertyValue: { value: function (n) { return read(String(n)); } },
      getPropertyPriority: { value: function () { return ""; } },
      item: { value: function (i) { return names[i] || ""; } },
      setProperty: { value: function () { throw domErr("NoModificationAllowedError", "These styles are computed, and therefore read-only."); } },
      removeProperty: { value: function () { throw domErr("NoModificationAllowedError", "These styles are computed, and therefore read-only."); } },
      length: { get: function () { return names.length; } },
      cssText: { get: function () { return ""; } },
      parentRule: { value: null },
    });
    Object.setPrototypeOf(base, Computed.prototype);
    return new Proxy(base, {
      get: function (t, k) {
        if (typeof k !== "string") return t[k];
        if (k in t) return t[k];
        if (/^\d+$/.test(k)) return names[+k];
        if (k === "cssFloat") return read("float");
        var n = k.indexOf("-") >= 0 ? k : kebab(k);
        return read(n);
      },
      set: function (t, k) {
        throw domErr("NoModificationAllowedError", "These styles are computed, and therefore read-only.");
      },
      has: function (t, k) { return typeof k === "string" ? (k in t || read(kebab(k)) !== "" || /^\d+$/.test(k) && +k < names.length) : k in t; },
      ownKeys: function () { return names.map(function (_, i) { return String(i); }).concat(names.map(camel)); },
      getOwnPropertyDescriptor: function (t, k) {
        if (typeof k !== "string") return undefined;
        if (/^\d+$/.test(k)) return +k < names.length ? { value: names[+k], enumerable: true, configurable: true } : undefined;
        var v = read(kebab(k));
        return v === "" ? undefined : { value: v, enumerable: true, configurable: true };
      },
    });
  };
  var domErr = function (name, message) { var e = new Error(message); e.name = name; return e; };

  g.getComputedStyle = function getComputedStyle(el, pseudo) {
    if (!el || el.nodeType !== 1) throw new TypeError("Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.");
    if (pseudo) return makeComputed(el, {});
    return makeComputed(el, computedOf(el, 0));
  };
  if (D.window) D.window.CSSStyleDeclaration = D.window.CSSStyleDeclaration || Computed;

  // ---- document.styleSheets: the <style> elements, with their rules
  var CSSStyleRule = function CSSStyleRule() {};
  var sheetsOf = function (doc) {
    var out = [], styles = doc.querySelectorAll("style");
    for (var i = 0; i < styles.length; i++) {
      (function (owner) {
        var sheet = owner.__sheet || (owner.__sheet = null);
        var cssRules = function () {
          return parseSheetFlat(owner.textContent);
        };
        var obj = {
          type: "text/css", href: null, ownerNode: owner, parentStyleSheet: null, title: owner.getAttribute("title"), media: owner.getAttribute("media") || "",
          get disabled() { return owner.hasAttribute("disabled"); },
          set disabled(v) { if (v) owner.setAttribute("disabled", ""); else owner.removeAttribute("disabled"); },
          get cssRules() { return cssRules(); },
          get rules() { return cssRules(); },
          insertRule: function (rule, index) {
            var list = splitRules(stripComments(owner.textContent));
            index = index === undefined ? 0 : index;
            if (index < 0 || index > list.length) throw domErr("IndexSizeError", "Failed to execute 'insertRule' on 'CSSStyleSheet': the index " + index + " is greater than the length of the rule list.");
            list.splice(index, 0, String(rule));
            owner.textContent = list.join("\n");
            return index;
          },
          deleteRule: function (index) {
            var list = splitRules(stripComments(owner.textContent));
            if (index < 0 || index >= list.length) throw domErr("IndexSizeError", "Failed to execute 'deleteRule' on 'CSSStyleSheet': the index " + index + " is greater than the length of the rule list.");
            list.splice(index, 1);
            owner.textContent = list.join("\n");
          },
        };
        void sheet;
        out.push(obj);
      })(styles[i]);
    }
    return out;
  };
  // the top-level rules of a sheet as text (an at-rule with its block is one)
  var splitRules = function (s) {
    var out = [], i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s.charAt(i))) i++;
      if (i >= s.length) break;
      var stop = findTop(s, i, ";{");
      if (s.charAt(stop) === ";") { out.push(s.slice(i, stop + 1).trim()); i = stop + 1; continue; }
      var end = matchingBrace(s, stop);
      out.push(s.slice(i, end + 1).trim());
      i = end + 1;
    }
    return out;
  };
  var parseSheetFlat = function (text) {
    return splitRules(stripComments(text)).map(function (rule) {
      var open = findTop(rule, 0, "{");
      var selector = rule.slice(0, open).trim(), decls = parseDeclarations(rule.slice(open + 1, rule.length - 1));
      var style = {};
      var items = [];
      decls.forEach(function (d) { style[d[0]] = d[1]; style[camel(d[0])] = d[1]; items.push(d[0]); });
      Object.defineProperties(style, {
        getPropertyValue: { value: function (n) { return style[String(n)] || ""; } },
        length: { value: items.length },
        cssText: { value: decls.map(function (d) { return d[0] + ": " + d[1] + (d[2] ? " !important" : "") + ";"; }).join(" ") },
      });
      var r = Object.create(CSSStyleRule.prototype);
      Object.defineProperties(r, {
        selectorText: { value: selector, enumerable: true },
        style: { value: style, enumerable: true },
        cssText: { value: rule },
        type: { value: selector.charAt(0) === "@" ? 4 : 1 },
      });
      return r;
    });
  };
  var docProto = D.ctors && D.ctors.Document && D.ctors.Document.prototype;
  if (docProto && !Object.getOwnPropertyDescriptor(docProto, "styleSheets")) {
    Object.defineProperty(docProto, "styleSheets", { configurable: true, get: function () { return sheetsOf(this); } });
  }
})(globalThis);
