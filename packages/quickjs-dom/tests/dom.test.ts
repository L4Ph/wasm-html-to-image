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
    expect(out.html).toContain(">function,function,http://h.test/a?b=1,aGk=,hi,true,true<"); // the last: matchMedia("(min-width: 1px)")
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

describe("javascript option, QuickJS engine: forms", () => {
  it("a submit button outside a form submits it, through its form attribute", async () => {
    const out = await runPageScriptsQuickJS(
      {
        html: page(
          '<form id="f"><input name="inside"></form>' +
            '<input id="ext" name="ext" form="f">' +
            '<button id="go" form="f">go</button>' +
            '<div><form id="other"></form><button id="orphan" form="nope">no</button></div>',
          `const f = document.getElementById("f"), go = document.getElementById("go"), ext = document.getElementById("ext");
           const seen = [];
           f.addEventListener("submit", (ev) => { seen.push([ev instanceof SubmitEvent, ev.submitter ? ev.submitter.id : null]); ev.preventDefault(); });
           go.click();          // activation reaches the form through form="f"
           f.requestSubmit();   // no submitter: the event carries null
           let foreign = "none";
           try { f.requestSubmit(document.getElementById("orphan")); } catch (e) { foreign = e.name; }
           document.body.setAttribute("data-r", encodeURIComponent(JSON.stringify({
             seen: seen,
             form: go.form === f,
             ext: ext.form === f,
             elements: f.elements.length,
             length: f.length,
             named: f.elements.ext === ext,
             orphan: document.getElementById("orphan").form, // no fallback to the ancestor form
             foreign: foreign,
           })));`,
        ),
      },
      { settleMs: 0 },
    );
    const info = JSON.parse(decodeURIComponent(/data-r="([^"]*)"/.exec(out.html)![1]));
    expect(info).toEqual({
      seen: [[true, "go"], [true, null]],
      form: true,
      ext: true,
      elements: 3, // the two inputs inside the form, plus the external one
      length: 3,
      named: true,
      orphan: null,
      foreign: "NotFoundError",
    });
  });

  it("a MouseEvent dispatches submit from outside and inside the form, as fireEvent.click does", async () => {
    const out = await runPageScriptsQuickJS(
      {
        html: page(
          '<form id="f"><input name="q"><button id="inside">go</button></form>' +
            '<button id="outside" form="f">go</button>' +
            '<button id="plain" type="button">no</button>',
          `const f = document.getElementById("f"), seen = [];
           f.addEventListener("submit", (ev) => { seen.push(ev.submitter ? ev.submitter.id : null); ev.preventDefault(); });
           for (const id of ["inside", "outside", "plain"]) {
             document.getElementById(id).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
           }
           document.body.setAttribute("data-r", encodeURIComponent(JSON.stringify(seen)));`,
        ),
      },
      { settleMs: 0 },
    );
    expect(JSON.parse(decodeURIComponent(/data-r="([^"]*)"/.exec(out.html)![1]))).toEqual(["inside", "outside"]);
  });

  it("select.remove/options.remove, output state and reset, fieldset.elements/type, image submit, range and date values", async () => {
    const out = await runPageScriptsQuickJS(
      {
        html: page(
          '<form id="f"><select id="s"><option>a</option><option>b</option><option>c</option></select>' +
            '<output id="o">7</output>' +
            '<fieldset id="fs"><legend>l</legend><input name="y"><select name="z"><option>q</option></select></fieldset>' +
            '<input id="img" type="image">' +
            '<input id="r" type="range" min="10" max="0" value="5">' +
            '<input id="r2" type="range" min="10" max="0">' +
            '<input id="d" type="date" value="2024-02-30">' +
            '<input id="d2" type="date" value="2024-02-29">' +
            "</form>",
          `const $ = (id) => document.getElementById(id), f = $("f"), s = $("s"), o = $("o");
           const texts = (sel) => Array.prototype.map.call(sel.options, (x) => x.textContent);
           const before = texts(s);
           s.remove(1);
           const afterIndex = texts(s);
           let noArg = "none";
           try { s.options.remove(); } catch (e) { noArg = e.name; }
           s.options.remove(undefined);
           const afterUndefined = texts(s);
           s.remove();
           const selectRemoved = !s.isConnected;

           const output = [o.value, o.defaultValue, o.type, o.willValidate];
           o.value = "9";
           output.push(o.value, o.defaultValue);
           f.reset();
           output.push(o.value, o.defaultValue);
           o.defaultValue = "8";
           output.push(o.value, o.defaultValue);
           o.value = "10";
           output.push(o.value, o.defaultValue);
           f.reset();
           output.push(o.value, o.defaultValue);

           const fs = $("fs");
           const fieldset = [fs.type, fs.elements.length, Array.prototype.map.call(fs.elements, (e) => e.name), fs.willValidate, fs.validity.valid];

           const submits = [];
           f.addEventListener("submit", (ev) => { submits.push([ev.submitter && ev.submitter.id, ev.submitter && ev.submitter.type]); ev.preventDefault(); });
           $("img").click();

           const values = [$("r").value, $("r2").value, $("d").value, $("d2").value];
           document.body.setAttribute("data-r", encodeURIComponent(JSON.stringify({
             before: before, afterIndex: afterIndex, noArg: noArg, afterUndefined: afterUndefined, selectRemoved: selectRemoved,
             output: output, fieldset: fieldset, submits: submits, values: values,
           })));`,
        ),
      },
      { settleMs: 0 },
    );
    const info = JSON.parse(decodeURIComponent(/data-r="([^"]*)"/.exec(out.html)![1]));
    expect(info).toEqual({
      before: ["a", "b", "c"],
      afterIndex: ["a", "c"],
      noArg: "TypeError",
      // WebIDL's long conversion of undefined is 0, so this removes the first option
      afterUndefined: ["c"],
      // select.remove() with no argument is ChildNode.remove(): the select itself leaves the tree
      selectRemoved: true,
      // value is the text; defaultValue is the text until a value write takes a snapshot of it, which reset restores
      output: ["7", "7", "output", false, "9", "7", "7", "7", "8", "8", "10", "8", "8", "8"],
      // a fieldset is a listed element but is not submittable; its elements are the controls inside it
      fieldset: ["fieldset", 2, ["y", "z"], false, true],
      submits: [["img", "image"]],
      // a reversed range answers min (not max); invalid dates sanitise to ""
      values: ["10", "10", "", "2024-02-29"],
    });
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

  it("module scripts run after the classic scripts of the document", async () => {
    const out = await runPageScriptsQuickJS(
      { baseUrl: base, html: '<!doctype html><body><script type="module">document.body.setAttribute("data-o", window.early);</script><script>window.early = "set";</script></body>' },
      { settleMs: 100 },
    );
    expect(out.html).toContain('data-o="set"');
  });

  it("an import() of a computed URL fails once, is fetched, and succeeds on the page's retry", async () => {
    const out = await runPageScriptsQuickJS(
      { baseUrl: base, html: '<!doctype html><body><script>var n = "./" + ["b", "js"].join("."); (function t(k) { import(n + (k ? "?r=" + k : "")).then(function (m) { document.body.setAttribute("data-l", m.b + k); }, function () { setTimeout(function () { t((k || 0) + 1); }, 50); }); })(0);</script></body>' },
      { settleMs: 800 },
    );
    expect(out.html).toMatch(/data-l="b[1-9]"/);
  });

  it("a classic inline script can import() a module relative to the page", async () => {
    const out = await runPageScriptsQuickJS(
      { baseUrl: base, html: '<!doctype html><body><script>import("./b.js").then(function (m) { document.body.setAttribute("data-d", m.b); });</script></body>' },
      { settleMs: 100 },
    );
    expect(out.html).toContain('data-d="b"');
  });

  it("resolves bare specifiers and prefixes through an import map", async () => {
    const map = JSON.stringify({ imports: { bee: "./b.js", "lib/": "/" } });
    const out = await runPageScriptsQuickJS(
      {
        baseUrl: base,
        html: `<!doctype html><body><script type="importmap">${map}</script><script type="module">import { b } from "bee"; import { b as c } from "lib/b.js"; document.body.setAttribute("data-m", b + c);</script></body>`,
      },
      { settleMs: 100 },
    );
    expect(out.html).toContain('data-m="bb"');
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

  it("markForLayout() numbers a copy of the page; setLayout() makes the rect APIs answer", async () => {
    const dom = await createDOM({ html: '<!doctype html><html><body class="x"><div id="a">hi</div><p id="b"></p></body></html>' }, { settleMs: 0 });
    try {
      const html = dom.markForLayout();
      expect(html).toMatch(/<body class="qjsl-\d+ x">/);
      expect(html).toMatch(/<div (class="qjsl-\d+" id="a"|id="a" class="qjsl-\d+")>/);
      expect(dom.serialize()).not.toContain("qjsl-"); // only the copy is marked
      expect(await dom.eval("document.body.className")).toBe("x");
      const index = (id: string) => Number(new RegExp('(?:class="qjsl-(\\d+)" id="' + id + '"|id="' + id + '" class="qjsl-(\\d+)")').exec(html)!.slice(1).find(Boolean));
      dom.setLayout({ [index("a")]: [5, 6, 70, 80] });
      expect(await dom.eval("document.getElementById('a').getBoundingClientRect().toJSON()")).toEqual({ x: 5, y: 6, width: 70, height: 80, top: 6, left: 5, right: 75, bottom: 86 });
      expect(await dom.eval("[document.getElementById('a').offsetWidth, document.getElementById('a').offsetHeight, document.getElementById('a').offsetTop]")).toEqual([70, 80, 6]);
      expect(await dom.eval("document.getElementById('b').getClientRects().length")).toBe(0); // no box
      expect(await dom.eval("document.getElementById('b').offsetHeight")).toBe(0);
    } finally {
      dom.close();
    }
  });

  it("warns about a mark only when the DOM changed under it; an unchanged re-mark is silent", async () => {
    const dom = await createDOM({ html: '<!doctype html><html><body><div id="a">hi</div></body></html>' }, { settleMs: 0 });
    const warnings = () => dom.logs.filter((e) => e.type === "console" && e.level === "warn").map((e) => (e as { message: string }).message);
    const marked = (prefix: string) => warnings().filter((m) => m.startsWith(prefix));
    try {
      const html = dom.markForLayout();
      const index = Number(/(?:class="qjsl-(\d+)" id="a"|id="a" class="qjsl-(\d+)")/.exec(html)!.slice(1).find(Boolean));
      dom.markForLayout(); // same document: the numbers come out the same and the boxes still match
      expect(marked("markForLayout")).toEqual([]);
      await dom.eval("document.body.appendChild(document.createElement('p'))");
      dom.markForLayout(); // a different document order: the earlier numbers may point elsewhere
      expect(marked("markForLayout")).toHaveLength(1);
      dom.markForLayout(); // but the warning is for that one invalidation, not for every later mark
      expect(marked("markForLayout")).toHaveLength(1);
      dom.setLayout({ [index]: [1, 2, 3, 4] }); // marked from the current DOM: no complaint
      expect(marked("setLayout")).toEqual([]);
      await dom.eval("document.body.appendChild(document.createElement('i'))");
      expect(await dom.eval("document.getElementById('a').offsetWidth")).toBe(3); // the old box is still served
      expect(marked("layout is stale")).toHaveLength(1);
      await dom.eval("document.getElementById('a').offsetWidth"); // and the warning is not repeated per read
      expect(marked("layout is stale")).toHaveLength(1);
    } finally {
      dom.close();
    }
  });

  it("setLayout() warns when the DOM changed after the mark the boxes were measured from", async () => {
    const dom = await createDOM({ html: '<!doctype html><html><body><div id="a">hi</div></body></html>' }, { settleMs: 0 });
    const warnings = () => dom.logs.filter((e) => e.type === "console" && e.level === "warn").map((e) => (e as { message: string }).message);
    try {
      const html = dom.markForLayout();
      const index = Number(/(?:class="qjsl-(\d+)" id="a"|id="a" class="qjsl-(\d+)")/.exec(html)!.slice(1).find(Boolean));
      await dom.eval("document.body.appendChild(document.createElement('p'))");
      dom.setLayout({ [index]: [1, 2, 3, 4] });
      expect(warnings().filter((m) => m.startsWith("setLayout"))).toHaveLength(1);
      expect(await dom.eval("document.getElementById('a').offsetWidth")).toBe(3); // the boxes are applied as given
    } finally {
      dom.close();
    }
  });

  it("refuses to be used after close()", async () => {
    const dom = await createDOM({ html: "" }, { settleMs: 0 });
    dom.close();
    dom.close(); // harmless twice
    await expect(dom.eval("1")).rejects.toThrow("closed");
    expect(() => dom.serialize()).toThrow("closed");
  });
});

describe("createDOM: limits on what the page may fetch", () => {
  let server: Server;
  let origin: string;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.statusCode = 302;
        res.setHeader("location", `http://localhost:${port}/data`);
        res.end();
      } else if (req.url === "/big") {
        res.end("x".repeat(5000));
      } else if (req.url === "/script.js") {
        res.setHeader("content-type", "text/javascript");
        res.end('document.body.setAttribute("data-script", "ran");');
      } else {
        res.end("small");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
    origin = `http://127.0.0.1:${port}`;
  });
  afterAll(() => {
    server.close();
  });

  const tryFetch = (dom: Awaited<ReturnType<typeof createDOM>>, url: string) =>
    dom.eval(`fetch(${JSON.stringify(url)}).then((r) => r.text()).then((t) => "ok:" + t.length, (e) => "blocked:" + String(e))`);

  it("is unlimited by default, and blockPrivateHosts refuses loopback and private addresses", async () => {
    const open = await createDOM({ html: "<p>x</p>" }, { settleMs: 0 });
    const shut = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, limits: { blockPrivateHosts: true } });
    try {
      expect(await tryFetch(open, `${origin}/data`)).toBe("ok:5");
      expect(String(await tryFetch(shut, `${origin}/data`))).toMatch(/^blocked:.*private host/);
      expect(String(await tryFetch(shut, "http://[::1]:1/"))).toMatch(/^blocked:.*private host/);
      expect(String(await tryFetch(shut, "http://169.254.169.254/latest/meta-data/"))).toMatch(/^blocked:.*private host/);
    } finally {
      open.close();
      shut.close();
    }
  });

  it("allowedHosts / allowedProtocols / blockedHosts, and the scripts it loads obey them too", async () => {
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, limits: { allowedHosts: ["127.0.0.1"], allowedProtocols: ["http:"] } });
    try {
      expect(await tryFetch(dom, `${origin}/data`)).toBe("ok:5");
      expect(String(await tryFetch(dom, `http://localhost:${port}/data`))).toMatch(/^blocked:.*host not allowed/);
      expect(String(await tryFetch(dom, "https://127.0.0.1:1/"))).toMatch(/^blocked:.*protocol/);
    } finally {
      dom.close();
    }
    const html = (host: string) =>
      `<!doctype html><body><script>var s = document.createElement("script"); s.src = "http://${host}:${port}/script.js"; s.onerror = function () { document.body.setAttribute("data-err", "1"); }; document.head.appendChild(s);</script></body>`;
    const allowed = await runPageScriptsQuickJS({ html: html("127.0.0.1") }, { settleMs: 50, limits: { blockedHosts: ["localhost"] } });
    expect(allowed.html).toContain('data-script="ran"');
    const blocked = await runPageScriptsQuickJS({ html: html("localhost") }, { settleMs: 50, limits: { blockedHosts: ["localhost"] } });
    expect(blocked.html).not.toContain("data-script");
    expect(blocked.html).toContain('data-err="1"');
  });

  it("checks every redirect, not just the first URL", async () => {
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, limits: { allowedHosts: ["127.0.0.1"] } });
    try {
      expect(String(await tryFetch(dom, `${origin}/redirect`))).toMatch(/^blocked:.*host not allowed/);
    } finally {
      dom.close();
    }
    const free = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, limits: { allowedHosts: ["127.0.0.1", "localhost"] } });
    try {
      expect(await tryFetch(free, `${origin}/redirect`)).toBe("ok:5"); // both hosts allowed: the redirect is followed
    } finally {
      free.close();
    }
  });

  it("refuses the page's own url, oversized responses and too many requests", async () => {
    await expect(createDOM({ url: `${origin}/` }, { settleMs: 0, limits: { blockPrivateHosts: true } })).rejects.toThrow("Blocked by the fetch limits");
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, limits: { maxResourceBytes: 1000, maxTotalResourceBytes: 1500, maxResourceCount: 3 } });
    try {
      expect(String(await tryFetch(dom, `${origin}/big`))).toMatch(/^blocked:.*over 1000 bytes/);
      expect(await tryFetch(dom, `${origin}/data`)).toBe("ok:5");
      expect(String(await tryFetch(dom, `${origin}/data`))).toBe("ok:5");
      expect(String(await tryFetch(dom, `${origin}/data`))).toMatch(/^blocked:.*more than 3 requests/);
    } finally {
      dom.close();
    }
  });

  it("isPrivateHost", async () => {
    const { isPrivateHost } = await import("../src/limits.js");
    for (const h of ["localhost", "a.localhost", "printer.local", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "[::1]", "fd00::1", "fe80::1", "::ffff:7f00:1"]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "2606:4700::1111"]) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });
});

describe("createDOM: logs of what happened in the page", () => {
  it("records console output, script errors, unhandled rejections and requests; onLog sees them as they happen", async () => {
    const seen: string[] = [];
    const html =
      '<!doctype html><body><script>console.log("hello", 1); console.warn("careful");</script>' +
      '<script>throw new Error("script boom");</script>' +
      '<script>Promise.reject(new Error("nobody catches this"));</script>' +
      '<script>Promise.reject(new Error("caught later")).catch(function () {});</script>' +
      '<script>setTimeout(function () { throw new Error("timer boom"); }, 5);</script></body>';
    const dom = await createDOM({ html }, { settleMs: 50, onLog: (e) => seen.push(e.type) });
    try {
      const logs = dom.logs;
      expect(logs).toContainEqual({ type: "console", level: "log", message: "hello 1" });
      expect(logs).toContainEqual({ type: "console", level: "warn", message: "careful" });
      const error = logs.find((e) => e.type === "error");
      expect(error && error.type === "error" && error.message).toContain("script boom");
      expect(error && error.type === "error" && error.source).toBe("inline");
      const rejections = logs.filter((e) => e.type === "rejection");
      expect(rejections).toHaveLength(1); // the handled one is not reported
      expect(JSON.stringify(rejections)).toContain("nobody catches this");
      expect(JSON.stringify(logs)).toContain("timer boom");
      expect(seen).toEqual(logs.map((e) => e.type));
    } finally {
      dom.close();
    }
  });

  it("logs requests with their status or the reason they failed", async () => {
    const server = createServer((req, res) => {
      res.statusCode = req.url === "/missing" ? 404 : 200;
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, limits: { allowedHosts: ["127.0.0.1"] } });
    try {
      await dom.eval(`Promise.all([fetch("${origin}/ok"), fetch("${origin}/missing"), fetch("http://example.invalid/").catch(() => 0)])`);
      const requests = dom.logs.filter((e) => e.type === "request");
      expect(requests).toContainEqual({ type: "request", method: "GET", url: `${origin}/ok`, status: 200 });
      expect(requests).toContainEqual({ type: "request", method: "GET", url: `${origin}/missing`, status: 404 });
      expect(JSON.stringify(requests)).toContain("host not allowed");
    } finally {
      dom.close();
      server.close();
    }
  });
});

describe("createDOM: frames and scrolling", () => {
  it("an iframe owns a separate document: srcdoc seeds it and open()/write() fill it", async () => {
    const dom = await createDOM(
      { html: '<iframe id="f" srcdoc="&lt;p id=s&gt;seed&lt;/p&gt;"></iframe>' },
      { settleMs: 0 },
    );
    try {
      const info = await dom.eval(() => {
        const f = document.getElementById("f") as HTMLIFrameElement;
        const d = f.contentDocument!;
        const w = f.contentWindow!;
        const first = [
          d !== document,
          d.querySelector("#s")?.textContent,
          d.defaultView === w,
          w.document === d,
          d.contentType,
        ];
        d.open();
        d.write("<html><body><div class=cover>cover</div></body></html>");
        d.close();
        return {
          first,
          cover: d.querySelector(".cover")?.textContent,
          body: d.body.textContent,
          same: f.contentDocument === d,
        };
      });
      expect(info).toEqual({
        first: [true, "seed", true, true, "text/html"],
        cover: "cover",
        body: "cover",
        same: true,
      });
    } finally {
      dom.close();
    }
  });

  it("scrollTop/scrollLeft hold what the page writes, and scrollTo/scrollBy move them", async () => {
    const dom = await createDOM({ html: '<div id="a"></div>' }, { settleMs: 0 });
    try {
      expect(
        await dom.eval(() => {
          const a = document.getElementById("a") as HTMLElement;
          a.scrollTop = 50;
          a.scrollLeft = 20;
          return [a.scrollTop, a.scrollLeft];
        }),
      ).toEqual([50, 20]);
      expect(
        await dom.eval(() => {
          const a = document.getElementById("a") as HTMLElement;
          a.scrollTo(10, 30);
          return [a.scrollTop, a.scrollLeft];
        }),
      ).toEqual([30, 10]);
      expect(
        await dom.eval(() => {
          const a = document.getElementById("a") as HTMLElement;
          a.scrollTo({ top: 77 }); // a dict leaves the axis it does not name alone
          return [a.scrollTop, a.scrollLeft];
        }),
      ).toEqual([77, 10]);
      expect(
        await dom.eval(() => {
          const a = document.getElementById("a") as HTMLElement;
          a.scrollBy(5, 3);
          return [a.scrollTop, a.scrollLeft];
        }),
      ).toEqual([80, 15]);
      expect(
        await dom.eval(() => {
          const a = document.getElementById("a") as HTMLElement;
          a.scrollTop = -5;
          return a.scrollTop;
        }),
      ).toBe(0);
    } finally {
      dom.close();
    }
  });
});

describe("createDOM: observers, media queries and computed style", () => {
  it("IntersectionObserver and ResizeObserver report once on observe(), so lazy content loads", async () => {
    const html =
      '<!doctype html><body><div id="a"></div><script>' +
      'new IntersectionObserver(function (entries, o) { document.body.setAttribute("data-io", entries[0].isIntersecting + "," + entries[0].target.id + "," + (o instanceof IntersectionObserver)); }).observe(document.getElementById("a"));' +
      'new ResizeObserver(function (entries) { document.body.setAttribute("data-ro", String(entries[0].contentRect.width)); }).observe(document.getElementById("a"));' +
      'var gone = new IntersectionObserver(function () { document.body.setAttribute("data-gone", "fired"); }); gone.observe(document.getElementById("a")); gone.disconnect();' +
      "</script></body>";
    const out = await runPageScriptsQuickJS({ html }, { settleMs: 30 });
    expect(out.html).toContain('data-io="true,a,true"');
    expect(out.html).toContain('data-ro="0"'); // no layout was given: 0, as getBoundingClientRect says
    expect(out.html).not.toContain('data-gone="fired"'); // disconnect() before it fired
  });

  it("matchMedia answers for the viewport width", async () => {
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, width: 600 });
    try {
      const matches = (q: string) => dom.eval(`matchMedia(${JSON.stringify(q)}).matches`);
      expect(await matches("(min-width: 500px)")).toBe(true);
      expect(await matches("(min-width: 700px)")).toBe(false);
      expect(await matches("(max-width: 600px)")).toBe(true);
      expect(await matches("(min-width: 40em)")).toBe(false); // 640px
      expect(await matches("screen and (min-width: 300px) and (max-width: 900px)")).toBe(true);
      expect(await matches("(min-width: 900px), (max-width: 700px)")).toBe(true);
      expect(await matches("(orientation: landscape)")).toBe(true);
      expect(await matches("(prefers-color-scheme: light)")).toBe(true);
      expect(await matches("(prefers-color-scheme: dark)")).toBe(false);
      expect(await matches("(prefers-reduced-motion: reduce)")).toBe(false);
      expect(await matches("print")).toBe(false);
      expect(await matches("not print")).toBe(true);
      expect(await matches("(something-unknown: 1)")).toBe(false);
    } finally {
      dom.close();
    }
  });

  it("getComputedStyle cascades the element's style (colours as rgb) and gives the initial values scripts ask about", async () => {
    const dom = await createDOM({ html: '<div id="a" style="color: red; display: flex"></div><div id="b"></div>' }, { settleMs: 0 });
    try {
      expect(await dom.eval("getComputedStyle(document.getElementById('a')).color")).toBe("rgb(255, 0, 0)");
      expect(await dom.eval("getComputedStyle(document.getElementById('a')).display")).toBe("flex");
      expect(await dom.eval("getComputedStyle(document.getElementById('b')).display")).toBe("block");
      expect(await dom.eval("getComputedStyle(document.getElementById('b')).getPropertyValue('visibility')")).toBe("visible");
      expect(await dom.eval("getComputedStyle(document.getElementById('b')).opacity")).toBe("1");
    } finally {
      dom.close();
    }
  });
});

describe("createDOM: WebSocket, EventSource and Worker fail the way a dead connection does", () => {
  it("fires error (and close for a WebSocket) instead of throwing a ReferenceError", async () => {
    const dom = await createDOM(
      {
        html: page(
          "",
          `window.seen = [];
           var ws = new WebSocket("wss://example.com/live");
           ws.onerror = function () { seen.push("ws.error:" + ws.readyState); };
           ws.addEventListener("close", function (e) { seen.push("ws.close:" + e.code + ":" + e.wasClean); });
           var es = new EventSource("/stream");
           es.onerror = function () { seen.push("es.error:" + es.readyState); };
           var w = new Worker("/w.js");
           w.addEventListener("error", function () { seen.push("worker.error"); });
           w.postMessage(1); w.terminate();
           try { ws.send("x"); } catch (e) { seen.push("send:" + e.name); }
           seen.push("states:" + WebSocket.OPEN + ES() + ws.readyState);
           function ES() { return EventSource.CLOSED; }`,
        ),
      },
      { settleMs: 50 },
    );
    expect(await dom.eval("seen")).toEqual(["send:InvalidStateError", "states:120", "ws.error:3", "ws.close:1006:false", "es.error:2", "worker.error"]);
    expect(dom.logs.filter((l) => l.type === "console").map((l) => (l as { message: string }).message)).toEqual(
      expect.arrayContaining([expect.stringContaining("WebSocket is not available"), expect.stringContaining("EventSource is not available")]),
    );
    // the error/close phase is logged too, not just the construction warning
    expect(dom.logs.filter((l) => l.type === "console").map((l) => (l as { message: string }).message)).toEqual(
      expect.arrayContaining([expect.stringContaining("WebSocket closed with an error"), expect.stringContaining("EventSource closed with an error")]),
    );
    dom.close();
  });

  it("executes in-process Worker scripts from Blob and data URLs with postMessage round-trips", async () => {
    const dom = await createDOM(
      {
        html: page(
          '<div id="out"></div>',
          `var blob = new Blob([
             "var count = 0; addEventListener('message', function (e) {" +
             "  count++;" +
             "  postMessage({ reply: e.data.x * 2, count: count, win: typeof window, doc: typeof document });" +
             "});"
           ], { type: "application/javascript" });
           var url = URL.createObjectURL(blob);
           var w = new Worker(url);
           window.results = [];
           w.onmessage = function (e) {
             window.results.push(e.data);
             if (e.data.count === 1) {
               w.postMessage({ x: 21 });
             } else {
               w.terminate();
               w.postMessage({ x: 99 });
               document.getElementById("out").textContent = "done:" + e.data.reply;
             }
           };
           w.postMessage({ x: 5 });`,
        ),
      },
      { settleMs: 100 },
    );
    try {
      expect(await dom.eval("results")).toEqual([
        { reply: 10, count: 1, win: "undefined", doc: "undefined" },
        { reply: 42, count: 2, win: "undefined", doc: "undefined" },
      ]);
      expect(dom.serialize()).toContain('<div id="out">done:42</div>');
    } finally {
      dom.close();
    }
  });
});

describe("createDOM: silent losses in a snapshot are warned about", () => {
  it("warns that a shadow tree is not serialized", async () => {
    const dom = await createDOM(
      {
        html: page(
          '<div id="host"></div>',
          `var root = document.getElementById("host").attachShadow({ mode: "open" });
           root.innerHTML = "<b>" + ["inside", "the", "shadow"].join(" ") + "</b>";`,
        ),
      },
      { settleMs: 0 },
    );
    try {
      const out = dom.serialize();
      expect(out).toContain('id="host"');
      expect(out).not.toContain("inside the shadow");
      expect(dom.logs).toContainEqual(
        expect.objectContaining({ type: "console", level: "warn", message: expect.stringContaining("attachShadow") }),
      );
    } finally {
      dom.close();
    }
  });

  it("warns when a canvas returns null from getContext and an empty data: URL from toDataURL", async () => {
    const dom = await createDOM(
      {
        html: page(
          '<canvas id="c" width="10" height="10"></canvas>',
          `var c = document.getElementById("c");
           c.setAttribute("data-ctx", String(c.getContext("2d")));
           c.setAttribute("data-url", c.toDataURL("image/png"));`,
        ),
      },
      { settleMs: 0 },
    );
    try {
      const out = dom.serialize();
      expect(out).toContain('data-ctx="null"');
      expect(out).toContain('data-url="data:,"');
      const messages = dom.logs.filter((l) => l.type === "console" && l.level === "warn").map((l) => (l as { message: string }).message);
      expect(messages).toEqual(expect.arrayContaining([expect.stringContaining("getContext"), expect.stringContaining("toDataURL")]));
    } finally {
      dom.close();
    }
  });
});

describe("createDOM: eval with arguments, and helpers to drive the page", () => {
  it("eval(fn, ...args) passes JSON arguments; a string takes none", async () => {
    const dom = await createDOM({ html: '<ul><li class="a">1</li><li class="a">2</li><li>3</li></ul>' }, { settleMs: 0 });
    try {
      expect(await dom.eval((sel: string) => document.querySelectorAll(sel).length, "li.a")).toBe(2);
      expect(await dom.eval((a: number, b: { x: string }) => a + b.x, 1, { x: "y" })).toBe("1y");
      expect(await dom.eval(async (ms: number) => { await new Promise((r) => setTimeout(r, ms)); return "slept"; }, 10)).toBe("slept");
      expect(() => dom.eval("1", 2 as never)).toThrow(TypeError);
      const count: number = await dom.eval<number>("document.querySelectorAll('li').length");
      expect(count).toBe(3);
    } finally {
      dom.close();
    }
  });

  it("click(), type() and waitForSelector() drive the page and fire its handlers", async () => {
    const html =
      '<!doctype html><body><input id="name"><button id="go">go</button><div id="out"></div><script>' +
      'var input = document.getElementById("name");' +
      'input.addEventListener("input", function () { document.getElementById("out").setAttribute("data-typed", input.value); });' +
      'document.getElementById("go").addEventListener("click", function () { setTimeout(function () { var p = document.createElement("p"); p.id = "later"; p.textContent = "hello " + input.value; document.body.appendChild(p); }, 30); });' +
      "</script></body>";
    const dom = await createDOM({ html }, { settleMs: 0, timeout: 2000 });
    try {
      expect(await dom.type("#name", "Ada")).toBe(true);
      expect(await dom.eval("document.getElementById('out').getAttribute('data-typed')")).toBe("Ada");
      expect(await dom.waitForSelector("#later")).toBe(false); // not yet, and a short wait would not be enough
    } finally {
      dom.close();
    }
    const dom2 = await createDOM({ html }, { settleMs: 0, timeout: 2000 });
    try {
      await dom2.type("#name", "Ada");
      expect(await dom2.click("#go")).toBe(true);
      expect(await dom2.waitForSelector("#later")).toBe(true);
      expect(await dom2.eval("document.getElementById('later').textContent")).toBe("hello Ada");
      expect(await dom2.click("#missing")).toBe(false);
      expect(await dom2.type("#missing", "x")).toBe(false);
    } finally {
      dom2.close();
    }
  });

  it("expose() makes a host function callable from the page, as a promise", async () => {
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0 });
    try {
      const calls: unknown[][] = [];
      dom.expose("hostAdd", (a: number, b: number) => (calls.push([a, b]), a + b));
      dom.expose("hostSlow", async (s: string) => {
        await new Promise((r) => setTimeout(r, 20));
        return { echoed: s.toUpperCase() };
      });
      dom.expose("hostFail", () => {
        throw new Error("nope");
      });
      expect(await dom.eval("hostAdd(2, 3)")).toBe(5);
      expect(calls).toEqual([[2, 3]]);
      expect(await dom.eval("hostSlow('abc')")).toEqual({ echoed: "ABC" });
      expect(await dom.eval("hostFail().then(() => 'no', (e) => e.message)")).toBe("nope");
      expect(await dom.eval("typeof hostAdd(1, 1).then")).toBe("function");
    } finally {
      dom.close();
    }
  });
});

describe("createDOM: speed", () => {
  it("does not wait out the settle time when nothing is pending", async () => {
    const started = Date.now();
    const out = await runPageScriptsQuickJS({ html: page("<p id=p>0</p>", 'document.getElementById("p").textContent = "done";') }, { settleMs: 5000 });
    expect(out.html).toContain(">done<");
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("waits for the timers that fall inside the settle time, and only for those", async () => {
    const html = page("", 'setTimeout(function () { document.body.setAttribute("data-soon", "1"); }, 150); setTimeout(function () { document.body.setAttribute("data-later", "1"); }, 4000);');
    const started = Date.now();
    const out = await runPageScriptsQuickJS({ html }, { settleMs: 1000 });
    expect(out.html).toContain('data-soon="1"');
    expect(out.html).not.toContain('data-later="1"'); // due after the settle time: not waited for
    expect(Date.now() - started).toBeLessThan(1500);
    const long = await runPageScriptsQuickJS({ html }, { settleMs: 5000, timeout: 8000 });
    expect(long.html).toContain('data-later="1"');
  }, 20_000);

  it("waitForSelector gives up at once when nothing could still add the element", async () => {
    const dom = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, timeout: 8000 });
    try {
      const started = Date.now();
      expect(await dom.waitForSelector("#never")).toBe(false);
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      dom.close();
    }
  });

  it("requests external scripts together but runs them in document order", async () => {
    const server = createServer((req, res) => {
      const n = Number(/\/s(\d)\.js/.exec(req.url ?? "")?.[1]);
      setTimeout(() => {
        res.setHeader("content-type", "text/javascript");
        res.end(`document.body.setAttribute("data-order", (document.body.getAttribute("data-order") || "") + "${n}");`);
      }, 400);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const html = `<!doctype html><body><script src="${origin}/s1.js"></script><script src="${origin}/s2.js"></script><script src="${origin}/s3.js"></script><script src="${origin}/s4.js"></script></body>`;
      const started = Date.now();
      const out = await runPageScriptsQuickJS({ html }, { settleMs: 0 });
      expect(out.html).toContain('data-order="1234"');
      expect(Date.now() - started).toBeLessThan(1400); // one after another would take 4 x 400 ms
    } finally {
      server.close();
    }
  }, 20_000);

  it("skip() keeps chosen requests off the network, the page itself excepted", async () => {
    const server = createServer((_req, res) => res.end('document.body.setAttribute("data-ran", "1");'));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const html = `<!doctype html><body><script>var s = document.createElement("script"); s.src = "${origin}/analytics.js"; s.onerror = function () { document.body.setAttribute("data-err", "1"); }; document.head.appendChild(s); fetch("${origin}/track").then(function () { document.body.setAttribute("data-fetch", "ok"); }, function (e) { document.body.setAttribute("data-fetch", "blocked"); });</script></body>`;
      const seen: string[] = [];
      const out = await runPageScriptsQuickJS({ html }, { settleMs: 50, skip: (url: string) => (seen.push(url), url.includes("analytics") || url.includes("track")) } as never);
      expect(out.html).toContain('data-err="1"');
      expect(out.html).toContain('data-fetch="blocked"');
      expect(out.html).not.toContain('data-ran');
      expect(seen.some((u) => u.includes("analytics"))).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe("createDOM: instances are copies of one started instance", () => {
  it("shares nothing between pages, and gives each its own clock and random numbers", async () => {
    const a = await createDOM({ html: "<p id=p>a</p>" }, { settleMs: 0 });
    await a.eval(() => {
      (globalThis as any).leak = "from a";
      document.body.setAttribute("data-a", "1");
      setTimeout(() => ((globalThis as any).timerRan = true), 5);
    });
    const b = await createDOM({ html: "<p id=p>b</p>" }, { settleMs: 0 });
    try {
      expect(await b.eval(() => typeof (globalThis as any).leak)).toBe("undefined");
      expect(await b.eval(() => document.body.getAttribute("data-a"))).toBe(null);
      expect(await b.eval(() => document.getElementById("p")!.textContent)).toBe("b");
      await new Promise((r) => setTimeout(r, 30));
      expect(await b.eval(() => typeof (globalThis as any).timerRan)).toBe("undefined"); // a's timer is not b's
      const draws = async (d: typeof a) => d.eval(() => [Math.random(), Math.random(), Math.random()]);
      expect(await draws(a)).not.toEqual(await draws(b));
      expect(await b.eval(() => performance.now())).toBeLessThan(2000); // counted from b's own start
    } finally {
      a.close();
      b.close();
    }
  });

  it("many pages at once, each on its own", async () => {
    const pages = await Promise.all(Array.from({ length: 6 }, (_, i) => createDOM({ html: `<p id=p>${i}</p><script>window.me = ${i};</script>` }, { settleMs: 0 })));
    try {
      const seen = await Promise.all(pages.map((d) => d.eval(() => [(globalThis as any).me, document.getElementById("p")!.textContent])));
      expect(seen).toEqual([0, 1, 2, 3, 4, 5].map((i) => [i, String(i)]));
    } finally {
      for (const d of pages) d.close();
    }
  });
});

describe("a page that replaces Promise", () => {
  it("observers, queueMicrotask and eval() keep working when the global Promise needs a MutationObserver (core-js)", async () => {
    const page = await createDOM(
      {
        html: `<body><script>
          var Native = Promise, node = document.createTextNode(""), flip = false, queued = [];
          new MutationObserver(function () { var q = queued; queued = []; q.forEach(function (f) { f(); }); }).observe(node, { characterData: true });
          function Fake(ex) { var cbs = []; this.then = function (f) { cbs.push(f); queued.push(function () { cbs.forEach(function (c) { c(1); }); }); node.data = (flip = !flip) ? "a" : "b"; }; ex(function () {}); }
          Fake.resolve = function () { return new Fake(function () {}); };
          window.Promise = Fake;
        </script></body>`,
      },
      { settleMs: 0, timeout: 4000 },
    );
    try {
      expect(await page.eval(`typeof Promise.resolve().then + ":" + (Promise !== __nativePromise)`)).toBe("function:true");
      expect(await page.eval(`(function () { var t = document.createTextNode("ab"); t.appendData("cd"); t.insertData(0, "<"); t.deleteData(1, 1); t.replaceData(0, 1, ">"); return t.data + t.substringData(1, 2); })()`)).toBe(">bcdbc");
    } finally {
      page.close();
    }
  });
});

describe("beforeScripts", () => {
  it("runs before the page's scripts, sees the parsed document, and an error in it does not stop the page", async () => {
    const dom = await createDOM(
      { html: `<body><p id=p>x</p><script>window.seen = [window.flag, document.getElementById("p") ? "doc" : "nodoc", window.n];</script></body>` },
      { settleMs: 0, beforeScripts: ["window.flag = 'set'; window.n = (window.n || 0) + 1;", "throw new Error('boom')", "window.n += 1;"] },
    );
    try {
      expect(await dom.eval(`JSON.stringify(seen)`)).toBe(JSON.stringify(["set", "doc", 2]));
      expect(dom.logs.some((l) => l.type === "error" && l.source === "before-scripts-2.js" && /boom/.test(l.message))).toBe(true);
    } finally {
      dom.close();
    }
  });
});

describe("URLSearchParams and Headers cloning and iterables", () => {
  it("clones URLSearchParams correctly without breaking into an 'l' property", async () => {
    const page = await createDOM({ html: "<p>x</p>" }, { settleMs: 0 });
    try {
      const res = await page.eval(`(function () {
        var sp1 = new URLSearchParams("?name=sorakumo001&sort=-4");
        var sp2 = new URLSearchParams(sp1);
        var sp3 = new URLSearchParams([["foo", "1"], ["bar", "2"]]);
        sp1.sort();
        return JSON.stringify({
          sp2_name: sp2.get("name"),
          sp2_sort: sp2.get("sort"),
          sp2_size: sp2.size,
          sp2_str: sp2.toString(),
          sp3_foo: sp3.get("foo"),
          sp3_bar: sp3.get("bar"),
          sp1_sorted: sp1.toString()
        });
      })()`);
      expect(JSON.parse(res as string)).toEqual({
        sp2_name: "sorakumo001",
        sp2_sort: "-4",
        sp2_size: 2,
        sp2_str: "name=sorakumo001&sort=-4",
        sp3_foo: "1",
        sp3_bar: "2",
        sp1_sorted: "name=sorakumo001&sort=-4"
      });
    } finally {
      page.close();
    }
  });

  it("clones Headers correctly without breaking into an 'm' property", async () => {
    const page = await createDOM({ html: "<p>x</p>" }, { settleMs: 0 });
    try {
      const res = await page.eval(`(function () {
        var h1 = new Headers({ "Content-Type": "application/json", "X-Custom": "val" });
        var h2 = new Headers(h1);
        var h3 = new Headers([["Accept", "text/plain"], ["X-Test", "123"]]);
        return JSON.stringify({
          h2_ct: h2.get("content-type"),
          h2_custom: h2.get("x-custom"),
          h3_accept: h3.get("accept"),
          h3_test: h3.get("x-test")
        });
      })()`);
      expect(JSON.parse(res as string)).toEqual({
        h2_ct: "application/json",
        h2_custom: "val",
        h3_accept: "text/plain",
        h3_test: "123"
      });
    } finally {
      page.close();
    }
  });
});

describe("many listeners", () => {
  it("adding and removing thousands of listeners is not quadratic, and duplicates are still ignored", async () => {
    const page = await createDOM({ html: "<p>x</p>" }, { settleMs: 0, timeout: 10000 });
    try {
      expect(
        await page.eval(`(function () {
          var t = Date.now(), n = 0, fns = [];
          for (var i = 0; i < 20000; i++) { var f = function () { n++; }; fns.push(f); window.addEventListener("ping", f, true); }
          window.addEventListener("ping", fns[0], true); // a duplicate
          window.addEventListener("ping", fns[0], false); // same function, other phase: a second listener
          for (var j = 0; j < 10000; j++) window.removeEventListener("ping", fns[j], true);
          window.dispatchEvent(new Event("ping"));
          return JSON.stringify([n, Date.now() - t < 5000]);
        })()`),
      ).toBe(JSON.stringify([10001, true]));
    } finally {
      page.close();
    }
  });
});
