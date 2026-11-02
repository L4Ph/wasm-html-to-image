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
/* kind 0: normalize(base, name) -> specifier; kind 1: load(name, "") -> source. The reply is put in qd_scratch();
   returns its length, or -1 when there is none (the host has no such module). */
IMPORT("module") extern int host_module(int kind, const char *a, int alen, const char *b, int blen);

static JSRuntime *rt;
static JSContext *ctx;
static double deadline_ms;

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

/* ---- exports ---- */

/* memory_limit: bytes QuickJS may allocate; stack_limit: bytes of C stack a script may use */
EXPORT("qd_init") int qd_init(size_t memory_limit, size_t stack_limit) {
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
    JS_SetPropertyStr(ctx, global, "__host", host);
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
