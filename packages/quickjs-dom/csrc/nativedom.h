/*
 * EXPERIMENT (phase 0 of the native DOM plan): a DOM tree whose nodes are QuickJS objects carrying a C struct, so that
 * parsing builds the tree without calling into JavaScript, and serializing and selecting walk C pointers.
 *
 * It is a prototype to measure against linkedom, not a replacement: the node types, properties and selector syntax are
 * the minimum that benchmark needs. Exposed as `__native.dom`.
 *
 * Included by qjsdom.c after htmlparse.h (it reuses the parser's events).
 */

typedef struct {
    char *name;
    int nlen;
    char *val;
    int vlen;
} NAttr;

typedef struct {
    uint8_t type; /* 1 element, 3 text, 8 comment, 9 document, 10 doctype, 11 document fragment */
    /* links are strong references: parent <-> child cycles are found by gc_mark below */
    JSValue parent, first, last, prev, next;
    JSValue owner;   /* the document that made the node (null for a document) */
    JSValue content; /* a template element's document fragment (made on first use) */
    char *tag; /* element: lower-case name; text, comment, doctype: the data */
    int taglen;
    NAttr *attrs;
    int nattrs, capAttrs;
} ND;

/* prototypes by kind of node, see nd_register() */
enum { NP_ELEMENT, NP_TEXT, NP_COMMENT, NP_DOCUMENT, NP_FRAGMENT, NP_DOCTYPE, NP_COUNT };

static JSClassID nd_class_id;
static long nd_live; /* nodes alive: tests check that dropped trees are really freed */
static JSValue nd_protos[NP_COUNT];

static ND *nd_of(JSValueConst v) { return (ND *)JS_GetOpaque(v, nd_class_id); }

static void nd_finalizer(JSRuntime *rt, JSValueConst val) {
    ND *n = (ND *)JS_GetOpaque(val, nd_class_id);
    if (!n) return;
    JS_FreeValueRT(rt, n->parent);
    JS_FreeValueRT(rt, n->first);
    JS_FreeValueRT(rt, n->last);
    JS_FreeValueRT(rt, n->prev);
    JS_FreeValueRT(rt, n->next);
    JS_FreeValueRT(rt, n->owner);
    JS_FreeValueRT(rt, n->content);
    free(n->tag);
    for (int i = 0; i < n->nattrs; i++) {
        free(n->attrs[i].name);
        free(n->attrs[i].val);
    }
    free(n->attrs);
    nd_live--;
    free(n);
}

static void nd_mark(JSRuntime *rt, JSValueConst val, JS_MarkFunc *mark_func) {
    ND *n = (ND *)JS_GetOpaque(val, nd_class_id);
    if (!n) return;
    JS_MarkValue(rt, n->parent, mark_func);
    JS_MarkValue(rt, n->first, mark_func);
    JS_MarkValue(rt, n->last, mark_func);
    JS_MarkValue(rt, n->prev, mark_func);
    JS_MarkValue(rt, n->next, mark_func);
    JS_MarkValue(rt, n->owner, mark_func);
    JS_MarkValue(rt, n->content, mark_func);
}

static char *nd_dup(const char *s, size_t len) {
    char *p = malloc(len + 1);
    if (!p) return NULL;
    if (len) memcpy(p, s, len);
    p[len] = 0;
    return p;
}

/* a node of `owner`'s document (a document passes null for itself) */
static JSValue nd_new(JSContext *c, JSValueConst owner, int type, const char *tag, size_t taglen, int lower) {
    int kind = type == 3 ? NP_TEXT : type == 8 ? NP_COMMENT : type == 9 ? NP_DOCUMENT : type == 10 ? NP_DOCTYPE : type == 11 ? NP_FRAGMENT : NP_ELEMENT;
    JSValue obj = JS_NewObjectProtoClass(c, nd_protos[kind], nd_class_id);
    if (JS_IsException(obj)) return obj;
    ND *n = calloc(1, sizeof(ND));
    if (!n) {
        JS_FreeValue(c, obj);
        return JS_ThrowOutOfMemory(c);
    }
    n->type = (uint8_t)type;
    nd_live++;
    n->parent = n->first = n->last = n->prev = n->next = n->content = JS_NULL;
    n->owner = type == 9 ? JS_NULL : JS_DupValue(c, owner);
    if (tag) {
        n->tag = nd_dup(tag, taglen);
        n->taglen = (int)taglen;
        if (lower) for (int i = 0; i < n->taglen; i++) if (n->tag[i] >= 'A' && n->tag[i] <= 'Z') n->tag[i] += 32;
    }
    JS_SetOpaque(obj, n);
    return obj;
}

static void nd_set_attr(ND *n, const char *name, size_t nlen, const char *val, size_t vlen) {
    for (int i = 0; i < n->nattrs; i++) {
        if ((size_t)n->attrs[i].nlen == nlen && memcmp(n->attrs[i].name, name, nlen) == 0) {
            free(n->attrs[i].val);
            n->attrs[i].val = nd_dup(val, vlen);
            n->attrs[i].vlen = (int)vlen;
            return;
        }
    }
    if (n->nattrs == n->capAttrs) {
        int cap = n->capAttrs ? n->capAttrs * 2 : 4;
        NAttr *a = realloc(n->attrs, sizeof(NAttr) * (size_t)cap);
        if (!a) return;
        n->attrs = a;
        n->capAttrs = cap;
    }
    NAttr *a = &n->attrs[n->nattrs++];
    a->name = nd_dup(name, nlen);
    a->nlen = (int)nlen;
    a->val = nd_dup(val, vlen);
    a->vlen = (int)vlen;
}

static NAttr *nd_find_attr(ND *n, const char *name, size_t nlen) {
    for (int i = 0; i < n->nattrs; i++)
        if ((size_t)n->attrs[i].nlen == nlen && memcmp(n->attrs[i].name, name, nlen) == 0) return &n->attrs[i];
    return NULL;
}

/* ---- tree edits ---- */

static void nd_unlink(JSContext *c, JSValueConst obj) {
    ND *n = nd_of(obj);
    if (JS_IsNull(n->parent)) return;
    ND *p = nd_of(n->parent);
    if (JS_IsNull(n->prev)) {
        JS_FreeValue(c, p->first);
        p->first = JS_DupValue(c, n->next);
    } else {
        ND *pr = nd_of(n->prev);
        JS_FreeValue(c, pr->next);
        pr->next = JS_DupValue(c, n->next);
    }
    if (JS_IsNull(n->next)) {
        JS_FreeValue(c, p->last);
        p->last = JS_DupValue(c, n->prev);
    } else {
        ND *nx = nd_of(n->next);
        JS_FreeValue(c, nx->prev);
        nx->prev = JS_DupValue(c, n->prev);
    }
    JS_FreeValue(c, n->parent);
    JS_FreeValue(c, n->prev);
    JS_FreeValue(c, n->next);
    n->parent = n->prev = n->next = JS_NULL;
}

/* insert `child` into `parent` before `ref` (null: at the end) */
static void nd_insert(JSContext *c, JSValueConst parent, JSValueConst child, JSValueConst ref) {
    ND *p = nd_of(parent), *ch = nd_of(child);
    nd_unlink(c, child);
    ch->parent = JS_DupValue(c, parent);
    if (JS_IsNull(ref) || JS_IsUndefined(ref)) {
        ch->prev = JS_DupValue(c, p->last);
        if (JS_IsNull(p->last)) p->first = JS_DupValue(c, child);
        else {
            ND *l = nd_of(p->last);
            JS_FreeValue(c, l->next);
            l->next = JS_DupValue(c, child);
        }
        JS_FreeValue(c, p->last);
        p->last = JS_DupValue(c, child);
    } else {
        ND *r = nd_of(ref);
        ch->next = JS_DupValue(c, ref);
        ch->prev = JS_DupValue(c, r->prev);
        if (JS_IsNull(r->prev)) {
            JS_FreeValue(c, p->first);
            p->first = JS_DupValue(c, child);
        } else {
            ND *pr = nd_of(r->prev);
            JS_FreeValue(c, pr->next);
            pr->next = JS_DupValue(c, child);
        }
        JS_FreeValue(c, r->prev);
        r->prev = JS_DupValue(c, child);
    }
}

/* ---- building a tree from the parser's events ---- */

static int nd_is_tag(ND *n, const char *tag, int len) { return n->type == 1 && n->taglen == len && memcmp(n->tag, tag, (size_t)len) == 0; }

/* a template's content: a fragment, made on first use */
static JSValue nd_content(JSContext *c, JSValueConst tmpl) {
    ND *t = nd_of(tmpl);
    if (JS_IsNull(t->content)) {
        JSValue f = nd_new(c, t->owner, 11, NULL, 0, 0);
        if (JS_IsException(f)) return f;
        t->content = f;
    }
    return t->content; /* borrowed: the template holds it */
}

static JSValue nd_build(JSContext *c, HP *p, JSValueConst root, JSValueConst owner) {
    size_t cap = 64, depth = 0;
    JSValue *stack = malloc(sizeof(JSValue) * cap);
    if (!stack) return JS_ThrowOutOfMemory(c);
    stack[depth++] = root; /* borrowed: every node on the stack is held by the tree under `root` */
    const int32_t *ev = p->ev.v;
    size_t n = p->ev.n;
    for (size_t i = 0; i < n;) {
        switch (ev[i]) {
        case EV_TEXT:
        case EV_COMMENT: {
            const uint8_t *s = (ev[i + 1] ? p->extra.p : p->s) + ev[i + 2];
            JSValue node = nd_new(c, owner, ev[i] == EV_TEXT ? 3 : 8, (const char *)s, (size_t)ev[i + 3], 0);
            if (JS_IsException(node)) { free(stack); return node; }
            nd_insert(c, stack[depth - 1], node, JS_NULL);
            JS_FreeValue(c, node);
            i += 4;
            break;
        }
        case EV_OPEN: {
            int nattrs = ev[i + 3];
            JSValue node = nd_new(c, owner, 1, (const char *)p->extra.p + ev[i + 1], (size_t)ev[i + 2], 0);
            if (JS_IsException(node)) { free(stack); return node; }
            ND *nn = nd_of(node);
            for (int k = 0; k < nattrs; k++) {
                const int32_t *a = &ev[i + 4 + k * 5];
                const uint8_t *vs = (a[2] ? p->extra.p : p->s) + a[3];
                nd_set_attr(nn, (const char *)p->s + a[0], (size_t)a[1], (const char *)vs, (size_t)a[4]);
            }
            nd_insert(c, stack[depth - 1], node, JS_NULL);
            if (depth == cap) {
                cap *= 2;
                JSValue *s = realloc(stack, sizeof(JSValue) * cap);
                if (!s) { JS_FreeValue(c, node); free(stack); return JS_ThrowOutOfMemory(c); }
                stack = s;
            }
            /* the children of a template go into its content */
            stack[depth++] = nd_is_tag(nn, "template", 8) ? nd_content(c, node) : node;
            JS_FreeValue(c, node); /* the parent holds it */
            i += 4 + (size_t)nattrs * 5;
            break;
        }
        case EV_CLOSE:
            if (depth > 1) depth--;
            i += 1;
            break;
        case EV_PI: {
            const char *name = (const char *)p->extra.p + ev[i + 1];
            if (ev[i + 2] == 8 && memcmp(name, "!doctype", 8) == 0) {
                const char *data = (const char *)p->extra.p + ev[i + 3];
                int dl = ev[i + 4];
                /* "!DOCTYPE html" -> data "DOCTYPE html" */
                JSValue node = nd_new(c, owner, 10, data + 1, (size_t)(dl - 1), 0);
                if (JS_IsException(node)) { free(stack); return node; }
                nd_insert(c, stack[depth - 1], node, JS_NULL);
                JS_FreeValue(c, node);
            }
            i += 5;
            break;
        }
        default:
            i = n;
        }
    }
    free(stack);
    return JS_UNDEFINED;
}

/* parse `markup` and append the result to `root` */
static JSValue nd_parse_into(JSContext *c, JSValueConst root, JSValueConst markup) {
    size_t len;
    const char *src = JS_ToCStringLen(c, &len, markup);
    if (!src) return JS_EXCEPTION;
    for (size_t i = 0; i + 1 < len; i++) {
        if ((uint8_t)src[i] == 0xED && ((uint8_t)src[i + 1] & 0xE0) == 0xA0) {
            JS_FreeCString(c, src);
            return JS_ThrowTypeError(c, "native DOM: lone surrogate");
        }
    }
    HP p;
    memset(&p, 0, sizeof(p));
    p.s = (const uint8_t *)src;
    p.len = (ptrdiff_t)len;
    p.state = S_Text;
    p.baseState = S_Text;
    h_foreign_push(&p, 0);
    h_run(&p);
    JSValue r;
    if (p.fail || p.bail) r = p.fail ? JS_ThrowOutOfMemory(c) : JS_ThrowTypeError(c, "native DOM: input declined by the parser");
    else {
        ND *rn = nd_of(root);
        r = nd_build(c, &p, root, rn->type == 9 ? root : rn->owner);
    }
    hp_free(&p);
    JS_FreeCString(c, src);
    return r;
}

/* ---- serializing ---- */

static void nd_escape(HBuf *b, const char *s, int len, int attr) {
    for (int i = 0; i < len; i++) {
        uint8_t ch = (uint8_t)s[i];
        if (attr) {
            if (ch == '"') hbuf_add(b, (const uint8_t *)"&quot;", 6);
            else hbuf_add(b, &ch, 1);
        } else if (ch == '&') hbuf_add(b, (const uint8_t *)"&amp;", 5);
        else if (ch == '<') hbuf_add(b, (const uint8_t *)"&lt;", 4);
        else if (ch == '>') hbuf_add(b, (const uint8_t *)"&gt;", 4);
        else if (ch == 0xC2 && i + 1 < len && (uint8_t)s[i + 1] == 0xA0) {
            hbuf_add(b, (const uint8_t *)"&#160;", 6);
            i++;
        } else hbuf_add(b, &ch, 1);
    }
}

/* the first child as serialization and innerHTML see it: a template shows its content */
static JSValue nd_children_of(ND *n) {
    if (nd_is_tag(n, "template", 8) && !JS_IsNull(n->content)) return nd_of(n->content)->first;
    return n->first;
}

static int nd_is_void(ND *n) { return h_in((const uint8_t *)n->tag, n->taglen, VOIDS, SETN(VOIDS)); }
static int nd_is_raw(ND *n) {
    static const HStr script = HS("script"), style = HS("style");
    return n->type == 1 && (h_is((const uint8_t *)n->tag, n->taglen, &script) || h_is((const uint8_t *)n->tag, n->taglen, &style));
}

static void nd_serialize(HBuf *b, JSValueConst obj, int raw) {
    ND *n = nd_of(obj);
    switch (n->type) {
    case 3:
        if (raw) hbuf_add(b, (const uint8_t *)n->tag, (size_t)n->taglen);
        else nd_escape(b, n->tag, n->taglen, 0);
        return;
    case 8:
        hbuf_add(b, (const uint8_t *)"<!--", 4);
        hbuf_add(b, (const uint8_t *)n->tag, (size_t)n->taglen);
        hbuf_add(b, (const uint8_t *)"-->", 3);
        return;
    case 10:
        hbuf_add(b, (const uint8_t *)"<!", 2);
        hbuf_add(b, (const uint8_t *)n->tag, (size_t)n->taglen);
        hbuf_add(b, (const uint8_t *)">", 1);
        return;
    case 1: {
        hbuf_add(b, (const uint8_t *)"<", 1);
        hbuf_add(b, (const uint8_t *)n->tag, (size_t)n->taglen);
        for (int i = 0; i < n->nattrs; i++) {
            hbuf_add(b, (const uint8_t *)" ", 1);
            hbuf_add(b, (const uint8_t *)n->attrs[i].name, (size_t)n->attrs[i].nlen);
            hbuf_add(b, (const uint8_t *)"=\"", 2);
            nd_escape(b, n->attrs[i].val, n->attrs[i].vlen, 1);
            hbuf_add(b, (const uint8_t *)"\"", 1);
        }
        hbuf_add(b, (const uint8_t *)">", 1);
        if (nd_is_void(n)) return;
        int childRaw = nd_is_raw(n);
        for (JSValue ch = nd_children_of(n); !JS_IsNull(ch); ch = nd_of(ch)->next) nd_serialize(b, ch, childRaw);
        hbuf_add(b, (const uint8_t *)"</", 2);
        hbuf_add(b, (const uint8_t *)n->tag, (size_t)n->taglen);
        hbuf_add(b, (const uint8_t *)">", 1);
        return;
    }
    default:
        for (JSValue ch = n->first; !JS_IsNull(ch); ch = nd_of(ch)->next) nd_serialize(b, ch, 0);
    }
}

static JSValue nd_serialize_children_str(JSContext *c, JSValueConst obj) {
    ND *n = nd_of(obj);
    HBuf b = {0};
    int raw = nd_is_raw(n);
    for (JSValue ch = nd_children_of(n); !JS_IsNull(ch); ch = nd_of(ch)->next) nd_serialize(&b, ch, raw);
    JSValue s = JS_NewStringLen(c, (const char *)b.p, b.n);
    free(b.p);
    return s;
}

/* ---- selectors: type, #id, .class, [attr], [attr=v] [attr^=v] [attr$=v] [attr*=v], descendant and child combinators, commas ---- */

typedef struct {
    char op;
    const char *name;
    int nlen;
    const char *val;
    int vlen;
} SAttr;

typedef struct {
    const char *tag;
    int taglen;
    const char *id;
    int idlen;
    const char *cls[4];
    int clslen[4];
    int ncls;
    SAttr attrs[4];
    int nattrs;
    char comb; /* how this compound relates to the previous one: ' ' or '>' */
} SComp;

typedef struct {
    SComp comps[8];
    int n;
} SComplex;

typedef struct {
    SComplex c[8];
    int n;
} SList;

static int sel_ident_char(int ch) { return h_alnum(ch) || ch == '-' || ch == '_' || ch >= 0x80; }

static int sel_parse(const char *s, size_t len, SList *out) {
    size_t i = 0;
    out->n = 0;
    while (i < len) {
        while (i < len && s[i] == ' ') i++;
        if (out->n == 8) return -1;
        SComplex *cx = &out->c[out->n++];
        cx->n = 0;
        char comb = 0;
        for (;;) {
            if (cx->n == 8) return -1;
            SComp *k = &cx->comps[cx->n++];
            memset(k, 0, sizeof(*k));
            k->comb = comb;
            int any = 0;
            if (i < len && s[i] == '*') { i++; any = 1; }
            else if (i < len && sel_ident_char((uint8_t)s[i])) {
                size_t st = i;
                while (i < len && sel_ident_char((uint8_t)s[i])) i++;
                k->tag = s + st;
                k->taglen = (int)(i - st);
                any = 1;
            }
            for (;;) {
                if (i < len && (s[i] == '#' || s[i] == '.')) {
                    char kind = s[i++];
                    size_t st = i;
                    while (i < len && sel_ident_char((uint8_t)s[i])) i++;
                    if (i == st) return -1;
                    if (kind == '#') { k->id = s + st; k->idlen = (int)(i - st); }
                    else {
                        if (k->ncls == 4) return -1;
                        k->cls[k->ncls] = s + st;
                        k->clslen[k->ncls++] = (int)(i - st);
                    }
                    any = 1;
                } else if (i < len && s[i] == '[') {
                    if (k->nattrs == 4) return -1;
                    SAttr *a = &k->attrs[k->nattrs++];
                    i++;
                    size_t st = i;
                    while (i < len && sel_ident_char((uint8_t)s[i])) i++;
                    a->name = s + st;
                    a->nlen = (int)(i - st);
                    if (a->nlen == 0 || i >= len) return -1;
                    if (s[i] == ']') { a->op = 0; i++; }
                    else {
                        char op = s[i];
                        if (op == '=') i++;
                        else if ((op == '^' || op == '$' || op == '*') && i + 1 < len && s[i + 1] == '=') i += 2;
                        else return -1;
                        a->op = op;
                        if (i < len && (s[i] == '"' || s[i] == '\'')) {
                            char q = s[i++];
                            size_t vs = i;
                            while (i < len && s[i] != q) i++;
                            if (i >= len) return -1;
                            a->val = s + vs;
                            a->vlen = (int)(i - vs);
                            i++;
                        } else {
                            size_t vs = i;
                            while (i < len && s[i] != ']') i++;
                            a->val = s + vs;
                            a->vlen = (int)(i - vs);
                        }
                        if (i >= len || s[i] != ']') return -1;
                        i++;
                    }
                    any = 1;
                } else break;
            }
            if (!any) return -1;
            size_t j = i;
            while (j < len && s[j] == ' ') j++;
            if (j < len && s[j] == '>') {
                comb = '>';
                i = j + 1;
                while (i < len && s[i] == ' ') i++;
            } else if (j < len && s[j] != ',' && j > i) {
                comb = ' ';
                i = j;
            } else {
                i = j;
                break;
            }
        }
        if (i < len) {
            if (s[i] != ',') return -1;
            i++;
        }
    }
    return out->n > 0 ? 0 : -1;
}

static int sel_class_has(ND *n, const char *cls, int clen) {
    NAttr *a = nd_find_attr(n, "class", 5);
    if (!a) return 0;
    int i = 0;
    while (i < a->vlen) {
        while (i < a->vlen && h_ws((uint8_t)a->val[i])) i++;
        int st = i;
        while (i < a->vlen && !h_ws((uint8_t)a->val[i])) i++;
        if (i - st == clen && memcmp(a->val + st, cls, (size_t)clen) == 0) return 1;
    }
    return 0;
}

static int sel_compound(ND *n, const SComp *k) {
    if (n->type != 1) return 0;
    if (k->taglen && !(n->taglen == k->taglen && memcmp(n->tag, k->tag, (size_t)k->taglen) == 0)) return 0;
    if (k->idlen) {
        NAttr *a = nd_find_attr(n, "id", 2);
        if (!a || a->vlen != k->idlen || memcmp(a->val, k->id, (size_t)k->idlen) != 0) return 0;
    }
    for (int i = 0; i < k->ncls; i++) if (!sel_class_has(n, k->cls[i], k->clslen[i])) return 0;
    for (int i = 0; i < k->nattrs; i++) {
        const SAttr *sa = &k->attrs[i];
        NAttr *a = nd_find_attr(n, sa->name, (size_t)sa->nlen);
        if (!a) return 0;
        if (sa->op == 0) continue;
        if (sa->op == '=' && !(a->vlen == sa->vlen && memcmp(a->val, sa->val, (size_t)sa->vlen) == 0)) return 0;
        if (sa->op == '^' && !(a->vlen >= sa->vlen && memcmp(a->val, sa->val, (size_t)sa->vlen) == 0)) return 0;
        if (sa->op == '$' && !(a->vlen >= sa->vlen && memcmp(a->val + a->vlen - sa->vlen, sa->val, (size_t)sa->vlen) == 0)) return 0;
        if (sa->op == '*') {
            int found = 0;
            for (int j = 0; j + sa->vlen <= a->vlen && !found; j++) found = memcmp(a->val + j, sa->val, (size_t)sa->vlen) == 0;
            if (!found) return 0;
        }
    }
    return 1;
}

static int sel_match_from(ND *n, const SComplex *cx, int idx) {
    if (!sel_compound(n, &cx->comps[idx])) return 0;
    if (idx == 0) return 1;
    char comb = cx->comps[idx].comb;
    JSValue p = n->parent;
    while (!JS_IsNull(p)) {
        ND *pn = nd_of(p);
        if (sel_match_from(pn, cx, idx - 1)) return 1;
        if (comb == '>') return 0;
        p = pn->parent;
    }
    return 0;
}

static int sel_match(ND *n, const SList *l) {
    for (int i = 0; i < l->n; i++) if (sel_match_from(n, &l->c[i], l->c[i].n - 1)) return 1;
    return 0;
}

/* document-order walk below `root`; `all` collects every match into an array, otherwise the first is returned */
static JSValue sel_query(JSContext *c, JSValueConst root, JSValueConst selector, int all) {
    size_t len;
    const char *s = JS_ToCStringLen(c, &len, selector);
    if (!s) return JS_EXCEPTION;
    SList list;
    if (sel_parse(s, len, &list) != 0) {
        JSValue e = JS_ThrowSyntaxError(c, "native DOM: unsupported selector: %s", s);
        JS_FreeCString(c, s);
        return e;
    }
    JSValue result = all ? JS_NewArray(c) : JS_NULL;
    uint32_t count = 0;
    JSValue cur = nd_of(root)->first;
    while (!JS_IsNull(cur)) {
        ND *n = nd_of(cur);
        if (n->type == 1 && sel_match(n, &list)) {
            if (all) JS_SetPropertyUint32(c, result, count++, JS_DupValue(c, cur));
            else { result = JS_DupValue(c, cur); break; }
        }
        if (!JS_IsNull(n->first)) cur = n->first;
        else {
            while (JS_IsNull(nd_of(cur)->next)) {
                cur = nd_of(cur)->parent;
                if (JS_IsNull(cur) || JS_VALUE_GET_PTR(cur) == JS_VALUE_GET_PTR(root)) { cur = JS_NULL; break; }
            }
            if (!JS_IsNull(cur)) cur = nd_of(cur)->next;
        }
    }
    JS_FreeCString(c, s);
    return result;
}

/* the JS surface of the nodes: csrc/nativedom_api.h */
#include "nativedom_api.h"
