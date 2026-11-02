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
