import { createServer } from "node:http";
import { JSDOM as RealJSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { CookieJar, JSDOM, VirtualConsole } from "../src/jsdom.js";
import vitestEnvironment from "../src/vitest.js";

// `new JSDOM(html, options)` as jsdom's documentation uses it, from the host, with jsdom itself as the reference.

const open: JSDOM[] = [];
const make = (html?: string, options?: ConstructorParameters<typeof JSDOM>[1]) => {
  const dom = new JSDOM(html, { virtualConsole: null, ...options });
  open.push(dom);
  return dom;
};
afterEach(() => {
  while (open.length) open.pop()!.close();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("JSDOM: the constructor and the window", () => {
  it("is synchronous: the markup is parsed when it returns", () => {
    const dom = make("<!doctype html><p class=a>Hello <b>world</b></p>");
    const { document } = dom.window;
    expect(document.querySelector("p").textContent).toBe("Hello world");
    expect(document.querySelector("p.a b").nodeName).toBe("B");
    expect(dom.serialize()).toBe("<!DOCTYPE html><html><head></head><body><p class=\"a\">Hello <b>world</b></p></body></html>");
    expect(new RealJSDOM("<!doctype html><p class=a>Hello <b>world</b></p>").serialize()).toBe(dom.serialize());
  });

  it("takes the url and the referrer", () => {
    const dom = make("<a href='/x?y=1'>l</a>", { url: "https://example.org/a/b?c=d#e", referrer: "https://r.test/" });
    const { window } = dom;
    expect(window.location.href).toBe("https://example.org/a/b?c=d#e");
    expect(window.location.hostname).toBe("example.org");
    expect(window.document.URL).toBe("https://example.org/a/b?c=d#e");
    expect(window.document.referrer).toBe("https://r.test/");
    expect(window.document.querySelector("a").href).toBe("https://example.org/x?y=1");
    expect(window.document.querySelector("a").pathname).toBe("/x");
  });

  it("writes document.referrer before the page's own scripts run", () => {
    const dom = make("<script>document.title = document.referrer</script>", { referrer: "https://r.test/from", runScripts: "dangerously" });
    expect(dom.window.document.referrer).toBe("https://r.test/from");
    expect(dom.window.document.title).toBe("https://r.test/from");
  });

  it("runs no script unless asked, and window.eval with outside-only", () => {
    const html = "<p id=p>no</p><script>document.getElementById('p').textContent = 'yes'</script>";
    expect(make(html).window.document.getElementById("p").textContent).toBe("no");
    const outside = make(html, { runScripts: "outside-only" });
    expect(outside.window.document.getElementById("p").textContent).toBe("no");
    expect(outside.window.eval("1 + 2")).toBe(3);
    outside.window.eval("document.getElementById('p').textContent = 'eval'");
    expect(outside.window.document.getElementById("p").textContent).toBe("eval");
  });

  it("runs the inline scripts before the constructor returns with runScripts: dangerously", () => {
    const dom = make("<p id=p>no</p><script>document.getElementById('p').textContent = 'yes'; window.flag = 42</script>", { runScripts: "dangerously" });
    expect(dom.window.document.getElementById("p").textContent).toBe("yes");
    expect(dom.window.flag).toBe(42);
    const real = new RealJSDOM("<p id=p>no</p><script>document.getElementById('p').textContent = 'yes'; window.flag = 42</script>", { runScripts: "dangerously" });
    expect(real.window.document.getElementById("p").textContent).toBe("yes");
  });

  it("calls beforeParse with the window", () => {
    let seen: unknown;
    const dom = make("<p>", { beforeParse: (window) => (seen = window.document.nodeType) });
    expect(seen).toBe(9);
    expect(dom.window.document.nodeType).toBe(9);
  });

  it("accepts a Buffer", () => {
    const dom = make(Buffer.from("<p>日本語</p>") as unknown as string);
    expect(dom.window.document.querySelector("p").textContent).toBe("日本語");
  });

  it("window.close() ends the page", () => {
    const dom = make("<p>");
    const { window } = dom;
    window.close();
    expect(() => window.document.body).toThrow(/closed/);
  });
});

describe("JSDOM: what happens after the constructor", () => {
  it("fires DOMContentLoaded and load afterwards, and the page's timers go on", async () => {
    const dom = make("<p id=p></p><script>window.events = []; document.addEventListener('DOMContentLoaded', () => events.push('dcl')); window.addEventListener('load', () => events.push('load')); setTimeout(() => { events.push('timer'); document.getElementById('p').textContent = 't' }, 10)</script>", {
      runScripts: "dangerously",
    });
    expect(dom.window.events.length).toBe(0);
    await dom.ready;
    await sleep(40);
    expect(dom.window.events).toEqual(["dcl", "load", "timer"]);
    expect(dom.window.document.getElementById("p").textContent).toBe("t");
  });

  it("a timer the host sets through the window fires", async () => {
    const dom = make("<p>");
    const hits: number[] = [];
    dom.window.setTimeout(() => hits.push(1), 5);
    dom.window.setInterval(function (this: unknown) {
      hits.push(2);
    }, 10);
    await sleep(45);
    expect(hits).toContain(1);
    expect(hits.filter((h) => h === 2).length).toBeGreaterThanOrEqual(2);
  });

  it("promises of the page run in microtask order after a host call", async () => {
    const dom = make("<p>", { runScripts: "outside-only" });
    dom.window.eval("window.order = []; Promise.resolve().then(() => order.push('micro')); order.push('sync')");
    expect(dom.window.order).toEqual(["sync", "micro"]);
  });

  it("loads scripts with a src only with resources: usable", async () => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", req.url === "/" ? "text/html" : "text/javascript");
      res.end(req.url === "/" ? "<p id=p>no</p><script src='/s.js'></script>" : "document.getElementById('p').textContent = 'loaded'");
    }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    try {
      const without = await JSDOM.fromURL(base, { virtualConsole: null, runScripts: "dangerously" });
      open.push(without);
      await without.ready;
      expect(without.window.document.getElementById("p").textContent).toBe("no");
      const withScripts = await JSDOM.fromURL(base, { virtualConsole: null, runScripts: "dangerously", resources: "usable" });
      open.push(withScripts);
      expect(withScripts.window.location.href).toBe(base);
      // resources: "usable" is asynchronous: the constructor (and fromURL) return before the fetched script has
      // run. Tests must await `ready` rather than sleep a fixed time, which is what makes this test stable.
      expect(withScripts.window.document.getElementById("p").textContent).toBe("no");
      await withScripts.ready;
      expect(withScripts.window.document.getElementById("p").textContent).toBe("loaded");
    } finally {
      server.close();
    }
  });
});

describe("JSDOM: the virtual console", () => {
  it("passes console output and script errors on as events", async () => {
    const vc = new VirtualConsole();
    const seen: string[] = [];
    vc.on("log", (m) => seen.push("log " + m));
    vc.on("warn", (m) => seen.push("warn " + m));
    vc.on("jsdomError", (e: Error) => seen.push("error " + e.message.split("\n")[0]));
    make("<script>console.log('a'); console.warn('b'); throw new Error('boom')</script>", { runScripts: "dangerously", virtualConsole: vc });
    await sleep(10);
    expect(seen).toEqual(["log a", "warn b", expect.stringMatching(/^error .*boom/)]);
  });

  it("warns on the jsdom object form of resources instead of ignoring it silently", () => {
    const vc = new VirtualConsole();
    const seen: { type?: string; message: string }[] = [];
    vc.on("jsdomError", (e: Error & { type?: string }) => seen.push({ type: e.type, message: e.message }));
    make("<p>x</p>", { virtualConsole: vc, resources: { runScripts: "dangerously" } as any });
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("not-implemented");
    expect(seen[0].message).toContain('pass "usable"');
  });

  it("reports the window's unimplemented stubs as jsdom does", () => {
    const vc = new VirtualConsole();
    const seen: { type?: string; message: string }[] = [];
    vc.on("jsdomError", (e: Error & { type?: string }) => seen.push({ type: e.type, message: e.message }));
    const dom = make("<p>x</p>", { virtualConsole: vc, runScripts: "dangerously" });
    dom.window.scrollTo(0, 10);
    dom.window.alert("hello");
    expect(seen).toEqual([
      { type: "not-implemented", message: "Not implemented: Window's scrollTo() method" },
      { type: "not-implemented", message: "Not implemented: Window's alert() method" },
    ]);
  });

  it("sendTo forwards to a console", () => {
    const lines: unknown[][] = [];
    const vc = new VirtualConsole().sendTo({ log: (...a) => lines.push(["log", ...a]), info() {}, warn() {}, error: (...a) => lines.push(["error", ...a]), debug() {} });
    make("<script>console.log('x', 1)</script>", { runScripts: "dangerously", virtualConsole: vc });
    expect(lines[0][0]).toBe("log");
  });
});

describe("JSDOM: answers like jsdom", () => {
  // the same host code runs on jsdom and on this; the answers must be equal
  const html = "<!doctype html><title>T</title><body><ul id=l><li class=a>1</li><li class='a b'>2</li><li>3</li></ul><form id=f><input name=n value=v><select name=s><option>x<option selected>y</select></form>";
  const probe = (window: any) => {
    const { document } = window;
    const li = document.querySelectorAll("li.a");
    const form = document.getElementById("f");
    document.getElementById("l").insertAdjacentHTML("beforeend", "<li id=new data-k=1>4</li>");
    document.getElementById("new").dataset.more = "x";
    document.body.classList.add("loaded");
    return [
      document.title,
      li.length,
      Array.from(li).map((e: any) => e.className),
      document.getElementById("l").children.length,
      form.elements.length,
      form.elements.n.value,
      form.elements.s.value,
      document.getElementById("new").outerHTML,
      document.body.className,
      document.querySelector("li:nth-child(2)").textContent,
      document.documentElement.outerHTML.length,
      window.document.createElement("a").constructor.name,
      typeof window.getComputedStyle,
    ];
  };
  it("gives the same answers for a page of ordinary DOM use", () => {
    expect(probe(make(html).window)).toEqual(probe(new RealJSDOM(html).window));
  });

  it("querySelectorAll answers a static NodeList with item() and iteration", () => {
    const dom = make('<ul><li class=a>1</li><li class=a>2</li><li>3</li></ul><script>var q = document.querySelectorAll("li.a"); window.qsaProbe = [q instanceof NodeList, q instanceof HTMLCollection, Array.isArray(q), q.length, q.item(0).textContent, q.item(9)]</script>', { runScripts: "dangerously" });
    expect(dom.window.qsaProbe).toEqual([true, false, false, 2, "1", null]);
    const list = dom.window.document.querySelectorAll("li.a");
    expect(list instanceof dom.window.NodeList).toBe(true);
    expect(list instanceof dom.window.HTMLCollection).toBe(false);
    expect(list.length).toBe(2);
    expect(list.item(1).textContent).toBe("2");
    expect(list.item(99)).toBe(null);
    expect([...list].map((e: any) => e.textContent)).toEqual(["1", "2"]);
    // a snapshot, not a live view (the spec's qSA): appending later does not change it
    dom.window.document.querySelector("ul")!.appendChild(dom.window.document.createElement("li")).className = "a";
    expect(list.length).toBe(2);
    expect(dom.window.document.querySelectorAll("li.a").length).toBe(3);
  });
});

describe("JSDOM: pretendToBeVisual, error classification, charsets", () => {
  const visual = (dom: JSDOM) => {
    const w = dom.window;
    return [typeof w.requestAnimationFrame, typeof w.cancelAnimationFrame, w.document.visibilityState, w.document.hidden, w.document.hasFocus()];
  };
  it("is not visual unless asked, as in jsdom", () => {
    expect(visual(make("<p>"))).toEqual(["undefined", "undefined", "prerender", true, false]);
    expect(visual(make("<p>", { pretendToBeVisual: true }))).toEqual(["function", "function", "visible", false, false]);
    expect(visual(new RealJSDOM("<p>") as unknown as JSDOM)).toEqual(["undefined", "undefined", "prerender", true, false]);
    // a document that has been focused reports focus, in either engine, and keeps reporting it after a blur
    const dom = make("<input id=i>", { pretendToBeVisual: true });
    dom.window.document.getElementById("i").focus();
    expect(dom.window.document.hasFocus()).toBe(true);
    dom.window.document.getElementById("i").blur();
    expect(dom.window.document.hasFocus()).toBe(true);
  });

  it("classifies page errors on the virtual console as jsdom does", async () => {
    const vc = new VirtualConsole();
    const types: string[] = [];
    vc.on("jsdomError", (e: Error & { type?: string }) => types.push(String(e.type)));
    make("<script>throw new Error('boom')</script>", { runScripts: "dangerously", virtualConsole: vc });
    make("<script>Promise.reject(new Error('later'))</script>", { runScripts: "dangerously", virtualConsole: vc });
    await sleep(10);
    expect(types).toEqual(["unhandled-exception", "unhandled-exception"]);
  });

  it("decodes a fetched page by its charset, from the header or a meta", async () => {
    // "<p id=p>あ</p>" in Shift_JIS (あ = 82 A0), served two ways
    const sjis = (head: string, tail: string) => new Uint8Array([...Buffer.from(head, "latin1"), 0x82, 0xa0, ...Buffer.from(tail, "latin1")]);
    const server = createServer((req, res) => {
      if (req.url === "/header") {
        res.setHeader("content-type", "text/html; charset=shift_jis");
        res.end(sjis("<p id=p>", "</p>"));
      } else {
        res.setHeader("content-type", "text/html");
        res.end(sjis('<meta charset="shift_jis"><p id=p>', "</p>"));
      }
    }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      for (const path of ["/header", "/meta"]) {
        const dom = await JSDOM.fromURL(base + path, { virtualConsole: null });
        open.push(dom);
        expect(dom.window.document.getElementById("p").textContent).toBe("あ");
      }
    } finally {
      server.close();
    }
  });

  it("reconfigures the url", () => {
    const dom = make("<p>hi</p>", { url: "https://example.com/initial" });
    expect(dom.window.location.href).toBe("https://example.com/initial");
    dom.reconfigure({ url: "https://example.com/reconfigured?a=1" });
    expect(dom.window.location.href).toBe("https://example.com/reconfigured?a=1");
    expect(dom.window.location.search).toBe("?a=1");
  });

  it("JSDOM.fragment creates a DocumentFragment synchronously", () => {
    const frag = JSDOM.fragment("<div class='item'>A</div><div class='item'>B</div>");
    expect(frag.nodeType).toBe(11);
    expect(frag.querySelectorAll(".item").length).toBe(2);
    expect(frag.firstChild.textContent).toBe("A");
  });
});

describe("JSDOM: cookieJar", () => {
  it("keeps the page's cookies in dom.cookieJar, scoped the way jsdom scopes them", () => {
    const dom = make("<p>x</p>", { url: "https://sub.example.com/app/page" });
    const jar = dom.cookieJar;
    expect(jar).toBeInstanceOf(CookieJar);
    const { document } = dom.window;
    document.cookie = "session=abc; path=/app";
    document.cookie = "wide=1; domain=example.com; path=/";
    document.cookie = "gone=1; max-age=0";
    expect(document.cookie).toBe("session=abc; wide=1");
    expect(jar.getCookieStringSync("https://sub.example.com/app/other")).toBe("session=abc; wide=1");
    // the path= cookie does not travel outside /app, the Domain= one reaches the parent and siblings
    expect(jar.getCookieStringSync("https://sub.example.com/elsewhere")).toBe("wide=1");
    expect(jar.getCookieStringSync("https://example.com/")).toBe("wide=1");
    expect(jar.getCookieStringSync("https://other.example.com/")).toBe("wide=1");
    // a host-only cookie stays on its host, and a Secure one needs https:
    jar.setCookieSync("hostonly=1", "https://sub.example.com/");
    jar.setCookieSync("sec=1; secure", "https://sub.example.com/");
    expect(jar.getCookieStringSync("https://example.com/")).toBe("wide=1");
    expect(jar.getCookieStringSync("http://sub.example.com/")).toBe("wide=1; hostonly=1");
    // HttpOnly is in the jar but never in document.cookie, and a script cannot set it
    jar.setCookieSync("secret=1; httponly", "https://sub.example.com/");
    expect(jar.getCookieStringSync("https://sub.example.com/")).toContain("secret=1");
    expect(document.cookie).not.toContain("secret");
    document.cookie = "scripted=1; httponly";
    expect(document.cookie).toContain("scripted=1");

    // the same expectations against jsdom with its tough-cookie jar
    const ref = new RealJSDOM("<p>x</p>", { url: "https://sub.example.com/app/page" });
    ref.window.document.cookie = "session=abc; path=/app";
    ref.window.document.cookie = "wide=1; domain=example.com; path=/";
    expect(ref.cookieJar.getCookieStringSync("https://sub.example.com/elsewhere")).toBe("wide=1");
    expect(ref.cookieJar.getCookieStringSync("https://other.example.com/")).toBe("wide=1");
  });

  it("shares a jar between pages, and takes jsdom's own jar", () => {
    const ref = new RealJSDOM("<p>x</p>", { url: "https://example.com/" });
    const jar = ref.cookieJar; // tough-cookie's jar, handed to ours
    const one = make("<p>1</p>", { url: "https://example.com/", cookieJar: jar });
    one.window.document.cookie = "shared=yes";
    const two = make("<p>2</p>", { url: "https://example.com/", cookieJar: jar });
    expect(two.window.document.cookie).toBe("shared=yes");
    expect(one.cookieJar).toBe(jar);
    // and in the other direction: our jar inside jsdom
    const ours = new CookieJar();
    const three = new RealJSDOM("<p>3</p>", { url: "https://example.com/", cookieJar: ours as never });
    three.window.document.cookie = "from=jsdom";
    const four = make("<p>4</p>", { url: "https://example.com/", cookieJar: ours });
    expect(four.window.document.cookie).toBe("from=jsdom");
  });

  it("carries cookies through fromURL and through the page's own requests", async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.cookie);
      if (req.url === "/set") {
        res.setHeader("set-cookie", "srv=1; path=/");
        res.end("<script>fetch('/echo').then(() => { document.title = 'fetched'; })</" + "script><p>set</p>");
      } else {
        res.setHeader("set-cookie", "echo=2; path=/");
        res.end("<p>echo</p>");
      }
    });
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const jar = new CookieJar();
      const dom = await JSDOM.fromURL(`${base}/set`, { cookieJar: jar, virtualConsole: null, runScripts: "dangerously" });
      open.push(dom);
      expect(jar.getCookieStringSync(`${base}/`)).toBe("srv=1");
      expect(dom.window.document.cookie).toBe("srv=1");
      // the page's own fetch (its script, above) sends the jar's cookies and keeps the answer's
      await dom.ready;
      for (let i = 0; i < 50 && dom.window.document.title !== "fetched"; i++) await sleep(20);
      expect(dom.window.document.title).toBe("fetched");
      expect(seen[seen.length - 1]).toBe("srv=1");
      expect(jar.getCookieStringSync(`${base}/`)).toBe("srv=1; echo=2");
      expect(dom.window.document.cookie).toBe("srv=1; echo=2");
    } finally {
      server.close();
    }
  });
});

describe("the Vitest environment: options", () => {
  it("falls back to test.environmentOptions.jsdom.url, and wasmQuickjsDom wins", async () => {
    const fromJsdom: Record<string, any> = {};
    const first = await vitestEnvironment.setup(fromJsdom, { jsdom: { url: "https://example.test/jsdom" } });
    try {
      expect(fromJsdom.document.URL).toBe("https://example.test/jsdom");
    } finally {
      await first.teardown(fromJsdom);
    }

    const fromWasm: Record<string, any> = {};
    const second = await vitestEnvironment.setup(fromWasm, {
      jsdom: { url: "https://example.test/jsdom" },
      wasmQuickjsDom: { url: "https://example.test/wasm" },
    });
    try {
      expect(fromWasm.document.URL).toBe("https://example.test/wasm");
    } finally {
      await second.teardown(fromWasm);
    }
  });

  it("resolves three layers and never lets an explicit undefined erase a lower fallback", async () => {
    // layer order: wasmQuickjsDom, then jsdom, then the environment's top level
    const topOnly: Record<string, any> = {};
    const top = await vitestEnvironment.setup(topOnly, {
      url: "https://example.test/top",
      jsdom: { url: undefined },
      wasmQuickjsDom: { url: undefined, html: undefined },
    });
    try {
      expect(topOnly.document.URL).toBe("https://example.test/top");
    } finally {
      await top.teardown(topOnly);
    }

    // undefined in the first layer falls through to the second; a real value there wins over the top level
    const withJsdom: Record<string, any> = {};
    const second = await vitestEnvironment.setup(withJsdom, {
      url: "https://example.test/top",
      jsdom: { url: "https://example.test/jsdom" },
      wasmQuickjsDom: { url: undefined },
    });
    try {
      expect(withJsdom.document.URL).toBe("https://example.test/jsdom");
    } finally {
      await second.teardown(withJsdom);
    }

    // and the first layer's value wins over both when it is there
    const withWasm: Record<string, any> = {};
    const third = await vitestEnvironment.setup(withWasm, {
      url: "https://example.test/top",
      jsdom: { url: "https://example.test/jsdom" },
      wasmQuickjsDom: { url: "https://example.test/wasm" },
    });
    try {
      expect(withWasm.document.URL).toBe("https://example.test/wasm");
    } finally {
      await third.teardown(withWasm);
    }
  });
});

describe("the Vitest environment: teardown and awaitReady", () => {
  // The reproduction for the "in-flight work leaks past teardown" flake: a page whose external script is still in
  // flight when the test ends. The old synchronous teardown closed the page and aborted the request; the script never
  // ran, and the next test (or the process) saw a page mid-load. Teardown now awaits `dom.ready` first.
  it("awaits an in-flight external script instead of aborting it (0 flakes over repeats)", async () => {
    const seen: string[] = [];
    let hits = 0;
    const server = createServer((req, res) => {
      hits++;
      // slow enough that a synchronous close wins the race every time
      setTimeout(() => {
        res.setHeader("content-type", "text/javascript");
        res.end("console.log('loaded')");
      }, 300);
    }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    try {
      for (let i = 0; i < 3; i++) {
        const vc = new VirtualConsole();
        vc.on("log", (m: string) => seen.push(m));
        const global: Record<string, any> = {};
        const setup = await vitestEnvironment.setup(global, {
          wasmQuickjsDom: { html: '<script src="slow.js"></script>', url: base, resources: "usable", runScripts: "dangerously", virtualConsole: vc },
        });
        await setup.teardown(global);
      }
    } finally {
      server.close();
    }
    expect(hits).toBe(3);
    expect(seen).toEqual(["loaded", "loaded", "loaded"]);
  });

  it("waits for external resources only when awaitReady is set", async () => {
    const server = createServer((req, res) => {
      setTimeout(() => {
        res.setHeader("content-type", "text/javascript");
        res.end("document.title = 'loaded'");
      }, 50);
    }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const options = { html: '<script src="slow.js"></script>', url: base, resources: "usable", runScripts: "dangerously" } as const;
    try {
      // default (off): setup is synchronous and returns before the external script has run
      const early: Record<string, any> = {};
      const earlySetup = vitestEnvironment.setup(early, { wasmQuickjsDom: options });
      expect(earlySetup).not.toBeInstanceOf(Promise);
      expect(early.document.title).toBe("");
      await (earlySetup as { teardown(g: Record<string, any>): Promise<void> }).teardown(early);

      // flag on: setup is asynchronous and settles only after `load` (and the external script) has run
      const late: Record<string, any> = {};
      const lateSetup = vitestEnvironment.setup(late, { wasmQuickjsDom: { ...options, awaitReady: true } });
      expect(lateSetup).toBeInstanceOf(Promise);
      const ready = await (lateSetup as Promise<{ teardown(g: Record<string, any>): Promise<void> }>);
      expect(late.document.title).toBe("loaded");
      await ready.teardown(late);
    } finally {
      server.close();
    }
  });
});
