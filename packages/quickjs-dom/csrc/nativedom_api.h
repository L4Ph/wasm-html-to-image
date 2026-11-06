/*
 * The JS surface of the native DOM nodes (see nativedom.h): Node, Element, Document, DocumentFragment, Text, Comment,
 * with the tree operations in C. What is easier in JavaScript (the ChildNode/ParentNode mixins, classList, dataset,
 * insertAdjacent*) is in scripts/edge-js/nativedom.js, on top of these.
 */

static JSValue nd_throw(JSContext *c, const char *name, const char *msg) {
    JSValue e = JS_NewError(c);
    JS_SetPropertyStr(c, e, "name", JS_NewString(c, name));
    JS_SetPropertyStr(c, e, "message", JS_NewString(c, msg));
    return JS_Throw(c, e);
}

static inline int nd_same(JSValueConst a, JSValueConst b) { return JS_VALUE_GET_PTR(a) == JS_VALUE_GET_PTR(b); }

/* is `anc` the node itself or one of its ancestors? */
static int nd_inclusive_ancestor(JSValueConst anc, JSValueConst node) {
    for (JSValue p = node; !JS_IsNull(p); p = nd_of(p)->parent)
        if (nd_same(p, anc)) return 1;
    return 0;
}

static JSValue nd_owner_doc(JSValueConst node) {
    ND *n = nd_of(node);
    return n->type == 9 ? (JSValue)node : n->owner;
}

/* give a node and everything below it to another document (as inserting it there does) */
static void nd_adopt(JSContext *c, JSValueConst node, JSValueConst doc) {
    ND *n = nd_of(node);
    if (n->type == 9) return;
    if (!JS_IsNull(n->owner) && nd_same(n->owner, doc)) return;
    JS_FreeValue(c, n->owner);
    n->owner = JS_DupValue(c, doc);
    if (!JS_IsNull(n->content)) nd_adopt(c, n->content, doc);
    for (JSValue ch = n->first; !JS_IsNull(ch); ch = nd_of(ch)->next) nd_adopt(c, ch, doc);
}

/* insert with the checks of the DOM; `ref` null or undefined appends */
static JSValue nd_insert_checked(JSContext *c, JSValueConst parent, JSValueConst child, JSValueConst ref) {
    ND *p = nd_of(parent), *ch = nd_of(child);
    if (!p || !ch) return JS_ThrowTypeError(c, "Failed to execute 'insertBefore': parameter 1 is not of type 'Node'.");
    if (!(p->type == 1 || p->type == 9 || p->type == 11)) return nd_throw(c, "HierarchyRequestError", "This node type does not support children.");
    if (ch->type == 9) return nd_throw(c, "HierarchyRequestError", "A document cannot be inserted.");
    if (nd_inclusive_ancestor(child, parent)) return nd_throw(c, "HierarchyRequestError", "The new child element contains the parent.");
    JSValue r = JS_IsUndefined(ref) ? JS_NULL : (JSValue)ref;
    if (!JS_IsNull(r)) {
        ND *rn = nd_of(r);
        if (!rn || JS_IsNull(rn->parent) || !nd_same(rn->parent, parent))
            return nd_throw(c, "NotFoundError", "The node before which the new node is to be inserted is not a child of this node.");
        if (nd_same(r, child)) r = ch->next; /* inserting a node before itself leaves it where it is */
    }
    JSValue rd = JS_DupValue(c, r);
    JSValue doc = nd_owner_doc(parent);
    if (ch->type == 11) {
        while (!JS_IsNull(ch->first)) {
            JSValue k = JS_DupValue(c, ch->first);
            nd_adopt(c, k, doc);
            nd_insert(c, parent, k, rd);
            JS_FreeValue(c, k);
        }
    } else {
        nd_adopt(c, child, doc);
        nd_insert(c, parent, child, rd);
    }
    JS_FreeValue(c, rd);
    return JS_UNDEFINED;
}

/* ---- cloning ---- */

static JSValue nd_clone(JSContext *c, JSValueConst src, int deep, JSValueConst owner) {
    ND *s = nd_of(src);
    JSValue copy = nd_new(c, owner, s->type, s->tag, (size_t)s->taglen, 0);
    if (JS_IsException(copy)) return copy;
    ND *d = nd_of(copy);
    for (int i = 0; i < s->nattrs; i++) nd_set_attr(d, s->attrs[i].name, (size_t)s->attrs[i].nlen, s->attrs[i].val, (size_t)s->attrs[i].vlen);
    /* a clone of a document is a document: its children belong to it */
    JSValue childOwner = s->type == 9 ? copy : owner;
    if (deep) {
        if (!JS_IsNull(s->content)) {
            JSValue f = nd_clone(c, s->content, 1, owner);
            if (JS_IsException(f)) { JS_FreeValue(c, copy); return f; }
            d->content = f;
        }
        for (JSValue ch = s->first; !JS_IsNull(ch); ch = nd_of(ch)->next) {
            JSValue k = nd_clone(c, ch, 1, childOwner);
            if (JS_IsException(k)) { JS_FreeValue(c, copy); return k; }
            nd_insert(c, copy, k, JS_NULL);
            JS_FreeValue(c, k);
        }
    }
    return copy;
}

/* ---- document position, normalize ---- */

static int nd_depth(JSValueConst n) {
    int d = 0;
    for (JSValue p = nd_of(n)->parent; !JS_IsNull(p); p = nd_of(p)->parent) d++;
    return d;
}

/* node.compareDocumentPosition(other) */
static int nd_compare(JSValueConst a, JSValueConst b) {
    if (nd_same(a, b)) return 0;
    if (nd_inclusive_ancestor(a, b)) return 20; /* CONTAINED_BY | FOLLOWING */
    if (nd_inclusive_ancestor(b, a)) return 10; /* CONTAINS | PRECEDING */
    JSValue x = a, y = b;
    int dx = nd_depth(a), dy = nd_depth(b);
    while (dx > dy) { x = nd_of(x)->parent; dx--; }
    while (dy > dx) { y = nd_of(y)->parent; dy--; }
    while (!nd_same(nd_of(x)->parent, nd_of(y)->parent) && !JS_IsNull(nd_of(x)->parent) && !JS_IsNull(nd_of(y)->parent)) {
        x = nd_of(x)->parent;
        y = nd_of(y)->parent;
    }
    if (JS_IsNull(nd_of(x)->parent) || JS_IsNull(nd_of(y)->parent)) {
        /* not in the same tree: the order is arbitrary but stable */
        return 1 | 32 | (JS_VALUE_GET_PTR(a) < JS_VALUE_GET_PTR(b) ? 2 : 4);
    }
    for (JSValue s = nd_of(x)->next; !JS_IsNull(s); s = nd_of(s)->next)
        if (nd_same(s, y)) return 4; /* b follows a */
    return 2;
}

static void nd_normalize(JSContext *c, JSValueConst node) {
    ND *n = nd_of(node);
    JSValue ch = n->first;
    while (!JS_IsNull(ch)) {
        ND *k = nd_of(ch);
        JSValue next = k->next;
        if (k->type == 3) {
            if (k->taglen == 0) {
                JSValue keep = JS_DupValue(c, next);
                JSValue gone = JS_DupValue(c, ch);
                nd_unlink(c, gone);
                JS_FreeValue(c, gone);
                JS_FreeValue(c, keep);
                ch = next;
                continue;
            }
            while (!JS_IsNull(next) && nd_of(next)->type == 3) {
                ND *t = nd_of(next);
                char *merged = malloc((size_t)(k->taglen + t->taglen + 1));
                memcpy(merged, k->tag, (size_t)k->taglen);
                memcpy(merged + k->taglen, t->tag, (size_t)t->taglen);
                k->taglen += t->taglen;
                merged[k->taglen] = 0;
                free(k->tag);
                k->tag = merged;
                JSValue after = t->next;
                JSValue gone = JS_DupValue(c, next);
                nd_unlink(c, gone);
                JS_FreeValue(c, gone);
                next = after;
            }
        } else {
            nd_normalize(c, ch);
            if (!JS_IsNull(k->content)) nd_normalize(c, k->content);
        }
        ch = next;
    }
}

/* ---- JS functions ---- */

#define ND_THIS(var) ND *var = nd_of(this_val); if (!var) return JS_ThrowTypeError(ctx, "Illegal invocation")
#define ND_ARG(var, i, what) if (argc <= (i) || !nd_of(argv[i])) return JS_ThrowTypeError(ctx, "Failed to execute '" what "': parameter " #i " is not of type 'Node'."); (void)var

static JSValue js_nd_type(JSContext *ctx, JSValueConst this_val) { ND_THIS(n); return JS_NewInt32(ctx, n->type); }
/* Whether this is an HTML element of an HTML document: its attribute names are matched lower-cased and its tagName is
   upper-cased (the DOM spec). Mirrors namespaceURI in scripts/edge-js/dom/01-core.js. */
static int nd_attr_case_folded(ND *n) {
    if (n->foreign) return 0;
    ND *owner = JS_IsNull(n->owner) ? NULL : nd_of(n->owner);
    if (owner && owner->xml) return 0;
    if (!n->tag) return 1;
    if ((n->taglen == 3 && !memcmp(n->tag, "svg", 3)) || (n->taglen == 4 && !memcmp(n->tag, "math", 4))) return 0;
    for (ND *a = JS_IsNull(n->parent) ? NULL : nd_of(n->parent); a && a->type == 1; a = JS_IsNull(a->parent) ? NULL : nd_of(a->parent)) {
        if (a->foreign || (a->taglen == 3 && !memcmp(a->tag, "svg", 3)) || (a->taglen == 4 && !memcmp(a->tag, "math", 4))) return 0;
        if ((a->taglen == 13 && !strncasecmp(a->tag, "foreignObject", 13)) || (a->taglen == 4 && !memcmp(a->tag, "desc", 4)) || (a->taglen == 5 && !memcmp(a->tag, "title", 5))) return 1;
        if (a->taglen == 14 && !memcmp(a->tag, "annotation-xml", 14)) {
            NAttr *enc = nd_find_attr(a, "encoding", 8);
            if (enc && enc->vlen == 9 && !memcmp(enc->val, "text/html", 9)) return 1;
        }
    }
    return 1;
}
static JSValue js_nd_node_name(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    switch (n->type) {
    case 1: {
        if (!nd_attr_case_folded(n)) return JS_NewStringLen(ctx, n->tag, (size_t)n->taglen);
        char *t = nd_dup(n->tag, (size_t)n->taglen);
        for (int i = 0; i < n->taglen; i++) if (t[i] >= 'a' && t[i] <= 'z') t[i] -= 32;
        JSValue r = JS_NewStringLen(ctx, t, (size_t)n->taglen);
        free(t);
        return r;
    }
    case 3: return JS_NewString(ctx, "#text");
    case 8: return JS_NewString(ctx, "#comment");
    case 9: return JS_NewString(ctx, "#document");
    case 11: return JS_NewString(ctx, "#document-fragment");
    default: {
        /* a doctype: its data is "DOCTYPE html ...", and its name is the word after the first */
        int i = 0;
        while (i < n->taglen && !h_ws((uint8_t)n->tag[i])) i++;
        while (i < n->taglen && h_ws((uint8_t)n->tag[i])) i++;
        int st = i;
        while (i < n->taglen && !h_ws((uint8_t)n->tag[i])) i++;
        return JS_NewStringLen(ctx, n->tag + st, (size_t)(i - st));
    }
    }
}
static JSValue js_nd_tag(JSContext *ctx, JSValueConst this_val, int upper) {
    ND_THIS(n);
    if (upper) return js_nd_node_name(ctx, this_val);
    return JS_NewStringLen(ctx, n->tag, (size_t)n->taglen);
}
static JSValue js_nd_link(JSContext *ctx, JSValueConst this_val, int magic) {
    ND_THIS(n);
    JSValue v = magic == 0 ? n->parent : magic == 1 ? n->first : magic == 2 ? n->last : magic == 3 ? n->next : n->prev;
    return JS_DupValue(ctx, v);
}
static JSValue js_nd_parent_element(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    if (JS_IsNull(n->parent) || nd_of(n->parent)->type != 1) return JS_NULL;
    return JS_DupValue(ctx, n->parent);
}
/* the element-only versions: 0 firstElementChild, 1 lastElementChild, 2 nextElementSibling, 3 previousElementSibling */
static JSValue js_nd_element_link(JSContext *ctx, JSValueConst this_val, int magic) {
    ND_THIS(n);
    JSValue v = magic == 0 ? n->first : magic == 1 ? n->last : magic == 2 ? n->next : n->prev;
    while (!JS_IsNull(v) && nd_of(v)->type != 1) v = magic == 0 || magic == 2 ? nd_of(v)->next : nd_of(v)->prev;
    return JS_DupValue(ctx, v);
}
static JSValue js_nd_child_nodes(JSContext *ctx, JSValueConst this_val, int elements_only) {
    ND_THIS(n);
    JSValue arr = JS_NewArray(ctx);
    uint32_t i = 0;
    for (JSValue ch = n->first; !JS_IsNull(ch); ch = nd_of(ch)->next)
        if (!elements_only || nd_of(ch)->type == 1) JS_SetPropertyUint32(ctx, arr, i++, JS_DupValue(ctx, ch));
    return arr;
}
static JSValue js_nd_child_count(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    int count = 0;
    for (JSValue ch = n->first; !JS_IsNull(ch); ch = nd_of(ch)->next) if (nd_of(ch)->type == 1) count++;
    return JS_NewInt32(ctx, count);
}
static JSValue js_nd_has_children(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) { ND_THIS(n); return JS_NewBool(ctx, !JS_IsNull(n->first)); }
static JSValue js_nd_owner_document(JSContext *ctx, JSValueConst this_val) { ND_THIS(n); return JS_DupValue(ctx, n->owner); }
static JSValue js_nd_root(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    (void)n;
    JSValue r = this_val;
    while (!JS_IsNull(nd_of(r)->parent)) r = nd_of(r)->parent;
    return JS_DupValue(ctx, r);
}
static JSValue js_nd_is_connected(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    (void)n;
    JSValue r = this_val;
    while (!JS_IsNull(nd_of(r)->parent)) r = nd_of(r)->parent;
    return JS_NewBool(ctx, nd_of(r)->type == 9);
}

static void nd_text(HBuf *b, ND *n) {
    if (n->type == 3) hbuf_add(b, (const uint8_t *)n->tag, (size_t)n->taglen);
    else if (n->type == 1 || n->type == 9 || n->type == 11) for (JSValue ch = n->first; !JS_IsNull(ch); ch = nd_of(ch)->next) if (nd_of(ch)->type != 8) nd_text(b, nd_of(ch));
}
static JSValue js_nd_get_text(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    if (n->type == 8 || n->type == 10) return JS_NewStringLen(ctx, n->tag, (size_t)n->taglen);
    HBuf b = {0};
    nd_text(&b, n);
    JSValue s = JS_NewStringLen(ctx, (const char *)b.p, b.n);
    free(b.p);
    return s;
}
static JSValue js_nd_node_value(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    if (n->type == 3 || n->type == 8 || n->type == 10) return JS_NewStringLen(ctx, n->tag, (size_t)n->taglen);
    return JS_NULL;
}
static void nd_clear(JSContext *ctx, JSValueConst obj) {
    ND *n = nd_of(obj);
    while (!JS_IsNull(n->first)) {
        JSValue ch = JS_DupValue(ctx, n->first);
        nd_unlink(ctx, ch);
        JS_FreeValue(ctx, ch);
    }
}
static JSValue js_nd_set_text(JSContext *ctx, JSValueConst this_val, JSValueConst val) {
    ND_THIS(n);
    size_t len;
    const char *s = JS_IsNull(val) ? "" : JS_ToCStringLen(ctx, &len, val);
    if (!s) return JS_EXCEPTION;
    if (JS_IsNull(val)) len = 0;
    if (n->type == 3 || n->type == 8 || n->type == 10) {
        int jok = nd_jbegin();
        if (jok && !JS_IsNull(n->parent)) nd_jkids(ctx, n->parent);
        nd_jend(jok, 1);
        nd_version++; /* a text edit moves the version too: live collections and the renderer's boxes follow it */
        free(n->tag);
        n->tag = nd_dup(s, len);
        n->taglen = (int)len;
    } else if (n->type == 1 || n->type == 11) {
        nd_clear(ctx, this_val);
        if (len) {
            JSValue t = nd_new(ctx, n->type == 11 ? n->owner : n->owner, 3, s, len, 0);
            if (!JS_IsException(t)) {
                nd_insert(ctx, this_val, t, JS_NULL);
                JS_FreeValue(ctx, t);
            }
        }
    }
    if (!JS_IsNull(val)) JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}
static JSValue js_nd_data_length(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    /* UTF-16 length: count code points above U+FFFF twice */
    int len = 0;
    for (int i = 0; i < n->taglen; i++) {
        uint8_t ch = (uint8_t)n->tag[i];
        if ((ch & 0xC0) != 0x80) len += ch >= 0xF0 ? 2 : 1;
    }
    return JS_NewInt32(ctx, len);
}

static JSValue js_nd_get_inner(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    (void)n;
    return nd_serialize_children_str(ctx, this_val);
}
static JSValue js_nd_set_inner(JSContext *ctx, JSValueConst this_val, JSValueConst val) {
    ND_THIS(n);
    JSValue target = nd_is_tag(n, "template", 8) ? JS_DupValue(ctx, nd_content(ctx, this_val)) : JS_DupValue(ctx, this_val);
    if (JS_IsException(target)) return target;
    nd_clear(ctx, target);
    JSValue r = nd_parse_into(ctx, target, val);
    JS_FreeValue(ctx, target);
    return JS_IsException(r) ? r : JS_UNDEFINED;
}
static JSValue js_nd_get_outer(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    (void)n;
    HBuf b = {0};
    nd_serialize(&b, this_val, 0);
    JSValue s = JS_NewStringLen(ctx, (const char *)b.p, b.n);
    free(b.p);
    return s;
}
static JSValue js_nd_content(JSContext *ctx, JSValueConst this_val) {
    ND_THIS(n);
    if (!nd_is_tag(n, "template", 8)) return JS_UNDEFINED;
    JSValue f = nd_content(ctx, this_val);
    return JS_IsException(f) ? f : JS_DupValue(ctx, f);
}

/* id and className: attributes by another name */
static JSValue js_nd_get_attr_prop(JSContext *ctx, JSValueConst this_val, int magic) {
    ND_THIS(n);
    NAttr *a = magic ? nd_find_attr(n, "class", 5) : nd_find_attr(n, "id", 2);
    return a ? JS_NewStringLen(ctx, a->val, (size_t)a->vlen) : JS_NewString(ctx, "");
}
static JSValue js_nd_set_attr_prop(JSContext *ctx, JSValueConst this_val, JSValueConst val, int magic) {
    ND_THIS(n);
    size_t len;
    const char *s = JS_ToCStringLen(ctx, &len, val);
    if (!s) return JS_EXCEPTION;
    nd_set_attr(n, magic ? "class" : "id", magic ? 5 : 2, s, len);
    JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}

static JSValue js_nd_append(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    ND_ARG(n, 0, "appendChild");
    JSValue r = nd_insert_checked(ctx, this_val, argv[0], JS_NULL);
    if (JS_IsException(r)) return r;
    return JS_DupValue(ctx, argv[0]);
}
static JSValue js_nd_insert_before(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    ND_ARG(n, 0, "insertBefore");
    JSValue r = nd_insert_checked(ctx, this_val, argv[0], argc > 1 ? argv[1] : JS_NULL);
    if (JS_IsException(r)) return r;
    return JS_DupValue(ctx, argv[0]);
}
static JSValue js_nd_remove_child(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    ND_ARG(n, 0, "removeChild");
    ND *ch = nd_of(argv[0]);
    if (JS_IsNull(ch->parent) || !nd_same(ch->parent, this_val)) return nd_throw(ctx, "NotFoundError", "The node to be removed is not a child of this node.");
    nd_unlink(ctx, argv[0]);
    return JS_DupValue(ctx, argv[0]);
}
static JSValue js_nd_replace_child(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    ND_ARG(n, 0, "replaceChild");
    ND_ARG(n, 1, "replaceChild");
    ND *old = nd_of(argv[1]);
    if (JS_IsNull(old->parent) || !nd_same(old->parent, this_val)) return nd_throw(ctx, "NotFoundError", "The node to be replaced is not a child of this node.");
    if (nd_same(argv[0], argv[1])) return JS_DupValue(ctx, argv[1]);
    JSValue next = JS_DupValue(ctx, old->next);
    /* the new node may itself be the next sibling: it then stays and the old one goes */
    JSValue oldv = JS_DupValue(ctx, argv[1]);
    nd_unlink(ctx, oldv);
    JSValue r = nd_insert_checked(ctx, this_val, argv[0], next);
    JS_FreeValue(ctx, next);
    if (JS_IsException(r)) {
        JS_FreeValue(ctx, oldv);
        return r;
    }
    return oldv;
}
static JSValue js_nd_clone_node(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    int deep = argc > 0 && JS_ToBool(ctx, argv[0]) > 0;
    return nd_clone(ctx, this_val, deep, n->type == 9 ? JS_NULL : n->owner);
}
static JSValue js_nd_contains(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    (void)n;
    if (argc < 1 || JS_IsNull(argv[0]) || JS_IsUndefined(argv[0])) return JS_FALSE;
    if (!nd_of(argv[0])) return JS_ThrowTypeError(ctx, "Failed to execute 'contains': parameter 1 is not of type 'Node'.");
    return JS_NewBool(ctx, nd_inclusive_ancestor(this_val, argv[0]));
}
static JSValue js_nd_compare(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    ND_ARG(n, 0, "compareDocumentPosition");
    return JS_NewInt32(ctx, nd_compare(this_val, argv[0]));
}
static JSValue js_nd_normalize(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    (void)n;
    nd_normalize(ctx, this_val);
    return JS_UNDEFINED;
}

/* attributes */
/* `name` as this element stores it: a copy to free when it had to change, or NULL (use `name` as is). No upper-case
   letter (nearly every call) costs one scan. */
static char *nd_attr_fold(ND *n, const char *name, size_t len) {
    size_t i = 0;
    while (i < len && !(name[i] >= 'A' && name[i] <= 'Z')) i++;
    if (i == len || !nd_attr_case_folded(n)) return NULL;
    char *low = malloc(len + 1);
    if (!low) return NULL;
    for (i = 0; i < len; i++) low[i] = (name[i] >= 'A' && name[i] <= 'Z') ? (char)(name[i] + 32) : name[i];
    low[len] = 0;
    return low;
}
static JSValue js_nd_get_attribute(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    if (argc < 1) return JS_NULL;
    size_t len;
    const char *name = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!name) return JS_EXCEPTION;
    char *low = nd_attr_fold(n, name, len);
    NAttr *a = nd_find_attr(n, low ? low : name, len);
    JSValue r = a ? JS_NewStringLen(ctx, a->val, (size_t)a->vlen) : JS_NULL;
    free(low);
    JS_FreeCString(ctx, name);
    return r;
}
static JSValue js_nd_has_attribute(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    JSValue r = js_nd_get_attribute(ctx, this_val, argc, argv);
    if (JS_IsException(r)) return r;
    int has = !JS_IsNull(r);
    JS_FreeValue(ctx, r);
    return JS_NewBool(ctx, has);
}
static JSValue js_nd_set_attribute(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    if (argc < 2) return JS_ThrowTypeError(ctx, "Failed to execute 'setAttribute': 2 arguments required.");
    size_t nl, vl;
    const char *name = JS_ToCStringLen(ctx, &nl, argv[0]);
    const char *val = JS_ToCStringLen(ctx, &vl, argv[1]);
    if (name && val) {
        char *low = nd_attr_fold(n, name, nl);
        nd_set_attr(n, low ? low : name, nl, val, vl);
        free(low);
    }
    if (name) JS_FreeCString(ctx, name);
    if (val) JS_FreeCString(ctx, val);
    return JS_UNDEFINED;
}
static JSValue js_nd_remove_attribute(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    if (argc < 1) return JS_UNDEFINED;
    size_t len;
    const char *name = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!name) return JS_EXCEPTION;
    char *low = nd_attr_fold(n, name, len);
    const char *key = low ? low : name;
    NAttr *a = nd_find_attr(n, key, len);
    if (a) {
        int jok = nd_jbegin();
        if (jok) nd_jattr(n, key, len, NULL, 0);
        nd_jend(jok, 1);
        nd_version++;
        free(a->name);
        free(a->val);
        memmove(a, a + 1, sizeof(NAttr) * (size_t)(n->nattrs - (int)(a - n->attrs) - 1));
        n->nattrs--;
    }
    free(low);
    JS_FreeCString(ctx, name);
    return JS_UNDEFINED;
}
static JSValue js_nd_attribute_names(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < n->nattrs; i++) JS_SetPropertyUint32(ctx, arr, (uint32_t)i, JS_NewStringLen(ctx, n->attrs[i].name, (size_t)n->attrs[i].nlen));
    return arr;
}
static JSValue js_nd_has_attributes(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) { ND_THIS(n); return JS_NewBool(ctx, n->nattrs > 0); }

/* selectors and searches */
static JSValue js_nd_query(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv, int magic) {
    ND_THIS(n);
    (void)n;
    if (argc < 1) return JS_ThrowTypeError(ctx, "Failed to execute 'querySelector': 1 argument required.");
    return sel_query(ctx, this_val, argv[0], magic);
}
static JSValue js_nd_matches(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    if (argc < 1) return JS_ThrowTypeError(ctx, "Failed to execute 'matches': 1 argument required.");
    size_t len;
    const char *s = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!s) return JS_EXCEPTION;
    const SList *list = sel_parse_cached(s, len);
    if (!list) {
        JSValue e = JS_ThrowSyntaxError(ctx, "native DOM: unsupported selector: %s", s);
        JS_FreeCString(ctx, s);
        return e;
    }
    sel_scope = n;
    int m = n->type == 1 && sel_match(n, list);
    JS_FreeCString(ctx, s);
    return JS_NewBool(ctx, m);
}
static JSValue js_nd_closest(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    (void)n;
    if (argc < 1) return JS_ThrowTypeError(ctx, "Failed to execute 'closest': 1 argument required.");
    size_t len;
    const char *s = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!s) return JS_EXCEPTION;
    const SList *list = sel_parse_cached(s, len);
    if (!list) {
        JSValue e = JS_ThrowSyntaxError(ctx, "native DOM: unsupported selector: %s", s);
        JS_FreeCString(ctx, s);
        return e;
    }
    JSValue found = JS_NULL;
    sel_scope = n;
    for (JSValue p = this_val; !JS_IsNull(p); p = nd_of(p)->parent) {
        ND *pn = nd_of(p);
        if (pn->type == 1 && sel_match(pn, list)) { found = JS_DupValue(ctx, p); break; }
    }
    JS_FreeCString(ctx, s);
    return found;
}
/* getElementById (0), getElementsByTagName (1), getElementsByClassName (2): below this node, document order */
static JSValue js_nd_get_elements(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv, int magic) {
    ND_THIS(n);
    if (argc < 1) return JS_ThrowTypeError(ctx, "1 argument required.");
    size_t len;
    const char *key = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!key) return JS_EXCEPTION;
    JSValue result = magic == 0 ? JS_NULL : JS_NewArray(ctx);
    uint32_t count = 0;
    JSValue cur = n->first;
    while (!JS_IsNull(cur)) {
        ND *k = nd_of(cur);
        int hit = 0;
        if (k->type == 1) {
            if (magic == 0) {
                NAttr *a = nd_find_attr(k, "id", 2);
                hit = a && (size_t)a->vlen == len && memcmp(a->val, key, len) == 0;
            } else if (magic == 1) {
                hit = (len == 1 && key[0] == '*') || ((size_t)k->taglen == len && strncasecmp(k->tag, key, len) == 0);
            } else {
                int all = len > 0, i = 0;
                while (i < (int)len && all) {
                    while (i < (int)len && h_ws((uint8_t)key[i])) i++;
                    int st = i;
                    while (i < (int)len && !h_ws((uint8_t)key[i])) i++;
                    if (i > st && !sel_class_has(k, key + st, i - st)) all = 0;
                }
                hit = all;
            }
        }
        if (hit) {
            if (magic == 0) { result = JS_DupValue(ctx, cur); break; }
            JS_SetPropertyUint32(ctx, result, count++, JS_DupValue(ctx, cur));
        }
        if (!JS_IsNull(k->first)) cur = k->first;
        else {
            while (JS_IsNull(nd_of(cur)->next)) {
                cur = nd_of(cur)->parent;
                if (JS_IsNull(cur) || nd_same(cur, this_val)) { cur = JS_NULL; break; }
            }
            if (!JS_IsNull(cur)) cur = nd_of(cur)->next;
        }
    }
    JS_FreeCString(ctx, key);
    return result;
}

/* document */
static JSValue js_doc_element(JSContext *ctx, JSValueConst this_val, int magic) {
    ND_THIS(n);
    JSValue root = JS_NULL;
    for (JSValue ch = n->first; !JS_IsNull(ch); ch = nd_of(ch)->next) {
        if (nd_of(ch)->type == 1) { root = ch; break; }
    }
    if (magic == 0) return JS_DupValue(ctx, root); /* documentElement */
    if (magic == 3) { /* doctype */
        for (JSValue ch = n->first; !JS_IsNull(ch); ch = nd_of(ch)->next) if (nd_of(ch)->type == 10) return JS_DupValue(ctx, ch);
        return JS_NULL;
    }
    if (JS_IsNull(root)) return JS_NULL;
    const char *want = magic == 1 ? "head" : "body";
    for (JSValue ch = nd_of(root)->first; !JS_IsNull(ch); ch = nd_of(ch)->next)
        if (nd_is_tag(nd_of(ch), want, (int)strlen(want))) return JS_DupValue(ctx, ch);
    return JS_NULL;
}
static JSValue js_doc_create(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv, int magic) {
    ND_THIS(n);
    (void)n;
    size_t len = 0;
    const char *s = "";
    if (magic != 3) {
        if (argc < 1) return JS_ThrowTypeError(ctx, "1 argument required.");
        s = JS_ToCStringLen(ctx, &len, argv[0]);
        if (!s) return JS_EXCEPTION;
    }
    JSValue r = magic == 0 ? nd_new(ctx, this_val, 1, s, len, n && n->type == 9 && n->xml ? 0 : 1)
              : magic == 1 ? nd_new(ctx, this_val, 3, s, len, 0)
              : magic == 2 ? nd_new(ctx, this_val, 8, s, len, 0)
                           : nd_new(ctx, this_val, 11, NULL, 0, 0);
    if (magic != 3) JS_FreeCString(ctx, s);
    return r;
}
/* importNode(node, deep): a copy that belongs to this document */
static JSValue js_doc_import(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    ND_ARG(n, 0, "importNode");
    return nd_clone(ctx, argv[0], argc > 1 && JS_ToBool(ctx, argv[1]) > 0, this_val);
}
static JSValue js_doc_adopt(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND_THIS(n);
    ND_ARG(n, 0, "adoptNode");
    nd_unlink(ctx, argv[0]);
    nd_adopt(ctx, argv[0], this_val);
    return JS_DupValue(ctx, argv[0]);
}

/* the module functions: __native.dom.* */
static JSValue js_dom_mark_foreign(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)ctx;
    (void)this_val;
    ND *n = argc > 0 ? nd_of(argv[0]) : NULL;
    if (n) n->foreign = 1;
    return JS_UNDEFINED;
}
/* createElementNS keeps the name as given (linearGradient), where createElement lower-cased it */
static JSValue js_dom_set_element_name(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    ND *n = argc > 1 ? nd_of(argv[0]) : NULL;
    if (!n || n->type != 1) return JS_UNDEFINED;
    size_t len;
    const char *s = JS_ToCStringLen(ctx, &len, argv[1]);
    if (!s) return JS_EXCEPTION;
    if ((size_t)n->taglen != len || memcmp(n->tag, s, len) != 0) {
        free(n->tag);
        n->tag = nd_dup(s, len);
        n->taglen = (int)len;
    }
    JS_FreeCString(ctx, s);
    return JS_UNDEFINED;
}
static JSValue js_dom_create_document(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    (void)argc;
    (void)argv;
    return nd_new(ctx, JS_NULL, 9, NULL, 0, 0);
}
/* an XML document: its createElement keeps the name's case (the plain factory stays neutral —
   the native tests use it as a generic document with HTML createElement rules) */
static JSValue js_dom_create_xml_document(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    JSValue doc = js_dom_create_document(ctx, this_val, argc, argv);
    if (!JS_IsException(doc)) nd_of(doc)->xml = 1;
    return doc;
}
static JSValue js_dom_parse(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "markup is required");
    JSValue doc = nd_new(ctx, JS_NULL, 9, NULL, 0, 0);
    if (JS_IsException(doc)) return doc;
    JSValue r = nd_parse_into(ctx, doc, argv[0]);
    if (JS_IsException(r)) {
        JS_FreeValue(ctx, doc);
        return r;
    }
    return doc;
}
/* parseFragment(markup, document): the nodes of the markup in a fragment of `document` */
static JSValue js_dom_parse_fragment(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    if (argc < 2 || !nd_of(argv[1]) || nd_of(argv[1])->type != 9) return JS_ThrowTypeError(ctx, "parseFragment(markup, document)");
    JSValue frag = nd_new(ctx, argv[1], 11, NULL, 0, 0);
    if (JS_IsException(frag)) return frag;
    JSValue r = nd_parse_into(ctx, frag, argv[0]);
    if (JS_IsException(r)) {
        JS_FreeValue(ctx, frag);
        return r;
    }
    return frag;
}

/* serialize(node): the node as HTML, a document with its doctype */
static JSValue js_dom_serialize(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    if (argc < 1 || !nd_of(argv[0])) return JS_ThrowTypeError(ctx, "serialize(node)");
    HBuf b = {0};
    nd_serialize(&b, argv[0], 0);
    JSValue s = JS_NewStringLen(ctx, (const char *)b.p, b.n);
    free(b.p);
    return s;
}

/* for tests: how many nodes are alive, and a garbage collection to free the unreachable ones */
static JSValue js_dom_version(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) { return JS_NewInt64(ctx, nd_version); }
/* live-layout journal: on/off (argv[0], the page's document argv[1]), sync (everything so far is known to the reader), ok (nothing
   but journalled changes since the last sync), take (an array: an attribute change as text `qid \1 name \1 0|1 \1 value`, or
   the element whose children changed; the journal is emptied) */
static JSValue js_dom_journal_on(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    nd_jctx = ctx;
    nd_journal_clear();
    nd_jon = argc > 0 && JS_ToBool(ctx, argv[0]) > 0;
    nd_jdoc = argc > 1 ? nd_of(argv[1]) : NULL;
    nd_jver = nd_version;
    return JS_UNDEFINED;
}
static JSValue js_dom_journal_sync(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    nd_journal_clear();
    nd_jver = nd_version;
    return JS_UNDEFINED;
}
static JSValue js_dom_journal_ok(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    return JS_NewBool(ctx, nd_jon && nd_jver == nd_version);
}
static JSValue js_dom_journal_take(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < nd_jn; i++) {
        NJ *e = &nd_j[i];
        if (e->kind == 2) {
            JS_SetPropertyUint32(ctx, arr, (uint32_t)i, JS_DupValue(ctx, e->parent));
            continue;
        }
        size_t cap = 64 + (size_t)e->nlen + (size_t)e->vlen, len = 0;
        char *buf = malloc(cap);
        if (!buf) { JS_FreeValue(ctx, arr); return JS_ThrowOutOfMemory(ctx); }
        len += (size_t)snprintf(buf, 24, "%u", (unsigned)(e->qid - 1));
        buf[len++] = '\1';
        memcpy(buf + len, e->name, (size_t)e->nlen);
        len += (size_t)e->nlen;
        buf[len++] = '\1';
        buf[len++] = e->val ? '0' : '1';
        buf[len++] = '\1';
        if (e->val) {
            memcpy(buf + len, e->val, (size_t)e->vlen);
            len += (size_t)e->vlen;
        }
        JS_SetPropertyUint32(ctx, arr, (uint32_t)i, JS_NewStringLen(ctx, buf, len));
        free(buf);
    }
    nd_journal_clear(); /* nd_jver stays: what was taken is now the reader's */
    return arr;
}
/* the id the renderer knows an element by; the page numbers its elements from 0, qid is that number + 1 (0 is "none") */
static JSValue js_dom_set_qid(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    ND *n = argc > 1 ? nd_of(argv[0]) : NULL;
    uint32_t v = 0;
    if (!n || JS_ToUint32(ctx, &v, argv[1])) return JS_UNDEFINED;
    n->qid = v;
    return JS_UNDEFINED;
}
/* setState(kind, node|null): the element :focus / :hover / :active / :target mean (0..3); the page keeps the node alive */
static JSValue js_dom_set_state(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    uint32_t k = 0;
    if (argc < 2 || JS_ToUint32(ctx, &k, argv[0]) || k > 3) return JS_UNDEFINED;
    sel_state[k] = JS_IsNull(argv[1]) || JS_IsUndefined(argv[1]) ? NULL : nd_of(argv[1]);
    return JS_UNDEFINED;
}
/* the next node after argv[0] in document order inside root (argv[1]) whose type is in the mask (argv[3]), skipping the
   children of argv[0] when argv[2] is true; null at the end. Traversals (TreeWalker, NodeIterator) step with this. */
static JSValue js_dom_following(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    if (!nd_of(argv[0])) return JS_NULL;
    JSValueConst root = argv[1];
    int skip = JS_ToBool(ctx, argv[2]);
    uint32_t mask = 0xFFFFFFFFu;
    if (argc > 3 && JS_ToUint32(ctx, &mask, argv[3])) return JS_EXCEPTION;
    JSValue cur = argv[0]; /* borrowed: the tree holds every node on the way */
    for (;;) {
        ND *c = nd_of(cur);
        if (!skip && !JS_IsNull(c->first)) cur = c->first;
        else {
            JSValue x = cur;
            for (;;) {
                if (nd_same(x, root)) return JS_NULL;
                ND *xn = nd_of(x);
                if (!JS_IsNull(xn->next)) { cur = xn->next; break; }
                if (JS_IsNull(xn->parent)) return JS_NULL;
                x = xn->parent;
            }
        }
        skip = 0;
        ND *n = nd_of(cur);
        if (mask & (1u << (n->type - 1))) return JS_DupValue(ctx, cur);
    }
}
static JSValue js_dom_set_tag_proto(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    size_t len;
    const char *tag = JS_ToCStringLen(ctx, &len, argv[0]);
    if (!tag) return JS_EXCEPTION;
    if (len > 0 && len < 16 && nd_ntag_protos < ND_TAG_HASH_SIZE - 1) {
        uint32_t h = nd_tag_hash(tag, (int)len) & ND_TAG_HASH_MASK;
        for (int step = 0; step < ND_TAG_HASH_SIZE; step++) {
            uint32_t idx = (h + step) & ND_TAG_HASH_MASK;
            if (nd_tag_protos[idx].len == 0) {
                memcpy(nd_tag_protos[idx].tag, tag, len);
                nd_tag_protos[idx].len = (int)len;
                nd_tag_protos[idx].proto = JS_DupValue(ctx, argv[1]);
                nd_ntag_protos++;
                break;
            }
            if (nd_tag_protos[idx].len == (int)len) {
                int same = 1;
                for (int k = 0; k < (int)len; k++) {
                    char a = nd_tag_protos[idx].tag[k], b = tag[k];
                    if (a >= 'A' && a <= 'Z') a += 32;
                    if (b >= 'A' && b <= 'Z') b += 32;
                    if (a != b) { same = 0; break; }
                }
                if (same) {
                    JS_FreeValue(ctx, nd_tag_protos[idx].proto);
                    nd_tag_protos[idx].proto = JS_DupValue(ctx, argv[1]);
                    break;
                }
            }
        }
    }
    JS_FreeCString(ctx, tag);
    return JS_UNDEFINED;
}
static JSValue js_dom_live(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_NewInt64(ctx, nd_live);
}
static JSValue js_dom_gc(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    (void)argc;
    (void)argv;
    JS_RunGC(JS_GetRuntime(ctx));
    return JS_UNDEFINED;
}

/* ---- registration ---- */

/* every kind of node */
static const JSCFunctionListEntry nd_node_funcs[] = {
    JS_CGETSET_DEF("nodeType", js_nd_type, NULL),
    JS_CGETSET_DEF("nodeName", js_nd_node_name, NULL),
    JS_CGETSET_MAGIC_DEF("parentNode", js_nd_link, NULL, 0),
    JS_CGETSET_DEF("parentElement", js_nd_parent_element, NULL),
    JS_CGETSET_MAGIC_DEF("firstChild", js_nd_link, NULL, 1),
    JS_CGETSET_MAGIC_DEF("lastChild", js_nd_link, NULL, 2),
    JS_CGETSET_MAGIC_DEF("nextSibling", js_nd_link, NULL, 3),
    JS_CGETSET_MAGIC_DEF("previousSibling", js_nd_link, NULL, 4),
    JS_CGETSET_MAGIC_DEF("childNodes", js_nd_child_nodes, NULL, 0),
    JS_CGETSET_DEF("textContent", js_nd_get_text, js_nd_set_text),
    JS_CGETSET_DEF("nodeValue", js_nd_node_value, js_nd_set_text),
    JS_CGETSET_DEF("ownerDocument", js_nd_owner_document, NULL),
    JS_CGETSET_DEF("isConnected", js_nd_is_connected, NULL),
    JS_CFUNC_DEF("hasChildNodes", 0, js_nd_has_children),
    JS_CFUNC_DEF("getRootNode", 0, js_nd_root),
    JS_CFUNC_DEF("appendChild", 1, js_nd_append),
    JS_CFUNC_DEF("insertBefore", 2, js_nd_insert_before),
    JS_CFUNC_DEF("removeChild", 1, js_nd_remove_child),
    JS_CFUNC_DEF("replaceChild", 2, js_nd_replace_child),
    JS_CFUNC_DEF("cloneNode", 0, js_nd_clone_node),
    JS_CFUNC_DEF("contains", 1, js_nd_contains),
    JS_CFUNC_DEF("compareDocumentPosition", 1, js_nd_compare),
    JS_CFUNC_DEF("normalize", 0, js_nd_normalize),
};

/* Text and Comment */
static const JSCFunctionListEntry nd_chardata_funcs[] = {
    JS_CGETSET_DEF("data", js_nd_get_text, js_nd_set_text),
    JS_CGETSET_DEF("length", js_nd_data_length, NULL),
};

/* Element, Document and DocumentFragment: what has children and can be searched */
static const JSCFunctionListEntry nd_parent_funcs[] = {
    JS_CGETSET_MAGIC_DEF("children", js_nd_child_nodes, NULL, 1),
    JS_CGETSET_MAGIC_DEF("firstElementChild", js_nd_element_link, NULL, 0),
    JS_CGETSET_MAGIC_DEF("lastElementChild", js_nd_element_link, NULL, 1),
    JS_CGETSET_DEF("childElementCount", js_nd_child_count, NULL),
    JS_CFUNC_MAGIC_DEF("querySelector", 1, js_nd_query, 0),
    JS_CFUNC_MAGIC_DEF("querySelectorAll", 1, js_nd_query, 1),
    JS_CFUNC_MAGIC_DEF("getElementById", 1, js_nd_get_elements, 0),
    JS_CFUNC_MAGIC_DEF("getElementsByTagName", 1, js_nd_get_elements, 1),
    JS_CFUNC_MAGIC_DEF("getElementsByClassName", 1, js_nd_get_elements, 2),
};

static const JSCFunctionListEntry nd_element_funcs[] = {
    JS_CGETSET_MAGIC_DEF("tagName", js_nd_tag, NULL, 1),
    JS_CGETSET_MAGIC_DEF("localName", js_nd_tag, NULL, 0),
    JS_CGETSET_MAGIC_DEF("nextElementSibling", js_nd_element_link, NULL, 2),
    JS_CGETSET_MAGIC_DEF("previousElementSibling", js_nd_element_link, NULL, 3),
    JS_CGETSET_DEF("innerHTML", js_nd_get_inner, js_nd_set_inner),
    JS_CGETSET_DEF("outerHTML", js_nd_get_outer, NULL),
    JS_CGETSET_DEF("content", js_nd_content, NULL),
    JS_CGETSET_MAGIC_DEF("id", js_nd_get_attr_prop, js_nd_set_attr_prop, 0),
    JS_CGETSET_MAGIC_DEF("className", js_nd_get_attr_prop, js_nd_set_attr_prop, 1),
    JS_CFUNC_DEF("getAttribute", 1, js_nd_get_attribute),
    JS_CFUNC_DEF("hasAttribute", 1, js_nd_has_attribute),
    JS_CFUNC_DEF("setAttribute", 2, js_nd_set_attribute),
    JS_CFUNC_DEF("removeAttribute", 1, js_nd_remove_attribute),
    JS_CFUNC_DEF("getAttributeNames", 0, js_nd_attribute_names),
    JS_CFUNC_DEF("hasAttributes", 0, js_nd_has_attributes),
    JS_CFUNC_DEF("matches", 1, js_nd_matches),
    JS_CFUNC_DEF("closest", 1, js_nd_closest),
};

static const JSCFunctionListEntry nd_document_funcs[] = {
    JS_CGETSET_MAGIC_DEF("documentElement", js_doc_element, NULL, 0),
    JS_CGETSET_MAGIC_DEF("head", js_doc_element, NULL, 1),
    JS_CGETSET_MAGIC_DEF("body", js_doc_element, NULL, 2),
    JS_CGETSET_MAGIC_DEF("doctype", js_doc_element, NULL, 3),
    JS_CFUNC_MAGIC_DEF("createElement", 1, js_doc_create, 0),
    JS_CFUNC_MAGIC_DEF("createTextNode", 1, js_doc_create, 1),
    JS_CFUNC_MAGIC_DEF("createComment", 1, js_doc_create, 2),
    JS_CFUNC_MAGIC_DEF("createDocumentFragment", 0, js_doc_create, 3),
    JS_CFUNC_DEF("importNode", 1, js_doc_import),
    JS_CFUNC_DEF("adoptNode", 1, js_doc_adopt),
};

static JSValue js_illegal_constructor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
    (void)this_val;
    (void)argc;
    (void)argv;
    return JS_ThrowTypeError(ctx, "Illegal constructor");
}

static JSValue nd_make_ctor(JSContext *c, const char *name, JSValueConst proto, JSValueConst parent_ctor) {
    JSValue ctor = JS_NewCFunction2(c, js_illegal_constructor, name, 0, JS_CFUNC_constructor, 0);
    JS_SetPropertyStr(c, ctor, "prototype", JS_DupValue(c, proto));
    JS_DefinePropertyValueStr(c, proto, "constructor", JS_DupValue(c, ctor), JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
    if (!JS_IsUndefined(parent_ctor)) JS_SetPrototype(c, ctor, parent_ctor);
    return ctor;
}

#define ND_LIST(proto, list) JS_SetPropertyFunctionList(c, proto, list, sizeof(list) / sizeof(list[0]))

static void nd_register(JSContext *c, JSValueConst native) {
    JSRuntime *rt = JS_GetRuntime(c);
    JS_NewClassID(rt, &nd_class_id);
    JSClassDef def = {"NativeNode", nd_finalizer, nd_mark, NULL, NULL};
    JS_NewClass(rt, nd_class_id, &def);

    JSValue pNode = JS_NewObject(c);
    ND_LIST(pNode, nd_node_funcs);
    JSValue pChar = JS_NewObjectProto(c, pNode);
    ND_LIST(pChar, nd_chardata_funcs);
    JSValue pText = JS_NewObjectProto(c, pChar);
    JSValue pComment = JS_NewObjectProto(c, pChar);
    JSValue pElement = JS_NewObjectProto(c, pNode);
    ND_LIST(pElement, nd_parent_funcs);
    ND_LIST(pElement, nd_element_funcs);
    JSValue pHtml = JS_NewObjectProto(c, pElement);
    JSValue pDocument = JS_NewObjectProto(c, pNode);
    ND_LIST(pDocument, nd_parent_funcs);
    ND_LIST(pDocument, nd_document_funcs);
    JSValue pFragment = JS_NewObjectProto(c, pNode);
    ND_LIST(pFragment, nd_parent_funcs);
    JSValue pDoctype = JS_NewObjectProto(c, pNode);

    nd_protos[NP_ELEMENT] = JS_DupValue(c, pHtml);
    nd_protos[NP_TEXT] = JS_DupValue(c, pText);
    nd_protos[NP_COMMENT] = JS_DupValue(c, pComment);
    nd_protos[NP_DOCUMENT] = JS_DupValue(c, pDocument);
    nd_protos[NP_FRAGMENT] = JS_DupValue(c, pFragment);
    nd_protos[NP_DOCTYPE] = JS_DupValue(c, pDoctype);

    JSValue dom = JS_NewObject(c);
    JSValue ctors = JS_NewObject(c);
    JSValue protos = JS_NewObject(c);
    JSValue cNode = nd_make_ctor(c, "Node", pNode, JS_UNDEFINED);
    static const struct { const char *name; int value; } consts[] = {
        {"ELEMENT_NODE", 1}, {"TEXT_NODE", 3}, {"COMMENT_NODE", 8}, {"DOCUMENT_NODE", 9}, {"DOCUMENT_TYPE_NODE", 10}, {"DOCUMENT_FRAGMENT_NODE", 11},
        {"DOCUMENT_POSITION_DISCONNECTED", 1}, {"DOCUMENT_POSITION_PRECEDING", 2}, {"DOCUMENT_POSITION_FOLLOWING", 4},
        {"DOCUMENT_POSITION_CONTAINS", 8}, {"DOCUMENT_POSITION_CONTAINED_BY", 16}, {"DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC", 32},
    };
    for (size_t i = 0; i < sizeof(consts) / sizeof(consts[0]); i++) {
        JS_SetPropertyStr(c, cNode, consts[i].name, JS_NewInt32(c, consts[i].value));
        JS_SetPropertyStr(c, pNode, consts[i].name, JS_NewInt32(c, consts[i].value));
    }
    JSValue cChar = nd_make_ctor(c, "CharacterData", pChar, cNode);
    JSValue cElement = nd_make_ctor(c, "Element", pElement, cNode);
    struct { const char *name; JSValue proto; JSValue parent; } rest[] = {
        {"Text", pText, cChar}, {"Comment", pComment, cChar}, {"HTMLElement", pHtml, cElement},
        {"Document", pDocument, cNode}, {"DocumentFragment", pFragment, cNode}, {"DocumentType", pDoctype, cNode},
    };
    JS_SetPropertyStr(c, ctors, "Node", cNode);
    JS_SetPropertyStr(c, ctors, "CharacterData", cChar);
    JS_SetPropertyStr(c, ctors, "Element", cElement);
    JS_SetPropertyStr(c, protos, "Node", JS_DupValue(c, pNode));
    JS_SetPropertyStr(c, protos, "CharacterData", JS_DupValue(c, pChar));
    JS_SetPropertyStr(c, protos, "Element", JS_DupValue(c, pElement));
    for (size_t i = 0; i < sizeof(rest) / sizeof(rest[0]); i++) {
        JS_SetPropertyStr(c, ctors, rest[i].name, nd_make_ctor(c, rest[i].name, rest[i].proto, rest[i].parent));
        JS_SetPropertyStr(c, protos, rest[i].name, JS_DupValue(c, rest[i].proto));
    }
    JS_SetPropertyStr(c, dom, "ctors", ctors);
    JS_SetPropertyStr(c, dom, "protos", protos);
    JS_SetPropertyStr(c, dom, "serialize", JS_NewCFunction(c, js_dom_serialize, "serialize", 1));
    JS_SetPropertyStr(c, dom, "markForeign", JS_NewCFunction(c, js_dom_mark_foreign, "markForeign", 1));
    JS_SetPropertyStr(c, dom, "setElementName", JS_NewCFunction(c, js_dom_set_element_name, "setElementName", 2));
    JS_SetPropertyStr(c, dom, "setTagProto", JS_NewCFunction(c, js_dom_set_tag_proto, "setTagProto", 2));
    JS_SetPropertyStr(c, dom, "version", JS_NewCFunction(c, js_dom_version, "version", 0));
    JS_SetPropertyStr(c, dom, "journalOn", JS_NewCFunction(c, js_dom_journal_on, "journalOn", 1));
    JS_SetPropertyStr(c, dom, "journalSync", JS_NewCFunction(c, js_dom_journal_sync, "journalSync", 0));
    JS_SetPropertyStr(c, dom, "journalOk", JS_NewCFunction(c, js_dom_journal_ok, "journalOk", 0));
    JS_SetPropertyStr(c, dom, "journalTake", JS_NewCFunction(c, js_dom_journal_take, "journalTake", 0));
    JS_SetPropertyStr(c, dom, "setQid", JS_NewCFunction(c, js_dom_set_qid, "setQid", 2));
    JS_SetPropertyStr(c, dom, "setState", JS_NewCFunction(c, js_dom_set_state, "setState", 2));
    JS_SetPropertyStr(c, dom, "following", JS_NewCFunction(c, js_dom_following, "following", 4));
    JS_SetPropertyStr(c, dom, "liveNodes", JS_NewCFunction(c, js_dom_live, "liveNodes", 0));
    JS_SetPropertyStr(c, dom, "gc", JS_NewCFunction(c, js_dom_gc, "gc", 0));
    JS_SetPropertyStr(c, dom, "createDocument", JS_NewCFunction(c, js_dom_create_document, "createDocument", 0));
    JS_SetPropertyStr(c, dom, "createXMLDocument", JS_NewCFunction(c, js_dom_create_xml_document, "createXMLDocument", 0));
    JS_SetPropertyStr(c, dom, "parse", JS_NewCFunction(c, js_dom_parse, "parse", 1));
    JS_SetPropertyStr(c, dom, "parseFragment", JS_NewCFunction(c, js_dom_parse_fragment, "parseFragment", 2));
    JS_SetPropertyStr(c, native, "dom", dom);
    JS_FreeValue(c, pNode);
    JS_FreeValue(c, pChar);
    JS_FreeValue(c, pText);
    JS_FreeValue(c, pComment);
    JS_FreeValue(c, pElement);
    JS_FreeValue(c, pHtml);
    JS_FreeValue(c, pDocument);
    JS_FreeValue(c, pFragment);
    JS_FreeValue(c, pDoctype);
}
