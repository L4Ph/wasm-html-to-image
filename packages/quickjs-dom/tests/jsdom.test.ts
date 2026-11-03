import { createServer } from "node:http";
import { JSDOM as RealJSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { JSDOM, VirtualConsole } from "../src/jsdom.js";

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
    expect(window.document.querySelector("a").href).toBe("https://example.org/x?y=1");
    expect(window.document.querySelector("a").pathname).toBe("/x");
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
});
