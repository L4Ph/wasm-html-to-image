import { describe, expect, it } from "vitest";
import { renderMermaidWith } from "../src/mermaid.js";
import type { HtmlToImageOptions } from "../src/core.js";

// A page of a 300 x 120 diagram with the 16 px padding around it, as the engine writes it at a given page width.
function page(width: number, extra = ""): string {
  return (
    `<?xml version="1.0" encoding="utf-8" ?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="152"><defs><!--SATORU_DEFS--></defs>\n` +
    `\t<svg x="16" y="16" width="300" height="120" viewBox="0 0 300 120">${extra}</svg>\n</svg>`
  );
}

function fakeEngine(extra = "") {
  const calls: Array<{ width?: number; format?: string }> = [];
  const render = async (input: HtmlToImageOptions) => {
    calls.push({ width: input.width, format: input.format });
    const width = input.width ?? 800;
    return input.format === "svg"
      ? { data: page(width, extra), width, height: 152, format: "svg" as const }
      : { data: new Uint8Array([1, 2, 3]), width, height: 152, format: input.format ?? ("png" as const) };
  };
  return { render: render as never, calls };
}

describe("renderMermaidWith: the probe render", () => {
  it("is the answer for an SVG: one render, the page width changed to the diagram's", async () => {
    const { render, calls } = fakeEngine();
    const out = await renderMermaidWith(render, "flowchart TD\nA-->B");
    expect(calls).toHaveLength(1);
    expect(out.width).toBe(332);
    expect(out.data).toBe(page(332));
  });

  it("is followed by a render at the diagram's width for a raster image", async () => {
    const { render, calls } = fakeEngine();
    const out = await renderMermaidWith(render, "flowchart TD\nA-->B", { format: "png" });
    expect(calls.map((c) => [c.width, c.format])).toEqual([
      [4096, "svg"],
      [332, "png"],
    ]);
    expect(out.width).toBe(332);
  });

  it("is followed by a second render when the page has a background (painted across the whole width)", async () => {
    const { render, calls } = fakeEngine();
    await renderMermaidWith(render, "flowchart TD\nA-->B", { background: "#fff" });
    expect(calls.map((c) => c.width)).toEqual([4096, 332]);
  });

  it("is followed by a second render when something else on the page is 4096 wide", async () => {
    const { render, calls } = fakeEngine('<rect width="4096" height="10"/>');
    await renderMermaidWith(render, "flowchart TD\nA-->B");
    expect(calls).toHaveLength(2);
  });

  it("is skipped when the width is given", async () => {
    const { render, calls } = fakeEngine();
    await renderMermaidWith(render, "flowchart TD\nA-->B", { width: 500 });
    expect(calls.map((c) => c.width)).toEqual([500]);
  });
});
