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
  /** a node a transaction has queued the creation of: it has no page id until the transaction flushes */
  pending?: boolean;
  /** a node whose creation a failed transaction never reached: using it throws */
  dead?: boolean;
  /** the wrapper itself, for a placeholder (it is in no wrappers map until the flush adopts it) */
  self?: unknown;
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
/** Tags whose interface name is not "HTML" + the capitalised tag + "Element" (for a transaction placeholder's first guess; the flush corrects it). */
const TAG_INTERFACES: Record<string, string> = {
  a: "HTMLAnchorElement",
  ul: "HTMLUListElement",
  ol: "HTMLOListElement",
  dl: "HTMLDListElement",
  img: "HTMLImageElement",
  br: "HTMLBRElement",
  hr: "HTMLHRElement",
  h1: "HTMLHeadingElement",
  h2: "HTMLHeadingElement",
  h3: "HTMLHeadingElement",
  h4: "HTMLHeadingElement",
  h5: "HTMLHeadingElement",
  h6: "HTMLHeadingElement",
  p: "HTMLParagraphElement",
  td: "HTMLTableCellElement",
  th: "HTMLTableCellElement",
  tr: "HTMLTableRowElement",
  col: "HTMLTableColElement",
  q: "HTMLQuoteElement",
  blockquote: "HTMLQuoteElement",
  textarea: "HTMLTextAreaElement",
  input: "HTMLInputElement",
  select: "HTMLSelectElement",
  option: "HTMLOptionElement",
  optgroup: "HTMLOptGroupElement",
  link: "HTMLLinkElement",
  meta: "HTMLMetaElement",
  base: "HTMLBaseElement",
  script: "HTMLScriptElement",
  style: "HTMLStyleElement",
  title: "HTMLTitleElement",
  html: "HTMLHtmlElement",
  head: "HTMLHeadElement",
  body: "HTMLBodyElement",
  div: "HTMLDivElement",
  span: "HTMLSpanElement",
  li: "HTMLLIElement",
  form: "HTMLFormElement",
  label: "HTMLLabelElement",
  button: "HTMLButtonElement",
  fieldset: "HTMLFieldSetElement",
  legend: "HTMLLegendElement",
  table: "HTMLTableElement",
  caption: "HTMLTableCaptionElement",
  video: "HTMLVideoElement",
  audio: "HTMLAudioElement",
  canvas: "HTMLCanvasElement",
  iframe: "HTMLIFrameElement",
  object: "HTMLObjectElement",
  embed: "HTMLEmbedElement",
  source: "HTMLSourceElement",
  track: "HTMLTrackElement",
  area: "HTMLAreaElement",
  map: "HTMLMapElement",
  pre: "HTMLPreElement",
  dialog: "HTMLDialogElement",
  details: "HTMLDetailsElement",
  menu: "HTMLMenuElement",
  template: "HTMLTemplateElement",
  picture: "HTMLPictureElement",
  progress: "HTMLProgressElement",
  meter: "HTMLMeterElement",
  output: "HTMLOutputElement",
  data: "HTMLDataElement",
  time: "HTMLTimeElement",
  mod: "HTMLModElement",
  ins: "HTMLModElement",
  del: "HTMLModElement",
};
/** Calls a transaction may queue: they build or rearrange the tree, set attributes, or register listeners, and
 * either answer nothing or a node among their arguments. (toggleAttribute is absent: it answers a boolean the
 * host cannot know before the page does.) */
const TXN_CALLS = new Set([
  "appendChild",
  "insertBefore",
  "removeChild",
  "replaceChild",
  "append",
  "prepend",
  "before",
  "after",
  "replaceWith",
  "remove",
  "setAttribute",
  "setAttributeNS",
  "removeAttribute",
  "addEventListener",
  "removeEventListener",
]);
/** Properties of an element whose assignment changes an attribute or a value, runs no code and moves no node. */
const FINE_SET_KEYS = new Set([
  "className", "id", "title", "lang", "dir", "hidden", "disabled", "checked", "value", "defaultValue", "defaultChecked", "href", "src", "type", "name", "placeholder",
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

/** One queued operation of a transaction (see Bridge.transact): the raw arguments are kept and encoded at the flush. */
interface TxnOp {
  kind: "call" | "create" | "set";
  cell: Cell;
  key: string;
  args?: unknown[];
  value?: unknown;
  placeholder?: { cell: Cell; wrapper: object };
}

interface TxnState {
  ops: TxnOp[];
  /** the last value queued for a state-only property, per cell: a read of it answers from here */
  written: Map<Cell, Map<string, unknown>>;
  /** the attributes queued per cell (null: removed): they back the reflected-property reads of a fresh node */
  attrs: Map<Cell, Map<string, string | null>>;
  /** the children queued under a placeholder parent, in order: a fresh node's tree is exactly this */
  kids: Map<Cell, unknown[]>;
  /** the parent a queued structural call gave a node (null: known to have none) */
  parentOf: Map<Cell, unknown>;
  /** placeholder parents whose queued children are not fully known (a string went into append/prepend/…) */
  noShadow: Set<Cell>;
  /** every node this transaction has made, adopted or not: nothing but the queue has touched them */
  fresh: Set<Cell>;
  /** every cell a queued operation touches (as target, or as a moved child): cached answers for it are not trusted */
  touched: Set<Cell>;
  /** cells whose place in the tree a queued operation may have changed (targets, moved children, old and new parents) */
  treeTouched: Set<Cell>;
  /** a text-bearing write or a structural operation has been queued: text reads of anything may have moved */
  textDirty: boolean;
}

/** Reads that describe a node's place in the tree: only a tree change moves them. */
const TREE_READ_KEYS = new Set([
  "firstChild",
  "lastChild",
  "firstElementChild",
  "lastElementChild",
  "nextSibling",
  "previousSibling",
  "nextElementSibling",
  "previousElementSibling",
  "childNodes",
  "children",
  "parentNode",
  "parentElement",
  "isConnected",
  "childElementCount",
]);

/** Property → attribute for the reflected properties (the guest's reflectString/reflectBool tables). */
const REFLECT_STR: Record<string, string> = {
  className: "class",
  id: "id",
  title: "title",
  lang: "lang",
  dir: "dir",
  slot: "slot",
  href: "href",
  src: "src",
  alt: "alt",
  name: "name",
  type: "type",
  rel: "rel",
  target: "target",
  placeholder: "placeholder",
  htmlFor: "for",
  accessKey: "accesskey",
  tabIndex: "tabindex",
};
const REFLECT_BOOL: Record<string, string> = {
  hidden: "hidden",
  disabled: "disabled",
  required: "required",
  readOnly: "readonly",
  multiple: "multiple",
  autofocus: "autofocus",
  open: "open",
};
/** Attribute → the properties it backs, for dropping queued property values an attribute write supersedes. */
const ATTR_PROPS: Record<string, string[]> = { value: ["value", "defaultValue"], checked: ["checked", "defaultChecked"] };
for (const [prop, attr] of Object.entries(REFLECT_STR)) (ATTR_PROPS[attr] ??= []).push(prop);
for (const [prop, attr] of Object.entries(REFLECT_BOOL)) (ATTR_PROPS[attr] ??= []).push(prop);

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
  private pinLimit = 1024;
  private pinSweeping = false;
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
  /** The running transaction (Bridge.transact), when one is open. */
  private txn: TxnState | null = null;
  private txnFlushing = false;
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
        bridge.pin(r);
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
        bridge.pin(r);
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

  /**
   * Keep a wrapper the host put its own properties on (React's fiber pointers, say) alive: the page holds the object
   * for as long as the wrapper lives, so a wrapper nobody else refers to would otherwise be collected and lose them.
   * Pinned wrappers of nodes that have left the document are let go in sweeps (see sweepPinned), or none of a framework's
   * removed nodes would ever be freed, in the host or in the page.
   */
  private pin(wrapper: object): void {
    this.pinned.add(wrapper);
    if (this.pinned.size >= this.pinLimit && !this.txn && !this.pinSweeping && !this.closed) this.sweepPinned();
  }

  private sweepPinned(): void {
    this.pinSweeping = true;
    try {
      const byId = new Map<number, object[]>();
      for (const w of this.pinned) {
        const cell = (w as any)[HANDLE] as Cell | undefined;
        if (!cell || cell.pending || cell.dead || typeof cell.id !== "number") continue;
        const list = byId.get(cell.id);
        if (list) list.push(w);
        else byId.set(cell.id, [w]);
      }
      if (byId.size) {
        for (const id of this.sendJ(["detached", [...byId.keys()]]) as number[]) for (const w of byId.get(id) ?? []) this.pinned.delete(w);
      }
    } finally {
      this.pinSweeping = false;
      // the next sweep when the pinned set has doubled since this one: the cost stays proportional to what is added
      this.pinLimit = Math.max(1024, this.pinned.size * 2);
    }
  }

  /** How many wrappers carry host-set properties and are kept alive for them (for tests that look for leaks). */
  pinnedCount(): number {
    return this.pinned.size;
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

  // ---- transactions ---------------------------------------------------------------------
  // A synchronous run of host DOM mutations (a framework's commit phase is the shape) pays a
  // bridge crossing per operation when it goes one by one. Inside transact(), the queueable
  // operations — node creation, the structural calls, attribute and listener calls, and the
  // state-only property writes — are queued instead and flushed as ONE compact transaction
  // (the "txn" operation of rpc.js) when something needs the page's answer: a read that is
  // not answered locally, a call that is not queueable, or the end of the scope. A node made
  // inside is handed out at once as a placeholder whose handle is filled in by the flush;
  // its tagName/nodeType/localName already answer from the placeholder. Semantics that a
  // queue cannot keep are the documented price: page side effects of the queued operations
  // (custom-element callbacks, mutation records) happen at the flush, in order, not at the
  // line that queued them, and an exception of the page surfaces at the flush, not at the call.

  /** Run `fn` with bridge operations queued and flushed as one transaction (see above). Nested calls join the outer transaction. */
  transact<T>(fn: () => T): T {
    if (this.txn) return fn();
    const state: TxnState = {
      ops: [],
      written: new Map(),
      attrs: new Map(),
      kids: new Map(),
      parentOf: new Map(),
      noShadow: new Set(),
      fresh: new Set(),
      touched: new Set(),
      treeTouched: new Set(),
      textDirty: false,
    };
    this.txn = state;
    try {
      const out = fn();
      this.flushTxn();
      return out;
    } catch (e) {
      // the operations queued before the failure were intended: apply them, as the page
      // would have seen them had the calls been made one by one, then let the error through
      try {
        this.flushTxn();
      } catch {
        /* the original error is the one that matters */
      }
      throw e;
    } finally {
      this.txn = null;
    }
  }

  /** Flush the queued operations of the running transaction, if any. */
  private flushTxn(): void {
    const state = this.txn;
    if (!state || state.ops.length === 0) return;
    if (this.txnFlushing) {
      // a host function called back while a flush runs, and now needs the page: only safe
      // when nothing queued refers to a node the running flush has not made yet
      for (const op of state.ops) {
        if (op.cell.pending || (op.args ?? []).some((a) => ((a as any)?.[HANDLE] as Cell | undefined)?.pending)) {
          throw new Error("quickjs-dom: a page callback used a node of the transaction that is still being applied; read it after the transaction ends");
        }
      }
    }
    const ops = state.ops;
    state.ops = [];
    const indexOf = new Map<Cell, number>();
    ops.forEach((op, i) => {
      if (op.placeholder) indexOf.set(op.placeholder.cell, i);
    });
    const records = ops.map((op) => this.txnRecord(op, indexOf));
    this.txnFlushing = true;
    let payload: string;
    try {
      payload = this.sendJ(["txn", records.join("\u0005")]) as string;
    } finally {
      this.txnFlushing = false;
    }
    let failedAt = -1;
    let failMessage = "";
    let linesText = payload;
    if (payload.startsWith("!")) {
      const bang = payload.indexOf("\u0001");
      failedAt = Number(payload.slice(1, bang));
      const rest = payload.slice(bang + 1);
      const cut = rest.indexOf("\u0005");
      failMessage = cut < 0 ? rest : rest.slice(0, cut);
      linesText = cut < 0 ? "" : rest.slice(cut + 1);
    }
    const lines = linesText === "" ? [] : linesText.split("\u0005");
    let li = 0;
    ops.forEach((op, i) => {
      if (op.kind === "set") return;
      const line = lines[li++];
      if (op.kind !== "create" || !op.placeholder) return;
      if (failedAt >= 0 && i >= failedAt) {
        op.placeholder.cell.dead = true;
        op.placeholder.cell.pending = false;
        // the identity facts the placeholder was pre-filled with go too: the class getters
        // answer them locally, and a node that was never created has no answers — every
        // access must reach the dead check in get/set/call instead
        op.placeholder.cell.t = undefined;
        op.placeholder.cell.n = undefined;
        op.placeholder.cell.l = undefined;
        op.placeholder.cell.g = undefined;
        op.placeholder.cell.u = undefined;
        op.placeholder.cell.c = undefined;
      } else if (line && line !== "-") {
        this.adoptPlaceholder(op.placeholder, line);
        // the node exists in the page now: the fresh-node derivations and the shadow child
        // list (maintained only while the parent is unmade) no longer describe it. Its
        // parentOf entry and the queued-write records stay — those are kept for every op.
        state.fresh.delete(op.placeholder.cell);
        state.kids.delete(op.placeholder.cell);
      }
    });
    if (failedAt >= 0) throw new Error(`quickjs-dom: transaction failed at operation ${failedAt}: ${failMessage}`);
  }

  /** Give a placeholder the handle its creation answered with, and register it like any wrapper. */
  private adoptPlaceholder(ph: { cell: Cell; wrapper: object }, line: string): void {
    const parts = line.slice(1).split("\u0001"); // the line keeps handleString's leading "h"
    const cell = ph.cell;
    cell.id = Number(parts[0]);
    if (parts[1]) cell.c = parts[1];
    cell.t = parts[2] ? Number(parts[2]) : undefined;
    cell.n = parts[3] || undefined;
    for (let i = 4; i < parts.length; i++) {
      if (parts[i].startsWith("l:")) cell.l = parts[i].slice(2);
      else if (parts[i].startsWith("g:")) cell.g = parts[i].slice(2);
    }
    cell.pending = false;
    cell.odg = this.odGen;
    const cls = cell.c ? this.cls(cell.c) : undefined;
    if (cls && Object.getPrototypeOf(ph.wrapper) !== cls.prototype) Object.setPrototypeOf(ph.wrapper, cls.prototype);
    this.wrappers.set(cell.id, new WeakRef(ph.wrapper as object));
    this.registry.register(ph.wrapper, cell);
  }

  /** The compact record of one queued operation, with result references resolved against this flush. */
  private txnRecord(op: TxnOp, indexOf: Map<Cell, number>): string {
    const targetOf = (cell: Cell): string => {
      const i = indexOf.get(cell);
      return i !== undefined ? "r" + i : "h" + cell.id;
    };
    const tokenOf = (a: unknown): string | null => {
      const cell = a && (typeof a === "object" || typeof a === "function") ? ((a as any)[HANDLE] as Cell | undefined) : undefined;
      if (cell) return targetOf(cell);
      return this.encodeToken(a);
    };
    const argsOf = (args: unknown[]): string => {
      if (args.length === 0) return "";
      if (args.every((a) => typeof a === "string")) return "\u0003" + args.join("\u0002");
      let fn = false;
      const parts: string[] = [];
      for (const a of args) {
        const tok = tokenOf(a);
        if (tok === null) throw new Error("quickjs-dom: an argument of a queued operation cannot be encoded");
        if (tok.charCodeAt(0) === 102) fn = true;
        parts.push(tok);
      }
      return (fn ? "\u0006" : "\u0004") + parts.join("\u0002");
    };
    const head = (op.kind === "create" ? "C" : op.kind === "call" ? "c" : "s") + targetOf(op.cell) + "\u0001" + op.key + "\u0001";
    if (op.kind === "set") {
      const v = op.value;
      if (typeof v === "string") return head + "\u0003" + v;
      const tok = tokenOf(v);
      if (tok === null) throw new Error("quickjs-dom: a value of a queued set cannot be encoded");
      return head + (tok.charCodeAt(0) === 102 ? "\u0006" : "\u0004") + tok;
    }
    return head + argsOf(op.args ?? []);
  }

  /** True when a value can travel in a transaction record: a compact token, a page object, or a string free of the record separators. */
  private txnEncodable(a: unknown): boolean {
    if (typeof a === "string") return !a.includes("\u0001") && !a.includes("\u0002") && !a.includes("\u0005");
    if (a && (typeof a === "object" || typeof a === "function") && (a as any)[HANDLE]) return true;
    return this.encodeToken(a) !== null;
  }

  /** The wrapper handed out for a node a transaction has queued the creation of (its handle arrives at the flush). */
  private makePlaceholder(docCell: Cell, doc: unknown, key: string, args: unknown[]): { cell: Cell; wrapper: object } | null {
    let clsName: string | undefined;
    let t: number | undefined, n: string | undefined, l: string | undefined, g: string | undefined;
    if (key === "createTextNode") {
      clsName = "Text";
      t = 3;
      n = "#text";
    } else if (key === "createComment") {
      clsName = "Comment";
      t = 8;
      n = "#comment";
    } else if (key === "createDocumentFragment") {
      clsName = "DocumentFragment";
      t = 11;
      n = "#document-fragment";
    } else if (key === "createElement" || key === "createElementNS") {
      const ns = key === "createElementNS" ? String(args[0] ?? "") : "";
      const name = String(key === "createElementNS" ? (args[1] ?? "") : (args[0] ?? ""));
      const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
      t = 1;
      l = local.toLowerCase();
      if (ns === "" || ns === "http://www.w3.org/1999/xhtml") {
        n = g = local.toUpperCase();
        clsName = TAG_INTERFACES[l] ?? "HTML" + l.charAt(0).toUpperCase() + l.slice(1) + "Element";
        if (!this.classes.has(clsName) && !this.schemaByName.has(clsName)) clsName = "HTMLElement";
      } else if (ns === "http://www.w3.org/2000/svg") {
        n = g = name;
        clsName = "SVGElement";
      } else {
        n = g = name;
        clsName = "Element";
      }
    } else return null;
    const cls = this.cls(clsName) ?? this.cls("Node");
    if (!cls) return null;
    const cell: Cell = { id: -1, count: 1, pending: true, c: clsName, t, n, l, g, od: doc, odg: this.odGen };
    const wrapper = this.classWrapper(cell, cls);
    cell.self = wrapper;
    return { cell, wrapper };
  }

  /** Queue a call of the running transaction, when it is one of the queueable ones. */
  private queueCall(cell: Cell, key: string, args: unknown[], self?: unknown): { hit: boolean; value?: unknown } {
    const state = this.txn;
    if (!state) return { hit: false };
    if (cell.t === 9 && CREATE_CALLS.has(key)) {
      if (!args.every((a) => this.txnEncodable(a))) return { hit: false };
      const ph = this.makePlaceholder(cell, self, key, args);
      if (!ph) return { hit: false };
      state.ops.push({ kind: "create", cell, key, args: [...args], placeholder: ph });
      state.parentOf.set(ph.cell, null);
      state.kids.set(ph.cell, []);
      state.fresh.add(ph.cell);
      return { hit: true, value: ph.wrapper };
    }
    if (cell.t !== 9 && TXN_CALLS.has(key)) {
      if (!args.every((a) => this.txnEncodable(a))) return { hit: false };
      state.ops.push({ kind: "call", cell, key, args: [...args] });
      state.touched.add(cell);
      for (const a of args) {
        const ac = a && typeof a === "object" ? ((a as any)[HANDLE] as Cell | undefined) : undefined;
        if (ac) state.touched.add(ac);
      }
      if (ATTR_CALLS.has(key)) {
        this.setMemo.delete(cell.id);
        this.txnAttr(state, cell, key, args);
      } else if (!LISTENER_CALLS.has(key)) {
        state.treeTouched.add(cell);
        state.textDirty = true;
        for (const a of args) {
          const ac = a && typeof a === "object" ? ((a as any)[HANDLE] as Cell | undefined) : undefined;
          if (ac) {
            state.treeTouched.add(ac);
            const oldParent = state.parentOf.get(ac);
            const opc = oldParent && typeof oldParent === "object" ? ((oldParent as any)[HANDLE] as Cell | undefined) : undefined;
            if (opc) state.treeTouched.add(opc);
          }
        }
        this.txnTree(state, cell, self, key, args);
      }
      // the structural calls answer a node among their arguments; the rest answer nothing
      const value =
        key === "appendChild" || key === "insertBefore" || key === "removeChild" ? args[0] : key === "replaceChild" ? args[1] : undefined;
      return { hit: true, value };
    }
    return { hit: false };
  }

  /** Record a queued attribute write: it backs the cell's reflected properties from here on. */
  private txnAttr(state: TxnState, cell: Cell, key: string, args: unknown[]): void {
    let name: string | undefined;
    let value: string | null = null;
    if (key === "setAttribute") {
      name = String(args[0]).toLowerCase();
      value = String(args[1]);
    } else if (key === "setAttributeNS") {
      name = String(args[1]);
      value = String(args[2]);
    } else if (key === "removeAttribute") {
      name = String(args[0]).toLowerCase();
    } else if (key === "removeAttributeNS") {
      name = String(args[1]);
    } else return;
    let per = state.attrs.get(cell);
    if (!per) {
      per = new Map();
      state.attrs.set(cell, per);
    }
    per.set(name, value);
    const backed = ATTR_PROPS[name];
    const w = state.written.get(cell);
    if (backed && w) for (const prop of backed) w.delete(prop);
  }

  /** Keep the shadow of a placeholder's children (and every queued node's parent) current for a structural call. */
  private txnTree(state: TxnState, cell: Cell, self: unknown, key: string, args: unknown[]): void {
    const cellOf = (w: unknown): Cell | undefined => (w && typeof w === "object" ? ((w as any)[HANDLE] as Cell) : undefined);
    const detach = (child: unknown): void => {
      const cc = cellOf(child);
      if (!cc) return;
      const parent = state.parentOf.get(cc);
      const pc = parent ? cellOf(parent) : undefined;
      const list = pc ? state.kids.get(pc) : undefined;
      if (list) {
        const i = list.indexOf(child);
        if (i >= 0) list.splice(i, 1);
      }
      state.parentOf.delete(cc);
    };
    const attach = (parent: unknown, parentCell: Cell, child: unknown, at?: number): void => {
      detach(child);
      const cc = cellOf(child);
      if (cc) state.parentOf.set(cc, parent);
      if (parentCell.pending) {
        const list = state.kids.get(parentCell) ?? [];
        if (at === undefined || at < 0 || at > list.length) list.push(child);
        else list.splice(at, 0, child);
        state.kids.set(parentCell, list);
      }
    };
    const nodes = (list: unknown[]): boolean => list.every((a) => !!cellOf(a));
    switch (key) {
      case "appendChild":
        attach(self, cell, args[0]);
        break;
      case "insertBefore": {
        const list = state.kids.get(cell);
        const at = args[1] == null ? -1 : list ? list.indexOf(args[1]) : -1;
        if (cell.pending && args[1] != null && at < 0) state.noShadow.add(cell);
        attach(self, cell, args[0], at < 0 ? undefined : at);
        break;
      }
      case "removeChild": {
        const list = state.kids.get(cell);
        if (list) {
          const i = list.indexOf(args[0]);
          if (i >= 0) list.splice(i, 1);
        }
        const cc = cellOf(args[0]);
        if (cc) state.parentOf.set(cc, null);
        break;
      }
      case "replaceChild": {
        const list = state.kids.get(cell);
        const oc = cellOf(args[1]);
        if (oc) state.parentOf.set(oc, null);
        if (list) {
          const i = list.indexOf(args[1]);
          if (i >= 0) list[i] = args[0];
        }
        const nc = cellOf(args[0]);
        if (nc) state.parentOf.set(nc, self);
        break;
      }
      case "append":
      case "prepend": {
        if (!nodes(args)) {
          if (cell.pending) state.noShadow.add(cell);
          for (const a of args) {
            const ac = cellOf(a);
            if (ac) state.parentOf.set(ac, self);
          }
          break;
        }
        const list = state.kids.get(cell) ?? [];
        if (key === "append") for (const a of args) attach(self, cell, a);
        else args.forEach((a, i) => attach(self, cell, a, i));
        break;
      }
      case "before":
      case "after":
      case "replaceWith": {
        const parent = state.parentOf.get(cell);
        const pc = parent ? cellOf(parent) : undefined;
        if (!pc || !nodes(args)) break;
        const list = state.kids.get(pc);
        if (!list) break;
        const i = list.indexOf(self);
        if (i < 0) break;
        if (key === "replaceWith") {
          list.splice(i, 1, ...args);
          state.parentOf.set(cell, null);
          for (const a of args) {
            const ac = cellOf(a);
            if (ac) state.parentOf.set(ac, parent);
          }
        } else {
          const at = key === "before" ? i : i + 1;
          args.forEach((a, j) => {
            detach(a);
            list.splice(at + j, 0, a);
            const ac = cellOf(a);
            if (ac) state.parentOf.set(ac, parent);
          });
        }
        break;
      }
      case "remove": {
        const parent = state.parentOf.get(cell);
        const pc = parent ? cellOf(parent) : undefined;
        const list = pc ? state.kids.get(pc) : undefined;
        if (list) {
          const i = list.indexOf(self);
          if (i >= 0) list.splice(i, 1);
        }
        state.parentOf.set(cell, null);
        break;
      }
    }
  }

  /** True when something in the queue could have changed this read's answer: the only reads that must flush. */
  private txnAffects(cell: Cell, key: string): boolean {
    const state = this.txn;
    if (!state) return false;
    if (key === "textContent" || key === "innerHTML" || key === "outerHTML") return state.textDirty || state.treeTouched.has(cell);
    if (TREE_READ_KEYS.has(key) || key === "ownerDocument") return state.treeTouched.has(cell);
    const w = state.written.get(cell);
    if (w) {
      if (w.has(key)) return true;
      // the value family shares state (the attribute, the dirty flag), as does checkedness
      if ((key === "value" || key === "defaultValue") && (w.has("value") || w.has("defaultValue"))) return true;
      if ((key === "checked" || key === "defaultChecked") && (w.has("checked") || w.has("defaultChecked"))) return true;
      // a text write can feed other answers of the same node (a textarea's value, an option's)
      if (w.has("textContent") || w.has("nodeValue") || w.has("data")) return true;
    }
    const at = state.attrs.get(cell);
    if (at) {
      for (const name of at.keys()) {
        const props = ATTR_PROPS[name];
        if (props && props.includes(key)) return true;
      }
    }
    return false;
  }

  /** Drop the transaction's model of a cell: an operation that was not queued has changed it in ways the queue did not record. */
  private txnForget(cell: Cell): void {
    const state = this.txn;
    if (!state) return;
    state.fresh.delete(cell);
    state.written.delete(cell);
    state.attrs.delete(cell);
    state.kids.delete(cell);
    state.noShadow.add(cell);
  }

  /** A read the running transaction can answer from what it has queued, without asking the page. */
  private txnRead(cell: Cell, key: string): { hit: boolean; value?: unknown } {
    const state = this.txn;
    if (!state) return { hit: false };
    const w = state.written.get(cell);
    if (w && w.has(key)) return { hit: true, value: w.get(key) };
    // an attribute queued in this transaction backs the reflected properties of any cell:
    // those getters are the attribute, by the guest's own definition
    const queuedAttrs = state.attrs.get(cell);
    if (queuedAttrs) {
      if (key === "defaultValue" && queuedAttrs.has("value")) return { hit: true, value: queuedAttrs.get("value") ?? "" };
      const rs = REFLECT_STR[key];
      if (rs && key !== "type" && key !== "tabIndex" && queuedAttrs.has(rs)) return { hit: true, value: queuedAttrs.get(rs) ?? "" };
      const rb = REFLECT_BOOL[key];
      if (rb && queuedAttrs.has(rb)) return { hit: true, value: queuedAttrs.get(rb) !== null };
    }
    if (key === "parentNode" && state.parentOf.has(cell)) return { hit: true, value: state.parentOf.get(cell) };
    if ((key === "nextSibling" || key === "previousSibling") && state.parentOf.has(cell)) {
      const parent = state.parentOf.get(cell);
      if (parent === null) return { hit: true, value: null };
      const pc = (parent as any)[HANDLE] as Cell;
      const list = state.kids.get(pc);
      const me = cell.self ?? this.wrappers.get(cell.id)?.deref();
      if (list && me) {
        const i = list.indexOf(me);
        if (i >= 0) return { hit: true, value: key === "nextSibling" ? (list[i + 1] ?? null) : (list[i - 1] ?? null) };
      }
      return { hit: false };
    }
    const fresh = cell.pending || state.fresh.has(cell);
    if (!fresh || state.noShadow.has(cell)) return { hit: false };
    if (ON_HANDLER.test(key)) return { hit: true, value: undefined };
    if (key === "firstChild" || key === "lastChild") {
      const kids = state.kids.get(cell);
      return { hit: true, value: kids && kids.length ? (key === "firstChild" ? kids[0] : kids[kids.length - 1]) : null };
    }
    // a fresh node has no page-side state beyond the queue: a property its interface does
    // not carry is an expando the page never set (the host's own sets live on the wrapper)
    const cls = cell.c ? this.cls(cell.c) : undefined;
    if (cls && !(key in cls.prototype) && !(key in cls)) return { hit: true, value: undefined };
    // the reflected properties of a fresh element: its queued attributes are all it has
    if (!(cell.c && (cell.c.startsWith("HTML") || cell.c === "Element"))) return { hit: false };
    const attrs = state.attrs.get(cell);
    const attr = (name: string): string | null => (attrs && attrs.has(name) ? attrs.get(name)! : null);
    if (key === "defaultValue" && cell.l !== "textarea") return { hit: true, value: attr("value") ?? "" };
    if (key === "value" && cell.l !== "textarea" && cell.l !== "select" && !(cell.l === "option" && attr("value") === null)) {
      // a queued defaultValue write lands as the value attribute, and a fresh control's own
      // value is still its default (nothing has set the dirty flag)
      const dv = w?.get("defaultValue");
      if (typeof dv === "string") return { hit: true, value: dv };
      return { hit: true, value: attr("value") ?? "" };
    }
    if (key === "checked" || key === "defaultChecked") return { hit: true, value: attr("checked") !== null };
    const rs = REFLECT_STR[key];
    if (rs) return { hit: true, value: attr(rs) ?? "" };
    const rb = REFLECT_BOOL[key];
    if (rb) return { hit: true, value: attr(rb) !== null };
    return { hit: false };
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
    // anything else the host asks the page for sees the page after the transaction's queue
    if (this.txn && request[0] !== "txn" && request[0] !== "release") this.flushTxn();
    // a function of the page that is called, an object made, or a batch run, may change anything
    const runs =
      request[0] === "apply" || request[0] === "new" || request[0] === "del" || request[0] === "batch" || request[0] === "fire" || request[0] === "txn";
    // (the time budget is armed by send(); only after the call is what the host had read dropped: it is still valid
    // while the operation runs, and a call that changes nothing then pays no re-read)
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
    // every call from outside gets a fresh time budget, not only the ones that run code (a long run of plain reads and
    // writes would otherwise be cut off by the deadline armed at the last such call)
    if (outer) this.armDeadline();
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
    if (cell.dead) throw new Error("quickjs-dom: this node was never created (its transaction failed)");
    if (this.txn) {
      // inside a transaction, a read the queue itself can answer (a value it wrote, the tree
      // it built under a fresh node, a fresh node's reflected properties) goes first
      const queued = this.txnRead(cell, key);
      if (queued.hit) return queued.value;
      // then what the queue cannot change: the handle's own facts; the ownerDocument kept on
      // the cell, for a cell the queue has not moved (a move within the same document — the
      // overwhelming case — does not change it); and any cached answer for an untouched cell,
      // which is still the page's answer because the queue is all that has run since.
      const local =
        (key === "nodeType" && cell.t !== undefined) ||
        ((key === "tagName" || key === "nodeName") && (cell.g !== undefined || (cell.t !== 1 && cell.n !== undefined))) ||
        (key === "localName" && cell.l !== undefined) ||
        (key === "namespaceURI" && cell.u !== undefined) ||
        (key === "defaultView" && cell.dvSet === true) ||
        (key === "correspondingUseElement" && cell.t === 1 && cell.l !== "use") ||
        (key === "ownerDocument" && cell.t !== 9 && cell.od !== undefined && !this.txn.treeTouched.has(cell));
      if (!local && this.txn.ops.length > 0 && this.txnAffects(cell, key)) {
        if (!this.txn.touched.has(cell)) {
          const k = cell.id + "\u0001" + key;
          const store = key === "style" && cell.t === 1 ? this.styleObjs : STRUCT_KEYS.has(key) ? this.sreads : this.reads;
          if (store.has(k)) return store.get(k);
        }
        this.flushTxn();
      }
      // a placeholder has no page-side answer for anything the queue cannot answer itself:
      // apply the queue so the node exists, then read it like any other
      if (!local && cell.pending) this.flushTxn();
      // a read the queue cannot have changed falls through and is served as usual: the page's
      // current answer for it is the answer after the queue too
    } else if (cell.pending) {
      throw new Error("quickjs-dom: this node's creation did not complete");
    }
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
    if (cell.dead) throw new Error("quickjs-dom: this node was never created (its transaction failed)");
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
    if (memoizable && !cell.pending) {
      const per = this.setMemo.get(cell.id);
      if (per && per.get(key) === value) return;
      const rk = cell.id + "\u0001" + key;
      if (this.reads.get(rk) === value && this.reads.has(rk)) {
        if (per) per.set(key, value);
        else this.setMemo.set(cell.id, new Map([[key, value]]));
        return;
      }
    }
    if (cell.pending && !this.txn) throw new Error("quickjs-dom: this node's creation did not complete");
    // inside a transaction, a state-only write is queued, not sent; the flush applies it.
    // textContent is queueable too, even though it is not a fine set on the direct path (it
    // replaces the node's children, so the direct path must invalidate structurally): inside
    // the queue its effect on the tree model is recorded, and it stays out of the set memo —
    // a structural operation queued later in the same transaction could move the text again.
    const queueable =
      memoizable || (key === "textContent" && cell.t === 1 && (typeof value === "string" || value === null));
    if (this.txn && queueable && this.txnEncodable(value)) {
      this.txn.ops.push({ kind: "set", cell, key, value });
      this.txn.touched.add(cell);
      if (key === "textContent") {
        this.txn.treeTouched.add(cell);
        this.txn.textDirty = true;
        this.txn.kids.delete(cell);
        this.txn.noShadow.add(cell);
      } else if (key === "nodeValue" || key === "data") {
        this.txn.textDirty = true;
      }
      let wq = this.txn.written.get(cell);
      if (!wq) {
        wq = new Map();
        this.txn.written.set(cell, wq);
      }
      wq.set(key, value);
      // a property write is also the attribute's new state for the reflections it backs
      const backedAttr = REFLECT_STR[key] ?? REFLECT_BOOL[key];
      if (backedAttr) {
        const per = this.txn.attrs.get(cell);
        if (per) per.delete(backedAttr);
      }
      if (!cell.pending && memoizable) {
        let per = this.setMemo.get(cell.id);
        if (!per) {
          per = new Map();
          this.setMemo.set(cell.id, per);
        }
        if (key === "cssText") per.clear();
        per.set(key, value);
      }
      return;
    }
    // a write that is not queued: the queue goes first (so the page sees the writes in the
    // order the host made them), and the transaction's model of the cell is dropped
    if (this.txn) {
      if (this.txn.ops.length > 0) this.flushTxn();
      this.txnForget(cell);
    } else if (cell.pending) {
      this.flushTxn();
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
    if (cell.dead) throw new Error("quickjs-dom: this node was never created (its transaction failed)");
    if (key === "matches" && cell.t === 1 && typeof cell.l === "string" && typeof args[0] === "string") {
      const check = analyzeSelector(args[0]);
      if (check.alwaysTrue) return true;
      if (check.tagRequired && !check.tagRequired.has(cell.l.toLowerCase())) return false;
    }
    if (this.txn) {
      const q = this.queueCall(cell, key, args, self);
      if (q.hit) return q.value;
      // not queueable: the queue goes first, so the page this call sees is up to date, and
      // the transaction's model of everything the call may have changed is dropped
      this.flushTxn();
      this.txnForget(cell);
      for (const a of args) {
        const ac = a && typeof a === "object" ? ((a as any)[HANDLE] as Cell | undefined) : undefined;
        if (ac) {
          this.txnForget(ac);
          this.txn?.parentOf.delete(ac);
        }
      }
    } else if (cell.pending) {
      throw new Error("quickjs-dom: this node's creation did not complete");
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
