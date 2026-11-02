import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDOM, runPageScriptsQuickJS } from "../src/index.js";

const page = (body: string, script: string) => `<!doctype html><html><body>${body}<script>${script}</script></body></html>`;

describe("javascript option, QuickJS engine", () => {
  it("serializes the DOM after the scripts ran", async () => {
    const out = await runPageScriptsQuickJS(
      { html: page('<div id="a">before</div>', 'document.getElementById("a").textContent = "after";') },
      { settleMs: 0 },
    );
    expect(out.html).toContain(">after<");
    expect(out.html).not.toContain(">before<");
    expect(out.html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("builds elements, runs timers and promises within the settle time", async () => {
    const out = await runPageScriptsQuickJS(
      {
        html: page(
          '<ul id="l"></ul>',
          `const ul = document.getElementById("l");
           for (const n of [1, 2, 3]) { const li = document.createElement("li"); li.className = "n" + n; li.textContent = String(n * n); ul.appendChild(li); }
           setTimeout(() => { ul.setAttribute("data-timer", "yes"); }, 30);
           Promise.resolve().then(() => { ul.setAttribute("data-promise", "yes"); });`,
        ),
      },
      { settleMs: 200 },
    );
    expect(out.html).toContain('<li class="n3">9</li>');
    expect(out.html).toContain('data-timer="yes"');
    expect(out.html).toContain('data-promise="yes"');
  });

  it("waits for a selector", async () => {
    const out = await runPageScriptsQuickJS(
      { html: page("", 'setTimeout(() => { document.body.insertAdjacentHTML("beforeend", "<i id=late></i>"); }, 80);') },
      { waitFor: "#late", timeout: 3000 },
    );
    expect(out.html).toContain('id="late"');
  });

  it("drops <noscript>, survives script errors and has browser globals", async () => {
    const out = await runPageScriptsQuickJS(
      {
        html:
          page("<noscript><b>no js</b></noscript><p id=p>x</p>", 'throw new Error("boom");') +
          '<script>document.getElementById("p").textContent = [typeof ReadableStream, typeof TextEncoder, new URL("/a?b=1", "http://h.test/x").href, btoa("hi"), atob("aGk="), String(window === globalThis), window.matchMedia("(min-width: 1px)").matches].join(",");</script>',
      },
      { settleMs: 0 },
    );
    expect(out.html).not.toContain("no js");
    expect(out.html).toContain(">function,function,http://h.test/a?b=1,aGk=,hi,true,false<");
  });

  it("stops a script that never ends at the timeout", async () => {
    const started = Date.now();
    const out = await runPageScriptsQuickJS({ html: page("<p id=p>x</p>", "while (true) {}") }, { timeout: 400, settleMs: 0 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(out.html).toContain('<p id="p">x</p>');
  });

});

describe("javascript option, QuickJS engine: pages that load scripts", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const send = (type: string, body: string) => {
        res.setHeader("content-type", type);
        res.end(body);
      };
      if (req.url === "/chunk.js") {
        // read like a framework chunk: the script element it came from, and a script it adds itself
        send(
          "text/javascript",
          `const me = document.currentScript;
           document.body.setAttribute("data-src", new URL(me.src).pathname);
           const next = document.createElement("script"); next.src = "/second.js"; document.head.appendChild(next);
           setTimeout(() => { document.body.setAttribute("data-cs", String(document.currentScript && document.currentScript.tagName)); }, 20);`,
        );
      } else if (req.url === "/second.js") {
        send("text/javascript", 'document.body.setAttribute("data-second", "ran");');
      } else if (req.url === "/data.json") {
        send("application/json", '{"title":"from fetch"}');
      } else {
        send(
          "text/html",
          `<!doctype html><html><head><script src="/chunk.js" async></script></head><body>
           <h1 id="t">loading</h1>
           <script>fetch("/data.json").then((r) => r.json()).then((d) => { document.getElementById("t").textContent = d.title; });</script>
           </body></html>`,
        );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
  });

  it("fetches and runs external scripts, the ones scripts add, and the page's own fetch", async () => {
    const out = await runPageScriptsQuickJS({ url: `${origin}/` }, { settleMs: 400 });
    expect(out.html).toContain('data-src="/chunk.js"');
    expect(out.html).toContain('data-second="ran"');
    expect(out.html).toContain("from fetch");
    expect(out.html).not.toContain(">loading<");
    expect(out.baseUrl).toBe(`${origin}/`);
  });

  it("sets document.currentScript while a script runs and clears it after, as a browser does", async () => {
    const out = await runPageScriptsQuickJS({ url: `${origin}/` }, { settleMs: 400 });
    expect(out.html).toContain('data-src="/chunk.js"'); // a script element while it ran
    expect(out.html).toContain('data-cs="null"'); // null in the timer it started
  });
});

describe("javascript option, QuickJS engine: engine choice and reuse", () => {
  it("skips scripts marked noModule (legacy-browser polyfills), whatever the attribute's case", async () => {
    const out = await runPageScriptsQuickJS(
      { html: '<!doctype html><body><script noModule="">document.body.setAttribute("data-legacy", "ran")</script><script nomodule>document.body.setAttribute("data-legacy2", "ran")</script><script>document.body.setAttribute("data-modern", "ran")</script></body>' },
      { settleMs: 0 },
    );
    expect(out.html).not.toContain('data-legacy="ran"');
    expect(out.html).not.toContain('data-legacy2="ran"');
    expect(out.html).toContain('data-modern="ran"');
  });

  it("runs one page after another in the same module", async () => {
    for (const n of [1, 2, 3]) {
      const out = await runPageScriptsQuickJS({ html: page('<p id="p"></p>', `document.getElementById("p").textContent = "run ${n}";`) }, { settleMs: 0 });
      expect(out.html).toContain(`>run ${n}<`);
    }
  });
});

describe("javascript option, QuickJS engine: browser APIs that apps use", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/api.json") {
        res.setHeader("content-type", "application/json");
        res.end('{"a":42}');
      } else if (req.url === "/bin") res.end(Buffer.from([1, 2, 3, 4, 5]));
      else res.end("");
    }).listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  });
  afterAll(() => {
    server.close();
  });

  it("fetch: json, arrayBuffer, blob; XMLHttpRequest on top of it", async () => {
    const out = await runPageScriptsQuickJS(
      {
        baseUrl: base,
        html: page(
          "",
          `(async () => {
             const j = await (await fetch("/api.json")).json();
             const n = (await (await fetch("/bin")).arrayBuffer()).byteLength;
             const b = (await (await fetch("/bin")).blob()).size;
             const x = await new Promise((r) => { const q = new XMLHttpRequest(); q.open("GET", "/api.json"); q.onload = () => r(q.status + ":" + JSON.parse(q.responseText).a); q.send(); });
             document.body.setAttribute("data-r", [j.a, n, b, x].join(","));
           })();`,
        ),
      },
      { settleMs: 500 },
    );
    expect(out.html).toContain('data-r="42,5,5,200:42"');
  });

  it("history.pushState moves the location; storage and readyState behave", async () => {
    const out = await runPageScriptsQuickJS(
      {
        baseUrl: "http://h.test/",
        html: page(
          "",
          `history.pushState({}, "", "/foo?y=2#h");
           localStorage.setItem("k", "v"); sessionStorage.setItem("s", "w");
           const states = [document.readyState];
           document.addEventListener("DOMContentLoaded", () => states.push(document.readyState));
           window.addEventListener("load", () => { states.push(document.readyState);
             document.body.setAttribute("data-r", [location.pathname + location.search + location.hash, localStorage.getItem("k"), localStorage.getItem("s"), sessionStorage.getItem("s"), states.join(">")].join("|")); });`,
        ),
      },
      { settleMs: 50 },
    );
    expect(out.html).toContain('data-r="/foo?y=2#h|v||w|loading>interactive>complete"');
  });

  it("has crypto, customElements, MutationObserver and Image", async () => {
    const out = await runPageScriptsQuickJS(
      {
        html: page(
          "",
          `class A extends HTMLElement { connectedCallback() { this.textContent = "hi"; } }
           customElements.define("x-a", A);
           const e = document.createElement("x-a"); document.body.appendChild(e);
           const uuid = crypto.randomUUID(), arr = crypto.getRandomValues(new Uint8Array(4));
           const mo = new MutationObserver((m) => document.body.setAttribute("data-mo", String(m.length)));
           mo.observe(document.body, { childList: true }); document.body.appendChild(document.createElement("i"));
           document.body.setAttribute("data-r", [e.textContent, /^[0-9a-f-]{36}$/.test(uuid), arr.length, new Image(3, 4).getAttribute("width")].join(","));`,
        ),
      },
      { settleMs: 50 },
    );
    expect(out.html).toContain('data-r="hi,true,4,3"');
    expect(out.html).toContain('data-mo="1"');
  });
});

describe("javascript option, QuickJS engine: client-side routing", () => {
  it("routers can fire popstate/hashchange events after pushState", async () => {
    const out = await runPageScriptsQuickJS(
      {
        baseUrl: "http://h.test/",
        html: page(
          "",
          `addEventListener("popstate", () => document.body.setAttribute("data-r", location.pathname));
           history.pushState({}, "", "/list"); dispatchEvent(new PopStateEvent("popstate", { state: {} }));
           document.body.setAttribute("data-h", typeof HashChangeEvent);`,
        ),
      },
      { settleMs: 0 },
    );
    expect(out.html).toContain('data-r="/list"');
    expect(out.html).toContain('data-h="function"');
  });
});

describe("javascript option, QuickJS engine: ES modules", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const files: Record<string, string> = {
      "/a.js": 'import { b } from "./b.js"; export const a = "a" + b;',
      "/b.js": 'export const b = "b";',
      "/lazy.js": 'import { b } from "./b.js"; export default "lazy-" + b;',
      "/main.js": `import { a } from "./a.js";
        const lazy = await import(\`./lazy.js\`);
        document.body.setAttribute("data-r", a + "," + lazy.default);`,
    };
    server = createServer((req, res) => {
      const body = files[req.url ?? ""];
      res.statusCode = body === undefined ? 404 : 200;
      res.setHeader("content-type", "text/javascript");
      res.end(body ?? "");
    }).listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  });
  afterAll(() => {
    server.close();
  });

  it("runs module scripts: imports, dynamic import, top-level await", async () => {
    const out = await runPageScriptsQuickJS(
      { baseUrl: base, html: '<!doctype html><body><script type="module" src="/main.js"></script></body>' },
      { settleMs: 100 },
    );
    expect(out.html).toContain('data-r="ab,lazy-b"');
  });

  it("runs an inline module that imports relative to the page", async () => {
    const out = await runPageScriptsQuickJS(
      { baseUrl: base, html: '<!doctype html><body><script type="module">import { b } from "./b.js"; document.body.setAttribute("data-m", b);</script></body>' },
      { settleMs: 100 },
    );
    expect(out.html).toContain('data-m="b"');
  });
});

describe("javascript option, QuickJS engine: import.meta", () => {
  it("gives a module its own URL as import.meta.url", async () => {
    const out = await runPageScriptsQuickJS(
      { baseUrl: "http://h.test/p/", html: '<!doctype html><body><script type="module">document.body.setAttribute("data-u", new URL("x.png", import.meta.url).href);</script></body>' },
      { settleMs: 0 },
    );
    expect(out.html).toContain('data-u="http://h.test/p/x.png"');
  });
});

describe("javascript option, QuickJS engine: binary responses", () => {
  it("fetch keeps bytes above 0x7f intact and still decodes UTF-8 text", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/bytes") res.end(Buffer.from([0x80, 0xff, 0, 1, 0xfe]));
      else res.end("é日本");
    }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    try {
      const out = await runPageScriptsQuickJS(
        {
          baseUrl: base,
          html: page("", `(async () => {
            const b = new Uint8Array(await (await fetch("/bytes")).arrayBuffer());
            const t = await (await fetch("/text")).text();
            document.body.setAttribute("data-r", Array.from(b).join(",") + "|" + t);
          })();`),
        },
        { settleMs: 300 },
      );
      expect(out.html).toContain('data-r="128,255,0,1,254|é日本"');
    } finally {
      server.close();
    }
  });
});

describe("javascript option, QuickJS engine: the wasm chosen by the runtime", () => {
  it("is supplied by #quickjs-wasm on Node, as a compiled module", async () => {
    const { default: defaultQuickJSWasm } = await import("#quickjs-wasm");
    expect(await defaultQuickJSWasm()).toBeInstanceOf(WebAssembly.Module);
    expect(await defaultQuickJSWasm()).toBe(await defaultQuickJSWasm()); // compiled once
  });
});

describe("createDOM: a page kept open", () => {
  it("evals in the page after its scripts ran, and serializes the current DOM", async () => {
    const dom = await createDOM({ html: "<html><head></head><body><h1>Hi</h1><script>document.title = 'set by script'</script></body></html>" }, { settleMs: 0 });
    try {
      expect(await dom.eval("document.title")).toBe("set by script");
      expect(await dom.eval("document.querySelector('h1').textContent")).toBe("Hi");
      expect(await dom.eval("({ n: [1, 2, 3].length, ok: true })")).toEqual({ n: 3, ok: true });
      expect(await dom.eval("undefined")).toBeUndefined();
      await dom.eval("document.querySelector('h1').textContent = 'Changed'");
      expect(dom.serialize()).toContain("<h1>Changed</h1>");
    } finally {
      dom.close();
    }
  });

  it("awaits promises, runs timers during a call, and keeps state between calls", async () => {
    const dom = await createDOM({ html: "<p id=a></p>" }, { settleMs: 0 });
    try {
      await dom.eval("globalThis.count = 1; setTimeout(() => { document.getElementById('a').textContent = 'late'; }, 30)");
      expect(await dom.eval("new Promise((resolve) => setTimeout(() => resolve(count + 1), 60))")).toBe(2);
      expect(await dom.eval("document.getElementById('a').textContent")).toBe("late");
      await dom.settle(20);
    } finally {
      dom.close();
    }
  });

  it("throws what the code threw, and a DOM node that cannot be a value is an error, not a hang", async () => {
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0 });
    try {
      await expect(dom.eval("throw new Error('boom')")).rejects.toThrow("boom");
      await expect(dom.eval("Promise.reject(new Error('later'))")).rejects.toThrow("later");
      // the engine stays usable after an error
      expect(await dom.eval("1 + 1")).toBe(2);
    } finally {
      dom.close();
    }
  });

  it("runs concurrent evals one after another", async () => {
    const dom = await createDOM({ html: "" }, { settleMs: 0 });
    try {
      const results = await Promise.all([
        dom.eval("new Promise((r) => setTimeout(() => r('a'), 40))"),
        dom.eval("'b'"),
        dom.eval("new Promise((r) => setTimeout(() => r('c'), 10))"),
      ]);
      expect(results).toEqual(["a", "b", "c"]);
    } finally {
      dom.close();
    }
  });

  it("gives each call its own timeout, so an endless script stops that call only", async () => {
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, timeout: 300 });
    try {
      await expect(dom.eval("while (true) {}")).rejects.toThrow();
      expect(await dom.eval("1 + 2")).toBe(3);
    } finally {
      dom.close();
    }
  });

  it("toOptions() turns the page into render options; the javascript option is dropped", async () => {
    const dom = await createDOM({ html: "<p id=a>1</p>", baseUrl: "https://example.com/dir/" }, { settleMs: 0 });
    try {
      await dom.eval("document.getElementById('a').textContent = '2'");
      const options = dom.toOptions({ value: "ignored", javascript: true, width: 300, format: "png" as const });
      expect(options.value).toContain("<p id=\"a\">2</p>");
      expect(options.baseUrl).toBe("https://example.com/dir/");
      expect(options.javascript).toBeUndefined();
      expect(options.width).toBe(300);
    } finally {
      dom.close();
    }
  });

  it("survives QuickJS aborting while it frees a large DOM, and the next page still works", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => `<tr><td>${i}</td><td><a href="/x/${i}">link ${i}</a></td></tr>`).join("");
    const script = `Promise.resolve().then(() => { const d = document.createElement('div'); d.innerHTML = document.querySelector('table').outerHTML; document.body.setAttribute('data-done', '1'); });`;
    const out = await runPageScriptsQuickJS({ html: `<!doctype html><body><table>${rows}</table><script>${script}</script></body>` }, { settleMs: 50 });
    expect(out.html).toContain('data-done="1"');
    const next = await runPageScriptsQuickJS({ html: page('<p id="p"></p>', 'document.getElementById("p").textContent = "after";') }, { settleMs: 0 });
    expect(next.html).toContain(">after<");
  }, 60_000);

  it("refuses to be used after close()", async () => {
    const dom = await createDOM({ html: "" }, { settleMs: 0 });
    dom.close();
    dom.close(); // harmless twice
    await expect(dom.eval("1")).rejects.toThrow("closed");
    expect(() => dom.serialize()).toThrow("closed");
  });
});
