/*
 * CSS selectors for the native DOM (included by nativedom.h): type, universal, #id, .class, attribute selectors
 * ([a] [a=v] [a~=v] [a|=v] [a^=v] [a$=v] [a*=v], quoted or not, with the i / s flag), the combinators
 * (descendant, >, +, ~), lists, escapes, and the pseudo-classes pages use: :not :is :where :matches :has,
 * :first/last/only-child, :first/last/only-of-type, :nth-child :nth-last-child :nth-of-type :nth-last-of-type,
 * :empty :root :scope :checked :disabled :enabled :required :optional :link :any-link :defined.
 * Pseudo-classes that depend on user interaction (:hover :focus ...) and pseudo-elements match nothing.
 * Matching runs right to left from the candidate. Everything a parse allocates is freed by sel_free().
 */

enum {
    PS_NOT, PS_IS, PS_HAS, PS_FIRST_CHILD, PS_LAST_CHILD, PS_ONLY_CHILD, PS_FIRST_TYPE, PS_LAST_TYPE, PS_ONLY_TYPE,
    PS_NTH_CHILD, PS_NTH_LAST_CHILD, PS_NTH_TYPE, PS_NTH_LAST_TYPE, PS_EMPTY, PS_ROOT, PS_SCOPE, PS_CHECKED,
    PS_DISABLED, PS_ENABLED, PS_REQUIRED, PS_OPTIONAL, PS_LINK, PS_ALWAYS, PS_NEVER,
    PS_FOCUS, PS_FOCUS_WITHIN, PS_HOVER, PS_ACTIVE, PS_TARGET
};

typedef struct SList SList;

typedef struct {
    int kind, a, b; /* a, b: the An+B of the nth-* pseudo-classes */
    SList *list;    /* :not :is :has */
} SPseudo;

typedef struct {
    char op, icase;
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
    const char **cls;
    int *clslen;
    int ncls;
    SAttr *attrs;
    int nattrs;
    SPseudo *ps;
    int nps;
    char comb; /* how this compound relates to the previous one: ' ' '>' '+' '~' (0 for the first) */
} SComp;

typedef struct {
    SComp *comps;
    int n;
} SComplex;

struct SList {
    SComplex *c;
    int n;
    char *ar; /* the arena of the identifiers (only on the list a parse returns) */
};

typedef struct {
    const char *s;
    size_t len, i;
    char *ar;
    size_t arn;
    int depth;
} SP;

/* the elements the page's interaction state names: 0 focus, 1 hover, 2 active, 3 target. Set by the page (setState); it holds
   a reference to each, so they outlive the pointer. */
static ND *sel_state[4];
static ND *sel_scope; /* what :scope means for the current match; null: the document element */

static int sel_ident_char(int ch) { return h_alnum(ch) || ch == '-' || ch == '_' || ch >= 0x80; }
static int sel_lower(int ch) { return ch >= 'A' && ch <= 'Z' ? ch + 32 : ch; }
static int sel_eq_ci(const char *a, int alen, const char *b, int blen) {
    if (alen != blen) return 0;
    for (int i = 0; i < alen; i++) if (sel_lower((uint8_t)a[i]) != sel_lower((uint8_t)b[i])) return 0;
    return 1;
}

static void sp_ws(SP *p) { while (p->i < p->len && h_ws((uint8_t)p->s[p->i])) p->i++; }

static int sp_hex(int ch) {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return -1;
}

/* one escape after the backslash, written to the arena */
static void sp_escape(SP *p) {
    if (p->i >= p->len) return;
    int h = sp_hex((uint8_t)p->s[p->i]);
    if (h < 0) { p->ar[p->arn++] = p->s[p->i++]; return; }
    uint32_t cp = 0;
    int digits = 0;
    while (p->i < p->len && digits < 6 && (h = sp_hex((uint8_t)p->s[p->i])) >= 0) { cp = cp * 16 + (uint32_t)h; p->i++; digits++; }
    if (p->i < p->len && h_ws((uint8_t)p->s[p->i])) p->i++;
    if (cp == 0 || cp > 0x10FFFF) cp = 0xFFFD;
    if (cp < 0x80) p->ar[p->arn++] = (char)cp;
    else if (cp < 0x800) { p->ar[p->arn++] = (char)(0xC0 | (cp >> 6)); p->ar[p->arn++] = (char)(0x80 | (cp & 63)); }
    else if (cp < 0x10000) { p->ar[p->arn++] = (char)(0xE0 | (cp >> 12)); p->ar[p->arn++] = (char)(0x80 | ((cp >> 6) & 63)); p->ar[p->arn++] = (char)(0x80 | (cp & 63)); }
    else { p->ar[p->arn++] = (char)(0xF0 | (cp >> 18)); p->ar[p->arn++] = (char)(0x80 | ((cp >> 12) & 63)); p->ar[p->arn++] = (char)(0x80 | ((cp >> 6) & 63)); p->ar[p->arn++] = (char)(0x80 | (cp & 63)); }
}

/* an identifier (escapes allowed); 0 when there is none */
static int sp_ident(SP *p, const char **out, int *outlen) {
    size_t start = p->arn;
    while (p->i < p->len) {
        uint8_t ch = (uint8_t)p->s[p->i];
        if (ch == '\\') { p->i++; sp_escape(p); }
        else if (sel_ident_char(ch)) { p->ar[p->arn++] = (char)ch; p->i++; }
        else break;
    }
    if (p->arn == start) return 0;
    *out = p->ar + start;
    *outlen = (int)(p->arn - start);
    return 1;
}

static int sp_string(SP *p, const char **out, int *outlen) {
    char q = p->s[p->i++];
    size_t start = p->arn;
    while (p->i < p->len && p->s[p->i] != q) {
        if (p->s[p->i] == '\\') { p->i++; if (p->i < p->len && p->s[p->i] == '\n') p->i++; else sp_escape(p); }
        else p->ar[p->arn++] = p->s[p->i++];
    }
    if (p->i >= p->len) return 0;
    p->i++;
    *out = p->ar + start;
    *outlen = (int)(p->arn - start);
    return 1;
}

/* An+B */
static int sp_nth(SP *p, int *A, int *B) {
    char t[48];
    int n = 0;
    while (p->i < p->len && p->s[p->i] != ')') {
        if (!h_ws((uint8_t)p->s[p->i])) { if (n >= 40) return 0; t[n++] = (char)sel_lower((uint8_t)p->s[p->i]); }
        p->i++;
    }
    t[n] = 0;
    if (!n) return 0;
    if (!strcmp(t, "odd")) { *A = 2; *B = 1; return 1; }
    if (!strcmp(t, "even")) { *A = 2; *B = 0; return 1; }
    char *np = strchr(t, 'n');
    if (!np) { *A = 0; *B = atoi(t); return 1; }
    *np = 0;
    if (!t[0] || !strcmp(t, "+")) *A = 1;
    else if (!strcmp(t, "-")) *A = -1;
    else *A = atoi(t);
    *B = np[1] ? atoi(np + 1) : 0;
    return 1;
}

static int sp_list(SP *p, SList *out, int relative);

static void sl_free(SList *l) {
    for (int i = 0; i < l->n; i++) {
        SComplex *cx = &l->c[i];
        for (int j = 0; j < cx->n; j++) {
            SComp *k = &cx->comps[j];
            free(k->cls);
            free(k->clslen);
            free(k->attrs);
            for (int m = 0; m < k->nps; m++) if (k->ps[m].list) { sl_free(k->ps[m].list); free(k->ps[m].list); }
            free(k->ps);
        }
        free(cx->comps);
    }
    free(l->c);
    l->c = NULL;
    l->n = 0;
}
static void sel_free(SList *l) {
    sl_free(l);
    free(l->ar);
    l->ar = NULL;
}

/* 0 when parsed; `out` must be released with sel_free() then */
static int sel_parse(const char *s, size_t len, SList *out) {
    memset(out, 0, sizeof(*out));
    SP p;
    p.s = s;
    p.len = len;
    p.i = 0;
    p.depth = 0;
    p.arn = 0;
    p.ar = malloc(len * 2 + 8);
    if (!p.ar) return -1;
    out->ar = p.ar;
    int ok = sp_list(&p, out, 0);
    sp_ws(&p);
    if (!ok || p.i != len) { sel_free(out); return -1; }
    return 0;
}

static int sp_pseudo(SP *p, SComp *k) {
    int colons = 1;
    p->i++;
    if (p->i < p->len && p->s[p->i] == ':') { p->i++; colons = 2; }
    const char *name;
    int nlen;
    if (!sp_ident(p, &name, &nlen)) return 0;
    char low[32];
    if (nlen >= (int)sizeof(low)) return 0;
    for (int i = 0; i < nlen; i++) low[i] = (char)sel_lower((uint8_t)name[i]);
    low[nlen] = 0;
    int hasParen = p->i < p->len && p->s[p->i] == '(';
    SPseudo ps;
    memset(&ps, 0, sizeof(ps));
    ps.kind = -1;
    if (colons == 2) {
        ps.kind = PS_NEVER;
        if (hasParen) { while (p->i < p->len && p->s[p->i] != ')') p->i++; if (p->i >= p->len) return 0; p->i++; }
    } else if (hasParen) {
        p->i++;
        if (!strcmp(low, "not") || !strcmp(low, "is") || !strcmp(low, "where") || !strcmp(low, "matches") || !strcmp(low, "-webkit-any") || !strcmp(low, "has")) {
            int has = !strcmp(low, "has");
            ps.kind = !strcmp(low, "not") ? PS_NOT : has ? PS_HAS : PS_IS;
            ps.list = calloc(1, sizeof(SList));
            if (!ps.list) return 0;
            if (++p->depth > 8 || !sp_list(p, ps.list, has)) { sl_free(ps.list); free(ps.list); return 0; }
            p->depth--;
        } else if (!strncmp(low, "nth-", 4)) {
            ps.kind = !strcmp(low, "nth-child") ? PS_NTH_CHILD : !strcmp(low, "nth-last-child") ? PS_NTH_LAST_CHILD
                    : !strcmp(low, "nth-of-type") ? PS_NTH_TYPE : !strcmp(low, "nth-last-of-type") ? PS_NTH_LAST_TYPE : -1;
            if (ps.kind < 0 || !sp_nth(p, &ps.a, &ps.b)) return 0;
        } else if (!strcmp(low, "lang") || !strcmp(low, "dir")) {
            ps.kind = PS_NEVER;
            while (p->i < p->len && p->s[p->i] != ')') p->i++;
        } else return 0;
        sp_ws(p);
        if (p->i >= p->len || p->s[p->i] != ')') { if (ps.list) { sl_free(ps.list); free(ps.list); } return 0; }
        p->i++;
    } else {
        static const struct { const char *name; int kind; } simple[] = {
            {"first-child", PS_FIRST_CHILD}, {"last-child", PS_LAST_CHILD}, {"only-child", PS_ONLY_CHILD},
            {"first-of-type", PS_FIRST_TYPE}, {"last-of-type", PS_LAST_TYPE}, {"only-of-type", PS_ONLY_TYPE},
            {"empty", PS_EMPTY}, {"root", PS_ROOT}, {"scope", PS_SCOPE}, {"checked", PS_CHECKED}, {"disabled", PS_DISABLED},
            {"enabled", PS_ENABLED}, {"required", PS_REQUIRED}, {"optional", PS_OPTIONAL}, {"link", PS_LINK}, {"any-link", PS_LINK},
            {"defined", PS_ALWAYS}, {"hover", PS_HOVER}, {"focus", PS_FOCUS}, {"active", PS_ACTIVE}, {"visited", PS_NEVER},
            {"target", PS_TARGET}, {"focus-within", PS_FOCUS_WITHIN}, {"focus-visible", PS_FOCUS}, {"before", PS_NEVER}, {"after", PS_NEVER},
            {"first-line", PS_NEVER}, {"first-letter", PS_NEVER}, {"placeholder-shown", PS_NEVER}, {"indeterminate", PS_NEVER},
            {"read-only", PS_NEVER}, {"read-write", PS_NEVER}, {"valid", PS_NEVER}, {"invalid", PS_NEVER}, {"out-of-range", PS_NEVER},
            {"in-range", PS_NEVER}, {"fullscreen", PS_NEVER}, {"autofill", PS_NEVER}, {"-webkit-autofill", PS_NEVER}, {"-moz-focusring", PS_NEVER},
        };
        for (size_t i = 0; i < sizeof(simple) / sizeof(simple[0]); i++) if (!strcmp(low, simple[i].name)) ps.kind = simple[i].kind;
    }
    if (ps.kind < 0) return 0;
    SPseudo *np = realloc(k->ps, sizeof(SPseudo) * (size_t)(k->nps + 1));
    if (!np) return 0;
    k->ps = np;
    k->ps[k->nps++] = ps;
    return 1;
}

static int sp_attr(SP *p, SComp *k) {
    p->i++;
    sp_ws(p);
    SAttr a;
    memset(&a, 0, sizeof(a));
    if (!sp_ident(p, &a.name, &a.nlen)) return 0;
    sp_ws(p);
    if (p->i >= p->len) return 0;
    if (p->s[p->i] != ']') {
        char op = p->s[p->i];
        if (op == '=') p->i++;
        else if ((op == '~' || op == '|' || op == '^' || op == '$' || op == '*') && p->i + 1 < p->len && p->s[p->i + 1] == '=') p->i += 2;
        else return 0;
        a.op = op;
        sp_ws(p);
        if (p->i >= p->len) return 0;
        if (p->s[p->i] == '"' || p->s[p->i] == '\'') { if (!sp_string(p, &a.val, &a.vlen)) return 0; }
        else {
            size_t start = p->arn;
            while (p->i < p->len && !h_ws((uint8_t)p->s[p->i]) && p->s[p->i] != ']') {
                if (p->s[p->i] == '\\') { p->i++; sp_escape(p); }
                else p->ar[p->arn++] = p->s[p->i++];
            }
            a.val = p->ar + start;
            a.vlen = (int)(p->arn - start);
        }
        sp_ws(p);
        if (p->i < p->len && (p->s[p->i] == 'i' || p->s[p->i] == 'I')) { a.icase = 1; p->i++; sp_ws(p); }
        else if (p->i < p->len && (p->s[p->i] == 's' || p->s[p->i] == 'S')) { p->i++; sp_ws(p); }
    }
    if (p->i >= p->len || p->s[p->i] != ']') return 0;
    p->i++;
    SAttr *na = realloc(k->attrs, sizeof(SAttr) * (size_t)(k->nattrs + 1));
    if (!na) return 0;
    k->attrs = na;
    k->attrs[k->nattrs++] = a;
    return 1;
}

static int sp_compound(SP *p, SComp *k) {
    int any = 0;
    if (p->i < p->len && p->s[p->i] == '*') { p->i++; any = 1; }
    else if (sp_ident(p, &k->tag, &k->taglen)) any = 1;
    for (;;) {
        if (p->i >= p->len) break;
        char ch = p->s[p->i];
        if (ch == '#' || ch == '.') {
            p->i++;
            const char *name;
            int nlen;
            if (!sp_ident(p, &name, &nlen)) return 0;
            if (ch == '#') { k->id = name; k->idlen = nlen; }
            else {
                const char **nc = realloc(k->cls, sizeof(char *) * (size_t)(k->ncls + 1));
                if (!nc) return 0;
                k->cls = nc;
                int *nl = realloc(k->clslen, sizeof(int) * (size_t)(k->ncls + 1));
                if (!nl) return 0;
                k->clslen = nl;
                k->cls[k->ncls] = name;
                k->clslen[k->ncls++] = nlen;
            }
        } else if (ch == '[') { if (!sp_attr(p, k)) return 0; }
        else if (ch == ':') { if (!sp_pseudo(p, k)) return 0; }
        else break;
        any = 1;
    }
    return any;
}

static int sp_complex(SP *p, SComplex *cx, int relative) {
    char comb = 0;
    sp_ws(p);
    if (relative && p->i < p->len && (p->s[p->i] == '>' || p->s[p->i] == '+' || p->s[p->i] == '~')) {
        comb = p->s[p->i++];
        sp_ws(p);
    } else if (relative) comb = ' ';
    for (;;) {
        SComp *nc = realloc(cx->comps, sizeof(SComp) * (size_t)(cx->n + 1));
        if (!nc) return 0;
        cx->comps = nc;
        SComp *k = &cx->comps[cx->n++];
        memset(k, 0, sizeof(*k));
        k->comb = comb;
        if (!sp_compound(p, k)) return 0;
        size_t before = p->i;
        sp_ws(p);
        if (p->i >= p->len || p->s[p->i] == ',' || p->s[p->i] == ')') return 1;
        char ch = p->s[p->i];
        if (ch == '>' || ch == '+' || ch == '~') { comb = ch; p->i++; sp_ws(p); }
        else if (p->i > before) comb = ' ';
        else return 0;
    }
}

/* a comma-separated list; inside a pseudo-class it stops at the closing parenthesis */
static int sp_list(SP *p, SList *out, int relative) {
    for (;;) {
        SComplex *nc = realloc(out->c, sizeof(SComplex) * (size_t)(out->n + 1));
        if (!nc) return 0;
        out->c = nc;
        SComplex *cx = &out->c[out->n++];
        memset(cx, 0, sizeof(*cx));
        if (!sp_complex(p, cx, relative)) return 0;
        sp_ws(p);
        if (p->i < p->len && p->s[p->i] == ',') { p->i++; continue; }
        return 1;
    }
}

#define SEL_CACHE_SIZE 32
typedef struct {
    char *str;
    size_t len;
    SList list;
    int valid;
} SelCacheEntry;
static SelCacheEntry sel_cache[SEL_CACHE_SIZE];
static int sel_cache_hand;

/* Look up or parse a selector. The returned SList pointer is valid until subsequent sel_parse_cached calls evict it. Do NOT call sel_free on it. */
static const SList *sel_parse_cached(const char *s, size_t len) {
    for (int i = 0; i < SEL_CACHE_SIZE; i++) {
        if (sel_cache[i].valid && sel_cache[i].len == len && memcmp(sel_cache[i].str, s, len) == 0) {
            return &sel_cache[i].list;
        }
    }
    int slot = sel_cache_hand;
    sel_cache_hand = (sel_cache_hand + 1) % SEL_CACHE_SIZE;
    if (sel_cache[slot].valid) {
        sel_free(&sel_cache[slot].list);
        free(sel_cache[slot].str);
        sel_cache[slot].valid = 0;
    }
    if (sel_parse(s, len, &sel_cache[slot].list) != 0) return NULL;
    sel_cache[slot].str = malloc(len + 1);
    if (!sel_cache[slot].str) {
        sel_free(&sel_cache[slot].list);
        return NULL;
    }
    memcpy(sel_cache[slot].str, s, len);
    sel_cache[slot].str[len] = 0;
    sel_cache[slot].len = len;
    sel_cache[slot].valid = 1;
    return &sel_cache[slot].list;
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

static NAttr *sel_attr(ND *n, const char *name, int nlen) {
    for (int i = 0; i < n->nattrs; i++) if (sel_eq_ci(n->attrs[i].name, n->attrs[i].nlen, name, nlen)) return &n->attrs[i];
    return NULL;
}

static int sel_str_eq(const char *a, int alen, const char *b, int blen, int icase) {
    return icase ? sel_eq_ci(a, alen, b, blen) : (alen == blen && memcmp(a, b, (size_t)alen) == 0);
}

static int sel_attr_match(NAttr *a, const SAttr *sa) {
    const char *v = a->val;
    int vl = a->vlen, sl = sa->vlen;
    switch (sa->op) {
    case 0: return 1;
    case '=': return sel_str_eq(v, vl, sa->val, sl, sa->icase);
    case '^': return sl > 0 && vl >= sl && sel_str_eq(v, sl, sa->val, sl, sa->icase);
    case '$': return sl > 0 && vl >= sl && sel_str_eq(v + vl - sl, sl, sa->val, sl, sa->icase);
    case '*':
        if (!sl) return 0;
        for (int j = 0; j + sl <= vl; j++) if (sel_str_eq(v + j, sl, sa->val, sl, sa->icase)) return 1;
        return 0;
    case '|': return sel_str_eq(v, vl, sa->val, sl, sa->icase) || (vl > sl && v[sl] == '-' && sel_str_eq(v, sl, sa->val, sl, sa->icase));
    case '~': {
        if (!sl) return 0;
        int i = 0;
        while (i < vl) {
            while (i < vl && h_ws((uint8_t)v[i])) i++;
            int st = i;
            while (i < vl && !h_ws((uint8_t)v[i])) i++;
            if (i > st && sel_str_eq(v + st, i - st, sa->val, sl, sa->icase)) return 1;
        }
        return 0;
    }
    }
    return 0;
}

static int sel_match_list(ND *n, const SList *l);
static int sel_match_from(ND *n, const SComplex *cx, int idx, ND *anchor);

static int sel_is_tag(ND *n, const char *tag) { return n->type == 1 && sel_eq_ci(n->tag, n->taglen, tag, (int)strlen(tag)); }
static int sel_is_control(ND *n) {
    return sel_is_tag(n, "input") || sel_is_tag(n, "button") || sel_is_tag(n, "select") || sel_is_tag(n, "textarea") ||
           sel_is_tag(n, "option") || sel_is_tag(n, "optgroup") || sel_is_tag(n, "fieldset");
}

/* :disabled per the HTML spec: its own attribute, or a disabled fieldset around it, unless it is inside that fieldset's
   first legend */
static int sel_is_disabled(ND *n) {
    if (!sel_is_control(n)) return 0;
    if (nd_find_attr(n, "disabled", 8)) return 1;
    if (sel_is_tag(n, "option") || sel_is_tag(n, "optgroup")) return 0;
    ND *child = n;
    for (ND *a = JS_IsNull(n->parent) ? NULL : nd_of(n->parent); a && a->type == 1; child = a, a = JS_IsNull(a->parent) ? NULL : nd_of(a->parent)) {
        if (!sel_is_tag(a, "fieldset") || !nd_find_attr(a, "disabled", 8)) continue;
        if (!sel_is_tag(child, "legend")) return 1;
        ND *first = NULL;
        for (ND *k = JS_IsNull(a->first) ? NULL : nd_of(a->first); k; k = JS_IsNull(k->next) ? NULL : nd_of(k->next))
            if (k->type == 1 && sel_is_tag(k, "legend")) { first = k; break; }
        if (first != child) return 1;
    }
    return 0;
}

/* the 1-based position among the element siblings (of the same type if `type`), counting from the end if `last` */
static int sel_position(ND *n, int type, int last, int *total) {
    int pos = 0, count = 0;
    if (JS_IsNull(n->parent)) { if (total) *total = 1; return 1; }
    for (JSValue s = nd_of(n->parent)->first; !JS_IsNull(s); s = nd_of(s)->next) {
        ND *sn = nd_of(s);
        if (sn->type != 1) continue;
        if (type && !(sn->taglen == n->taglen && memcmp(sn->tag, n->tag, (size_t)n->taglen) == 0)) continue;
        count++;
        if (sn == n) pos = count;
    }
    if (total) *total = count;
    return last ? count - pos + 1 : pos;
}

static int sel_nth(int A, int B, int pos) {
    if (A == 0) return pos == B;
    int d = pos - B;
    return d % A == 0 && d / A >= 0;
}

/* the next node in document order below `root` (null at the end) */
static JSValue sel_walk(JSValue cur, ND *root) {
    ND *n = nd_of(cur);
    if (!JS_IsNull(n->first)) return n->first;
    for (;;) {
        n = nd_of(cur);
        if (!JS_IsNull(n->next)) return n->next;
        cur = n->parent;
        if (JS_IsNull(cur) || nd_of(cur) == root) return JS_NULL;
    }
}

static int sel_has(ND *n, const SList *l) {
    for (int i = 0; i < l->n; i++) {
        const SComplex *cx = &l->c[i];
        char rel = cx->comps[0].comb;
        ND *top = (rel == '+' || rel == '~') ? (JS_IsNull(n->parent) ? NULL : nd_of(n->parent)) : n;
        if (!top) continue;
        for (JSValue cur = top->first; !JS_IsNull(cur); cur = sel_walk(cur, top)) {
            ND *c = nd_of(cur);
            if (c->type == 1 && sel_match_from(c, cx, cx->n - 1, n)) return 1;
        }
    }
    return 0;
}

static int sel_in_document(ND *n) {
    for (ND *a = n; a; a = JS_IsNull(a->parent) ? NULL : nd_of(a->parent))
        if (a->type == 9) return 1;
    return 0;
}

static int sel_pseudo(ND *n, const SPseudo *ps) {
    int total;
    switch (ps->kind) {
    case PS_NOT: return !sel_match_list(n, ps->list);
    case PS_IS: return sel_match_list(n, ps->list);
    case PS_HAS: return sel_has(n, ps->list);
    case PS_FIRST_CHILD: return sel_position(n, 0, 0, NULL) == 1;
    case PS_LAST_CHILD: return sel_position(n, 0, 1, NULL) == 1;
    case PS_ONLY_CHILD: sel_position(n, 0, 0, &total); return total == 1;
    case PS_FIRST_TYPE: return sel_position(n, 1, 0, NULL) == 1;
    case PS_LAST_TYPE: return sel_position(n, 1, 1, NULL) == 1;
    case PS_ONLY_TYPE: sel_position(n, 1, 0, &total); return total == 1;
    case PS_NTH_CHILD: return sel_nth(ps->a, ps->b, sel_position(n, 0, 0, NULL));
    case PS_NTH_LAST_CHILD: return sel_nth(ps->a, ps->b, sel_position(n, 0, 1, NULL));
    case PS_NTH_TYPE: return sel_nth(ps->a, ps->b, sel_position(n, 1, 0, NULL));
    case PS_NTH_LAST_TYPE: return sel_nth(ps->a, ps->b, sel_position(n, 1, 1, NULL));
    case PS_EMPTY:
        for (JSValue c = n->first; !JS_IsNull(c); c = nd_of(c)->next) {
            ND *cn = nd_of(c);
            if (cn->type == 1 || (cn->type == 3 && cn->taglen > 0)) return 0;
        }
        return 1;
    case PS_ROOT: return !JS_IsNull(n->parent) && nd_of(n->parent)->type == 9;
    case PS_SCOPE: return sel_scope ? n == sel_scope : (!JS_IsNull(n->parent) && nd_of(n->parent)->type == 9);
    case PS_CHECKED: return (sel_is_tag(n, "input") && nd_find_attr(n, "checked", 7)) || (sel_is_tag(n, "option") && nd_find_attr(n, "selected", 8));
    case PS_DISABLED: return sel_is_disabled(n);
    case PS_ENABLED: return sel_is_control(n) && !sel_is_disabled(n);
    case PS_REQUIRED: return (sel_is_tag(n, "input") || sel_is_tag(n, "select") || sel_is_tag(n, "textarea")) && nd_find_attr(n, "required", 8) != NULL;
    case PS_OPTIONAL: return (sel_is_tag(n, "input") || sel_is_tag(n, "select") || sel_is_tag(n, "textarea")) && !nd_find_attr(n, "required", 8);
    case PS_LINK: return (sel_is_tag(n, "a") || sel_is_tag(n, "area")) && nd_find_attr(n, "href", 4) != NULL;
    case PS_ALWAYS: return 1;
    case PS_FOCUS: return sel_state[0] == n && sel_in_document(n);
    case PS_TARGET: return sel_state[3] == n;
    case PS_FOCUS_WITHIN: case PS_HOVER: case PS_ACTIVE: {
        /* the element itself or any of its ancestors on the way up from the named one */
        ND *named = sel_state[ps->kind == PS_FOCUS_WITHIN ? 0 : ps->kind == PS_HOVER ? 1 : 2];
        if (!named || !sel_in_document(named)) return 0;
        for (ND *a = named; a; a = JS_IsNull(a->parent) ? NULL : nd_of(a->parent))
            if (a == n) return 1;
        return 0;
    }
    }
    return 0;
}

static int sel_compound(ND *n, const SComp *k) {
    if (n->type != 1) return 0;
    if (k->taglen && !sel_eq_ci(n->tag, n->taglen, k->tag, k->taglen)) return 0;
    if (k->idlen) {
        NAttr *a = nd_find_attr(n, "id", 2);
        if (!a || a->vlen != k->idlen || memcmp(a->val, k->id, (size_t)k->idlen) != 0) return 0;
    }
    for (int i = 0; i < k->ncls; i++) if (!sel_class_has(n, k->cls[i], k->clslen[i])) return 0;
    for (int i = 0; i < k->nattrs; i++) {
        NAttr *a = sel_attr(n, k->attrs[i].name, k->attrs[i].nlen);
        if (!a || !sel_attr_match(a, &k->attrs[i])) return 0;
    }
    for (int i = 0; i < k->nps; i++) if (!sel_pseudo(n, &k->ps[i])) return 0;
    return 1;
}

static ND *sel_prev_element(ND *n) {
    for (JSValue s = n->prev; !JS_IsNull(s); s = nd_of(s)->prev) if (nd_of(s)->type == 1) return nd_of(s);
    return NULL;
}
static ND *sel_parent_of(ND *n) { return JS_IsNull(n->parent) ? NULL : nd_of(n->parent); }

/* `anchor`: for :has(), the element the leftmost compound has to stand in the relation to */
static int sel_related(ND *n, char comb, ND *anchor) {
    switch (comb) {
    case '>': return sel_parent_of(n) == anchor;
    case '+': return sel_prev_element(n) == anchor;
    case '~': for (ND *s = sel_prev_element(n); s; s = sel_prev_element(s)) if (s == anchor) return 1; return 0;
    default: for (ND *p = sel_parent_of(n); p; p = sel_parent_of(p)) if (p == anchor) return 1; return 0;
    }
}

static int sel_match_from(ND *n, const SComplex *cx, int idx, ND *anchor) {
    if (!sel_compound(n, &cx->comps[idx])) return 0;
    char comb = cx->comps[idx].comb;
    if (idx == 0) return !anchor || sel_related(n, comb, anchor);
    switch (comb) {
    case '>': { ND *p = sel_parent_of(n); return p && sel_match_from(p, cx, idx - 1, anchor); }
    case '+': { ND *s = sel_prev_element(n); return s && sel_match_from(s, cx, idx - 1, anchor); }
    case '~': for (ND *s = sel_prev_element(n); s; s = sel_prev_element(s)) if (sel_match_from(s, cx, idx - 1, anchor)) return 1; return 0;
    default: for (ND *p = sel_parent_of(n); p; p = sel_parent_of(p)) if (sel_match_from(p, cx, idx - 1, anchor)) return 1; return 0;
    }
}

static int sel_match_list(ND *n, const SList *l) {
    for (int i = 0; i < l->n; i++) if (sel_match_from(n, &l->c[i], l->c[i].n - 1, NULL)) return 1;
    return 0;
}

static int sel_match(ND *n, const SList *l) { return n->type == 1 && sel_match_list(n, l); }
