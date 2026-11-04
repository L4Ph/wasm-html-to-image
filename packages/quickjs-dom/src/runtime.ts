/**
 * The host side of csrc/qjsdom.c: one QuickJS runtime in one instance of `quickjs.wasm`.
 *
 * Plain WebAssembly (`new WebAssembly.Instance(module, imports)`), no Emscripten glue, so it works wherever a compiled
 * module can be instantiated: Cloudflare Workers, Vercel Edge, Deno, Bun, Node.js, browsers. Every page gets an
 * instance of its own; dropping the instance frees everything.
 */

/** What the page's shims call out to (`__host` in the guest). */
export interface QuickJSHost {
  log(level: string, message: string): void;
  timer(id: number, ms: number): void;
  /** A promise was rejected and nothing handled it. */
  rejection(message: string): void;
  /** The page called `__host.fetch(target, method)`; answer later with {@link QuickJSInstance.settle}. */
  fetch(id: number, target: string, method: string): void;
  /**
   * Module requests. kind 0: the specifier of `name` as imported from `base`. kind 1: the source of module `name`
   * (`base` is the name). kind 2: the bridge's callback `base` (a number) with the arguments `name` (JSON); the answer
   * is JSON too. `undefined` when there is none.
   */
  module(kind: 0 | 1 | 2, base: string, name: string): string | undefined;
}

/** What an evaluation produced: its type decides how `value` reads. */
export type EvalResult =
  | { type: "undefined" }
  | { type: "string"; value: string }
  | { type: "json"; value: string }
  | { type: "error"; value: string };

interface Exports {
  memory: WebAssembly.Memory;
  qd_alloc(n: number): number;
  qd_free(p: number): void;
  qd_scratch(n: number): number;
  qd_result_ptr(): number;
  qd_result_len(): number;
  qd_result_type(): number;
  qd_init(memoryLimit: number, stackLimit: number): number;
  qd_set_deadline(ms: number): void;
  qd_eval(code: number, len: number, name: number, module: number): number;
  qd_compile(code: number, len: number, name: number): number;
  qd_eval_bytecode(buf: number, len: number): number;
  qd_rpc(req: number, len: number): number;
  qd_jobs(): number;
  qd_settle(id: number, ok: number, text: number, len: number): void;
  _initialize?(): void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
// What a started instance looks like in memory, per compiled module, so the next one is a copy instead of a start
// (see QuickJSInstance.create): starting the guest program costs more than copying a few megabytes.
const snapshots = new WeakMap<WebAssembly.Module, { key: string; bytes: Uint8Array }>();

function takeSnapshot(memory: WebAssembly.Memory): Uint8Array {
  const words = new Uint32Array(memory.buffer);
  let end = words.length;
  while (end > 0 && words[end - 1] === 0) end--; // the rest is still zero in a new instance
  return new Uint8Array(memory.buffer.slice(0, end * 4));
}

const RESULT_TYPES = ["undefined", "string", "json", "error"] as const;

export class QuickJSInstance {
  private readonly x: Exports;
  private reqPtr = 0;
  private reqCap = 0;

  private constructor(x: Exports) {
    this.x = x;
  }

  /**
   * Instantiate `wasm` and start a runtime in it. `memoryLimit` is what QuickJS may allocate, `stackLimit` what a script
   * may recurse into (bytes).
   *
   * With `warm` (the same function every time for a module), the instance is started by it once; its memory is then
   * kept, and every later instance is that memory copied into a fresh instance. `warm` must leave nothing of a page
   * behind: no host callbacks pending, nothing that depends on when it ran.
   */
  static create(wasm: WebAssembly.Module, host: QuickJSHost, memoryLimit: number, stackLimit: number, warm?: (instance: QuickJSInstance) => void): QuickJSInstance {
    let x!: Exports;
    const u8 = () => new Uint8Array(x.memory.buffer);
    const text = (ptr: number, len: number) => decoder.decode(u8().subarray(ptr, ptr + len));
    const imports: Record<string, Record<string, (...args: any[]) => any>> = {
      host: {
        call(op: number, n1: number, n2: number, a: number, alen: number, b: number, blen: number) {
          if (op === 0) host.log(text(a, alen), text(b, blen));
          else if (op === 1) host.timer(n1, n2);
          else if (op === 2) host.fetch(n1, text(a, alen), text(b, blen));
          else if (op === 3) host.rejection(text(a, alen));
        },
        module(kind: number, a: number, alen: number, b: number, blen: number): number {
          const out = host.module(kind as 0 | 1 | 2, text(a, alen), text(b, blen));
          if (out === undefined) return -1;
          const bytes = encoder.encode(out);
          const ptr = x.qd_scratch(bytes.length);
          u8().set(bytes, ptr);
          return bytes.length;
        },
      },
      wasi_snapshot_preview1: {
        // the C library asks for a clock, an empty environment and a way to write that goes nowhere
        clock_time_get(_id: number, _precision: bigint, out: number) {
          new DataView(x.memory.buffer).setBigUint64(out, BigInt(Date.now()) * 1_000_000n, true);
          return 0;
        },
        environ_sizes_get(count: number, size: number) {
          const view = new DataView(x.memory.buffer);
          view.setUint32(count, 0, true);
          view.setUint32(size, 0, true);
          return 0;
        },
        environ_get: () => 0,
        fd_close: () => 0,
        fd_write(_fd: number, iovs: number, iovsLen: number, written: number) {
          const view = new DataView(x.memory.buffer);
          let total = 0;
          for (let i = 0; i < iovsLen; i++) total += view.getUint32(iovs + i * 8 + 4, true);
          view.setUint32(written, total, true);
          return 0;
        },
        proc_exit(code: number) {
          throw new Error(`QuickJS exited (${code})`);
        },
      },
      env: { emscripten_notify_memory_growth: () => {} },
    };
    // another Emscripten version may ask for more of the C library's system calls than these: say "not implemented"
    for (const i of WebAssembly.Module.imports(wasm)) {
      if (i.module === "wasi_snapshot_preview1" && !(i.name in imports.wasi_snapshot_preview1)) imports.wasi_snapshot_preview1[i.name] = () => 52;
    }
    const wanted = WebAssembly.Module.imports(wasm).filter((i) => !(i.name in (imports[i.module] ?? {})));
    if (wanted.length) throw new Error(`quickjs.wasm needs imports this runtime does not provide: ${wanted.map((i) => `${i.module}.${i.name}`).join(", ")}`);
    x = new WebAssembly.Instance(wasm, imports).exports as unknown as Exports;
    const key = `${memoryLimit}:${stackLimit}`;
    const saved = warm ? snapshots.get(wasm) : undefined;
    if (saved && saved.key === key) {
      const pages = Math.ceil(saved.bytes.length / 65536);
      const have = x.memory.buffer.byteLength / 65536;
      if (pages > have) x.memory.grow(pages - have);
      new Uint8Array(x.memory.buffer).set(saved.bytes);
      return new QuickJSInstance(x);
    }
    x._initialize?.();
    if (x.qd_init(memoryLimit, stackLimit) !== 0) throw new Error("The QuickJS runtime could not be created.");
    const instance = new QuickJSInstance(x);
    if (warm) {
      warm(instance);
      snapshots.set(wasm, { key, bytes: takeSnapshot(x.memory) });
    }
    return instance;
  }

  /** Put a string in wasm memory, NUL-terminated; `use` gets its pointer and byte length. */
  private withString<T>(s: string, use: (ptr: number, len: number) => T): T {
    const bytes = encoder.encode(s);
    const ptr = this.x.qd_alloc(bytes.length + 1);
    const view = new Uint8Array(this.x.memory.buffer);
    view.set(bytes, ptr);
    view[ptr + bytes.length] = 0;
    try {
      return use(ptr, bytes.length);
    } finally {
      this.x.qd_free(ptr);
    }
  }

  private result(): EvalResult {
    const type = RESULT_TYPES[this.x.qd_result_type()] ?? "undefined";
    if (type === "undefined") return { type };
    const ptr = this.x.qd_result_ptr();
    return { type, value: decoder.decode(new Uint8Array(this.x.memory.buffer, ptr, this.x.qd_result_len())) };
  }

  /** Script running past this wall-clock time (ms since the epoch) is interrupted; 0 = no limit. */
  setDeadline(ms: number): void {
    this.x.qd_set_deadline(ms);
  }

  /** Evaluate code (as a module when asked); a script error comes back as `{ type: "error" }`. */
  eval(code: string, name: string, module = false): EvalResult {
    return this.withString(code, (c, len) => this.withString(name, (n) => (this.x.qd_eval(c, len, n, module ? 1 : 0), this.result())));
  }

  /**
   * Call the guest's `__rpc` (scripts/edge-js/rpc.js) with a string; the answer is a string. Unlike {@link eval} this may
   * be called again from inside a host callback (module kind 2): the bridge's calls nest.
   */
  rpc(request: string): EvalResult & { jobs?: boolean } {
    // the request is copied into a buffer that stays; the guest reads it before it runs anything, so a call made from a
    // callback may reuse it
    const need = request.length * 3 + 1;
    if (need > this.reqCap) {
      if (this.reqPtr) this.x.qd_free(this.reqPtr);
      this.reqCap = Math.max(4096, need * 2);
      this.reqPtr = this.x.qd_alloc(this.reqCap);
    }
    const { written } = encoder.encodeInto(request, new Uint8Array(this.x.memory.buffer, this.reqPtr, this.reqCap));
    const rc = this.x.qd_rpc(this.reqPtr, written);
    const res = this.result() as EvalResult & { jobs?: boolean };
    if (rc & 2) res.jobs = true;
    return res;
  }

  /** Run bytecode that {@link QuickJSInstance.compile} made with this very build of QuickJS. */
  evalBytecode(bytes: Uint8Array): EvalResult {
    const ptr = this.x.qd_alloc(bytes.length);
    new Uint8Array(this.x.memory.buffer).set(bytes, ptr);
    try {
      const failed = this.x.qd_eval_bytecode(ptr, bytes.length);
      return failed ? this.result() : { type: "undefined" };
    } finally {
      this.x.qd_free(ptr);
    }
  }

  /** Compile code to bytecode (build time). */
  compile(code: string, name: string): Uint8Array {
    return this.withString(code, (c, len) =>
      this.withString(name, (n) => {
        if (this.x.qd_compile(c, len, n)) throw new Error(`QuickJS could not compile ${name}: ${(this.result() as { value: string }).value}`);
        return new Uint8Array(this.x.memory.buffer, this.x.qd_result_ptr(), this.x.qd_result_len()).slice();
      }),
    );
  }

  /** Run the queued promise jobs. */
  jobs(): number {
    return this.x.qd_jobs();
  }

  /** Resolve (or reject) the promise of fetch `id` with a string. */
  settle(id: number, ok: boolean, text: string): void {
    this.withString(text, (ptr, len) => this.x.qd_settle(id, ok ? 1 : 0, ptr, len));
  }
}
