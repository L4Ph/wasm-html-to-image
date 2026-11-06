/**
 * The Node side of the bridge: objects of the page's DOM, usable from the host's own code, synchronously.
 *
 * The DOM lives in QuickJS. What the host holds is a wrapper per object: it carries a handle (a number the guest keeps
 * the object under), and every property read, write or method call is one synchronous call into the guest
 * (scripts/edge-js/rpc.js). The same node is always the same wrapper; a wrapper that is collected tells the guest to
 * let go of its node. A function given to the page (an event listener) is called back from the guest, at once.
 */
import type { EvalResult } from "./runtime.js";
import { normalizeTimeout } from "./timeout.js";

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
  /** the interface name the guest reported for the object, when it reported one */
  c?: string;
  t?: number;
  n?: string;
  /** localName and tagName of an element: they never change, so they come with the handle. */
  l?: string;
  g?: string;
  /** childNodes and children of this node, as the host has made them (one object each, so it is the same every time). */
  cols?: Record<string, object>;
  /** namespaceURI of an element: never changes, so it is read once and kept with the handle. */
  u?: string;
  /** defaultView of a document: fixed when the document is made. `dvSet` tells "null" from "not read yet". */
  dv?: unknown;
  dvSet?: boolean;
  /** The ownerDocument of a node, as of generation `odg` (see Bridge.odGen). */
  od?: unknown;
  odg?: number;
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

/** Reads that only the shape of the tree changes (and the document a node belongs to, which a move between trees changes). */
const STRUCT_KEYS = new Set([
  "firstChild", "lastChild", "nextSibling", "previousSibling", "parentNode", "parentElement",
  "firstElementChild", "lastElementChild", "nextElementSibling", "previousElementSibling", "childElementCount", "isConnected",
]);
/** Calls that make a new node (a custom element's constructor could run page code: `fineOk` rules that out). */
const CREATE_CALLS = new Set(["createElement", "createElementNS", "createTextNode", "createComment", "createDocumentFragment"]);
/** Calls that change the tree and run page code only through a custom element's callbacks. */
const TREE_CALLS = new Set([
  "appendChild", "insertBefore", "removeChild", "replaceChild", "append", "prepend", "remove", "before", "after", "replaceWith", "replaceChildren",
]);
/** Calls that change an element's attributes and nothing else. */
const ATTR_CALLS = new Set(["setAttribute", "setAttributeNS", "removeAttribute", "removeAttributeNS", "toggleAttribute"]);
/** Calls that register or drop a listener: nothing the host has read changes. */
const LISTENER_CALLS = new Set(["addEventListener", "removeEventListener"]);
/** Properties of an element whose assignment changes an attribute or a value, runs no code and moves no node. */
const FINE_SET_KEYS = new Set([
  "className", "id", "title", "lang", "dir", "hidden", "disabled", "checked", "value", "href", "src", "type", "name", "placeholder",
  "htmlFor", "tabIndex", "draggable", "spellcheck", "readOnly", "required", "selected", "multiple", "rel", "target", "alt", "width", "height",
]);
/** The same for a text or comment node. */
const TEXT_SET_KEYS = new Set(["nodeValue", "data", "textContent"]);
const ON_HANDLER = /^on[a-z]+$/;

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
  /** How long one call from the host may keep the guest busy (ms, default 10000); 0 or Infinity for no limit. */
  timeout?: number;
  /** Called when a call of the host has returned from the page (the page may have set a timer or started a request). */
  onCall?: () => void;
}

/** The page's `window`: every property is looked up in the page when read. */
export type DOMWindow = Window & typeof globalThis & Record<string, any>;

/**
 * A result of an earlier operation in {@link Bridge.batch}, usable by the operations after it (the index is the
 * position of that operation's answer in the batch). It stands for the object there, not for its number.
 */
export class BatchRef {
  constructor(readonly index: number) {}
}

/**
 * One operation of {@link Bridge.batch}. Its answer is placed at the operation's index in the result list.
 *
 * `["call", target, method, args]` calls a method, `["set", target, key, value]` writes a property, and
 * `["new", className, args]` constructs a page interface. A target or an argument may be a {@link BatchRef}
 * (the answer of an earlier operation) or a wrapper; everything else crosses as a value.
 */
export type BatchOp =
  | ["call", object | BatchRef, string, unknown[]?]
  | ["set", object | BatchRef, string, unknown]
  | ["new", string, unknown[]?]
  | ["tree", object | BatchRef, BatchTree];

/** A tree built by one `["tree", parent, tree]` operation: one bridge call for the whole subtree. */
export interface BatchTree {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: (BatchTree | string)[];
}

/** One event of {@link Bridge.fireSequence}: the type, the init dictionary and, if not `Event`, the interface. */
export interface SequenceEvent {
  type: string;
  init?: Record<string, unknown>;
  /** The window interface to construct (`MouseEvent`, `KeyboardEvent`, ...); `Event` when omitted. */
  ctor?: string;
}

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
  /** the interfaces of the schema by name; a class is made when first asked for (a page uses a few dozen of the hundreds) */
  private schemaByName = new Map<string, InterfaceSchema>();
  private makeClass: (name: string) => any = () => undefined;
  private cls(name: string): any {
    return this.classes.get(name) ?? (this.schemaByName.has(name) ? this.makeClass(name) : undefined);
  }
  private readonly wrappers = new Map<number, WeakRef<object>>();
  private readonly registry: FinalizationRegistry<Cell>;
  private released: [number, number][] = [];
  // wrappers the host put its own properties on: they stay until the bridge is disposed
  private readonly pinned = new Set<object>();
  // What reads answered since the page last ran code of its own. Reading a property or calling a pure method again
  // gives the same answer until the page changes (a write, any other call, a job or timer, a listener of the host's
  // that ran): the cache is dropped then.
  private readonly reads = new Map<string, unknown>();
  /** `el.style` answers, kept apart: the declaration object of an element never changes identity when its
   * properties are written, so an attribute-only change (invalidateAttrs) must not drop these — a run of
   * style writes otherwise pays a fresh crossing per write just to re-read the same object. */
  private readonly styleObjs = new Map<string, unknown>();
  /** The last value the host wrote for each fine (state-only) property of a cell, per cell: a framework
   * re-render sets the same className / value / text again on most nodes, and the write is a pure function
   * of that value, so an identical repeat can be dropped entirely. The memo for a cell is dropped when an
   * attribute write lands on it (attributes back properties), and the whole map goes with any full
   * invalidation, which is also what a release does before a handle id can be reused. */
  private readonly setMemo = new Map<number, Map<string, unknown>>();
  /** The reads that depend on the shape of the tree only (see STRUCT_KEYS): a change of attributes leaves them be. */
  private readonly sreads = new Map<string, unknown>();
  /** Whether the page has custom elements (their callbacks run page code on an attribute change): 0 = ask, 1 = none, 2 = yes (final). */
  private ce = 0;
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
    this.timeout = normalizeTimeout(options.timeout);
    this.onCall = options.onCall;
    this.armDeadline();
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
        // every indexed interface has a length; it is a named property, not an own one (as in jsdom)
        if (k === "length") return true;
        if (typeof k === "string" && INDEX.test(k)) return Number(k) < (bridge.get(cell, "length") as number);
        return Reflect.has(t, k);
      },
      ownKeys(t) {
        const cell = (t as any)[HANDLE] as Cell;
        const keys: (string | symbol)[] = [];
        const seen = new Set<string | symbol>();
        // what the page reports as enumerable own names (the indices of a collection, a NamedNodeMap's names): the
        // target is extensible, so these may answer although they are not own properties of it; the wrapper's own
        // keys (HANDLE, and anything the host set on it) stay, so the proxy invariants hold
        for (const key of bridge.sendJ(["keys", cell.id]) as string[]) {
          keys.push(key);
          seen.add(key);
        }
        for (const key of Reflect.ownKeys(t)) if (!seen.has(key)) keys.push(key);
        return keys;
      },
      getOwnPropertyDescriptor(t, k) {
        const own = Reflect.getOwnPropertyDescriptor(t, k);
        if (own) return own;
        // length is a named property (undefined as an own descriptor), as in jsdom
        if (typeof k !== "string" || !INDEX.test(k)) return undefined;
        const cell = (t as any)[HANDLE] as Cell;
        if (Number(k) >= (bridge.get(cell, "length") as number)) return undefined;
        return { value: bridge.get(cell, k), enumerable: true, configurable: true, writable: false };
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
  invalidate(keepCe = false, keepOd = false): void {
    if (this.reads.size) this.reads.clear();
    if (this.setMemo.size) this.setMemo.clear();
    if (this.styleObjs.size) this.styleObjs.clear();
    if (this.sreads.size) this.sreads.clear();
    if (!keepCe && this.ce === 1) this.ce = 0;
    // what a node's ownerDocument was (`Cell.od`) is good until a node may have moved to another document
    if (!keepOd) this.odGen++;
  }
  /** The generation of the ownerDocument answers kept in the cells; a change that may move a node between documents ends it. */
  private odGen = 0;

  /** A change of attributes only: no page code runs (`fineOk` has checked), so what depends on the tree's shape holds. */
  private invalidateAttrs(): void {
    if (this.reads.size) this.reads.clear();
  }

  /** True when a change that is not a change of the tree may drop only part of what was read. */
  private fineOk(): boolean {
    if (this.ce === 0) this.ce = this.sendJ(["ce"]) ? 2 : 1;
    return this.ce === 1;
  }

  /** Collect the handles of wrappers that were garbage collected (they are sent with the next call anyway). */
  flush(): void {
    this.sendReleases();
  }

  /**
   * Run several operations in the page with one call, in order, answering their results in the same order.
   *
   * A host that builds a subtree node by node pays one bridge call per operation (`createElement`, `setAttribute`,
   * `appendChild`, ...). This makes that whole build one call: a created node is a {@link BatchRef} for the operations
   * after it. The page sees ordinary DOM operations, so custom elements, mutation records and invalidation behave as
   * they do when the same calls are made one by one. If an operation throws, the operations before it have already
   * happened (there is no rollback); the error is thrown here.
   */
  batch(ops: BatchOp[]): unknown[] {
    const encode = (v: unknown): unknown => {
      if (v instanceof BatchRef) return { $: "r", i: v.index };
      if (Array.isArray(v)) return v.map(encode);
      return this.encode(v);
    };
    const list = ops.map((op) => (op[0] === "tree" ? ["tree", encode(op[1]), op[2]] : op.map(encode)));
    return this.sendJ(["batch", list]) as unknown[];
  }

  /**
   * Dispatch several events at one target in one call, in order: the guest builds each event from `{ type, init }`
   * and runs the ordinary dispatch (capture, target, bubble, `preventDefault`, activation, listeners of the host
   * called back synchronously), then answers whether each was not canceled. This is the same work as calling
   * `target.dispatchEvent(new Event(...))` one by one, with one bridge round trip for the sequence instead of two
   * per event; a host that must read or change the page between events should dispatch them itself.
   */
  fireSequence(target: object, events: SequenceEvent[]): boolean[] {
    const cell = target && (target as any)[HANDLE] as Cell | undefined;
    if (!cell) throw new TypeError("fireSequence: the target is not an object of the page.");
    const list = events.map((e) => ({ type: e.type, ctor: e.ctor, init: this.encode(e.init ?? {}) }));
    return this.sendJ(["fire", cell.id, list]) as boolean[];
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

  /** Give the guest a fresh deadline for the call about to run; 0 is QuickJS's "no limit". */
  private armDeadline(): void {
    this.vm.setDeadline(this.timeout === Infinity ? 0 : Date.now() + this.timeout);
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
    // a function of the page that is called, an object made, or a batch run, may change anything
    const runs = request[0] === "apply" || request[0] === "new" || request[0] === "del" || request[0] === "batch" || request[0] === "fire";
    if (runs) {
      // only after: what the host had read is still valid while the operation runs (it is dropped below, before
      // the host sees the answer), and a call that changes nothing then pays no re-read
      this.armDeadline();
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
    // These never change for the object they belong to, so they avoid a call every time they are read. The
    // interface has them as accessors, so they must not answer from anywhere else (an element's namespaceURI,
    // a document's defaultView).
    if (key === "namespaceURI" && cell.t === 1) {
      if (cell.u !== undefined) return cell.u;
      const value = this.send("g" + cell.id + "\u0001" + key);
      cell.u = value as string;
      return value;
    }
    if (key === "defaultView" && cell.t === 9) {
      if (cell.dvSet) return cell.dv;
      const value = this.send("g" + cell.id + "\u0001" + key);
      cell.dv = value;
      cell.dvSet = true;
      return value;
    }
    // React asks every event target for this one (getEventTarget); only an SVG <use> has it, and for anything
    // else the property does not exist. Answering it here is the same answer the page would give, without a call.
    if (key === "correspondingUseElement" && cell.t === 1 && cell.l !== "use") return undefined;
    if (key === "ownerDocument" && cell.t !== 9) {
      if (cell.odg === this.odGen && cell.od !== undefined) return cell.od;
      const value = this.send("g" + cell.id + "\u0001" + key);
      if (value !== null && typeof value === "object") {
        cell.od = value;
        cell.odg = this.odGen;
      }
      return value;
    }
    const k = cell.id + "\u0001" + key;
    const store = key === "style" && cell.t === 1 ? this.styleObjs : STRUCT_KEYS.has(key) ? this.sreads : this.reads;
    if (store.has(k)) return store.get(k);
    const value = this.send("g" + cell.id + "\u0001" + key);
    if (store.size > 100000) store.clear();
    store.set(k, value);
    return value;
  }

  private encodeToken(a: unknown): string | null {
    if (a === null) return "N";
    if (typeof a === "boolean") return a ? "T" : "F";
    if (typeof a === "number" && Number.isFinite(a) && !Object.is(a, -0)) return "n" + a;
    if (typeof a === "string" && !a.includes("\u0002") && !a.includes("\u0001")) return "s" + a;
    const cell = a && (typeof a === "object" || typeof a === "function") ? ((a as any)[HANDLE] as Cell | undefined) : undefined;
    if (cell) return "h" + cell.id;
    // a function of the host's (an event handler): the id the page knows it by, as `encode` numbers it. A class of the
    // page's own interfaces travels as its name, so it takes the JSON form.
    if (typeof a === "function" && !Object.prototype.hasOwnProperty.call(a, CLASS_NAME)) return "f" + this.functionId(a as Function);
    return null;
  }

  /** The id the page knows `fn` by, registering it the first time (the same numbering `encode` uses). */
  private functionId(fn: Function): number {
    let id = this.fnIds.get(fn);
    if (id === undefined) {
      id = this.nextFn++;
      this.fnIds.set(fn, id);
      this.fnById.set(id, fn);
    }
    this.fnUsed.add(id);
    return id;
  }

  private set(cell: Cell, key: string, value: unknown): void {
    // The same handler set again (React sets `onclick = noop` on every update): the page already has it. What the host
    // knows of the page is dropped whenever page code might have run, and setAttribute("on...") drops it for its key.
    if (cell.t === 1 && ON_HANDLER.test(key)) {
      const memo = cell.id + "\u0001set:" + key;
      if (typeof value === "function") {
        if (this.sreads.get(memo) === value) return;
      } else {
        this.sreads.delete(memo);
      }
    }
    // a repeat of a state-only write with the value already in the page (written by the host
    // before, or just read back from it) has nothing to do: skip the crossing entirely
    const memoizable =
      (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      (cell.t === 1
        ? FINE_SET_KEYS.has(key) && cell.l !== "select"
        : cell.t === 3 || cell.t === 8
          ? TEXT_SET_KEYS.has(key)
          : cell.c === "CSSStyleDeclaration");
    if (memoizable) {
      const per = this.setMemo.get(cell.id);
      if (per && per.get(key) === value) return;
      const rk = cell.id + "\u0001" + key;
      if (this.reads.get(rk) === value && this.reads.has(rk)) {
        if (per) per.set(key, value);
        else this.setMemo.set(cell.id, new Map([[key, value]]));
        return;
      }
    }
    if (
      (cell.t === 1
        ? (FINE_SET_KEYS.has(key) || ON_HANDLER.test(key)) && cell.l !== "select"
        : cell.t === 3 || cell.t === 8
          ? TEXT_SET_KEYS.has(key)
          : cell.c === "CSSStyleDeclaration") &&
      this.fineOk()
    ) this.invalidateAttrs();
    // an assignment runs page code only through a custom element (`ce` says there is none), and moves a node to another
    // document only when it is given a node
    else this.invalidate(true, value === null || (typeof value !== "object" && typeof value !== "function") || !(value as any)[HANDLE]);
    if (typeof value === "string" && !value.includes("\u0001") && !value.includes("\u0002")) {
      this.send("s" + cell.id + "\u0001" + key + "\u0001\u0003" + value);
    } else {
      const tok = this.encodeToken(value);
      if (tok !== null) {
        this.send("s" + cell.id + "\u0001" + key + "\u0001" + (tok.charCodeAt(0) === 102 ? "\u0006" : "\u0004") + tok);
      } else {
        this.send("s" + cell.id + "\u0001" + key + "\u0001" + JSON.stringify(this.encode(value)));
      }
    }
    if (cell.t === 1 && typeof value === "function" && ON_HANDLER.test(key)) {
      if (this.sreads.size > 100000) this.sreads.clear();
      this.sreads.set(cell.id + "\u0001set:" + key, value);
    }
    if (memoizable) {
      let per = this.setMemo.get(cell.id);
      if (!per) {
        per = new Map();
        this.setMemo.set(cell.id, per);
      }
      // a cssText write replaces every declaration, so the cell's other style memos go with it
      if (key === "cssText") per.clear();
      per.set(key, value);
    }
  }

  /** True when the receiver and every node among the arguments are known to belong to one and the same document. */
  private sameDocument(cell: Cell, args: unknown[]): boolean {
    if (cell.odg !== this.odGen || cell.od === undefined) return false;
    for (const a of args) {
      if (a === null || (typeof a !== "object" && typeof a !== "function")) continue;
      const c = (a as any)[HANDLE] as Cell | undefined;
      if (!c || c.odg !== this.odGen || c.od !== cell.od) return false;
    }
    return true;
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
    let fn = false;
    for (const a of args) {
      const tok = this.encodeToken(a);
      if (tok === null) return JSON.stringify(args.map((x) => this.encode(x)));
      if (tok.charCodeAt(0) === 102) fn = true;
      parts.push(tok);
    }
    // \u0006: the same tokens with a function among them, which the fast path in C does not read (the guest does)
    return (fn ? "\u0006" : "\u0004") + parts.join("\u0002");
  }

  private call(cell: Cell, key: string, args: unknown[], self?: unknown): unknown {
    if (key === "matches" && cell.t === 1 && typeof cell.l === "string" && typeof args[0] === "string") {
      const check = analyzeSelector(args[0]);
      if (check.alwaysTrue) return true;
      if (check.tagRequired && !check.tagRequired.has(cell.l.toLowerCase())) return false;
    }
    const encoded = this.encodeArgs(args);
    if (cell.t === 9 ? CREATE_CALLS.has(key) : cell.t === 1 ? ATTR_CALLS.has(key) || LISTENER_CALLS.has(key) : false) {
      // nothing that was read can have changed (a new node is in no tree, a listener is not read), or only an attribute did
      if (this.fineOk()) {
        const value = this.send("c" + cell.id + "\u0001" + key + "\u0001" + encoded);
        if (cell.t === 9) {
          // a node made by a document belongs to it
          const made = value && typeof value === "object" ? ((value as any)[HANDLE] as Cell | undefined) : undefined;
          if (made && self) {
            made.od = self;
            made.odg = this.odGen;
          }
        }
        if (cell.t === 1 && !LISTENER_CALLS.has(key)) {
          this.invalidateAttrs();
          // an attribute write on this element can back any of its properties (class/className,
          // value/defaultValue, checked), so the element's set memos no longer describe the page
          this.setMemo.delete(cell.id);
          // setAttribute("onclick", "...") replaces the handler the host set
          const attr = typeof args[0] === "string" ? args[0].toLowerCase() : "";
          if (attr.startsWith("on")) this.sreads.delete(cell.id + "\u0001set:" + attr);
        }
        return value;
      }
    }
    if (!PURE_CALLS.has(key)) {
      // the drop after is what makes the calls that follow see the page's new state; dropping before as well
      // only threw away reads that were still good, so it is not done
      const value = this.send("c" + cell.id + "\u0001" + key + "\u0001" + encoded);
      // a change of the tree runs page code only through a custom element (`ce` says there is none); it moves a node to
      // another document only when the receiver and a node it was given are not known to be of one document
      const tree = TREE_CALLS.has(key);
      this.invalidate(tree, tree && this.sameDocument(cell, args));
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
        return { $: "f", i: this.functionId(v as Function) };
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
        return this.cls(x.n);
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
    const cell: Cell = { id: h.i, count: 1, c: h.c, t: h.t, n: h.n, l: h.l, g: h.g };
    let w: any;
    const cls = h.c ? this.cls(h.c) : undefined;
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
        // every own name of the page's window (non-enumerable interfaces included), for installWindow
        if (k === WIN_KEYS) return () => this.sendJ(["names", cell.id]) as string[];
        if (typeof k === "symbol") {
          if (k === Symbol.iterator && this.sendJ(["has", cell.id, "length"])) return () => (this.sendJ(["array", cell.id]) as unknown[])[Symbol.iterator]();
          return undefined;
        }
        if (k === "then") return undefined;
        if (isWindow && typeof k === "string" && this.schemaByName.has(k)) return this.cls(k);
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
        if (isWindow && typeof k === "string" && this.schemaByName.has(k)) {
          return { value: this.cls(k), writable: true, enumerable: true, configurable: true };
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
    const proto = (this.cls(key === "childNodes" ? "NodeList" : "HTMLCollection") ?? Object).prototype;
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
      has: (t, k) => (typeof k === "string" && (k === "length" || (INDEX.test(k) && Number(k) < nodes().length)) ? true : Reflect.has(t, k)),
      ownKeys: () => [...nodes().keys()].map(String),
      getOwnPropertyDescriptor: (t, k) => (typeof k === "string" && INDEX.test(k) && Number(k) < nodes().length ? { value: nodes()[Number(k)], enumerable: true, configurable: true, writable: false } : undefined),
    }));
  }

  // ---- the classes of the interfaces ----

  private buildClasses(schema: InterfaceSchema[]): void {
    const byName = new Map(schema.map((s) => [s.n, s]));
    this.schemaByName = byName;
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
            value: { [k]: function (this: any, ...args: unknown[]) { return bridge.call(this[HANDLE], k, args, this); } }[k],
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
    this.makeClass = make;
  }

  // ---- calls from the guest ----

  /**
   * The page calls a function of the host's (`id`, as `encode` numbered it) with `args`; the answer is a token
   * string or JSON: `{ v }` or `{ x }`. A callback whose arguments and answer are handles, strings and primitives
   * (an event listener, almost always) goes as the compact token form: no JSON on either side.
   */
  callback(id: number, args: string): string | undefined {
    const fn = this.fnById.get(id);
    if (!fn) return undefined;
    // the page may have changed anything since the host last read (the guest sets the event's currentTarget and
    // eventPhase before each listener, and a listener of the page's may have touched the tree)
    this.invalidate();
    this.depth++;
    try {
      let self: unknown;
      let list: unknown[];
      if (args.charCodeAt(0) === 5) {
        const tokens = args.slice(1).split("\u0002");
        self = this.decodeToken(tokens[0]);
        list = tokens.slice(1).map((t) => this.decodeToken(t));
      } else {
        const parsed = JSON.parse(args) as [unknown, unknown[]];
        self = this.decode(parsed[0]);
        list = parsed[1].map((a) => this.decode(a));
      }
      const value = fn.apply(self, list);
      const token = this.tokenOf(value);
      return token !== null ? "\u0006" + token : JSON.stringify({ v: this.encode(value) });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return JSON.stringify({ x: { n: err.name, m: err.message, s: err.stack } });
    } finally {
      // no invalidation here: a write the listener made has already dropped the cache, and dropping reads that
      // were taken after it would only make the next listener read them again
      this.depth--;
    }
  }

  /** A value in the compact callback form: `U` undefined, `N` null, `T`/`F`, `n<number>`, `s<string>`, `h<id>`. */
  private tokenOf(v: unknown): string | null {
    if (v === undefined) return "U";
    if (v === null) return "N";
    if (typeof v === "boolean") return v ? "T" : "F";
    if (typeof v === "number" && Number.isFinite(v) && !Object.is(v, -0)) return "n" + v;
    if (typeof v === "string") return v.includes("\u0001") || v.includes("\u0002") ? null : "s" + v;
    const cell = v && typeof v === "object" ? ((v as any)[HANDLE] as Cell | undefined) : undefined;
    return cell ? "h" + cell.id : null;
  }

  private decodeToken(t: string): unknown {
    switch (t.charCodeAt(0)) {
      case 85: // U
        return undefined;
      case 78: // N
        return null;
      case 84: // T
        return true;
      case 70: // F
        return false;
      case 110: // n
        return Number(t.slice(1));
      case 115: // s
        return t.slice(1);
      case 104: // h
        return this.handleOf(t.slice(1));
      default:
        return undefined;
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
