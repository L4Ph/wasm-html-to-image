import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { render, renderMermaid } from "wasm-html-to-image/single";

const GRAPH = "graph LR\n  A[開始] --> B{判定}\n  B -->|はい| C[完了]";

describe("renderMermaid", () => {
  it("returns SVG text, sized to the diagram, with the drawing as vector shapes", async () => {
    const { data } = await renderMermaid(GRAPH);
    expect(typeof data).toBe("string");
    expect(data).toContain("<svg");
    expect(data).toContain("<polygon"); // the diamond and the arrow heads
    expect(data).toContain("開始");
    const outer = /<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(data)!;
    expect(Number(outer[1])).toBeLessThan(700); // not the 4096 px probe width
    expect(Number(outer[2])).toBeGreaterThan(40);
  });

  it("widens left-right subgraph frames to hold a long title, without frames meeting", async () => {
    const src = [
      "flowchart LR",
      '  subgraph S1["A very long subgraph title that is much wider than its contents"]',
      "    A --> B",
      "  end",
      '  subgraph S2["Another quite long frame title for the second group"]',
      "    C --> D",
      "  end",
      "  B --> C",
    ].join("\n");
    const { data } = await renderMermaid(src);
    const frames = [...data.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="(?!26")[\d.]+" rx="2"/g)].map((m) => ({ x: +m[1], w: +m[3] }));
    const titles = [...data.matchAll(/<text x="([\d.]+)"[^>]*font-weight="600"[^>]*>([^<]+)/g)].map((m) => ({ x: +m[1], len: m[2].length }));
    expect(frames).toHaveLength(2);
    expect(frames[0].x + frames[0].w).toBeLessThan(frames[1].x); // side by side, not overlapping
    expect(titles[0].x + titles[0].len * 5.5).toBeLessThan(frames[0].x + frames[0].w); // the title fits in its frame
  });

  it("keeps accTitle and accDescr out of the picture and in the SVG", async () => {
    const plain = await renderMermaid(GRAPH, { format: "png" });
    const described = await renderMermaid(`graph LR\n  accTitle: 判定の流れ\n  accDescr {\n  開始から完了まで\n  }\n${GRAPH.split("\n").slice(1).join("\n")}`, { format: "png" });
    expect(Buffer.from(described.data).equals(Buffer.from(plain.data))).toBe(true);
    const svg = (await renderMermaid(`graph LR\n  accTitle: 判定の流れ\n${GRAPH.split("\n").slice(1).join("\n")}`)).data;
    expect(svg).toContain("開始");
    expect(svg).not.toContain("accTitle");
  });

  it("reports what the repair changed and what did not parse, through onWarning", async () => {
    const seen: { code: string; message: string }[] = [];
    await renderMermaid("flowchrt LR\n  A --> B\n  not a line", { mode: "recover", onWarning: (w) => seen.push(w) });
    expect(seen.filter((w) => w.code === "MERMAID_RECOVERED").map((w) => w.message)).toEqual(expect.arrayContaining([expect.stringContaining("flowchrt")]));
    expect(seen.every((w) => w.code === "MERMAID_RECOVERED")).toBe(true);

    const errors: { code: string; message: string }[] = [];
    await renderMermaid("flowchrt LR\n  A --> B", { onWarning: (w) => errors.push(w) });
    expect(errors).toEqual([expect.objectContaining({ code: "MERMAID_ERROR", message: expect.stringContaining("did you mean") })]);

    const none: unknown[] = [];
    await renderMermaid(GRAPH, { onWarning: (w) => none.push(w) });
    expect(none).toEqual([]);
  });

  it("refuses a diagram over the size limits, and maxLines / maxSourceBytes move them", async () => {
    const many = "graph TD\n" + Array.from({ length: 30 }, (_, k) => `  n${k} --> n${k + 1}`).join("\n");
    const seen: string[] = [];
    const refused = (await renderMermaid(many, { maxLines: 10, onWarning: (w) => seen.push(w.message) })).data;
    expect(refused).toContain("#cf222e"); // the error box
    expect(seen[0]).toContain("too many lines");
    expect((await renderMermaid(many, { maxLines: 0 })).data).not.toContain("#cf222e");
    expect((await renderMermaid(many, { maxSourceBytes: 40 })).data).toContain("#cf222e");
    expect((await renderMermaid(many)).data).not.toContain("#cf222e"); // the defaults are generous
  });

  it("encodes AVIF and JXL (the playground offers both)", async () => {
    const avif = (await renderMermaid(GRAPH, { format: "avif" })).data as Uint8Array;
    expect(Buffer.from(avif.subarray(4, 12)).toString("latin1")).toBe("ftypavif");
    const jxl = (await renderMermaid(GRAPH, { format: "jxl" })).data as Uint8Array;
    const naked = jxl[0] === 0xff && jxl[1] === 0x0a; // a bare codestream, or the ISO box container
    expect(naked || Buffer.from(jxl.subarray(4, 8)).toString("latin1") === "JXL ").toBe(true);
  });

  it("takes a named theme: its background on the page and its accent on the arrows", async () => {
    const nord = PNG.sync.read(Buffer.from((await renderMermaid(GRAPH, { format: "png", theme: "nord" })).data));
    expect([nord.data[0], nord.data[1], nord.data[2]]).toEqual([0x2e, 0x34, 0x40]);
    const svg = (await renderMermaid(GRAPH, { theme: "dracula" })).data;
    expect(svg.toLowerCase()).toContain("#bd93f9"); // the accent colours the arrow heads
    await expect(renderMermaid(GRAPH, { theme: "nope" as never })).rejects.toThrow(/unknown mermaid theme/);
  });

  it("forgives a misspelt keyword only in recover mode", async () => {
    const source = "flowchrt LR\n  A[開始] --> B[完了]";
    const strict = await renderMermaid(source);
    expect(strict.data).not.toContain("<polygon"); // the red error box, no arrow head
    const compat = await renderMermaid(source, { mode: "compat" });
    expect(compat.data).not.toContain("<polygon");
    const recovered = await renderMermaid(source, { mode: "recover" });
    expect(recovered.data).toContain("<polygon");
    expect(recovered.data).toContain("開始");
  });

  it("returns a PNG that is the size of the diagram, light and dark", async () => {
    const light = await renderMermaid(GRAPH, { format: "png" });
    const dark = await renderMermaid(GRAPH, { format: "png", theme: "dark" });
    const a = PNG.sync.read(Buffer.from(light.data));
    const b = PNG.sync.read(Buffer.from(dark.data));
    expect(a.width).toBeLessThan(700);
    expect(a.width).toBe(b.width);
    // the page takes the theme's background: white vs the official dark grey (#333333) in the corner
    expect(a.data[0]).toBeGreaterThan(240);
    expect(b.data[0]).toBeLessThan(60);
  });

  it("honours width, padding and an explicit background", async () => {
    const { data } = await renderMermaid("graph TD\n  A --> B", { format: "png", width: 300, padding: 0, background: "#ff0000" });
    const png = PNG.sync.read(Buffer.from(data));
    expect(png.width).toBe(300);
    expect([png.data[0], png.data[1], png.data[2]]).toEqual([255, 0, 0]);
  });

  it("escapes the source and shows a bad diagram as an error box", async () => {
    const { data } = await renderMermaid("graph LR\n  A[\"a < b & c\"] --> B");
    expect(data).toContain("a &lt; b &amp; c");
    const bad = await renderMermaid("zenuml", { format: "png" });
    const png = PNG.sync.read(Buffer.from(bad.data));
    let red = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i] > 180 && png.data[i + 1] < 80 && png.data[i + 2] < 80) red++;
    expect(red).toBeGreaterThan(20);
  });
});

describe("a diagram in HTML on a dark page", () => {
  const diagram = '<div class="mermaid">graph LR\n A --> B</div>';
  const fill = async (html: string) => ((await render({ value: html, width: 400, format: "svg" })).data as string).includes('fill="#1f2020"');

  it("takes the dark theme without a theme being named, and not on a light page", async () => {
    expect(await fill(`<body style="background:#111;color:#eee">${diagram}</body>`)).toBe(true);
    expect(await fill(`<body style="color:#eee">${diagram}</body>`)).toBe(true); // no background: light text decides
    expect(await fill(`<body style="background:#fff;color:#111">${diagram}</body>`)).toBe(false);
    expect(await fill(diagram)).toBe(false);
  });

  it("leaves a theme or a palette the page names alone", async () => {
    expect(await fill(`<body style="background:#111;color:#eee"><div style="--mermaid-theme:light">${diagram}</div></body>`)).toBe(false);
    expect(await fill(`<body style="background:#111;color:#eee"><div style="--mermaid-bg:#fff">${diagram}</div></body>`)).toBe(false);
  });
});

describe("frame titles longer than the frame's contents", () => {
  const T = "A very long frame title that is much wider than its contents";
  const width = async (src: string) => Number(/<svg[^>]*\bwidth="([\d.]+)"/.exec((await renderMermaid(src)).data)![1]);
  // the drawing is at least as wide as the title text (about 6 px a character at 12 px)
  const roomFor = (w: number) => expect(w).toBeGreaterThan(T.length * 6);

  it("widens a state composite, top-down and left-right", async () => {
    roomFor(await width(`stateDiagram-v2\n state "${T}" as S1 {\n  a --> b\n }\n [*] --> S1`));
    roomFor(await width(`stateDiagram-v2\n direction LR\n state "${T}" as S1 {\n  a --> b\n }\n [*] --> S1`));
  });

  it("widens a sequence box", async () => {
    roomFor(await width(`sequenceDiagram\n box ${T}\n participant A\n participant B\n end\n A->>B: hi`));
  });
});
