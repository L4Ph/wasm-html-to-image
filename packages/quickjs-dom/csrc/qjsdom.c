/*
 * The QuickJS side of wasm-quickjs-dom: one runtime and one context per wasm instance, driven by src/runtime.ts.
 *
 * Built as a standalone wasm (no Emscripten JS glue), so the host instantiates it with a plain
 * `new WebAssembly.Instance(module, imports)`, which is what Cloudflare Workers allow. A page gets an instance of its
 * own; dropping the instance frees everything, so nothing here ever frees the runtime.
 *
 * Strings cross the boundary as UTF-8 in linear memory:
 *   - the host puts input in a buffer from qd_alloc() (NUL-terminated for qd_eval) and passes pointer and length,
 *   - results come back through qd_result_*(), and the host's replies to module requests through qd_scratch().
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "quickjs.h"

#define EXPORT(name) __attribute__((export_name(name)))
#define IMPORT(name) __attribute__((import_module("host"), import_name(name)))

enum { OP_LOG = 0, OP_TIMER = 1, OP_FETCH = 2, OP_REJECTION = 3 };
enum { RES_UNDEFINED = 0, RES_STRING = 1, RES_JSON = 2, RES_ERROR = 3, RES_BYTES = 4 };

/* log(level, message) / timer(id, ms) / fetch(id, target, method): see runtime.ts */
IMPORT("call") extern void host_call(int op, int n1, int n2, const char *a, int alen, const char *b, int blen);
/* kind 0: normalize(base, name) -> specifier; kind 1: load(name, "") -> source; kind 2: the bridge's callback(id, args) ->
   reply (see __host.callback). The reply is put in qd_scratch(); returns its length, or -1 when there is none (the host
   has no such module / callback). */
IMPORT("module") extern int host_module(int kind, const char *a, int alen, const char *b, int blen);

static JSRuntime *rt;
static JSContext *ctx;
static double deadline_ms;

static JSValue cached_rpc_fn = JS_UNDEFINED;
static JSValue cached_reply_fn = JS_UNDEFINED;
static JSValue cached_error_fn = JS_UNDEFINED;
static JSValue cached_host_fn = JS_UNDEFINED;
static JSValue cached_byid = JS_UNDEFINED;
static JSContext *cached_ctx = NULL;

static void reset_rpc_cache(void) {
    if (cached_ctx) {
        if (!JS_IsUndefined(cached_rpc_fn)) JS_FreeValue(cached_ctx, cached_rpc_fn);
        if (!JS_IsUndefined(cached_reply_fn)) JS_FreeValue(cached_ctx, cached_reply_fn);
        if (!JS_IsUndefined(cached_error_fn)) JS_FreeValue(cached_ctx, cached_error_fn);
        if (!JS_IsUndefined(cached_host_fn)) JS_FreeValue(cached_ctx, cached_host_fn);
        if (!JS_IsUndefined(cached_byid)) JS_FreeValue(cached_ctx, cached_byid);
    }
    cached_rpc_fn = JS_UNDEFINED;
    cached_reply_fn = JS_UNDEFINED;
    cached_error_fn = JS_UNDEFINED;
    cached_host_fn = JS_UNDEFINED;
    cached_byid = JS_UNDEFINED;
    cached_ctx = NULL;
}

static void update_rpc_cache(void) {
    if (cached_ctx != ctx || JS_IsUndefined(cached_rpc_fn)) {
        reset_rpc_cache();
        cached_ctx = ctx;
        JSValue global = JS_GetGlobalObject(ctx);
        cached_rpc_fn = JS_GetPropertyStr(ctx, global, "__rpc");
        cached_host_fn = JS_GetPropertyStr(ctx, global, "__rpcHostFunction");
        cached_reply_fn = JS_GetPropertyStr(ctx, global, "__reply");
        cached_error_fn = JS_GetPropertyStr(ctx, global, "__rpcError");
        cached_byid = JS_GetPropertyStr(ctx, global, "__byId");
        JS_FreeValue(ctx, global);
    }
}

static uint8_t *scratch;
static size_t scratch_cap;

static uint8_t *result;
static size_t result_len;
static int result_type;

typedef struct {
    JSValue resolve, reject;
    int used;
} Pending;
static Pending *pending;
static int pending_count, pending_cap;

EXPORT("qd_alloc") void *qd_alloc(size_t n) { return malloc(n ? n : 1); }
EXPORT("qd_free") void qd_free(void *p) { free(p); }

EXPORT("qd_scratch") uint8_t *qd_scratch(size_t n) {
    if (n > scratch_cap) {
        free(scratch);
        scratch_cap = n < 4096 ? 4096 : n;
        scratch = malloc(scratch_cap);
    }
    return scratch;
}

EXPORT("qd_result_ptr") const uint8_t *qd_result_ptr(void) { return result; }
EXPORT("qd_result_len") size_t qd_result_len(void) { return result_len; }
EXPORT("qd_result_type") int qd_result_type(void) { return result_type; }

static void set_result(int type, const void *data, size_t len) {
    free(result);
    result = malloc(len + 1);
    if (len) memcpy(result, data, len);
    result[len] = 0;
    result_len = len;
    result_type = type;
}

static void set_result_value(JSValueConst v) {
    if (JS_IsUndefined(v)) {
        set_result(RES_UNDEFINED, "", 0);
    } else if (JS_IsString(v)) {
        size_t len;
        const char *s = JS_ToCStringLen(ctx, &len, v);
        if (!s) {
            set_result(RES_UNDEFINED, "", 0);
            return;
        }
        set_result(RES_STRING, s, len);
        JS_FreeCString(ctx, s);
    } else {
        JSValue json = JS_JSONStringify(ctx, v, JS_UNDEFINED, JS_UNDEFINED);
        if (JS_IsException(json)) {
            JS_FreeValue(ctx, JS_GetException(ctx));
            set_result(RES_UNDEFINED, "", 0);
            return;
        }
        if (JS_IsString(json)) {
            size_t len;
            const char *s = JS_ToCStringLen(ctx, &len, json);
            set_result(RES_JSON, s ? s : "", s ? len : 0);
            if (s) JS_FreeCString(ctx, s);
        } else {
            set_result(RES_UNDEFINED, "", 0);
        }
        JS_FreeValue(ctx, json);
    }
}

/* "Name: message\nstack" of a thrown value (malloc'd; free() it) */
static char *describe(JSValueConst v) {
    char *out;
    if (JS_IsObject(v)) {
        JSValue name = JS_GetPropertyStr(ctx, v, "name");
        JSValue message = JS_GetPropertyStr(ctx, v, "message");
        JSValue stack = JS_GetPropertyStr(ctx, v, "stack");
        const char *n = JS_IsString(name) ? JS_ToCString(ctx, name) : NULL;
        const char *m = JS_IsString(message) ? JS_ToCString(ctx, message) : NULL;
        const char *st = JS_IsString(stack) ? JS_ToCString(ctx, stack) : NULL;
        size_t cap = (n ? strlen(n) : 0) + (m ? strlen(m) : 0) + (st ? strlen(st) : 0) + 8;
        out = malloc(cap);
        out[0] = 0;
        if (n) strcat(out, n);
        if (m) {
            if (n) strcat(out, ": ");
            strcat(out, m);
        }
        if (st) {
            strcat(out, "\n");
            strcat(out, st);
        }
        if (n) JS_FreeCString(ctx, n);
        if (m) JS_FreeCString(ctx, m);
        if (st) JS_FreeCString(ctx, st);
        JS_FreeValue(ctx, name);
        JS_FreeValue(ctx, message);
        JS_FreeValue(ctx, stack);
    } else {
        const char *t = JS_ToCString(ctx, v);
        out = strdup(t ? t : "");
        if (t) JS_FreeCString(ctx, t);
    }
    return out;
}

/* the pending exception becomes the result; clears it */
static void set_result_error(void) {
    JSValue exc = JS_GetException(ctx);
    char *text = describe(exc);
    set_result(RES_ERROR, text, strlen(text));
    free(text);
    JS_FreeValue(ctx, exc);
}

/* ---- promises rejected with nobody to handle them ---- */

typedef struct {
    JSValue promise, reason;
} Rejected;
static Rejected *rejected;
static int rejected_count, rejected_cap;

static void rejection_tracker(JSContext *c, JSValueConst promise, JSValueConst reason, bool is_handled, void *opaque) {
    (void)c;
    (void)opaque;
    if (!is_handled) {
        if (rejected_count == rejected_cap) {
            rejected_cap = rejected_cap ? rejected_cap * 2 : 8;
            rejected = realloc(rejected, sizeof(Rejected) * (size_t)rejected_cap);
        }
        rejected[rejected_count].promise = JS_DupValue(ctx, promise);
        rejected[rejected_count].reason = JS_DupValue(ctx, reason);
        rejected_count++;
        return;
    }
    for (int i = 0; i < rejected_count; i++) {
        if (JS_VALUE_GET_PTR(rejected[i].promise) == JS_VALUE_GET_PTR(promise)) {
            JS_FreeValue(ctx, rejected[i].promise);
            JS_FreeValue(ctx, rejected[i].reason);
            rejected[i] = rejected[--rejected_count];
            return;
        }
    }
}

/* the ones still unhandled once the jobs have run are reported, as a browser reports "unhandledrejection" */
static void flush_rejections(void) {
    int n = rejected_count;
    rejected_count = 0;
    for (int i = 0; i < n; i++) {
        char *text = describe(rejected[i].reason);
        host_call(OP_REJECTION, 0, 0, text, (int)strlen(text), "", 0);
        free(text);
        JS_FreeValue(ctx, rejected[i].promise);
        JS_FreeValue(ctx, rejected[i].reason);
    }
}

static int interrupt_handler(JSContext *c, void *opaque) {
    (void)c;
    (void)opaque;
    struct timespec t;
    clock_gettime(CLOCK_REALTIME, &t);
    return deadline_ms > 0 && (double)t.tv_sec * 1000.0 + (double)t.tv_nsec / 1e6 > deadline_ms;
}

/* ---- modules: the host serves the sources; QuickJS loads them synchronously ---- */

static char *module_normalize(JSContext *c, const char *base, const char *name, void *opaque) {
    (void)opaque;
    int n = host_module(0, base, (int)strlen(base), name, (int)strlen(name));
    if (n < 0) {
        JS_ThrowReferenceError(c, "could not resolve module '%s'", name);
        return NULL;
    }
    char *out = js_malloc(c, (size_t)n + 1);
    if (!out) return NULL;
    memcpy(out, scratch, (size_t)n);
    out[n] = 0;
    return out;
}

static JSModuleDef *module_loader(JSContext *c, const char *name, void *opaque) {
    (void)opaque;
    int n = host_module(1, name, (int)strlen(name), "", 0);
    if (n < 0) {
        JS_ThrowReferenceError(c, "could not load module '%s'", name);
        return NULL;
    }
    char *src = malloc((size_t)n + 1);
    memcpy(src, scratch, (size_t)n);
    src[n] = 0;
    JSValue func = JS_Eval(c, src, (size_t)n, name, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    free(src);
    if (JS_IsException(func)) return NULL;
    JSModuleDef *m = JS_VALUE_GET_PTR(func);
    JS_FreeValue(c, func);
    return m;
}

/* ---- __host: what the page's shims call out to ---- */

static JSValue host_log(JSContext *c, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;
    if (argc < 2) return JS_UNDEFINED;
    size_t la, lb;
    const char *a = JS_ToCStringLen(c, &la, argv[0]);
    const char *b = JS_ToCStringLen(c, &lb, argv[1]);
    if (a && b) host_call(OP_LOG, 0, 0, a, (int)la, b, (int)lb);
    if (a) JS_FreeCString(c, a);
    if (b) JS_FreeCString(c, b);
    return JS_UNDEFINED;
}

static JSValue host_timer(JSContext *c, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;
    if (argc < 2) return JS_UNDEFINED;
    double id = 0, ms = 0;
    JS_ToFloat64(c, &id, argv[0]);
    JS_ToFloat64(c, &ms, argv[1]);
    host_call(OP_TIMER, (int)id, (int)ms, "", 0, "", 0);
    return JS_UNDEFINED;
}

static JSValue host_fetch(JSContext *c, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;
    if (argc < 2) return JS_UNDEFINED;
    JSValue funcs[2];
    JSValue promise = JS_NewPromiseCapability(c, funcs);
    if (JS_IsException(promise)) return promise;
    int id = -1;
    for (int i = 0; i < pending_count; i++) {
        if (!pending[i].used) {
            id = i;
            break;
        }
    }
    if (id < 0) {
        if (pending_count == pending_cap) {
            pending_cap = pending_cap ? pending_cap * 2 : 16;
            pending = realloc(pending, sizeof(Pending) * (size_t)pending_cap);
        }
        id = pending_count++;
    }
    pending[id].resolve = funcs[0];
    pending[id].reject = funcs[1];
    pending[id].used = 1;
    size_t la, lb;
    const char *a = JS_ToCStringLen(c, &la, argv[0]);
    const char *b = JS_ToCStringLen(c, &lb, argv[1]);
    host_call(OP_FETCH, id, 0, a ? a : "", a ? (int)la : 0, b ? b : "", b ? (int)lb : 0);
    if (a) JS_FreeCString(c, a);
    if (b) JS_FreeCString(c, b);
    return promise;
}

/* __host.callback(id, args): a call into a function of the host's, answered at once (the bridge: a listener that
   lives in Node). Both are strings; the reply is a string, or undefined when the host has none. */
static JSValue host_callback(JSContext *c, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;
    if (argc < 2) return JS_UNDEFINED;
    size_t la, lb;
    const char *a = JS_ToCStringLen(c, &la, argv[0]);
    const char *b = JS_ToCStringLen(c, &lb, argv[1]);
    JSValue out = JS_UNDEFINED;
    if (a && b) {
        int n = host_module(2, a, (int)la, b, (int)lb);
        if (n >= 0) out = JS_NewStringLen(c, (const char *)scratch, (size_t)n);
    }
    if (a) JS_FreeCString(c, a);
    if (b) JS_FreeCString(c, b);
    return out;
}

/* ---- __native: parts of the page's environment that are faster in C than in the interpreter ---- */

#include "htmlparse.h"
#include "nativedom.h"

/* ---- exports ---- */

/* memory_limit: bytes QuickJS may allocate; stack_limit: bytes of C stack a script may use */
EXPORT("qd_init") int qd_init(size_t memory_limit, size_t stack_limit) {
    reset_rpc_cache();
    rt = JS_NewRuntime();
    if (!rt) return -1;
    JS_SetMemoryLimit(rt, memory_limit);
    JS_SetMaxStackSize(rt, stack_limit);
    JS_SetInterruptHandler(rt, interrupt_handler, NULL);
    JS_SetHostPromiseRejectionTracker(rt, rejection_tracker, NULL);
    JS_SetModuleLoaderFunc(rt, module_normalize, module_loader, NULL);
    ctx = JS_NewContext(rt);
    if (!ctx) return -1;
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue host = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, host, "log", JS_NewCFunction(ctx, host_log, "log", 2));
    JS_SetPropertyStr(ctx, host, "timer", JS_NewCFunction(ctx, host_timer, "timer", 2));
    JS_SetPropertyStr(ctx, host, "fetch", JS_NewCFunction(ctx, host_fetch, "fetch", 2));
    JS_SetPropertyStr(ctx, host, "callback", JS_NewCFunction(ctx, host_callback, "callback", 2));
    JS_SetPropertyStr(ctx, global, "__host", host);
    JSValue native = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, native, "parseHTML", JS_NewCFunction(ctx, native_parse_html, "parseHTML", 2));
    nd_register(ctx, native);
    JS_SetPropertyStr(ctx, global, "__native", native);
    JS_FreeValue(ctx, global);
    return 0;
}

/* the wall-clock time (ms since the epoch) after which running script is interrupted; 0 = never */
EXPORT("qd_set_deadline") void qd_set_deadline(double ms) { deadline_ms = ms; }

/* Evaluate NUL-terminated code (as a module when `module`). 0: ok, the value is in qd_result_*; 1: it threw. */
EXPORT("qd_eval") int qd_eval(const char *code, size_t len, const char *name, int module) {
    JSValue v = JS_Eval(ctx, code, len, name, module ? JS_EVAL_TYPE_MODULE : JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(v)) {
        set_result_error();
        return 1;
    }
    if (module) set_result(RES_UNDEFINED, "", 0);
    else set_result_value(v);
    JS_FreeValue(ctx, v);
    return 0;
}

/* Call the global function __rpc (scripts/edge-js/rpc.js) with a string; its string answer is the result. This is the way in
   for the bridge: no code to compile, and it may be called again from inside a host callback. 0: ok; 1: it threw. */
static JSValue rpc_decode_token(JSContext *c, JSValueConst byid, const char *p, size_t toklen) {
    if (toklen == 0) return JS_UNDEFINED;
    char tc = p[0];
    if (tc == 'N') return JS_NULL;
    if (tc == 'T') return JS_TRUE;
    if (tc == 'F') return JS_FALSE;
    if (tc == 's') return JS_NewStringLen(c, p + 1, toklen - 1);
    if (tc == 'n') {
        char buf[32];
        size_t copylen = toklen - 1 < sizeof(buf) - 1 ? toklen - 1 : sizeof(buf) - 1;
        memcpy(buf, p + 1, copylen);
        buf[copylen] = 0;
        return JS_NewFloat64(c, strtod(buf, NULL));
    }
    if (tc == 'h') {
        uint32_t hid = 0;
        for (size_t k = 1; k < toklen; k++) hid = hid * 10 + (uint32_t)(p[k] - '0');
        return JS_GetPropertyUint32(c, byid, hid);
    }
    if (tc == 'f') {
        double fid = 0;
        for (size_t k = 1; k < toklen; k++) fid = fid * 10 + (p[k] - '0');
        JSValue arg = JS_NewFloat64(c, fid);
        JSValue r = JS_Call(c, cached_host_fn, JS_UNDEFINED, 1, &arg);
        return r;
    }
    return JS_UNDEFINED;
}

/* Reads (g) and method calls without arguments (c) of the bridge are done here: the interpreter has nothing to do for them
   unless the answer is an object (rpc.js: __reply makes its handle). The handle table is the array __byId of rpc.js. */
static int rpc_set_prefixed(char prefix, const char *s, size_t n) {
    free(result);
    result = malloc(n + 2);
    result[0] = (uint8_t)prefix;
    if (n) memcpy(result + 1, s, n);
    result[n + 1] = 0;
    result_len = n + 1;
    result_type = RES_STRING;
    return 0;
}

static int rpc_slow(JSValueConst fn, const char *req, size_t len) {
    JSValue arg = JS_NewStringLen(ctx, req, len);
    JSValue v = JS_Call(ctx, fn, JS_UNDEFINED, 1, &arg);
    JS_FreeValue(ctx, arg);
    if (JS_IsException(v)) {
        set_result_error();
        return 1;
    }
    set_result_value(v);
    JS_FreeValue(ctx, v);
    return 0;
}

/* the answer for value v (consumed): primitives here, an object through __reply */
static int rpc_answer(JSValue v, JSValueConst reply_fn) {
    int tag = JS_VALUE_GET_TAG(v);
    if (tag == JS_TAG_STRING) {
        size_t n;
        const char *s = JS_ToCStringLen(ctx, &n, v);
        if (s) {
            rpc_set_prefixed('s', s, n);
            JS_FreeCString(ctx, s);
            JS_FreeValue(ctx, v);
            return 0;
        }
    } else if (tag == JS_TAG_INT) {
        char buf[16];
        int n = snprintf(buf, sizeof buf, "%d", JS_VALUE_GET_INT(v));
        rpc_set_prefixed('n', buf, (size_t)n);
        return 0;
    } else if (tag == JS_TAG_BOOL) {
        rpc_set_prefixed(JS_VALUE_GET_BOOL(v) ? 'T' : 'F', "", 0);
        return 0;
    } else if (tag == JS_TAG_NULL) {
        rpc_set_prefixed('N', "", 0);
        return 0;
    } else if (tag == JS_TAG_UNDEFINED) {
        rpc_set_prefixed('U', "", 0);
        return 0;
    }
    JSValue out = JS_Call(ctx, reply_fn, JS_UNDEFINED, 1, &v);
    JS_FreeValue(ctx, v);
    if (JS_IsException(out)) {
        set_result_error();
        return 1;
    }
    set_result_value(out);
    JS_FreeValue(ctx, out);
    return 0;
}

EXPORT("qd_rpc") int qd_rpc(const char *req, size_t len) {
    update_rpc_cache();
    JSValue fn = cached_rpc_fn;
    JSValue reply_fn = cached_reply_fn;
    JSValue error_fn = cached_error_fn;
    JSValue byid = cached_byid;
    int rc = -1;
    if (len > 3 && (req[0] == 'g' || req[0] == 'c' || req[0] == 's') && JS_IsFunction(ctx, reply_fn) && JS_IsFunction(ctx, error_fn) && JS_IsObject(byid)) {
        const char *sep1 = memchr(req + 1, 1, len - 1);
        const char *sep2 = (req[0] == 'c' || req[0] == 's') && sep1 ? memchr(sep1 + 1, 1, (size_t)(req + len - sep1 - 1)) : NULL;
        int ok = sep1 != NULL && (req[0] == 'g' || sep2 != NULL);
        uint32_t id = 0;
        if (ok) {
            for (const char *p = req + 1; p < sep1; p++) {
                if (*p < '0' || *p > '9') { ok = 0; break; }
                id = id * 10 + (uint32_t)(*p - '0');
            }
        }
        if (ok) {
            JSValue obj = JS_GetPropertyUint32(ctx, byid, id);
            if (JS_IsObject(obj)) {
                const char *key = sep1 + 1;
                size_t keylen = (size_t)((req[0] == 'g' ? req + len : sep2) - key);

                if (req[0] == 's') {
                    /* Property set: s<id>\1<key>\1\3<string> or \4<token> */
                    if (sep2 + 1 < req + len && (sep2[1] == 3 || sep2[1] == 4)) {
                        JSValue v = JS_UNDEFINED;
                        if (sep2[1] == 3) {
                            const char *val = sep2 + 2;
                            size_t vallen = (size_t)(req + len - val);
                            v = JS_NewStringLen(ctx, val, vallen);
                        } else {
                            const char *tok = sep2 + 2;
                            size_t toklen = (size_t)(req + len - tok);
                            v = rpc_decode_token(ctx, byid, tok, toklen);
                        }
                        JSAtom atom = JS_NewAtomLen(ctx, key, keylen);
                        int set_res = JS_SetProperty(ctx, obj, atom, v);
                        JS_FreeAtom(ctx, atom);
                        JS_FreeValue(ctx, obj);
                        if (set_res < 0) {
                            JSValue exc = JS_GetException(ctx);
                            JSValue out = JS_Call(ctx, error_fn, JS_UNDEFINED, 1, &exc);
                            JS_FreeValue(ctx, exc);
                            if (JS_IsException(out)) {
                                set_result_error();
                                rc = 1;
                            } else {
                                set_result_value(out);
                                JS_FreeValue(ctx, out);
                                rc = 0;
                            }
                        } else {
                            rpc_set_prefixed('N', "", 0);
                            rc = 0;
                        }
                        goto slow;
                    }
                    JS_FreeValue(ctx, obj);
                    goto slow;
                }

                /* the arguments of a call: a JSON array of strings, numbers, booleans and null (anything else takes the slow way) */
                JSValue argv_arr = JS_UNDEFINED;
                JSValue *argv = NULL;
                uint32_t argc = 0;
                int plain = 1;
                if (req[0] == 'c' && sep2 + 1 < req + len && sep2[1] == 3) {
                    /* all arguments are strings: "\3" and the strings apart by "\2" */
                    const char *p = sep2 + 2, *end = req + len;
                    argc = 1;
                    for (const char *q = p; q < end; q++) if (*q == 2) argc++;
                    if (argc > 8) plain = 0;
                    else {
                        argv = alloca(sizeof(JSValue) * argc);
                        for (uint32_t i = 0; i < argc; i++) {
                            const char *stop = memchr(p, 2, (size_t)(end - p));
                            if (!stop) stop = end;
                            argv[i] = JS_NewStringLen(ctx, p, (size_t)(stop - p));
                            p = stop + 1;
                        }
                    }
                } else if (req[0] == 'c' && sep2 + 1 < req + len && sep2[1] == 4) {
                    /* typed simple arguments: "\4" and tokens apart by "\2" */
                    const char *p = sep2 + 2, *end = req + len;
                    argc = 1;
                    for (const char *q = p; q < end; q++) if (*q == 2) argc++;
                    if (argc > 8) plain = 0;
                    else {
                        argv = alloca(sizeof(JSValue) * argc);
                        for (uint32_t i = 0; i < argc; i++) {
                            const char *stop = memchr(p, 2, (size_t)(end - p));
                            if (!stop) stop = end;
                            size_t toklen = (size_t)(stop - p);
                            argv[i] = rpc_decode_token(ctx, byid, p, toklen);
                            p = stop + 1;
                        }
                    }
                } else if (req[0] == 'c' && sep2 + 1 < req + len) {
                    argv_arr = JS_ParseJSON(ctx, sep2 + 1, (size_t)(req + len - sep2 - 1), "<args>");
                    if (JS_IsException(argv_arr)) {
                        JS_FreeValue(ctx, JS_GetException(ctx));
                        plain = 0;
                    } else if (!JS_IsArray(argv_arr)) {
                        plain = 0;
                    } else {
                        JSValue lenv = JS_GetPropertyStr(ctx, argv_arr, "length");
                        JS_ToUint32(ctx, &argc, lenv);
                        JS_FreeValue(ctx, lenv);
                        if (argc > 8) plain = 0;
                        else {
                            argv = argc ? alloca(sizeof(JSValue) * argc) : NULL;
                            for (uint32_t i = 0; i < argc; i++) {
                                argv[i] = JS_GetPropertyUint32(ctx, argv_arr, i);
                                if (JS_IsObject(argv[i])) plain = 0;
                            }
                        }
                    }
                }
                if (!plain) {
                    for (uint32_t i = 0; i < argc && argv; i++) JS_FreeValue(ctx, argv[i]);
                    JS_FreeValue(ctx, argv_arr);
                    JS_FreeValue(ctx, obj);
                    goto slow;
                }
                JSAtom atom = JS_NewAtomLen(ctx, key, keylen);
                JSValue v = req[0] == 'g' ? JS_GetProperty(ctx, obj, atom) : JS_Invoke(ctx, obj, atom, (int)argc, argv);
                JS_FreeAtom(ctx, atom);
                for (uint32_t i = 0; i < argc && argv; i++) JS_FreeValue(ctx, argv[i]);
                JS_FreeValue(ctx, argv_arr);
                JS_FreeValue(ctx, obj);
                if (JS_IsException(v)) {
                    JSValue exc = JS_GetException(ctx);
                    JSValue out = JS_Call(ctx, error_fn, JS_UNDEFINED, 1, &exc);
                    JS_FreeValue(ctx, exc);
                    if (JS_IsException(out)) {
                        set_result_error();
                        rc = 1;
                    } else {
                        set_result_value(out);
                        JS_FreeValue(ctx, out);
                        rc = 0;
                    }
                } else {
                    rc = rpc_answer(v, reply_fn);
                }
            } else {
                JS_FreeValue(ctx, obj);
            }
        }
    }
slow:
    if (rc < 0) rc = rpc_slow(fn, req, len);
    /* The page's jobs (promise reactions, MutationObserver deliveries) do not run here: this call is one step of the
       host's synchronous code, and a browser runs them only when that code has finished. The host runs them in a
       microtask of its own (qd_jobs) when told some are waiting. */
    if (JS_IsJobPending(rt)) rc |= 2;
    return rc;
}

/* Compile code to bytecode (without debug information) into qd_result_* as RES_BYTES. Used at build time. */
EXPORT("qd_compile") int qd_compile(const char *code, size_t len, const char *name) {
    JSValue f = JS_Eval(ctx, code, len, name, JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(f)) {
        set_result_error();
        return 1;
    }
    size_t n;
    uint8_t *bc = JS_WriteObject(ctx, &n, f, JS_WRITE_OBJ_BYTECODE | JS_WRITE_OBJ_STRIP_SOURCE | JS_WRITE_OBJ_STRIP_DEBUG);
    JS_FreeValue(ctx, f);
    if (!bc) {
        set_result_error();
        return 1;
    }
    set_result(RES_BYTES, bc, n);
    js_free(ctx, bc);
    return 0;
}

/* Run bytecode made by qd_compile (with this very build of QuickJS). 0: ok; 1: it did not load or threw. */
EXPORT("qd_eval_bytecode") int qd_eval_bytecode(const uint8_t *buf, size_t len) {
    JSValue f = JS_ReadObject(ctx, buf, len, JS_READ_OBJ_BYTECODE);
    if (JS_IsException(f)) {
        set_result_error();
        return 1;
    }
    JSValue v = JS_EvalFunction(ctx, f);
    if (JS_IsException(v)) {
        set_result_error();
        return 1;
    }
    JS_FreeValue(ctx, v);
    return 0;
}

/* Run the jobs (promise reactions) that are queued. Returns how many ran. */
EXPORT("qd_jobs") int qd_jobs(void) {
    int count = 0;
    for (;;) {
        JSContext *c;
        int r = JS_ExecutePendingJob(rt, &c);
        if (r == 0) break;
        count++;
        if (r < 0) {
            JSValue e = JS_GetException(c);
            JS_FreeValue(c, e);
        }
    }
    flush_rejections();
    return count;
}

/* Settle the promise handed out for fetch `id` with a string. */
EXPORT("qd_settle") void qd_settle(int id, int ok, const char *text, size_t len) {
    if (id < 0 || id >= pending_count || !pending[id].used) return;
    JSValue arg = JS_NewStringLen(ctx, text, len);
    JSValue r = JS_Call(ctx, ok ? pending[id].resolve : pending[id].reject, JS_UNDEFINED, 1, &arg);
    JS_FreeValue(ctx, r);
    JS_FreeValue(ctx, arg);
    JS_FreeValue(ctx, pending[id].resolve);
    JS_FreeValue(ctx, pending[id].reject);
    pending[id].used = 0;
}
