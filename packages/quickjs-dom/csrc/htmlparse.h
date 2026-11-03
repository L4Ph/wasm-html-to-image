/*
 * A native port of htmlparser2's HTML mode (Tokenizer + Parser, htmlparser2@10 with entities@7), the parser linkedom
 * builds its DOM with. Parsing HTML in the interpreter ran at about 0.5 MB/s; this runs at hundreds of MB/s and the
 * rest of the cost is linkedom creating the nodes.
 *
 * It is a port, not a new parser: the same states, the same implied-close rules, the same entity decoding, so the
 * handler calls (and so the tree) are the ones htmlparser2 would have produced. tests/htmlparse.test.ts compares the
 * two on a corpus and on random input.
 *
 * Only what linkedom's handlers look at is reproduced: onopentag(name, attributes), onclosetag(), ontext(text),
 * oncomment(text) and onprocessinginstruction(name, data). Input the port cannot reproduce exactly (non-ASCII tag
 * names, which JS lower-cases by Unicode rules; lone surrogates) makes it decline before anything is called, and the
 * caller falls back to htmlparser2.
 *
 * Included by qjsdom.c; it needs <stdint.h>, <stdlib.h>, <string.h> and quickjs.h first.
 */
#include "entity_tree.h"

/* ---- growable buffers ---- */

typedef struct {
    uint8_t *p;
    size_t n, cap;
} HBuf;

static int hbuf_reserve(HBuf *b, size_t extra) {
    if (b->n + extra <= b->cap) return 1;
    size_t cap = b->cap ? b->cap : 256;
    while (cap < b->n + extra) cap *= 2;
    uint8_t *p = realloc(b->p, cap);
    if (!p) return 0;
    b->p = p;
    b->cap = cap;
    return 1;
}

static int hbuf_add(HBuf *b, const uint8_t *s, size_t len) {
    if (!hbuf_reserve(b, len)) return 0;
    memcpy(b->p + b->n, s, len);
    b->n += len;
    return 1;
}

typedef struct {
    int32_t *v;
    size_t n, cap;
} HVec;

static int hvec_push(HVec *a, int32_t x) {
    if (a->n == a->cap) {
        size_t cap = a->cap ? a->cap * 2 : 1024;
        int32_t *p = realloc(a->v, cap * sizeof(int32_t));
        if (!p) return 0;
        a->v = p;
        a->cap = cap;
    }
    a->v[a->n++] = x;
    return 1;
}

/* ---- events: what the handlers get, recorded first so declining never leaves a half-built tree ---- */

enum { EV_TEXT = 1, EV_OPEN, EV_CLOSE, EV_COMMENT, EV_PI };
/* EV_TEXT/EV_COMMENT: src, off, len (src 0: the input, 1: `extra`)
   EV_OPEN:            nameOff, nameLen (in extra), nattrs, then per attribute: nameOff, nameLen (input), src, off, len
   EV_CLOSE:           -
   EV_PI:              nameOff, nameLen, dataOff, dataLen (all in extra) */

/* ---- tokenizer states (the numbering of htmlparser2's) ---- */

enum {
    S_Text = 1, S_BeforeTagName, S_InTagName, S_InSelfClosingTag, S_BeforeClosingTagName, S_InClosingTagName,
    S_AfterClosingTagName, S_BeforeAttributeName, S_InAttributeName, S_AfterAttributeName, S_BeforeAttributeValue,
    S_InAttributeValueDq, S_InAttributeValueSq, S_InAttributeValueNq, S_BeforeDeclaration, S_InDeclaration,
    S_InProcessingInstruction, S_BeforeComment, S_CDATASequence, S_InSpecialComment, S_InCommentLike,
    S_BeforeSpecialS, S_BeforeSpecialT, S_SpecialStartSequence, S_InSpecialTag, S_InEntity
};

static const uint8_t SEQ_CDATA[] = {'C', 'D', 'A', 'T', 'A', '['};
static const uint8_t SEQ_CDATA_END[] = {']', ']', '>'};
static const uint8_t SEQ_COMMENT_END[] = {'-', '-', '>'};
static const uint8_t SEQ_SCRIPT_END[] = {'<', '/', 's', 'c', 'r', 'i', 'p', 't'};
static const uint8_t SEQ_STYLE_END[] = {'<', '/', 's', 't', 'y', 'l', 'e'};
static const uint8_t SEQ_TITLE_END[] = {'<', '/', 't', 'i', 't', 'l', 'e'};
static const uint8_t SEQ_TEXTAREA_END[] = {'<', '/', 't', 'e', 'x', 't', 'a', 'r', 'e', 'a'};
static const uint8_t SEQ_XMP_END[] = {'<', '/', 'x', 'm', 'p'};

typedef struct {
    int32_t off, len; /* a name in `extra` */
} HName;

typedef struct {
    int32_t nameOff, nameLen; /* in the input */
    int32_t src, off, len;    /* the value */
} HAttr;

typedef struct {
    const uint8_t *s;
    ptrdiff_t len;

    /* tokenizer */
    int state, baseState;
    ptrdiff_t sectionStart, index, entityStart;
    int isSpecial;
    const uint8_t *curSeq;
    size_t curSeqLen;
    size_t seqIndex;
    int entityEofEmit; /* an entity cut off by the end of the input: emit it in finish() */
    uint32_t entityCp[2];
    int entityNcp;
    ptrdiff_t entityConsumed;

    /* parser */
    HName *stack; /* the top is the last */
    int nstack, capStack;
    uint8_t *foreign; /* foreignContext, the top is the last; empty reads as false */
    int nforeign, capForeign;
    HName tagname;
    HAttr *attrs;
    int nattrs, capAttrs;
    ptrdiff_t attribNameOff, attribNameLen;
    int avMode; /* 0: empty, 1: one slice of the input, 2: in avBuf */
    ptrdiff_t avStart, avLen;
    HBuf avBuf;

    HVec ev;
    HBuf extra;
    int fail; /* out of memory */
    int bail; /* input the port does not reproduce */
} HP;

/* ---- character classes ---- */

static inline int h_ws(int c) { return c == ' ' || c == '\n' || c == '\t' || c == '\f' || c == '\r'; }
static inline int h_end_of_tag_section(int c) { return c == '/' || c == '>' || h_ws(c); }
static inline int h_alpha(int c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
static inline int h_alnum(int c) { return h_alpha(c) || (c >= '0' && c <= '9'); }
static inline int h_hex(int c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }

/* ---- entities (entities@7 decode.js, run over the whole input at once) ---- */

enum { DM_LEGACY = 0, DM_ATTRIBUTE = 2 };
enum { DEC_NONE = 0, DEC_OK, DEC_EOF };

typedef struct {
    int kind;
    uint32_t cp[2];
    int ncp;
    ptrdiff_t consumed;
} HDec;

static int32_t h_branch(unsigned current, unsigned nodeIndex, unsigned ch) {
    unsigned branchCount = (current & 0x1F80) >> 7;
    unsigned jumpOffset = current & 0x7F;
    if (branchCount == 0) return (jumpOffset != 0 && ch == jumpOffset) ? (int32_t)nodeIndex : -1;
    if (jumpOffset) {
        int value = (int)ch - (int)jumpOffset;
        return (value < 0 || value >= (int)branchCount) ? -1 : (int32_t)entity_tree[nodeIndex + (unsigned)value] - 1;
    }
    unsigned packedKeySlots = (branchCount + 1) >> 1;
    int lo = 0, hi = (int)branchCount - 1;
    while (lo <= hi) {
        int mid = (lo + hi) >> 1;
        unsigned packed = entity_tree[nodeIndex + (unsigned)(mid >> 1)];
        unsigned midKey = (packed >> ((mid & 1) * 8)) & 0xff;
        if (midKey < ch) lo = mid + 1;
        else if (midKey > ch) hi = mid - 1;
        else return (int32_t)entity_tree[nodeIndex + packedKeySlots + (unsigned)mid];
    }
    return -1;
}

static void h_emit_named(HDec *r, unsigned result, unsigned valueLength, ptrdiff_t consumed) {
    r->kind = DEC_OK;
    r->consumed = consumed;
    r->cp[0] = valueLength == 1 ? (unsigned)(entity_tree[result] & ~(0xC000 | 0x2000)) : entity_tree[result + 1];
    r->ncp = 1;
    if (valueLength == 3) r->cp[r->ncp++] = entity_tree[result + 2];
}

static uint32_t h_replace_cp(uint32_t cp) {
    static const uint16_t c1[32] = {
        8364, 0, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 0, 381, 0,
        0, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 0, 382, 376,
    };
    if ((cp >= 0xD800 && cp <= 0xDFFF) || cp > 0x10FFFF) return 0xFFFD;
    if (cp == 0) return 0xFFFD;
    if (cp >= 128 && cp <= 159 && c1[cp - 128]) return c1[cp - 128];
    return cp;
}

/* what EntityDecoder.write()/end() give for the text after an `&` at s[offset-1], with `s + len` the end of the input;
   DEC_EOF with ncp > 0 is what end() emits when the input stops inside the entity */
static void h_decode(const uint8_t *s, ptrdiff_t len, ptrdiff_t offset, int mode, HDec *r) {
    r->kind = DEC_NONE;
    r->ncp = 0;
    r->consumed = 0;
    ptrdiff_t consumed = 1;
    if (offset < len && s[offset] == '#') {
        consumed = 2;
        offset++;
        if (offset >= len) {
            r->kind = DEC_EOF;
            return;
        }
        int hex = (s[offset] | 0x20) == 'x';
        int expected = hex ? 3 : 2;
        if (hex) {
            consumed = 3;
            offset++;
        }
        uint32_t result = 0;
        while (offset < len) {
            int ch = s[offset];
            int digit = hex ? (h_hex(ch) ? (ch <= '9' ? ch - '0' : (ch | 0x20) - 'a' + 10) : -1) : ((ch >= '0' && ch <= '9') ? ch - '0' : -1);
            if (digit >= 0) {
                if (result <= 0x10FFFF) result = result * (hex ? 16 : 10) + (uint32_t)digit;
                consumed++;
                offset++;
            } else {
                if (consumed <= expected) return;
                if (ch == ';') consumed++;
                r->kind = DEC_OK;
                r->consumed = consumed;
                r->cp[0] = h_replace_cp(result);
                r->ncp = 1;
                return;
            }
        }
        /* end(): the digits stopped at the end of the input */
        if (consumed > expected) {
            r->kind = DEC_EOF;
            r->consumed = consumed;
            r->cp[0] = h_replace_cp(result);
            r->ncp = 1;
        } else r->kind = DEC_EOF;
        return;
    }

    unsigned treeIndex = 0, result = 0, runConsumed = 0;
    ptrdiff_t excess = 1;
    unsigned current = entity_tree[0];
    unsigned valueLength = (current & 0xC000) >> 14;
    int32_t next;
    while (offset < len) {
        if (valueLength == 0 && (current & 0x2000) != 0) {
            unsigned runLength = (current & 0x1F80) >> 7;
            if (runConsumed == 0) {
                if (s[offset] != (current & 0x7F)) goto not_terminated;
                offset++;
                excess++;
                runConsumed++;
            }
            while (runConsumed < runLength) {
                if (offset >= len) goto at_end;
                unsigned idx = runConsumed - 1;
                unsigned packed = entity_tree[treeIndex + 1 + (idx >> 1)];
                unsigned expectedCh = (idx % 2 == 0) ? (packed & 0xff) : ((packed >> 8) & 0xff);
                if (s[offset] != expectedCh) goto not_terminated;
                offset++;
                excess++;
                runConsumed++;
            }
            runConsumed = 0;
            treeIndex += 1 + (runLength >> 1);
            current = entity_tree[treeIndex];
            valueLength = (current & 0xC000) >> 14;
        }
        if (offset >= len) break;
        int ch = s[offset];
        if (ch == ';' && valueLength != 0 && (current & 0x2000) != 0) {
            h_emit_named(r, treeIndex, valueLength, consumed + excess);
            return;
        }
        next = h_branch(current, treeIndex + (valueLength > 1 ? valueLength : 1), (unsigned)ch);
        if (next < 0) {
            if (result == 0 || (mode == DM_ATTRIBUTE && (valueLength == 0 || h_alnum(ch) || ch == '='))) return;
            goto not_terminated;
        }
        treeIndex = (unsigned)next;
        current = entity_tree[treeIndex];
        valueLength = (current & 0xC000) >> 14;
        if (valueLength != 0) {
            if (ch == ';') {
                h_emit_named(r, treeIndex, valueLength, consumed + excess);
                return;
            }
            if ((current & 0x2000) == 0) {
                result = treeIndex;
                consumed += excess;
                excess = 0;
            }
        }
        offset++;
        excess++;
    }
at_end:
    /* end() */
    if (result != 0 && (mode != DM_ATTRIBUTE || result == treeIndex)) {
        h_emit_named(r, result, (entity_tree[result] & 0xC000) >> 14, consumed);
        r->kind = DEC_EOF;
    } else r->kind = DEC_NONE;
    return;
not_terminated:
    if (result == 0) return;
    h_emit_named(r, result, (entity_tree[result] & 0xC000) >> 14, consumed);
    return;
}

/* ---- events ---- */

static void h_ev(HP *p, int32_t x) {
    if (!hvec_push(&p->ev, x)) p->fail = 1;
}

static int32_t h_extra_add(HP *p, const uint8_t *s, size_t len) {
    int32_t off = (int32_t)p->extra.n;
    if (!hbuf_add(&p->extra, s, len)) p->fail = 1;
    return off;
}

/* `input.slice(start, end)`: a negative index counts from the end (htmlparser2 does reach it with sectionStart -1, for
   a document that ends right after a tag name or a closing tag) */
static void h_slice(HP *p, ptrdiff_t *start, ptrdiff_t *end) {
    if (*start < 0) {
        /* JS counts UTF-16 code units, which are bytes only for ASCII */
        for (ptrdiff_t i = p->len + *start < 0 ? 0 : p->len + *start; i < p->len; i++) if (p->s[i] >= 0x80) p->bail = 1;
        *start += p->len;
        if (*start < 0) *start = 0;
    }
    if (*end < 0) { *end += p->len; if (*end < 0) *end = 0; }
    if (*start > p->len) *start = p->len;
    if (*end > p->len) *end = p->len;
}

static void h_text(HP *p, ptrdiff_t start, ptrdiff_t end) {
    h_slice(p, &start, &end);
    h_ev(p, EV_TEXT);
    h_ev(p, 0);
    h_ev(p, (int32_t)start);
    h_ev(p, end > start ? (int32_t)(end - start) : 0);
}

static void h_text_cp(HP *p, uint32_t cp) {
    uint8_t u[4];
    int n;
    if (cp < 0x80) { u[0] = (uint8_t)cp; n = 1; }
    else if (cp < 0x800) { u[0] = 0xC0 | (cp >> 6); u[1] = 0x80 | (cp & 63); n = 2; }
    else if (cp < 0x10000) { u[0] = 0xE0 | (cp >> 12); u[1] = 0x80 | ((cp >> 6) & 63); u[2] = 0x80 | (cp & 63); n = 3; }
    else { u[0] = 0xF0 | (cp >> 18); u[1] = 0x80 | ((cp >> 12) & 63); u[2] = 0x80 | ((cp >> 6) & 63); u[3] = 0x80 | (cp & 63); n = 4; }
    int32_t off = h_extra_add(p, u, (size_t)n);
    h_ev(p, EV_TEXT);
    h_ev(p, 1);
    h_ev(p, off);
    h_ev(p, n);
}

/* ---- Parser ---- */

typedef struct {
    const char *name;
    int len;
} HStr;
#define HS(x) {x, sizeof(x) - 1}

static const HStr SET_P[] = {HS("p")};
static const HStr SET_TR[] = {HS("tr"), HS("th"), HS("td")};
static const HStr SET_TH[] = {HS("th")};
static const HStr SET_TD[] = {HS("thead"), HS("th"), HS("td")};
static const HStr SET_BODY[] = {HS("head"), HS("link"), HS("script")};
static const HStr SET_LI[] = {HS("li")};
static const HStr SET_FORM[] = {HS("input"), HS("option"), HS("optgroup"), HS("select"), HS("button"), HS("datalist"), HS("textarea")};
static const HStr SET_OPTION[] = {HS("option")};
static const HStr SET_OPTGROUP[] = {HS("optgroup"), HS("option")};
static const HStr SET_DDT[] = {HS("dd"), HS("dt")};
static const HStr SET_RTP[] = {HS("rt"), HS("rp")};
static const HStr SET_SECTION[] = {HS("thead"), HS("tbody")};
#define SETN(a) ((int)(sizeof(a) / sizeof((a)[0])))

typedef struct {
    HStr name;
    const HStr *set;
    int n;
} HImplies;

static const HImplies IMPLIES[] = {
    {HS("tr"), SET_TR, SETN(SET_TR)}, {HS("th"), SET_TH, 1}, {HS("td"), SET_TD, SETN(SET_TD)},
    {HS("body"), SET_BODY, SETN(SET_BODY)}, {HS("li"), SET_LI, 1}, {HS("p"), SET_P, 1},
    {HS("h1"), SET_P, 1}, {HS("h2"), SET_P, 1}, {HS("h3"), SET_P, 1}, {HS("h4"), SET_P, 1}, {HS("h5"), SET_P, 1}, {HS("h6"), SET_P, 1},
    {HS("select"), SET_FORM, SETN(SET_FORM)}, {HS("input"), SET_FORM, SETN(SET_FORM)}, {HS("output"), SET_FORM, SETN(SET_FORM)},
    {HS("button"), SET_FORM, SETN(SET_FORM)}, {HS("datalist"), SET_FORM, SETN(SET_FORM)}, {HS("textarea"), SET_FORM, SETN(SET_FORM)},
    {HS("option"), SET_OPTION, 1}, {HS("optgroup"), SET_OPTGROUP, SETN(SET_OPTGROUP)},
    {HS("dd"), SET_DDT, 2}, {HS("dt"), SET_DDT, 2},
    {HS("address"), SET_P, 1}, {HS("article"), SET_P, 1}, {HS("aside"), SET_P, 1}, {HS("blockquote"), SET_P, 1},
    {HS("details"), SET_P, 1}, {HS("div"), SET_P, 1}, {HS("dl"), SET_P, 1}, {HS("fieldset"), SET_P, 1},
    {HS("figcaption"), SET_P, 1}, {HS("figure"), SET_P, 1}, {HS("footer"), SET_P, 1}, {HS("form"), SET_P, 1},
    {HS("header"), SET_P, 1}, {HS("hr"), SET_P, 1}, {HS("main"), SET_P, 1}, {HS("nav"), SET_P, 1}, {HS("ol"), SET_P, 1},
    {HS("pre"), SET_P, 1}, {HS("section"), SET_P, 1}, {HS("table"), SET_P, 1}, {HS("ul"), SET_P, 1},
    {HS("rt"), SET_RTP, 2}, {HS("rp"), SET_RTP, 2},
    {HS("tbody"), SET_SECTION, 2}, {HS("tfoot"), SET_SECTION, 2},
};

static const HStr VOIDS[] = {
    HS("area"), HS("base"), HS("basefont"), HS("br"), HS("col"), HS("command"), HS("embed"), HS("frame"), HS("hr"), HS("img"),
    HS("input"), HS("isindex"), HS("keygen"), HS("link"), HS("meta"), HS("param"), HS("source"), HS("track"), HS("wbr"),
};
static const HStr INTEGRATION[] = {
    HS("mi"), HS("mo"), HS("mn"), HS("ms"), HS("mtext"), HS("annotation-xml"), HS("foreignobject"), HS("desc"), HS("title"),
};

static inline int h_is(const uint8_t *a, int alen, const HStr *s) { return alen == s->len && memcmp(a, s->name, (size_t)alen) == 0; }
static int h_in(const uint8_t *a, int alen, const HStr *set, int n) {
    for (int i = 0; i < n; i++) if (h_is(a, alen, &set[i])) return 1;
    return 0;
}
static inline const uint8_t *h_nm(HP *p, HName n) { return p->extra.p + n.off; }

static int h_is_void(HP *p, HName n) { return h_in(h_nm(p, n), n.len, VOIDS, SETN(VOIDS)); }

static int h_foreign_top(HP *p) { return p->nforeign > 0 && p->foreign[p->nforeign - 1]; }
static void h_foreign_push(HP *p, int v) {
    if (p->nforeign == p->capForeign) {
        int cap = p->capForeign ? p->capForeign * 2 : 16;
        uint8_t *f = realloc(p->foreign, (size_t)cap);
        if (!f) { p->fail = 1; return; }
        p->foreign = f;
        p->capForeign = cap;
    }
    p->foreign[p->nforeign++] = (uint8_t)v;
}

static void h_stack_push(HP *p, HName n) {
    if (p->nstack == p->capStack) {
        int cap = p->capStack ? p->capStack * 2 : 64;
        HName *s = realloc(p->stack, sizeof(HName) * (size_t)cap);
        if (!s) { p->fail = 1; return; }
        p->stack = s;
        p->capStack = cap;
    }
    p->stack[p->nstack++] = n;
}

static inline int h_same(HP *p, HName a, HName b) { return a.len == b.len && memcmp(h_nm(p, a), h_nm(p, b), (size_t)a.len) == 0; }

static void h_close(HP *p) { h_ev(p, EV_CLOSE); }

static void h_emit_open_tag(HP *p, HName name) {
    p->tagname = name;
    const uint8_t *nm = h_nm(p, name);
    for (size_t i = 0; i < sizeof(IMPLIES) / sizeof(IMPLIES[0]); i++) {
        if (!h_is(nm, name.len, &IMPLIES[i].name)) continue;
        while (p->nstack > 0) {
            HName top = p->stack[p->nstack - 1];
            if (!h_in(h_nm(p, top), top.len, IMPLIES[i].set, IMPLIES[i].n)) break;
            p->nstack--;
            h_close(p);
        }
        break;
    }
    if (!h_is_void(p, name)) {
        h_stack_push(p, name);
        static const HStr svg = HS("svg"), math = HS("math");
        if (h_is(nm, name.len, &svg) || h_is(nm, name.len, &math)) h_foreign_push(p, 1);
        else if (h_in(nm, name.len, INTEGRATION, SETN(INTEGRATION))) h_foreign_push(p, 0);
    }
    p->nattrs = 0;
}

static void h_end_open_tag(HP *p) {
    h_ev(p, EV_OPEN);
    h_ev(p, p->tagname.off);
    h_ev(p, p->tagname.len);
    h_ev(p, p->nattrs);
    for (int i = 0; i < p->nattrs; i++) {
        h_ev(p, p->attrs[i].nameOff);
        h_ev(p, p->attrs[i].nameLen);
        h_ev(p, p->attrs[i].src);
        h_ev(p, p->attrs[i].off);
        h_ev(p, p->attrs[i].len);
    }
    p->nattrs = 0;
    if (h_is_void(p, p->tagname)) h_close(p);
    p->tagname.len = 0;
}

static void h_close_current_tag(HP *p) {
    HName name = p->tagname;
    h_end_open_tag(p);
    if (p->nstack > 0 && h_same(p, p->stack[p->nstack - 1], name)) {
        h_close(p);
        p->nstack--;
    }
}

/* a tag or attribute name taken from the input: lower-cased (ASCII only; anything else is declined) into `extra` */
static HName h_lower_name(HP *p, ptrdiff_t start, ptrdiff_t end) {
    HName n = {(int32_t)p->extra.n, (int32_t)(end - start)};
    if (!hbuf_reserve(&p->extra, (size_t)(end - start))) { p->fail = 1; n.len = 0; return n; }
    for (ptrdiff_t i = start; i < end; i++) {
        uint8_t c = p->s[i];
        if (c >= 0x80) p->bail = 1;
        p->extra.p[p->extra.n++] = (c >= 'A' && c <= 'Z') ? c + 32 : c;
    }
    return n;
}

static void h_on_open_tag_name(HP *p, ptrdiff_t start, ptrdiff_t end) {
    HName name = h_lower_name(p, start, end);
    h_emit_open_tag(p, name);
}

static void h_on_open_tag_end(HP *p) { h_end_open_tag(p); }

static void h_on_close_tag(HP *p, ptrdiff_t start, ptrdiff_t end) {
    HName name = h_lower_name(p, start, end);
    const uint8_t *nm = h_nm(p, name);
    static const HStr svg = HS("svg"), math = HS("math"), pt = HS("p"), br = HS("br");
    if (h_is(nm, name.len, &svg) || h_is(nm, name.len, &math) || h_in(nm, name.len, INTEGRATION, SETN(INTEGRATION))) {
        if (p->nforeign > 0) p->nforeign--;
    }
    if (!h_is_void(p, name)) {
        int pos = -1;
        for (int i = p->nstack - 1; i >= 0; i--) {
            if (h_same(p, p->stack[i], name)) { pos = p->nstack - 1 - i; break; }
        }
        if (pos != -1) {
            for (int index = 0; index <= pos; index++) {
                p->nstack--;
                h_close(p);
            }
        } else if (h_is(nm, name.len, &pt)) {
            h_emit_open_tag(p, name);
            h_close_current_tag(p);
        }
    } else if (h_is(nm, name.len, &br)) {
        h_ev(p, EV_OPEN);
        h_ev(p, name.off);
        h_ev(p, name.len);
        h_ev(p, 0);
        h_close(p);
    }
}

static void h_on_self_closing_tag(HP *p) {
    if (h_foreign_top(p)) h_close_current_tag(p);
    else h_on_open_tag_end(p);
}

static void h_on_attrib_name(HP *p, ptrdiff_t start, ptrdiff_t end) {
    p->attribNameOff = start;
    p->attribNameLen = end - start;
}

static void h_on_attrib_data(HP *p, ptrdiff_t start, ptrdiff_t end) {
    if (end <= start) return;
    if (p->avMode == 0) {
        p->avMode = 1;
        p->avStart = start;
        p->avLen = end - start;
    } else {
        if (p->avMode == 1) {
            p->avBuf.n = 0;
            if (!hbuf_add(&p->avBuf, p->s + p->avStart, (size_t)p->avLen)) p->fail = 1;
            p->avMode = 2;
        }
        if (!hbuf_add(&p->avBuf, p->s + start, (size_t)(end - start))) p->fail = 1;
    }
}

static void h_on_attrib_entity(HP *p, uint32_t cp) {
    if (p->avMode != 2) {
        p->avBuf.n = 0;
        if (p->avMode == 1 && !hbuf_add(&p->avBuf, p->s + p->avStart, (size_t)p->avLen)) p->fail = 1;
        p->avMode = 2;
    }
    uint8_t u[4];
    int n;
    if (cp < 0x80) { u[0] = (uint8_t)cp; n = 1; }
    else if (cp < 0x800) { u[0] = 0xC0 | (cp >> 6); u[1] = 0x80 | (cp & 63); n = 2; }
    else if (cp < 0x10000) { u[0] = 0xE0 | (cp >> 12); u[1] = 0x80 | ((cp >> 6) & 63); u[2] = 0x80 | (cp & 63); n = 3; }
    else { u[0] = 0xF0 | (cp >> 18); u[1] = 0x80 | ((cp >> 12) & 63); u[2] = 0x80 | ((cp >> 6) & 63); u[3] = 0x80 | (cp & 63); n = 4; }
    if (!hbuf_add(&p->avBuf, u, (size_t)n)) p->fail = 1;
}

static void h_on_attrib_end(HP *p) {
    const uint8_t *name = p->s + p->attribNameOff;
    int nlen = (int)p->attribNameLen;
    int skip = 0;
    if (nlen == 9 && memcmp(name, "__proto__", 9) == 0) skip = 1; /* `attribs.__proto__ = "text"` sets nothing */
    for (int i = 0; !skip && i < p->nattrs; i++) {
        if (p->attrs[i].nameLen == nlen && memcmp(p->s + p->attrs[i].nameOff, name, (size_t)nlen) == 0) skip = 1; /* the first wins */
    }
    if (!skip) {
        if (p->nattrs == p->capAttrs) {
            int cap = p->capAttrs ? p->capAttrs * 2 : 16;
            HAttr *a = realloc(p->attrs, sizeof(HAttr) * (size_t)cap);
            if (!a) { p->fail = 1; skip = 1; } else { p->attrs = a; p->capAttrs = cap; }
        }
    }
    if (!skip) {
        HAttr *a = &p->attrs[p->nattrs++];
        a->nameOff = (int32_t)p->attribNameOff;
        a->nameLen = nlen;
        if (p->avMode == 2) {
            a->src = 1;
            a->off = h_extra_add(p, p->avBuf.p, p->avBuf.n);
            a->len = (int32_t)p->avBuf.n;
        } else {
            a->src = 0;
            a->off = p->avMode == 1 ? (int32_t)p->avStart : 0;
            a->len = p->avMode == 1 ? (int32_t)p->avLen : 0;
        }
    }
    p->avMode = 0;
}

/* `!doctype` / `?xml`: the name is what precedes the first whitespace or slash (declined when that is not ASCII) */
static void h_instruction(HP *p, char lead, ptrdiff_t start, ptrdiff_t end) {
    ptrdiff_t i = start;
    for (; i < end; i++) {
        uint8_t c = p->s[i];
        if (c >= 0x80) { p->bail = 1; return; }
        if (c == '/' || c == ' ' || (c >= 9 && c <= 13)) break;
    }
    uint8_t l = (uint8_t)lead;
    int32_t noff = (int32_t)p->extra.n;
    h_extra_add(p, &l, 1);
    for (ptrdiff_t j = start; j < i; j++) {
        uint8_t c = p->s[j];
        uint8_t lc = (c >= 'A' && c <= 'Z') ? c + 32 : c;
        h_extra_add(p, &lc, 1);
    }
    int32_t nlen = (int32_t)(p->extra.n - (size_t)noff);
    int32_t doff = h_extra_add(p, &l, 1);
    h_extra_add(p, p->s + start, (size_t)(end - start));
    h_ev(p, EV_PI);
    h_ev(p, noff);
    h_ev(p, nlen);
    h_ev(p, doff);
    h_ev(p, (int32_t)(1 + end - start));
}

static void h_comment(HP *p, ptrdiff_t start, ptrdiff_t end) {
    h_ev(p, EV_COMMENT);
    h_ev(p, 0);
    h_ev(p, (int32_t)start);
    h_ev(p, end > start ? (int32_t)(end - start) : 0);
}

static void h_cdata_comment(HP *p, ptrdiff_t start, ptrdiff_t end) {
    int32_t off = h_extra_add(p, (const uint8_t *)"[CDATA[", 7);
    if (end > start) h_extra_add(p, p->s + start, (size_t)(end - start));
    h_extra_add(p, (const uint8_t *)"]]", 2);
    h_ev(p, EV_COMMENT);
    h_ev(p, 1);
    h_ev(p, off);
    h_ev(p, (int32_t)((ptrdiff_t)p->extra.n - off));
}

/* ---- Tokenizer ---- */

static int h_ff(HP *p, int c) {
    while (++p->index < p->len) {
        if (p->s[p->index] == c) return 1;
    }
    p->index = p->len - 1;
    return 0;
}

static void h_emit_code_point(HP *p, uint32_t cp, ptrdiff_t consumed) {
    if (p->baseState != S_Text && p->baseState != S_InSpecialTag) {
        if (p->sectionStart < p->entityStart) h_on_attrib_data(p, p->sectionStart, p->entityStart);
        p->sectionStart = p->entityStart + consumed;
        p->index = p->sectionStart - 1;
        h_on_attrib_entity(p, cp);
    } else {
        if (p->sectionStart < p->entityStart) h_text(p, p->sectionStart, p->entityStart);
        p->sectionStart = p->entityStart + consumed;
        p->index = p->sectionStart - 1;
        h_text_cp(p, cp);
    }
}

static void h_start_entity(HP *p) {
    p->baseState = p->state;
    p->state = S_InEntity;
    p->entityStart = p->index;
    HDec r;
    h_decode(p->s, p->len, p->index + 1, (p->baseState == S_Text || p->baseState == S_InSpecialTag) ? DM_LEGACY : DM_ATTRIBUTE, &r);
    if (r.kind == DEC_EOF) {
        /* the input ends inside the entity: finish() emits what end() would */
        p->entityNcp = r.ncp;
        p->entityConsumed = r.consumed;
        for (int i = 0; i < r.ncp; i++) p->entityCp[i] = r.cp[i];
        p->index = p->len - 1;
        return;
    }
    p->entityNcp = 0;
    if (r.kind == DEC_NONE) {
        p->state = p->baseState;
        return; /* the loop's index++ lands on the character after the `&` */
    }
    p->state = p->baseState;
    for (int i = 0; i < r.ncp; i++) h_emit_code_point(p, r.cp[i], r.consumed);
}

static void h_state_text(HP *p, int c) {
    if (c == '<') {
        if (p->index > p->sectionStart) h_text(p, p->sectionStart, p->index);
        p->state = S_BeforeTagName;
        p->sectionStart = p->index;
    } else if (c == '&') h_start_entity(p);
}

static void h_state_in_tag_name(HP *p, int c);
static void h_state_before_attribute_name(HP *p, int c);
static void h_state_in_closing_tag_name(HP *p, int c);
static void h_state_after_closing_tag_name(HP *p, int c);
static void h_state_after_attribute_name(HP *p, int c);

static void h_state_special_start_sequence(HP *p, int c) {
    int isEnd = p->seqIndex == p->curSeqLen;
    int isMatch = isEnd ? h_end_of_tag_section(c) : ((c | 0x20) == p->curSeq[p->seqIndex]);
    if (!isMatch) p->isSpecial = 0;
    else if (!isEnd) {
        p->seqIndex++;
        return;
    }
    p->seqIndex = 0;
    p->state = S_InTagName;
    h_state_in_tag_name(p, c);
}

static void h_state_in_special_tag(HP *p, int c) {
    if (p->seqIndex == p->curSeqLen) {
        if (c == '>' || h_ws(c)) {
            ptrdiff_t endOfText = p->index - (ptrdiff_t)p->curSeqLen;
            if (p->sectionStart < endOfText) {
                ptrdiff_t actual = p->index;
                p->index = endOfText;
                h_text(p, p->sectionStart, endOfText);
                p->index = actual;
            }
            p->isSpecial = 0;
            p->sectionStart = endOfText + 2;
            h_state_in_closing_tag_name(p, c);
            return;
        }
        p->seqIndex = 0;
    }
    if ((c | 0x20) == p->curSeq[p->seqIndex]) {
        p->seqIndex += 1;
    } else if (p->seqIndex == 0) {
        if (p->curSeq == SEQ_TITLE_END || p->curSeq == SEQ_TEXTAREA_END) { /* RCDATA: character references are decoded */
            if (c == '&') h_start_entity(p);
        } else if (h_ff(p, '<')) p->seqIndex = 1;
    } else {
        p->seqIndex = c == '<';
    }
}

static void h_state_in_declaration(HP *p, int c);

static void h_state_cdata_sequence(HP *p, int c) {
    if (c == SEQ_CDATA[p->seqIndex]) {
        if (++p->seqIndex == sizeof(SEQ_CDATA)) {
            p->state = S_InCommentLike;
            p->curSeq = SEQ_CDATA_END;
            p->curSeqLen = sizeof(SEQ_CDATA_END);
            p->seqIndex = 0;
            p->sectionStart = p->index + 1;
        }
    } else {
        p->seqIndex = 0;
        p->state = S_InDeclaration;
        h_state_in_declaration(p, c);
    }
}

static void h_state_in_comment_like(HP *p, int c) {
    if (c == p->curSeq[p->seqIndex]) {
        if (++p->seqIndex == p->curSeqLen) {
            if (p->curSeq == SEQ_CDATA_END) h_cdata_comment(p, p->sectionStart, p->index - 2);
            else h_comment(p, p->sectionStart, p->index - 2);
            p->seqIndex = 0;
            p->sectionStart = p->index + 1;
            p->state = S_Text;
        }
    } else if (p->seqIndex == 0) {
        if (h_ff(p, p->curSeq[0])) p->seqIndex = 1;
    } else if (c != p->curSeq[p->seqIndex - 1]) {
        p->seqIndex = 0;
    }
}

static void h_start_special(HP *p, const uint8_t *seq, size_t seqLen, size_t offset) {
    p->isSpecial = 1;
    p->curSeq = seq;
    p->curSeqLen = seqLen;
    p->seqIndex = offset;
    p->state = S_SpecialStartSequence;
}

static void h_state_before_tag_name(HP *p, int c) {
    if (c == '!') {
        p->state = S_BeforeDeclaration;
        p->sectionStart = p->index + 1;
    } else if (c == '?') {
        p->state = S_InProcessingInstruction;
        p->sectionStart = p->index + 1;
    } else if (h_alpha(c)) {
        int lower = c | 0x20;
        p->sectionStart = p->index;
        if (lower == SEQ_SCRIPT_END[2]) p->state = S_BeforeSpecialS;
        else if (lower == SEQ_TITLE_END[2] || lower == SEQ_XMP_END[2]) p->state = S_BeforeSpecialT;
        else p->state = S_InTagName;
    } else if (c == '/') {
        p->state = S_BeforeClosingTagName;
    } else {
        p->state = S_Text;
        h_state_text(p, c);
    }
}

static void h_state_in_tag_name(HP *p, int c) {
    if (h_end_of_tag_section(c)) {
        h_on_open_tag_name(p, p->sectionStart, p->index);
        p->sectionStart = -1;
        p->state = S_BeforeAttributeName;
        h_state_before_attribute_name(p, c);
    }
}

static void h_state_before_closing_tag_name(HP *p, int c) {
    if (h_ws(c)) {
    } else if (c == '>') {
        p->state = S_Text;
    } else {
        p->state = h_alpha(c) ? S_InClosingTagName : S_InSpecialComment;
        p->sectionStart = p->index;
    }
}

static void h_state_in_closing_tag_name(HP *p, int c) {
    if (c == '>' || h_ws(c)) {
        h_on_close_tag(p, p->sectionStart, p->index);
        p->sectionStart = -1;
        p->state = S_AfterClosingTagName;
        h_state_after_closing_tag_name(p, c);
    }
}

static void h_state_after_closing_tag_name(HP *p, int c) {
    if (c == '>' || h_ff(p, '>')) {
        p->state = S_Text;
        p->sectionStart = p->index + 1;
    }
}

static void h_state_before_attribute_name(HP *p, int c) {
    if (c == '>') {
        h_on_open_tag_end(p);
        if (p->isSpecial) {
            p->state = S_InSpecialTag;
            p->seqIndex = 0;
        } else p->state = S_Text;
        p->sectionStart = p->index + 1;
    } else if (c == '/') {
        p->state = S_InSelfClosingTag;
    } else if (!h_ws(c)) {
        p->state = S_InAttributeName;
        p->sectionStart = p->index;
    }
}

static void h_state_in_self_closing_tag(HP *p, int c) {
    if (c == '>') {
        h_on_self_closing_tag(p);
        p->state = S_Text;
        p->sectionStart = p->index + 1;
        p->isSpecial = 0;
    } else if (!h_ws(c)) {
        p->state = S_BeforeAttributeName;
        h_state_before_attribute_name(p, c);
    }
}

static void h_state_in_attribute_name(HP *p, int c) {
    if (c == '=' || h_end_of_tag_section(c)) {
        h_on_attrib_name(p, p->sectionStart, p->index);
        p->sectionStart = p->index;
        p->state = S_AfterAttributeName;
        h_state_after_attribute_name(p, c);
    }
}

static void h_state_after_attribute_name(HP *p, int c) {
    if (c == '=') {
        p->state = S_BeforeAttributeValue;
    } else if (c == '/' || c == '>') {
        h_on_attrib_end(p);
        p->sectionStart = -1;
        p->state = S_BeforeAttributeName;
        h_state_before_attribute_name(p, c);
    } else if (!h_ws(c)) {
        h_on_attrib_end(p);
        p->state = S_InAttributeName;
        p->sectionStart = p->index;
    }
}

static void h_state_in_attribute_value_nq(HP *p, int c) {
    if (h_ws(c) || c == '>') {
        h_on_attrib_data(p, p->sectionStart, p->index);
        p->sectionStart = -1;
        h_on_attrib_end(p);
        p->state = S_BeforeAttributeName;
        h_state_before_attribute_name(p, c);
    } else if (c == '&') h_start_entity(p);
}

static void h_state_before_attribute_value(HP *p, int c) {
    if (c == '"') {
        p->state = S_InAttributeValueDq;
        p->sectionStart = p->index + 1;
    } else if (c == '\'') {
        p->state = S_InAttributeValueSq;
        p->sectionStart = p->index + 1;
    } else if (!h_ws(c)) {
        p->sectionStart = p->index;
        p->state = S_InAttributeValueNq;
        h_state_in_attribute_value_nq(p, c);
    }
}

static void h_handle_in_attribute_value(HP *p, int c, int quote) {
    if (c == quote) {
        h_on_attrib_data(p, p->sectionStart, p->index);
        p->sectionStart = -1;
        h_on_attrib_end(p);
        p->state = S_BeforeAttributeName;
    } else if (c == '&') h_start_entity(p);
}

static void h_state_before_declaration(HP *p, int c) {
    if (c == '[') {
        p->state = S_CDATASequence;
        p->seqIndex = 0;
    } else p->state = c == '-' ? S_BeforeComment : S_InDeclaration;
}

static void h_state_in_declaration(HP *p, int c) {
    if (c == '>' || h_ff(p, '>')) {
        h_instruction(p, '!', p->sectionStart, p->index);
        p->state = S_Text;
        p->sectionStart = p->index + 1;
    }
}

static void h_state_in_processing_instruction(HP *p, int c) {
    if (c == '>' || h_ff(p, '>')) {
        h_instruction(p, '?', p->sectionStart, p->index);
        p->state = S_Text;
        p->sectionStart = p->index + 1;
    }
}

static void h_state_before_comment(HP *p, int c) {
    if (c == '-') {
        p->state = S_InCommentLike;
        p->curSeq = SEQ_COMMENT_END;
        p->curSeqLen = sizeof(SEQ_COMMENT_END);
        p->seqIndex = 2;
        p->sectionStart = p->index + 1;
    } else p->state = S_InDeclaration;
}

static void h_state_in_special_comment(HP *p, int c) {
    if (c == '>' || h_ff(p, '>')) {
        h_comment(p, p->sectionStart, p->index);
        p->state = S_Text;
        p->sectionStart = p->index + 1;
    }
}

static void h_state_before_special_s(HP *p, int c) {
    int lower = c | 0x20;
    if (lower == SEQ_SCRIPT_END[3]) h_start_special(p, SEQ_SCRIPT_END, sizeof(SEQ_SCRIPT_END), 4);
    else if (lower == SEQ_STYLE_END[3]) h_start_special(p, SEQ_STYLE_END, sizeof(SEQ_STYLE_END), 4);
    else {
        p->state = S_InTagName;
        h_state_in_tag_name(p, c);
    }
}

static void h_state_before_special_t(HP *p, int c) {
    int lower = c | 0x20;
    if (lower == SEQ_TITLE_END[3]) h_start_special(p, SEQ_TITLE_END, sizeof(SEQ_TITLE_END), 4);
    else if (lower == SEQ_TEXTAREA_END[3]) h_start_special(p, SEQ_TEXTAREA_END, sizeof(SEQ_TEXTAREA_END), 4);
    else if (lower == SEQ_XMP_END[3]) h_start_special(p, SEQ_XMP_END, sizeof(SEQ_XMP_END), 4);
    else {
        p->state = S_InTagName;
        h_state_in_tag_name(p, c);
    }
}

static void h_cleanup(HP *p) {
    if (p->sectionStart != p->index) {
        if (p->state == S_Text || (p->state == S_InSpecialTag && p->seqIndex == 0)) {
            h_text(p, p->sectionStart, p->index);
            p->sectionStart = p->index;
        }
        /* attribute data cut off by the end of the input belongs to a tag that never ends, which is dropped */
    }
}

static void h_handle_trailing_data(HP *p) {
    ptrdiff_t endIndex = p->len;
    if (p->sectionStart >= endIndex) return;
    int st = p->state;
    if (st == S_InCommentLike) {
        if (p->curSeq == SEQ_CDATA_END) h_cdata_comment(p, p->sectionStart, endIndex);
        else h_comment(p, p->sectionStart, endIndex);
    } else if (st == S_InTagName || st == S_BeforeAttributeName || st == S_BeforeAttributeValue || st == S_AfterAttributeName ||
               st == S_InAttributeName || st == S_InAttributeValueSq || st == S_InAttributeValueDq || st == S_InAttributeValueNq ||
               st == S_InClosingTagName) {
        /* an unfinished tag is ignored */
    } else h_text(p, p->sectionStart, endIndex);
}

static void h_finish(HP *p) {
    if (p->state == S_InEntity) {
        for (int i = 0; i < p->entityNcp; i++) h_emit_code_point(p, p->entityCp[i], p->entityConsumed);
        p->state = p->baseState;
    }
    h_handle_trailing_data(p);
    for (int i = p->nstack - 1; i >= 0; i--) h_close(p); /* onend: every tag still open */
}

static void h_run(HP *p) {
    const uint8_t *s = p->s;
    while (p->index < p->len && !p->fail && !p->bail) {
        int c = s[p->index];
        switch (p->state) {
        case S_Text:
            /* skip to the next `<` or `&` */
            if (c != '<' && c != '&') {
                ptrdiff_t i = p->index + 1;
                while (i < p->len && s[i] != '<' && s[i] != '&') i++;
                p->index = i;
                continue;
            }
            h_state_text(p, c);
            break;
        case S_SpecialStartSequence: h_state_special_start_sequence(p, c); break;
        case S_InSpecialTag: h_state_in_special_tag(p, c); break;
        case S_CDATASequence: h_state_cdata_sequence(p, c); break;
        case S_InAttributeValueDq:
            if (c != '"' && c != '&') {
                ptrdiff_t i = p->index + 1;
                while (i < p->len && s[i] != '"' && s[i] != '&') i++;
                p->index = i;
                continue;
            }
            h_handle_in_attribute_value(p, c, '"');
            break;
        case S_InAttributeName: h_state_in_attribute_name(p, c); break;
        case S_InCommentLike: h_state_in_comment_like(p, c); break;
        case S_InSpecialComment: h_state_in_special_comment(p, c); break;
        case S_BeforeAttributeName: h_state_before_attribute_name(p, c); break;
        case S_InTagName: h_state_in_tag_name(p, c); break;
        case S_InClosingTagName: h_state_in_closing_tag_name(p, c); break;
        case S_BeforeTagName: h_state_before_tag_name(p, c); break;
        case S_AfterAttributeName: h_state_after_attribute_name(p, c); break;
        case S_InAttributeValueSq:
            if (c != '\'' && c != '&') {
                ptrdiff_t i = p->index + 1;
                while (i < p->len && s[i] != '\'' && s[i] != '&') i++;
                p->index = i;
                continue;
            }
            h_handle_in_attribute_value(p, c, '\'');
            break;
        case S_BeforeAttributeValue: h_state_before_attribute_value(p, c); break;
        case S_BeforeClosingTagName: h_state_before_closing_tag_name(p, c); break;
        case S_AfterClosingTagName: h_state_after_closing_tag_name(p, c); break;
        case S_BeforeSpecialS: h_state_before_special_s(p, c); break;
        case S_BeforeSpecialT: h_state_before_special_t(p, c); break;
        case S_InAttributeValueNq: h_state_in_attribute_value_nq(p, c); break;
        case S_InSelfClosingTag: h_state_in_self_closing_tag(p, c); break;
        case S_InDeclaration: h_state_in_declaration(p, c); break;
        case S_BeforeDeclaration: h_state_before_declaration(p, c); break;
        case S_BeforeComment: h_state_before_comment(p, c); break;
        case S_InProcessingInstruction: h_state_in_processing_instruction(p, c); break;
        case S_InEntity: break; /* only reached through the end of the input */
        }
        p->index++;
    }
    if (p->fail || p->bail) return;
    h_cleanup(p);
    h_finish(p);
}

/* ---- the JS side: __native.parseHTML(markup, handlers) -> true when it parsed, false when the caller must use htmlparser2 ---- */

static void hp_free(HP *p) {
    free(p->stack);
    free(p->foreign);
    free(p->attrs);
    free(p->avBuf.p);
    free(p->ev.v);
    free(p->extra.p);
}

static JSValue h_str(JSContext *c, HP *p, int32_t src, int32_t off, int32_t len) {
    return JS_NewStringLen(c, (const char *)((src ? p->extra.p : p->s) + off), (size_t)len);
}

static JSValue native_parse_html(JSContext *c, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;
    if (argc < 2 || !JS_IsString(argv[0]) || !JS_IsObject(argv[1])) return JS_FALSE;
    size_t len;
    const char *src = JS_ToCStringLen(c, &len, argv[0]);
    if (!src) return JS_EXCEPTION;
    if (len >= 0x7fffffff / 4) {
        JS_FreeCString(c, src);
        return JS_FALSE;
    }
    /* a lone surrogate would not survive the trip through UTF-8 */
    for (size_t i = 0; i + 1 < len; i++) {
        if ((uint8_t)src[i] == 0xED && ((uint8_t)src[i + 1] & 0xE0) == 0xA0) {
            JS_FreeCString(c, src);
            return JS_FALSE;
        }
    }

    HP p;
    memset(&p, 0, sizeof(p));
    p.s = (const uint8_t *)src;
    p.len = (ptrdiff_t)len;
    p.state = S_Text;
    p.baseState = S_Text;
    h_foreign_push(&p, 0); /* foreignContext starts as [!htmlMode] */
    h_run(&p);
    if (p.fail || p.bail) {
        int fail = p.fail;
        hp_free(&p);
        JS_FreeCString(c, src);
        return fail ? JS_ThrowOutOfMemory(c) : JS_FALSE;
    }

    JSValue onopen = JS_GetPropertyStr(c, argv[1], "onopentag");
    JSValue onclose = JS_GetPropertyStr(c, argv[1], "onclosetag");
    JSValue ontext = JS_GetPropertyStr(c, argv[1], "ontext");
    JSValue oncomment = JS_GetPropertyStr(c, argv[1], "oncomment");
    JSValue onpi = JS_GetPropertyStr(c, argv[1], "onprocessinginstruction");
    JSValue result = JS_TRUE;
    const int32_t *ev = p.ev.v;
    size_t n = p.ev.n;
    for (size_t i = 0; i < n;) {
        JSValue args[2], r;
        switch (ev[i]) {
        case EV_TEXT:
        case EV_COMMENT: {
            JSValue fn = ev[i] == EV_TEXT ? ontext : oncomment;
            if (JS_IsFunction(c, fn)) {
                args[0] = h_str(c, &p, ev[i + 1], ev[i + 2], ev[i + 3]);
                r = JS_Call(c, fn, JS_UNDEFINED, 1, args);
                JS_FreeValue(c, args[0]);
                if (JS_IsException(r)) { result = r; goto done; }
                JS_FreeValue(c, r);
            }
            i += 4;
            break;
        }
        case EV_OPEN: {
            int nattrs = ev[i + 3];
            if (JS_IsFunction(c, onopen)) {
                JSValue obj = JS_NewObject(c);
                for (int k = 0; k < nattrs; k++) {
                    const int32_t *a = &ev[i + 4 + k * 5];
                    JSAtom atom = JS_NewAtomLen(c, (const char *)p.s + a[0], (size_t)a[1]);
                    JSValue v = h_str(c, &p, a[2], a[3], a[4]);
                    JS_DefinePropertyValue(c, obj, atom, v, JS_PROP_C_W_E);
                    JS_FreeAtom(c, atom);
                }
                args[0] = h_str(c, &p, 1, ev[i + 1], ev[i + 2]);
                args[1] = obj;
                r = JS_Call(c, onopen, JS_UNDEFINED, 2, args);
                JS_FreeValue(c, args[0]);
                JS_FreeValue(c, obj);
                if (JS_IsException(r)) { result = r; goto done; }
                JS_FreeValue(c, r);
            }
            i += 4 + (size_t)nattrs * 5;
            break;
        }
        case EV_CLOSE:
            if (JS_IsFunction(c, onclose)) {
                r = JS_Call(c, onclose, JS_UNDEFINED, 0, NULL);
                if (JS_IsException(r)) { result = r; goto done; }
                JS_FreeValue(c, r);
            }
            i += 1;
            break;
        case EV_PI:
            if (JS_IsFunction(c, onpi)) {
                args[0] = h_str(c, &p, 1, ev[i + 1], ev[i + 2]);
                args[1] = h_str(c, &p, 1, ev[i + 3], ev[i + 4]);
                r = JS_Call(c, onpi, JS_UNDEFINED, 2, args);
                JS_FreeValue(c, args[0]);
                JS_FreeValue(c, args[1]);
                if (JS_IsException(r)) { result = r; goto done; }
                JS_FreeValue(c, r);
            }
            i += 5;
            break;
        default:
            i = n;
        }
    }
done:
    JS_FreeValue(c, onopen);
    JS_FreeValue(c, onclose);
    JS_FreeValue(c, ontext);
    JS_FreeValue(c, oncomment);
    JS_FreeValue(c, onpi);
    hp_free(&p);
    JS_FreeCString(c, src);
    return result;
}
