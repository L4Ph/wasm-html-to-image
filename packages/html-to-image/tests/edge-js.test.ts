import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyJavaScript, runPageScriptsQuickJS } from "../src/edge-js.js";

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

  it("applyJavaScript replaces string HTML and leaves other inputs alone", async () => {
    const out = await applyJavaScript({ value: page('<p id="p">0</p>', 'document.getElementById("p").textContent = "1";'), javascript: { settleMs: 0 } });
    expect(String(out.value)).toContain(">1<");
    expect("javascript" in out).toBe(false);
    const bytes = new Uint8Array([1, 2, 3]);
    expect((await applyJavaScript({ value: bytes, javascript: true })).value).toBe(bytes);
    const plain = { value: "<p>x</p>" };
    expect(await applyJavaScript(plain)).toBe(plain);
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

  it('is what `javascript: { engine: "quickjs" }` selects in the Node entry', async () => {
    const { applyJavaScript: applyAny } = await import("../src/js-page.js");
    const out = await applyAny({
      value: page('<p id="p">0</p>', 'document.getElementById("p").textContent = typeof process + "," + typeof document.createElement;'),
      javascript: { engine: "quickjs", settleMs: 0 },
    });
    expect(String(out.value)).toContain(">undefined,function<"); // QuickJS has no `process`; jsdom would say "object"
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
