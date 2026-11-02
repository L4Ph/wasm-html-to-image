import { describe, expect, it } from "vitest";
import { applyJavaScript, runPageScripts } from "../src/js-page.js";
import { resolveJavaScript } from "../src/cli-options.js";

const page = (body: string, script: string) =>
  `<!doctype html><html><body>${body}<script>${script}</script></body></html>`;

describe("javascript option (jsdom)", () => {
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

  it("drops <noscript>, survives script errors and missing browser APIs", async () => {
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
    expect(out.html).toContain(">false<");
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

  it("applyJavaScript replaces string HTML and leaves other inputs alone", async () => {
    const opts = await applyJavaScript({
      value: page('<div id="a">1</div>', 'document.getElementById("a").textContent = "2";'),
      width: 100,
      javascript: { settleMs: 0 },
    });
    expect(String(opts.value)).toContain(">2<");
    expect("javascript" in opts).toBe(false);
    const bytes = new Uint8Array([1, 2, 3]);
    const same = await applyJavaScript({ value: bytes, width: 100, javascript: true });
    expect(same.value).toBe(bytes);
    const plain = { value: "<p>x</p>", width: 100 };
    expect(await applyJavaScript(plain)).toBe(plain);
  });

  it("maps --js-wait to settleMs or a selector", () => {
    expect(resolveJavaScript(undefined)).toBe(true);
    expect(resolveJavaScript("500")).toEqual({ settleMs: 500 });
    expect(resolveJavaScript("#app .ready")).toEqual({ waitFor: "#app .ready" });
  });
});

describe("javascript option: what framework bundles (Next.js) need", () => {
  it("has Web Streams", async () => {
    const out = await runPageScripts(
      { html: page("<p id=s></p>", 'document.getElementById("s").textContent = typeof ReadableStream + "," + typeof TransformStream;') },
      { settleMs: 0 },
    );
    expect(out.html).toContain(">function,function<");
  });

  it("lets an external script find a script element in document.currentScript after it has run", async () => {
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
      expect(out.html).toContain('data-cs="SCRIPT"');
    } finally {
      server.close();
    }
  });
});
