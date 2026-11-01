import { describe, expect, it } from "vitest";
import { mermaidListen, mermaidRenderOptions, renderMermaidInput, type MermaidOptions, type RenderFn } from "../src/mermaid.js";
import type { HtmlToImageOptions } from "../src/core.js";

// A page of a 300 x 120 diagram with the 16 px padding around it, as the engine writes it at a given page width.
function page(width: number, extra = ""): string {
  return (
    `<?xml version="1.0" encoding="utf-8" ?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="152"><defs><!--SATORU_DEFS--></defs>\n` +
    `\t<svg x="16" y="16" width="300" height="120" viewBox="0 0 300 120">${extra}</svg>\n</svg>`
  );
}

function fakeEngine(extra = "", fits = false) {
  const calls: Array<{ width?: number; format?: string; fit?: number }> = [];
  const render = async (input: HtmlToImageOptions) => {
    calls.push({ width: input.width, format: input.format, fit: input.fitContent });
    // an engine that fits to the content draws the diagram (300 wide) and its padding
    const width = fits && input.fitContent !== undefined ? 300 + 2 * input.fitContent : (input.width ?? 800);
    return input.format === "svg"
      ? { data: page(width, extra), width, height: 152, format: "svg" as const }
      : { data: new Uint8Array([1, 2, 3]), width, height: 152, format: input.format ?? ("png" as const) };
  };
  return { render: render as never, calls };
}

// the call `render({ mermaid })` makes of its page renderer
const draw = (render: RenderFn, source: string, options: MermaidOptions = {}) => renderMermaidInput(render, mermaidRenderOptions(source, options));

describe("render({ mermaid }): the probe render", () => {
  it("is the answer for an SVG: one render, the page width changed to the diagram's", async () => {
    const { render, calls } = fakeEngine();
    const out = await draw(render, "flowchart TD\nA-->B");
    expect(calls).toHaveLength(1);
    expect(out.width).toBe(332);
    expect(out.data).toBe(page(332));
  });

  it("is one render for a raster image when the engine fits the image to the diagram", async () => {
    const { render, calls } = fakeEngine("", true);
    const out = await draw(render, "flowchart TD\nA-->B", { format: "png", padding: 10 });
    expect(calls).toEqual([{ width: 4096, format: "png", fit: 10 }]);
    expect(out.width).toBe(320);
  });

  it("is followed by a render at the diagram's width for a raster image when the engine does not fit", async () => {
    const { render, calls } = fakeEngine();
    const out = await draw(render, "flowchart TD\nA-->B", { format: "png" });
    expect(calls.map((c) => [c.width, c.format])).toEqual([
      [4096, "png"],
      [4096, "svg"],
      [332, "png"],
    ]);
    expect(out.width).toBe(332);
  });

  it("is followed by a second render when the page has a background (painted across the whole width)", async () => {
    const { render, calls } = fakeEngine();
    await draw(render, "flowchart TD\nA-->B", { background: "#fff" });
    expect(calls.map((c) => c.width)).toEqual([4096, 332]);
  });

  it("is followed by a second render when something else on the page is 4096 wide", async () => {
    const { render, calls } = fakeEngine('<rect width="4096" height="10"/>');
    await draw(render, "flowchart TD\nA-->B");
    expect(calls).toHaveLength(2);
  });

  it("is skipped when the width is given", async () => {
    const { render, calls } = fakeEngine();
    await draw(render, "flowchart TD\nA-->B", { width: 500 });
    expect(calls.map((c) => c.width)).toEqual([500]);
  });
});

describe("render({ mermaid }): the options", () => {
  it("passes the other render options on to every pass", async () => {
    const seen: HtmlToImageOptions[] = [];
    const render = (async (input: HtmlToImageOptions) => {
      seen.push(input);
      return { data: input.format === "svg" ? page(input.width ?? 800) : new Uint8Array([1]), width: input.fitContent !== undefined ? 300 + 2 * input.fitContent : (input.width ?? 800), height: 152, format: input.format ?? "png" };
    }) as never;
    await renderMermaidInput(render, { ...mermaidRenderOptions("flowchart TD\nA-->B", { format: "png" }), css: "p{}", fontMap: { serif: "x" } });
    expect(seen).toHaveLength(1);
    for (const o of seen) {
      expect(o.css).toBe("p{}");
      expect(o.fontMap).toEqual({ serif: "x" });
      expect(o.mermaid).toBeUndefined();
    }
  });

  it("tells onWarning once for a message, passes it to the caller's onLog too, and still calls the caller's onLog", async () => {
    const warnings: string[] = [];
    const logs: string[] = [];
    const render = (async (input: HtmlToImageOptions) => {
      input.onLog?.(2, "[MERMAID_RECOVERED] fixed a keyword");
      return { data: input.format === "svg" ? page(input.width ?? 800) : new Uint8Array([1]), width: input.fitContent !== undefined ? 300 + 2 * input.fitContent : (input.width ?? 800), height: 152, format: input.format ?? "png" };
    }) as never;
    await renderMermaidInput(render, {
      ...mermaidRenderOptions("flowchart TD\nA-->B", { format: "png", onWarning: (w) => warnings.push(w.code + ":" + w.message) }),
      onLog: (_l, t) => logs.push(t),
    });
    expect(warnings).toEqual(["MERMAID_RECOVERED:fixed a keyword"]);
    expect(logs).toHaveLength(1);
  });

  it("raises a quieter log level to warnings so the messages arrive", () => {
    expect(mermaidListen(() => {}, { logLevel: 1 }).logLevel).toBe(2);
    expect(mermaidListen(() => {}, { logLevel: 4 }).logLevel).toBe(4);
    expect(mermaidListen(undefined, { logLevel: 1 })).toEqual({});
  });
});
