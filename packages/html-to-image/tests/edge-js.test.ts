import { describe, expect, it } from "vitest";
import { applyJavaScript, runPageScriptsQuickJS as runPageScripts } from "../src/edge-js.js";
import { resolveJavaScript } from "../src/cli-options.js";

const page = (body: string, script: string) => `<!doctype html><html><body>${body}<script>${script}</script></body></html>`;

// the QuickJS engine itself is tested in packages/quickjs-dom; this covers how render options reach it
describe("javascript option, QuickJS engine (wasm-quickjs-dom)", () => {
  it("applyJavaScript replaces string HTML and leaves other inputs alone", async () => {
    const out = await applyJavaScript({ value: page('<p id="p">0</p>', 'document.getElementById("p").textContent = "1";'), javascript: { settleMs: 0 } });
    expect(String(out.value)).toContain(">1<");
    expect("javascript" in out).toBe(false);
    const bytes = new Uint8Array([1, 2, 3]);
    expect((await applyJavaScript({ value: bytes, javascript: true })).value).toBe(bytes);
    const plain = { value: "<p>x</p>" };
    expect(await applyJavaScript(plain)).toBe(plain);
  });

  it("rejects the removed jsdom engine", async () => {
    await expect(
      applyJavaScript({
        value: page('<p id="p">0</p>', ""),
        javascript: { engine: "jsdom" as never },
      }),
    ).rejects.toThrow(/no longer supported/);
  });

  it("re-exports createDOM, whose page can become render options", async () => {
    const { createDOM } = await import("../src/edge-js.js");
    const dom = await createDOM({ html: page('<p id="p">0</p>', "") }, { settleMs: 0 });
    try {
      await dom.eval('document.getElementById("p").textContent = "2"');
      expect(String(dom.toOptions({ width: 100 }).value)).toContain(">2<");
    } finally {
      dom.close();
    }
  });
});

// Moved from js-page.test.ts: the QuickJS engine is now the only one, so these page-level cases live here.
describe("javascript option, QuickJS engine: pages and browser APIs", () => {
  it("serializes the DOM after the scripts ran", async () => {
    const out = await runPageScripts(
      { html: page('<div id="a">before</div>', 'document.getElementById("a").textContent = "after";') },
      { settleMs: 0 },
    );
    expect(out.html).toContain(">after<");
    expect(out.html).not.toContain(">before<");
  });

  it("runs timers within the settle time", async () => {
    const out = await runPageScripts(
      { html: page('<p id="t">wait</p>', 'setTimeout(() => { document.getElementById("t").className = "done"; }, 30);') },
      { settleMs: 200 },
    );
    expect(out.html).toContain('class="done"');
  });

  it("waits for a selector", async () => {
    const out = await runPageScripts(
      { html: page("", 'setTimeout(() => { document.body.insertAdjacentHTML("beforeend", "<i id=late></i>"); }, 80);') },
      { waitFor: "#late", timeout: 3000 },
    );
    expect(out.html).toContain('id="late"');
  });

  it("drops <noscript>, survives script errors and answers matchMedia from the width", async () => {
    const out = await runPageScripts(
      {
        html: page(
          "<noscript><b>no js</b></noscript><p id=p>x</p>",
          'throw new Error("boom");',
        ) + '<script>document.getElementById("p").textContent = String(window.matchMedia("(min-width: 1px)").matches);</script>',
      },
      { settleMs: 0 },
    );
    expect(out.html).not.toContain("no js");
    expect(out.html).toContain(">true<"); // the QuickJS matchMedia knows the 800px viewport
  });

  it("lends fetch/Request and survives a page's unhandled rejection", async () => {
    const out = await runPageScripts(
      {
        html: page(
          '<p id="f"></p>',
          'document.getElementById("f").textContent = [typeof fetch, typeof Request, typeof Response].join(",");' +
            'Promise.reject(new Error("boom")); setTimeout(() => { throw new Error("late"); }, 10);',
        ),
      },
      { settleMs: 100 },
    );
    expect(out.html).toContain(">function,function,function<");
  });

  it("has Web Streams", async () => {
    const out = await runPageScripts(
      { html: page("<p id=s></p>", 'document.getElementById("s").textContent = typeof ReadableStream + "," + typeof TransformStream;') },
      { settleMs: 0 },
    );
    expect(out.html).toContain(">function,function<");
  });

  it("runs module scripts (jsdom did not)", async () => {
    const out = await runPageScripts(
      { html: '<!doctype html><body><script type="module">document.body.setAttribute("data-module", "ran");</script></body>' },
      { settleMs: 100 },
    );
    expect(out.html).toContain('data-module="ran"');
  });

  it("fires IntersectionObserver and ResizeObserver on observe", async () => {
    const out = await runPageScripts(
      {
        html: page(
          '<div id="a"></div>',
          'new IntersectionObserver((e) => { document.body.setAttribute("data-io", String(e[0].isIntersecting)); }).observe(document.getElementById("a"));' +
            'new ResizeObserver((e) => { document.body.setAttribute("data-ro", String(e[0].contentRect.width)); }).observe(document.getElementById("a"));',
        ),
      },
      { settleMs: 30 },
    );
    expect(out.html).toContain('data-io="true"');
    expect(out.html).toContain('data-ro="0"'); // no layout yet: the same 0 getBoundingClientRect answers
  });

  it("clears document.currentScript after the script ran", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      res.setHeader("content-type", req.url === "/chunk.js" ? "text/javascript" : "text/html");
      res.end(
        req.url === "/chunk.js"
          ? 'setTimeout(() => { document.body.setAttribute("data-cs", String(document.currentScript && document.currentScript.tagName)); }, 20);'
          : '<!doctype html><body><script src="/chunk.js" async></script></body>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as { port: number };
      const out = await runPageScripts({ url: `http://127.0.0.1:${port}/` }, { settleMs: 300 });
      expect(out.html).toContain('data-cs="null"'); // a browser clears it once the script returns
    } finally {
      server.close();
    }
  });
});

describe("CLI --js-wait", () => {
  it("maps --js-wait to settleMs or a selector", () => {
    expect(resolveJavaScript(undefined)).toBe(true);
    expect(resolveJavaScript("500")).toEqual({ settleMs: 500 });
    expect(resolveJavaScript("#app .ready")).toEqual({ waitFor: "#app .ready" });
  });
});

describe("measureLayout: real boxes for the page's getBoundingClientRect", () => {
  it("lays the page out with the engine and answers from it, leaving the page untouched", async () => {
    const { createDOM, measureLayout } = await import("../src/edge-js.js");
    const { render } = await import("../src/single.js");
    const html =
      '<!doctype html><html><head><style>body{margin:0}#a{width:200px;height:50px;margin:10px 0 0 30px}#b{height:30px;margin:0}</style></head>' +
      '<body><div id="a" class="box big"></div><div id="b"></div><script>window.sizes = () => [document.getElementById("a").offsetWidth, document.getElementById("a").offsetHeight];</script></body></html>';
    const dom = await createDOM({ html }, { settleMs: 0, width: 400 });
    try {
      expect(await dom.eval("document.getElementById('a').getBoundingClientRect().width")).toBe(0); // no layout yet
      const count = await measureLayout(dom, render, { width: 400 });
      expect(count).toBeGreaterThan(3);
      expect(await dom.eval("document.getElementById('a').getBoundingClientRect().toJSON()")).toEqual({
        x: 30, y: 10, width: 200, height: 50, top: 10, left: 30, right: 230, bottom: 60,
      });
      expect(await dom.eval("sizes()")).toEqual([200, 50]);
      expect(await dom.eval("document.getElementById('b').offsetTop")).toBe(60);
      expect(await dom.eval("document.getElementById('b').getBoundingClientRect().width")).toBe(400);
      // the markers were only on the copy that was laid out
      expect(dom.serialize()).not.toContain("qjsl-");
      expect(await dom.eval("document.getElementById('a').className")).toBe("box big");
    } finally {
      dom.close();
    }
  }, 60_000);
});

describe("measureLayout on markup without <html>", () => {
  it("measures every top-level element, not only the first one", async () => {
    const { createDOM, measureLayout } = await import("../src/edge-js.js");
    const { render } = await import("../src/single.js");
    const dom = await createDOM({ html: '<style>#a{width:120px;height:40px}#b{width:50px;height:10px}</style><div id="a"></div><div id="b"></div>' }, { settleMs: 0, width: 300 });
    try {
      expect(await measureLayout(dom, render, { width: 300 })).toBeGreaterThan(1);
      expect(await dom.eval(() => [document.getElementById("a")!.offsetWidth, document.getElementById("a")!.offsetHeight, document.getElementById("b")!.offsetWidth, document.getElementById("b")!.offsetTop])).toEqual([120, 40, 50, 40]);
    } finally {
      dom.close();
    }
  }, 60_000);
});

describe("the render `limits` also bound what the page's scripts fetch (QuickJS engine)", () => {
  it("applyJavaScript passes allowedHosts / blockPrivateHosts on, and javascript.limits wins", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => res.end("hello"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const html = `<!doctype html><body><p id="p"></p><script>fetch(${JSON.stringify(url)}).then((r) => r.text(), (e) => "blocked").then((t) => { document.getElementById("p").textContent = t; });</script></body>`;
    try {
      const run = async (options: Record<string, unknown>) => String((await applyJavaScript({ value: html, ...options } as never)).value);
      expect(await run({ javascript: { settleMs: 200 } })).toContain(">hello<");
      expect(await run({ javascript: { settleMs: 200 }, limits: { allowedHosts: ["example.com"] } })).toContain(">blocked<");
      expect(await run({ javascript: { settleMs: 200, limits: { blockPrivateHosts: true } } })).toContain(">blocked<");
      // the scripts' own limits replace the render ones where both say something
      expect(await run({ javascript: { settleMs: 200, limits: { allowedHosts: ["127.0.0.1"] } }, limits: { allowedHosts: ["example.com"] } })).toContain(">hello<");
    } finally {
      server.close();
    }
  });
});

// Smoke test for the `single` entry: with no `quickjsWasm` given, Node.js resolves the engine's
// conditional import `#quickjs-wasm` to `wasm-quickjs-dom/dist/quickjs-node.js` (the wasm read from disk
// and compiled). If that path broke, `javascript: true` would throw before drawing anything.
describe("single entry: Node renders with the QuickJS wasm (dist/quickjs-node.js)", () => {
  const html =
    '<!doctype html><html><body style="margin:0;font:20px sans-serif"><p id="p">before</p>' +
    '<script>document.getElementById("p").textContent = "after";</script></body></html>';
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  it.each([false, true])("render({ javascript: %s }) draws the page", async (javascript) => {
    const { render } = await import("../src/single.js");
    const { data } = await render({ value: html, width: 240, height: 60, format: "png", javascript, fontMap: {} });
    expect([...(data as Uint8Array).subarray(0, 8)]).toEqual(PNG);
  }, 60_000);

  it("runPageScripts is the wasm-quickjs-dom runPageScriptsQuickJS alias, and runs the page", async () => {
    const { runPageScripts } = await import("../src/single.js");
    const { runPageScriptsQuickJS } = await import("wasm-quickjs-dom");
    expect(runPageScripts).toBe(runPageScriptsQuickJS);
    const out = await runPageScripts({ html }, { settleMs: 0 });
    expect(out.html).toContain(">after<");
  }, 60_000);
});

describe("measureLayout: inline elements", () => {
  it("gives a span or link the box that encloses its line fragments", async () => {
    const { createDOM, measureLayout } = await import("../src/edge-js.js");
    const { render } = await import("../src/single.js");
    const html =
      '<!doctype html><html><head><style>body{margin:0;font:16px/20px sans-serif}p{margin:0;width:400px}</style></head>' +
      '<body><p>before <a id="l" href="#">a link</a> after</p><p id="q" style="margin-top:10px">x <span id="s" style="display:inline-block;width:50px;height:30px"></span></p></body></html>';
    const dom = await createDOM({ html }, { settleMs: 0, width: 400 });
    try {
      await measureLayout(dom, render, { width: 400 });
      const link = await dom.eval(() => document.getElementById("l")!.getBoundingClientRect().toJSON());
      expect(link.width).toBeGreaterThan(20);
      expect(link.height).toBeGreaterThan(5);
      expect(link.left).toBeGreaterThan(20); // after "before "
      expect(link.top).toBeLessThan(20); // on the first line
      expect(await dom.eval(() => [document.getElementById("s")!.offsetWidth, document.getElementById("s")!.offsetHeight])).toEqual([50, 30]);
      // a block that wraps its text keeps its own box, unchanged by the inline option
      expect(await dom.eval(() => document.getElementById("q")!.offsetWidth)).toBe(400);
    } finally {
      dom.close();
    }
  }, 60_000);
});
