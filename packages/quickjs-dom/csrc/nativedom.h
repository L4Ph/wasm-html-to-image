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
    uint8_t xml;  /* a document made as an XML document: its createElement keeps the name's case */
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
static long nd_version; /* bumped by every change to a tree or an attribute: live collections re-read when it moves */
static long nd_live; /* nodes alive: tests check that dropped trees are really freed */
static JSValue nd_protos[NP_COUNT];
/* prototypes of the elements with a class of their own (HTMLInputElement for input, ...), registered by nativedom.js */
static struct { char tag[16]; int len; JSValue proto; } nd_tag_protos[96];
static int nd_ntag_protos;

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
    if (type == 1 && n->tag) {
        for (int i = 0; i < nd_ntag_protos; i++) {
            if (nd_tag_protos[i].len != n->taglen) continue;
            /* case-insensitive: the registered names are lower-case, an SVG element's adjusted
               name is not (foreignObject still gets the foreignObject class) */
            int same = 1;
            for (int k = 0; k < n->taglen; k++) {
                char a = nd_tag_protos[i].tag[k], b = n->tag[k];
                if (a >= 'A' && a <= 'Z') a += 32;
                if (b >= 'A' && b <= 'Z') b += 32;
                if (a != b) { same = 0; break; }
            }
            if (same) {
                JS_SetPrototype(c, obj, nd_tag_protos[i].proto);
                break;
            }
        }
    }
    return obj;
}

static void nd_set_attr(ND *n, const char *name, size_t nlen, const char *val, size_t vlen) {
    nd_version++;
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
    nd_version++;
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
    nd_version++;
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

/* ---- building a tree from the parser's events ----
 *
 * The stack builder below started as a mirror of the parser's own stack (an open pushes, a close
 * pops), which produces htmlparser2's tree. Three pieces of the HTML standard's tree construction
 * are layered on it here, because real pages (and jsdom, the reference) rely on them:
 *
 *  - table fixups: a row straight under a table gets the implied <tbody> (cells get a row too),
 *    and content that cannot live in a table is foster-parented — moved before the table, the
 *    way the spec's "in table" rules place it — instead of staying nested inside it;
 *  - the adoption agency, in its simplified form: a list of active formatting elements is kept,
 *    an element closed by something else's end tag (or an implied close) stays on the list, and
 *    following content is wrapped in clones of the ones still open in spirit ("reconstructing"
 *    them) — so <b><i>x</b>y parses as in a browser. The full algorithm's furthest-block shuffle
 *    is not attempted; the cases it changes beyond this model are rare and recorded in the
 *    parity ledger;
 *  - foreign content: inside <svg>, tag names take the standard's adjusted spelling
 *    (foreignObject, not foreignobject).
 *
 * The parser's closes carry the tag whose processing closed the element, which is what lets the
 * builder tell an element's own end tag (it leaves the active list) from an ancestor's (it stays
 * on it). Builder-only elements (implied wrappers, reconstruction clones) are marked untracked:
 * a close pops open elements until it has popped one the parser also had.
 */

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

typedef struct {
    JSValue node;   /* the open element; a template's content fragment stands in for the template */
    char tag[40];   /* the name a close matches: the adjusted tag name, "template" for its content */
    int taglen;
    int ctx;        /* the context inside this element: 0 HTML, 1 SVG, 2 MathML */
    int tracked;    /* the parser has this element on its own stack too */
    int afe;        /* this element's slot in the active formatting list, or -1 */
    int marker;     /* the slot of the marker this element opened in that list, or -1 */
} BEnt;

typedef struct {
    JSValue orig;   /* the element as opened (a reconstruction clones it, attributes included) */
    char tag[40];
    int taglen;
    int open;       /* the element, or its latest reconstruction, is on the stack */
    int marker;
} AEnt;

typedef struct {
    JSContext *c;
    JSValueConst owner;
    BEnt *st;
    size_t depth, cap;
    AEnt *afe;
    size_t nafe, acap;
    int oom;
} Bld;

static int bld_tag_is(BEnt *e, const char *tag, int len) { return e->taglen == len && memcmp(e->tag, tag, (size_t)len) == 0; }
static int bld_top_is(Bld *b, const char *tag, int len) { return b->depth > 0 && bld_tag_is(&b->st[b->depth - 1], tag, len); }
static int bld_top_tableish(Bld *b) {
    if (!b->depth) return 0;
    BEnt *t = &b->st[b->depth - 1];
    return bld_tag_is(t, "table", 5) || bld_tag_is(t, "tbody", 5) || bld_tag_is(t, "thead", 5) || bld_tag_is(t, "tfoot", 5) || bld_tag_is(t, "tr", 2);
}

static int bld_push(Bld *b, JSValue node, const char *tag, int taglen, int ctx, int tracked) {
    if (b->depth == b->cap) {
        size_t cap = b->cap ? b->cap * 2 : 64;
        BEnt *s = realloc(b->st, sizeof(BEnt) * cap);
        if (!s) { b->oom = 1; return -1; }
        b->st = s;
        b->cap = cap;
    }
    BEnt *e = &b->st[b->depth];
    e->node = node;
    e->taglen = taglen < 39 ? taglen : 39;
    memcpy(e->tag, tag, (size_t)e->taglen);
    e->tag[e->taglen] = 0;
    e->ctx = ctx;
    e->tracked = tracked;
    e->afe = -1;
    e->marker = -1;
    return (int)b->depth++;
}

static int afe_add(Bld *b, JSValue orig, const char *tag, int taglen, int marker) {
    if (b->nafe == b->acap) {
        size_t cap = b->acap ? b->acap * 2 : 32;
        AEnt *a = realloc(b->afe, sizeof(AEnt) * cap);
        if (!a) { b->oom = 1; return -1; }
        b->afe = a;
        b->acap = cap;
    }
    AEnt *e = &b->afe[b->nafe];
    e->orig = orig;
    e->taglen = taglen < 39 ? taglen : 39;
    memcpy(e->tag, tag, (size_t)e->taglen);
    e->tag[e->taglen] = 0;
    e->open = 0;
    e->marker = marker;
    return (int)b->nafe++;
}

/* removing a list entry shifts the later ones; the stack entries pointing at them follow */
static void afe_remove(Bld *b, int idx) {
    if (idx < 0 || (size_t)idx >= b->nafe) return;
    memmove(&b->afe[idx], &b->afe[idx + 1], (b->nafe - (size_t)idx - 1) * sizeof(AEnt));
    b->nafe--;
    for (size_t i = 0; i < b->depth; i++) {
        if (b->st[i].afe == idx) b->st[i].afe = -1;
        else if (b->st[i].afe > idx) b->st[i].afe--;
        if (b->st[i].marker == idx) b->st[i].marker = -1;
        else if (b->st[i].marker > idx) b->st[i].marker--;
    }
}

static int afe_last_marker(Bld *b) {
    for (int i = (int)b->nafe - 1; i >= 0; i--) if (b->afe[i].marker) return i;
    return -1;
}

/* pop the top stack entry: a formatting element that was on the list stays on it, closed for now */
static void bld_pop_one(Bld *b) {
    BEnt *e = &b->st[b->depth - 1];
    if (e->afe >= 0 && (size_t)e->afe < b->nafe) b->afe[e->afe].open = 0;
    b->depth--;
    if (e->marker >= 0) {
        /* the scope this element opened ends: its list entries, and the marker, go */
        int m = e->marker;
        while (b->nafe > (size_t)m) afe_remove(b, (int)b->nafe - 1);
    }
}

/* pop from the top through stack position `idx` (inclusive). The target's own end tag
 * (src == its tag) takes it off the active list; anything else leaves it there. */
static void bld_pop_through(Bld *b, int idx, const char *src, int srclen) {
    while (b->depth > (size_t)idx) {
        BEnt *e = &b->st[b->depth - 1];
        int isTarget = (int)(b->depth - 1) == idx;
        if (isTarget && e->afe >= 0 && srclen == e->taglen && memcmp(src, e->tag, (size_t)srclen) == 0) {
            int slot = e->afe;
            e->afe = -1;
            bld_pop_one(b);
            afe_remove(b, slot);
        } else bld_pop_one(b);
    }
}

/* wrap what follows in clones of the active formatting elements that are closed but listed */
static void bld_reconstruct(Bld *b) {
    if (!b->depth || b->st[b->depth - 1].ctx != 0 || bld_top_tableish(b)) return;
    int start = afe_last_marker(b) + 1;
    for (size_t i = (size_t)start; i < b->nafe; i++) {
        if (b->afe[i].marker || b->afe[i].open) continue;
        AEnt *a = &b->afe[i];
        JSValue clone = nd_new(b->c, b->owner, 1, a->tag, (size_t)a->taglen, 0);
        if (JS_IsException(clone)) { b->oom = 1; return; }
        ND *cn = nd_of(clone), *on = nd_of(a->orig);
        if (on) for (int k = 0; k < on->nattrs; k++) nd_set_attr(cn, on->attrs[k].name, (size_t)on->attrs[k].nlen, on->attrs[k].val, (size_t)on->attrs[k].vlen);
        nd_insert(b->c, b->st[b->depth - 1].node, clone, JS_NULL);
        int slot = bld_push(b, clone, a->tag, a->taglen, 0, 0);
        JS_FreeValue(b->c, clone);
        if (slot < 0) return;
        b->st[slot].afe = (int)i;
        b->afe[i].open = 1;
    }
}

static int bld_nearest_table(Bld *b) {
    for (int i = (int)b->depth - 1; i >= 1; i--) if (bld_tag_is(&b->st[i], "table", 5)) return i;
    return -1;
}

/* insert before the nearest open table, in the table's parent (the table's parent holds it) */
static void bld_foster_insert(Bld *b, JSValue node) {
    int t = bld_nearest_table(b);
    if (t < 0) { nd_insert(b->c, b->st[b->depth - 1].node, node, JS_NULL); return; }
    JSValue table = b->st[t].node;
    ND *tn = nd_of(table);
    if (JS_IsNull(tn->parent)) { nd_insert(b->c, b->st[b->depth - 1].node, node, JS_NULL); return; }
    nd_insert(b->c, tn->parent, node, table);
}

/* the standard's adjusted tag names for SVG elements (the parser lower-cases everything) */
static const char *svg_adjust(const char *name, int len, int *outlen) {
    static const struct { const char *from, *to; } ADJ[] = {
        {"altglyph", "altGlyph"}, {"altglyphdef", "altGlyphDef"}, {"altglyphitem", "altGlyphItem"},
        {"animatecolor", "animateColor"}, {"animatemotion", "animateMotion"}, {"animatetransform", "animateTransform"},
        {"clippath", "clipPath"}, {"feblend", "feBlend"}, {"fecolormatrix", "feColorMatrix"},
        {"fecomponenttransfer", "feComponentTransfer"}, {"fecomposite", "feComposite"}, {"feconvolvematrix", "feConvolveMatrix"},
        {"fediffuselighting", "feDiffuseLighting"}, {"fedisplacementmap", "feDisplacementMap"}, {"fedistantlight", "feDistantLight"},
        {"fedropshadow", "feDropShadow"}, {"feflood", "feFlood"}, {"fefunca", "feFuncA"}, {"fefuncb", "feFuncB"},
        {"fefuncg", "feFuncG"}, {"fefuncr", "feFuncR"}, {"fegaussianblur", "feGaussianBlur"}, {"feimage", "feImage"},
        {"femerge", "feMerge"}, {"femergenode", "feMergeNode"}, {"femorphology", "feMorphology"}, {"feoffset", "feOffset"},
        {"fepointlight", "fePointLight"}, {"fespecularlighting", "feSpecularLighting"}, {"fespotlight", "feSpotLight"},
        {"fetile", "feTile"}, {"feturbulence", "feTurbulence"}, {"foreignobject", "foreignObject"},
        {"glyphref", "glyphRef"}, {"lineargradient", "linearGradient"}, {"radialgradient", "radialGradient"},
        {"textpath", "textPath"},
    };
    for (size_t i = 0; i < sizeof(ADJ) / sizeof(ADJ[0]); i++) {
        size_t fl = strlen(ADJ[i].from);
        if ((int)fl == len && memcmp(name, ADJ[i].from, fl) == 0) { *outlen = (int)strlen(ADJ[i].to); return ADJ[i].to; }
    }
    *outlen = len;
    return name;
}

static int name_in(const char *name, int len, const char *const *set, int n) {
    for (int i = 0; i < n; i++) {
        size_t l = strlen(set[i]);
        if ((int)l == len && memcmp(name, set[i], l) == 0) return 1;
    }
    return 0;
}

/* start tags that are inserted without reconstructing the active formatting elements first:
 * the block-level and table/head machinery of the standard, whose rules do their own work */
static int bld_no_reconstruct(const char *name, int len) {
    static const char *const SET[] = {
        "address", "applet", "article", "aside", "base", "blockquote", "body", "button", "caption", "center", "col", "colgroup",
        "dd", "details", "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "frame",
        "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "iframe", "li", "link",
        "main", "marquee", "menu", "meta", "nav", "object", "ol", "option", "optgroup", "p", "pre", "script", "section",
        "select", "style", "summary", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "title", "tr", "ul",
    };
    return name_in(name, len, SET, (int)(sizeof(SET) / sizeof(SET[0])));
}

static JSValue nd_build(JSContext *c, HP *p, JSValueConst root, JSValueConst owner) {
    Bld b;
    memset(&b, 0, sizeof(b));
    b.c = c;
    b.owner = owner;
    /* a fragment build (innerHTML, parseFragment) has no html/body of its own to make */
    int fragment = nd_of(root)->type != 9;
    {
        ND *rn = nd_of(root);
        const char *rt = rn->tag ? rn->tag : "";
        bld_push(&b, root, rt, rn->tag ? rn->taglen : 0, 0, 1);
    }
    const int32_t *ev = p->ev.v;
    size_t n = p->ev.n;
    for (size_t i = 0; i < n && !b.oom;) {
        switch (ev[i]) {
        case EV_TEXT:
        case EV_COMMENT: {
            const uint8_t *s = (ev[i + 1] ? p->extra.p : p->s) + ev[i + 2];
            size_t len = (size_t)ev[i + 3];
            BEnt *top = &b.st[b.depth - 1];
            if (ev[i] == EV_TEXT && top->ctx == 0) {
                int nonspace = 0;
                for (size_t k = 0; k < len; k++) if (s[k] != ' ' && s[k] != '\t' && s[k] != '\n' && s[k] != '\f' && s[k] != '\r') { nonspace = 1; break; }
                if (nonspace && bld_top_tableish(&b) && bld_nearest_table(&b) >= 0) {
                    /* foster-parented text: it joins a text node before the table when there is one */
                    JSValue table = b.st[bld_nearest_table(&b)].node;
                    ND *tn = nd_of(table);
                    ND *prev = !JS_IsNull(tn->prev) ? nd_of(tn->prev) : NULL;
                    if (prev && prev->type == 3 && !JS_IsNull(tn->parent)) {
                        char *grown = realloc(prev->tag, (size_t)prev->taglen + len + 1);
                        if (!grown) { b.oom = 1; break; }
                        memcpy(grown + prev->taglen, s, len);
                        prev->taglen += (int)len;
                        grown[prev->taglen] = 0;
                        prev->tag = grown;
                        nd_version++;
                        i += 4;
                        break;
                    }
                    JSValue node = nd_new(c, owner, 3, (const char *)s, len, 0);
                    if (JS_IsException(node)) { free(b.st); free(b.afe); return node; }
                    bld_foster_insert(&b, node);
                    JS_FreeValue(c, node);
                    i += 4;
                    break;
                }
                if (!bld_top_tableish(&b)) bld_reconstruct(&b);
                top = &b.st[b.depth - 1];
            }
            if (ev[i] == EV_TEXT) {
                /* the parser splits text at a character reference; a tree has one text node there, as in a browser */
                ND *last = nd_of(top->node);
                ND *prev = last && !JS_IsNull(last->last) ? nd_of(last->last) : NULL;
                if (prev && prev->type == 3) {
                    char *grown = realloc(prev->tag, (size_t)prev->taglen + len + 1);
                    if (!grown) { b.oom = 1; break; }
                    memcpy(grown + prev->taglen, s, len);
                    prev->taglen += (int)len;
                    grown[prev->taglen] = 0;
                    prev->tag = grown;
                    nd_version++;
                    i += 4;
                    break;
                }
            }
            JSValue node = nd_new(c, owner, ev[i] == EV_TEXT ? 3 : 8, (const char *)s, len, 0);
            if (JS_IsException(node)) { free(b.st); free(b.afe); return node; }
            nd_insert(c, top->node, node, JS_NULL);
            JS_FreeValue(c, node);
            i += 4;
            break;
        }
        case EV_OPEN: {
            int nattrs = ev[i + 3];
            const char *rawname = (const char *)p->extra.p + ev[i + 1];
            int rawlen = ev[i + 2];
            /* in a fragment an <html> or <body> start tag makes no element: the standard
               ignores the token and its content flows into the context */
            if (fragment && rawlen == 4 && (memcmp(rawname, "html", 4) == 0 || memcmp(rawname, "body", 4) == 0)) {
                i += 4 + (size_t)nattrs * 5;
                break;
            }
            BEnt *parent = &b.st[b.depth - 1];
            int parentCtx = parent->ctx;
            int isSvgRoot = rawlen == 3 && memcmp(rawname, "svg", 3) == 0;
            int isMathRoot = rawlen == 4 && memcmp(rawname, "math", 4) == 0;
            const char *name = rawname;
            int namelen = rawlen;
            if (parentCtx == 1) name = svg_adjust(rawname, rawlen, &namelen);
            int foreign = parentCtx != 0 || isSvgRoot || isMathRoot;
            /* the adoption agency's one start-tag rule: a new <a> first closes the listed one */
            if (parentCtx == 0 && rawlen == 1 && rawname[0] == 'a') {
                int start = afe_last_marker(&b) + 1;
                for (int k = (int)b.nafe - 1; k >= start; k--) {
                    if (b.afe[k].marker || b.afe[k].taglen != 1 || b.afe[k].tag[0] != 'a') continue;
                    if (b.afe[k].open) {
                        for (int d = (int)b.depth - 1; d >= 1; d--) if (b.st[d].afe == k) { bld_pop_through(&b, d, "a", 1); break; }
                    } else afe_remove(&b, k);
                    break;
                }
                parent = &b.st[b.depth - 1];
            }
            if (parentCtx == 0 && !bld_no_reconstruct(rawname, rawlen)) bld_reconstruct(&b);
            /* table fixups: implied sections and rows, then foster parenting */
            int foster = 0;
            if (parentCtx == 0) {
                if ((rawlen == 2 && memcmp(rawname, "tr", 2) == 0) && bld_top_is(&b, "table", 5)) {
                    JSValue tbody = nd_new(c, owner, 1, "tbody", 5, 0);
                    if (JS_IsException(tbody)) { free(b.st); free(b.afe); return tbody; }
                    nd_insert(c, b.st[b.depth - 1].node, tbody, JS_NULL);
                    bld_push(&b, tbody, "tbody", 5, 0, 0);
                    JS_FreeValue(c, tbody);
                } else if ((rawlen == 2 && (memcmp(rawname, "td", 2) == 0 || memcmp(rawname, "th", 2) == 0)) &&
                           (bld_top_is(&b, "table", 5) || bld_top_is(&b, "tbody", 5) || bld_top_is(&b, "thead", 5) || bld_top_is(&b, "tfoot", 5))) {
                    if (bld_top_is(&b, "table", 5)) {
                        JSValue tbody = nd_new(c, owner, 1, "tbody", 5, 0);
                        if (JS_IsException(tbody)) { free(b.st); free(b.afe); return tbody; }
                        nd_insert(c, b.st[b.depth - 1].node, tbody, JS_NULL);
                        bld_push(&b, tbody, "tbody", 5, 0, 0);
                        JS_FreeValue(c, tbody);
                    }
                    JSValue tr = nd_new(c, owner, 1, "tr", 2, 0);
                    if (JS_IsException(tr)) { free(b.st); free(b.afe); return tr; }
                    nd_insert(c, b.st[b.depth - 1].node, tr, JS_NULL);
                    bld_push(&b, tr, "tr", 2, 0, 0);
                    JS_FreeValue(c, tr);
                }
                if (bld_top_tableish(&b)) {
                    static const char *const IN_TABLE[] = {"caption", "colgroup", "form", "script", "style", "table", "tbody", "template", "tfoot", "thead", "tr"};
                    static const char *const IN_SECTION[] = {"script", "style", "template", "tr"};
                    static const char *const IN_ROW[] = {"script", "style", "td", "template", "th"};
                    const char *const *set = IN_TABLE;
                    int nset = (int)(sizeof(IN_TABLE) / sizeof(IN_TABLE[0]));
                    if (bld_top_is(&b, "tbody", 5) || bld_top_is(&b, "thead", 5) || bld_top_is(&b, "tfoot", 5)) { set = IN_SECTION; nset = (int)(sizeof(IN_SECTION) / sizeof(IN_SECTION[0])); }
                    else if (bld_top_is(&b, "tr", 2)) { set = IN_ROW; nset = (int)(sizeof(IN_ROW) / sizeof(IN_ROW[0])); }
                    if (!name_in(rawname, rawlen, set, nset) && bld_nearest_table(&b) >= 0) foster = 1;
                }
            }
            JSValue node = nd_new(c, owner, 1, name, (size_t)namelen, 0);
            if (JS_IsException(node)) { free(b.st); free(b.afe); return node; }
            ND *nn = nd_of(node);
            /* HTML attribute names are lower case (onClick is onclick); inside <svg> and <math> they keep their case (viewBox) */
            int fold = !foreign;
            for (int k = 0; k < nattrs; k++) {
                const int32_t *a = &ev[i + 4 + k * 5];
                const uint8_t *vs = (a[2] ? p->extra.p : p->s) + a[3];
                const char *an = (const char *)p->s + a[0];
                char low[128];
                if (fold && a[1] < (int32_t)sizeof(low)) {
                    for (int q = 0; q < a[1]; q++) low[q] = (an[q] >= 'A' && an[q] <= 'Z') ? (char)(an[q] + 32) : an[q];
                    an = low;
                }
                nd_set_attr(nn, an, (size_t)a[1], (const char *)vs, (size_t)a[4]);
            }
            if (foster) bld_foster_insert(&b, node);
            else nd_insert(c, b.st[b.depth - 1].node, node, JS_NULL);
            /* the context this element's children live in */
            static const char *const INTEG[] = {"annotation-xml", "desc", "foreignobject", "mi", "mn", "mo", "ms", "mtext", "title"};
            int childCtx;
            if (isSvgRoot) childCtx = 1;
            else if (isMathRoot) childCtx = 2;
            else if (parentCtx != 0 && name_in(rawname, rawlen, INTEG, (int)(sizeof(INTEG) / sizeof(INTEG[0])))) childCtx = 0;
            else childCtx = parentCtx;
            int isTemplate = rawlen == 8 && memcmp(rawname, "template", 8) == 0;
            JSValue stackNode = node;
            if (isTemplate) {
                /* the children of a template go into its content */
                stackNode = nd_content(c, node);
                if (JS_IsException(stackNode)) { JS_FreeValue(c, node); free(b.st); free(b.afe); return stackNode; }
            }
            int slot = bld_push(&b, stackNode, isTemplate ? "template" : name, isTemplate ? 8 : namelen, childCtx, 1);
            JS_FreeValue(c, node); /* the parent (or the template) holds it */
            if (slot >= 0 && !foreign) {
                if (h_is_formatting((const uint8_t *)rawname, rawlen)) {
                    int ai = afe_add(&b, node, name, namelen, 0);
                    if (ai >= 0) { b.st[slot].afe = ai; b.afe[ai].open = 1; }
                } else if (name_in(rawname, rawlen, (const char *const []){"applet", "caption", "html", "marquee", "object", "table", "td", "th", "template"}, 9)) {
                    int mi = afe_add(&b, JS_NULL, "", 0, 1);
                    if (mi >= 0) b.st[slot].marker = mi;
                }
            }
            i += 4 + (size_t)nattrs * 5;
            break;
        }
        case EV_CLOSE: {
            const char *src = (const char *)p->extra.p + ev[i + 1];
            int srclen = ev[i + 2];
            /* the close of a fragment's skipped <html>/<body> matches nothing here either */
            if (fragment && srclen == 4 && (memcmp(src, "html", 4) == 0 || memcmp(src, "body", 4) == 0)) {
                i += 3;
                break;
            }
            /* one parser element closes: pop until one tracked element has been popped,
               sweeping builder-only elements (implied wrappers, reconstructions) with it */
            int popped = 0;
            while (b.depth > 1) {
                BEnt *e = &b.st[b.depth - 1];
                int wasTracked = e->tracked;
                if (wasTracked && e->afe >= 0) {
                    /* the parser closes tracked elements in its own stack order; this entry is
                       the one being closed when it is the topmost tracked */
                    bld_pop_through(&b, (int)(b.depth - 1), src, srclen);
                } else bld_pop_one(&b);
                popped = 1;
                if (wasTracked) break;
            }
            if (!popped && b.depth > 1) bld_pop_one(&b);
            i += 3;
            break;
        }
        case EV_STRAY: {
            const char *name = (const char *)p->extra.p + ev[i + 1];
            int namelen = ev[i + 2];
            int start = afe_last_marker(&b) + 1;
            for (int k = (int)b.nafe - 1; k >= start; k--) {
                if (b.afe[k].marker || b.afe[k].taglen != namelen || memcmp(b.afe[k].tag, name, (size_t)namelen) != 0) continue;
                if (b.afe[k].open) {
                    for (int d = (int)b.depth - 1; d >= 1; d--) if (b.st[d].afe == k) { bld_pop_through(&b, d, name, namelen); break; }
                } else afe_remove(&b, k);
                break;
            }
            i += 3;
            break;
        }
        case EV_PI: {
            const char *name = (const char *)p->extra.p + ev[i + 1];
            if (ev[i + 2] == 8 && memcmp(name, "!doctype", 8) == 0) {
                const char *data = (const char *)p->extra.p + ev[i + 3];
                int dl = ev[i + 4];
                /* "!DOCTYPE html" -> data "DOCTYPE html" */
                JSValue node = nd_new(c, owner, 10, data + 1, (size_t)(dl - 1), 0);
                if (JS_IsException(node)) { free(b.st); free(b.afe); return node; }
                nd_insert(c, b.st[b.depth - 1].node, node, JS_NULL);
                JS_FreeValue(c, node);
            }
            i += 5;
            break;
        }
        default:
            i = n;
        }
    }
    free(b.st);
    free(b.afe);
    if (b.oom) return JS_ThrowOutOfMemory(c);
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
        if (ch == '&') hbuf_add(b, (const uint8_t *)"&amp;", 5);
        else if (attr && ch == '"') hbuf_add(b, (const uint8_t *)"&quot;", 6);
        else if (!attr && ch == '<') hbuf_add(b, (const uint8_t *)"&lt;", 4);
        else if (!attr && ch == '>') hbuf_add(b, (const uint8_t *)"&gt;", 4);
        else if (ch == 0xC2 && i + 1 < len && (uint8_t)s[i + 1] == 0xA0) {
            hbuf_add(b, (const uint8_t *)"&nbsp;", 6);
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

#include "nativesel.h"

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
    sel_scope = nd_of(root)->type == 1 ? nd_of(root) : NULL;
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
    sel_free(&list);
    JS_FreeCString(c, s);
    return result;
}

/* the JS surface of the nodes: csrc/nativedom_api.h */
#include "nativedom_api.h"
