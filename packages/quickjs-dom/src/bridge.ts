/**
 * The Node side of the bridge: objects of the page's DOM, usable from the host's own code, synchronously.
 *
 * The DOM lives in QuickJS. What the host holds is a wrapper per object: it carries a handle (a number the guest keeps
 * the object under), and every property read, write or method call is one synchronous call into the guest
 * (scripts/edge-js/rpc.js). The same node is always the same wrapper; a wrapper that is collected tells the guest to
 * let go of its node. A function given to the page (an event listener) is called back from the guest, at once.
 */
import type { EvalResult } from "./runtime.js";

/** What the bridge needs of a QuickJS instance. */
export interface BridgeVM {
  rpc(request: string): EvalResult & { jobs?: boolean };
  jobs(): number;
  setDeadline(ms: number): void;
}

/** An interface of the page, as the guest describes it (see `schema` in rpc.js). */
interface InterfaceSchema {
  n: string;
  p: string | null;
  props: Record<string, 0 | 1 | 2 | 3>;
  consts: Record<string, number | string | boolean>;
  st: Record<string, number | string | boolean>;
  it: boolean;
  ix: boolean;
}

/** What a wrapper stands for. `count` is how many times the guest handed the handle out to this wrapper. */
interface Cell {
  id: number;
  count: number;
  t?: number;
  n?: string;
  /** localName and tagName of an element: they never change, so they come with the handle. */
  l?: string;
  g?: string;
  /** childNodes and children of this node, as the host has made them (one object each, so it is the same every time). */
  cols?: Record<string, object>;
}

/** A handle as the guest sends it. */
interface Handle {
  i: number;
  c?: string;
  t?: number;
  n?: string;
  l?: string;
  g?: string;
}

/** Methods that only read: what they answer holds until something that is not one of these runs. */
const PURE_CALLS = new Set([
  "matches", "closest", "contains", "getAttribute", "getAttributeNS", "hasAttribute", "hasAttributeNS", "getAttributeNames", "hasAttributes", "getAttributeNode", "hasChildNodes",
  "querySelector", "querySelectorAll", "getElementsByTagName", "getElementsByClassName", "getElementsByName", "getElementById",
  "compareDocumentPosition", "getRootNode", "isSameNode", "isEqualNode", "getBoundingClientRect", "getClientRects",
  "item", "namedItem", "lookupNamespaceURI", "lookupPrefix", "isDefaultNamespace", "toString",
  "getComputedStyle", "getPropertyValue", "getPropertyPriority",
]);

interface SelectorCheck {
  tagRequired?: Set<string>;
  alwaysTrue?: boolean;
}

const selectorCheckCache = new Map<string, SelectorCheck>();

function analyzeSelector(sel: string): SelectorCheck {
  let cached = selectorCheckCache.get(sel);
  if (cached) return cached;
  const s = sel.trim();
  if (s === "*") {
    cached = { alwaysTrue: true };
    selectorCheckCache.set(sel, cached);
    return cached;
  }
  // Check if it's a comma-separated list of branches, each without combinators (' ', '>', '+', '~')
  // and each starting with a specific tag name: e.g. "input[type=button], input[type=submit]" or "th[scope=col]"
  if (!/[\s>+~]/.test(s)) {
    const branches = s.split(",");
    const tags = new Set<string>();
    let valid = true;
    for (const b of branches) {
      const trimmed = b.trim();
      const match = /^([a-zA-Z0-9]+)/.exec(trimmed);
      if (!match) {
        valid = false;
        break;
      }
      tags.add(match[1].toLowerCase());
    }
    if (valid && tags.size > 0) {
      cached = { tagRequired: tags };
      selectorCheckCache.set(sel, cached);
      return cached;
    }
  }
  cached = {};
  selectorCheckCache.set(sel, cached);
  return cached;
}

const HANDLE = Symbol("wasm-quickjs-dom.handle");
const CLASS_NAME = Symbol("wasm-quickjs-dom.class");
const INDEXED = Symbol("wasm-quickjs-dom.indexed");
const INDEX = /^(?:0|[1-9][0-9]*)$/;

let cachedSchema: InterfaceSchema[] | undefined;

export interface BridgeOptions {
  /** How long one call from the host may keep the guest busy (ms, default 10000); 0 for no limit. */
  timeout?: number;
  /** Called when a call of the host has returned from the page (the page may have set a timer or started a request). */
  onCall?: () => void;
}

/** The page's `window`: every property is looked up in the page when read. */
export type DOMWindow = Window & typeof globalThis & Record<string, any>;

/** Internal symbol to read window property names without Proxy descriptor traversal. */
export const WIN_KEYS = Symbol("winKeys");

export class Bridge {
  /** The page's `window`: the global object of the guest. */
  readonly window: DOMWindow;

  readonly vm: BridgeVM;
  private readonly timeout: number;
  private readonly onCall?: () => void;
  private depth = 0;
  private closed = false;
  private readonly classes = new Map<string, any>();
  private readonly wrappers = new Map<number, WeakRef<object>>();
  private readonly registry: FinalizationRegistry<Cell>;
  private released: [number, number][] = [];
  // wrappers the host put its own properties on: they stay until the bridge is disposed
  private readonly pinned = new Set<object>();
  // What reads answered since the page last ran code of its own. Reading a property or calling a pure method again
  // gives the same answer until the page changes (a write, any other call, a job or timer, a listener of the host's
  // that ran): the cache is dropped then.
  private readonly reads = new Map<string, unknown>();
  // functions of the host that the page holds: id <-> function
  private readonly fnIds = new Map<Function, number>();
  private readonly fnById = new Map<number, Function>();
  private nextFn = 1;
  // ids given to the page since the functions were last sorted out (one may be in a request on its way)
  private readonly fnUsed = new Set<number>();
  private fnLimit = 256;
  private pruning = false;

  private readonly classProxyHandler: ProxyHandler<object>;
  private readonly indexedClassProxyHandler: ProxyHandler<object>;

  constructor(vm: BridgeVM, options: BridgeOptions = {}) {
    this.vm = vm;
    this.timeout = options.timeout ?? 10000;
    this.onCall = options.onCall;
    if (this.timeout > 0) this.vm.setDeadline(Date.now() + this.timeout);
    this.registry = new FinalizationRegistry<Cell>((cell) => {
      this.released.push([cell.id, cell.count]);
      const ref = this.wrappers.get(cell.id);
      if (ref && !ref.deref()) this.wrappers.delete(cell.id);
    });

    const bridge = this;
    this.classProxyHandler = {
      get(t, k, r) {
        if (k in t) return Reflect.get(t, k, r);
        const cell = (t as any)[HANDLE] as Cell;
        return typeof k === "string" ? bridge.get(cell, k) : undefined;
      },
      set(t, k, v, r) {
        if (k in t) return Reflect.set(t, k, v, r);
        bridge.pinned.add(r);
        return Reflect.set(t, k, v, t);
      },
      has(t, k) {
        return Reflect.has(t, k);
      },
    };

    this.indexedClassProxyHandler = {
      get(t, k, r) {
        const cell = (t as any)[HANDLE] as Cell;
        if (typeof k === "string" && INDEX.test(k)) return bridge.get(cell, k);
        if (k in t) return Reflect.get(t, k, r);
        return typeof k === "string" ? bridge.get(cell, k) : undefined;
      },
      set(t, k, v, r) {
        if (k in t) return Reflect.set(t, k, v, r);
        bridge.pinned.add(r);
        return Reflect.set(t, k, v, t);
      },
      has(t, k) {
        const cell = (t as any)[HANDLE] as Cell;
        if (typeof k === "string" && INDEX.test(k)) return Number(k) < (bridge.get(cell, "length") as number);
        return Reflect.has(t, k);
      },
    };

    const schema = cachedSchema ?? (cachedSchema = this.sendJ(["schema"]) as InterfaceSchema[]);
    this.buildClasses(schema);
    this.window = this.sendJ(["root"]) as DOMWindow;
  }

  /** Let go of the page: the wrappers stop working. */
  dispose(): void {
    this.closed = true;
    this.pinned.clear();
    this.fnById.clear();
    this.fnIds.clear();
  }

  /** How many objects of the page the guest keeps alive for the host (for tests that look for leaks). */
  liveHandles(): number {
    return this.sendJ(["live"]) as number;
  }

  /** The page may have changed: forget what was read. (Called by whoever ran code in the page.) */
  invalidate(): void {
    if (this.reads.size) this.reads.clear();
  }

  /** Collect the handles of wrappers that were garbage collected (they are sent with the next call anyway). */
  flush(): void {
    this.sendReleases();
  }

  // ---- calls into the guest ----

  /** The number of functions of the host that the page may still call (for tests that look for leaks). */
  registeredFunctions(): number {
    return this.fnById.size;
  }

  /** Forget the functions the page no longer holds, once there are many. */
  private pruneFunctions(): void {
    if (this.pruning || this.closed || this.fnById.size < this.fnLimit) return;
    this.pruning = true;
    try {
      const ids = [...this.fnById.keys()].filter((id) => !this.fnUsed.has(id));
      const dead = ids.length ? (this.sendJ(["deadfns", ids]) as number[]) : [];
      for (const id of dead) {
        const fn = this.fnById.get(id);
        if (fn) this.fnIds.delete(fn);
        this.fnById.delete(id);
      }
      this.fnUsed.clear();
      this.fnLimit = Math.max(256, this.fnById.size * 2);
    } finally {
      this.pruning = false;
    }
  }

  private sendReleases(): void {
    if (this.released.length === 0 || this.closed) return;
    const list = this.released;
    this.released = [];
    this.invalidate(); // a released id may be given to another object
    this.sendJ(["release", list]);
  }

  /** An operation in the form of a JSON array: [op, ...]. */
  private sendJ(request: unknown[]): unknown {
    // a function of the page that is called, or an object made, may change anything
    const runs = request[0] === "apply" || request[0] === "new" || request[0] === "del";
    if (runs) {
      this.invalidate();
      if (this.timeout > 0) this.vm.setDeadline(Date.now() + this.timeout);
    }
    const value = this.send("J" + JSON.stringify(request), request[0] === "release");
    if (runs) this.invalidate();
    return value;
  }

  /** One request (see rpc.js for its forms) and its answer, decoded. */
  private send(request: string, noReleases = false): unknown {
    if (this.closed) throw new Error("The page has been closed.");
    if (!noReleases && this.released.length) this.sendReleases();
    if (this.fnById.size >= this.fnLimit) this.pruneFunctions();
    const outer = this.depth === 0;
    this.depth++;
    let result: EvalResult & { jobs?: boolean };
    try {
      result = this.vm.rpc(request);
      if (outer && result.jobs) this.invalidate();
    } finally {
      this.depth--;
    }
    if (outer) this.onCall?.();
    if (result.type === "error") throw new Error(result.value);
    if (result.type !== "string") throw new Error("The page did not answer.");
    return this.answer(result.value);
  }

  private answer(r: string): unknown {
    switch (r.charCodeAt(0)) {
      case 115: // s
        return r.slice(1);
      case 110: // n
        return Number(r.slice(1));
      case 84: // T
        return true;
      case 70: // F
        return false;
      case 78: // N
        return null;
      case 85: // U
        return undefined;
      case 104:
        return this.handleOf(r.slice(1));
      case 97: // a: handles of a list, apart by \u0002
        return r.length === 1 ? [] : r.slice(1).split("\u0002").map((s) => this.handleOf(s.slice(1)));
      case 106: // j
        return this.decode(JSON.parse(r.slice(1)));
      case 107: // k
        return JSON.parse(r.slice(1));
      default:
        throw this.error(JSON.parse(r.slice(1)) as ErrorInfo);
    }
  }

  private handleOf(s: string): unknown {
    const sep = s.indexOf("\u0001");
    if (sep < 0) {
      const id = Number(s);
      const known = this.wrappers.get(id)?.deref();
      if (known) {
        (known as any)[HANDLE].count++;
        return known;
      }
      return this.wrapper({ i: id });
    }
    const [i, c, t, n, l, g] = s.split("\u0001");
    return this.wrapper({ i: Number(i), c: c || undefined, t: t === undefined || t === "" ? undefined : Number(t), n, l, g });
  }

  private error(info: ErrorInfo): Error {
    let e: Error;
    if (info.d && typeof DOMException === "function") e = new DOMException(info.m, info.n);
    else {
      const E = ({ TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError } as Record<string, ErrorConstructor>)[info.n] ?? Error;
      e = new E(info.m);
      if (E === Error && info.n) e.name = info.n;
    }
    if (info.s) Object.defineProperty(e, "stack", { value: `${info.n}: ${info.m}\n    [in the page]\n${info.s}`, configurable: true, writable: true });
    return e;
  }

  private get(cell: Cell, key: string): unknown {
    const k = cell.id + "\u0001" + key;
    if (this.reads.has(k)) return this.reads.get(k);
    const value = this.send("g" + cell.id + "\u0001" + key);
    if (this.reads.size > 100000) this.reads.clear();
    this.reads.set(k, value);
    return value;
  }

  private encodeToken(a: unknown): string | null {
    if (a === null) return "N";
    if (typeof a === "boolean") return a ? "T" : "F";
    if (typeof a === "number" && Number.isFinite(a) && !Object.is(a, -0)) return "n" + a;
    if (typeof a === "string" && !a.includes("\u0002") && !a.includes("\u0001")) return "s" + a;
    const cell = a && typeof a === "object" ? ((a as any)[HANDLE] as Cell | undefined) : undefined;
    if (cell) return "h" + cell.id;
    return null;
  }

  private set(cell: Cell, key: string, value: unknown): void {
    this.invalidate();
    if (typeof value === "string" && !value.includes("\u0001") && !value.includes("\u0002")) {
      this.send("s" + cell.id + "\u0001" + key + "\u0001\u0003" + value);
    } else {
      const tok = this.encodeToken(value);
      if (tok !== null) {
        this.send("s" + cell.id + "\u0001" + key + "\u0001\u0004" + tok);
      } else {
        this.send("s" + cell.id + "\u0001" + key + "\u0001" + JSON.stringify(this.encode(value)));
      }
    }
  }

  /** Arguments that are all strings go as is (no JSON on either side); the rest as a JSON array. */
  private encodeArgs(args: unknown[]): string {
    if (args.length === 0) return "";
    let strings = true;
    for (const a of args) {
      if (typeof a !== "string" || a.includes("\u0002") || a.includes("\u0001")) {
        strings = false;
        break;
      }
    }
    if (strings) return "\u0003" + args.join("\u0002");
    const parts: string[] = [];
    for (const a of args) {
      const tok = this.encodeToken(a);
      if (tok === null) return JSON.stringify(args.map((x) => this.encode(x)));
      parts.push(tok);
    }
    return "\u0004" + parts.join("\u0002");
  }

  private call(cell: Cell, key: string, args: unknown[]): unknown {
    if (key === "matches" && cell.t === 1 && typeof cell.l === "string" && typeof args[0] === "string") {
      const check = analyzeSelector(args[0]);
      if (check.alwaysTrue) return true;
      if (check.tagRequired && !check.tagRequired.has(cell.l.toLowerCase())) return false;
    }
    const encoded = this.encodeArgs(args);
    if (!PURE_CALLS.has(key)) {
      this.invalidate();
      const value = this.send("c" + cell.id + "\u0001" + key + "\u0001" + encoded);
      this.invalidate(); // what it ran may have changed anything
      return value;
    }
    const k = cell.id + "\u0001" + key + "\u0001" + encoded;
    if (this.reads.has(k)) return this.reads.get(k);
    const value = this.send("c" + cell.id + "\u0001" + key + "\u0001" + encoded);
    this.reads.set(k, value);
    return value;
  }

  // ---- values ----

  private encode(v: unknown): unknown {
    switch (typeof v) {
      case "undefined":
      case "symbol":
        return { $: "u" };
      case "number":
        return Number.isFinite(v) && !Object.is(v, -0) ? v : { $: "n", v: Object.is(v, -0) ? "-0" : String(v) };
      case "bigint":
        return { $: "n", v: String(v), b: 1 };
      case "string":
      case "boolean":
        return v;
      case "function": {
        const cell = (v as any)[HANDLE] as Cell | undefined;
        if (cell) return { $: "h", i: cell.id };
        // only the generated class itself is a constructor reference: a subclass of one (a custom
        // element class extending the page's HTMLElement) inherits CLASS_NAME through the class
        // chain and must travel as its own function, or every subclass arrives as the base class
        const cls = Object.prototype.hasOwnProperty.call(v, CLASS_NAME) ? ((v as any)[CLASS_NAME] as string) : undefined;
        if (cls) return { $: "c", n: cls };
        let id = this.fnIds.get(v);
        if (id === undefined) {
          id = this.nextFn++;
          this.fnIds.set(v, id);
          this.fnById.set(id, v);
        }
        this.fnUsed.add(id);
        return { $: "f", i: id };
      }
      default: {
        if (v === null) return null;
        const cell = (v as any)[HANDLE] as Cell | undefined;
        if (cell) return { $: "h", i: cell.id };
        if (Array.isArray(v)) return v.map((x) => this.encode(x));
        if (v instanceof Date) return { $: "d", v: v.getTime() };
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v as object)) out[k] = this.encode((v as any)[k]);
        return { $: "o", v: out };
      }
    }
  }

  private decode(x: any): unknown {
    if (x === null || typeof x !== "object") return x;
    if (Array.isArray(x)) return x.map((e) => this.decode(e));
    switch (x.$) {
      case "u":
        return undefined;
      case "n":
        return x.b ? BigInt(x.v) : Number(x.v);
      case "d":
        return new Date(x.v);
      case "c":
        return this.classes.get(x.n);
      case "f":
        return this.fnById.get(x.i);
      case "h":
        return this.wrapper(x);
      default: {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(x.v ?? {})) out[k] = this.decode(x.v[k]);
        return out;
      }
    }
  }

  // ---- wrappers ----

  private wrapper(h: Handle): unknown {
    const known = this.wrappers.get(h.i)?.deref();
    if (known) {
      (known as any)[HANDLE].count++;
      return known;
    }
    const cell: Cell = { id: h.i, count: 1, t: h.t, n: h.n, l: h.l, g: h.g };
    let w: any;
    const cls = h.c ? this.classes.get(h.c) : undefined;
    if (h.c === "Function") w = this.functionWrapper(cell);
    else if (cls) w = this.classWrapper(cell, cls);
    else w = this.dynamicWrapper(cell, h.c === "Window");
    this.wrappers.set(h.i, new WeakRef(w));
    this.registry.register(w, cell);
    return w;
  }

  /** A function of the page, callable from here. */
  private functionWrapper(cell: Cell): Function {
    const bridge = this;
    const f = function (this: unknown, ...args: unknown[]) {
      // constructed from here (a class of the page reached as a value — window.File through
      // defaultView, say): the page must see a construction, not a call, or its classes throw
      if (new.target) return bridge.sendJ(["construct", cell.id, args.map((a) => bridge.encode(a))]);
      return bridge.sendJ(["apply", cell.id, bridge.encode(this), args.map((a) => bridge.encode(a))]);
    };
    Object.defineProperty(f, HANDLE, { value: cell });
    return f;
  }

  /**
   * An object of an interface that is known: an instance of the generated class. What the class does not have, the
   * page is asked for (an event's `type` is a field of the object there, not an accessor); what the host sets on it
   * (React keeps its fibers on DOM nodes) stays on the wrapper, which is then kept alive so the node does not lose it.
   */
  private classWrapper(cell: Cell, cls: any): object {
    const obj = Object.create(cls.prototype);
    obj[HANDLE] = cell;
    const indexed = !!cls[INDEXED];
    return new Proxy(obj, indexed ? this.indexedClassProxyHandler : this.classProxyHandler);
  }

  /** Any other object (a style declaration, `window`, a DOMRect, ...): every property is looked up in the page. */
  private dynamicWrapper(cell: Cell, isWindow = false): object {
    const target: Record<PropertyKey, unknown> = {};
    Object.defineProperty(target, HANDLE, { value: cell, configurable: true });
    let cachedKeys: Set<string> | null = null;
    return new Proxy(target, {
      get: (t, k) => {
        if (k === HANDLE) return cell;
        if (k === WIN_KEYS) return () => this.sendJ(["keys", cell.id]) as string[];
        if (typeof k === "symbol") {
          if (k === Symbol.iterator && this.sendJ(["has", cell.id, "length"])) return () => (this.sendJ(["array", cell.id]) as unknown[])[Symbol.iterator]();
          return undefined;
        }
        if (k === "then") return undefined;
        if (isWindow && typeof k === "string" && this.classes.has(k)) return this.classes.get(k);
        return this.get(cell, k);
      },
      set: (t, k, v) => {
        if (typeof k === "symbol") return false;
        cachedKeys = null;
        this.set(cell, k, v);
        return true;
      },
      has: (t, k) => (typeof k === "symbol" ? k === HANDLE : (this.sendJ(["has", cell.id, k]) as boolean)),
      deleteProperty: (t, k) => {
        if (typeof k === "symbol") return false;
        cachedKeys = null;
        return this.sendJ(["del", cell.id, k]) as boolean;
      },
      ownKeys: () => {
        const keys = this.sendJ(["keys", cell.id]) as string[];
        cachedKeys = new Set(keys);
        return keys;
      },
      getOwnPropertyDescriptor: (t, k) => {
        if (typeof k === "symbol") return undefined;
        if (k in t) return Reflect.getOwnPropertyDescriptor(t, k);
        if (isWindow && typeof k === "string" && this.classes.has(k)) {
          return { value: this.classes.get(k), writable: true, enumerable: true, configurable: true };
        }
        const exists = cachedKeys ? cachedKeys.has(k as string) : (this.sendJ(["has", cell.id, k]) as boolean);
        if (!exists) return undefined;
        return {
          get: () => this.get(cell, k as string),
          set: (v: unknown) => this.set(cell, k as string, v),
          enumerable: true,
          configurable: true,
        };
      },
    });
  }

  /**
   * `childNodes` / `children`: a NodeList / HTMLCollection that is made here and filled by one call into the page
   * (which then does not build a live collection of its own). It reads again after the page has changed, so it is live.
   */
  private collection(cell: Cell, key: "childNodes" | "children"): object {
    const have = (cell.cols ??= {})[key];
    if (have) return have;
    const nodes = (): unknown[] => {
      const k = cell.id + "\u0001*" + key;
      let list = this.reads.get(k) as unknown[] | undefined;
      if (!list) {
        list = this.send("k" + cell.id + "\u0001" + (key === "children" ? "1" : "0")) as unknown[];
        this.reads.set(k, list);
      }
      return list;
    };
    const proto = (this.classes.get(key === "childNodes" ? "NodeList" : "HTMLCollection") ?? Object).prototype;
    const ARRAY_METHODS = new Set(["forEach", "entries", "keys", "values"]);
    return (cell.cols[key] = new Proxy(Object.create(proto), {
      get: (t, k, r) => {
        if (typeof k === "string") {
          if (k === "length") return nodes().length;
          if (INDEX.test(k)) return nodes()[Number(k)];
          if (k === "item") return (i: number) => nodes()[i] ?? null;
          if (k === "namedItem") return (name: string) => nodes().find((n: any) => n.getAttribute?.("id") === name || n.getAttribute?.("name") === name) ?? null;
          if (ARRAY_METHODS.has(k)) return (Array.prototype as any)[k].bind(nodes());
        } else if (k === Symbol.iterator) return () => nodes()[Symbol.iterator]();
        return Reflect.get(t, k, r);
      },
      has: (t, k) => (typeof k === "string" && INDEX.test(k) ? Number(k) < nodes().length : Reflect.has(t, k)),
      ownKeys: () => [...nodes().keys()].map(String),
      getOwnPropertyDescriptor: (t, k) => (typeof k === "string" && INDEX.test(k) && Number(k) < nodes().length ? { value: nodes()[Number(k)], enumerable: true, configurable: true, writable: false } : undefined),
    }));
  }

  // ---- the classes of the interfaces ----

  private buildClasses(schema: InterfaceSchema[]): void {
    const byName = new Map(schema.map((s) => [s.n, s]));
    const bridge = this;
    const make = (name: string): any => {
      const done = this.classes.get(name);
      if (done) return done;
      const s = byName.get(name)!;
      const parent = s.p && byName.has(s.p) ? make(s.p) : null;
      const cls = {
        [name]: function (this: unknown, ...args: unknown[]) {
          if (!new.target) throw new TypeError(`Class constructor ${name} cannot be invoked without 'new'`);
          return bridge.sendJ(["new", name, args.map((a) => bridge.encode(a))]);
        },
      }[name] as any;
      Object.setPrototypeOf(cls.prototype, parent ? parent.prototype : Object.prototype);
      if (parent) Object.setPrototypeOf(cls, parent);
      Object.defineProperty(cls, CLASS_NAME, { value: name });
      if (s.ix) Object.defineProperty(cls, INDEXED, { value: true });
      for (const [k, v] of Object.entries(s.st)) Object.defineProperty(cls, k, { value: v, enumerable: true });
      for (const [k, v] of Object.entries(s.consts)) Object.defineProperty(cls.prototype, k, { value: v, enumerable: true });
      for (const [k, kind] of Object.entries(s.props)) {
        if (kind === 3) {
          Object.defineProperty(cls.prototype, k, {
            value: { [k]: function (this: any, ...args: unknown[]) { return bridge.call(this[HANDLE], k, args); } }[k],
            writable: true, configurable: true, enumerable: true,
          });
        } else if (k === "nodeType") {
          Object.defineProperty(cls.prototype, k, { get(this: any) { const c = this[HANDLE] as Cell; return c.t ?? bridge.get(c, k); }, enumerable: true, configurable: true });
        } else if ((k === "childNodes" || k === "children") && kind === 1) {
          Object.defineProperty(cls.prototype, k, { get(this: any) { return bridge.collection(this[HANDLE] as Cell, k); }, enumerable: true, configurable: true });
        } else if (k === "localName") {
          Object.defineProperty(cls.prototype, k, { get(this: any) { const c = this[HANDLE] as Cell; return c.l ?? bridge.get(c, k); }, enumerable: true, configurable: true });
        } else if (k === "tagName") {
          Object.defineProperty(cls.prototype, k, { get(this: any) { const c = this[HANDLE] as Cell; return c.g ?? bridge.get(c, k); }, enumerable: true, configurable: true });
        } else if (k === "nodeName") {
          Object.defineProperty(cls.prototype, k, { get(this: any) { const c = this[HANDLE] as Cell; return c.n ?? bridge.get(c, k); }, enumerable: true, configurable: true });
        } else {
          Object.defineProperty(cls.prototype, k, {
            get(this: any) { return bridge.get(this[HANDLE], k); },
            set: kind === 2 ? function (this: any, v: unknown) { bridge.set(this[HANDLE], k, v); } : undefined,
            enumerable: true, configurable: true,
          });
        }
      }
      if (s.it) {
        Object.defineProperty(cls.prototype, Symbol.iterator, {
          value: function (this: any) { return (bridge.sendJ(["array", this[HANDLE].id]) as unknown[])[Symbol.iterator](); },
          writable: true, configurable: true,
        });
      }
      this.classes.set(name, cls);
      return cls;
    };
    for (const s of schema) make(s.n);
  }

  // ---- calls from the guest ----

  /**
   * The page calls a function of the host's (`id`, as `encode` numbered it) with `args` (JSON: [this, [arguments]]);
   * the answer is JSON: `{ v }` or `{ x }`.
   */
  callback(id: number, args: string): string | undefined {
    const fn = this.fnById.get(id);
    if (!fn) return undefined;
    this.invalidate();
    this.depth++;
    try {
      const [self, list] = JSON.parse(args) as [unknown, unknown[]];
      const value = fn.apply(this.decode(self), list.map((a) => this.decode(a)));
      return JSON.stringify({ v: this.encode(value) });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return JSON.stringify({ x: { n: err.name, m: err.message, s: err.stack } });
    } finally {
      this.depth--;
      this.invalidate();
    }
  }
}

interface ErrorInfo {
  n: string;
  m: string;
  s?: string;
  c?: number;
  d?: number;
}
