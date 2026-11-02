import { describe, expect, it } from "vitest";
import { applyJavaScript } from "../src/edge-js.js";

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

  it('is what `javascript: { engine: "quickjs" }` selects in the Node entry', async () => {
    const { applyJavaScript: applyAny } = await import("../src/js-page.js");
    const out = await applyAny({
      value: page('<p id="p">0</p>', 'document.getElementById("p").textContent = typeof process + "," + typeof document.createElement;'),
      javascript: { engine: "quickjs", settleMs: 0 },
    });
    expect(String(out.value)).toContain(">undefined,function<"); // QuickJS has no `process`; jsdom would say "object"
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
