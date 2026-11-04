import { describe, expect, it } from "vitest";
import http from "node:http";
import { inflateSync } from "node:zlib";
import { render } from "wasm-html-to-image/single";
import { PNG } from "pngjs";

// Text-free pixel probes for layout/paint behaviors that were once broken.
// Each case renders a tiny document and samples pixel colors at known points,
// so no Chromium reference image is needed.

type Rgb = [number, number, number];

async function renderPng(body: string, width = 300, height = 200) {
  const html = `<html><body style="margin:0;background:#fff">${body}</body></html>`;
  const { data } = await render({ value: html, width, height, format: "png" });
  const img = PNG.sync.read(Buffer.from(data));
  const at = (x: number, y: number): Rgb => {
    const i = (img.width * y + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  return { img, at };
}

const isWhite = ([r, g, b]: Rgb) => r > 245 && g > 245 && b > 245;
const near = (a: Rgb, b: Rgb, tol = 12) =>
  a.every((v, i) => Math.abs(v - b[i]) <= tol);

const BLUE: Rgb = [0, 0, 255];
const RED: Rgb = [255, 0, 0];

// Local probe font (same Roboto as assets/02-typography.html). Text probes below
// compare rendered bytes, so the font only has to be stable, not reference-matched.
const PROBE_FONT_FACE =
  "@font-face{font-family:'RobotoProbe';src:url('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2') format('woff2')}";

// Variable Roboto (wght axis) and variable Roboto Flex (wdth axis). They are
// used by the font-variation-settings / font-stretch probes.
const VAR_PROBE_FONT_FACE =
  "@font-face{font-family:'RobotoVar';src:url('https://cdn.jsdelivr.net/npm/@fontsource-variable/roboto@5.3.0/files/roboto-latin-wght-normal.woff2') format('woff2')}";

const FLEX_PROBE_FONT_FACE =
  "@font-face{font-family:'RobotoFlex';src:url('https://cdn.jsdelivr.net/npm/@fontsource-variable/roboto-flex@5.3.0/files/roboto-flex-latin-wdth-normal.woff2') format('woff2')}";

// A family with a regular and a condensed face. The face is picked by the
// requested font-stretch. Only fonts that keep their width class in the OS/2
// table can be told apart (Google Fonts normalizes it to "normal").
const REGULAR_FONT_FACE =
  "@font-face{font-family:'StretchRegular';src:url('https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.3.0/files/roboto-latin-400-normal.woff2') format('woff2')}";

const CONDENSED_FONT_FACE =
  "@font-face{font-family:'StretchCondensed';src:url('https://cdn.jsdelivr.net/npm/@fontsource/pt-sans-narrow@5.3.0/files/pt-sans-narrow-latin-400-normal.woff2') format('woff2')}";

const STRETCH_PAIR_FONT_FACE =
  "@font-face{font-family:'StretchPair';src:url('https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.3.0/files/roboto-latin-400-normal.woff2') format('woff2')}" +
  "@font-face{font-family:'StretchPair';src:url('https://cdn.jsdelivr.net/npm/@fontsource/pt-sans-narrow@5.3.0/files/pt-sans-narrow-latin-400-normal.woff2') format('woff2')}";

async function renderProbeText(body: string, width = 800, fontFace = PROBE_FONT_FACE) {
  const html = `<html><head><style>${fontFace}</style></head><body style="margin:0;background:#fff">${body}</body></html>`;
  const { data } = await render({ value: html, width, format: "png" });
  return PNG.sync.read(Buffer.from(data));
}

const probeLine = (style: string, text: string, family = "'RobotoProbe'") =>
  `<div style="font-family:${family},sans-serif;font-size:60px;line-height:90px;color:#000;${style}">${text}</div>`;

// Right edge of the painted ink on every text line of a probe image. The probes
// below pin line-height, so the ink of line i lies in rows
// [i * lineHeight, (i + 1) * lineHeight). One entry per line that has ink.
function lineRightEdges(img: PNG, lineHeight: number) {
  const edges: number[] = [];
  for (let y0 = 0; y0 < img.height; y0 += lineHeight) {
    let right = -1;
    for (let y = y0; y < Math.min(y0 + lineHeight, img.height); y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (img.width * y + x) * 4;
        if (img.data[i + 3] > 0 && img.data[i] < 128) right = Math.max(right, x);
      }
    }
    if (right >= 0) edges.push(right + 1);
  }
  return edges;
}

// Spread (max - min) of the line lengths: the metric text-wrap-style: balance
// is supposed to reduce.
const lineEdgeSpread = (edges: number[]) =>
  Math.max(...edges) - Math.min(...edges);

// A red decoration line is anti-aliased against the white background, so a
// partially covered pixel still counts as red when it is clearly redder.
const isRedPixel = (img: PNG, x: number, y: number) => {
  const i = (img.width * y + x) * 4;
  const r = img.data[i];
  const g = img.data[i + 1];
  const b = img.data[i + 2];
  return r > 140 && r - g > 40 && r - b > 40;
};

// Row of the (red) decoration line and the number of red pixels on it.
const decorationLine = (img: PNG) => {
  let row = -1;
  let count = 0;
  for (let y = 0; y < img.height; y++) {
    let rowCount = 0;
    for (let x = 0; x < img.width; x++) if (isRedPixel(img, x, y)) rowCount++;
    if (rowCount > count) {
      count = rowCount;
      row = y;
    }
  }
  return { row, count };
};

// Total number of (red) decoration pixels, used when the decoration covers
// more than one row (a thick line, for instance).
const redPixels = (img: PNG) => {
  let count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) if (isRedPixel(img, x, y)) count++;
  }
  return count;
};

// One entry per ANMF (animation frame) chunk in a RIFF/WEBP container.
// The hash proves the sampled frames differ in pixel content; the rectangle
// is the region the encoder had to store (the part that changed).
type WebpFrame = {
  hash: number;
  x: number;
  y: number;
  width: number;
  height: number;
  duration: number;
};

function webpFrames(data: Uint8Array): WebpFrame[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fourcc = (o: number) =>
    String.fromCharCode(
      view.getUint8(o),
      view.getUint8(o + 1),
      view.getUint8(o + 2),
      view.getUint8(o + 3),
    );
  if (data.byteLength < 12 || fourcc(0) !== "RIFF" || fourcc(8) !== "WEBP") {
    return [];
  }
  // ANMF frame header: 24 bit frame x/y, width-1, height-1 and duration.
  const u24 = (o: number) =>
    view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
  const frames: WebpFrame[] = [];
  let o = 12;
  while (o + 8 <= data.byteLength) {
    const size = view.getUint32(o + 4, true);
    if (fourcc(o) === "ANMF") {
      let hash = 0;
      for (let i = o + 8; i < o + 8 + size && i < data.byteLength; i++) {
        hash = (hash * 31 + data[i]) >>> 0;
      }
      frames.push({
        hash,
        x: u24(o + 8) * 2,
        y: u24(o + 11) * 2,
        width: u24(o + 14) + 1,
        height: u24(o + 17) + 1,
        duration: u24(o + 20),
      });
    }
    o += 8 + size + (size & 1);
  }
  return frames;
}

// One 32-bit hash per ANMF (animation frame) chunk in a RIFF/WEBP container.
// Distinct hashes prove the sampled frames actually differ in pixel content.
function webpFrameHashes(data: Uint8Array): number[] {
  return webpFrames(data).map((frame) => frame.hash);
}

// ANIM chunk parameters of a RIFF/WEBP container:
//  - bgcolor   : canvas background colour (0xAARRGGBB)
//  - loopCount : number of animation repeats (0 = infinite)
// Returns null when the container carries no ANIM chunk (not animated).
function webpAnimParams(
  data: Uint8Array,
): { bgcolor: number; loopCount: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fourcc = (o: number) =>
    String.fromCharCode(
      view.getUint8(o),
      view.getUint8(o + 1),
      view.getUint8(o + 2),
      view.getUint8(o + 3),
    );
  let o = 12;
  while (o + 8 <= data.byteLength) {
    const size = view.getUint32(o + 4, true);
    if (fourcc(o) === "ANIM") {
      return {
        bgcolor: view.getUint32(o + 8, true),
        loopCount: view.getUint16(o + 12, true),
      };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

// A still encode of an animated document keeps the first sampled frame
// (progress 0): a still format can only carry a single frame.
async function renderFirstFrame(html: string, width: number, height: number) {
  const { data } = await render({
    value: html,
    width,
    height,
    format: "png",
    animation: { duration: 300, fps: 10 },
  });
  const img = PNG.sync.read(Buffer.from(data));
  return {
    img,
    at: (x: number, y: number): Rgb => {
      const i = (img.width * y + x) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    },
  };
}

// Bounding box and pixel count of the pixels matching the predicate. The
// offset-path probes below pin the position of a whole painted box, so a
// shifted or rotated box cannot slip through a single lucky sample.
function colorBox(
  img: PNG,
  match: (r: number, g: number, b: number) => boolean,
): { x0: number; y0: number; x1: number; y1: number; n: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (img.width * y + x) * 4;
      if (match(img.data[i], img.data[i + 1], img.data[i + 2])) {
        n++;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return n ? { x0, y0, x1, y1, n } : null;
}

const isReddish = (r: number, g: number, b: number) =>
  r > 120 && r - g > 40 && r - b > 40;
const isBluish = (r: number, g: number, b: number) =>
  b > 120 && b - r > 40 && b - g > 40;
const isBlackish = (r: number, g: number, b: number) =>
  r < 100 && g < 100 && b < 100;

// Minimal GIF LZW decoder (variable code size, clear / end codes) for the GIF probe.
function lzwDecode(data: number[], minCode: number): number[] {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let bits = minCode + 1;
  let table: number[][] = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([], []);
    bits = minCode + 1;
  };
  reset();
  const out: number[] = [];
  let acc = 0;
  let nbits = 0;
  let prev: number[] | undefined;
  for (const byte of data) {
    acc |= byte << nbits;
    nbits += 8;
    while (nbits >= bits) {
      const code = acc & ((1 << bits) - 1);
      acc >>= bits;
      nbits -= bits;
      if (code === clear) {
        reset();
        prev = undefined;
        continue;
      }
      if (code === eoi) return out;
      let entry: number[];
      if (code < table.length) entry = table[code];
      else if (prev) entry = [...prev, prev[0]];
      else return out;
      out.push(...entry);
      if (prev) table.push([...prev, entry[0]]);
      prev = entry;
      if (table.length === 1 << bits && bits < 12) bits++;
    }
  }
  return out;
}

// Splits a PDF into its objects (dictionary text + decoded stream) and checks the xref table.
function readPdfObjects(data: Uint8Array) {
  const b = Buffer.from(data);
  const text = b.toString("latin1");
  const startxref = Number(/startxref\s+(\d+)/.exec(text)![1]);
  expect(text.startsWith("xref", startxref)).toBe(true);
  const objects: { number: number; dict: string; stream?: string }[] = [];
  const re = /(\d+) 0 obj\n/g;
  const xref = /^(\d{10}) \d{5} ([nf]) $/gm;
  const entries: [number, string][] = [];
  for (let m; (m = xref.exec(text.slice(startxref))); ) entries.push([Number(m[1]), m[2]]);
  for (let m; (m = re.exec(text)); ) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endobj", start);
    const body = text.slice(start, end);
    const si = body.indexOf("\nstream\n");
    const dict = si >= 0 ? body.slice(0, si) : body;
    let stream: string | undefined;
    if (si >= 0) {
      const len = Number(/\/Length (\d+)/.exec(dict)![1]);
      const raw = b.subarray(start + si + 8, start + si + 8 + len);
      stream = /FlateDecode/.test(dict) ? inflateSync(raw).toString("latin1") : raw.toString("latin1");
    }
    objects.push({ number: Number(m[1]), dict, stream });
    expect(entries[Number(m[1])]).toEqual([m.index, "n"]);
  }
  return objects;
}

describe("regression: layout and paint probes", () => {
  it("column flex container with auto height honours min-height (flex-grow fills it)", async () => {
    const { at } = await renderPng(
      `<div style="display:flex;flex-direction:column;min-height:150px;width:100px">
         <div style="flex:1;background:#00f"></div></div>`,
    );
    expect(near(at(50, 140), BLUE)).toBe(true);
    expect(isWhite(at(50, 160))).toBe(true);
  });

  it("column flex container with auto height honours max-height", async () => {
    const { at } = await renderPng(
      `<div style="display:flex;flex-direction:column;max-height:80px;width:100px">
         <div style="height:200px;min-height:0;background:#00f"></div></div>`,
    );
    expect(near(at(50, 70), BLUE)).toBe(true);
    expect(isWhite(at(50, 100))).toBe(true);
  });

  it("fixed-height column flex item shrinks to its content minimum", async () => {
    const { at } = await renderPng(
      `<div style="display:flex;flex-direction:column;height:100px;width:100px">
         <div style="height:300px;background:#00f"></div></div>`,
    );
    expect(near(at(50, 90), BLUE)).toBe(true);
    expect(isWhite(at(50, 120))).toBe(true);
  });

  it("a flex item's auto-width wrapper sizes a width:100% image to the item, not its intrinsic width", async () => {
    // An auto-width block inside a flex item fills the item's content box (597px), so a
    // width:100% image is 597px wide, not its 800px intrinsic width. The min-content
    // contribution of a percentage-width replaced element is 0, which lets flex-shrink
    // bring the item down to the container instead of clamping it at the intrinsic width.
    const svg = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'><rect width='800' height='450' fill='#e68c28'/></svg>");
    const img = `<img src="${svg}" style="width:100%;display:block;aspect-ratio:800/450">`;
    const { at } = await renderPng(
      `<div style="display:flex;width:597px"><div style="flex:1"><div>${img}</div></div></div>`,
      700,
      500,
    );
    expect(near(at(580, 20), [230, 140, 40], 30)).toBe(true); // inside the 597px-wide image
    expect(isWhite(at(650, 20))).toBe(true); // at the 800px intrinsic width this would be painted
  });

  it("a column flex item's fit-content cross size ignores a cyclic width:100% child", async () => {
    // The flex line measures the item's cross size with content sizing, so the containing
    // block width is indefinite. A width:100% child is cyclic there and must behave as auto
    // (its own content size), not resolve against the 600px available width. Otherwise the
    // item is always as wide as the container and cannot be centred/shrunk. The second case
    // adds the GitHub hero shape: the percentage child is a grid whose fr tracks have to be
    // sized from their spanning item's max-content contribution under the same constraint.
    const blueAt = 300;
    const whiteAt = 50;
    const cases = [
      `<div style="width:100%"><div style="width:200px;height:20px;background:#00f"></div></div>`,
      `<div style="width:100%;display:grid;grid-template-columns:repeat(2,minmax(0px,1fr));column-gap:20px">
         <div style="grid-column:auto / span 2;width:200px;height:20px;background:#00f"></div></div>`,
    ];
    for (const child of cases) {
      const { at } = await renderPng(
        `<div style="display:flex;flex-direction:column;align-items:center;width:600px">
           <div style="padding:0 20px">${child}</div></div>`,
        700,
        60,
      );
      expect(near(at(blueAt, 10), BLUE), child).toBe(true); // item content starts at (600-240)/2+20
      expect(isWhite(at(whiteAt, 10)), child).toBe(true); // no longer painted at the container edge
    }
  });

  it("aspect-ratio gives a replaced element's auto height, overriding the intrinsic ratio", async () => {
    // GitHub's hero media is <img style="width:100%;aspect-ratio:1206/684">. The ratio has to
    // size the box even when the intrinsic ratio differs, and even when the image cannot be
    // decoded at all (an unavailable source has no intrinsic ratio to fall back to).
    // The first image is a transparent 800x450 SVG shown as a 1:1 box (200x200), the second is
    // an undecodable PNG with a 2:1 box (200x100). Both paint their blue background.
    const svg =
      "data:image/svg+xml," +
      encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'></svg>");
    const { at } = await renderPng(
      `<div style="width:200px">
         <img style="display:block;width:100%;aspect-ratio:1/1;background:#00f" src="${svg}" alt="">
         <img style="display:block;width:100%;aspect-ratio:2/1;background:#00f" src="data:image/png;base64,aGVsbG8=" alt="">
       </div>`,
      300,
      400,
    );
    expect(near(at(100, 150), BLUE)).toBe(true); // inside the 1:1 box (112px tall without the fix)
    expect(near(at(100, 250), BLUE)).toBe(true); // inside the 2:1 box (0px tall without the fix)
    expect(isWhite(at(100, 350))).toBe(true); // no stray height below both boxes
  });

  it("radial-gradient(circle <length>) draws and clamps to the last stop outside the radius", async () => {
    const { at } = await renderPng(
      `<div style="width:150px;height:100px;background:radial-gradient(circle 40px,#f00,#00f)"></div>`,
    );
    const [r, , b] = at(75, 50);
    expect(r).toBeGreaterThan(b); // red-ish center
    expect(near(at(5, 5), BLUE, 20)).toBe(true); // beyond the 40px radius
  });

  it("mask-size tiles the mask image", async () => {
    const { at } = await renderPng(
      `<div style="width:100px;height:100px;background:#00f;
         mask-image:linear-gradient(#000 50%,transparent 50%);mask-size:100px 20px"></div>`,
    );
    expect(near(at(50, 5), BLUE)).toBe(true);
    expect(isWhite(at(50, 15))).toBe(true);
    expect(near(at(50, 25), BLUE)).toBe(true);
    expect(isWhite(at(50, 35))).toBe(true);
  });

  it("display:flow-root contains floats and keeps child margins inside", async () => {
    const { at } = await renderPng(
      `<div style="display:flow-root;background:#00f;width:100px">
         <div style="float:left;width:50px;height:40px;background:#f00"></div>
         <div style="margin-top:20px;height:10px"></div></div>
       <div style="height:10px;background:#0f0;width:100px"></div>`,
      300,
      100,
    );
    expect(near(at(80, 10), BLUE)).toBe(true); // child margin-top stays inside the container
    expect(near(at(10, 30), RED)).toBe(true); // float is inside the container box
    expect(near(at(80, 30), BLUE)).toBe(true); // container grew to the float height (40px)
    expect(near(at(80, 45), [0, 255, 0])).toBe(true); // following block starts after the float
  });

  it("max-lines clamps any block container and block-ellipsis controls the marker", async () => {
    const text = "WWWW WWWW WWWW WWWW WWWW WWWW WWWW WWWW";
    const row = (img: PNG, y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i] < 128 && img.data[i + 3] > 0) n++;
        }
      return n;
    };
    const css = "width:100px;font:bold 20px/20px sans-serif;color:#000";
    const free = await renderPng(`<div style="${css}">${text}</div>`, 120, 120);
    const clamped = await renderPng(`<div style="${css};max-lines:2">${text}</div>`, 120, 120);
    const bare = await renderPng(`<div style="${css};max-lines:2;block-ellipsis:no-ellipsis">${text}</div>`, 120, 120);
    expect(row(free.img, 40, 120)).toBeGreaterThan(0);
    expect(row(clamped.img, 40, 120)).toBe(0); // nothing past line 2
    expect(row(clamped.img, 20, 40)).toBeGreaterThan(0);
    expect(row(clamped.img, 20, 40)).not.toBe(row(bare.img, 20, 40)); // ellipsis marker differs
  });

  it("stroke-linejoin shapes the text-stroke corners (miter reaches farther than round)", async () => {
    const renderCase = async (join: string) => {
      const { img } = await renderPng(
        `<div style="font:bold 60px/80px sans-serif;color:#fff;-webkit-text-stroke:8px #000;${join}">W</div>`,
        100,
        90,
      );
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) n++;
      return n;
    };
    const round = await renderCase("");
    const miter = await renderCase("stroke-linejoin:miter");
    const bevel = await renderCase("stroke-linejoin:bevel");
    expect(miter).toBeGreaterThan(round);
    expect(bevel).toBeLessThan(round);
  });

  it("clip-rule: evenodd punches the overlap of a self-overlapping clip-path polygon", async () => {
    const poly = "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, 25% 25%, 75% 25%, 75% 75%, 25% 75%, 25% 25%)";
    const nonzero = await renderPng(
      `<div style="width:80px;height:80px;background:#00f;clip-path:${poly}"></div>`,
      100,
      100,
    );
    const evenodd = await renderPng(
      `<div style="width:80px;height:80px;background:#00f;clip-path:${poly};clip-rule:evenodd"></div>`,
      100,
      100,
    );
    expect(near(nonzero.at(40, 40), BLUE)).toBe(true);
    expect(isWhite(evenodd.at(40, 40))).toBe(true);
    expect(near(evenodd.at(5, 5), BLUE)).toBe(true);
  });

  it("animated APNG / GIF carry the sampled frames, loop count and valid image data", async () => {
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;
    const animation = { duration: 300, fps: 10, loop: 3 };

    // --- APNG: acTL / fcTL / fdAT chunk structure; plain PNG decoders show frame 0.
    const apng = await render({ value: html, width: 120, height: 120, format: "apng", animation });
    expect(apng.animation).toBe(true);
    const png = Buffer.from(apng.data as Uint8Array);
    const chunks: string[] = [];
    let actl: { frames: number; plays: number } | undefined;
    for (let pos = 8; pos < png.length; ) {
      const len = png.readUInt32BE(pos);
      const type = png.toString("latin1", pos + 4, pos + 8);
      chunks.push(type);
      if (type === "acTL") actl = { frames: png.readUInt32BE(pos + 8), plays: png.readUInt32BE(pos + 12) };
      pos += 12 + len;
    }
    expect(actl?.frames).toBeGreaterThan(1);
    expect(actl?.plays).toBe(3);
    expect(chunks.filter((c) => c === "fcTL").length).toBe(actl!.frames);
    expect(chunks.filter((c) => c === "fdAT").length).toBe(actl!.frames - 1);
    expect(chunks[chunks.length - 1]).toBe("IEND");
    const first = PNG.sync.read(png);
    expect([first.width, first.height]).toEqual([120, 120]);

    // A single frame (no animation option) degrades to a plain PNG.
    const stillPng = await render({ value: html, width: 120, height: 120, format: "apng" });
    expect(stillPng.animation).toBeFalsy();
    expect(Buffer.from(stillPng.data as Uint8Array).includes("acTL")).toBe(false);

    // --- GIF: header, NETSCAPE loop (plays - 1), one image descriptor per frame.
    const gif = await render({ value: html, width: 120, height: 120, format: "gif", animation });
    expect(gif.animation).toBe(true);
    const g = Buffer.from(gif.data as Uint8Array);
    expect(g.toString("latin1", 0, 6)).toBe("GIF89a");
    expect([g.readUInt16LE(6), g.readUInt16LE(8)]).toEqual([120, 120]);
    const tableLen = 3 * (1 << ((g[10] & 7) + 1));
    let pos = 13 + tableLen;
    let loop = -1;
    let frameCount = 0;
    let firstFrame: number[] | undefined;
    while (pos < g.length && g[pos] !== 0x3b) {
      if (g[pos] === 0x21) {
        if (g[pos + 1] === 0xff) loop = g.readUInt16LE(pos + 16);
        pos += 2;
        while (g[pos] !== 0) pos += g[pos] + 1;
        pos += 1;
      } else {
        expect(g[pos]).toBe(0x2c);
        frameCount++;
        const minCode = g[pos + 10];
        pos += 11;
        const data: number[] = [];
        while (g[pos] !== 0) {
          data.push(...g.subarray(pos + 1, pos + 1 + g[pos]));
          pos += g[pos] + 1;
        }
        pos += 1;
        if (!firstFrame) firstFrame = lzwDecode(data, minCode);
      }
    }
    expect(g[g.length - 1]).toBe(0x3b);
    expect(frameCount).toBeGreaterThan(1);
    expect(loop).toBe(2);
    expect(firstFrame?.length).toBe(120 * 120);
    // Frame 0 is fully faded out (opacity 0): white background everywhere.
    const white = firstFrame![60 * 120 + 60];
    expect(firstFrame!.every((v) => v === white)).toBe(true);

    const stillGif = await render({ value: html, width: 120, height: 120, format: "gif" });
    expect(stillGif.animation).toBeFalsy();
    expect(Buffer.from(stillGif.data as Uint8Array).includes("NETSCAPE")).toBe(false);
  });

  it("pdf + colorSpace cmyk rewrites colors and images to DeviceCMYK", async () => {
    const page = `<body style="margin:0"><div style="width:100px;height:40px;background:#0000ff"></div>
      <div style="width:100px;height:40px;background:linear-gradient(90deg,#f00,#00f)"></div>
      <p style="color:#c33;margin:0;font-size:20px">Print</p></body>`;
    const cmyk = await render({ value: page, width: 200, format: "pdf", colorSpace: "cmyk" });
    expect(Buffer.from(cmyk.data as Uint8Array).toString("latin1", 0, 5)).toBe("%PDF-");
    const objects = readPdfObjects(cmyk.data as Uint8Array);
    for (const o of objects) {
      expect(o.dict).not.toMatch(/DeviceRGB/);
      // No RGB color operators survive in any content stream.
      if (o.stream && !/Subtype \/Image/.test(o.dict) && !/Length1/.test(o.dict)) {
        expect(o.stream).not.toMatch(/(^|\s)(rg|RG)(\s|$)/);
      }
    }
    const content = objects.map((o) => o.stream ?? "").join("\n");
    expect(content).toContain("1 1 0 0 k"); // #0000ff
    expect(content).toMatch(/0 \.?\d+ \.?\d+ \.?\d+ k/); // text #c33: no cyan
    const image = objects.find((o) => /Subtype \/Image/.test(o.dict) && /DeviceCMYK/.test(o.dict));
    expect(image).toBeDefined();
    // The rewritten dictionary keeps its keys intact (a name must end at its own token).
    expect(image!.dict).toMatch(/\/ColorSpace \/DeviceCMYK\s*\/BitsPerComponent 8\s*\/Filter \/FlateDecode\s*\/Length \d+>>/);
  });
  it("corner-shape reshapes the border-radius corners of backgrounds and borders", async () => {
    const box = async (shape: string, extra = "") =>
      renderPng(
        `<div style="width:80px;height:80px;background:#00f;border-radius:40px;${shape ? `corner-shape:${shape};` : ""}${extra}"></div>`,
        100,
        100,
      );
    const round = await box("");
    const bevel = await box("bevel");
    const scoop = await box("scoop");
    const notch = await box("notch");
    const squircle = await box("squircle");
    const square = await box("square");
    // (12,12): inside the round arc, outside bevel / scoop / notch.
    expect(near(round.at(12, 12), BLUE)).toBe(true);
    for (const s of [bevel, scoop, notch]) expect(isWhite(s.at(12, 12))).toBe(true);
    // (30,30): only the notch has removed it.
    for (const s of [round, bevel, scoop]) expect(near(s.at(30, 30), BLUE)).toBe(true);
    expect(isWhite(notch.at(30, 30))).toBe(true);
    // (8,8): inside the superellipse but outside the circle.
    expect(isWhite(round.at(8, 8))).toBe(true);
    expect(near(squircle.at(8, 8), BLUE)).toBe(true);
    // `square` keeps the ordinary right-angled corner.
    expect(near(square.at(1, 1), BLUE)).toBe(true);
    // Four values apply per corner (top-left, top-right, bottom-right, bottom-left).
    const mixed = await box("notch round round round");
    expect(isWhite(mixed.at(30, 30))).toBe(true);
    expect(near(mixed.at(70, 30), BLUE)).toBe(true);

    // The border follows the shaped outline: the notched corner has no border either.
    const bordered = await renderPng(
      `<div style="width:72px;height:72px;border:4px solid #f00;background:#00f;border-radius:20px;corner-shape:notch"></div>`,
      100,
      100,
    );
    expect(near(bordered.at(2, 40), RED)).toBe(true); // left edge
    expect(near(bordered.at(40, 2), RED)).toBe(true); // top edge
    expect(isWhite(bordered.at(8, 8))).toBe(true); // notched-out corner
  });

  it("display:table-header-group / table-footer-group rows render and are ordered header-first, footer-last", async () => {
    const cell = (c: string) => `<tr><td style="background:${c};height:30px;width:100px"></td></tr>`;
    const GREEN: Rgb = [0, 255, 0];
    // Explicit header group (used to collapse the whole table to nothing).
    const header = await renderPng(
      `<table style="border-collapse:collapse"><thead style="display:table-header-group">${cell("#f00")}</thead><tbody>${cell("#0f0")}</tbody></table>`,
      200,
      100,
    );
    expect(near(header.at(20, 10), RED)).toBe(true);
    expect(near(header.at(20, 40), GREEN)).toBe(true);
    // The header group comes first and the footer group last whatever the source order.
    const reordered = await renderPng(
      `<table style="border-collapse:collapse"><tfoot style="display:table-footer-group">${cell("#00f")}</tfoot><tbody>${cell("#0f0")}</tbody><thead style="display:table-header-group">${cell("#f00")}</thead></table>`,
      200,
      100,
    );
    expect(near(reordered.at(20, 10), RED)).toBe(true);
    expect(near(reordered.at(20, 40), GREEN)).toBe(true);
    expect(near(reordered.at(20, 70), BLUE)).toBe(true);
    // The same structure built from plain elements.
    const divs = await renderPng(
      `<div style="display:table"><div style="display:table-header-group"><div style="display:table-row"><div style="display:table-cell;background:#f00;height:30px;width:100px"></div></div></div><div style="display:table-row-group"><div style="display:table-row"><div style="display:table-cell;background:#0f0;height:30px"></div></div></div></div>`,
      200,
      100,
    );
    expect(near(divs.at(20, 10), RED)).toBe(true);
    expect(near(divs.at(20, 40), GREEN)).toBe(true);
  });

  it("<col> / <colgroup> backgrounds paint under the table rows", async () => {
    const col = await renderPng(
      `<table style="border-collapse:collapse"><colgroup style="background:#ff0"><col style="background:#f0f;width:60px"><col style="background:#0ff;width:60px"></colgroup><tr><td style="height:30px"></td><td></td></tr><tr><td style="height:30px"></td><td></td></tr></table>`,
      200,
      100,
    );
    expect(near(col.at(20, 10), [255, 0, 255])).toBe(true);
    expect(near(col.at(20, 50), [255, 0, 255])).toBe(true);
    expect(near(col.at(90, 10), [0, 255, 255])).toBe(true);
    expect(isWhite(col.at(20, 80))).toBe(true);
  });

  it("box-decoration-break: clone repaints a complete box on each PDF page; slice is the default", async () => {
    const doc = (style: string, height: number) =>
      `<html><head><style>@page{size:300px 200px;margin:0}</style></head><body style="margin:0">` +
      `<div style="margin:20px;border:6px solid #c00;border-radius:24px;background:#9cf;padding:10px;height:${height}px;${style}">x</div></body></html>`;
    const pdf = async (style: string, height: number) =>
      Buffer.from((await render({ value: doc(style, height), width: 300, format: "pdf" })).data as Uint8Array);

    const plain = await pdf("", 300);
    const slice = await pdf("box-decoration-break:slice", 300);
    const clone = await pdf("box-decoration-break:clone", 300);
    const webkitClone = await pdf("-webkit-box-decoration-break:clone", 300);
    expect(slice.equals(plain)).toBe(true); // slice is the existing behaviour
    expect(clone.equals(plain)).toBe(false); // each fragment is decorated as a whole box
    expect(webkitClone.equals(clone)).toBe(true);

    // A box that fits on one page has no fragments: clone changes nothing.
    const smallPlain = await pdf("", 80);
    const smallClone = await pdf("box-decoration-break:clone", 80);
    expect(smallClone.equals(smallPlain)).toBe(true);
  });

  it("PDF page breaks see through the whitespace between a wrapper's blocks (pretty-printed markup)", async () => {
    // 120px of paragraphs, then a 100px break-inside:avoid block that straddles the 200px page cut.
    // The wrapper only groups blocks, so the avoid must be honoured whether or not the markup has
    // newlines between them; whitespace text used to make the whole wrapper one unbreakable unit.
    const blocks = [
      `<p style="margin:0;height:120px;background:#9cf">a</p>`,
      `<pre style="margin:0;height:100px;background:#fc9;break-inside:avoid">b</pre>`,
    ];
    const doc = (sep: string) =>
      `<html><head><style>@page{size:300px 200px;margin:0}</style></head><body style="margin:0"><article style="padding:0">${sep}${blocks.join(sep)}${sep}</article></body></html>`;
    // Compare whole files minus the creation/modification dates and the trailer ID.
    const pdf = async (html: string) =>
      Buffer.from((await render({ value: html, width: 300, format: "pdf" })).data as Uint8Array)
        .toString("latin1")
        .replace(/\/(CreationDate|ModDate)\s*\([^)]*\)/g, "")
        .replace(/\/ID\s*\[[^\]]*\]/g, "");
    await pdf(doc("")); // warm-up: a process' first PDF embeds its fonts differently from later ones
    const tight = await pdf(doc(""));
    expect(await pdf(doc("\n  "))).toBe(tight);
    // ... and the avoid really moved the block to page 2: the pages differ from a no-avoid run.
    expect(await pdf(doc("").replace(";break-inside:avoid", ""))).not.toBe(tight);
  });

  it("PDF break-inside: avoid cuts at the border-box top of a padded block, not at its content", async () => {
    // A 100px box (20px padding + 60px content) straddles the 200px page cut. The cut must be the
    // box's top edge (120px): at its content top (140px) the 20px of top padding stayed behind as a
    // grey sliver on page 1.
    const html =
      `<html><head><style>@page{size:300px 200px;margin:0}</style></head><body style="margin:0">` +
      `<p style="margin:0;height:120px;background:#9cf">a</p>` +
      `<pre style="margin:0;padding:20px;height:60px;background:#fc9;break-inside:avoid">b</pre></body></html>`;
    const data = Buffer.from((await render({ value: html, width: 300, format: "pdf" })).data as Uint8Array);
    const text = data.toString("latin1");
    const firstPage = /\/Contents (\d+) 0 R/.exec(text)![1];
    const at = text.indexOf(`\n${firstPage} 0 obj\n`);
    const start = text.indexOf("stream\n", at) + 7;
    const content = inflateSync(data.subarray(start, text.indexOf("\nendstream", start))).toString("latin1");
    // The page clip is in points (0.75 per px): 120px = 90pt.
    expect(/^0 0 225 (\d+(?:\.\d+)?) re$/m.exec(content)![1]).toBe("90");
  });

  it("text-fit: shrink / grow scale the font so the widest line fits the container", async () => {
    const extent = async (style: string, text: string) => {
      const { img } = await renderPng(
        `<div style="width:200px;font:bold 40px/50px sans-serif;color:#000;white-space:nowrap;${style}">${text}</div>`,
        400,
        80,
      );
      let max = -1;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i] < 128) max = Math.max(max, x);
        }
      return max;
    };
    const long = "Hello World Wide Web";
    expect(await extent("", long)).toBeGreaterThan(250); // overflows without text-fit
    const shrunk = await extent("text-fit:shrink", long);
    expect(shrunk).toBeLessThan(205);
    expect(shrunk).toBeGreaterThan(150); // fitted, not collapsed
    expect(await extent("text-fit:grow", long)).toBeGreaterThan(250); // grow never shrinks
    const short = "Hi";
    expect(await extent("", short)).toBeLessThan(100);
    const grown = await extent("text-fit:grow", short);
    expect(grown).toBeGreaterThan(150);
    expect(grown).toBeLessThan(205);
    expect(await extent("text-fit:shrink", short)).toBeLessThan(100); // shrink never grows
    // A percentage limit bounds the scale (50% of the font size at the least).
    expect(await extent("text-fit:shrink 90%", long)).toBeGreaterThan(shrunk);
  });

  it("<img> decodes JPEG XL (data URL) and image input accepts raw JXL bytes", async () => {
    const jxl = (
      await render({
        value: `<body style="margin:0"><div style="width:40px;height:40px;background:#f00"></div></body>`,
        width: 40,
        height: 40,
        format: "jxl",
        quality: 100,
      })
    ).data as Uint8Array;
    const b64 = Buffer.from(jxl).toString("base64");
    const { at } = await renderPng(
      `<img src="data:image/jxl;base64,${b64}" width="80" height="80">`,
      100,
      100,
    );
    expect(near(at(40, 40), RED)).toBe(true);
    expect(isWhite(at(95, 95))).toBe(true);

    const fromBytes = await render({ value: jxl, width: 40, format: "png" });
    const png = PNG.sync.read(Buffer.from(fromBytes.data as Uint8Array));
    expect([png.width, png.height]).toEqual([40, 40]);
    expect(near([png.data[0], png.data[1], png.data[2]] as Rgb, RED)).toBe(true);
  });

  it("corner-shape: superellipse(), per-corner longhands, box-shadow and dashed borders follow the shape", async () => {
    const box = (style: string, outer = "") =>
      renderPng(
        `<div style="margin:20px;width:80px;height:80px;background:#00f;border-radius:40px;${style}"></div>${outer}`,
        140,
        140,
      );
    // superellipse(1) is a straight bevel, superellipse(2) is the squircle, superellipse(1) != round.
    const bevel = await box("corner-shape:superellipse(0)");
    expect(isWhite(bevel.at(32, 32))).toBe(true); // x+y < radius box diagonal: cut away
    const squircle = await box("corner-shape:squircle");
    const super2 = await box("corner-shape:superellipse(2)");
    expect(near(squircle.at(28, 28), BLUE)).toBe(true);
    expect(near(super2.at(28, 28), BLUE)).toBe(true);
    // Longhands set one corner.
    const longhand = await box("corner-top-left-shape:notch");
    expect(isWhite(longhand.at(30, 30))).toBe(true); // top-left notched
    expect(near(longhand.at(85, 45), BLUE)).toBe(true); // top-right still round
    // Outer box-shadow follows the notch: the shadow is absent where the corner was cut away.
    const shadow = await box("border-radius:20px;corner-shape:notch;box-shadow:0 0 0 6px #f00");
    expect(near(shadow.at(17, 60), RED)).toBe(true); // edge shadow
    expect(isWhite(shadow.at(24, 24))).toBe(true); // notched corner region has neither box nor shadow
    // A dashed border on a shaped box leaves gaps (not a solid ring).
    const dashed = await box("box-sizing:border-box;border:4px dashed #f00;background:none;corner-shape:bevel;border-radius:20px");
    let red = 0;
    let gap = 0;
    for (let x = 28; x < 100; x++) (near(dashed.at(x, 21), RED, 60) ? red++ : gap++);
    expect(red).toBeGreaterThan(5);
    expect(gap).toBeGreaterThan(5);
  });

  it("every @keyframes block animates its own elements (several animations, class selectors)", async () => {
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0.1 } to { opacity: 1 } }
      @keyframes tint { from { background-color: #f00 } to { background-color: #00f } }
      .a { width: 40px; height: 40px; background: #000; animation: fade 400ms infinite; }
      .b { width: 40px; height: 40px; animation: tint 400ms infinite; }
    </style></head><body style="margin:0;background:#fff">
      <div class="a"></div><div class="a" style="margin-top:10px"></div><div class="b" style="margin-top:10px"></div>
    </body></html>`;
    const r = await render({ value: html, width: 60, height: 150, format: "webp", animation: { duration: 400, fps: 10 } });
    expect(r.animation).toBe(true);
    const frames = webpFrameHashes(new Uint8Array(r.data as Uint8Array));
    expect(frames.length).toBeGreaterThan(2);
    // The still render of the first frame already reflects both animations at progress 0.
    const first = await renderFirstFrame(html, 60, 150);
    expect(first.at(10, 10)[0]).toBeGreaterThan(180); // .a faded (10% black over white)
    expect(first.at(10, 60)[0]).toBeGreaterThan(180); // second .a (same keyframes, second element)
    expect(near(first.at(10, 110), RED)).toBe(true); // .b starts red
  });

  it("an animated colour reaches nested descendants that inherit it", async () => {
    const html = `<html><head><style>
      @keyframes ink { from { color: #f00 } to { color: #00f } }
      p { margin: 0; font: bold 40px/40px sans-serif; color: #000; animation: ink 400ms infinite; }
      em { font-style: normal; }
    </style></head><body style="margin:0;background:#fff"><p>III<em>III</em></p></body></html>`;
    const { img } = await renderFirstFrame(html, 120, 50);
    let redInEm = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 45; x < 110; x++) {
        const i = (img.width * y + x) * 4;
        if (img.data[i] > 200 && img.data[i + 1] < 80 && img.data[i + 2] < 80) redInEm++;
      }
    expect(redInEm).toBeGreaterThan(20); // the <em> glyph is red (it used to stay black)
  });

  describe("text controls: align-last, justify, line-break, hyphens, tab-size, grid, fonts", () => {
    const inkRight = (img: PNG, y0: number, y1: number) => {
      let max = -1;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < img.width; x++) if (img.data[(img.width * y + x) * 4] < 128) max = Math.max(max, x);
      return max;
    };
    const line = async (style: string, text: string, boxWidth: number, tag = "div") => {
      const { img } = await renderPng(
        `<${tag} style="margin:0;width:${boxWidth}px;font:16px/20px sans-serif;color:#000;${style}">${text}</${tag}>`,
        300,
        80,
      );
      return inkRight(img, 0, 20);
    };

    it("text-align-last positions the last line", async () => {
      const left = await line("", "ab cd", 160);
      expect(await line("text-align-last:right", "ab cd", 160)).toBeGreaterThan(left + 80);
      const center = await line("text-align-last:center", "ab cd", 160);
      expect(center).toBeGreaterThan(left + 30);
      expect(center).toBeLessThan(140);
      expect(await line("text-align:justify;text-align-last:justify", "ab cd", 160)).toBeGreaterThan(150);
      expect(await line("text-align:justify", "ab cd", 160)).toBeLessThan(left + 5); // last line stays start-aligned
    });

    it("text-justify: none disables justify, inter-word skips CJK, inter-character spreads it", async () => {
      const t = "aa bb cc dd ee ff gg hh ii jj kk ll mm";
      expect(await line("text-align:justify", t, 130)).toBe(130);
      expect(await line("text-align:justify;text-justify:none", t, 130)).toBeLessThan(125);
      expect(await line("text-align:justify;text-justify:inter-word", t, 130)).toBe(130);
      const cjk = "あいうえおかきくけこさしすせそたちつてと";
      const plain = await line("", cjk, 98);
      expect(await line("text-align:justify;text-justify:inter-word", cjk, 98)).toBe(plain); // no spaces to stretch
      expect(await line("text-align:justify;text-justify:inter-character", cjk, 98)).toBeGreaterThan(plain);
    });

    it("line-break: strict keeps small kana attached, loose allows iteration marks, anywhere breaks Latin", async () => {
      const small = "あいうえゃおかき";
      const mark = "あいうえ々おかき";
      expect(await line("", small, 64)).toBeGreaterThan(55); // small kana may start a line (normal)
      expect(await line("line-break:strict", small, 64)).toBeLessThan(50);
      expect(await line("", mark, 64)).toBeLessThan(50); // iteration mark may not start a line
      expect(await line("line-break:loose", mark, 64)).toBeGreaterThan(55);
      expect(await line("", "abcdefghijklmnop", 64)).toBeGreaterThan(100);
      expect(await line("line-break:anywhere", "abcdefghijklmnop", 64)).toBeLessThan(65);
    });

    it("hyphens / hyphenate-character: a soft hyphen shows a hyphen only at the line end", async () => {
      const wide = await line("", "extra&shy;ordinary", 300);
      expect(wide).toBe(await line("", "extraordinary", 300)); // invisible inside a line
      const broken = await line("hyphens:manual", "extra&shy;ordinary", 70);
      expect(broken).toBe(await line("", "extra-ordinary", 70)); // hyphen drawn after "extra"
      const none = await line("hyphens:none", "extra&shy;ordinary", 70);
      expect(none).toBeLessThan(broken); // no hyphen shown
      expect(await line("-webkit-hyphens:none", "extra&shy;ordinary", 70)).toBe(none);
      // hyphenate-character replaces the hyphen
      const star = await line("hyphenate-character:'**'", "extra&shy;ordinary", 70);
      expect(star).toBeGreaterThan(broken);
      // hyphens: auto hyphenates English words (lang=en) at the line end
      const auto = await renderPng(
        `<div lang="en" style="margin:0;width:60px;font:16px/20px sans-serif;color:#000;hyphens:auto">extraordinary</div>`,
        120,
        80,
      );
      expect(inkRight(auto.img, 0, 20)).toBeLessThan(62); // wrapped onto several lines
      const noLang = await renderPng(
        `<div style="margin:0;width:60px;font:16px/20px sans-serif;color:#000;hyphens:auto">extraordinary</div>`,
        120,
        80,
      );
      expect(inkRight(noLang.img, 0, 20)).toBeGreaterThan(90); // no lang: no automatic hyphenation
    });

    it("tab-size sets the tab stop width (number of spaces or a length)", async () => {
      const tab = (style: string) => line(`white-space:pre;font-family:monospace;${style}`, "a\tb", 300);
      const d = await tab("");
      expect(await tab("tab-size:2")).toBeLessThan(d - 20);
      expect(await tab("tab-size:40px")).toBeLessThan(d);
      expect(await tab("tab-size:40px")).toBeGreaterThan(40);
    });

    it("grid-template / grid shorthands expand to the longhands", async () => {
      const cell = (c: string) => `<div style="background:${c}"></div>`;
      const cells = cell("#f00") + cell("#0f0") + cell("#00f") + cell("#ff0");
      const a = await renderPng(`<div style="display:grid;grid-template:60px 40px / 100px 80px">${cells}</div>`, 200, 120);
      expect(near(a.at(10, 10), RED)).toBe(true);
      expect(near(a.at(150, 10), [0, 255, 0])).toBe(true);
      expect(near(a.at(10, 80), BLUE)).toBe(true);
      expect(near(a.at(150, 80), [255, 255, 0])).toBe(true);
      expect(isWhite(a.at(190, 10))).toBe(true); // columns are 100 + 80
      // template areas with row sizes
      const areas = await renderPng(
        `<div style="display:grid;grid:'h h' 30px 'm s' 50px / 60px 90px;">
           <div style="grid-area:h;background:#f00"></div><div style="grid-area:m;background:#0f0"></div><div style="grid-area:s;background:#00f"></div></div>`,
        200,
        120,
      );
      expect(near(areas.at(140, 10), RED)).toBe(true); // header spans both columns
      expect(near(areas.at(10, 50), [0, 255, 0])).toBe(true);
      expect(near(areas.at(100, 50), BLUE)).toBe(true);
      // grid: auto-flow
      const flow = await renderPng(
        `<div style="display:grid;grid:auto-flow 30px / 50px 50px">${cells}</div>`,
        200,
        120,
      );
      expect(near(flow.at(10, 10), RED)).toBe(true);
      expect(near(flow.at(70, 10), [0, 255, 0])).toBe(true);
      expect(near(flow.at(10, 40), BLUE)).toBe(true);
    });

    it("font-synthesis: none stops the synthetic bold / italic", async () => {
      const ink = async (style: string) => {
        // The regular-only Noto Sans JP as fallback: the default (variable) one would stand in
        // for the synthetic bold with a real bold.
        const { data } = await render({
          value: `<html><body style="margin:0;background:#fff"><div style="font:bold italic 40px/50px 'RobotoProbe';color:#000;${style}">HHH</div><style>${PROBE_FONT_FACE}</style></body></html>`,
          width: 200,
          height: 60,
          format: "png",
          fontMap: { "sans-serif": "https://fonts.googleapis.com/css2?family=Noto+Sans+JP" },
        });
        const img = PNG.sync.read(Buffer.from(data));
        let n = 0;
        for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) n++;
        return n;
      };
      const full = await ink("");
      const noWeight = await ink("font-synthesis:none");
      expect(noWeight).toBeLessThan(full);
      expect(await ink("font-synthesis-weight:none;font-synthesis-style:none")).toBe(noWeight);
      expect(await ink("font-synthesis:weight style")).toBe(full); // both allowed again
    });

    it("font-optical-sizing drives the opsz axis from the font size; none keeps the default", async () => {
      const OPSZ_FACE =
        "@font-face{font-family:'RobotoOpsz';src:url('https://cdn.jsdelivr.net/npm/@fontsource-variable/roboto-flex@5.3.0/files/roboto-flex-latin-opsz-normal.woff2') format('woff2')}";
      const width = async (style: string) => {
        const { img } = await renderPng(
          `<style>${OPSZ_FACE}</style><div style="margin:0;font:40px/50px 'RobotoOpsz';color:#000;white-space:nowrap;${style}">Handgloves</div>`,
          500,
          60,
        );
        return inkRight(img, 0, 50);
      };
      const auto = await width("");
      const none = await width("font-optical-sizing:none");
      expect(auto).not.toBe(none);
      // An explicit opsz in font-variation-settings wins over font-optical-sizing.
      expect(await width("font-variation-settings:'opsz' 144")).toBe(await width("font-variation-settings:'opsz' 144;font-optical-sizing:none"));
    });
  });

  it("PNG output of an image with at most 256 colors is stored indexed and decodes identically", async () => {
    const colorType = (b: Uint8Array) => Buffer.from(b)[25];
    const flat = await render({
      value: `<body style="margin:0;background:#fff"><div style="width:40px;height:40px;background:#f00"></div><div style="width:40px;height:20px;background:#00f"></div></body>`,
      width: 100,
      height: 80,
      format: "png",
    });
    expect(colorType(flat.data as Uint8Array)).toBe(3); // indexed
    const png = PNG.sync.read(Buffer.from(flat.data as Uint8Array));
    const at = (x: number, y: number) => Array.from(png.data.slice((png.width * y + x) * 4, (png.width * y + x) * 4 + 4));
    expect(at(10, 10)).toEqual([255, 0, 0, 255]);
    expect(at(10, 50)).toEqual([0, 0, 255, 255]);
    expect(at(90, 70)).toEqual([255, 255, 255, 255]);

    // A transparent background keeps its alpha through tRNS.
    const alpha = await render({
      value: `<body style="margin:0"><div style="width:40px;height:40px;background:rgba(255,0,0,0.5)"></div></body>`,
      width: 100,
      height: 80,
      format: "png",
    });
    expect(colorType(alpha.data as Uint8Array)).toBe(3);
    const ap = PNG.sync.read(Buffer.from(alpha.data as Uint8Array));
    const a0 = (x: number, y: number) => Array.from(ap.data.slice((ap.width * y + x) * 4, (ap.width * y + x) * 4 + 4));
    expect(a0(90, 70)[3]).toBe(0);
    expect(a0(10, 10)[0]).toBe(255);
    expect(Math.abs(a0(10, 10)[3] - 128)).toBeLessThanOrEqual(1);

    // More than 256 colors (gradient) stays RGBA.
    const rich = await render({
      value: `<body style="margin:0"><div style="width:300px;height:80px;background:linear-gradient(135deg,#f00,#0f0 50%,#00f)"></div></body>`,
      width: 300,
      height: 80,
      format: "png",
    });
    expect(colorType(rich.data as Uint8Array)).not.toBe(3); // RGB or RGBA
  });

  it("opacity layers are bounded to the subtree but never clip what it paints outside its box", async () => {
    // Shadow outside the box.
    const shadow = await renderPng(
      `<div style="margin:40px;width:40px;height:40px;background:#00f;opacity:.5;box-shadow:0 0 20px 6px #f00"></div>`,
      200,
      140,
    );
    expect(isWhite(shadow.at(34, 60))).toBe(false); // 6px left of the box: shadow, not clipped
    expect(near(shadow.at(60, 60), [128, 128, 255], 40)).toBe(true); // half-transparent blue
    // Text overflowing a narrow box.
    const overflow = await renderPng(
      `<div style="margin:10px;width:30px;height:30px;opacity:.5;white-space:nowrap;font:bold 30px/30px sans-serif;color:#000">WWWWWWWW</div>`,
      300,
      60,
    );
    let inkRight = 0;
    for (let x = 100; x < 300; x++) for (let y = 0; y < 60; y++) if (!isWhite(overflow.at(x, y))) inkRight++;
    expect(inkRight).toBeGreaterThan(50); // text past the 30px box is still painted
    // Own transform: the layer follows the moved element.
    const moved = await renderPng(
      `<div style="margin:10px;width:40px;height:40px;background:#00f;opacity:.5;transform:translate(100px,20px)"></div>`,
      200,
      100,
    );
    expect(near(moved.at(130, 50), [128, 128, 255], 40)).toBe(true);
    expect(isWhite(moved.at(30, 30))).toBe(true);
    // Rotation reaches outside the unrotated box.
    const rotated = await renderPng(
      `<div style="margin:50px;width:60px;height:20px;background:#00f;opacity:.5;transform:rotate(90deg)"></div>`,
      200,
      200,
    );
    expect(near(rotated.at(80, 30), [128, 128, 255], 40)).toBe(true); // top of the rotated bar
    // A transformed descendant cannot be bounded: still painted.
    const child = await renderPng(
      `<div style="margin:20px;width:40px;height:40px;opacity:.5"><div style="width:40px;height:40px;background:#00f;transform:translate(80px,0)"></div></div>`,
      200,
      100,
    );
    expect(near(child.at(120, 40), [128, 128, 255], 40)).toBe(true);
  });

  it("float margin box (not the border box) narrows the first line", async () => {
    const squares = '<i style="display:inline-block;width:16px;height:16px;background:#00f"></i>'.repeat(30);
    const { at } = await renderPng(
      `<div style="width:240px;font-size:0;line-height:16px">
         <div style="float:right;width:60px;height:60px;background:#f00;margin:4px"></div>${squares}</div>`,
      300,
      100,
    );
    expect(near(at(150, 8), BLUE)).toBe(true); // 10th square fits left of the margin box (x < 172)
    expect(isWhite(at(165, 8))).toBe(true); // an 11th square would cross into the margin
  });

  it("calc() in a media query neither crashes nor mismatches", async () => {
    const css = `<style>.a{width:50px;height:50px}
      @media (max-width:calc(500px - 1px)){.a{background:#00f}}
      @media (min-width:calc(500px + 1px)){.a{background:#f00}}</style><div class="a"></div>`;
    const narrow = await renderPng(css, 400, 80);
    expect(near(narrow.at(10, 10), BLUE)).toBe(true);
    const wide = await renderPng(css, 700, 80);
    expect(near(wide.at(10, 10), [255, 0, 0])).toBe(true);
  });

  it("a bitmap too large to allocate fails the render without killing the instance", async () => {
    const huge = `<html><body style="margin:0"><div style="height:1200000px;background:#eee"></div></body></html>`;
    await expect(render({ value: huge, width: 1000, format: "png" })).rejects.toThrow();
    const { at } = await renderPng(`<div style="width:50px;height:50px;background:#00f"></div>`, 100, 60);
    expect(near(at(10, 10), BLUE)).toBe(true);
  });

  it("<body bgcolor> and <body background> presentational attributes apply", async () => {
    const solid = await render({
      value: `<html><body bgcolor="#0000ff"><div style="height:20px"></div></body></html>`,
      width: 100,
      height: 60,
      format: "png",
    });
    const sImg = PNG.sync.read(Buffer.from(solid.data));
    expect([sImg.data[(50 * sImg.width + 50) * 4], sImg.data[(50 * sImg.width + 50) * 4 + 2]]).toEqual([0, 255]);

    const tile = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='%23f00'/%3E%3C/svg%3E";
    const textured = await render({
      value: `<html><body style="margin:0" background="${tile}"><div style="height:20px"></div></body></html>`,
      width: 100,
      height: 60,
      format: "png",
    });
    const tImg = PNG.sync.read(Buffer.from(textured.data));
    const i = (50 * tImg.width + 50) * 4;
    expect([tImg.data[i], tImg.data[i + 1]]).toEqual([255, 0]);
  });

  it("grid content-sized tracks (auto, max-content, fit-content, minmax) and blockified inline items", async () => {
    const cell = (c: string) => `<span style="background:${c};display:inline-block;width:60px;height:10px"></span>`;
    const widths = async (tpl: string) => {
      const { at } = await renderPng(
        `<div style="display:grid;grid-template-columns:${tpl};width:300px">${cell("#f00")}${cell("#00f")}</div>`,
        320,
        20,
      );
      // first x where the pixel stops being red (width of column 1 as drawn by the red item)
      let x = 0;
      while (x < 300 && at(x, 5)[0] > 200 && at(x, 5)[2] < 60) x++;
      return { redEnd: x, blueAtRedEnd: near(at(x + 1, 5), BLUE) };
    };
    for (const tpl of ["auto 1fr", "max-content 1fr", "fit-content(200px) 1fr"]) {
      const r = await widths(tpl);
      expect(r.redEnd, tpl).toBe(60);
      expect(r.blueAtRedEnd, tpl).toBe(true);
    }
    // minmax(<length>, <length>) is not content-sized: the free space grows the track to its
    // maximum (Chromium: columns 200px 100px, so the second item starts at x=200).
    {
      const { at } = await renderPng(
        `<div style="display:grid;grid-template-columns:minmax(0,200px) 1fr;width:300px">${cell("#f00")}${cell("#00f")}</div>`,
        320,
        20,
      );
      expect(near(at(210, 5), BLUE)).toBe(true);
      expect(near(at(190, 5), BLUE)).toBe(false);
    }
    // inline children of a grid container become grid items (one per cell, not overlapped)
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:fit-content(200px) 1fr;font-size:10px;line-height:10px">
         <time style="background:#f00;color:#f00">AAAA</time><a style="background:#00f;color:#00f">BBBB</a></div>`,
      200,
      20,
    );
    expect(near(at(5, 5), [255, 0, 0])).toBe(true);
    expect(near(at(30, 5), BLUE)).toBe(true);
  });

  it("percentage heights against an auto-height parent behave as auto", async () => {
    const html = `<html><body style="margin:0;background:#fff"><div style="background:#00f"><div style="height:100%;min-height:100%;background:#00f;color:#00f;font-size:10px;line-height:10px">x</div></div></body></html>`;
    const r = await render({ value: html, width: 100, format: "png" });
    expect(r.height).toBeLessThan(100); // was the 3000px initial viewport height
  });

  it("inline SVG <mask> renders by luminance instead of aborting the wasm instance", async () => {
    const svg = (mask: string) =>
      `<svg width="50" height="50"><mask id="m">${mask}</mask><rect width="50" height="50" fill="#00f" mask="url(#m)"/></svg>`;
    const half = await renderPng(svg(`<rect width="25" height="50" fill="#fff"/>`), 100, 60);
    expect(near(half.at(10, 25), BLUE)).toBe(true); // white (luma 1) keeps the content
    expect(isWhite(half.at(40, 25))).toBe(true); // unmasked area is transparent
    const gray = await renderPng(svg(`<rect width="50" height="50" fill="#808080"/>`), 100, 60);
    const [r] = gray.at(25, 25);
    expect(r).toBeGreaterThan(100); // ~50% mask: blue blended with the white page
    expect(r).toBeLessThan(160);
  });

  it("closed <details> hides everything but its summary; open shows it", async () => {
    const body = (open: string) =>
      `<details${open}><summary style="height:20px;background:#00f"></summary><div style="height:200px;background:#f00"></div></details>`;
    const closed = await render({ value: `<html><body style="margin:0">${body("")}</body></html>`, width: 100, format: "png" });
    expect(closed.height).toBeLessThan(60);
    const opened = await render({ value: `<html><body style="margin:0">${body(" open")}</body></html>`, width: 100, format: "png" });
    expect(opened.height).toBeGreaterThan(200);
  });
  it("grid named lines, grid-template-areas and grid-area place items", async () => {
    const g = (style: string, items: string) =>
      `<div style="display:grid;width:300px;height:100px;${style}">${items}</div>`;
    const areas = await renderPng(
      g(
        "grid-template-areas:'header header' 'side main';grid-template-columns:100px 1fr;grid-template-rows:40px 1fr",
        `<div style="grid-area:header;background:#f00"></div><div style="grid-area:side;background:#00f"></div><div style="grid-area:main;background:#0f0"></div>`,
      ),
      320,
      100,
    );
    expect(near(areas.at(250, 10), RED)).toBe(true);
    expect(near(areas.at(10, 80), BLUE)).toBe(true);
    expect(near(areas.at(250, 80), [0, 255, 0])).toBe(true);
    const lines = await renderPng(
      g(
        "--c:[a] 100px [b] 1fr [c];grid-template-columns:var(--c)",
        `<div style="grid-column:b / c;grid-row:1;background:#f00"></div><div style="grid-column:a / b;grid-row:1;background:#00f"></div>`,
      ),
      320,
      100,
    );
    expect(near(lines.at(250, 10), RED)).toBe(true);
    expect(near(lines.at(10, 10), BLUE)).toBe(true);
  });
  it("calc() resolves viewport units mixed with lengths", async () => {
    const body = (h: string) => `<div style="max-height:${h}"><div style="height:100px"></div></div><div style="height:10px"></div>`;
    const r = await render({ value: `<html><body style="margin:0">${body("calc(-48px + 100vh)")}</body></html>`, width: 100, format: "png" });
    expect(r.height).toBe(110); // a dropped vh term made max-height negative and collapsed the box
  });

  it("vh resolves against the default viewport height, not the layout canvas", async () => {
    // With `height` omitted the layout canvas used to be 3000px tall, so vh/vmin/vmax
    // resolved against 3000 instead of a browser-like viewport. Chromium (no-JS viewport
    // 1000x800) resolves 25vh to 0.25 * 800 = 200px.
    const vh = await render({
      value: `<html><body style="margin:0"><div style="height:25vh;background:#c00"></div></body></html>`,
      width: 1000,
      format: "png",
    });
    expect(vh.height).toBe(200); // was 750 (0.25 * 3000)
    // example.com's body{ padding-top:25vh } must sit ~200px down, not 750px.
    const pad = await render({
      value: `<html><body style="margin:0;padding:25vh 0 0 0"><p style="margin:0">x</p></body></html>`,
      width: 1000,
      format: "png",
    });
    expect(pad.height).toBeGreaterThanOrEqual(200); // at least the 25vh padding alone
    expect(pad.height).toBeLessThan(280); // Chromium's content is ~224px (was 773)
  });

  it("an absolutely positioned inline-flex box is blockified out of the line box", async () => {
    let boxes: { p: string; t: string; h: number }[] = [];
    await render({
      value: `<html><body style="margin:0"><div style="display:flex;width:300px"><h1 style="margin:0;font-size:16px">Title text here</h1><div><input type="checkbox" style="position:absolute;display:inline-flex;width:100%;height:100%"></div></div></body></html>`,
      width: 300,
      format: "png",
      onLayout: (b) => {
        boxes = b as typeof boxes;
      },
    });
    // the heading stayed on one line (the box itself is 100% of the viewport tall, as in Chromium)
    expect(boxes.find((b) => b.t === "h1")!.h).toBeLessThan(30);
  });
  it("pdfBackground paints the whole PDF page, margins included", async () => {
    // Without it only the content area (inside the @page margin) is painted by the document's own background.
    const html = `<html><head><style>@page{size:300px 200px;margin:20px}body{margin:0}</style></head><body><p>x</p></body></html>`;
    const firstPageContent = async (extra: Record<string, unknown>) => {
      const data = Buffer.from((await render({ value: html, width: 300, format: "pdf", pdfOutline: false, ...extra })).data as Uint8Array);
      const text = data.toString("latin1");
      const n = /\/Contents (\d+) 0 R/.exec(text)![1];
      const at = text.indexOf(`\n${n} 0 obj\n`);
      const start = text.indexOf("stream\n", at) + 7;
      return inflateSync(data.subarray(start, text.indexOf("\nendstream", start))).toString("latin1");
    };
    // the page rectangle (300x200 px = 225x150 pt after the 0.75 scale: here 300 200 in px units) is filled in #0d1117
    expect(await firstPageContent({ pdfBackground: "#0d1117" })).toMatch(/\.051 \.0667 \.0902 rg[\s\S]*?0 0 300 200 re\s+f/);
    expect(await firstPageContent({})).not.toMatch(/0 0 300 200 re\s+f/);
    await expect(render({ value: html, width: 300, format: "pdf", pdfBackground: "red" })).rejects.toThrow(/invalid colour/);
  });

  it("a break-before:page on the element that already starts the page does not print a blank page", async () => {
    // break-after:page ends page 1; the next element's own break-before:page falls on the margin the
    // first break left behind (the <p> inside the div). Only white space lies between the two cuts, so
    // it must not become a page of its own.
    const pages = async (body: string) => {
      const html =
        `<html><head><style>@page{size:300px 200px;margin:0}body{margin:0}h1{margin:0;break-before:page}</style></head><body>${body}</body></html>`;
      const pdf = (await render({ value: html, width: 300, format: "pdf", pdfOutline: false })).data as Uint8Array;
      return (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
    };
    expect(await pages(`<div style="break-after:page"><p>x</p></div><h1>T</h1>`)).toBe(2);
    // A real break-before still breaks: content sits between the cut and the heading.
    expect(await pages(`<p>a</p><h1>A</h1><p>b</p><h1>B</h1>`)).toBe(3);
  });

  describe("PDF links, destinations and table-of-contents page numbers", () => {
    // Read a PDF the way a viewer does (pdfjs): the page each named destination is on, every link's
    // destination name, the bookmarks, and the text of one page.
    const readPdf = async (data: Uint8Array) => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false, isEvalSupported: false }).promise;
      const pageOfDest = async (dest: unknown) => {
        const d = typeof dest === "string" ? await doc.getDestination(dest) : (dest as unknown[]);
        return d ? (await doc.getPageIndex(d[0] as never)) + 1 : 0;
      };
      const destinations: Record<string, number> = {};
      const rawDests = (await doc.getDestinations()) ?? {};
      const destEntries = rawDests instanceof Map ? rawDests.entries() : Object.entries(rawDests);
      for (const [name, d] of destEntries) destinations[name] = await pageOfDest(d);
      const links: { page: number; dest: string; rect: number[] }[] = [];
      for (let p = 1; p <= doc.numPages; p++)
        for (const a of await (await doc.getPage(p)).getAnnotations())
          if (a.subtype === "Link" && typeof a.dest === "string") links.push({ page: p, dest: a.dest, rect: a.rect });
      const bookmarks: [string, number][] = [];
      const walk = async (items: { title: string; dest: unknown; items?: unknown[] }[]) => {
        for (const it of items) {
          bookmarks.push([it.title, await pageOfDest(it.dest)]);
          if (it.items?.length) await walk(it.items as never);
        }
      };
      await walk(((await doc.getOutline()) ?? []) as never);
      const lines = async (page: number) => {
        const tc = await (await doc.getPage(page)).getTextContent();
        const rows = new Map<number, [number, string][]>();
        for (const t of tc.items as { transform: number[]; str: string }[]) {
          const y = Math.round(t.transform[5]);
          rows.set(y, [...(rows.get(y) ?? []), [t.transform[4], t.str]]);
        }
        return [...rows.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, parts]) => parts.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join("").trim());
      };
      return { pages: doc.numPages, destinations, links, bookmarks, lines };
    };
    const pdf = async (html: string) => (await render({ value: html, width: 300, format: "pdf" })).data as Uint8Array;
    const doc = (body: string) =>
      `<html><head><style>@page{size:300px 200px;margin:0}body{margin:0;font:14px sans-serif}` +
      `.toc a{display:block;color:#000;text-decoration:none}.pad{height:230px}</style></head><body>${body}</body></html>`;

    it("a break-inside:avoid box taller than a page starts right after the text before it, not on a fresh page", async () => {
      // Page 200px tall. The 450px box cannot be kept whole on any page, so it must break where it is:
      // moving it to the next page would leave most of page 1 (and, with a repeated table header, a page) empty.
      const body = `<p style="margin:0">intro</p><div style="break-inside:avoid;height:450px"><p style="margin:0">top of the box</p></div>`;
      const r = await readPdf(await pdf(doc(body)));
      expect(r.pages).toBe(3); // 20 + 450 px over 200px pages; not 4
      expect((await r.lines(1)).join(" ")).toContain("top of the box");
    });

    it("a table taller than a page splits, repeating its header, without a blank page before it", async () => {
      const rows = Array.from({ length: 40 }, (_, k) => `<tr><td>row ${k + 1}</td></tr>`).join("");
      const body = `<h1 style="margin:0;font-size:14px">Title</h1><table style="break-inside:avoid;border-collapse:collapse"><thead><tr><th>Head</th></tr></thead><tbody>${rows}</tbody></table>`;
      const r = await readPdf(await pdf(doc(body)));
      for (let n = 1; n <= r.pages; n++) expect((await r.lines(n)).length, `page ${n}`).toBeGreaterThan(1);
      expect((await r.lines(1)).join(" ")).toContain("row 1");
      for (let n = 2; n <= r.pages; n++) expect((await r.lines(n))[0], `page ${n}`).toBe("Head"); // the header repeats
    });

    it("{{chapter}} in a running header names the h1 the page is in", async () => {
      const html =
        `<html><head><style>@page{size:300px 200px;margin:30px 0}body{margin:0;font:14px sans-serif}h1{margin:0;font-size:14px;break-before:page}.p{height:260px}</style></head>` +
        `<body><p>front matter</p><h1>One &amp; more</h1><div class="p">a</div><h1>Two</h1><div class="p">b</div></body></html>`;
      const r = await readPdf(
        (await render({ value: html, width: 300, format: "pdf", pdfOutline: false, pdfHeader: `<div style="font:11px sans-serif">C[{{chapter}}]</div>` })).data as Uint8Array,
      );
      const headers = [];
      for (let n = 1; n <= r.pages; n++) headers.push((await r.lines(n)).find((l) => l.startsWith("C[")));
      expect(headers[0]).toBe("C[]"); // before the first chapter
      expect(headers[1]).toBe("C[One & more]"); // the text is escaped into the header and back
      expect(headers[2]).toBe("C[One & more]"); // a page without a heading keeps the chapter it is in
      expect(headers[headers.length - 1]).toBe("C[Two]");
    });

    it("pdfSkipRunning leaves the first pages without header and footer but keeps counting them", async () => {
      const html = `<html><head><style>@page{size:300px 200px;margin:30px 0}body{margin:0;font:14px sans-serif}.p{height:120px;break-after:page}</style></head><body><div class="p">one</div><div class="p">two</div><div class="p">three</div></body></html>`;
      const run = async (extra: object) =>
        readPdf(
          (await render({ value: html, width: 300, format: "pdf", pdfOutline: false, pdfHeader: `<div style="font:11px sans-serif">H{{pageNumber}}</div>`, pdfFooter: `<div style="font:11px sans-serif">F{{pageNumber}}/{{totalPages}}</div>`, ...extra })).data as Uint8Array,
        );
      const all = await run({});
      expect((await all.lines(1)).join(" ")).toContain("F1/3");
      const skipped = await run({ pdfSkipRunning: 1 });
      expect((await skipped.lines(1)).join(" ")).not.toMatch(/[HF]\d/);
      expect((await skipped.lines(2)).join(" ")).toContain("H2");
      expect((await skipped.lines(2)).join(" ")).toContain("F2/3"); // the cover still counts as page 1
    });

    it("a heading goes with its paragraph when the paragraph's orphan lines do not fit under it", async () => {
      // Page 200px tall: the heading ends at 184px, so one line of the paragraph fits but not the two its
      // orphans need. The paragraph moves to page 2; the heading (break-after:avoid) must follow it.
      const body =
        `<div style="height:168px"></div><h2 style="margin:0;font-size:14px;line-height:16px;break-after:avoid">Heading</h2>` +
        `<p style="margin:0;line-height:16px;orphans:2;widows:2">${"word ".repeat(80)}</p>`;
      const r = await readPdf(await pdf(doc(body)));
      expect(r.pages).toBe(2);
      expect(await r.lines(1)).not.toContain("Heading");
      expect((await r.lines(2))[0]).toBe("Heading");
    });

    it("fills data-toc-page with the page the id starts on, and the table of contents's own pages move the numbers", async () => {
      // Row 1 is on page 1; the headings follow after padding. Page numbers are text, so this also
      // checks that the numbers are filled in before the pages are planned for good.
      const body =
        `<nav class="toc"><a href="#a">Alpha <span data-toc-page="a">0</span></a><a href="#b">Beta <span data-toc-page="b">0</span></a></nav>` +
        `<div class="pad"></div><h1 id="a">Alpha</h1><div class="pad"></div><h1 id="b">Beta</h1>`;
      const r = await readPdf(await pdf(doc(body)));
      const printed = (await r.lines(1)).filter((l) => /^(Alpha|Beta)\s*\d+$/.test(l));
      expect(printed).toEqual([`Alpha ${r.destinations.a}`, `Beta ${r.destinations.b}`]);
      expect(r.destinations.a).toBeGreaterThan(1);
      expect(r.destinations.b).toBeGreaterThan(r.destinations.a);
    });

    it("links reach their destinations, ids in any script included (Skia names ASCII only)", async () => {
      const body =
        `<nav class="toc"><a href="#章-1">章 1</a><a href="#ascii-id">two</a><a href="#nowhere">dead</a></nav>` +
        `<div class="pad"></div><h1 id="章-1">章 1</h1><div class="pad"></div><h1 id="ascii-id">two</h1>`;
      const r = await readPdf(await pdf(doc(body)));
      expect(Object.keys(r.destinations).length).toBe(2); // only ids that a link points at
      // every link resolves to a destination (a link to a missing id is not written at all)
      expect(r.links.length).toBe(2);
      for (const l of r.links) expect(r.destinations[l.dest]).toBeGreaterThan(1);
    });

    it("an inline link is clickable on its own text, and a link that wraps is clickable on every line", async () => {
      const body =
        `<p id="top">x</p><p style="width:90px">word word <a href="#top">several words that wrap</a> end</p>`;
      const r = await readPdf(await pdf(doc(body)));
      expect(r.links.length).toBeGreaterThan(1); // one rectangle per line of the wrapped link
      for (const l of r.links) {
        expect(l.rect[2] - l.rect[0]).toBeGreaterThan(5);
        expect(l.rect[2]).toBeLessThanOrEqual(100); // inside the 90px paragraph (plus its rounding)
      }
    });

    it("bookmarks follow the headings, nested by level, on the page each heading starts on", async () => {
      const body = `<h1>A</h1><div class="pad"></div><h2>A1</h2><div class="pad"></div><h1>B</h1>`;
      const r = await readPdf(await pdf(doc(body)));
      expect(r.bookmarks.map(([t]) => t)).toEqual(["A", "A1", "B"]);
      expect(r.bookmarks[1][1]).toBeGreaterThan(r.bookmarks[0][1]);
      expect(r.bookmarks[2][1]).toBeGreaterThan(r.bookmarks[1][1]);
    });
  });

  it("a PDF gets an outline (bookmarks) from h1-h6 by default, and pdfOutline: false leaves it out", async () => {
    const html =
      `<html><head><style>@page{size:300px 200px;margin:0}</style></head><body style="margin:0">` +
      `<h1>First</h1><div style="height:260px"></div><h2>Second 日本語</h2></body></html>`;
    // Bookmark titles: PDF text strings, either (ASCII) or <FEFF...> UTF-16BE.
    const titles = (pdf: Uint8Array) => {
      const text = Buffer.from(pdf).toString("latin1");
      return [...text.matchAll(/\/Title\s*(?:<([0-9A-Fa-f]+)>|\(([^)]*)\))/g)].map((m) =>
        m[1] ? Buffer.from(m[1], "hex").subarray(2).swap16().toString("utf16le") : m[2],
      );
    };
    const on = (await render({ value: html, width: 300, format: "pdf" })).data as Uint8Array;
    expect(Buffer.from(on).toString("latin1")).toContain("/Outlines");
    expect(titles(on)).toEqual(expect.arrayContaining(["First", "Second 日本語"]));
    const off = (await render({ value: html, width: 300, format: "pdf", pdfOutline: false })).data as Uint8Array;
    expect(Buffer.from(off).toString("latin1")).not.toContain("/Outlines");
    expect(titles(off)).not.toContain("First");
    // A document without headings gets no outline at all.
    const none = (await render({ value: `<html><body><p>x</p></body></html>`, width: 300, format: "pdf" })).data as Uint8Array;
    expect(Buffer.from(none).toString("latin1")).not.toContain("/Outlines");
  });

  it("an auto-width table is as wide as its content when a cell holds a width:100% inline-block (KaTeX fraction line)", async () => {
    const boxes = async (body: string) => {
      let out: { i?: string; w: number; h: number }[] = [];
      await render({
        value: `<html><body style="margin:0;font:20px/1.2 sans-serif">${body}</body></html>`,
        width: 300,
        format: "png",
        onLayout: (b) => {
          out = b as typeof out;
        },
      });
      return out;
    };
    const line = `<span style="display:block;height:0"><span style="border-bottom:2px solid #000;display:inline-block;width:100%"></span></span>`;
    // The percentage resolved against the 300px the table could take, so the table filled it.
    const inlineTable = await boxes(
      `<span id="t" style="display:inline-table"><span style="display:table-row"><span style="display:table-cell"><span style="display:inline-block">ab</span>${line}</span></span></span>`,
    );
    expect(inlineTable.find((b) => b.i === "t")!.w).toBeLessThan(40);
    const table = await boxes(
      `<table id="t" style="border-collapse:collapse"><tr><td><span style="display:inline-block">ab</span>${line}</td></tr></table>`,
    );
    expect(table.find((b) => b.i === "t")!.w).toBeLessThan(40);
    // A width:100% table still takes the container's width and wraps its text inside it.
    const text = "Building an open-source and cross-platform Azure CLI with Python";
    const full = await boxes(
      `<div style="width:260px"><table id="t" style="width:100%;border-collapse:collapse"><tr><td>${text}</td></tr></table></div>`,
    );
    expect(full.find((b) => b.i === "t")!.w).toBeCloseTo(260, 0);
    expect(full.find((b) => b.i === "t")!.h).toBeGreaterThan(40);
  });

  it("an inline-table sits on the line by its first row's baseline, through position:relative children (KaTeX column)", async () => {
    // A zero-size marker next to the table is on the line's baseline. The first row is a 40px
    // bottom-aligned cell holding position:relative height:0 blocks (a KaTeX vlist); a second 10px
    // row (the descender strut) follows. Chromium puts the baseline at 40; the table used to answer
    // with its bottom edge (50), and the blocks' position:relative hid the cell's own baseline.
    let boxes: { i?: string; y: number }[] = [];
    const block = `<span style="display:block;height:0;position:relative;top:-20px"><span style="display:inline-block;height:20px;width:0"></span><span style="display:inline-block">a</span></span>`;
    await render({
      value:
        `<html><body style="margin:0;font:20px/1.2 sans-serif"><div>` +
        `<span style="display:inline-table;border-collapse:collapse;table-layout:fixed">` +
        `<span style="display:table-row"><span style="display:table-cell;position:relative;vertical-align:bottom;height:40px">${block}</span></span>` +
        `<span style="display:table-row"><span style="display:table-cell;height:10px"></span></span></span>` +
        `<span id="t" style="display:inline-block;width:10px;height:0"></span></div></body></html>`,
      width: 300,
      format: "png",
      onLayout: (b) => {
        boxes = b as typeof boxes;
      },
    });
    const y = boxes.find((b) => b.i === "t")!.y;
    expect(y).toBeGreaterThan(36);
    expect(y).toBeLessThan(44);
  });

  it("a table of bottom-aligned cells sits on its first row's bottom: a raised KaTeX superscript stays raised", async () => {
    // The superscript is a one-row inline-table whose bottom-aligned cell holds a position:relative
    // block raised by `top`. A cell of that kind has no baseline of its own, so the table sits on the
    // first row's bottom edge, wherever the raised content lands: reading the content's baseline
    // instead dragged the table down by the offset and put the exponent back on the baseline.
    let boxes: { i?: string; y: number }[] = [];
    const sup = (top: number) =>
      `<span style="display:inline-table;border-collapse:collapse;table-layout:fixed"><span style="display:table-row">` +
      `<span style="display:table-cell;position:relative;vertical-align:bottom;height:10px"><span style="display:block;height:0;position:relative;top:${top}px">` +
      `<span style="display:inline-block;height:12px;width:0"></span><span style="display:inline-block;font-size:12px">2</span></span></span></span></span>`;
    const ys: number[] = [];
    for (const top of [-8, -20]) {
      await render({
        value: `<html><body style="margin:0;font:20px/1.2 sans-serif"><div>x${sup(top)}<span id="t" style="display:inline-block;width:10px;height:0"></span></div></body></html>`,
        width: 300,
        format: "png",
        onLayout: (b) => {
          boxes = b as typeof boxes;
        },
      });
      ys.push(boxes.find((b) => b.i === "t")!.y);
    }
    // The line's baseline does not depend on how far the exponent is raised.
    expect(Math.abs(ys[0] - ys[1])).toBeLessThan(1);
  });

  it("auto-width table with percentage cells is shrink-to-fit, not collapsed", async () => {
    const cell = (w: string) => `<td style="width:${w}">先代<br>東京府・東京市</td>`;
    for (const font of ["", "font-size:95%;"]) {
      const r = await render({
        value: `<html><body style="margin:0"><table style="border-collapse:collapse;margin:0.5em auto;${font}"><tr style="text-align:center">${cell("30%")}${cell("40%")}${cell("30%")}</tr></table></body></html>`,
        width: 800,
        format: "png",
      });
      expect(r.height).toBeLessThan(80); // text stayed on two lines instead of one character per line
    }
  });
  it("inline SVG resolves var() to its fallback in attributes and style", async () => {
    for (const attr of [`fill="var( --x, #f00 )"`, `style="fill:var(--x,#f00)"`, `fill="var(--x, rgb(255,0,0))"`]) {
      const { at } = await renderPng(`<svg width="100" height="40"><rect width="100" height="40" ${attr}/></svg>`, 100, 40);
      expect(near(at(50, 20), RED)).toBe(true);
    }
  });
  it("inline SVG resolves custom properties and color-mix() in attributes and stylesheet rules", async () => {
    // Generators such as beautiful-mermaid derive every colour from --bg / --fg with color-mix().
    const root = `style="--fg:#000000;--bg:#ffffff"`;
    const sheet = `<style>svg{--half:color-mix(in srgb, var(--fg) 50%, var(--bg));--pick:var(--none, color-mix(in srgb, var(--fg) 50%, var(--bg)))}.bar{fill:var(--half)}</style>`;
    const rect = (extra: string) => `<rect width="100" height="40" ${extra}/>`;
    const gray: Rgb = [128, 128, 128];
    for (const extra of [
      `fill="var(--half)"`, // custom property holding a color-mix
      `fill="var(--pick)"`, // undefined var with a color-mix fallback
      `fill="color-mix(in srgb, #000 50%, #fff)"`, // inline function
      `class="bar"`, // stylesheet rule
    ]) {
      const { at } = await renderPng(`<svg width="100" height="40" ${root}>${sheet}${rect(extra)}</svg>`, 100, 40);
      expect(near(at(50, 20), gray, 4), extra).toBe(true);
    }
    // invalid at computed-value time: the attribute is dropped, not painted black via currentColor
    const { at } = await renderPng(`<svg width="100" height="40" style="color:#f00">${rect(`fill="var(--missing)"`)}</svg>`, 100, 40);
    expect(near(at(50, 20), [0, 0, 0], 4)).toBe(true); // an SVG shape without fill is black
  });
  it("inline SVG draws marker-end / marker-start on lines and polylines", async () => {
    const marker = `<defs><marker id="m" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><polygon points="0 0, 8 4, 0 8" fill="#00f"/></marker></defs>`;
    // the head is wholly beyond the line's last point, so only the marker can paint there
    const { at } = await renderPng(
      `<svg width="100" height="40">${marker}<polyline points="5,20 80,20" stroke="#000" stroke-width="1" fill="none" marker-end="url(#m)"/></svg>`,
      100,
      40,
    );
    expect(near(at(75, 20), BLUE)).toBe(true); // inside the arrowhead, left of the tip at x=80
    expect(isWhite(at(90, 20))).toBe(true); // nothing past the tip
    const rev = await renderPng(
      `<svg width="100" height="40">${marker.replace('orient="auto"', 'orient="auto-start-reverse"')}<line x1="20" y1="20" x2="95" y2="20" stroke="#000" marker-start="url(#m)"/></svg>`,
      100,
      40,
    );
    expect(near(rev.at(25, 20), BLUE)).toBe(true); // reversed head: tip at x=20, widening to the right
  });
  it('<pre class="mermaid"> is drawn as a diagram by the engine, not shown as text', async () => {
    const countPixels = (img: { data: Uint8Array | Buffer }, test: (r: number, g: number, b: number) => boolean) => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (test(img.data[i], img.data[i + 1], img.data[i + 2])) n++;
      return n;
    };
    const page = (body: string) => `<div style="--mermaid-accent:#0000ff;color:#000">${body}</div>`;
    const { img } = await renderPng(page(`<pre class="mermaid">graph TD\n  A --&gt; B</pre>`), 300, 400);
    // two boxes joined by an arrow (accent coloured head), far taller than the one line the source would take
    expect(countPixels(img, (r, g, b) => b > 200 && r < 60 && g < 60)).toBeGreaterThan(8);
    let lastInk = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (img.width * y + x) * 4;
        if (img.data[i] < 235 || img.data[i + 1] < 235 || img.data[i + 2] < 235) lastInk = y;
      }
    expect(lastInk).toBeGreaterThan(150);
    // the diagram follows the page: a div works too, and a bad diagram becomes a visible error
    const err = await renderPng(page(`<div class="mermaid">zenuml</div>`), 300, 100);
    expect(countPixels(err.img, (r, g, b) => r > 180 && g < 80 && b < 80)).toBeGreaterThan(20);
    // a plain <pre> is left alone
    const plain = await renderPng(page(`<pre>graph TD</pre>`), 300, 60);
    expect(countPixels(plain.img, (r, g, b) => b > 200 && r < 60 && g < 60)).toBe(0);
  });
  it("every Mermaid diagram type is drawn (ink, no error box)", async () => {
    const sources: Record<string, string> = {
      flowchart: "graph LR\n  A --&gt; B",
      sequence: "sequenceDiagram\n  A-&gt;&gt;B: hi",
      state: "stateDiagram-v2\n  [*] --&gt; A",
      class: "classDiagram\n  class A {\n    &lt;&lt;abstract&gt;&gt;\n    +x()\n  }\n  A &lt;|-- B",
      er: "erDiagram\n  A ||--o{ B : has",
      xychart: "xychart-beta\n  x-axis [a, b]\n  bar [1, 2]",
      gantt: "gantt\n  A :a, 2024-01-01, 5d\n  B :after a, 3d",
      mindmap: "mindmap\n  r\n    a\n    b",
      timeline: "timeline\n  2020 : a : b\n  2021 : c",
      journey: "journey\n  section S\n    A: 5: Me\n    B: 2: Me",
      quadrant: "quadrantChart\n  x-axis L --> R\n  y-axis D --> U\n  p: [0.3, 0.6]",
      git: 'gitGraph\n  commit\n  branch b\n  checkout b\n  commit\n  checkout main\n  merge b',
      kanban: "kanban\n  Todo\n    [a]\n  Done\n    [b]",
      packet: 'packet-beta\n  0-15: "a"\n  16-31: "b"',
      sankey: "sankey-beta\n\nA,B,5\nA,C,3",
      requirement: "requirementDiagram\n  requirement r {\n    id: 1\n  }\n  element e {\n    type: x\n  }\n  e - satisfies -> r",
      block: 'block-beta\n  columns 2\n  a b\n  a --> b',
      pie: 'pie title T\n  "a" : 1\n  "b" : 2',
      treemap: 'treemap-beta\n"A"\n  "a1": 10\n  "a2": 30\n"B": 20',
      radar: 'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}',
      info: "info\nshowInfo",
      c4: 'C4Context\n  Person(p, "User")\n  System(s, "App", "Does things")\n  Rel(p, s, "Uses")',
      venn: 'venn-beta\n  set A\n  set B\n  union A,B["Both"]',
      ishikawa: "ishikawa-beta\n  Effect\n    Cause\n      Detail",
      treeview: 'treeView-beta\n  "src"\n    "a.ts"',
      architecture: "architecture-beta\n  service a(server)[A]\n  service b(database)[B]\n  a:R -- L:b",
    };
    for (const [name, src] of Object.entries(sources)) {
      const { img } = await renderPng(`<div style="color:#000"><div class="mermaid">${src}</div></div>`, 400, 360);
      let ink = 0;
      let error = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] < 200 && img.data[i + 1] < 200 && img.data[i + 2] < 200) ink++;
        if (img.data[i] > 180 && img.data[i + 1] < 80 && img.data[i + 2] < 80) error++;
      }
      expect(ink, name).toBeGreaterThan(100);
      expect(error, name).toBe(0);
    }
  });
  it("inline SVG text takes the font weight and falls back per character inside one <text>", async () => {
    const ink = async (attrs: string, text: string) => {
      const { img } = await renderPng(`<svg width="260" height="40"><text x="4" y="28" font-size="22" ${attrs}>${text}</text></svg>`, 260, 40);
      let dark = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) dark++;
      return dark;
    };
    expect(await ink('font-weight="800"', "Weight")).toBeGreaterThan(1.2 * (await ink('font-weight="300"', "Weight")));
    // Kanji that live in different slices of the default CJK font, in ONE <text>: the first one used to be the only
    // glyph drawn (Skia's primitive shaper takes the first font run for the whole string), the rest were boxes.
    // A box is a thin frame; real glyphs have clearly more ink than boxes.
    const word = await ink('font-family="sans-serif"', "開始判定");
    const boxes = await ink('font-family="sans-serif"', "開始判定".replace(/./g, "͸"));
    expect(word).toBeGreaterThan(400);
    expect(word).toBeGreaterThan(boxes * 1.5);
  });
  it("inline SVG text with &lt; and &amp; does not break the drawing", async () => {
    // The parser decodes entities; writing the text back unescaped made "<<x>>" end the XML and dropped the whole SVG.
    const { img } = await renderPng(
      `<svg width="200" height="40"><rect x="0" y="0" width="200" height="40" fill="#000"/><text x="5" y="25" font-size="16" fill="#fff">&lt;&lt;a&gt;&gt; &amp; b</text></svg>`,
      200,
      40,
    );
    let dark = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) dark++;
    expect(dark).toBeGreaterThan(5000);
  });
  it("inline SVG <text> is drawn (needs a font manager that knows Satoru's fonts)", async () => {
    const { img } = await renderPng(
      `<svg width="200" height="40"><text x="5" y="25" font-size="16" fill="#000">Hello 世田谷区</text></svg>`,
      200,
      40,
    );
    let dark = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 0 && img.data[i] < 128) dark++;
    expect(dark).toBeGreaterThan(100);
  });
  it("deeply nested flex-wrap trees finish in bounded time (layout work budget)", async () => {
    const nest = (d: number): string =>
      d === 0
        ? "<button>x</button>"
        : `<div style="display:flex;flex-wrap:wrap"><div style="flex:100%;max-width:100%;display:flex;flex-wrap:wrap">${nest(d - 1)}<span>a</span></div></div>`;
    const t0 = Date.now();
    const r = await render({ value: `<html><body>${nest(16)}</body></html>`, width: 600, format: "png" });
    expect(r.height).toBeGreaterThan(100);
    expect(Date.now() - t0).toBeLessThan(30000); // exponential before: minutes at this depth
  }, 60000);
  it("closed <dialog> is hidden; open <dialog> is shown", async () => {
    const body = (open: string) => `<dialog${open}><div style="height:200px;background:#f00"></div></dialog><div style="height:10px"></div>`;
    const closed = await render({ value: `<html><body style="margin:0">${body("")}</body></html>`, width: 100, format: "png" });
    expect(closed.height).toBeLessThan(40);
    const opened = await render({ value: `<html><body style="margin:0">${body(" open")}</body></html>`, width: 100, format: "png" });
    expect(opened.height).toBeGreaterThan(200);
  });
  it("multicol splits a list's items across columns instead of keeping the list in one column", async () => {
    const li = Array.from({ length: 10 }, (_, i) => `<li style="height:30px">r ${i}</li>`).join("");
    for (const style of ["column-count:2", "column-width:200px"]) {
      const r = await render({
        value: `<html><body style="margin:0"><div style="${style}"><ol style="margin:0">${li}</ol></div></body></html>`,
        width: 600,
        format: "png",
      });
      expect(r.height).toBe(150); // 10 items x 30px in 2 balanced columns (was 300 in one column)
    }
  });
  it("deeply nested auto tables keep a sane height (no stale sizes from the measure budget)", async () => {
    // Wikipedia-style navbox: th{width:1%} + td{width:100%} tables nested a dozen levels deep.
    const leaf = "<ul><li><a>item one</a></li><li><a>item two</a></li></ul>";
    let inner = leaf;
    for (let i = 0; i < 12; i++) {
      inner = `<table style="width:100%;border-spacing:0"><tbody><tr><th style="width:1%;white-space:nowrap">G${i}</th><td style="width:100%;padding:0">${inner}</td></tr><tr><td colspan="2" style="padding:0">${leaf}</td></tr></tbody></table>`;
    }
    const r = await render({ value: `<html><body style="margin:0;font:14px sans-serif"><div style="width:600px">${inner}</div></body></html>`, width: 700, format: "png" });
    expect(r.height).toBeLessThan(1500); // ~12 x (list 2 rows) rows; was inflated by the exhausted budget
  }, 60000);
  it("text inputs get a default box (size, border) instead of collapsing to nothing", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><input type="text" style="display:block"><input style="display:block"></body></html>`,
      width: 300,
      format: "png",
    });
    expect(r.height).toBe(42); // 2 x 21px default control height
  });
  it("input value / placeholder / button label text is drawn", async () => {
    const draw = async (attrs: string) =>
      Buffer.from((await render({ value: `<html><body style="margin:0"><input ${attrs}></body></html>`, width: 200, format: "png" })).data).toString("base64");
    const empty = await draw('type="text"');
    expect(await draw('type="text" value="WWWW"')).not.toBe(empty);
    expect(await draw('type="text" placeholder="WWWW"')).not.toBe(empty);
    expect(await draw('type="submit" value="WWWW"')).not.toBe(await draw('type="submit" value=""'));
  });
  it("textarea, select and checkbox/radio get default boxes; size/cols/rows are honored", async () => {
    const h = async (body: string) => (await render({ value: `<html><body style="margin:0;font:14px sans-serif">${body}</body></html>`, width: 600, format: "png" })).height;
    expect(await h('<textarea style="display:block"></textarea>')).toBe(36); // rows=2 default
    expect(await h('<textarea rows="5" style="display:block"></textarea>')).toBe(81);
    expect(await h('<select style="display:block"><option>One</option><option>Two</option></select>')).toBeGreaterThan(15);
    expect(await h('<input type="checkbox" style="display:block;margin:0">')).toBe(13);
  });
  it("grid: definite column with auto row is auto-placed into a free row", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="display:grid;grid-template-columns:repeat(24,1fr);column-gap:8px;width:960px"><div style="grid-column:1 / span 16;height:100px"></div><div style="grid-column:17 / span 8;grid-row:1 / span 3;height:100px"></div><div style="grid-column:1 / span 1;height:50px"></div></div></body></html>`,
      width: 960,
      format: "png",
    });
    expect(r.height).toBe(150); // third item goes to row 2 (was drawn over the first at 100)
  });
  it("grid inside a grid sizes its rows from content (items are not forced to the track height)", async () => {
    const h2 = `<h2 style="margin:0;font:18px/22px serif;background:#f00">Bollywood actor Tiger Shroff survives shooting in Mumbai</h2>`;
    const p = `<p style="margin:0;font:14px/18px serif;background:#00f">Video published by several news outlets shows gunmen firing multiple shots at a car</p>`;
    const { at } = await renderPng(`<div style="width:312px;display:grid"><div style="display:grid">${h2}${p}</div></div>`, 312, 140);
    // the blue paragraph must start below the (two-line) red title, not overlap it
    let redBottom = -1;
    let blueTop = -1;
    for (let y = 0; y < 140; y++) {
      const c = at(3, y);
      if (near(c, RED)) redBottom = y;
      if (near(c, BLUE) && blueTop < 0) blueTop = y;
    }
    expect(blueTop).toBeGreaterThan(redBottom);
  });
  it("explicit grid-template-rows tracks keep their specified size; items overflow instead", async () => {
    // `display:grid;grid-template-rows:50px` with a 200px tall (overflow:hidden) item:
    // Chromium keeps the grid 50px tall and clips the item. An explicitly sized row track
    // must not be grown to its item's content.
    const doc = (rows: string) =>
      `<div style="display:grid;grid-template-rows:${rows};width:160px"><div style="overflow:hidden"><div style="height:200px;background:#00f"></div></div></div><div style="height:20px;background:#0f0"></div>`;
    const fixed = await renderPng(doc("50px"), 200, 300);
    expect(near(fixed.at(5, 25), BLUE)).toBe(true);
    expect(near(fixed.at(5, 49), BLUE)).toBe(true);
    // the marker is right below the 50px track, not below the 200px item (y=220 before the fix)
    expect(near(fixed.at(5, 55), [0, 255, 0])).toBe(true);
    expect(isWhite(fixed.at(5, 75))).toBe(true);
    // `0fr` in an indefinite-height container stays collapsed (GitHub accordion panels).
    const collapsed = await renderPng(doc("0fr"), 200, 300);
    expect(near(collapsed.at(5, 15), [0, 255, 0])).toBe(true);
    expect(isWhite(collapsed.at(5, 25))).toBe(true);
  });
  it("grid items are auto-placed in order-modified document order", async () => {
    // `order` reorders grid items for placement (CSS Grid §8.5 runs auto-placement in
    // order-modified document order), so the red order:2 item is pushed to the second
    // column although it comes first in the DOM (GitHub accordion wrapper/visual swap).
    const swapped = await renderPng(
      `<div style="display:grid;grid-template-columns:100px 100px;width:200px"><div style="order:2;height:40px;background:#f00"></div><div style="order:1;height:40px;background:#00f"></div></div>`,
      300,
      100,
    );
    expect(near(swapped.at(50, 20), BLUE)).toBe(true);
    expect(near(swapped.at(150, 20), RED)).toBe(true);
    // Items sharing an `order` keep their DOM order.
    const same = await renderPng(
      `<div style="display:grid;grid-template-columns:100px 100px;width:200px"><div style="order:1;height:40px;background:#f00"></div><div style="order:1;height:40px;background:#00f"></div></div>`,
      300,
      100,
    );
    expect(near(same.at(50, 20), RED)).toBe(true);
    expect(near(same.at(150, 20), BLUE)).toBe(true);
  });
  it("negative vertical margins overlap instead of adding space", async () => {
    // Adjoining margins collapse to the largest positive plus the most negative one
    // (CSS 2.1 §8.3.1); before the fix the negative part was pushed the box *down*
    // (GitHub's `.lp-Cta-mascots-wrap{margin-top:-10%;margin-bottom:-10%}`).
    const h = async (body: string) =>
      (await render({ value: `<html><body style="margin:0">${body}</body></html>`, width: 300, format: "png" })).height;
    // Chromium: 100 + 100 - 100 + 10 = 110 (the blue box overlaps the red one).
    expect(
      await h(
        `<div style="height:100px;background:#f00"></div><div style="height:100px;background:#00f;margin-top:-100px"></div><div style="height:10px;background:#0f0"></div>`,
      ),
    ).toBe(110);
    // 20px bottom + -5px top collapse to 15px: 50 + 20 + 15 + 20 = 105.
    expect(
      await h(
        `<div style="height:50px"></div><div style="height:20px;margin-bottom:20px"></div><div style="height:20px;margin-top:-5px"></div>`,
      ),
    ).toBe(105);
    // A negative first-child margin pulls the content up: 40 - 10 + 10 = 40.
    expect(await h(`<div style="height:40px;background:#00f;margin-top:-10px"></div><div style="height:10px;background:#0f0"></div>`)).toBe(40);
  });
  it("aspect-ratio:unset / initial cancel an earlier aspect-ratio", async () => {
    // GitHub resets `aspect-ratio:1` with a doubled-class rule
    // (`.lp-SectionHero-content.lp-SectionHero-content{aspect-ratio:unset}`). Before the
    // fix the keyword was dropped, the ratio survived and the 1000px-wide hero became
    // 1000px tall instead of sizing from its content.
    const doc = (kw: string) =>
      `<style>.box{width:200px;aspect-ratio:1;background:#f00}.box.box{aspect-ratio:${kw}}.box>div{height:30px;background:#00f}</style>` +
      `<div class="box"><div></div></div><div style="height:10px;background:#0f0"></div>`;
    const height = async (kw: string) =>
      (await render({ value: `<html><body style="margin:0">${doc(kw)}</body></html>`, width: 300, format: "png" })).height;
    // Chromium: content 30px + marker 10px. Without the reset the box keeps 1:1 (200px).
    expect(await height("unset")).toBe(40);
    expect(await height("initial")).toBe(40);
    expect(await height("auto")).toBe(40);
    // `unset` inherits on inherited properties, `initial` does not.
    const inherited = await renderPng(
      `<style>.p{color:#f00}.u{color:unset;border:10px solid;width:40px;height:20px;background:#00f}.i{color:initial;border:10px solid;width:40px;height:20px;background:#00f}</style>` +
        `<div class="p"><div class="u"></div><div class="i"></div></div>`,
      300,
      100,
    );
    expect(near(inherited.at(5, 5), RED)).toBe(true); // color:unset -> inherited red border
    expect(near(inherited.at(20, 45), RED)).toBe(false); // color:initial -> initial colour, not the parent's
  });
  it("display:contents generates no box: its children take part in the parent's layout", async () => {
    const h = async (b: string) => (await render({ value: `<html><body style="margin:0">${b}</body></html>`, width: 400, format: "png" })).height;
    expect(
      await h(`<div style="display:grid;grid-template-columns:100px 100px;width:400px"><div style="display:contents"><div style="height:30px">a</div><div style="height:30px">b</div><div style="height:40px">c</div></div></div>`),
    ).toBe(70); // a,b share row 1; c is row 2
    expect(await h(`<div style="display:flex"><div style="display:contents"><div style="height:30px;width:50px">a</div><div style="height:50px;width:50px">b</div></div></div>`)).toBe(50);
  });
  it("resolves relative stylesheets against the post-redirect final URL", async () => {
    // A 301 to another path must move the base used for relative resources:
    // otherwise `style.css` is requested against the stale URL and 404s.
    const html = `<html><head><link rel="stylesheet" href="style.css"></head><body style="margin:0"><div class="box"></div></body></html>`;
    const css = `.box{width:120px;height:80px;background:#00f}`;
    const server = http.createServer((req, res) => {
      if (req.url === "/old") {
        res.writeHead(301, { location: "/base/final.html" });
        res.end();
      } else if (req.url === "/base/final.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
      } else if (req.url === "/base/style.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(css);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/old`,
        width: 200,
        height: 120,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const at = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      expect(near(at(60, 40), BLUE)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("an unlayered declaration in a fetched stylesheet beats a layered one from inline CSS", async () => {
    // <link rel=stylesheet> content is page CSS (author origin, unlayered). Injecting it as
    // a user stylesheet made every @layer block outrank it, so a losing `padding:var(...)`
    // inside `@layer` won over the linked `padding:0 var(--gap)` (github.com hero, +128px).
    const html = `<html><head><link rel="stylesheet" href="page.css"><style>
      @layer brand { :root { --pad: 120px 0 } .box { padding: var(--pad) } }
    </style></head><body style="margin:0;background:#fff"><div class="box"><div style="height:20px;background:#f00"></div></div></body></html>`;
    const css = `:root{--gap:24px}.box{padding:0 var(--gap)}`;
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
      } else if (req.url === "/page.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(css);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 300,
        height: 200,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const at = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      // padding:0 24px -> the child paints from the top, 24px in from the left.
      expect(near(at(10, 10), [255, 255, 255])).toBe(true);
      expect(near(at(30, 10), RED)).toBe(true);
      // The layered 120px padding-top must not win: no red left below row ~20.
      expect(near(at(30, 100), [255, 255, 255])).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("sampled @keyframes opacity animation yields a multi-frame animated WebP", async () => {
    // The document carries the animation; `animation: { duration, fps }` asks
    // the renderer to sample it into frames (loop fixed to infinite, opacity
    // only). Without the option the same document is a single static frame.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const animated = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    expect(animated.animation).toBe(true);
    const frames = webpFrameHashes(
      new Uint8Array(animated.data as Uint8Array),
    );
    expect(frames.length).toBeGreaterThan(1);
    // Fade frames must have distinct pixel content (style override + paint
    // sync applied), not just distinct frame metadata.
    expect(new Set(frames).size).toBe(frames.length);

    const still = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
    });
    expect(still.animation).toBeFalsy();
    expect(webpFrameHashes(new Uint8Array(still.data as Uint8Array))).toEqual(
      [],
    );
  });

  it("animation.loop writes a finite loop count into the ANIM chunk", async () => {
    // `loop: 1` = play once. Only the ANIM chunk differs from the infinite
    // variant: the frames (count, durations, pixels) stay the same.
    const html = `<html><head><style>
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      .box { width: 80px; height: 80px; background: #00f; animation-name: fade; }
    </style></head><body style="margin:0;background:#fff"><div class="box"></div></body></html>`;

    const infinite = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10 },
    });
    const once = await render({
      value: html,
      width: 120,
      height: 120,
      format: "webp",
      animation: { duration: 300, fps: 10, loop: 1 },
    });
    expect(once.animation).toBe(true);

    const infiniteData = new Uint8Array(infinite.data as Uint8Array);
    const onceData = new Uint8Array(once.data as Uint8Array);
    expect(webpAnimParams(infiniteData)?.loopCount).toBe(0);
    expect(webpAnimParams(onceData)?.loopCount).toBe(1);
    // The frame payload is untouched by the loop count.
    expect(webpFrames(onceData)).toEqual(webpFrames(infiniteData));
    expect(onceData.byteLength).toBe(infiniteData.byteLength);
  });

  it("unicode-bidi: bidi-override reorders inline items in an RTL line", async () => {

    const box = (color: string, text: string) =>
      `<span style="display:inline-block;width:20px;height:20px;color:transparent;background:${color}">${text}</span>`;
    const { at } = await renderPng(
      `<div style="direction:rtl;unicode-bidi:bidi-override;width:100px;font:10px/10px monospace;white-space:nowrap">${box("#f00", "A")}${box("#00f", "B")}</div>`,
      100,
      40,
    );
    // Both runs are forced to the RTL embedding level, so the line is mirrored:
    // the blue item comes first even though it is last in the source.
    expect(near(at(65, 10), BLUE)).toBe(true);
    expect(near(at(85, 10), RED)).toBe(true);
  });

  it("white-space-collapse: preserve-breaks preserves newlines", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="width:100px;font:16px/20px monospace;white-space-collapse:preserve-breaks">ab\ncd</div></body></html>`,
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(40); // was one collapsed line (20px)
  });

  it("text-wrap-mode: nowrap suppresses wrapping", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="width:50px;font:16px/20px monospace;text-wrap-mode:nowrap">AAAA BBBB</div></body></html>`,
      width: 50,
      format: "png",
    });
    expect(r.height).toBe(20); // was two lines (40px)
  });

  // text-wrap-style: balance / pretty. Chromium narrows the wrap width until the
  // line count would grow, which evens out the line lengths (balance) and pulls
  // an orphaned last word up (pretty). Both must keep the line count, otherwise
  // the following content would move.
  const WRAP_PROBE_TEXT =
    "The quick brown fox jumps over the lazy dog and then keeps on running";
  const wrapProbe = (wrap: string, width: number) =>
    renderProbeText(
      `<div style="width:${width}px;font-family:'RobotoProbe',sans-serif;font-size:16px;line-height:22px;color:#000;${wrap}">${WRAP_PROBE_TEXT}</div>`,
      width,
    );

  it("text-wrap-style: balance evens out the line lengths without adding a line", async () => {
    const auto = lineRightEdges(await wrapProbe("", 300), 22);
    const balanced = lineRightEdges(
      await wrapProbe("text-wrap-style:balance", 300),
      22,
    );

    expect(auto.length).toBe(2);
    expect(balanced.length).toBe(auto.length); // line count is preserved
    // The last line used to keep the short tail (a 67px spread, last line ~35px
    // shorter than the first one) instead of growing to the balanced width.
    expect(lineEdgeSpread(auto)).toBeGreaterThan(50);
    expect(lineEdgeSpread(balanced)).toBeLessThan(30);
    expect(balanced[1]).toBeGreaterThan(auto[1] + 20);
  });

  it("overflow-wrap: break-word moves a word that fits a line instead of splitting it", async () => {
    // "happens" fits a whole line, so it must move there as a unit. The engine
    // split every word into characters and then filled the line to its pixel
    // edge, cutting the word ("... building hap" / "pens together").
    const doc = (wrap: string) =>
      `<div style="width:400px;font-family:'RobotoProbe',sans-serif;font-size:32px;line-height:40px;color:#000;${wrap}">The future of building <span style="color:#f00">happens</span> together</div>`;
    const redInRows = (img: PNG, from: number, to: number) => {
      let count = 0;
      for (let y = from; y < to; y++)
        for (let x = 0; x < img.width; x++) if (isRedPixel(img, x, y)) count++;
      return count;
    };
    // Split the two lines anywhere between them; the probe font may or may not be
    // available, so the exact line box height is not part of the assertion.
    const split = (img: PNG) => Math.floor(img.height / 2);

    const broken = await renderProbeText(doc("overflow-wrap:break-word"), 400);
    expect(broken.height).toBeGreaterThan(60); // two lines, not one
    expect(broken.height).toBeLessThan(100); // not three
    expect(redInRows(broken, 0, split(broken))).toBe(0); // no part of "happens" on line 1
    expect(redInRows(broken, split(broken), broken.height)).toBeGreaterThan(0);

    // anywhere still breaks inside the word to fill the line.
    const anywhere = await renderProbeText(doc("overflow-wrap:anywhere"), 400);
    expect(redInRows(anywhere, 0, split(anywhere))).toBeGreaterThan(0);
  });

  it("grid-auto-rows sizes implicit rows", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="display:grid;grid-template-columns:40px;grid-template-rows:10px;grid-auto-rows:40px;width:40px;font-size:0">
        <div style="height:0"></div><div style="height:0"></div><div style="height:0"></div></div></body></html>`,
      width: 40,
      format: "png",
    });
    expect(r.height).toBe(90); // 10 + 40 + 40; implicit rows used to be content-sized
  });

  it("grid-auto-flow: row dense backfills holes left by spanning items", async () => {
    const r = await render({
      value: `<html><body style="margin:0"><div style="display:grid;grid-template-columns:40px 40px;grid-auto-flow:row dense;grid-auto-rows:20px;width:80px">
        <div style="background:#f00"></div>
        <div style="grid-column:span 2;background:#00f"></div>
        <div style="background:#0f0"></div></div></body></html>`,
      width: 80,
      format: "png",
    });
    expect(r.height).toBe(40); // the third item fills row 1's free cell; sparse put it on row 3
  });

  it("grid-auto-flow: column places items down each column before moving right", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-auto-flow:column;grid-template-rows:20px 20px;grid-auto-columns:30px;width:90px">
         <div style="background:#f00"></div><div style="background:#00f"></div>
         <div style="background:#0f0"></div><div style="background:#ff0"></div>
         <div style="background:#f0f"></div>
       </div>`,
      120,
      60,
    );
    expect(near(at(15, 10), RED)).toBe(true); // col 0, row 0
    expect(near(at(15, 30), BLUE)).toBe(true); // col 0, row 1
    expect(near(at(45, 10), [0, 255, 0])).toBe(true); // col 1, row 0
    expect(near(at(45, 30), [255, 255, 0])).toBe(true); // col 1, row 1
    expect(near(at(75, 10), [255, 0, 255])).toBe(true); // col 2, row 0
  });

  it("font-feature-settings applies OpenType features (kern off changes AV spacing)", async () => {
    const base = await renderProbeText(probeLine("", "AVAVAVAVAV"));
    const off = await renderProbeText(
      probeLine("font-feature-settings:'kern' 0", "AVAVAVAVAV"),
    );
    expect(off.data.equals(base.data)).toBe(false);
  });

  it("font-variant-ligatures: none disables common ligatures", async () => {
    const base = await renderProbeText(probeLine("", "office ffi fl"));
    const none = await renderProbeText(
      probeLine("font-variant-ligatures:none", "office ffi fl"),
    );
    expect(none.data.equals(base.data)).toBe(false);
  });

  it("font-feature-settings is resolved per element (font cache key includes features)", async () => {
    const img = await renderProbeText(
      probeLine("", "AVAVAVAVAV") + probeLine("font-feature-settings:'kern' 0", "AVAVAVAVAV"),
    );
    const row = (y: number) => img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
    // Same text in both lines; only the second line has kerning disabled.
    expect(row(45).equals(row(135))).toBe(false);
  });

  it("font-kerning: none turns the kern feature off, normal keeps it on", async () => {
    const base = await renderProbeText(probeLine("", "AVAVAVAVAV"));
    const none = await renderProbeText(
      probeLine("font-kerning:none", "AVAVAVAVAV"),
    );
    const normal = await renderProbeText(
      probeLine("font-kerning:normal", "AVAVAVAVAV"),
    );
    // Without kerning the AV pairs are not tightened any more.
    expect(none.data.equals(base.data)).toBe(false);
    expect(none.data.equals(normal.data)).toBe(false);
    // The font kerns by itself, so `normal` looks like the initial value.
    expect(normal.data.equals(base.data)).toBe(true);
  });

  it("font-variation-settings sets an axis of a variable font", async () => {
    const base = await renderProbeText(
      probeLine("", "Handgloves", "'RobotoVar'"),
      800,
      VAR_PROBE_FONT_FACE,
    );
    const heavy = await renderProbeText(
      probeLine("font-variation-settings:'wght' 900", "Handgloves", "'RobotoVar'"),
      800,
      VAR_PROBE_FONT_FACE,
    );
    // The wght axis moves the glyphs to the heavy instance.
    expect(heavy.data.equals(base.data)).toBe(false);
  });

  it("font-stretch sets the width axis of a variable font", async () => {
    const base = await renderProbeText(
      probeLine("", "Handgloves", "'RobotoFlex'"),
      800,
      FLEX_PROBE_FONT_FACE,
    );
    const condensed = await renderProbeText(
      probeLine("font-stretch:75%", "Handgloves", "'RobotoFlex'"),
      800,
      FLEX_PROBE_FONT_FACE,
    );
    const expanded = await renderProbeText(
      probeLine("font-stretch:expanded", "Handgloves", "'RobotoFlex'"),
      800,
      FLEX_PROBE_FONT_FACE,
    );
    // The wdth axis is set from the requested width.
    expect(condensed.data.equals(base.data)).toBe(false);
    expect(expanded.data.equals(base.data)).toBe(false);
    expect(condensed.data.equals(expanded.data)).toBe(false);
  });

  it("image-rendering: pixelated keeps scaled images unfiltered (img and background)", async () => {
    // 2x1 source: pure red then pure blue. Upscaled, nearest sampling preserves a hard
    // boundary at the halfway point; the default linear filter blends across it.
    const png = new PNG({ width: 2, height: 1 });
    png.data.set([255, 0, 0, 255, 0, 0, 255, 255]);
    const url = "data:image/png;base64," + PNG.sync.write(png).toString("base64");

    const img = await renderPng(
      `<img src="${url}" style="display:block;width:100px;height:100px;image-rendering:pixelated">`,
    );
    expect(near(img.at(49, 50), RED, 4)).toBe(true);
    expect(near(img.at(50, 50), BLUE, 4)).toBe(true);

    const bg = await renderPng(
      `<div style="width:100px;height:100px;image-rendering:pixelated;
         background-image:url('${url}');background-size:100px 100px;background-repeat:no-repeat"></div>`,
    );
    expect(near(bg.at(49, 50), RED, 4)).toBe(true);
    expect(near(bg.at(50, 50), BLUE, 4)).toBe(true);
  });

  it("offset-path: ray() + offset-distance translates the box along the ray", async () => {
    // offset-position: auto puts the ray origin at the element's top-left; the anchor
    // (offset-anchor: auto => transform-origin) is the box centre, so the box slides so
    // its centre lands on the ray point at 100px to the right.
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:20px;height:20px;background:#f00;
         offset-path:ray(90deg);offset-position:auto;offset-distance:100px"></div>`,
    );
    expect(near(at(100, 5), RED)).toBe(true); // centre moved from (10,10) to (100,0)
    expect(isWhite(at(10, 10))).toBe(true); // original location is empty
  });

  it("offset-path: path() places the box at offset-distance along the path", async () => {
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:20px;height:20px;background:#f00;
         offset-path:path('M 0 0 L 200 0');offset-distance:50px"></div>`,
    );
    expect(near(at(50, 5), RED)).toBe(true); // centre at (50,0)
    expect(isWhite(at(10, 10))).toBe(true);
  });

  it("offset-rotate: auto rotates the box along the path direction", async () => {
    // ray(180deg) points down, so auto rotate is +90deg. A 40x20 box becomes 20x40.
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:40px;height:20px;background:#f00;
         offset-path:ray(180deg);offset-position:auto;offset-distance:0px;offset-rotate:auto"></div>`,
    );
    expect(near(at(5, 10), RED)).toBe(true); // rotated box covers x[-10,10]
    expect(isWhite(at(30, 5))).toBe(true); // would be red if it stayed unrotated
  });

  it("offset shorthand rejects an offset-rotate before the path", async () => {
    // The first declaration is valid; the second one has its components out of
    // order (rotate before path), so the whole declaration must be dropped and
    // the first one must keep applying. If the invalid declaration were
    // partially applied, the 40x8 box would additionally be rotated by 30deg.
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:40px;height:8px;background:#f00;
         offset:path('M 0 0 L 200 0') 60px;
         offset:30deg path('M 0 0 L 200 0') 60px"></div>`,
    );
    expect(near(at(60, 2), RED)).toBe(true); // still at distance 60 on the path
    expect(isWhite(at(60, 8))).toBe(true); // a 30deg rotation would cover this
  });

  it("offset-rotate: an explicit 0deg angle suppresses the tangent rotation", async () => {
    // ray(180deg) points down, so `auto` would rotate the box by +90deg. An explicit
    // 0deg must keep the box axis-aligned even though the angle value is zero.
    const { at } = await renderPng(
      `<div style="position:absolute;left:0;top:0;width:40px;height:20px;background:#f00;
         offset-path:ray(180deg);offset-position:auto;offset-distance:100px;offset-rotate:0deg"></div>`,
    );
    expect(near(at(0, 100), RED)).toBe(true); // unrotated box covers x[-20,20] y[90,110]
    expect(isWhite(at(0, 85))).toBe(true); // a +90deg rotation would cover y[80,120]
  });

  // ── offset reference box (Chromium oracle, measured with Blink 155/156) ──
  // Chromium resolves ray() origins and <basic-shape> geometry against the
  // containing block, even when the element sits inside a transformed ancestor.
  // The probes below pin that basis so a switch to the element's own border box
  // (or a double-applied ancestor transform) shows up as a moved box.

  it("offset-path: an explicit offset-position resolves against the containing block inside a transformed ancestor", async () => {
    // The element is at (30,20) inside a 200x150 containing block, so the two
    // candidate bases differ: containing block (100,50) vs element box (130,70).
    // Chromium uses (100,50); ray(90deg) + 40px puts the centre at (140,50) and
    // the ancestor's translate(50px,30px) moves the painted box to (180,70).
    // (The ancestor transform applies exactly once.)
    const { img } = await renderPng(
      `<div style="position:absolute;left:0;top:0;transform:translate(50px,30px);width:200px;height:150px;background:#eee">
         <div style="position:absolute;left:30px;top:20px;width:20px;height:20px;background:#f00;
           offset-path:ray(90deg);offset-position:100px 50px;offset-distance:40px"></div>
       </div>`,
    );
    expect(colorBox(img, isReddish)).toEqual({ x0: 180, y0: 70, x1: 199, y1: 89, n: 400 });
  });

  it("offset-path: a basic-shape circle resolves against the containing block inside and outside a transformed ancestor", async () => {
    // Chromium: circle centre (10,40) + radius 20 -> path start (30,40), where
    // the box centre lands. An element-border-box basis would start at (70,80).
    const outside = await renderPng(
      `<div style="position:absolute;left:40px;top:40px;width:40px;height:40px;background:#f00;
         offset-path:circle(20px at 10px 40px);offset-distance:0"></div>`,
    );
    expect(colorBox(outside.img, isReddish)).toEqual({ x0: 10, y0: 20, x1: 49, y1: 59, n: 1600 });

    // Same shape inside a translated ancestor: the circle stays in the outer
    // containing block's coordinates (start (30,10)), then translate(50px,30px).
    const inside = await renderPng(
      `<div style="position:absolute;left:0;top:0;transform:translate(50px,30px);width:150px;height:120px;background:#eee">
         <div style="position:absolute;left:20px;top:20px;width:40px;height:40px;background:#f00;
           offset-path:circle(20px at 10px 10px);offset-distance:0"></div>
       </div>`,
    );
    expect(colorBox(inside.img, isReddish)).toEqual({ x0: 60, y0: 20, x1: 99, y1: 59, n: 1600 });
  });

  it("text-decoration-skip-ink: auto interrupts the underline at the descenders", async () => {
    const base = "text-decoration:underline;text-decoration-color:#f00";
    // `auto` is the initial value: the ink of the descenders is skipped.
    const auto_ = decorationLine(await renderProbeText(probeLine(base, "gjpq")));
    const none = decorationLine(
      await renderProbeText(probeLine(`${base};text-decoration-skip-ink:none`, "gjpq")),
    );
    expect(auto_.row).toBe(none.row);
    // g/j/p/q punch holes into the underline, so fewer pixels stay red.
    expect(auto_.count).toBeLessThan(none.count);
  });

  it("decoration lines: auto thickness is a tenth of the font size, on whole rows, overline above the text", async () => {
    const rows = async (line: string, size: number, lineHeight: string) => {
      const { img } = await renderPng(
        `<div style="font-size:${size}px;line-height:${lineHeight};text-decoration:${line};text-decoration-color:#f00;text-decoration-skip-ink:none">Hxg</div>`,
        200,
        size * 3,
      );
      const hit: number[] = [];
      for (let y = 0; y < img.height; y++) {
        let n = 0;
        for (let x = 0; x < img.width; x++) if (isRedPixel(img, x, y)) n++;
        if (n > 5) hit.push(y);
      }
      return hit;
    };
    // 60px text: a 6px line, whatever the line kind (the old fixed default was 1px).
    const under = await rows("underline", 60, "120px");
    const over = await rows("overline", 60, "120px");
    const through = await rows("line-through", 60, "120px");
    for (const r of [under, over, through]) {
      expect(r.length).toBe(6);
      expect(r[5] - r[0]).toBe(5); // contiguous
    }
    // The strike runs through the x-height, the underline hangs below the baseline.
    expect(over[5]).toBeLessThan(through[0]);
    expect(through[5]).toBeLessThan(under[0]);
    // 12px text: a single crisp row, not a blur over two.
    expect((await rows("underline", 12, "24px")).length).toBe(1);
    expect((await rows("line-through", 12, "24px")).length).toBe(1);
    // The overline sits on top of the text box, outside the content area.
    const probe = await rows("overline", 30, "90px");
    const plain = await renderPng(
      `<div style="font-size:30px;line-height:90px">Hxg</div>`,
      200,
      90,
    );
    let inkTop = -1;
    for (let y = 0; y < plain.img.height && inkTop < 0; y++) {
      for (let x = 0; x < plain.img.width; x++) {
        if (plain.at(x, y)[0] < 128) {
          inkTop = y;
          break;
        }
      }
    }
    expect(probe[probe.length - 1]).toBeLessThan(inkTop);
  });

  it("text-decoration-thickness: a percentage is relative to the font size", async () => {
    const base =
      "text-decoration:underline;text-decoration-color:#f00;text-decoration-skip-ink:none";
    // A percentage of text-decoration-thickness refers to the font size of
    // the element, so 50% of the 60px probe font is 30px.
    const percent = await renderProbeText(
      probeLine(`${base};text-decoration-thickness:50%`, "Hxg"),
    );
    const length = await renderProbeText(
      probeLine(`${base};text-decoration-thickness:30px`, "Hxg"),
    );
    expect(decorationLine(percent).row).toBe(decorationLine(length).row);
    expect(redPixels(percent)).toBe(redPixels(length));
  });

  // CJK probe font: ::first-letter and text-emphasis need full-width glyphs to
  // have known character cells, so these probes load Noto Sans JP like the
  // vertical cases do.
  const CJK_PROBE_FONT_FACE =
    "@font-face{font-family:'NotoProbe';font-style:normal;font-weight:400;src:url(https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2) format('woff2')}";

  // In a 40px full-width line the character cells are 40px wide. Horizontal
  // text advances along x, vertical-rl text advances down y (one column here).
  const countRed = (img: PNG, x0: number, x1: number, y0: number, y1: number) => {
    let count = 0;
    for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++)
        if (isRedPixel(img, x, y)) count++;
    return count;
  };
  const redInHorizontalCell = (img: PNG, cell: number) =>
    countRed(img, cell * 40, (cell + 1) * 40, 0, img.height);
  // vertical-rl: the line advances down the page, one 40px row band per character.
  const redInVerticalCell = (img: PNG, cell: number) =>
    countRed(img, 0, img.width, cell * 40, (cell + 1) * 40);

  it("::first-letter includes the trailing closing punctuation (horizontal)", async () => {
    // CSS Selectors-4: the first letter unit plus any following punctuation
    // (Pe/Pf/Po) belongs to ::first-letter, so 「あ」 is wrapped as a whole.
    const html = `<html><head><style>${CJK_PROBE_FONT_FACE}
      body{margin:0;background:#fff}
      p{margin:0;font-size:40px;line-height:1.4;color:#000;font-family:'NotoProbe',sans-serif}
      p::first-letter{color:#f00}</style></head><body><p>「あ」</p></body></html>`;
    const { data } = await render({ value: html, width: 300, format: "png" });
    const img = PNG.sync.read(Buffer.from(data));
    // Cell 0 is the opening bracket, cell 1 the letter, cell 2 the closing bracket.
    expect(redInHorizontalCell(img, 0)).toBeGreaterThan(5);
    expect(redInHorizontalCell(img, 1)).toBeGreaterThan(5);
    expect(redInHorizontalCell(img, 2)).toBeGreaterThan(5);
  });

  it("::first-letter includes the trailing closing punctuation (vertical)", async () => {
    const html = `<html><head><style>${CJK_PROBE_FONT_FACE}
      body{margin:0;background:#fff}
      p{margin:0;font-size:40px;writing-mode:vertical-rl;height:200px;color:#000;font-family:'NotoProbe',sans-serif}
      p::first-letter{color:#f00}</style></head><body><p>「あ」</p></body></html>`;
    const { data } = await render({ value: html, width: 300, format: "png" });
    const img = PNG.sync.read(Buffer.from(data));
    // Vertical-rl advances down the page, so the character cells are 40px row
    // bands and the probe has a single column.
    expect(redInVerticalCell(img, 0)).toBeGreaterThan(5);
    expect(redInVerticalCell(img, 1)).toBeGreaterThan(5);
    expect(redInVerticalCell(img, 2)).toBeGreaterThan(5);
  });

  it("position:fixed/absolute fill the containing block with top+bottom/left+right and auto size", async () => {
    // CSS 2.1 10.6.4/10.3.7: when top+bottom (or left+right) are set and the
    // height/width is auto, the border box spans the containing block remainder.
    // A content-box element must subtract its own padding/border from that
    // remainder instead of adding it on top (which overflows by exactly that much).
    const GREEN: Rgb = [0, 255, 0];

    // viewport 300x200, fixed containing block = viewport.
    // Remainder: 300-20-40 = 240 wide, 200-20-40 = 140 tall.
    const fixed = await renderPng(
      `<div style="position:fixed;left:20px;right:40px;top:20px;bottom:40px;
         padding:10px;background:#00f"></div>`,
    );
    expect(near(fixed.at(25, 30), BLUE)).toBe(true);
    expect(near(fixed.at(255, 30), BLUE)).toBe(true);
    expect(isWhite(fixed.at(265, 30))).toBe(true); // would be blue if width grew by padding
    expect(near(fixed.at(25, 155), BLUE)).toBe(true);
    expect(isWhite(fixed.at(25, 165))).toBe(true); // would be blue if height grew by padding

    // absolute containing block = the 300x160 relative wrapper.
    // Remainder: 300-20-40 = 240 wide, 160-10-30 = 120 tall.
    const absolute = await renderPng(
      `<div style="position:relative;width:300px;height:160px">
         <div style="position:absolute;left:20px;right:40px;top:10px;bottom:30px;
           padding:10px;background:#0f0"></div>
       </div>`,
    );
    expect(near(absolute.at(255, 15), GREEN)).toBe(true);
    expect(isWhite(absolute.at(265, 15))).toBe(true);
    expect(near(absolute.at(25, 125), GREEN)).toBe(true);
    expect(isWhite(absolute.at(25, 145))).toBe(true);
  });

  // Total dark ink of an image: a mark per glyph can only add ink, so comparing
  // the counts detects whether the custom emphasis character is painted at all
  // (the probe font has no descenders to confound the count).
  const darkPixels = (img: PNG) => {
    let count = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (img.width * y + x) * 4;
        if (img.data[i + 3] > 0 && img.data[i] < 128) count++;
      }
    return count;
  };

  it("text-emphasis: a custom string paints the character (horizontal)", async () => {
    // text-emphasis-style: <string> replaces the filled/open shapes with the
    // given character, drawn once per glyph. A ● is a much bigger mark than the
    // keyword dot, so the ink tells the two apart (and a missing mark paints
    // less ink than the dot).
    const renderCase = async (emphasis: string) => {
      const html = `<html><head><style>${CJK_PROBE_FONT_FACE}
        body{margin:0;background:#fff}
        div{margin:0;font-size:40px;line-height:2;color:#000;font-family:'NotoProbe',sans-serif;${emphasis}}</style></head>
        <body><div>ああああ</div></body></html>`;
      const { data } = await render({ value: html, width: 400, format: "png" });
      return PNG.sync.read(Buffer.from(data));
    };
    const dot = await renderCase("text-emphasis:filled dot");
    const shorthand = await renderCase("text-emphasis:'●'");
    const longhand = await renderCase("text-emphasis-style:'●'");
    expect(darkPixels(shorthand)).toBeGreaterThan(darkPixels(dot) + 300);
    expect(darkPixels(longhand)).toBeGreaterThan(darkPixels(dot) + 300);
  });

  it("text-emphasis: a custom string paints the character (vertical)", async () => {
    const renderCase = async (emphasis: string) => {
      const html = `<html><head><style>${CJK_PROBE_FONT_FACE}
        body{margin:0;background:#fff}
        div{margin:0;font-size:40px;line-height:2;color:#000;writing-mode:vertical-rl;height:200px;font-family:'NotoProbe',sans-serif;${emphasis}}</style></head>
        <body><div>ああああ</div></body></html>`;
      const { data } = await render({ value: html, width: 300, format: "png" });
      return PNG.sync.read(Buffer.from(data));
    };
    const dot = await renderCase("text-emphasis:filled dot");
    const shorthand = await renderCase("text-emphasis:'●'");
    const longhand = await renderCase("text-emphasis-style:'●'");
    expect(darkPixels(shorthand)).toBeGreaterThan(darkPixels(dot) + 300);
    expect(darkPixels(longhand)).toBeGreaterThan(darkPixels(dot) + 300);
  });
  it("a class + attribute compound selector checks the attribute", async () => {
    // `.n[data-open=true]` used to drop the [..] block while parsing the class name, so it
    // matched every .n element (MDN's closed navigation became position:fixed and collapsed).
    const { at } = await renderPng(
      `<style>.n[data-open=true]{background:#f00}.n{height:20px;background:#00f}</style>
       <div class="n" data-open="false"></div>`,
      100,
      30,
    );
    expect(near(at(50, 10), BLUE)).toBe(true);
    const on = await renderPng(
      `<style>.n[data-open=true]{background:#f00}.n{height:20px;background:#00f}</style>
       <div class="n" data-open="true"></div>`,
      100,
      30,
    );
    expect(near(on.at(50, 10), RED)).toBe(true);
  });

  it("calc() multiplies a length by a number on either side and over a parenthesised sum", async () => {
    // MDN gates its layout on calc(1rem * 2 + (15rem + 2rem) * 2 + 31rem) = 67rem (1072px), so
    // at 1000px the narrow-layout rules must apply. Heights keep the probe text-free.
    const { at } = await renderPng(
      `<style>
         .a{height:10px;width:calc(2 * 10px)}
         .b{height:10px;width:calc((10px + 20px) * 2)}
         .c{height:10px;width:calc(10px * 3 + 40px)}
       </style><div class="a" style="background:#00f"></div><div class="b" style="background:#00f"></div><div class="c" style="background:#00f"></div>`,
      200,
      40,
    );
    expect(near(at(15, 5), BLUE)).toBe(true); // 2 * 10px = 20px
    expect(isWhite(at(25, 5))).toBe(true);
    expect(near(at(55, 15), BLUE)).toBe(true); // (10 + 20) * 2 = 60px
    expect(isWhite(at(65, 15))).toBe(true);
    expect(near(at(65, 25), BLUE)).toBe(true); // 10 * 3 + 40 = 70px
    expect(isWhite(at(75, 25))).toBe(true);
  });

  it("grid minmax(<length>, <length>) tracks grow to their maximum before fr tracks", async () => {
    // MDN: [..] minmax(15rem,1fr) 2rem minmax(0,48rem) minmax(0,1fr). The content track is not
    // content-sized: it takes the free space up to 48rem, leaving the fr tracks at their minimum.
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:minmax(40px,1fr) 10px minmax(0,150px) minmax(0,1fr);width:200px;height:10px">
         <div style="background:#f00"></div><div></div><div style="background:#00f"><i style="display:block;width:5px"></i></div>
       </div>`,
      300,
      20,
    );
    expect(near(at(20, 5), RED)).toBe(true); // 40px track
    expect(near(at(60, 5), BLUE)).toBe(true); // 150px track starts at 50
    expect(near(at(195, 5), BLUE)).toBe(true);
    expect(isWhite(at(205, 5))).toBe(true); // 40 + 10 + 150 = 200
  });
  it("linked stylesheets cascade in document order, not fetch-completion order", async () => {
    // python.org links style.css (large, slow) before mq.css (small, fast). The small sheet
    // used to land first and then lose to the later arrival, so its min-width rules
    // (`float:right`) never won and the header collapsed into a column.
    const html = `<html><head><link rel="stylesheet" href="slow.css"><link rel="stylesheet" href="fast.css"></head>
      <body style="margin:0;background:#fff"><div class="b" style="height:20px"></div></body></html>`;
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
      } else if (req.url === "/slow.css" || req.url === "/fast.css") {
        const slow = req.url === "/slow.css";
        setTimeout(() => {
          res.writeHead(200, { "content-type": "text/css" });
          res.end(slow ? ".b{background:#f00}" : ".b{background:#00f}");
        }, slow ? 300 : 0);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 100,
        height: 40,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const i = (img.width * 10 + 10) * 4;
      // fast.css is later in the document, so its blue wins over slow.css's red.
      expect(near([img.data[i], img.data[i + 1], img.data[i + 2]], BLUE)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("a shrink-to-fit float is as wide as its inline content plus the float beside it", async () => {
    // Chromium's max-content for `Donate <float:right bar>` is the line plus the float. Taking
    // only the wider of the two made the box too narrow and the float wrapped below the text.
    const { at } = await renderPng(
      `<div style="width:300px"><div style="float:right">
         <span style="display:inline-block;width:40px;height:10px;background:#f00"></span>
         <div style="float:right;width:100px;height:10px;background:#00f"></div></div></div>`,
      300,
      40,
    );
    expect(near(at(165, 8), RED)).toBe(true); // inline part starts at 300 - 140 (sits on the baseline)
    expect(near(at(250, 5), BLUE)).toBe(true); // float beside it on the same row
    expect(isWhite(at(250, 25))).toBe(true); // nothing wrapped to a second row
  });
  it("floats whose percentage widths sum to exactly 100% stay on one row", async () => {
    // python.org's four .small-widget columns: 4 * 23.40426% + 3 * 2.12766% = 100%. Float
    // rounding made the last one overshoot the line by a hair and wrap below the others.
    const w = "float:left;height:10px;width:23.40426%;margin-right:2.12766%";
    const { at } = await renderPng(
      `<div style="width:948px"><div style="${w};background:#f00"></div><div style="${w};background:#0f0"></div>
         <div style="${w};background:#00f"></div><div style="${w};margin-right:0;background:#f0f"></div></div>`,
      1000,
      30,
    );
    expect(near(at(900, 5), [255, 0, 255])).toBe(true); // fourth column, first row
    expect(isWhite(at(900, 15))).toBe(true); // nothing wrapped to a second row
  });
  it("the media attribute of <style> and <link rel=stylesheet> limits where the sheet applies", async () => {
    // `element` keeps no attributes, so <style media> was dropped and print-only CSS applied on
    // screen; fetched <link media> sheets were concatenated without their media query.
    const paint = async (media: string) => {
      const { at } = await renderPng(
        `<style>div{height:20px;background:#f00}</style><style media="${media}">div{background:#00f}</style><div></div>`,
        100,
        30,
      );
      return near(at(50, 10), BLUE);
    };
    expect(await paint("screen")).toBe(true);
    expect(await paint("not print, braille")).toBe(true);
    expect(await paint("(min-width: 50px)")).toBe(true);
    expect(await paint("print")).toBe(false);
    expect(await paint("not screen")).toBe(false);
    expect(await paint("(min-width: 600px)")).toBe(false);

    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><link rel="stylesheet" href="base.css"><link rel="stylesheet" media="print" href="print.css">
          <link rel="stylesheet" media="screen" href="screen.css"></head>
          <body style="margin:0"><div class="a"></div><div class="b"></div></body></html>`);
      } else if (req.url === "/base.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end("div{height:10px;background:#f00}");
      } else if (req.url === "/print.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".a{background:#0f0}");
      } else if (req.url === "/screen.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".b{background:#00f}");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 100,
        height: 30,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const at = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      expect(near(at(50, 5), RED)).toBe(true); // print.css must not turn .a green
      expect(near(at(50, 15), BLUE)).toBe(true); // screen.css applies to .b
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("-webkit-linear-gradient() uses the legacy angle and side-keyword syntax", async () => {
    // The prefixed function was not recognised at all (vuejs.org's gradient headline text vanished).
    const paint = async (grad: string) => {
      const { at } = await renderPng(`<div style="width:100px;height:40px;background:${grad}"></div>`, 100, 40);
      return at;
    };
    const lr = await paint("-webkit-linear-gradient(left, #f00, #00f)");
    expect(lr(5, 20)[0]).toBeGreaterThan(200);
    expect(lr(95, 20)[2]).toBeGreaterThan(200);
    const tb = await paint("-webkit-linear-gradient(top, #f00, #00f)");
    expect(tb(50, 2)[0]).toBeGreaterThan(200);
    expect(tb(50, 37)[2]).toBeGreaterThan(200);
    const ang = await paint("-webkit-linear-gradient(0deg, #f00, #00f)"); // 0deg legacy = towards east
    expect(ang(5, 20)[0]).toBeGreaterThan(200);
    expect(ang(95, 20)[2]).toBeGreaterThan(200);
  });
  it("columns:N balances the columns by content size, not by item count", async () => {
    // Items were dealt out evenly by count: {a,b},{c,tall} made the second column 6 lines tall
    // where Chromium balances to {a,b,c},{tall} (5 lines).
    const line = (t: string) => `<div style="height:20px">${t}</div>`;
    const r = await render({
      value: `<!DOCTYPE html><body style="margin:0"><div style="columns:2"><div style="break-inside:avoid">${line("a")}</div><div style="break-inside:avoid">${line("b")}</div><div style="break-inside:avoid">${line("c")}</div><div style="break-inside:avoid">${[1, 2, 3, 4, 5].map((n) => line(`t${n}`)).join("")}</div></div>`,
      width: 400,
      format: "png",
    });
    expect(r.height).toBeLessThanOrEqual(110);
  });
  it("a percentage flex-basis resolves against a definite width when a column flex item is measured", async () => {
    // A stretched column flex item was measured as shrink-to-fit content and its row flex child
    // turned `flex: 0 32%` into max-content: the boxes wrapped one per row and the wrapper took
    // that height (vuejs.org's feature boxes left a ~180px gap).
    const txt = "Truly reactive, compiler-optimized rendering system that rarely requires manual optimization.";
    const box = `<div class="b"><p>${txt}</p></div>`;
    const r = await render({
      value: `<!DOCTYPE html><style>*{box-sizing:border-box}body{margin:0}.a{display:flex;flex-direction:column}.c{display:flex;flex-wrap:wrap}.b{flex:0 32%;padding:28px 36px}p{margin:0}</style><div class="a"><div><section class="c">${box.repeat(3)}</section></div></div>`,
      width: 1000,
      format: "png",
    });
    expect(r.height).toBeLessThan(170); // Chromium: 152 (one row), was 237
  });
  it('<link rel="preload stylesheet"> loads the sheet; "alternate stylesheet" does not', async () => {
    // rel is a token list. Only the exact string "stylesheet" was recognised, so vuejs.org
    // (rel="preload stylesheet") rendered completely unstyled.
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><link rel="preload stylesheet" href="a.css" as="style">
          <link rel="alternate stylesheet" href="b.css"></head>
          <body style="margin:0"><div class="a"></div><div class="b"></div></body></html>`);
      } else if (req.url === "/a.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end("div{height:10px;background:#f00}.a{background:#00f}");
      } else if (req.url === "/b.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".b{background:#0f0}");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 100,
        height: 30,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const at = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      expect(near(at(50, 5), BLUE)).toBe(true); // a.css applied
      expect(near(at(50, 15), RED)).toBe(true); // b.css (alternate) ignored
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("position:relative offsets an inline box once, background and text together", async () => {
    // The offset was applied again each time the line box was finished (text drifted 6x the
    // requested distance and left the page) and never reached the inline box's background.
    const redBox = async (offset: string) => {
      const { img } = await renderPng(
        `<div style="font:14px/20px sans-serif"><a style="background:#f00;position:relative;${offset}">Donate Donate</a></div>`,
        300,
        100,
      );
      let minX = 999, maxX = -1, minY = 999, maxY = -1;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i] === 255 && img.data[i + 1] === 0 && img.data[i + 2] === 0) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
      return { minX, maxX, minY, maxY };
    };
    const base = await redBox("top:0");
    const down = await redBox("top:19px");
    const right = await redBox("left:50px");
    const bottom = await redBox("bottom:-7px");
    expect(down.minY - base.minY).toBe(19);
    expect(down.maxY - base.maxY).toBe(19);
    expect(right.minX - base.minX).toBe(50);
    expect(right.maxX - right.minX).toBe(base.maxX - base.minX); // same width, just moved
    expect(bottom.minY - base.minY).toBe(7);
  });
  it("relative url() in a linked stylesheet resolves against the stylesheet, not the page", async () => {
    // python.org links /static/stylesheets/style.css, whose fonts and images are
    // `url(../fonts/..)`. They were resolved against the page (`/fonts/..`), failed, and the
    // text fell back to a wider font that pushed the header out of shape.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#0000ff"/></svg>`;
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><link rel="stylesheet" href="static/css/site.css"></head>
          <body style="margin:0"><div class="b"></div></body></html>`);
      } else if (req.url === "/static/css/site.css") {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(".b{width:20px;height:20px;background:url(../img/p.svg)}");
      } else if (req.url === "/static/img/p.svg") {
        res.writeHead(200, { "content-type": "image/svg+xml" });
        res.end(svg);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 60,
        height: 30,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const i = (img.width * 10 + 10) * 4;
      expect(near([img.data[i], img.data[i + 1], img.data[i + 2]], BLUE)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("an absolutely positioned box between inline items does not break the line", async () => {
    // python.org's search form holds a visually hidden `position:absolute` <label> between
    // inline-blocks. It was treated as a block-level child and split the line in three.
    const html = (mid: string) =>
      `<div style="font:14px/20px sans-serif;display:inline-block;background:#eee">
         <span style="display:inline-block;width:30px;height:20px;background:#f00"></span>${mid}
         <span style="display:inline-block;width:100px;height:20px;background:#00f"></span></div>`;
    const plain = await renderPng(html(""), 300, 100);
    const withAbs = await renderPng(
      html(`<label style="position:absolute;width:1px;height:1px;overflow:hidden">Search</label>`),
      300,
      100,
    );
    const rows = (img: PNG) => {
      let last = -1;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i] === 0 && img.data[i + 1] === 0 && img.data[i + 2] === 255) last = y;
        }
      }
      return last;
    };
    expect(rows(withAbs.img)).toBe(rows(plain.img)); // the blue box stays on the first line
  });
  it("stylesheet fill/stroke (classes, var(), light-dark()) paint inline SVG shapes", async () => {
    // The inline SVG was rebuilt from its attributes alone, so `.logo__letter{fill:...}` (MDN's
    // logo, every CSS-coloured icon) never applied and the shapes came out black.
    const cases: [string, string][] = [
      ["class", ".r{fill:#00f}"],
      ["descendant", "svg rect{fill:#00f}"],
      ["var", ":root{--c:#00f}.r{fill:var(--c)}"],
      ["var fallback", ".r{fill:var(--missing,#00f)}"],
      ["nested var", ":root{--a:#00f;--b:var(--a)}.r{fill:var(--b)}"],
      ["light-dark", ".r{fill:light-dark(#00f,#f00)}"],
      ["overrides attribute", ".r{fill:#00f}"],
    ];
    for (const [name, css] of cases) {
      const attr = name === "overrides attribute" ? ' fill="#f00"' : "";
      const { at } = await renderPng(
        `<style>${css}</style><svg width="20" height="20"><rect class="r" width="20" height="20"${attr}/></svg>`,
        40,
        30,
      );
      expect(near(at(10, 10), BLUE), name).toBe(true);
    }
    // An undefined variable without a fallback drops the declaration: the attribute survives.
    const { at } = await renderPng(
      `<style>.r{fill:var(--nope)}</style><svg width="20" height="20"><rect class="r" width="20" height="20" fill="#0000ff"/></svg>`,
      40,
      30,
    );
    expect(near(at(10, 10), BLUE)).toBe(true);
  });

  it("mask-image url() images are fetched before the final paint", async () => {
    // The mask image was only requested when the mask was painted, after the resource rounds,
    // so an http-hosted mask never loaded and hid its whole box (MDN's icon buttons).
    const circle = new PNG({ width: 24, height: 24 });
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const i = (y * 24 + x) * 4;
        circle.data[i + 3] = (x - 11.5) ** 2 + (y - 11.5) ** 2 < 100 ? 255 : 0;
      }
    }
    const png = PNG.sync.write(circle);
    const server = http.createServer((req, res) => {
      if (req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><body style="margin:0"><div style="width:24px;height:24px;background:#00f;mask-image:url(/c.png);mask-size:cover"></div></body></html>`);
      } else if (req.url === "/c.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(png);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const { data } = await render({
        url: `http://127.0.0.1:${port}/index.html`,
        width: 40,
        height: 30,
        format: "png",
      });
      const img = PNG.sync.read(Buffer.from(data));
      const px = (x: number, y: number): Rgb => {
        const i = (img.width * y + x) * 4;
        return [img.data[i], img.data[i + 1], img.data[i + 2]];
      };
      expect(near(px(12, 12), BLUE)).toBe(true); // inside the circle
      expect(img.data[(1 * img.width + 1) * 4 + 3]).toBe(0); // corner masked out
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("an absolute box with an auto height keeps its calc()/percentage width", async () => {
    // MDN's visually hidden skip links: `ul{position:absolute;width:calc(100% - 4px)}` holding
    // `a{position:absolute;left:0;right:0}`. The auto height made the box measure as shrink-to-fit,
    // which turned the calc() width into auto: the ul collapsed to its padding and the links
    // wrapped one letter per line, with the tail of the column showing at the top-left.
    const { at } = await renderPng(
      `<style>*{box-sizing:border-box}</style>
       <ul style="margin:0;list-style:none;position:absolute;top:0;left:2px;right:2px;padding-left:40px;width:calc(100% - 4px)">
         <li><a style="position:absolute;left:0;right:0;top:0;height:10px;background:#f00"></a></li></ul>`,
      300,
      30,
    );
    expect(near(at(20, 5), RED)).toBe(true); // inside the padding box
    expect(near(at(250, 5), RED)).toBe(true); // ... and far past the 40px padding
    expect(isWhite(at(299, 5))).toBe(true); // 2 + 296 = the box ends at 298
  });
  it("deeply nested flex containers do not re-measure their subtree exponentially", async () => {
    // Every flex container asks each item for its min-content and max-content size before the real
    // measure, and each of those recursed into the whole subtree: ~4^depth measures. nodejs.org's
    // hero (flex > flex-col > flex > inline-flex > inline-flex buttons) spent 10s and exhausted the
    // measure budget. Intrinsic-size queries are now memoized per pass (~3s -> ~0.3s here).
    const btn = `<a style="display:inline-flex;align-items:center;gap:4px;padding:2px 6px"><svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="#f00"/></svg></a>`;
    let html =
      `<div style="display:flex;justify-content:center">` +
      Array.from({ length: 3 }, () => `<div style="display:inline-flex;gap:4px">${btn}${btn}${btn}${btn}</div>`).join("") +
      `</div>`;
    for (let i = 0; i < 5; i++) {
      html = `<div style="display:flex;flex-direction:${i % 2 ? "row" : "column"};gap:4px"><div style="display:flex">x</div>${html}</div>`;
    }
    await renderPng("<p>warm up</p>", 100, 20);
    const t = Date.now();
    await renderPng(html, 600, 300);
    expect(Date.now() - t).toBeLessThan(1800);
  });
  it("white-space-only text between grid items makes no grid row, even with white-space:pre", async () => {
    // Shiki code blocks: `code{display:grid}` holding `<span class=line>` elements separated by
    // newline text. Under `pre` that text was an anonymous grid item that doubled every row.
    const grid = (sep: string) =>
      `<body style="margin:0"><div style="display:grid;white-space:pre;font:10px/10px sans-serif"><div>a</div>${sep}<div>b</div>${sep}<div>c</div></div></body>`;
    const withText = await render({ value: grid("\n"), width: 100, format: "png" });
    const without = await render({ value: grid(""), width: 100, format: "png" });
    expect(withText.height).toBe(without.height);
  });
  it("grid items with a definite width or height are not stretched to their area", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:100px 100px"><div style="width:60px;height:10px;background:#f00"></div><div style="height:10px;background:#00f"></div></div>
       <div style="display:grid;grid-template-columns:100px"><div style="width:50%;height:10px;background:#f00"></div></div>`,
      220,
      40,
    );
    expect(near(at(55, 5), RED)).toBe(true); // 60px wide
    expect(isWhite(at(65, 5))).toBe(true); // ... not the 100px column
    expect(near(at(150, 5), [0, 0, 255])).toBe(true); // an auto-width sibling still stretches
    expect(near(at(45, 15), RED)).toBe(true); // 50% of the 100px area
    expect(isWhite(at(55, 15))).toBe(true);
  });
  it("a grid item with a definite height reserves no extra line", async () => {
    const r = await render({
      value: `<body style="margin:0;font:16px sans-serif"><div style="display:grid"><div style="height:10px"></div><div style="height:10px"></div></div></body>`,
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(20);
  });
  it("default-sized monospace text is 13px like Chromium, unless a size was set explicitly", async () => {
    // Chromium's fixed-font quirk: `font-family: monospace` alone at the default size is 13px.
    // `<code>` also had no monospace rule at all. An ancestor's explicit px size opts out.
    const inkWidth = async (body: string) => {
      const { img } = await renderPng(body, 300, 40);
      let lo = 1e9;
      let hi = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          if (img.data[i] < 128) {
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
          }
        }
      return hi - lo;
    };
    const text = "mmmmmmmmmm";
    const plain = await inkWidth(`<code>${text}</code>`);
    const pre = await inkWidth(`<pre style="margin:0">${text}</pre>`);
    const sized = await inkWidth(`<div style="font-size:16px"><pre style="margin:0">${text}</pre></div>`);
    expect(Math.abs(plain - pre)).toBeLessThanOrEqual(1); // <code> is monospace as well
    expect(sized / plain).toBeGreaterThan(1.15); // 16px vs 13px
    expect(sized / plain).toBeLessThan(1.3);
  });
  it("a text input's height follows its padding and line-height instead of a fixed 21px", async () => {
    // python.org's search field: `padding:6.4px 8px 4.8px; line-height:26px` is 37px tall in Chromium;
    // the UA rule's fixed `height:21px` ignored both.
    const h = async (style: string) =>
      (await render({
        value: `<html><body style="margin:0"><input style="display:block;border:0;box-sizing:border-box;${style}"></body></html>`,
        width: 200,
        format: "png",
      })).height;
    expect(await h("padding:6px 8px 5px;line-height:26px;font-size:16px")).toBe(37);
    expect(await h("line-height:40px;font-size:16px;padding:0")).toBe(40);
  });
  it("an inline box's background stops at its border edge, not at its margins", async () => {
    // python.org's Donate button: `a{margin-right:8px;padding:0 12px;background:...}` was painted
    // 8px too wide because the margin was part of the inline fragment box.
    const { at } = await renderPng(
      `<div style="font:16px/20px monospace;padding-top:10px"><span style="margin:0 10px;padding:0 5px;background:#f00;color:#f00">xx</span></div>`,
      120,
      40,
    );
    expect(isWhite(at(4, 20))).toBe(true); // left margin
    expect(near(at(13, 20), RED)).toBe(true); // padding starts at 10px
    expect(near(at(10 + 5 + 16 + 5 - 3, 20), RED)).toBe(true);
    expect(isWhite(at(10 + 5 + 16 + 5 + 6, 20))).toBe(true); // right margin (box ends at ~36px)
  });
  it("grid items honor justify-items / align-items / justify-self / align-self", async () => {
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:100px;justify-items:center"><div style="height:10px;width:40px;background:#f00"></div></div>
       <div style="display:grid;grid-template-columns:100px;height:50px"><div style="height:10px;width:40px;background:#f00;align-self:end;justify-self:end"></div></div>`,
      200,
      70,
    );
    expect(near(at(35, 5), RED)).toBe(true); // centered in the 100px column: 30..70
    expect(isWhite(at(25, 5))).toBe(true);
    expect(isWhite(at(75, 5))).toBe(true);
    expect(near(at(80, 55), RED)).toBe(true); // end/end of the 100x50 area: x 60..100, y 50..60
    expect(isWhite(at(50, 55))).toBe(true);
  });
  it("an svg with width/height=\"100%\" sizes from its viewBox, also as a flex-column item", async () => {
    // react.dev's hero logo: `<svg width="100%" height="100%" viewBox=...>` (width set by a class) in a
    // flex column. "100%" was read as 100px by atof() and the percentage height resolved against
    // the viewport: the page grew to 600M px and the render failed.
    const page = (inner: string) =>
      `<!DOCTYPE html><html><body style="margin:0">${inner}</body></html>`;
    const svg = `<svg width="100%" height="100%" viewBox="0 0 21 18.9" style="width:84px"><rect width="21" height="18.9" fill="#f00"/></svg>`;
    const block = await render({ value: page(`<div>${svg}</div>`), width: 200, format: "png" });
    const flex = await render({ value: page(`<div style="display:flex;flex-direction:column">${svg}</div>`), width: 200, format: "png" });
    // 84 * 18.9 / 21, plus the strut's descent below the baseline the inline svg sits on (no vertical-align: middle)
    expect(block.height).toBeGreaterThan(75.6);
    expect(block.height).toBeLessThan(90);
    expect(Math.abs(flex.height - 75.6)).toBeLessThan(1);
  });
  it("equal-specificity rules apply in source order, not in the order of the element's classes", async () => {
    // react.dev: `.flex{display:flex}` ... `.uwu-visible{display:none}` on class="uwu-visible flex":
    // the class buckets were applied in attribute order, so `.flex` (listed second) won.
    const { at } = await renderPng(
      `<style>.flex{display:flex}.hide{display:none}.a{color:#f00}.b{color:#00f}</style>
       <div class="hide flex" style="height:20px;background:#f00"></div>
       <div class="b a" style="height:20px;background:currentColor"></div>`,
      60,
      40,
    );
    expect(near(at(30, 5), [0, 0, 255])).toBe(true); // .b is later than .a: blue, although `a` is listed last
    expect(isWhite(at(30, 25))).toBe(true); // the .hide.flex box is display:none, so nothing else is drawn
  });
  it("an inset box-shadow with a spread draws an inner ring (tailwind's shadow-*-stroke borders)", async () => {
    const { at } = await renderPng(
      `<div style="width:60px;height:30px;background:#fff;--s:inset 0 0 0 3px #f00;box-shadow:var(--a,0 0 #0000),var(--s)"></div>`,
      80,
      40,
    );
    expect(near(at(0, 15), RED)).toBe(true);
    expect(near(at(2, 15), RED)).toBe(true);
    expect(isWhite(at(4, 15))).toBe(true);
    expect(near(at(30, 1), RED)).toBe(true);
    expect(isWhite(at(30, 15))).toBe(true);
  });
  it("@supports follows Chromium: no margin-trim / -webkit-hyphens / -moz-*, but relative color syntax", async () => {
    // Tailwind v4's `@layer properties` sits behind a Safari/Firefox-only @supports hack; applying it
    // reset every --tw-* custom property to `initial` and inflated the layout.
    const h = async (cond: string) =>
      (await render({
        value: `<!DOCTYPE html><html><head><style>body{margin:0}@supports ${cond}{div{height:50px}}</style></head><body><div></div></body></html>`,
        width: 100,
        format: "png",
      })).height;
    const hit = await h("(display:block)");
    expect(hit).toBeGreaterThanOrEqual(50);
    for (const cond of ["(margin-trim:inline)", "(-webkit-hyphens:none)", "(-moz-orient:inline)"]) {
      expect(await h(cond)).toBeLessThan(50);
    }
    expect(await h("(color:rgb(from red r g b))")).toBeGreaterThanOrEqual(50);
    expect(await h("(not (margin-trim:inline))")).toBeGreaterThanOrEqual(50);
  });
  it("a transparent or fully hidden box-shadow does not grow the page", async () => {
    // Tailwind's `box-shadow: 0 0 #0000, ...` defaults added 10px of "shadow room" per element.
    const h = async (shadow: string) =>
      (await render({
        value: `<!DOCTYPE html><html><body style="margin:0"><div style="height:30px;box-shadow:${shadow}"></div></body></html>`,
        width: 100,
        format: "png",
      })).height;
    const plain = await h("none");
    expect(await h("0 0 #0000, inset 0 0 0 1px #888")).toBe(plain);
    expect(await h("0 0 0 0 #f00")).toBe(plain);
    expect(await h("0 4px 12px #f00")).toBeGreaterThan(plain); // a visible shadow still keeps its room
  });
  it("@container queries see a flex or grid container's size", async () => {
    // tailwind's `@container flex flex-col` cards: the query reads the container's render item, and
    // flex/grid items never registered themselves, so the container looked 0px wide (query never matched).
    const h = async (container: string) =>
      (await render({
        value: `<!DOCTYPE html><html><head><style>*{box-sizing:border-box}.c{container-type:inline-size}
          .row{display:flex;flex-direction:column;gap:24px;padding:24px}
          @container (min-width:28rem){.row{flex-direction:row}}
          .i{height:50px;width:100px}.t{height:30px}</style></head>
          <body style="margin:0;width:600px"><div class="c" style="${container}"><div class="row"><div class="i"></div><div class="t"></div></div></div></body></html>`,
        width: 600,
        format: "png",
      })).height;
    expect(await h("")).toBe(98); // row layout: 50 + 2 * 24
    expect(await h("display:flex;flex-direction:column")).toBe(98);
    expect(await h("display:grid")).toBe(98);
  });
  it("grid: align-items/self baseline aligns the first baselines of a row's items", async () => {
    // "HHH" has no descender, so the lowest ink row of each column is its baseline.
    const bottoms = async (style: string, items: string[]) => {
      const { img, at } = await renderPng(
        `<div style="display:grid;grid-template-columns:repeat(${items.length},100px);font-family:sans-serif;${style}">${items
          .map((s) => `<div style="${s}">HHH</div>`)
          .join("")}</div>`,
        100 * items.length,
        120,
      );
      return items.map((_, c) => {
        let last = -1;
        for (let y = 0; y < img.height; y++)
          for (let x = c * 100; x < c * 100 + 100; x++) if (!isWhite(at(x, y))) { last = y; break; }
        return last;
      });
    };
    const sizes = ["font-size:14px", "font-size:36px", "font-size:22px;padding-top:12px"];
    const plain = await bottoms("align-items:start", sizes);
    expect(Math.max(...plain) - Math.min(...plain)).toBeGreaterThan(10);
    const base = await bottoms("align-items:baseline", sizes);
    expect(Math.max(...base) - Math.min(...base)).toBeLessThanOrEqual(1);
    // align-self on a single item; the others keep the default stretch (top) position
    const self = await bottoms("", ["font-size:14px;align-self:baseline", "font-size:36px;align-self:baseline", "font-size:22px"]);
    expect(Math.abs(self[0] - self[1])).toBeLessThanOrEqual(1);
    // a baseline item that is a flex container uses its first item's baseline, wherever that sits
    const flexItem = await bottoms("align-items:baseline", [
      "font-size:14px",
      "font-size:36px;display:flex;align-items:center;height:80px",
    ]);
    expect(Math.abs(flexItem[0] - flexItem[1])).toBeLessThanOrEqual(1);
  });
  it("an empty width:100% flex child does not make its wrapper's min-content as wide as the line", async () => {
    // tailwind cards: wrapping-flex items hold a `display:flex;width:100%` row. While the items are
    // sized from their content that percentage is cyclic (auto), so two cards share one line.
    const h = async (html: string) => (await render({ value: `<!DOCTYPE html><body style="margin:0">${html}</body>`, width: 800, format: "png" })).height;
    const card = `<div style="flex:1 1 0%"><div style="display:flex;width:100%;flex:1 1 0%;padding:20px;box-sizing:border-box"><div style="display:flex;width:100%"></div></div></div>`;
    const row = (inner: string) => `<div style="width:768px"><div style="display:flex"><div style="width:100%"><div style="display:flex;flex-wrap:wrap">${inner}</div></div></div></div>`;
    expect(await h(row(card + card))).toBe(40); // one line of 40px cards, not two
    expect(await h(row(card + card + card + card))).toBe(40);
  });
  it("flex-wrap: a growable item is sized by its basis at a definite width, not by its max-content", async () => {
    // item 2 is `flex:1 1 0%` with a long text: its basis is 0 (the text may wrap), so both items
    // fit on one line; sized by max-content (the intrinsic-size rule) they wrapped onto two.
    const h = async (html: string) => (await render({ value: `<!DOCTYPE html><body style="margin:0;font:16px sans-serif">${html}</body>`, width: 800, format: "png" })).height;
    const wrap = `<div style="width:500px;display:flex;flex-direction:column"><div style="display:flex;flex-wrap:wrap"><div style="width:300px;height:30px"></div><div style="flex:1 1 0%">aaaaaaaa bbbbbbbb cccccccc dddddddd eeeeeeee ffffffff gggggggg hhhhhhhh</div></div></div>`;
    // one line: the 200px-wide text beside the 300px box wraps to ~4 lines (Chromium: 72px with
    // Arial-metric generics); on two lines the text would have the full 500px and the height
    // would be ~37px
    expect(await h(wrap)).toBe(72);
  });
  it("the baseline of a line follows Blink: rounded ascent/descent and a floored half-leading", async () => {
    // Bottom ink row of "HHH" (its baseline) measured in Chromium with the same Roboto face. The
    // half-leading above the text is floored and the font ascent/descent are whole pixels, so the
    // baseline lands on the same row for every line-height, not one pixel off for about half of them.
    const baselineRow = async (fontSize: number, lineHeight: number) => {
      const img = await renderProbeText(
        `<div style="font-family:'RobotoProbe',sans-serif;font-size:${fontSize}px;line-height:${lineHeight}px;color:#000">HHH</div>`,
        200,
      );
      let last = -1;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const i = (img.width * y + x) * 4;
          if (img.data[i + 3] > 0 && img.data[i] < 110) last = y;
        }
      return last;
    };
    const chromium: Array<[number, number, number]> = [
      [24, 20, 17], [24, 24, 19], [24, 30, 22], [24, 40, 27],
      [16, 16, 12], [16, 17, 13], [16, 20, 14], [16, 24, 16], [16, 30, 19], [16, 40, 24],
      [12, 14, 10], [12, 24, 15],
    ];
    for (const [fs, lh, bottom] of chromium) expect(await baselineRow(fs, lh)).toBe(bottom);
  });
  it("grid: text placed directly in the container is drawn, with its spaces", async () => {
    // A grid whose only children are text got no parent on the anonymous item wrapping them, so
    // nothing was drawn; and the space between two words was dropped as an empty grid item.
    const inkWidth = async (html: string) => {
      const { img, at } = await renderPng(html, 300, 60);
      let x0 = 1e9, x1 = -1;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) if (at(x, y)[0] < 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      return x1 < 0 ? 0 : x1 - x0 + 1;
    };
    const block = await inkWidth(`<div style="font:24px sans-serif">Hello world</div>`);
    expect(block).toBeGreaterThan(80);
    for (const grid of [
      `<div style="display:grid;width:300px;font:24px sans-serif">Hello world</div>`,
      `<div style="display:grid;grid-template-columns:minmax(0,1fr);width:300px;font:24px sans-serif">Hello world</div>`,
      `<div style="display:inline-grid;font:24px sans-serif">Hello world</div>`,
      `<div style="display:grid;width:300px;font:24px sans-serif">Hello world<i></i></div>`,
    ]) {
      expect(Math.abs((await inkWidth(grid)) - block)).toBeLessThanOrEqual(2);
    }
  });
  it("form controls centre their text vertically in a box taller than the line", async () => {
    // Chromium centres the text of an <input>, <button> or <select> in the content box.
    const inkCentre = async (control: string) => {
      const { img, at } = await renderPng(`<div style="padding:10px">${control}</div>`, 300, 100);
      let y0 = 1e9, y1 = -1;
      for (let y = 14; y < 66; y++)
        for (let x = 14; x < 220; x++) if (at(x, y)[0] < 100) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return (y0 + y1) / 2 - 40; // the control spans y 10..70
    };
    const box = "width:210px;height:60px;box-sizing:border-box;font:16px sans-serif;margin:0";
    for (const control of [
      `<input value="Hxg" style="${box}">`,
      `<button style="${box}">Hxg</button>`,
      `<select style="${box}"><option>Hxg</option></select>`,
    ]) {
      expect(Math.abs(await inkCentre(control))).toBeLessThanOrEqual(5);
    }
    // a control with no extra height keeps its text where it was
    const { img } = await renderPng(`<input value="Hxg" style="font:16px sans-serif;margin:0">`, 300, 60);
    expect(img.height).toBeGreaterThan(0);
  });
  it("a font-family change inside <pre> goes back to the default 16px size", async () => {
    // `pre` is 13px only because its family is exactly `monospace`; a child with another family
    // re-derives the default size (an explicit size anywhere in between would keep it).
    const h = async (html: string) => (await render({ value: `<!DOCTYPE html><body style="margin:0">${html}</body>`, width: 300, format: "png" })).height;
    const sans16 = await h(`<div style="font:16px sans-serif">x</div>`);
    expect(await h(`<pre style="margin:0"><span style="font-family:sans-serif">x</span></pre>`)).toBe(sans16);
    expect(await h(`<pre style="margin:0"><code><span style="font-family:sans-serif">x</span></code></pre>`)).toBe(sans16);
    const mono13 = await h(`<pre style="margin:0">x</pre>`);
    expect(mono13).toBeLessThan(sans16);
    expect(await h(`<pre style="margin:0"><span>x</span></pre>`)).toBe(mono13);
    // an explicit size in between is kept: the same text is as wide as 13px sans-serif, not 16px
    const inkWidth = async (html: string) => {
      const { img, at } = await renderPng(html, 300, 40);
      let x0 = 1e9, x1 = -1;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) if (at(x, y)[0] < 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      return x1 - x0 + 1;
    };
    const w13 = await inkWidth(`<div style="font:13px sans-serif">HHHHHHHH</div>`);
    const w16 = await inkWidth(`<div style="font:16px sans-serif">HHHHHHHH</div>`);
    expect(w16).toBeGreaterThan(w13 + 8);
    expect(Math.abs((await inkWidth(`<pre style="margin:0;font-size:13px"><span style="font-family:sans-serif">HHHHHHHH</span></pre>`)) - w13)).toBeLessThanOrEqual(2);
    expect(Math.abs((await inkWidth(`<pre style="margin:0"><span style="font-family:sans-serif">HHHHHHHH</span></pre>`)) - w16)).toBeLessThanOrEqual(2);
  });
  it("text-align:center applies inside a shrink-to-fit item (flex item, inline-block, grid item)", async () => {
    // The final placement of a shrink-to-fit box kept the shrink-to-fit flag, and the lines of a
    // box only align inside an exact width: a short title sat at the left of a wider card.
    const titleCentre = async (outer: string) => {
      const { img, at } = await renderPng(
        `<div style="${outer};width:600px;height:120px"><div style="background:#eee;padding:10px 40px;text-align:center;font:16px sans-serif"><div style="font-weight:bold">Hi</div><div style="font-size:14px">A considerably longer second line</div></div></div>`,
        600,
        120,
      );
      let c0 = 1e9, c1 = -1, t0 = 1e9, t1 = -1, top = 1e9;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const a = at(x, y);
          if (near(a, [238, 238, 238], 4)) { c0 = Math.min(c0, x); c1 = Math.max(c1, x); top = Math.min(top, y); }
        }
      for (let y = top + 6; y < top + 30; y++)
        for (let x = c0; x <= c1; x++) if (at(x, y)[0] < 100) { t0 = Math.min(t0, x); t1 = Math.max(t1, x); }
      return (t0 + t1) / 2 - (c0 + c1) / 2;
    };
    for (const outer of [
      "display:flex;align-items:center;justify-content:center",
      "display:flex;flex-direction:column;align-items:center;justify-content:center",
      "text-align:center",
      "display:grid;justify-items:center",
    ]) {
      expect(Math.abs(await titleCentre(outer))).toBeLessThanOrEqual(2);
    }
  });
  it("a shrink-to-fit block with max-width takes its content width, not max-width", async () => {
    // A column flex item with align-items:center and `max-width:500px` is fit-content: the max-width
    // only clamps. Copying the max-width typed value over the auto inline size made it exactly 500px.
    const redWidth = async (html: string) => {
      const { img, at } = await renderPng(html, 600, 60);
      let x0 = 1e9, x1 = -1;
      for (let x = 0; x < img.width; x++) if (near(at(x, 5), RED, 40)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      return x1 - x0 + 1;
    };
    const item = (extra: string) =>
      `<div style="display:flex;flex-direction:column;align-items:center;width:600px"><div style="${extra}background:#f00"><div style="width:120px;height:20px"></div></div></div>`;
    expect(await redWidth(item("max-width:500px;"))).toBe(120);
    expect(await redWidth(item(""))).toBe(120);
    expect(await redWidth(item("max-width:80px;"))).toBe(80);
  });
  it("grid: a padded item is counted once when the grid is sized from its content", async () => {
    // fr/auto tracks of a shrink-to-fit grid took the item's margin-box size plus its padding again.
    const { img, at } = await renderPng(
      `<div style="display:inline-block;background:#f00"><div style="display:grid;grid-template-columns:minmax(0,1fr)"><div style="width:100px;padding:0 10px 0 32px;border-right:3px solid #f00;height:10px"></div></div></div>`,
      400,
      40,
    );
    let x1 = -1;
    for (let x = 0; x < img.width; x++) if (near(at(x, 5), RED, 40)) x1 = x;
    expect(x1 + 1).toBe(100 + 32 + 10 + 3);
  });
  it("absolute: inset:0 with margin:auto centres the box, and an aspect-ratio fixes its height", async () => {
    // nodejs.org's glow is `position:absolute; inset:0; margin:auto; width:300px; aspect-ratio:1`.
    // The auto margins solved for the over-constrained box were reset by the re-measure, and the
    // height was stretched to the containing block instead of following the ratio.
    const bbox = async (box: string) => {
      const { img, at } = await renderPng(
        `<div style="position:relative;width:600px;height:400px"><div style="position:absolute;inset:0;margin:auto;${box};background:#f00"></div></div>`,
        600,
        400,
      );
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++)
          if (near(at(x, y), RED, 40)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return [x0, y0, x1, y1];
    };
    expect(await bbox("width:300px;height:200px")).toEqual([150, 100, 449, 299]);
    expect(await bbox("width:300px;aspect-ratio:1")).toEqual([150, 50, 449, 349]);
    expect(await bbox("width:300px")).toEqual([150, 0, 449, 399]);
    // border-box (tailwind's preflight): the margin box must not be taken for the border box
    expect(await bbox("box-sizing:border-box;width:300px;aspect-ratio:1")).toEqual([150, 50, 449, 349]);
    expect(await bbox("box-sizing:border-box;width:300px;height:200px")).toEqual([150, 100, 449, 299]);
  });
  it("grid: an auto column gives back width to its scroll-container items instead of overflowing", async () => {
    // nodejs.org's code panel: a grid whose only column is `auto`, holding a flex tab row with
    // overflow:auto. The column's minimum contribution is 0 (scroll container), so it stops at the
    // grid's width instead of growing to the tabs' max-content width.
    const tabs = `<div style="display:flex;overflow-x:auto;gap:8px">${["Create an HTTP Server", "Write Tests", "Read and Hash a File", "Streams Pipeline"]
      .map((t) => `<button style="white-space:nowrap">${t}</button>`)
      .join("")}</div>`;
    const lastInk = async (html: string) => {
      const { img, at } = await renderPng(html, 1000, 60);
      for (let x = img.width - 1; x >= 0; x--)
        for (let y = 0; y < img.height; y++) if (at(x, y)[0] < 140) return x;
      return -1;
    };
    const grid = `<div style="display:grid;max-width:100%">${tabs}</div>`;
    // fixed width, a block parent, and a flex row with non-stretch alignment (content-sized measure)
    expect(await lastInk(`<div style="display:grid;width:300px">${tabs}</div>`)).toBeLessThan(301);
    expect(await lastInk(`<div style="width:432px;margin-left:512px">${grid}</div>`)).toBeLessThan(945);
    expect(
      await lastInk(
        `<div style="width:1000px"><main style="display:flex;gap:56px;align-items:flex-start"><section style="width:400px;flex:1 0;max-width:400px">left</section><section style="flex:1;min-width:0;max-width:672px"><div style="width:100%;max-width:100%">${grid}</div></section></main></div>`,
      ),
    ).toBeLessThan(1000);
  });
  it("a column flex item with a specified width measures its height at that width", async () => {
    // `width:100%` on an svg: the item's flex base size used to be measured with the width reset to auto,
    // so the viewBox's own 100x50 size gave a 50px height instead of 400 * 50/100 = 200 (+ text).
    const h = async (item: string) =>
      (await render({
        value: `<!DOCTYPE html><html><body style="margin:0"><div style="display:flex;flex-direction:column;width:400px">${item}</div></body></html>`,
        width: 600,
        format: "png",
      })).height;
    const svg = `<svg viewBox="0 0 100 50" style="width:100%;display:block"></svg>`;
    expect(await h(svg)).toBe(200);
    expect(await h(`<div style="width:50%;padding:10px;border:5px solid">${svg}</div>`)).toBe(130);
    expect(await h(`<div style="width:50%;padding:10px;border:5px solid;box-sizing:border-box">${svg}</div>`)).toBe(115);
    expect(await h(`<div style="width:300px;margin:0 20px">${svg}</div>`)).toBe(150);
  });
  it("@container understands inline-size / block-size and the range syntax", async () => {
    // Container is 600px wide: every query below matches except the last, which must not.
    const h = async (query: string) =>
      (await render({
        value: `<!DOCTYPE html><html><head><style>.c{container-type:inline-size}.i{height:10px}
          @container ${query}{.i{height:50px}}</style></head>
          <body style="margin:0;width:600px"><div class="c"><div class="i"></div></div></body></html>`,
        width: 600,
        format: "png",
      })).height;
    expect(await h("(inline-size >= 500px)")).toBe(50);
    expect(await h("(min-inline-size: 500px)")).toBe(50);
    expect(await h("(400px < inline-size <= 600px)")).toBe(50);
    expect(await h("(width > 500px)")).toBe(50);
    expect(await h("(inline-size >= 700px)")).toBe(10);
    expect(await h("(inline-size < 500px)")).toBe(10);
  });
  it("grid: negative line numbers count from the end, and a lone `dense` means `row dense`", async () => {
    // tailwind's `col-span-full` is `grid-column: 1 / -1` and `grid-flow-dense` is `grid-auto-flow: dense`.
    const h = async (flow: string, spec: string[]) =>
      (await render({
        value: `<!DOCTYPE html><html><body style="margin:0;width:600px"><div style="display:grid;grid-template-columns:repeat(30,minmax(0,1fr));${flow}gap:8px">${spec
          .map((s) => `<div style="grid-column:${s};height:20px"></div>`)
          .join("")}</div></body></html>`,
        width: 600,
        format: "png",
      })).height;
    // full row after a 12-wide item: the full item needs a row of its own (2 rows: 20 + 8 + 20)
    expect(await h("", ["span 12 / span 12", "1 / -1"])).toBe(48);
    // dense: the 18-wide item backfills the first row next to the 12-wide one (3 rows -> 2)
    expect(await h("grid-auto-flow:dense;", ["span 12 / span 12", "1 / -1", "span 18 / span 18"])).toBe(48);
    expect(await h("", ["span 12 / span 12", "1 / -1", "span 18 / span 18"])).toBe(76);
  });
});

describe("declarative shadow DOM", () => {
  it("renders a shadow root in place of the host's children, with scoped styles and slots", async () => {
    // The shadow root draws a 50x20 blue bar (.b) and a slot; the slotted <i> is styled by ::slotted.
    // The same `.b` outside the host must not pick up the shadow root's style.
    const { at } = await renderPng(
      `<my-box><template shadowrootmode="open"><style>:host{display:block}.b{height:20px;background:#00f}::slotted(i){display:block;height:20px;background:#0f0}</style><div class="b"></div><slot></slot></template><i></i><u>dropped</u></my-box><div class="b" style="width:50px"></div>`,
      50,
      80,
    );
    expect(near(at(10, 10), [0, 0, 255])).toBe(true);
    expect(near(at(10, 30), [0, 255, 0])).toBe(true);
    // A light child with no matching slot is not rendered, and the unstyled outside .b is empty.
    expect(isWhite(at(10, 50))).toBe(true);
    expect(isWhite(at(10, 70))).toBe(true);
  });
  it("shows the fallback content of a slot that has nothing assigned", async () => {
    const { at } = await renderPng(
      `<my-box><template shadowrootmode="open"><style>:host{display:block}.f{height:20px;background:#f00}</style><slot><div class="f"></div></slot></template></my-box>`,
      50,
      40,
    );
    expect(near(at(10, 10), [255, 0, 0])).toBe(true);
  });
  it("does not render an ordinary <template>", async () => {
    const { at } = await renderPng(
      `<template><div style="height:20px;background:#f00"></div></template>`,
      50,
      40,
    );
    expect(isWhite(at(10, 10))).toBe(true);
  });
});

describe("svg size attributes", () => {
  it("keeps the unit of a width/height attribute such as 1.33em", async () => {
    // font-size 20px -> 1.33em is 26.6px; read as 1.33px the icon would be a speck.
    const { at } = await renderPng(
      `<div style="font-size:20px"><svg width="1.33em" height="1.33em" viewBox="0 0 24 24" style="display:block"><rect width="24" height="24" fill="#00f"/></svg></div>`,
      60,
      40,
    );
    expect(near(at(20, 20), [0, 0, 255])).toBe(true);
    expect(isWhite(at(30, 20))).toBe(true);
  });
});

describe("scale: webp", () => {
  it("draws a still and an animated WebP at scale times the layout size", async () => {
    // VP8X canvas size: 24-bit little-endian width-1 at byte 24, height-1 at byte 27.
    const canvas = (data: Uint8Array) => {
      const b = Buffer.from(data);
      return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    };
    const still = await render({
      value: `<body style="margin:0"><div style="width:40px;height:30px;background:#00f"></div></body>`,
      width: 40,
      height: 30,
      format: "webp",
      scale: 2,
    });
    expect(canvas(still.data as Uint8Array)).toEqual([80, 60]);
    const moving = await render({
      value: `<html><head><style>@keyframes f{from{opacity:0}to{opacity:1}}.a{width:40px;height:30px;background:#00f;animation:f 400ms infinite}</style></head><body style="margin:0"><div class="a"></div></body></html>`,
      width: 40,
      height: 30,
      format: "webp",
      scale: 2,
      animation: { duration: 400, fps: 10 },
    });
    expect(moving.animation).toBe(true);
    expect(canvas(moving.data as Uint8Array)).toEqual([80, 60]);
  });
});

describe("grid: baseline alignment sizes the row", () => {
  it("grows the row to the largest ascent plus the largest descent of the baseline-aligned items", async () => {
    // A has a large ascent, B a small ascent and a large descent. Lined up on one baseline, B hangs
    // below A's box, so a row only as tall as the tallest item (B) would let B overflow it.
    for (const placement of ["align-items:baseline", ""]) {
      const self = placement ? "" : "align-self:baseline;";
      const { img, at } = await renderPng(
        `<div style="display:grid;grid-template-columns:100px 100px;${placement};background:#ddd"><div style="${self}font-size:40px;line-height:1;background:#f88">A</div><div style="${self}font-size:10px;line-height:1;padding-bottom:40px;background:#8f8">B</div></div><div style="height:5px;background:#00f"></div>`,
        300,
        140,
      );
      let blue = -1;
      for (let y = 0; y < img.height && blue < 0; y++) if (near(at(102, y), [0, 0, 255])) blue = y;
      expect(blue).toBeGreaterThan(0);
      // Nothing of B (green) is drawn below the blue bar that ends the grid.
      expect(near(at(102, blue + 8), [136, 255, 136], 20)).toBe(false);
      expect(near(at(102, blue - 1), [136, 255, 136], 20)).toBe(true);
    }
  });
});

describe("inline-block inside flex and grid items", () => {
  it("sits on the line's baseline, so the item is as tall as in a block container", async () => {
    // A flex/grid item is measured before it is placed; the inline-block's baseline must survive that
    // measure pass, or it falls back to the bottom edge and the line grows by the descent.
    const height = async (display: string) =>
      (await render({
        value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="display:${display};font-size:14px;line-height:19.25px"><div>x<span style="display:inline-block">y</span></div></div></body></html>`,
        width: 200,
        format: "png",
      })).height;
    const block = await height("block");
    expect(await height("grid")).toBe(block);
    expect(await height("flex")).toBe(block);
  });
  it("a button and a submit input default to vertical-align: baseline, like Chromium", async () => {
    // vertical-align: middle in the user-agent sheet lifted them off the baseline and grew the line.
    const height = async (control: string) =>
      (await render({
        value: `<!DOCTYPE html><html><body style="margin:0"><div style="font-size:30px;line-height:36px">x${control}</div></body></html>`,
        width: 300,
        format: "png",
      })).height;
    expect(await height(`<button>y</button>`)).toBe(await height(`<button style="vertical-align:baseline">y</button>`));
    expect(await height(`<input type="submit" value="y">`)).toBe(
      await height(`<input type="submit" value="y" style="vertical-align:baseline">`),
    );
  });
});

describe("onLayout", () => {
  it("reports each laid-out element's border box, keyed by its path in the flattened tree", async () => {
    let boxes: { p: string; t: string; i: string; x: number; y: number; w: number; h: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>#a::before{content:"";display:block;height:1px}</style></head><body style="margin:8px"><div id="a" style="width:100px;height:40px;padding:5px;border:2px solid red"></div><span>inline</span><br><my-x><template shadowrootmode="open"><div id="s" style="height:10px"></div></template></my-x><div id="none" style="display:none"></div></body></html>`,
      width: 300,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    const byId = (id: string) => boxes.find((b) => b.i === id);
    // border box: content 100x40 + padding 5 + border 2 on each side
    expect(byId("a")).toMatchObject({ p: "0.1.0", t: "div", x: 8, y: 8, w: 114, h: 54 });
    // the shadow root's content is a child of its host (my-x = body child 3), and the ::before pseudo
    // node, the inline <span>, the <br>, and the display:none element do not take part
    expect(byId("s")?.p).toBe("0.1.3.0");
    expect(boxes.some((b) => b.t === "span" || b.t === "br" || b.i === "none" || b.t.startsWith("-"))).toBe(false);
    // body children are counted as in the DOM: div, span, br, my-x, div#none
    expect(boxes.find((b) => b.t === "body")?.p).toBe("0.1");
  });
});

describe("replaced box without a natural size (viewBox-only svg)", () => {
  type Box = { t: string; x: number; y: number; w: number; h: number };
  const svgBox = async (inner: string, wrapStyle = "width:600px"): Promise<Box> => {
    let boxes: Box[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="${wrapStyle}">${inner}</div></body></html>`,
      width: 800,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    return boxes.find((b) => b.t === "svg")!;
  };
  const svg = (style = "") => `<svg viewBox="0 0 1216 726" style="${style}"><rect width="1216" height="726"/></svg>`;

  it("fills the containing block's width and takes its height from the viewBox ratio", async () => {
    // Chromium: 600 x 358.2, not the viewBox size 1216 x 726 (CSS 2.1 10.3.2)
    for (const inner of [svg(), `<span>${svg()}</span>`, `text ${svg()}`]) {
      const b = await svgBox(inner);
      expect(b.w).toBeCloseTo(600, 0);
      expect(b.h).toBeCloseTo(358.2, 0);
    }
  });
  it("an absolutely positioned one fills the space between its insets and centres on an auto margin", async () => {
    const rel = "position:relative;width:600px;height:200px";
    // left/right: 0 -> 600 wide; top/bottom: 0 with auto margins centres the 358px box (y = -79.1)
    const a = await svgBox(svg("position:absolute;inset:0;margin:auto"), rel);
    expect(a).toMatchObject({ x: 0 });
    expect(a.w).toBeCloseTo(600, 0);
    expect(a.y).toBeCloseTo(-79.1, 0);
    // a given height derives the width from the ratio, centred horizontally
    const b = await svgBox(svg("position:absolute;inset:0;margin:auto;height:100px"), rel);
    expect(b.w).toBeCloseTo(167.5, 0);
    expect(b.x).toBeCloseTo(216.3, 0);
    // the insets narrow it
    const c = await svgBox(svg("position:absolute;left:50px;right:100px"), rel);
    expect(c.x).toBeCloseTo(50, 0);
    expect(c.w).toBeCloseTo(450, 0);
  });
  it("keeps a natural size when width or height is given", async () => {
    expect((await svgBox(svg("width:200px"))).h).toBeCloseTo(119.4, 0);
    expect((await svgBox(svg("height:100px"))).w).toBeCloseTo(167.5, 0);
  });
});

describe("grid: replaced items", () => {
  it("keeps an image's own size under normal alignment and fills the area only on an explicit stretch", async () => {
    const svg = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#00f"/></svg>`);
    const box = async (grid: string) => {
      let boxes: { t: string; w: number; h: number }[] = [];
      await render({
        value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="display:grid;width:600px;${grid}"><img src="${svg}"></div></body></html>`,
        width: 800,
        format: "png",
        onLayout: (b) => {
          boxes = b;
        },
      });
      return boxes.find((b) => b.t === "img")!;
    };
    // Chromium: 100 x 50 (a replaced item is not stretched by `normal`), also in a 1fr/1fr grid
    expect(await box("")).toMatchObject({ w: 100, h: 50 });
    expect(await box("grid-template-columns:1fr 1fr")).toMatchObject({ w: 100, h: 50 });
    expect(await box("grid-template-rows:200px")).toMatchObject({ w: 100, h: 50 });
    expect((await box("justify-items:stretch")).w).toBe(600);
  });
});

describe("grid: math in line values", () => {
  it("evaluates calc/min/max/clamp in a span count and in a line number", async () => {
    // 12 columns of 1fr in 600px with a 24px gap: one column is 28px, a 6-column span 288px
    const item = async (gc: string, vars = "") => {
      let boxes: { i: string; x: number; w: number }[] = [];
      await render({
        value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="display:grid;width:600px;grid-template-columns:repeat(12,1fr);column-gap:24px;${vars}"><div id="s" style="grid-column:${gc};height:10px"></div></div></body></html>`,
        width: 800,
        format: "png",
        onLayout: (b) => {
          boxes = b;
        },
      });
      return boxes.find((b) => b.i === "s")!;
    };
    expect(await item("span 6")).toMatchObject({ x: 0, w: 288 });
    expect(await item("span min(12, 6)")).toMatchObject({ x: 0, w: 288 });
    expect(await item("span min(var(--a), var(--b))", "--a:12;--b:6;")).toMatchObject({ x: 0, w: 288 });
    expect(await item("span calc(3 * 2)")).toMatchObject({ x: 0, w: 288 });
    expect(await item("span clamp(2, 9, 6)")).toMatchObject({ x: 0, w: 288 });
    expect(await item("1 / span max(1, 4)")).toMatchObject({ x: 0, w: 184 });
    // a line number from math: min(2, 3) is line 2, which starts at 52px
    expect(await item("min(2, 3) / span 4")).toMatchObject({ x: 52, w: 184 });
  });
});

describe("flex column: block-level container width", () => {
  it("an auto-width column container is as wide as the space it is given, not its widest item", async () => {
    // A grid with 1fr columns holding a 380px-wide image has a max-content width of 784px; inside a
    // column flex container that is a block-level box in a 597px grid track, the stretched item must
    // be 597px (the container's width), as in Chromium.
    const image = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="380" height="47"><rect width="380" height="47" fill="#00f"/></svg>`);
    let boxes: { c: string; w: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>
        *{margin:0;padding:0} body{width:920px}
        .o{display:grid;grid-template-columns:597px 200px;column-gap:24px}
        .fl{display:flex;flex-direction:column;align-items:stretch}
        .g{display:grid;grid-template-columns:repeat(12,1fr);column-gap:24px}
        .gi{grid-column:span 6} img{width:100%}
      </style></head><body><div class="o"><div><div class="fl"><div class="g"><div class="gi"><img src="${image}"></div></div></div></div></div></body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    expect(boxes.find((b) => b.c === "fl")!.w).toBeCloseTo(597, 0);
    expect(boxes.find((b) => b.c === "g")!.w).toBeCloseTo(597, 0);
  });
});

describe("flex item with a definite width: nested percentage widths", () => {
  it("resolves a percentage-width image two blocks down against the item's final width", async () => {
    // The item is measured at its flexed main size (600px) with an auto height. Its shrink-to-fit
    // measuring flag must not reach the children, or the inner block's width stays indefinite, the
    // 100% image takes its natural 3000px width and the container ends up as tall as that image.
    const image = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect width="3000" height="2000" fill="#00f"/></svg>`);
    const heights = async (inner: string) => {
      let boxes: { i: string; w: number; h: number }[] = [];
      await render({
        value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0} img{display:block}</style></head><body><div id="p" style="display:flex;width:600px">${inner}</div></body></html>`,
        width: 800,
        format: "png",
        onLayout: (b) => {
          boxes = b;
        },
      });
      return { img: boxes.find((b) => b.i === "s")!, box: boxes.find((b) => b.i === "p")! };
    };
    const img = `<img id="s" style="width:100%;height:auto;aspect-ratio:16 / 9" src="${image}">`;
    for (const inner of [img, `<div>${img}</div>`, `<div><div>${img}</div></div>`, `<a><div>${img}</div></a>`]) {
      const { img: i, box } = await heights(inner);
      expect(i.w).toBeCloseTo(600, 0);
      expect(i.h).toBeCloseTo(337.5, 0);
      expect(box.h).toBeCloseTo(337.5, 0);
    }
  });
});

describe("grid inside a flex item: intrinsic track sizing", () => {
  it("does not stretch an auto column with the grid's own exact width", async () => {
    // `auto 1fr auto` with an icon and a text: the icon column is 16px and the text gets the rest,
    // so the grid is one 24px line. Measuring the icon with the grid's own exact width (a flex item
    // gets one) made the auto column 592px wide, the 1fr column 0, and the text wrapped to two lines.
    const svg = `<svg viewBox="0 0 16 16" style="width:16px;height:16px"><rect width="16" height="16"/></svg>`;
    const grid = "display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px;font-size:14px;line-height:24px;width:100%";
    let boxes: { i: string; t: string; x: number; w: number; h: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}</style></head><body><div style="display:flex;width:600px"><div id="g" style="${grid}">${svg}Quick search</div></div></body></html>`,
      width: 800,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    expect(boxes.find((b) => b.i === "g")).toMatchObject({ w: 600, h: 24 });
    expect(boxes.find((b) => b.t === "svg")).toMatchObject({ x: 0, w: 16 });
  });
});

describe("grid: width when sized from its content", () => {
  it("is as wide as its tracks in a flex item, inline-grid, float, abs and a column-flex start", async () => {
    const items = `<span style="display:block;width:50px;height:20px"></span><span style="display:block;width:80px;height:20px"></span>`;
    const width = async (parent: string, grid: string) => {
      let boxes: { i: string; w: number }[] = [];
      await render({
        value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}</style></head><body><div style="${parent}"><div id="g" style="gap:10px;${grid}">${items}</div></div></body></html>`,
        width: 800,
        format: "png",
        onLayout: (b) => {
          boxes = b;
        },
      });
      return boxes.find((b) => b.i === "g")!.w;
    };
    const flex = "display:flex;width:600px";
    const cols = (c: string, extra = "display:grid") => `${extra};grid-template-columns:${c}`;
    // two content-sized tracks (50 + 10 gap + 80), not the 600px the flex row offers
    expect(await width(flex, cols("auto auto"))).toBe(140);
    expect(await width(flex, cols("repeat(2, auto)"))).toBe(140);
    expect(await width(flex, cols("auto 1fr"))).toBe(140);
    expect(await width("width:600px", cols("auto auto", "display:inline-grid"))).toBe(140);
    expect(await width("width:600px", cols("auto auto", "display:grid;float:left"))).toBe(140);
    expect(await width("position:relative;width:600px;height:100px", cols("auto auto", "display:grid;position:absolute"))).toBe(140);
    expect(await width("display:flex;flex-direction:column;align-items:flex-start;width:600px", cols("auto auto"))).toBe(140);
    // 1fr tracks share the largest contribution per fraction: 80 + 10 + 80
    expect(await width(flex, cols("1fr 1fr"))).toBe(170);
    // one implicit column as wide as its widest item
    expect(await width(flex, "display:grid")).toBe(80);
    // a block-level grid in normal flow still fills its container
    expect(await width("width:600px", cols("auto auto"))).toBe(600);
  });
});

describe("intrinsic width keywords on a block", () => {
  const widthOf = async (style: string, inner = '<div style="width:80px;height:20px"></div>'): Promise<number> => {
    let w = -1;
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div id="t" style="${style}">${inner}</div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        w = b.find((x) => x.i === "t")?.w ?? -1;
      },
    });
    return w;
  };

  it("shrinks a block with width:fit-content / max-content to its content", async () => {
    expect(await widthOf("width:fit-content")).toBe(80);
    expect(await widthOf("width:max-content")).toBe(80);
    expect(await widthOf("width:fit-content;min-width:120px")).toBe(120);
    expect(await widthOf("width:fit-content;margin:12px")).toBe(80);
  });

  it("counts a child's min-width in the content size of a shrink-to-fit box", async () => {
    const held = '<div style="min-width:100px;height:10px"></div>';
    expect(await widthOf("width:fit-content", held)).toBe(100);
    expect(await widthOf("float:left", held)).toBe(100);
    expect(await widthOf("float:left", `<div style="padding:4px">${held}</div>`)).toBe(108);
  });

  it("keeps fit-content within the available width unless the min-content is wider, and plain blocks full width", async () => {
    expect(await widthOf("width:fit-content", '<div style="width:900px;height:20px"></div>')).toBe(900);
    expect(await widthOf("width:fit-content", '<div style="height:20px"></div>')).toBe(0);
    expect(await widthOf("")).toBe(600);
  });
});

describe("percentage width inside a shrink-to-fit absolutely positioned box", () => {
  it("resolves against the solved width, not the containing block", async () => {
    let boxes: { p: string; w: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="position:absolute;left:0;top:0"><div id="p" style="width:50%;height:10px"></div><div style="width:80px;height:10px"></div></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    expect(boxes.find((b) => b.p === "0.1.0")?.w).toBe(80);
    expect(boxes.find((b) => b.p === "0.1.0.0")?.w).toBe(40);
  });
});

describe("grid flexible tracks and zero-width absolute boxes", () => {
  type B = { p: string; x: number; y: number; w: number; h: number };
  const layout = async (body: string): Promise<B[]> => {
    let boxes: B[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    return boxes;
  };

  it("shares the space of minmax(40px, 1fr) tracks without counting their base twice", async () => {
    const b = await layout(
      '<div style="display:grid;grid-template-columns:minmax(40px,1fr) 1fr"><div style="width:90px;height:25px"></div><div style="width:20px;height:10px"></div></div>',
    );
    expect(b.find((x) => x.p === "0.1.0.1")?.x).toBe(300);
  });

  it("freezes a track whose minimum exceeds its share", async () => {
    const b = await layout(
      '<div style="display:grid;grid-template-columns:minmax(500px,1fr) 1fr"><div style="height:10px"></div><div style="height:10px"></div></div>',
    );
    // the 500px minimum is kept, the other track takes what is left
    expect(b.find((x) => x.p === "0.1.0.1")?.x).toBe(500);
    expect(b.find((x) => x.p === "0.1.0.1")?.w).toBe(100);
  });

  it("lays out the children of a shrink-to-fit absolute box at its solved width", async () => {
    const b = await layout(
      '<div style="position:absolute;left:0;top:0"><div style="height:24px"></div><div style="width:5px"></div></div>',
    );
    expect(b.find((x) => x.p === "0.1.0.0")?.w).toBe(5);
  });

  it("keeps the height of an absolute box whose width is 0", async () => {
    const b = await layout('<div style="position:absolute;left:0;top:0;width:0"><div style="height:24px"></div><div style="height:12px"></div></div>');
    expect(b.find((x) => x.p === "0.1.0")?.h).toBe(36);
  });

  it("never shrinks an fr track below its items' min-content size", async () => {
    const b = await layout(
      '<div style="width:60px;display:grid;grid-template-columns:2fr 1fr"><div style="width:90px;height:25px"></div><div style="width:20px;height:10px"></div></div>',
    );
    expect(b.find((x) => x.p === "0.1.0.1")?.x).toBe(90);
  });

  it("sizes fit-content(limit) as max(min-content, min(max-content, limit))", async () => {
    const b = await layout(
      '<div style="width:fit-content;display:grid;grid-template-columns:fit-content(80px)"><div style="width:90px;height:25px"></div></div>',
    );
    expect(b.find((x) => x.p === "0.1.0")?.w).toBe(90);
  });

  it("gives a shrink-to-fit grid the base of its minmax(base, 1fr) tracks", async () => {
    const b = await layout(
      '<div style="width:fit-content;display:grid;grid-template-columns:minmax(40px,1fr) 1fr"><div style="height:24px"></div><div style="height:12px"></div></div>',
    );
    expect(b.find((x) => x.p === "0.1.0")?.w).toBe(80);
  });

  it("treats a flex factor sum below 1 as 1", async () => {
    const b = await layout(
      '<div style="display:grid;grid-template-columns:0.25fr 0.25fr"><div style="height:10px"></div><div style="height:10px"></div></div>',
    );
    expect(b.find((x) => x.p === "0.1.0.0")?.w).toBe(150);
    expect(b.find((x) => x.p === "0.1.0.1")?.x).toBe(150);
  });

  it("grows content-sized tracks to fit an item spanning them", async () => {
    const b = await layout(
      '<div style="width:fit-content;display:grid;grid-template-columns:auto auto"><div style="grid-column:span 2;width:150px;height:20px"></div><div style="width:30px;height:10px"></div><div style="width:40px;height:10px"></div></div>',
    );
    // the spanning item needs 150px: the 30 and 40 columns grow by 40 each (80 missing, shared equally)
    expect(b.find((x) => x.p === "0.1.0.2")?.x).toBe(70);
  });

  it("sizes a nested grid item's min-content from its tracks, so an fr track does not shrink below it", async () => {
    const b = await layout(
      '<div style="width:80px;display:grid;grid-template-columns:1fr 1fr"><div style="display:grid;grid-template-columns:repeat(3,1fr);padding:4px"><div style="min-width:40px;min-height:30px;padding:12px"></div></div><div style="height:10px;width:30px"></div></div>',
    );
    // the nested grid's min-content width (72px, as in Chromium) is the floor of the first fr track
    expect(b.find((x) => x.p === "0.1.0.0")?.w).toBe(72);
  });
});

describe("flex item automatic minimum size", () => {
  it("lets an item with a definite width shrink down to its content, not only to that width", async () => {
    let boxes: { p: string; w: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="display:flex;width:60px"><div style="width:90px;height:25px"></div><div style="width:20px;height:10px"></div></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    // 110px of items in 60px: both shrink in proportion to their size (90 -> 49.09, 20 -> 10.91)
    expect(boxes.find((x) => x.p === "0.1.0.0")?.w).toBeCloseTo(49.09, 1);
    expect(boxes.find((x) => x.p === "0.1.0.1")?.w).toBeCloseTo(10.91, 1);
  });
});

describe("flex gap after a zero-size item", () => {
  it("counts the gap even when the first item has no main size", async () => {
    let boxes: { p: string; h: number; x: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="display:flex;flex-direction:column;gap:10px"><div style="flex:1;height:25px"></div><div style="width:20px;height:10px"></div></div><div style="display:flex;gap:10px;justify-content:space-between"><div style="height:24px"></div><div style="height:12px"></div></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    // column: 0 (flex-basis 0) + gap + 10
    expect(boxes.find((x) => x.p === "0.1.0")?.h).toBe(20);
    // row: the zero-width items are spread over the 590px left after the gap
    expect(boxes.find((x) => x.p === "0.1.1.1")?.x).toBe(600);
  });
});

describe("flex item automatic minimum size with a percentage or overridden width", () => {
  const boxesOf = async (body: string) => {
    let boxes: { p: string; w: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    return boxes;
  };

  it("uses a percentage width as the specified size", async () => {
    const b = await boxesOf('<div style="display:flex;width:40px"><div style="width:30%"><div style="width:50px"></div></div></div>');
    expect(b.find((x) => x.p === "0.1.0.0")?.w).toBeCloseTo(12, 1);
  });

  it("uses the width property as the specified size even when flex-basis replaces it", async () => {
    const b = await boxesOf(
      '<div style="display:flex;width:120px"><div style="width:60px;flex:1"><div style="width:120px;padding:12px"></div></div></div>',
    );
    expect(b.find((x) => x.p === "0.1.0.0")?.w).toBe(120);
  });

  it("clamps an item's contribution to a flex container's intrinsic width by its max-width", async () => {
    const b = await boxesOf('<div style="display:flex;width:fit-content"><div style="width:200px;max-width:150px;height:10px"></div></div>');
    expect(b.find((x) => x.p === "0.1.0")?.w).toBe(150);
  });
});

describe("margins of an empty block", () => {
  const ys = async (body: string) => {
    let boxes: { p: string; y: number; h: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{padding:0}html,body{margin:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    return boxes;
  };

  it("collapses its own top and bottom margins into one between two blocks", async () => {
    const b = await ys('<div style="height:5px"></div><div style="margin:8px"></div><div style="height:5px"></div>');
    // 5 + max(8, 8) + 5, not 5 + 16 + 5
    expect(b.find((x) => x.p === "0.1.2")?.y).toBe(13);
  });

  it("collapses it with the margins of both neighbours", async () => {
    const b = await ys(
      '<div style="height:5px;margin-bottom:10px"></div><div style="margin:8px"></div><div style="margin-top:20px;height:5px"></div>',
    );
    // the 10, 8 and 20 margins collapse to 20
    expect(b.find((x) => x.p === "0.1.2")?.y).toBe(25);
  });
});

describe("absolute box with a preceding sibling", () => {
  it("lays its children out at the solved shrink-to-fit width", async () => {
    let boxes: { p: string; w: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div></div><div style="position:absolute"><div style="width:90px"></div><div></div></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    expect(boxes.find((x) => x.p === "0.1.1.1")?.w).toBe(90);
  });
});

describe("minmax() tracks with an auto / content keyword", () => {
  it("keeps the minimum of minmax(30px, auto) rows", async () => {
    let boxes: { p: string; h: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="display:grid;grid-auto-rows:minmax(30px,auto)"><div style="height:10px"></div></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    expect(boxes.find((x) => x.p === "0.1.0")?.h).toBe(30);
  });
});

describe("viewBox-only svg in a shrink-to-fit context", () => {
  const widthOfSvg = async (wrap: string): Promise<number> => {
    let boxes: { t: string; w: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body>${wrap}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    return boxes.find((x) => x.t === "svg")?.w ?? -1;
  };
  const svg = '<svg viewBox="0 0 100 20"></svg>';

  it("has no width of its own inside a float, inline-block or fit-content box (Chromium: 0)", async () => {
    expect(await widthOfSvg(`<div style="float:left">${svg}</div>`)).toBe(0);
    expect(await widthOfSvg(`<div style="display:inline-block">${svg}</div>`)).toBe(0);
    expect(await widthOfSvg(`<div style="width:fit-content">${svg}</div>`)).toBe(0);
  });

  it("fills a plain block and a stretched grid track", async () => {
    expect(await widthOfSvg(`<div>${svg}</div>`)).toBe(600);
    expect(await widthOfSvg(`<div style="display:grid;grid-template-columns:1fr">${svg}</div>`)).toBe(600);
  });

  it("is 0 in a min-content grid track", async () => {
    expect(await widthOfSvg(`<div style="display:grid;grid-template-columns:min-content 2fr">${svg}</div>`)).toBe(0);
  });
});

describe("grid rows sharing free space", () => {
  const rows = async (body: string) => {
    let boxes: { p: string; h: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    return boxes;
  };

  it("does not grow a row to the content of a scroll-container item when the grid height is definite", async () => {
    const b = await rows('<div style="display:grid;height:20px"><div style="overflow:hidden"><div style="height:80px"></div></div></div>');
    expect(b.find((x) => x.p === "0.1.0.0")?.h).toBe(20);
  });

  it("gives free space to rows that can still grow before stretching the others", async () => {
    const b = await rows(
      '<div style="display:grid;height:100px"><div style="overflow:hidden"><div style="height:80px"></div></div><div style="height:30px"></div></div>',
    );
    expect(b.find((x) => x.p === "0.1.0.0")?.h).toBe(70);
  });
});

describe("min-content size of flex content in a grid track", () => {
  const widthOf = async (inner: string): Promise<number> => {
    let boxes: { p: string; w: number }[] = [];
    await render({
      value: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0}</style></head><body><div style="display:grid;grid-template-columns:min-content">${inner}</div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        boxes = b;
      },
    });
    return boxes.find((x) => x.p === "0.1.0.0")?.w ?? -1;
  };

  it("is the sum of the items for a row that cannot wrap", async () => {
    expect(await widthOf('<div style="display:flex"><div style="min-width:30px;height:5px"></div><div style="min-width:40px;height:5px"></div></div>')).toBe(70);
  });

  it("is the widest item for a wrapping row and for a column", async () => {
    expect(await widthOf('<div style="display:flex;flex-wrap:wrap"><div style="min-width:30px;height:5px"></div><div style="min-width:40px;height:5px"></div></div>')).toBe(40);
    expect(await widthOf('<div style="display:flex;flex-direction:column"><div style="min-width:30px;height:5px"></div><div style="min-width:40px;height:5px"></div></div>')).toBe(40);
  });

  it("counts a definite width in full even when the item can shrink", async () => {
    expect(await widthOf('<div style="display:flex"><div style="width:90px;flex:1;height:5px"></div></div>')).toBe(90);
  });
});

describe("fr track with text in a narrow grid", () => {
  it("keeps the track at the min-content width of its text instead of the container width", async () => {
    // 1fr is minmax(auto, 1fr): the unbreakable word makes the track wider than the 40px grid
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:1fr;width:40px"><div style="background:#f00;font:16px sans-serif">Supercalifragilisticexpialidocious</div></div>',
      300, 60,
    );
    expect(at(120, 2)).toEqual([255, 0, 0]);
  });
});

describe("minmax(min, 1fr) next to an auto track", () => {
  it("shares only the space the auto track leaves, starting from the minimum", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:minmax(50px,1fr) auto;width:300px"><div style="background:#f00;height:10px"></div><div style="background:#00f;width:100px;height:10px"></div></div>',
      400, 40,
    );
    expect(at(150, 5)).toEqual([255, 0, 0]);
    expect(at(250, 5)).toEqual([0, 0, 255]);
    expect(at(350, 5)).toEqual([255, 255, 255]);
  });
});

describe("floated grid with fr tracks", () => {
  it("shares the available width instead of overflowing with the max-content sizes", async () => {
    const long = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt";
    const { at } = await renderPng(
      `<div style="display:grid;grid-template-columns:1fr 1fr;float:left;font:16px sans-serif"><div style="background:#f00">${long}</div><div style="background:#00f">${long}</div></div>`,
      300, 200,
    );
    // two tracks of 150px each inside the 300px viewport
    expect(at(100, 5)).toEqual([255, 0, 0]);
    expect(at(250, 5)).toEqual([0, 0, 255]);
  });
});

describe("auto track beside an fr track holding a fixed-width item", () => {
  it("gives way to the fr track's minimum when the grid is too narrow", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:auto 1fr;width:150px;font:16px sans-serif"><div style="background:#00f">a b c d e f g h i j k l</div><div style="background:#f00;width:100px;height:10px"></div></div>',
      300, 120,
    );
    // the red item keeps its 100px, so it starts at x=50 and the blue text track is squeezed to 50px
    expect(at(60, 3)).toEqual([255, 0, 0]);
    expect(at(10, 3)).toEqual([0, 0, 255]);
  });
});

describe("padded grid item row height", () => {
  it("measures the item once, not with its padding subtracted twice", async () => {
    // two 100px boxes fit side by side in 230px minus 2x10px padding; subtracting the padding twice would wrap them
    const box = '<span style="display:inline-block;width:100px;height:10px"></span>';
    const { height } = await render({
      value: `<html><body style="margin:0;font-size:0"><div style="display:grid;grid-template-columns:230px"><div style="padding:10px">${box}${box}</div></div></body></html>`,
      width: 600,
      format: "png",
    });
    expect(height).toBe(30);
  });
});

describe("fit-content() track in a grid that is too narrow", () => {
  it("shrinks like an auto track to make room for the fr track's minimum", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:fit-content(200px) 1fr;width:150px;font:16px sans-serif"><div style="background:#00f">a b c d e f g h i j k l</div><div style="background:#f00;width:100px;height:10px"></div></div>',
      300, 120,
    );
    expect(at(60, 3)).toEqual([255, 0, 0]);
    expect(at(10, 3)).toEqual([0, 0, 255]);
  });
});

describe("fit-content grid with a spanning item before single-column ones", () => {
  it("sizes the fr track from the spanning item minus the auto track, not the whole item", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:auto 1fr;width:fit-content"><div style="grid-column:span 2;width:200px;height:5px"></div><div style="width:50px;height:5px;background:#f00"></div><div style="width:10px;height:5px;background:#00f"></div></div>',
      400, 30,
    );
    // columns are 50 + 150: the 200px item sets the grid width
    expect(at(55, 7)).toEqual([0, 0, 255]);
    expect(at(205, 7)).toEqual([255, 255, 255]);
  });
});

describe("floated grid with an auto and an fr track", () => {
  it("gives the fr track only what the auto track leaves of the available width", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:auto 1fr;float:left"><div style="width:250px;height:5px;background:#00f"></div><div style="width:50px;height:5px;background:#f00"></div></div><div style="clear:both"></div>',
      300, 30,
    );
    // 250px auto track, then the 1fr track starts at 250 (not pushed right by an oversized share)
    expect(at(255, 2)).toEqual([255, 0, 0]);
  });
});

describe("max-content track in a narrow grid", () => {
  it("is as wide as the item with no line broken, and the grid overflows", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:max-content 1fr;width:100px"><div style="white-space:normal;font:16px sans-serif;width:max-content;height:5px;background:#00f">aaaa bbbb cccc dddd eeee ffff gggg hhhh</div><div style="height:5px;background:#f00"></div></div>',
      600, 30,
    );
    // the first track is the whole sentence (well over 100px), so the fr track starts beyond it
    expect(at(150, 2)).toEqual([0, 0, 255]);
  });
});

describe("ratio-only svg in a max-content grid track", () => {
  it("does not stretch to fill the unbounded measuring width", async () => {
    const { height } = await render({
      value: '<html><body style="margin:0"><div style="display:grid;grid-template-columns:max-content 1fr;width:200px"><div style="height:80px"><svg viewBox="0 0 40 60"></svg></div><div style="height:10px"></div></div></body></html>',
      width: 600,
      format: "png",
    });
    expect(height).toBeLessThan(2000);
  });
});

describe("flex-basis in an intrinsic size", () => {
  it("is ignored for an item that can shrink: the empty shrinkable item contributes nothing", async () => {
    const { at } = await renderPng('<div style="display:inline-flex;vertical-align:top"><div style="flex:0 1 100px;height:5px;background:#f00"></div></div>', 300, 20);
    expect(at(50, 2)).toEqual([255, 255, 255]);
  });
  it("counts for an item that cannot shrink", async () => {
    const { at } = await renderPng('<div style="display:inline-flex;vertical-align:top"><div style="flex:0 0 100px;height:5px;background:#f00"></div></div>', 300, 20);
    expect(at(50, 2)).toEqual([255, 0, 0]);
  });
});

describe("justify-content: space-around with overflowing items", () => {
  it("falls back to safe center: the item starts at the start edge instead of overflowing both sides", async () => {
    const { at } = await renderPng(
      '<div style="margin-left:100px;display:flex;justify-content:space-around;width:20px"><div style="width:90px;height:5px;background:#f00;flex:none"></div></div>',
      300, 20,
    );
    // true centering would put the item at x=65 (100 + (20-90)/2); safe centering keeps it at x=100
    expect(at(80, 2)).toEqual([255, 255, 255]);
    expect(at(110, 2)).toEqual([255, 0, 0]);
  });
});

describe("flex container of width 0", () => {
  it("is really 0 wide: a centred item overflows on both sides", async () => {
    const { at } = await renderPng(
      '<div style="margin-left:100px;display:flex;justify-content:center;width:0"><div style="width:10px;height:5px;background:#f00;flex:none"></div></div>',
      300, 20,
    );
    // centred on x=100: the item spans 95..105 (it used to start at 100 as if the container were 10px wide)
    expect(at(97, 2)).toEqual([255, 0, 0]);
    expect(at(107, 2)).toEqual([255, 255, 255]);
  });
});

describe("flex-basis wider than the width of a shrinkable item", () => {
  it("an inline-flex container is as wide as the item's width, not its flex-basis", async () => {
    const { at } = await renderPng(
      '<div style="display:inline-flex;vertical-align:top"><div style="width:20px;height:5px;background:#f00;flex:0 1 100px"></div></div>',
      300, 20,
    );
    expect(at(10, 2)).toEqual([255, 0, 0]);
    expect(at(40, 2)).toEqual([255, 255, 255]);
  });
});

describe("first baseline of a block whose first child is empty", () => {
  it("skips the empty child: a flex item's baseline falls back to its bottom edge", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;align-items:baseline;width:60px"><div style="width:20px;height:5px;background:#00f"></div><div style="width:20px"><div></div><div style="height:10px;background:#f00"></div></div></div>',
      100, 30,
    );
    // baselines meet at the bottom edges: the red box spans y=0..10, the blue one y=5..10
    expect(at(30, 2)).toEqual([255, 0, 0]);
    expect(at(10, 7)).toEqual([0, 0, 255]);
    expect(at(10, 2)).toEqual([255, 255, 255]);
  });
});

describe("percentage height of a flex item", () => {
  it("resolves against the definite height of the container", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;height:80px;width:40px;background:#fff"><div style="height:25%;width:40px;background:#f00"><div style="min-height:30px"></div></div></div>',
      60, 100,
    );
    // 25% of 80px = 20px; the 30px child overflows instead of stretching the item
    expect(at(10, 15)).toEqual([255, 0, 0]);
    expect(at(10, 25)).toEqual([255, 255, 255]);
  });
  it("a border-box item with margins keeps the full percentage height", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;height:80px;width:40px;background:#fff"><div style="box-sizing:border-box;height:25%;width:20px;margin:12px;padding:3px;background:#f00"></div></div>',
      60, 100,
    );
    // 25% of 80px = 20px border box, starting below the 12px margin: y 12..32
    expect(at(20, 15)).toEqual([255, 0, 0]);
    expect(at(20, 30)).toEqual([255, 0, 0]);
    expect(at(20, 34)).toEqual([255, 255, 255]);
  });
});

describe("baseline of a nested flex container with a padded empty item", () => {
  it("does not shift the container by the item's padding", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;align-items:baseline"><div style="display:flex"><div style="padding:8px;background:#f00"></div></div></div>',
      60, 40,
    );
    expect(at(8, 2)).toEqual([255, 0, 0]);
    expect(at(8, 14)).toEqual([255, 0, 0]);
  });
});

describe("baseline of a flex item with a block-level child and margins on both edges", () => {
  it("offsets by the block-start margin only, not by the block-end one", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;align-items:baseline;width:60px">' +
        '<div style="width:10px;height:36px;background:#00f"></div>' +
        '<div style="margin:4px;width:10px;background:#f00"><div style="display:flex"><div style="height:20px"></div></div></div>' +
        "</div>",
      80, 60,
    );
    // The item's baseline is 20px above its border-box bottom, so the line's baseline (36px, from
    // the blue item) puts its border box at y=16..36: its 4px margins sit outside that, they are
    // not added twice (which would lift the box to y=12).
    expect(at(20, 34)).toEqual([255, 0, 0]);
    expect(at(20, 14)).toEqual([255, 255, 255]);
    expect(at(20, 38)).toEqual([255, 255, 255]);
  });
});

describe("width: fit-content below the min-content width", () => {
  it("a block does not shrink under its min-content width", async () => {
    const { at } = await renderPng(
      '<div style="width:44px"><div style="width:fit-content;background:#f00"><div style="width:50px;height:5px"></div></div></div>',
      100, 20,
    );
    expect(at(47, 2)).toEqual([255, 0, 0]);
  });
  it("a grid item is neither stretched nor squeezed below it", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:44px"><div style="width:fit-content;background:#f00"><div style="width:50px;height:5px"></div></div></div>',
      100, 20,
    );
    expect(at(47, 2)).toEqual([255, 0, 0]);
    expect(at(55, 2)).toEqual([255, 255, 255]);
  });
});

describe("percentage height of an absolutely positioned box", () => {
  it("resolves against the containing block, so the content overflows instead of growing the box", async () => {
    const { at } = await renderPng(
      '<div style="position:relative;height:100px;width:40px"><div style="position:absolute;height:30%;width:40px;background:#f00"><div style="min-height:40px"></div></div></div>',
      60, 100,
    );
    expect(at(10, 20)).toEqual([255, 0, 0]);
    expect(at(10, 60)).toEqual([255, 255, 255]);
  });
});

describe("bottom margin of a nested block in a shrink-to-fit box", () => {
  it("a float measured twice keeps the margin its last descendant collapsed out", async () => {
    const { at } = await renderPng(
      '<div style="float:left;background:#f00"><div style="width:40px"><div style="height:8px;margin-bottom:12px"></div></div></div><div style="clear:both;height:5px;background:#00f"></div>',
      80, 60,
    );
    // float: 8px content + 12px margin = 20px, then the blue strip starts at y=20
    expect(at(10, 15)).toEqual([255, 0, 0]);
    expect(at(10, 22)).toEqual([0, 0, 255]);
  });
});

describe("float wider than its container", () => {
  it("a width:auto float whose content cannot shrink is as wide as that content", async () => {
    const { at } = await renderPng(
      '<div style="width:45px"><div style="float:left;background:#f00"><div style="width:90px;height:5px"></div></div></div>',
      120, 20,
    );
    expect(at(80, 2)).toEqual([255, 0, 0]);
    expect(at(95, 2)).toEqual([255, 255, 255]);
  });
});

describe("padded float that overflows its container", () => {
  it("stays at the top of the line instead of being pushed down by its padding", async () => {
    const { at } = await renderPng(
      '<div style="width:20px"><div style="float:left;min-width:40px;padding:8px;background:#f00"></div></div>',
      100, 40,
    );
    expect(at(10, 2)).toEqual([255, 0, 0]);
    expect(at(10, 20)).toEqual([255, 255, 255]);
  });
});

describe("grid item shorter than a line of text", () => {
  it("an auto row is as tall as a fixed-height block inside the item, not one line", async () => {
    const { at } = await renderPng(
      '<div style="display:grid"><div><div style="height:3px;background:#f00"></div></div></div><div style="height:4px;background:#00f"></div>',
      40, 40,
    );
    expect(at(10, 1)).toEqual([255, 0, 0]);
    expect(at(10, 5)).toEqual([0, 0, 255]);
  });
});

describe("inline svg", () => {
  it("sits on the baseline like an image: the UA sheet gives it no vertical-align", async () => {
    const page = (style: string) =>
      `<!DOCTYPE html><html><body style="margin:0"><div style="font:16px/20px sans-serif"><svg width="10" height="60" viewBox="0 0 10 60"${style}><rect width="10" height="60" fill="#f00"/></svg></div></body></html>`;
    const plain = await render({ value: page(""), width: 40, format: "png" });
    const baseline = await render({ value: page(' style="vertical-align:baseline"'), width: 40, format: "png" });
    expect(plain.height).toBe(baseline.height);
  });
});

describe("ratio-only replaced box with a percentage width in a shrink-to-fit box", () => {
  it("the box takes the 300px default width and the svg resolves its percentage against it", async () => {
    const { at } = await renderPng(
      '<div style="float:left;background:#00f"><svg viewBox="0 0 100 60" style="width:25%;vertical-align:top"></svg></div>',
      400, 40,
    );
    // float is 300 wide (blue), the svg inside is 75 wide
    expect(at(200, 5)).toEqual([0, 0, 255]);
    expect(at(320, 5)).toEqual([255, 255, 255]);
  });
});

describe("percentage width of an item in an auto grid track", () => {
  it("is cyclic while the track is sized: the track takes the item's content, then the percentage resolves against it", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:auto 1fr;width:60px"><div style="width:50%;background:#f00"><div style="width:60px;height:5px"></div></div></div>',
      100, 20,
    );
    // track = 60 (the content), item = 50% of the track = 30
    expect(at(20, 2)).toEqual([255, 0, 0]);
    expect(at(40, 2)).toEqual([255, 255, 255]);
  });
});

describe("the hidden attribute", () => {
  it("hides the element unless the author sets display", async () => {
    const { at } = await renderPng(
      '<style>.show{display:block}</style><div hidden style="height:10px;background:#f00"></div><div class="show" hidden style="height:10px;background:#00f"></div>',
      40, 30,
    );
    expect(at(5, 5)).toEqual([0, 0, 255]); // the first box is gone, the second (author display:block) sits at the top
    expect(at(5, 15)).toEqual([255, 255, 255]);
  });
});

describe("height: fit-content on a grid or flex item", () => {
  it("is not stretched to the row or line", async () => {
    for (const display of ["grid", "flex"]) {
      const { at } = await renderPng(
        `<div style="display:${display};${display === "grid" ? "grid-template-columns:20px 20px" : ""}"><div style="width:20px;height:fit-content;background:#f00"><div style="height:10px"></div></div><div style="width:20px;height:40px"></div></div>`,
        60, 60,
      );
      expect(at(5, 5)).toEqual([255, 0, 0]);
      expect(at(5, 25)).toEqual([255, 255, 255]);
    }
  });
});

describe("width: fit-content on an item of a column flex container", () => {
  it("is not stretched across the container", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;flex-direction:column"><div style="width:fit-content;background:#f00"><div style="width:20px;height:10px"></div></div></div>',
      60, 30,
    );
    expect(at(10, 5)).toEqual([255, 0, 0]);
    expect(at(40, 5)).toEqual([255, 255, 255]);
  });
});

describe("cross size of a wrapping column flex line", () => {
  it("is the widest item's size, not clamped to the container's width", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;flex-direction:column;flex-wrap:wrap;width:40px"><div style="background:#f00"><div style="width:80px;height:10px"></div></div></div>',
      120, 30,
    );
    expect(at(60, 5)).toEqual([255, 0, 0]);
    expect(at(100, 5)).toEqual([255, 255, 255]);
  });
});

describe("empty block measured again after being stretched", () => {
  it("an item stretched in an earlier layout does not keep that height when it wraps onto a short line", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;width:80px"><div style="display:flex;flex-wrap:wrap;padding:8px"><div style="width:20px;background:#f00"></div><div style="width:60px;height:30px;background:#00f"></div></div></div>',
      120, 100,
    );
    // line 1 is empty (0 tall), line 2 holds the 30px box: it starts at y=8, the container is 46 tall
    expect(at(40, 12)).toEqual([0, 0, 255]);
    expect(at(40, 50)).toEqual([255, 255, 255]);
  });
});

describe("percentage height of a grid item", () => {
  it("resolves against the grid area once the rows are sized from the content", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;width:40px"><div style="height:50%;background:#f00"><div style="height:40px"></div></div></div>',
      60, 60,
    );
    // the row is 40px (the content); 50% of it is 20px
    expect(at(10, 10)).toEqual([255, 0, 0]);
    expect(at(10, 30)).toEqual([255, 255, 255]);
  });
});

describe("min-content size of a grid with minmax(40px, 1fr)", () => {
  it("is the track's minimum, not its item's width, so a nested grid can shrink in a narrow auto track", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;width:60px"><div style="display:grid;grid-template-columns:minmax(40px,1fr) 1fr;background:#f00"><div style="width:90px;height:5px"></div></div></div>',
      120, 10,
    );
    expect(at(50, 2)).toEqual([255, 0, 0]);
    expect(at(70, 2)).toEqual([255, 255, 255]);
  });
});

describe("baseline alignment details", () => {
  it("in a column container the items line their border edges up on the widest start margin", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;flex-direction:column;align-items:baseline"><div style="margin:4px;width:10px;height:5px;background:#f00"></div><div style="width:10px;height:5px;background:#00f"></div></div>',
      40, 30,
    );
    // both boxes start at x=4 (the first one's margin sets the shared edge)
    expect(at(6, 6)).toEqual([255, 0, 0]);
    expect(at(6, 13)).toEqual([0, 0, 255]);
    expect(at(1, 13)).toEqual([255, 255, 255]);
  });
  it("a flex container counts as having a baseline even when its item is empty", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;align-items:baseline"><div><div style="display:flex"><div style="margin:6px 0;height:0"></div></div></div><div style="height:5px;width:10px;background:#f00"></div></div>',
      40, 40,
    );
    // the first item's baseline is the bottom of its flex item's border box (y=6): the red box sits on it, y=1..6
    expect(at(5, 3)).toEqual([255, 0, 0]);
    expect(at(5, 8)).toEqual([255, 255, 255]);
  });
});

describe("first baseline through a block holding a padded flex container", () => {
  it("is measured from the block's margin-box top, so a baseline-aligned neighbour lands on it", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;align-items:baseline"><div style="display:flex;padding:8px"><div style="padding:8px"></div></div><div><div style="display:flex;padding:8px;background:#f00"><div></div></div></div></div>',
      60, 60,
    );
    // item 1's baseline is y=24; item 2's is its flex child's bottom (8 below its top): it starts at y=16
    expect(at(5, 20)).toEqual([255, 255, 255]);
    expect(at(40, 18)).toEqual([255, 0, 0]);
  });
});

describe("baseline-aligned line height with a nested flex container", () => {
  it("is measured from placed descendants: the line is as tall as Chromium makes it", async () => {
    const r = await render({
      value: '<html><body style="margin:0"><div style="display:flex;align-items:baseline"><div style="display:flex;padding:8px"><div style="padding:8px"></div></div><div><div style="display:flex;padding:8px"><div></div></div></div></div></body></html>',
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(32);
  });
});

describe("absolute box inside a box that only creates a stacking context", () => {
  it("resolves against the positioned ancestor, not against isolation / opacity / mix-blend-mode boxes", async () => {
    for (const style of ["isolation:isolate", "opacity:.99", "mix-blend-mode:multiply"]) {
      const { at } = await renderPng(
        `<div style="position:relative"><div style="${style};margin-left:60px;height:10px"><i style="position:absolute;left:0;top:0;width:10px;height:5px;background:#f00"></i></div></div>`,
        100, 20,
      );
      expect(near(at(5, 2), [255, 0, 0]), style).toBe(true);
      expect(at(65, 2)).toEqual([255, 255, 255]);
    }
  });
});

describe("baseline of a column flex container", () => {
  it("is measured down the block axis, not from the item's horizontal offset", async () => {
    // The 90px item overflows to the left of its 20px column (align-items:flex-end); that
    // horizontal offset must not move the inline-flex box down.
    const r = await render({
      value:
        '<html><body style="margin:0;font-size:0;line-height:0"><div style="display:inline-flex"><div style="display:flex;flex-direction:column;align-items:flex-end;width:20px"><div style="width:90px"></div></div></div></body></html>',
      width: 100,
      format: "png",
    });
    expect(r.height).toBeLessThan(10);
  });
});

describe("percentage height under a flex item of an auto-height container", () => {
  const heightOf = async (container: string) => {
    const r = await render({
      value: `<html><body style="margin:0;font-size:0;line-height:0">${container}</body></html>`,
      width: 100,
      format: "png",
    });
    return r.height;
  };
  const inner = '<div><div style="height:30%"><div style="height:36px"></div></div></div>';
  it("is auto under a stretched row item", async () => {
    expect(await heightOf(`<div style="display:flex">${inner}</div>`)).toBe(36);
  });
  it("is auto under a column item", async () => {
    expect(await heightOf(`<div style="display:flex;flex-direction:column">${inner}</div>`)).toBe(36);
  });
});

describe("percentage height of a column flex item against a fixed container", () => {
  it("shrinks to the percentage even when the content is taller", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;flex-direction:column;height:20px;width:40px;background:#fff"><div style="box-sizing:border-box;height:100%;padding:8px;background:#f00"><div style="height:10px"></div></div></div><div style="background:#00f;height:30px"></div>',
      60, 60,
    );
    // The item is 20px (100% of the container), not 26px (its padded content)
    expect(at(20, 18)).toEqual([255, 0, 0]);
    expect(at(20, 22)).toEqual([0, 0, 255]);
  });
});

describe("grid rows with an auto maximum", () => {
  it("minmax(<length>, auto) stretches into the free space of a fixed-height grid", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-auto-rows:minmax(30px,auto);height:60px;width:40px"><div style="background:#f00"></div></div>',
      60, 80,
    );
    expect(at(10, 55)).toEqual([255, 0, 0]);
    expect(at(10, 65)).toEqual([255, 255, 255]);
  });
});

describe("min-width of a border-box grid item in an fr track", () => {
  it("does not add the padding to a min-width that already includes it", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:1fr 1fr;width:60px"><div style="box-sizing:border-box;min-width:10px;padding:12px;background:#f00;height:10px"></div></div>',
      80, 20,
    );
    // the tracks stay 30px + 30px: the item's 24px padding box fits the first one
    expect(at(28, 5)).toEqual([255, 0, 0]);
    expect(at(32, 5)).toEqual([255, 255, 255]);
  });
});

describe("width: fit-content item of a column flex container", () => {
  it("lays its children out at the min-width clamped width", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;flex-direction:column"><div style="width:fit-content;min-width:100px"><div style="height:5px;background:#f00"></div></div></div>',
      150, 20,
    );
    expect(at(90, 2)).toEqual([255, 0, 0]);
    expect(at(110, 2)).toEqual([255, 255, 255]);
  });
});

describe("percentage width of a grid item in a content-sized track", () => {
  for (const tracks of ["", "grid-template-columns:auto;", "grid-template-columns:1fr;"]) {
    it(`takes its content as the track floor (${tracks || "implicit"})`, async () => {
      const { at } = await renderPng(
        `<div style="display:grid;${tracks}width:60px"><div style="width:25%;height:5px;background:#f00"><div style="width:90px"></div></div></div>`,
        120, 20,
      );
      // the track is 90px wide (the child's width), so 25% is 22.5px, not 15px
      expect(at(20, 2)).toEqual([255, 0, 0]);
      expect(at(26, 2)).toEqual([255, 255, 255]);
    });
  }
});

describe("ratio-only svg inside a flex container in a shrink-to-fit box", () => {
  it("contributes no width, so the inline-block stays empty", async () => {
    const r = await render({
      value:
        '<html><body style="margin:0;font-size:0;line-height:0"><div style="display:inline-block"><div style="display:flex"><svg viewBox="0 0 100 60"></svg></div></div></body></html>',
      width: 200,
      format: "png",
    });
    expect(r.height).toBeLessThan(5);
  });
});

describe("floats inside a flex or grid item", () => {
  for (const container of ["flex", "grid"]) {
    it(`a ${container} item contains its float`, async () => {
      const r = await render({
        value: `<html><body style="margin:0;font-size:0;line-height:0"><div style="display:${container}"><div><div style="float:left;width:5px;height:10px"></div></div></div></body></html>`,
        width: 100,
        format: "png",
      });
      expect(r.height).toBe(10);
    });
  }
  it("a float child of a flex container is a flex item, not a float", async () => {
    const r = await render({
      value:
        '<html><body style="margin:0;font-size:0;line-height:0"><div style="display:flex"><div style="float:left;height:60px;flex:1"><svg viewBox="0 0 40 20"></svg></div></div></body></html>',
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(60);
  });
});

describe("width: fit-content on a ratio-only svg grid item", () => {
  it("still fills the grid area", async () => {
    const r = await render({
      value:
        '<html><body style="margin:0;font-size:0;line-height:0"><div style="display:grid"><svg viewBox="0 0 40 20" style="width:fit-content"></svg></div></body></html>',
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(50);
  });
});

describe("replaced flex item stretched to a definite container height", () => {
  const svg = (w: number, h: number) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f00"/></svg>`)}`;
  it("keeps its aspect ratio by growing wider", async () => {
    const { at } = await renderPng(
      `<div style="display:flex;height:60px;width:100px;background:#fff"><img src="${svg(20, 30)}"></div>`,
      100, 70,
    );
    // 20x30 stretched to 60px tall is 40px wide
    expect(at(35, 30)).toEqual([255, 0, 0]);
    expect(at(45, 30)).toEqual([255, 255, 255]);
  });
});

describe("percentage-width ratio-only svg in a max-content grid track", () => {
  it("takes the 300px default width for the track", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:max-content 1fr;width:500px;background:#fff"><div style="height:20px;background:#f00"><svg viewBox="0 0 40 60" style="width:30%"></svg></div><div style="height:20px;background:#00f"></div></div>',
      520, 30,
    );
    expect(at(290, 5)).toEqual([255, 0, 0]);
    expect(at(310, 5)).toEqual([0, 0, 255]);
  });
});

describe("automatic minimum size of a replaced grid item", () => {
  it("an svg (overflow: hidden) still holds its fr track open", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;width:240px;background:#fff"><div style="height:5px;background:#00f"></div><svg viewBox="0 0 100 60" preserveAspectRatio="none" style="width:120px;height:5px"><rect width="100" height="60" fill="#f00"/></svg><div></div></div>',
      260, 10,
    );
    // 1fr tracks: the svg floors the middle track at 120px, the others share the remaining 120px (60 + 60)
    expect(at(30, 2)).toEqual([0, 0, 255]);
    expect(at(70, 2)).toEqual([255, 0, 0]);
    expect(at(175, 2)).toEqual([255, 0, 0]);
    expect(at(185, 2)).toEqual([255, 255, 255]);
  });
});

describe("ratio-only svg next to a float", () => {
  it("keeps the containing block's width and drops below the float", async () => {
    const r = await render({
      value:
        '<html><body style="margin:0;font-size:0;line-height:0"><div style="float:right;width:24px;height:24px"></div><svg viewBox="0 0 40 60"></svg></body></html>',
      width: 100,
      format: "png",
    });
    // the 100px wide box (150px tall) does not fit beside the 24px float: 24 + 150
    expect(r.height).toBe(174);
  });
});

describe("ratio-only svg in a shrink-to-fit box with a definite width", () => {
  for (const box of ["display:inline-flex", "display:inline-block", "float:left"]) {
    it(`fills a ${box} box of width 50px`, async () => {
      const r = await render({
        value: `<html><body style="margin:0;font-size:0;line-height:0"><div style="${box};width:50px"><svg viewBox="0 0 100 60"></svg></div></body></html>`,
        width: 200,
        format: "png",
      });
      expect(r.height).toBe(30);
    });
  }
});

describe("a block whose only content is a collapsed-through margin", () => {
  const heightOf = async (body: string) =>
    (await render({
      value: `<html><body style="margin:0;font-size:0;line-height:0">${body}</body></html>`,
      width: 100,
      format: "png",
    })).height;
  it("an empty block's margin is counted once in the page height", async () => {
    expect(await heightOf('<div style="margin:12px"></div>')).toBe(12);
  });
  it("a wrapper of an empty block collapses through itself too", async () => {
    // wrapper (collapsed-through 12px) + sibling 5px: the margin is not doubled
    expect(await heightOf('<div><div style="margin:12px"></div></div><div style="height:5px"></div>')).toBe(17);
  });
});

describe("percentage width of an inline-block next to a float", () => {
  it("resolves against the containing block, not the space the float left", async () => {
    const { at } = await renderPng(
      '<div style="width:120px;background:#fff;font-size:0;line-height:0"><div style="float:right;width:50px;height:5px;background:#00f"></div><div style="display:inline-block;width:25%;height:5px;background:#f00"></div></div>',
      140, 10,
    );
    // 25% of 120px = 30px (not 25% of the 70px beside the float)
    expect(at(25, 2)).toEqual([255, 0, 0]);
    expect(at(35, 2)).toEqual([255, 255, 255]);
  });
});

describe("a float after a run of inline content", () => {
  it("joins the last line when it fits beside the content", async () => {
    const { at } = await renderPng(
      '<div style="font-size:0;line-height:0;background:#fff"><div style="display:inline-block;width:50px;height:40px;background:#00f"></div><div style="float:right;width:20px;height:5px;background:#f00"></div></div>',
      100, 50,
    );
    // the float sits at the top of the line (y 0..5), not below the 40px inline-block
    expect(at(90, 2)).toEqual([255, 0, 0]);
    expect(at(90, 20)).toEqual([255, 255, 255]);
  });
});

describe("max-content width of a float holding a float and inline content", () => {
  it("adds the inline content beside the inner float", async () => {
    const { at } = await renderPng(
      '<div style="float:left;background:#fff"><div style="float:left;width:50px;height:5px;background:#00f"></div><div style="display:inline-block;width:20px;height:5px;background:#f00;vertical-align:top"></div></div>',
      100, 10,
    );
    // the outer float is 70px wide (50 + 20), so the red box sits at x 50..70
    expect(at(60, 2)).toEqual([255, 0, 0]);
  });
});

describe("baseline of an empty inline-block with a margin", () => {
  it("is the bottom margin edge, so a following empty inline-block lines up with it", async () => {
    const { at } = await renderPng(
      '<div style="font-size:0;line-height:0;background:#fff"><div style="display:inline-block;margin:4px"><div></div></div><div style="display:inline-block;width:10px;height:4px;background:#f00"></div></div>',
      40, 20,
    );
    // the first box's margin edge is at y 8, and the second box sits on it: y 4..8
    expect(at(10, 5)).toEqual([255, 0, 0]);
    expect(at(10, 1)).toEqual([255, 255, 255]);
  });
});

describe("height of a box whose float joined the preceding inline line", () => {
  it("does not count the float below the inline content", async () => {
    const r = await render({
      value:
        '<html><body style="margin:0;font-size:0;line-height:0"><div style="display:inline-block;height:20px"></div><div style="float:right;margin:8px"></div></body></html>',
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(20);
  });
});

describe("baseline of a line that holds only an inline-block taller than the line height", () => {
  it("is the inline-block's bottom edge, so a flex sibling aligns to it", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;align-items:baseline;font-size:0;line-height:0;background:#fff"><div><div style="display:inline-block;width:10px;height:16px"></div></div><div style="width:10px;height:4px;background:#f00"></div></div>',
      40, 20,
    );
    // the 4px box sits on the baseline at y 16: it fills y 12..16
    expect(at(15, 14)).toEqual([255, 0, 0]);
    expect(at(15, 5)).toEqual([255, 255, 255]);
  });
});

describe("max-content width of a wrapping flex container", () => {
  it("a fixed flex-basis does not hide the item's wider width", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;justify-items:start;width:200px"><div style="display:flex;flex-wrap:wrap;background:#f00"><div style="width:90px;height:5px;flex:0 0 40px"></div></div></div>',
      200, 10,
    );
    // the container is 90px wide (the item's width), not 40px
    expect(at(80, 2)).toEqual([255, 0, 0]);
    expect(at(95, 2)).toEqual([255, 255, 255]);
  });
});

describe("a wrapper of an empty flex container", () => {
  it("keeps both margins: a flex container does not collapse through itself", async () => {
    const r = await render({
      value: '<html><body style="margin:0;font-size:0;line-height:0"><div><div style="display:flex;margin:2px"></div></div></body></html>',
      width: 100,
      format: "png",
    });
    expect(r.height).toBe(4);
  });
});

describe("baseline of a padded column flex container", () => {
  it("includes the container's padding", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;align-items:baseline;background:#fff"><div style="display:flex;flex-direction:column;padding:6px"><div></div></div><div style="width:10px;height:4px;background:#f00"></div></div>',
      60, 20,
    );
    // the column's first baseline is the bottom of its padding-top (y 6): the 4px box sits at y 2..6
    expect(at(14, 4)).toEqual([255, 0, 0]);
    expect(at(14, 8)).toEqual([255, 255, 255]);
  });
});

describe("max-content contribution of a flex item with a definite width and flex-basis", () => {
  const boxWidth = async (item: string) => {
    const { img, at } = await renderPng(
      `<div style="display:grid;justify-items:start;width:300px"><div style="display:inline-flex;background:#f00;height:4px">${item}</div></div>`,
      300, 6,
    );
    let w = 0;
    for (let x = 0; x < img.width; x++) if (at(x, 1)[1] === 0) w = x + 1;
    return w;
  };
  it("a growable, shrinkable item contributes its width (flex: 2 1 0)", async () => {
    expect(await boxWidth('<div style="width:20px;flex:2 1 0"></div>')).toBe(20);
  });
  it("an item that can neither grow nor shrink contributes its flex-basis", async () => {
    expect(await boxWidth('<div style="width:90px;flex:0 0 40px"></div>')).toBe(40);
  });
  it("an item that can grow but not shrink contributes at least its width", async () => {
    expect(await boxWidth('<div style="width:90px;flex:1 0 40px"></div>')).toBe(90);
  });
});

describe("cross size of the line of a wrapping row container with a fixed height", () => {
  it("is the tallest item, not the container's height", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;flex-wrap:wrap;height:20px;width:40px;background:#fff"><div style="width:10px;background:#f00"></div><div style="width:10px;height:30px;background:#00f"></div></div>',
      60, 40,
    );
    // the first item stretches to its 30px line (not the 20px container)
    expect(at(5, 25)).toEqual([255, 0, 0]);
  });
});

describe("minmax(<length>, auto) rows in a grid of definite height", () => {
  it("start at their minimum, so taller content overflows when there is no free space", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-auto-rows:minmax(30px,auto);height:60px;width:40px;background:#fff"><div style="height:36px"></div><div style="background:#f00"></div></div>',
      60, 80,
    );
    // rows are 30 + 30: the second row starts at y 30 although the first item is 36px tall
    expect(at(10, 32)).toEqual([255, 0, 0]);
  });
});

describe("fit-content() grid track and an item with an explicit min-width", () => {
  it("the min-width replaces the content-based minimum, so the limit caps the track", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:fit-content(80px) 1fr;width:300px;background:#fff"><div style="min-width:40px;background:#f00;height:5px"><div style="min-width:100px"></div></div><div style="background:#00f;height:5px"></div></div>',
      300, 10,
    );
    // the first track is 80px (not 100px): the blue item starts at x 80
    expect(at(70, 2)).toEqual([255, 0, 0]);
    expect(at(90, 2)).toEqual([0, 0, 255]);
  });
});

describe("min-content of a grid with an auto track holding a scroll container", () => {
  it("counts the scroll container's minimum contribution (0), not its content", async () => {
    const { at } = await renderPng(
      '<div style="width:120px;background:#fff"><div style="display:grid;grid-template-columns:1fr 1fr 1fr"><div style="display:grid;grid-template-columns:auto 1fr;gap:16px;background:#f00;height:5px"><div style="overflow:hidden"><div style="width:20px"></div></div></div></div></div>',
      140, 10,
    );
    // the first outer track is 40px (a third of 120), as the inner grid's min-content is only 16px
    expect(at(35, 2)).toEqual([255, 0, 0]);
    expect(at(45, 2)).toEqual([255, 255, 255]);
  });
});

describe("max-content width of a wrapping flex container", () => {
  const boxWidth = async (items: string) => {
    const { img, at } = await renderPng(
      `<div style="display:grid;justify-items:start;width:300px"><div style="display:inline-flex;flex-wrap:wrap;background:#f00;height:4px">${items}</div></div>`,
      300, 6,
    );
    let w = 0;
    for (let x = 0; x < img.width; x++) if (at(x, 1)[1] === 0) w = x + 1;
    return w;
  };
  it("is at least the widest item even when its flex-basis is smaller", async () => {
    expect(await boxWidth('<div style="width:90px;flex:0 0 40px"></div><div style="width:10px"></div>')).toBe(90);
  });
  it("sums the items' contributions otherwise", async () => {
    expect(await boxWidth('<div style="width:10px;flex:0 0 40px"></div><div style="width:10px;flex:0 0 40px"></div>')).toBe(80);
  });
});

describe("shrink-to-fit width of a wrapping flex container", () => {
  it("takes the space on offer when the items on one line are wider", async () => {
    const { at } = await renderPng(
      '<div style="width:100px;background:#fff"><div style="display:inline-flex;flex-wrap:wrap;background:#f00"><div style="width:60px;height:4px"></div><div style="width:60px;height:4px"></div></div></div>',
      140, 12,
    );
    // 100px wide (not the 60px widest item), the items on two lines
    expect(at(95, 6)).toEqual([255, 0, 0]);
    expect(at(105, 6)).toEqual([255, 255, 255]);
  });
});

describe("wrapping flex container with no space on offer", () => {
  it("falls back to its min-content width, so the items stack", async () => {
    const r = await render({
      value:
        '<html><body style="margin:0;font-size:0;line-height:0"><div style="width:20px"><div style="display:inline-block;padding:12px"><div style="display:flex;flex-wrap:wrap;gap:4px"><div></div><div></div></div></div></div></body></html>',
      width: 100,
      format: "png",
    });
    // two empty items on separate lines: 4px gap + 24px padding
    expect(r.height).toBe(28);
  });
});

describe("row height of a grid item wider than its track because of min-width", () => {
  it("measures the content at the min-width, not at the track width", async () => {
    const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" fill="#f00"/></svg>')}`;
    const r = await render({
      value: `<html><body style="margin:0;font-size:0;line-height:0"><div style="display:grid;grid-template-columns:60px"><div style="min-width:100px"><img src="${svg}" style="width:50%"></div></div></body></html>`,
      width: 200,
      format: "png",
    });
    // the image is 50% of 100px = 50px wide, 25px tall (not 50% of the 60px track: 15px)
    expect(r.height).toBe(25);
  });
});

describe("shrink-to-fit grid with a minmax(<length>, 1fr) track in a narrow box", () => {
  it("shares the space on offer instead of keeping the items' max-content sizes", async () => {
    const svg = '<svg viewBox="0 0 100 20" style="width:100%"></svg>';
    const { at } = await renderPng(
      `<div style="width:40px;background:#fff;font-size:0;line-height:0"><div style="display:inline-grid;grid-template-columns:1fr minmax(40px,1fr);background:#f00;height:4px">${svg}</div></div>`,
      100, 8,
    );
    // 40px wide: the minmax track keeps its 40px, the 1fr track gets none
    expect(at(35, 2)).toEqual([255, 0, 0]);
    expect(at(60, 2)).toEqual([255, 255, 255]);
  });
});

describe("clip: rect() of an absolutely positioned box", () => {
  it("hides a visually hidden box (overflow: hidden; clip: rect(0, 0, 0, 0))", async () => {
    const { at } = await renderPng(
      '<a style="position:absolute;left:5px;top:5px;width:40px;height:20px;background:#f00;overflow:hidden;clip:rect(0,0,0,0)"></a>',
      80, 40,
    );
    expect(at(10, 10)).toEqual([255, 255, 255]);
  });
  it("understands the legacy space-separated syntax (go.dev's skip link)", async () => {
    const { at } = await renderPng(
      '<a style="position:absolute;left:5px;top:5px;width:40px;height:20px;background:#f00;overflow:hidden;clip:rect(0 0 0 0)"></a>',
      80, 40,
    );
    expect(at(10, 10)).toEqual([255, 255, 255]);
  });
  it("clips the box itself to the rect (relative to its border box)", async () => {
    const { at } = await renderPng(
      '<a style="position:absolute;left:5px;top:5px;width:40px;height:20px;background:#00f;clip:rect(0px,20px,20px,0px)"></a>',
      80, 40,
    );
    expect(at(10, 10)).toEqual([0, 0, 255]);
    expect(at(35, 10)).toEqual([255, 255, 255]);
  });
  it("does not clip a statically positioned box", async () => {
    const { at } = await renderPng(
      '<div style="width:40px;height:20px;background:#00f;clip:rect(0,0,0,0)"></div>',
      80, 40,
    );
    expect(at(10, 10)).toEqual([0, 0, 255]);
  });
});

describe("minmax(auto, <length>) column next to an fr column", () => {
  it("reaches its maximum when the grid has free space", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:2.5fr minmax(auto,60px);width:200px;background:#fff"><div style="height:4px;background:#00f"></div><div style="height:4px;background:#f00"></div></div>',
      220, 8,
    );
    // the second column is 60px wide (x 140..200), the fr column the remaining 140px
    expect(at(135, 2)).toEqual([0, 0, 255]);
    expect(at(145, 2)).toEqual([255, 0, 0]);
  });
});

describe("input placeholder", () => {
  it("is centred in a tall field like typed text (the span wrapper has no box of its own)", async () => {
    const { img } = await renderPng(
      '<input type="search" placeholder="Abc def gjpq" style="display:block;box-sizing:border-box;border:0;margin:0;height:30px;width:200px;padding:0 16px;font:13.5px sans-serif">',
      220, 40,
    );
    const rows: number[] = [];
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < 200; x++) {
        if (img.data[(img.width * y + x) * 4] < 200) {
          rows.push(y);
          break;
        }
      }
    }
    // Chromium puts the ink at y 8..21; it used to land at 17..29
    expect(rows[0]).toBeLessThanOrEqual(10);
    expect(rows[rows.length - 1]).toBeLessThanOrEqual(24);
  });
});

describe("::placeholder", () => {
  const darkest = (img: { data: Uint8Array; width: number; height: number }) => {
    let best = [255, 255, 255];
    for (let i = 0; i < img.data.length; i += 4) {
      const v = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (v[0] + v[1] + v[2] < best[0] + best[1] + best[2]) best = v;
    }
    return best;
  };
  const field = (css: string) =>
    `<style>input{border:0;font:16px sans-serif;width:200px;height:30px}${css}</style><input placeholder="MMMM">`;

  it("keeps the UA grey by default", async () => {
    const { img } = await renderPng(field(""), 220, 40);
    expect(near(darkest(img) as Rgb, [117, 117, 117], 3)).toBe(true);
  });

  it("recolors the placeholder text only", async () => {
    const { img } = await renderPng(field("input::placeholder{color:#f00}"), 220, 40);
    expect(darkest(img)).toEqual([255, 0, 0]);
  });

  it("ignores ::placeholder on elements that are not inputs", async () => {
    const { img } = await renderPng(field("div::placeholder{color:#f00}"), 220, 40);
    expect(near(darkest(img) as Rgb, [117, 117, 117], 3)).toBe(true);
  });
});

describe("replaced flex item stretched shorter than its intrinsic height", () => {
  it("gets narrower with the aspect ratio instead of keeping its natural width", async () => {
    const png = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="50" viewBox="0 0 300 50"><rect width="300" height="50" fill="#f00"/></svg>')}`;
    const { at } = await renderPng(
      `<div style="display:flex;height:40px;width:400px;background:#fff"><img src="${png}"></div>`,
      400, 50,
    );
    // 300x50 squeezed to 40px tall is 240px wide (it used to stay 300 wide)
    expect(at(230, 20)).toEqual([255, 0, 0]);
    expect(at(250, 20)).toEqual([255, 255, 255]);
  });
});

describe("grid auto column over a narrow grid, scroll container with min-width", () => {
  it("keeps the explicit min-width as the track's floor", async () => {
    const { at } = await renderPng(
      '<div style="display:grid;grid-template-columns:auto 20px;width:45px;background:#fff"><div style="box-sizing:content-box;min-width:40px;padding:8px;overflow:hidden;height:4px;background:#f00"></div><div style="height:4px;background:#00f"></div></div>',
      100, 8,
    );
    // the first track is 56px (40 + 2*8), so the second starts at x=56 even though the grid is 45px wide
    expect(at(50, 2)).toEqual([255, 0, 0]);
    expect(at(60, 2)).toEqual([0, 0, 255]);
  });
});

describe("baseline of an empty block item inside a nested inline-flex", () => {
  it("is the border-box bottom, not the margin-box bottom", async () => {
    const { at } = await renderPng(
      '<div style="display:flex;align-items:baseline;width:20px;height:12px;background:#fff"><div><div style="display:inline-flex"><div style="margin:4px"></div></div></div><div style="width:6px;height:4px;background:#f00"></div></div>',
      30, 16,
    );
    // Chromium: the empty item's baseline is 4px down, so the red box sits at y 4..8 (it used to sit at 8..12)
    expect(at(10, 5)).toEqual([255, 0, 0]);
    expect(at(10, 10)).toEqual([255, 255, 255]);
  });
});

describe("inline-block input", () => {
  it("aligns on its centred text, not on the top of the field", async () => {
    const { height } = await render({
      value:
        '<html><body style="margin:0"><div style="font:16px sans-serif"><input style="display:inline-block;height:30px;width:100px;border:0;padding:0;font:13.5px sans-serif" value="Abc"></div></body></html>',
      width: 220,
      format: "png",
    });
    // the line is the field's 30px plus a pixel of strut: the baseline sits in the middle of
    // the field, and the 16px line box around it adds 1px under the Arial metric profile
    expect(height).toBe(31);
  });
});

// Arimo is metric-compatible with Arial, whose hhea line gap (67/2048 em) is not part of the
// ascent or the descent. That makes the split of the leading visible: Blink floors half of
// (line-height - ascent - descent) into the ascent (blink::CalculateLeadingSpace, line_utils.cc),
// it does not put the whole font line gap above the baseline.
const LINE_GAP_FONT_FACE =
  "@font-face{font-family:'ArimoProbe';src:url('https://cdn.jsdelivr.net/npm/@fontsource/arimo@5/files/arimo-latin-400-normal.woff2') format('woff2')}";

describe("leading of a font with a line gap", () => {
  it("splits the font line gap around the baseline like Blink", async () => {
    const img = await renderProbeText(
      '<div style="font-family:\'ArimoProbe\',sans-serif;font-size:100px;line-height:140px;color:#000">HH</div>',
      800,
      LINE_GAP_FONT_FACE,
    );
    let firstInk = -1;
    for (let y = 0; y < img.height && firstInk < 0; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (img.width * y + x) * 4;
        if (img.data[i + 3] > 0 && img.data[i] < 128) {
          firstInk = y;
          break;
        }
      }
    }
    // Chromium: ink rows 36..104 (putting the whole 3px line gap above the baseline gives 34).
    expect(firstInk).toBe(36);
  });
});

// P0-2: small reproductions of four layout bugs found by the fuzzer. The seeds are only
// useful as a name here: each probe below is the minimal document that used to paint
// something in the wrong place, with the expected Chromium geometry sampled as pixels.
describe("P0-2: ratio-only replaced sizing and empty baselines", () => {
  it("a cyclic percentage in an inline-flex does not make a ratio-only svg take the trial width (seed 71)", async () => {
    // The inner inline-flex is 25% of an indefinite (fit-content) containing block, so both
    // its width and the auto-width svg (100% of that block) are cyclic. The svg must
    // contribute 0 while the container is measured; contributing the 300px trial width
    // inflated the outer inline-flex to the line and the svg to 75x112.
    const { at } = await renderPng(
      `<div style="display:inline-flex;background:#0f0">
         <div style="display:inline-flex;width:25%"><svg viewBox="0 0 40 60"><rect width="40" height="60" fill="#f00"/></svg></div>
         <div style="width:40px;height:20px;background:#00f"></div>
       </div>`,
      300,
      120,
    );
    expect(near(at(20, 10), BLUE)).toBe(true); // the fixed sibling starts after the cyclic item
    expect(near(at(4, 18), [0, 255, 0])).toBe(true); // the outer box is 40px wide, not the 300px line
    expect(isWhite(at(60, 10))).toBe(true);
    expect(isWhite(at(20, 40))).toBe(true); // the svg is 20px tall, not 112px
  });

  it("a fit-content column flex is not stretched by a ratio-only svg's trial width (seed 158)", async () => {
    // A column container's cross size is the largest item contribution. The auto-width svg is
    // 100% of the (indefinite) containing block, so its contribution is 0 and the 50px sibling
    // decides the width. Resolving the svg against the measured trial width made the container
    // 300px wide and the svg 300x150 (the blue sibling moved to y=150).
    const { at } = await renderPng(
      `<div style="display:inline-flex;flex-direction:column;width:fit-content;font-size:0;line-height:0">
         <svg viewBox="0 0 40 20"><rect width="40" height="20" fill="#f00"/></svg>
         <div style="width:50px;height:10px;background:#00f"></div>
       </div>`,
      300,
      120,
    );
    expect(near(at(10, 10), RED)).toBe(true); // the svg stretches to the 50px content width
    expect(near(at(10, 30), BLUE)).toBe(true); // and the sibling sits right below its 25px height
    expect(isWhite(at(60, 10))).toBe(true); // the container is 50px wide, not the whole line
    expect(isWhite(at(10, 60))).toBe(true); // the svg is 25px tall, not 150px
  });

  it("an empty flex and an empty grid synthesize their first baseline from the border-box bottom", async () => {
    const boxes = async (display: string) => {
      const { img } = await renderPng(
        `<div style="display:flex;align-items:baseline">
           <div style="display:${display};width:20px;height:20px;margin-bottom:6px;background:#f00"></div>
           <div style="width:20px;height:30px;background:#00f"></div>
         </div>`,
        60,
        60,
      );
      return { red: colorBox(img, isReddish)!, blue: colorBox(img, isBluish)! };
    };
    for (const display of ["flex", "grid"]) {
      const { red, blue } = await boxes(display);
      // Both baselines are border-box bottoms, so the 20px red box starts 10px below the
      // 30px blue one. The old fallback used the margin-box bottom (6px lower), which put
      // the red box 4px below the blue one's top instead of 10px.
      expect(red.y1, display).toBe(blue.y1);
      expect(red.y0, display).toBe(blue.y0 + 10);
    }
  });

  it("a wrapping column flex measures an overflowing item at its fit-content width", async () => {
    // The container is 40px wide, but the item's fit-content width is 80px (the green bar).
    // Its block size has to be measured at that 80px: the ratio svg is then 80x40 and the item
    // 50px tall. Measuring at the 40px container width made the svg 80x20 and the item 30px.
    const { at } = await renderPng(
      `<div style="display:flex;flex-direction:column;flex-wrap:wrap;width:40px;height:120px;font-size:0;line-height:0">
         <div style="background:#f00">
           <div style="width:80px;height:10px;background:#0f0"></div>
           <svg viewBox="0 0 80 40"><rect width="80" height="40" fill="#00f"/></svg>
         </div>
       </div>`,
      200,
      200,
    );
    expect(near(at(60, 5), [0, 255, 0])).toBe(true); // the item is 80px wide, wider than its container
    expect(isWhite(at(100, 5))).toBe(true);
    expect(near(at(60, 40), BLUE)).toBe(true); // the svg keeps its 80x40 ratio
    expect(isWhite(at(60, 70))).toBe(true); // the item is 50px tall (10 + 40)
  });
});

// P0-3: a grid has no line boxes of its own. Its last line-box baseline, which an
// inline-block ancestor looks for, is the first row's baseline (Blink:
// core/layout/grid/layout_grid.cc and core/layout/inline/inline_layout_algorithm.cc).
// Taking the last item's baseline instead let an overflowing item grow the inline box.
describe("P0-3: grid last line-box baseline", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };
  const IMG = `<img src="data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="50" viewBox="0 0 20 50"><rect width="20" height="50" fill="#69c"/></svg>',
  )}">`;

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:content-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }

  it("an overflowing item does not stretch the inline-flex that wraps the grid (seed 3)", async () => {
    // The grid is 2 x 40px rows; the 50px image overflows the second row. Its bottom is 90,
    // but the inline-flex is 80 tall and so is the body (Chromium).
    const b = await boxes(
      `<div style="display:inline-flex"><div style="display:grid;grid-auto-rows:40px"><div></div>${IMG}</div></div>`,
    );
    expect(b.find((x) => x.p === "0.1.0")!.h).toBe(80); // inline-flex
    expect(b.find((x) => x.p === "0.1.0.0")!.h).toBe(80); // grid
    expect(b.find((x) => x.p === "0.1")!.h).toBe(80); // body
  });

  it("positions a following inline-block from the first row's baseline", async () => {
    // First row baseline: the 5px box's synthesized bottom. The 50px image is in the second
    // row, so it must not move the 10px marker: Chromium puts the inline-block at y=5 and
    // the marker at y=0.
    const b = await boxes(
      `<div><div style="display:inline-block"><div style="display:grid;grid-auto-rows:10px"><div style="height:5px"></div>${IMG}</div></div><div style="display:inline-block;width:10px;height:10px;background:#f00"></div></div>`,
    );
    expect(b.find((x) => x.p === "0.1.0.0")!.y).toBe(5);
    expect(b.find((x) => x.p === "0.1.0.1")!.y).toBe(0);
  });
});

// P0-4: a percentage width is cyclic while its containing block is being sized from its
// content, so CSS treats it as auto there (Blink: LayoutBox::ComputeLogicalWidth and
// LayoutReplaced::ComputeReplacedSize). A ratio-only svg's `width:100%` then contributes
// the 300px default object width to the shrink-to-fit ancestor, not the available width.
describe("P0-4: percentage widths inside a shrink-to-fit ancestor", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:content-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const SVG = `<svg viewBox="0 0 40 20" style="width:100%"></svg>`;

  it("sizes a percentage block wrapper from the svg's 300px default width (seed 45)", async () => {
    // fit-content = 300 (max-content), the 25% block = 75, the svg keeps its 2:1 ratio.
    const b = await boxes(`<div><div style="width:fit-content"><div style="width:25%">${SVG}</div></div></div>`);
    expect(b.find((x) => x.p === "0.1.0.0")!.w).toBe(300); // fit-content
    expect(b.find((x) => x.p === "0.1.0.0.0")!.w).toBe(75); // 25% block
    expect(b.find((x) => x.p === "0.1.0.0.0.0")!.w).toBe(75); // svg
    expect(b.find((x) => x.p === "0.1.0.0.0.0")!.h).toBeCloseTo(37.5, 1);
    expect(b.find((x) => x.p === "0.1")!.h).toBeCloseTo(37.5, 1); // body
  });

  it("treats a percentage inline-block wrapper as shrink-to-fit too (seed 45)", async () => {
    const b = await boxes(
      `<div><div style="width:fit-content"><div style="display:inline-block;width:25%">${SVG}</div></div></div>`,
    );
    expect(b.find((x) => x.p === "0.1.0.0")!.w).toBe(300); // fit-content
    expect(b.find((x) => x.p === "0.1.0.0.0")!.w).toBe(75); // inline-block at 25%
    expect(b.find((x) => x.p === "0.1.0.0.0.0")!.w).toBe(75); // svg
    expect(b.find((x) => x.p === "0.1")!.h).toBeCloseTo(37.5, 1); // body
  });

  it("keeps the walk going through nested percentage wrappers", async () => {
    const b = await boxes(
      `<div><div style="width:fit-content"><div style="width:25%"><div style="width:25%">${SVG}</div></div></div></div>`,
    );
    expect(b.find((x) => x.p === "0.1.0.0")!.w).toBe(300); // fit-content
    expect(b.find((x) => x.p === "0.1.0.0.0.0")!.w).toBe(18.75); // 25% of 25% of 300
    expect(b.find((x) => x.p === "0.1")!.h).toBeCloseTo(9.38, 1); // body
  });
});

// P0-5: a flex item's flex-basis:content size is its max-content size, which does not depend on
// the space on offer (Blink: FlexItem::ComputeFlexBaseSize takes the item's max-content
// contribution). A wrapping flex container inside such an item therefore breaks its line at its
// own max-content width, not at the outer container's width.
describe("P0-5: flex-basis content is max-content", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:content-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }

  it("does not wrap an inline-flex by the narrower outer flex width (seed 65)", async () => {
    // The flex:none item is 84 wide (80 svg + 2px margins), so the inline-flex keeps both of its
    // items on one line and is 120 tall; at the outer 40px it would wrap the 4px margin box and be
    // 124 tall (Chromium: 84 x 120).
    const b = await boxes(
      `<div style="display:flex;width:40px"><div style="flex:none"><div style="display:inline-flex;flex-wrap:wrap"><svg viewBox="0 0 40 60" style="width:80px"></svg><div style="margin:2px"></div></div></div></div>`,
    );
    expect(b.find((x) => x.p === "0.1.0.0")!.w).toBe(84); // flex:none item
    expect(b.find((x) => x.p === "0.1.0.0.0")!.w).toBe(84); // inline-flex
    expect(b.find((x) => x.p === "0.1.0.0.0")!.h).toBe(120); // one line
    expect(b.find((x) => x.p === "0.1")!.h).toBe(120); // body
  });
});

// P0-6: fuzz seeds 87/94/132/142/156/189. A column flex item is laid out at the inline size it
// actually gets (its own fit-content / min-width content), not at the container's width; a float
// resolves a percentage width against its containing block, not the space left on the line; and a
// float inside a flex item or an inline-block grows that box to the bottom it really reaches.
describe("P0-6: intrinsic widths of column flex items and float percentages", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string, boxSizing = "content-box"): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:${boxSizing}}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const IMG_120_90 =
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2290%22%20viewBox%3D%220%200%20120%2090%22%3E%3Crect%20width%3D%22120%22%20height%3D%2290%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E";

  it("measures a fit-content column item at its content width (seed 87)", async () => {
    // The wrapper is 90 wide (a 90px child) inside an 80px column, so the ratio svg is 135 tall.
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;width:80px"><div style="width:fit-content"><div style="width:90px"></div><svg viewBox="0 0 40 60"></svg></div></div>`,
    );
    expect(at(b, "0.1.0").w).toBe(80); // column
    expect(at(b, "0.1.0.0").w).toBe(90); // fit-content item, wider than the column
    expect(at(b, "0.1.0.0").h).toBe(135);
    expect(at(b, "0.1.0.0.1").h).toBe(135); // svg at 90 wide
    expect(at(b, "0.1").h).toBe(135); // body
  });

  it("measures a min-width column item at its min-width (seed 142)", async () => {
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;width:40px"><div style="min-width:100px"><svg viewBox="0 0 100 60"></svg></div></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(100); // min-width over the 40px column
    expect(at(b, "0.1.0.0").h).toBe(60);
    expect(at(b, "0.1").h).toBe(60); // body
  });

  it("resolves fit-content width on a column container itself (seed 132)", async () => {
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;width:fit-content"><img src="${IMG_120_90}"></div>`,
      "border-box",
    );
    expect(at(b, "0.1.0").w).toBe(120); // not the 600px line
    expect(at(b, "0.1.0").h).toBe(90);
    expect(at(b, "0.1.0.0").w).toBe(120);
    expect(at(b, "0.1").h).toBe(90); // body
  });

  it("grows a flow root to a float that shrank from its trial width (seed 156)", async () => {
    // The float is 300 wide (the svg's default), the 30% svg inside is 90x18, so the page is 18 tall.
    const b = await boxes(`<div style="float:left"><svg viewBox="0 0 100 20" style="width:30%"></svg></div>`);
    expect(at(b, "0").h).toBe(18); // html
    expect(at(b, "0.1").h).toBe(0); // body (does not contain the float)
    expect(at(b, "0.1.0").w).toBe(300);
    expect(at(b, "0.1.0").h).toBe(18);
    expect(at(b, "0.1.0.0").w).toBe(90);
  });

  it("clamps a shrink-to-fit float to its min-content width inside a narrow box (seed 189)", async () => {
    // The 20px inline-block makes the float shrink-to-fit: min(max-content 260, max(min-content
    // 140, available 20)) = 140, so the grid is 136 and its svg 120; the ratio svg below is 140 wide.
    const b = await boxes(
      `<div style="display:inline-block;width:20px"><div style="float:left"><div style="display:grid;grid-template-columns:1fr fit-content(80px) max-content 1fr;padding:8px;margin:2px"><svg viewBox="0 0 40 20" style="width:120px"></svg></div><svg viewBox="0 0 40 60"></svg></div></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(140); // float
    expect(at(b, "0.1.0.0").h).toBe(290);
    expect(at(b, "0.1.0.0.0").w).toBe(136); // grid at the float's content width
    expect(at(b, "0.1.0.0.0.0").w).toBe(120);
    expect(at(b, "0.1.0.0.1").w).toBe(140); // ratio svg fills the float
    expect(at(b, "0.1.0.0.1").h).toBe(210);
    expect(at(b, "0.1").h).toBe(290); // body
  });

  it("clamps a fit-content flex item to the column width (seed 87)", async () => {
    // max-content is 300 (the svg's default width), but the item is a fit-content item in an 80px
    // column: min(300, max(0, 80)) = 80, and the 10% svg inside is 8 wide.
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;width:80px"><div style="width:fit-content"><svg viewBox="0 0 40 60" style="width:10%;"></svg></div></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(80);
    expect(at(b, "0.1.0.0").h).toBe(12);
    expect(at(b, "0.1.0.0.0").w).toBe(8);
    expect(at(b, "0.1.0.0.0").h).toBe(12);
    expect(at(b, "0.1").h).toBe(12); // body
  });

  it("keeps a fit-content block inside the available width (seed 87)", async () => {
    // The outer block is 60 wide (10% of 600); the fit-content wrapper is min(300, max(0, 60)) = 60,
    // so the 10% svg is 6x9 instead of 30x45.
    const b = await boxes(
      `<div style="width:10%"><div style="width:fit-content"><svg viewBox="0 0 40 60" style="width:10%;"></svg></div></div>`,
    );
    expect(at(b, "0.1.0").w).toBe(60);
    expect(at(b, "0.1.0.0").w).toBe(60);
    expect(at(b, "0.1.0.0.0").w).toBe(6);
    expect(at(b, "0.1.0.0.0").h).toBe(9);
    expect(at(b, "0.1").h).toBe(9); // body
  });

  it("counts padding when a min-width sizes a column item (seed 142)", async () => {
    // min-width:100px with 8px padding is a 116px border box; the svg gets the 100px content width.
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;width:40px"><div style="min-width:100px;padding:8px"><svg viewBox="0 0 100 60"></svg></div></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(116);
    expect(at(b, "0.1.0.0").h).toBe(76);
    expect(at(b, "0.1.0.0.0").w).toBe(100);
    expect(at(b, "0.1").h).toBe(76); // body
  });

  it("moves a flow root below a float it does not fit beside (seed 189)", async () => {
    // 20px block, 16px float: the 5px flex container has only 4px left, so it starts at y=16.
    const b = await boxes(
      `<div style="width:20px"><div style="float:left;padding:8px"></div><div style="display:flex;width:25%"></div></div>`,
    );
    expect(at(b, "0.1.0").h).toBe(16); // the in-flow flow root reaches y=16
    expect(at(b, "0.1.0.1").w).toBe(5);
    expect(at(b, "0.1.0.1").y).toBe(16);
    expect(at(b, "0.1").h).toBe(16); // body
  });
});

// P0-7: fuzz seeds 94/156/189. A measure pass has to know that a float which does not fit beside
// the earlier ones sits below them (the box containing it reaches that stacked bottom); an auto
// inline size on a non-stretched column item is fit-content, so a percentage width inside it is
// cyclic during the item's own sizing; and a replaced item whose definite cross size is 0 still
// transfers it to its main size (a 300x90 image in a 0-wide column is 0 tall, not 90).
describe("P0-7: stacked floats in a measure pass and zero-width flex cross sizes", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string, boxSizing = "content-box"): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:${boxSizing}}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const IMG_120_90 =
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2290%22%20viewBox%3D%220%200%20120%2090%22%3E%3Crect%20width%3D%22120%22%20height%3D%2290%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E";

  it("grows a flow root in a measure pass to a float that had to stack below another (seed 94)", async () => {
    // The 16px-wide flow root leaves no room beside the 16px float, so the 50% (8px) float goes
    // below it: the flow root is 76 tall, not just the 60 of the second float.
    const b = await boxes(
      `<div style="display:flex"><div><div style="float:right;padding:8px"></div><div style="float:left;width:50%;height:60px"></div></div></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(16); // flex item, as wide as its first float
    expect(at(b, "0.1.0.0").h).toBe(76);
    expect(at(b, "0.1.0.0.1").y).toBe(16); // stacked below the right float
    expect(at(b, "0.1.0.0.1").w).toBe(8);
    expect(at(b, "0.1.0.0.1").h).toBe(60);
    expect(at(b, "0.1").h).toBe(76); // body
  });

  it("sizes a non-stretched column item's percentage svg against its fit-content width (seed 156)", async () => {
    // The wrapper's max-content is 300 (the svg's default object width), clamped to the 80px column:
    // the svg is 30% of 80 = 24 wide, so the item is 4.8 tall instead of 60 (the 300px trial width).
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;align-items:center;width:80px"><div><svg viewBox="0 0 100 20" style="width:30%"></svg></div></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(80);
    expect(at(b, "0.1.0.0").h).toBeCloseTo(4.8, 2);
    expect(at(b, "0.1.0.0.0").w).toBeCloseTo(24, 2);
    expect(at(b, "0.1.0.0.0").h).toBeCloseTo(4.8, 2);
    expect(at(b, "0.1").h).toBeCloseTo(4.8, 2); // body
  });

  it("transfers a zero cross size to the main size of a replaced item (seed 189)", async () => {
    // 25% of 20px is 5, and 4px padding on each side (border-box) leaves no content: the 25% image
    // is 0 wide, so its ratio makes it 0 tall instead of keeping its 90px natural height.
    const b = await boxes(
      `<div style="width:20px"><div style="display:flex;flex-direction:column;width:25%;padding:4px"><img src="${IMG_120_90}" style="width:25%"></div></div>`,
      "border-box",
    );
    expect(at(b, "0.1.0.0").w).toBe(8); // border box: 8 padding, no content
    expect(at(b, "0.1.0.0").h).toBe(8);
    expect(at(b, "0.1.0.0.0").w).toBe(0);
    expect(at(b, "0.1.0.0.0").h).toBe(0);
    expect(at(b, "0.1").h).toBe(8); // body
  });
});

// P0-8: fuzz seed 60. A wrapping column has no line cross size to transfer from while its items are
// sized: the lines are broken in the inline axis after that, so a stretched image keeps its intrinsic
// block size and is only widened by the stretch (600x30, not the 600x150 its ratio would give). The
// single-line column, whose cross size is the container's width from the start, still transfers.
describe("P0-8: stretched replaced item in a wrapping column", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const IMG_120_30 =
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2230%22%20viewBox%3D%220%200%20120%2030%22%3E%3Crect%20width%3D%22120%22%20height%3D%2230%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E";

  it("does not transfer a wrapping column's line cross size to an image's main size (seed 60)", async () => {
    const b = await boxes(`<div style="display:flex;flex-direction:column;flex-wrap:wrap"><img src="${IMG_120_30}"></div>`);
    expect(at(b, "0.1.0.0").w).toBe(600); // stretched to the container's width
    expect(at(b, "0.1.0.0").h).toBe(30); // its intrinsic height, not 600 / 4
    expect(at(b, "0.1.0").h).toBe(30);
    expect(at(b, "0.1").h).toBe(30); // body
  });

  it("keeps the transfer in a single-line column", async () => {
    const b = await boxes(`<div style="display:flex;flex-direction:column"><img src="${IMG_120_30}"></div>`);
    expect(at(b, "0.1.0.0").w).toBe(600);
    expect(at(b, "0.1.0.0").h).toBe(150); // 600 / 4: the cross size is definite up front
    expect(at(b, "0.1").h).toBe(150); // body
  });
});

// A zero/percentage flex-basis only becomes "content" while the container is sized from its content;
// the item's own definite width still contributes to that size (Blink: 90, not 0), and an inline-flex
// box takes its baseline from the first item's first line, so a later overflowing line does not grow
// the line box around it (seed 185).
describe("intrinsic size of an inline-flex with a zero flex-basis (seed 185)", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;

  it("contributes the item's specified width, not the zero basis", async () => {
    const b = await boxes('<div style="display:inline-flex"><div style="width:90px;flex:1 1 0%"></div></div>');
    expect(at(b, "0.1.0").w).toBe(90); // the shrink-to-fit container
    expect(at(b, "0.1.0.0").w).toBe(90); // the item
  });

  it("contributes padding on top of a content-box width", async () => {
    const b = await boxes('<div style="display:inline-flex"><div style="box-sizing:content-box;width:90px;padding:5px;flex:1 1 0%"></div></div>');
    expect(at(b, "0.1.0").w).toBe(100);
  });

  it("is no wider than the item's definite width when its content overflows", async () => {
    const b = await boxes('<div style="display:inline-flex"><div style="width:90px;flex:1 1 0%"><div style="width:200px;height:10px"></div></div></div>');
    expect(at(b, "0.1.0").w).toBe(90);
  });

  it("takes the first item's first baseline for the line box it sits in", async () => {
    const b = await boxes('<div style="display:inline-flex"><div style="height:20px"><div style="display:flex;width:80px"><div></div></div><svg viewBox="0 0 40 20"></svg></div></div>');
    expect(at(b, "0.1.0").h).toBe(20);
    expect(at(b, "0.1").h).toBe(20); // body: the overflowing line below does not add height
  });
});

// P0-9: fuzz replaced seed 43. A replaced item with an aspect ratio does not stretch in both
// axes: the block axis resolves against the grid area (a stretched row, or a definite height)
// and the inline size transfers through the ratio instead of taking the track width. The
// reverse does not hold (a stretched height wins over a definite width), and a ratio-only
// box under an explicit justify stretch fills its track instead of transferring.
describe("P0-9: grid item aspect-ratio transfer under stretch", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const SVG = `<svg viewBox="0 0 40 20"></svg>`;

  it("transfers the stretched row height to the width of a viewBox-only svg (seed 43)", async () => {
    const b = await boxes(
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);width:25%"><div style="display:grid;grid-template-columns:repeat(3,1fr);align-items:stretch;height:20px">${SVG}</div></div>`,
    );
    expect(at(b, "0.1.0.0.0").w).toBe(40); // 20 x (40 / 20), not the 16.67px track
    expect(at(b, "0.1.0.0.0").h).toBe(20);
  });

  it("transfers in a wide cell too: the block axis wins over the inline stretch", async () => {
    const b = await boxes(
      `<div style="display:grid;grid-template-columns:100px;height:20px;width:150px;align-items:stretch">${SVG}</div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(40); // not the 100px track
    expect(at(b, "0.1.0.0").h).toBe(20);
  });

  it("lets the transferred width overflow a narrow track", async () => {
    const b = await boxes(
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);height:100px;width:150px;align-items:stretch">${SVG}</div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(200); // 100 x (40 / 20), past the 50px track
    expect(at(b, "0.1.0.0").h).toBe(100);
  });

  it("transfers from a definite height even when the inline axis stretches", async () => {
    const b = await boxes(
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);align-items:stretch;height:20px;width:150px"><svg viewBox="0 0 40 20" style="height:20px"></svg></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(40); // not the 50px track
    expect(at(b, "0.1.0.0").h).toBe(20);
  });

  it("fills the track for a ratio-only svg under an explicit justify stretch", async () => {
    const b = await boxes(
      `<div style="display:grid;grid-template-columns:100px;height:20px;width:150px;align-items:stretch;justify-items:stretch">${SVG}</div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(100); // no intrinsic inline size to transfer to: it fills
    expect(at(b, "0.1.0.0").h).toBe(20);
  });

  it("keeps a stretched height over a transfer from a definite width", async () => {
    const b = await boxes(
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);height:100px;width:150px;align-items:stretch"><svg viewBox="0 0 40 20" style="width:40px"></svg></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(40);
    expect(at(b, "0.1.0.0").h).toBe(100); // the stretch, not 40 / (40 / 20)
  });

  it("keeps the unstretched size when neither axis stretches", async () => {
    const b = await boxes(
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);height:20px;width:150px;align-items:start">${SVG}</div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(50); // the track width, height from the ratio
    expect(at(b, "0.1.0.0").h).toBe(25);
  });
});

// P0-10: real page tailwindcss.com. Sponsor logos are viewBox-only svgs with width:100%
// inside single-column grids with place-content:center. The auto track must stay at the
// item's contribution and be centered by the free space, not stretched to the container:
// justify-content's initial value is normal (only normal/stretch grow auto tracks), and a
// ratio-only replaced item with a percentage width contributes the default object width
// (300) to the track, its height transferred through the ratio.
describe("P0-10: content-sized grid tracks under justify/align-content", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string, width = 600): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}svg{display:block}</style></head><body>${body}</body></html>`,
      width,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const LOGO = `<svg viewBox="0 0 320 96" style="width:100%;max-width:320px"></svg>`;
  const CENTER = (inner: string) =>
    `<div style="width:456px"><a style="display:grid;place-content:center;padding:16px 8px">${inner}</a></div>`;

  it("sizes the track by the default object width and centers it (tailwind logo)", async () => {
    const b = await boxes(CENTER(LOGO));
    const svg = at(b, "0.1.0.0.0");
    expect(svg.w).toBe(300); // default object width, not the 320 max-width or the 440 track
    expect(svg.h).toBe(90); // 300 x (96 / 320)
    expect(svg.x).toBe(78); // 8 padding + (440 - 300) / 2
    expect(at(b, "0.1.0.0").h).toBe(122);
  });

  it("centers an intrinsically sized replaced item by its contribution", async () => {
    const b = await boxes(CENTER(`<svg viewBox="0 0 320 96" width="320" height="96" style="width:100%;max-width:320px"></svg>`));
    const svg = at(b, "0.1.0.0.0");
    expect(svg.w).toBe(320);
    expect(svg.x).toBe(68); // 8 + (440 - 320) / 2
  });

  it("resolves a percentage width against the contribution-sized track", async () => {
    const b = await boxes(CENTER(`<svg viewBox="0 0 320 96" width="320" height="96" style="width:50%"></svg>`));
    const svg = at(b, "0.1.0.0.0");
    expect(svg.w).toBe(160); // 50% of the 320 track, not of the 440 container
    expect(svg.x).toBe(68);
  });

  it("centers the capped track of a max-width item", async () => {
    const b = await boxes(CENTER(`<svg viewBox="0 0 320 96" style="width:100%;max-width:200px"></svg>`));
    const svg = at(b, "0.1.0.0.0");
    expect(svg.w).toBe(200);
    expect(svg.h).toBe(60);
    expect(svg.x).toBe(128); // 8 + (440 - 200) / 2
  });

  it("still stretches the auto track of a plain grid (justify-content normal)", async () => {
    const b = await boxes(`<div style="display:grid;width:456px"><div style="height:10px"></div></div>`);
    expect(at(b, "0.1.0.0").w).toBe(456);
  });

  it("does not stretch auto tracks under an explicit justify-content: flex-start", async () => {
    const b = await boxes(
      `<div style="display:grid;justify-content:flex-start;width:456px"><div style="width:200px;height:10px"></div></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(200);
  });

  it("centers content-sized rows under align-content: center", async () => {
    const b = await boxes(
      `<div style="display:grid;align-content:center;width:200px;height:200px"><div style="height:50px"></div></div>`,
    );
    const item = at(b, "0.1.0.0");
    expect(item.h).toBe(50);
    expect(item.y).toBe(75); // (200 - 50) / 2, the row is not stretched to 200
  });
});

// P0-11: real page en.wikipedia.org. Text in generic families (the Vector skin's body
// font is plain `sans-serif`) rendered with the substitute font's own vertical
// metrics (Noto Sans JP: 1.448em), so every line-height: normal line was ~4-6px
// taller than in Chromium and the offsets accumulated down the whole page.
// Generic families now take the metric profile of their canonical concrete family
// (Arial for sans-serif, Times New Roman for serif, Courier New for monospace).
describe("P0-11: generic font families take canonical metric profiles", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;

  it("sizes a sans-serif line by the Arial profile, not the substitute's metrics", async () => {
    const b = await boxes(`<div style="font-family:sans-serif;font-size:16px">Text</div>`);
    expect(at(b, "0.1.0").h).toBe(18); // 16 x 1.15, not 16 x 1.448 = 24
  });

  it("sizes a serif line by the Times New Roman profile", async () => {
    const b = await boxes(`<div style="font-family:serif;font-size:16px">Text</div>`);
    expect(at(b, "0.1.0").h).toBe(18);
  });

  it("sizes a ui-sans-serif line like sans-serif", async () => {
    const b = await boxes(`<div style="font-family:ui-sans-serif;font-size:16px">Text</div>`);
    expect(at(b, "0.1.0").h).toBe(18);
  });

  it("does not accumulate extra height over stacked generic-font lines", async () => {
    const line = `<div style="font-family:sans-serif;font-size:14px">Line</div>`;
    const b = await boxes(line.repeat(5));
    expect(at(b, "0.1").h).toBe(80); // 5 x 16 (14 x 1.15 = 16.1 -> 16), not 5 x 20
  });

  it("keeps an explicit line-height authoritative over the profile", async () => {
    const b = await boxes(`<div style="font-family:sans-serif;font-size:16px;line-height:2">Text</div>`);
    expect(at(b, "0.1.0").h).toBe(32);
  });

  it("leaves a loaded named font's own metrics alone", async () => {
    const b = await boxes(`<div style="font-family:Arial;font-size:16px">Text</div>`);
    expect(at(b, "0.1.0").h).toBe(18);
  });
});

// P0-12: real page news.ycombinator.com (a table-heavy page) scored 96% boxes-off
// while rendering almost correctly: litehtml's table layout positions the cells
// and never writes a row's own size back, so every tr/tbody reported a 0x0 box
// in the layout dump. Row boxes are now rebuilt as the union of their cells'
// border boxes (and row groups as the union of their rows), matching what a
// browser reports for the same elements.
describe("P0-12: table row and row-group boxes are the union of their cells/rows", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const byTag = (b: Box[], t: string) => b.filter((x) => x.t === t);

  it("reports a row as wide and tall as its cells", async () => {
    const b = await boxes(
      `<table cellspacing="0" cellpadding="0"><tbody><tr><td style="width:80px;height:20px"></td><td style="width:40px;height:20px"></td></tr></tbody></table>`,
    );
    const tr = byTag(b, "tr")[0];
    expect(tr.w).toBe(120);
    expect(tr.h).toBe(20);
    expect(tr.x).toBe(0);
    expect(tr.y).toBe(0);
  });

  it("reports a row group spanning all its rows", async () => {
    const b = await boxes(
      `<table cellspacing="0" cellpadding="0"><tbody><tr><td style="width:80px;height:20px"></td></tr><tr><td style="width:80px;height:30px"></td></tr></tbody></table>`,
    );
    const tbody = byTag(b, "tbody")[0];
    expect(tbody.w).toBe(80);
    expect(tbody.h).toBe(50);
    const rows = byTag(b, "tr");
    expect(rows[1].y).toBe(20);
    expect(rows[1].h).toBe(30);
  });

  it("spans a short row over the table's full column band", async () => {
    // a spacer row holds a single cell in the first column, but a browser still
    // reports the row across every column of the table
    const b = await boxes(
      `<table cellspacing="0" cellpadding="0"><tbody><tr><td style="width:30px;height:10px"></td><td style="width:50px;height:10px"></td></tr><tr><td style="height:5px"></td></tr></tbody></table>`,
    );
    const rows = byTag(b, "tr");
    expect(rows[1].w).toBe(80);
    expect(rows[1].h).toBe(5);
    expect(rows[1].x).toBe(0);
  });

  it("unions a header group separately from the body group", async () => {
    const b = await boxes(
      `<table cellspacing="0" cellpadding="0"><thead><tr><td style="width:60px;height:10px"></td></tr></thead><tbody><tr><td style="width:60px;height:22px"></td></tr></tbody></table>`,
    );
    expect(byTag(b, "thead")[0].h).toBe(10);
    expect(byTag(b, "tbody")[0].h).toBe(22);
    expect(byTag(b, "tbody")[0].y).toBe(10);
  });
});

// P0-13: real page www.rust-lang.org scored 74% boxes-off: every card in its
// two-column rows was laid out at min-content width (~110px instead of 488px),
// wrapping its text into a tall narrow column. A shrink-to-fit box (flex item,
// float, inline-block) with max-width was measured by laying its content out AT
// the max-width and reporting the widest wrapped line as the intrinsic size --
// and a percentage max-width was then re-resolved against that already-clamped
// width on the exact-size re-measure, halving it again (488 -> 244 -> 122).
// Intrinsic queries now measure the content without the box's own max-width cap,
// and an exact-inline-size context no longer re-derives percentage min/max
// widths from the box's own assigned size. Expected sizes are Chromium's.
describe("P0-13: shrink-to-fit boxes honor max-width once, against the containing block", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };
  const T = "We love documentation! Take a look at the books available online, as well as key blog posts and user guides.";

  async function boxes(body: string, width = 1200): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${body}</body></html>`,
      width,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const in976 = (inner: string) => `<div style="width:976px">${inner}</div>`;

  it("flex item with max-width:50% takes half the container, not min-content", async () => {
    const b = await boxes(in976(`<div style="display:flex"><div style="max-width:50%"><p style="margin:0">${T}</p></div></div>`));
    const item = at(b, "0.1.0.0.0");
    expect(item.w).toBe(488);
    expect(item.h).toBe(36); // two lines at the clamped width
  });

  it("flex item with max-width in px clamps its max-content at the px value", async () => {
    const b = await boxes(in976(`<div style="display:flex"><div style="max-width:488px"><p style="margin:0">${T}</p></div></div>`));
    expect(at(b, "0.1.0.0.0").w).toBe(488);
  });

  it("a row-flex card with max-width:50% in a row flex", async () => {
    const b = await boxes(in976(
      `<div style="display:flex"><div style="max-width:50%;display:flex"><p style="margin:0">${T}</p></div></div>`));
    const card = at(b, "0.1.0.0.0");
    expect(card.w).toBe(488);
    expect(card.h).toBe(36);
  });

  it("float with max-width:50%", async () => {
    const b = await boxes(in976(`<div style="float:left;max-width:50%"><p style="margin:0">${T}</p></div>`));
    expect(at(b, "0.1.0.0").w).toBe(488);
  });

  it("inline-block with max-width:50%, and with max-width:25%", async () => {
    const b50 = await boxes(in976(`<div><span style="display:inline-block;max-width:50%"><p style="margin:0">${T}</p></span></div>`));
    expect(at(b50, "0.1.0.0.0").w).toBe(488);
    const b25 = await boxes(in976(`<div><span style="display:inline-block;max-width:25%"><p style="margin:0">${T}</p></span></div>`));
    expect(at(b25, "0.1.0.0.0").w).toBe(244);
  });

  it("a percentage max-width resolves against the container (500px container)", async () => {
    const b = await boxes(`<div style="width:500px"><div style="display:flex"><div style="max-width:50%"><p style="margin:0">${T}</p></div></div></div>`);
    expect(at(b, "0.1.0.0.0").w).toBe(250);
  });

  it("a plain block with max-width:50% still fills then clamps (no regression)", async () => {
    const b = await boxes(in976(`<div style="max-width:50%"><p style="margin:0">${T}</p></div>`));
    const block = at(b, "0.1.0.0");
    expect(block.w).toBe(488);
    expect(block.h).toBe(36);
  });
});

// P0-14: real page developer.mozilla.org. MDN declares `scrollbar-gutter: stable`
// on the root; browsers reserve a 15px gutter for the scrollbar and lay the page
// out at viewport-minus-15, which the engine ignored, so the root box was 15px
// wider than the browser's and every centered column sat half a gutter (7.5px)
// to the right. The property is now parsed, and document layout reserves the
// classic scrollbar width at the inline-end edge (both edges for
// `stable both-edges`).
describe("P0-14: scrollbar-gutter: stable reserves the gutter on the root", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(style: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html style="${style}"><head></head><body style="margin:0"><div style="width:600px;margin:0 auto;height:50px"></div></body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }

  it("stable narrows the root by the scrollbar width and centers within it", async () => {
    const b = await boxes("scrollbar-gutter:stable");
    const html = b.find((x) => x.t === "html")!;
    expect(html.w).toBe(985);
    const div = b.find((x) => x.t === "div")!;
    expect(div.x).toBe(192.5); // (985 - 600) / 2
  });

  it("stable both-edges reserves both edges", async () => {
    const b = await boxes("scrollbar-gutter:stable both-edges");
    expect(b.find((x) => x.t === "html")!.w).toBe(970);
  });

  it("auto and unset keep the full width", async () => {
    for (const style of ["scrollbar-gutter:auto", ""]) {
      const b = await boxes(style);
      expect(b.find((x) => x.t === "html")!.w).toBe(1000);
    }
  });

  it("the gutter declared in a stylesheet (not inline) applies too", async () => {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html{scrollbar-gutter:stable}</style></head><body style="margin:0"><div style="height:50px"></div></body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    expect(out.find((x) => x.t === "html")!.w).toBe(985);
  });
});

// P0-15: real page developer.mozilla.org. MDN's global stylesheet puts
// `overflow-wrap: break-word` on the body, so every word on the page is split
// into per-character boxes for layout. A min-content measure lays the text
// out at 1px and takes the widest line; the splitter let the line break
// between any two characters there, so min-content collapsed to the widest
// single glyph (the hero <p>: 22px instead of its longest word ~145px) and
// intrinsic sizing everywhere downstream (here: the hero grid's auto tracks,
// distributed from their min-content bases) came out wrong. Soft wrap
// opportunities that break-word / break-word introduce inside a word do not
// count for min-content (CSS Text) -- only break-all and overflow-wrap:
// anywhere create those -- so during a min-content measure the characters of
// such a word now stay on the word's line.
describe("P0-15: break-word words stay whole in a min-content measure", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function divBox(style: string, text = "Documenting JavaScript resources"): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head></head><body style="margin:0"><div style="font-size:20px;font-family:Arial,sans-serif;${style}">${text}</div></body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.t === "div")!;
  }

  it("min-content of break-word text is the longest word, as without break-word", async () => {
    const plain = await divBox("width:min-content");
    const breakWord = await divBox("width:min-content;overflow-wrap:break-word");
    const wordBreak = await divBox("width:min-content;word-break:break-word");
    expect(breakWord.w).toBe(plain.w);
    expect(wordBreak.w).toBe(plain.w);
  });

  it("break-all and overflow-wrap: anywhere still shrink min-content to a glyph", async () => {
    const plain = await divBox("width:min-content");
    const breakAll = await divBox("width:min-content;word-break:break-all");
    const anywhere = await divBox("width:min-content;overflow-wrap:anywhere");
    expect(breakAll.w).toBeLessThan(plain.w / 3);
    expect(anywhere.w).toBeLessThan(plain.w / 3);
  });

  it("real layout still breaks a break-word word that exceeds the line", async () => {
    const oneLine = await divBox("width:900px;overflow-wrap:break-word");
    const narrow = await divBox("width:60px;overflow-wrap:break-word");
    expect(narrow.h).toBeGreaterThan(oneLine.h);
  });

  it("auto grid tracks distribute from the word-based minimum under break-word", async () => {
    // The grid's auto tracks are sized by growing equally from their
    // min-content bases (maximize tracks). With break-word the text track's
    // base must be its longest word -- with a glyph-sized base the text track
    // would start ~110px lower and the equal growth would land elsewhere --
    // so the distribution must be identical to the same grid without
    // break-word, and fill the container.
    async function tracks(extra: string): Promise<Box[]> {
      let out: Box[] = [];
      await render({
        value: `<!doctype html><html><head></head><body style="margin:0"><div style="display:grid;grid-template-columns:auto auto;width:400px;${extra}"><div style="font-size:20px;font-family:Arial,sans-serif">Documenting JavaScript resources for developers everywhere</div><div><span style="display:inline-block;width:150px;height:10px"></span> <span style="display:inline-block;width:100px;height:10px"></span></div></div></body></html>`,
        width: 1000,
        format: "png",
        onLayout: (b) => {
          out = b as Box[];
        },
      });
      return out.filter((x) => x.t === "div" && x.p.split(".").length === 4);
    }
    const plain = await tracks("");
    const breakWord = await tracks("overflow-wrap:break-word");
    expect(plain.length).toBe(2);
    expect(breakWord.length).toBe(2);
    expect(breakWord[0].w).toBe(plain[0].w);
    expect(breakWord[1].w).toBe(plain[1].w);
    expect(plain[0].w + plain[1].w).toBe(400);
  });
});

// P0-16: real page developer.mozilla.org. The hero mandala svg is
// height:35rem with margin-top:-8.75rem (-140px) inside a plain div inside
// the (clipped) grid item. A first child's top margin collapses through a
// parent with no border/padding of its own: the div should be shifted up
// by 140 and stay 560 tall. The block context's collapse only propagated
// POSITIVE margins, so the negative margin stayed inside the div: it sat
// 140 lower and measured 420 (the child's margin box). The collapse now
// combines the parent's own margin and the child's with the CSS 2.1 rule
// (largest positive plus most negative) on both edges, combining against
// a snapshot of the box's CSS margins -- _render_content runs several
// times per layout, and re-combining an already-collapsed margin is not
// idempotent for mixed signs.
describe("P0-16: negative margins collapse through the parent's edges", () => {
  type Box = { p: string; t: string; c?: string; x: number; y: number; w: number; h: number };

  async function boxes(bodyHtml: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head></head><body style="margin:0">${bodyHtml}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const byClass = (bs: Box[], cls: string) => bs.find((x) => (x.c || "").includes(cls))!;

  function wrapCase(wrapStyle: string, childStyle: string): Promise<Box[]> {
    return boxes(
      `<div style="height:200px"></div><div><div class="wrap" style="${wrapStyle}"><div class="child" style="height:560px;${childStyle}"></div></div></div>`,
    );
  }

  it("a negative first-child top margin shifts the parent up, height stays the border box", async () => {
    const b = await wrapCase("", "margin-top:-140px");
    const wrap = byClass(b, "wrap");
    const child = byClass(b, "child");
    expect(wrap.y).toBe(60); // 200 - 140
    expect(wrap.h).toBe(560);
    expect(child.y).toBe(60);
  });

  it("a positive first-child top margin still collapses as before", async () => {
    const b = await wrapCase("", "margin-top:50px");
    expect(byClass(b, "wrap").y).toBe(250);
    expect(byClass(b, "wrap").h).toBe(560);
    expect(byClass(b, "child").y).toBe(250);
  });

  it("mixed signs combine as largest positive plus most negative", async () => {
    const b = await wrapCase("margin-top:30px", "margin-top:-140px");
    expect(byClass(b, "wrap").y).toBe(90); // 200 + (30 - 140)
    expect(byClass(b, "child").y).toBe(90);
    const b2 = await wrapCase("margin-top:-20px", "margin-top:50px");
    expect(byClass(b2, "wrap").y).toBe(230); // 200 + (50 - 20)
    expect(byClass(b2, "child").y).toBe(230);
  });

  it("padding on the parent blocks the collapse: the margin stays inside", async () => {
    const b = await wrapCase("padding-top:1px", "margin-top:-140px");
    const wrap = byClass(b, "wrap");
    expect(wrap.y).toBe(200);
    expect(wrap.h).toBe(421); // 1px padding + the 420 margin box
    expect(byClass(b, "child").y).toBe(61); // 200 + 1 - 140
  });

  it("a negative last-child bottom margin collapses out to the next sibling", async () => {
    const b = await boxes(
      `<div class="wrap"><div style="height:100px;margin-bottom:-60px"></div></div><div class="sib" style="height:10px"></div>`,
    );
    expect(byClass(b, "wrap").h).toBe(100);
    expect(byClass(b, "sib").y).toBe(40);
    const b2 = await boxes(
      `<div class="wrap"><div style="height:100px;margin-bottom:50px"></div></div><div class="sib" style="height:10px"></div>`,
    );
    expect(byClass(b2, "sib").y).toBe(150);
  });

  it("inside a clipped grid item (the MDN shape) the inner div still shifts and keeps its height", async () => {
    const b = await boxes(
      `<div style="height:200px"></div><div style="display:grid;grid-template-columns:300px"><div class="item" style="overflow:hidden;max-height:320px"><div class="wrap"><div class="child" style="height:560px;margin-top:-140px"></div></div></div></div>`,
    );
    const item = byClass(b, "item");
    const wrap = byClass(b, "wrap");
    expect(wrap.y).toBe(item.y - 140);
    expect(wrap.h).toBe(560);
    expect(byClass(b, "child").y).toBe(wrap.y);
  });
});

// P0-17: real page developer.mozilla.org. The layout grid names its lines
// [extended-full-start] ... [extended-full-end] around five tracks, and the
// (empty) ad-slot element is placed with `grid-column: extended-full`. A
// lone <custom-ident> in the grid-column/grid-row shorthand sets the end
// line to the same ident, which resolves to the <ident>-end line -- the
// shorthand handler only set the start, leaving the end auto (span 1), so
// the element collapsed into the first 16px track and, sharing its row
// with the body column, stretched to the row's full height (16 x 1241
// instead of 985 x 0). One-track names like `content` were unaffected,
// which is why the body column landed correctly.
describe("P0-17: a lone custom-ident in grid-column/grid-row spans to the <ident>-end line", () => {
  type Box = { p: string; t: string; c?: string; x: number; y: number; w: number; h: number };
  const TPL =
    "[ext-start] 16px [full-start] 1fr [content-start] 300px [content-end] 1fr [full-end] 16px [ext-end]";

  async function boxes(bodyHtml: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head></head><body style="margin:0">${bodyHtml}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const byClass = (bs: Box[], cls: string) => bs.find((x) => (x.c || "").includes(cls))!;

  it("grid-column: ext spans all five tracks; the next item wraps to a new row", async () => {
    const b = await boxes(
      `<div style="display:grid;width:632px;grid-template-columns:${TPL}"><div class="a" style="grid-column:ext;height:10px"></div><div class="bb" style="grid-column:content;height:20px"></div></div>`,
    );
    const a = byClass(b, "a");
    const bb = byClass(b, "bb");
    expect(a.x).toBe(0);
    expect(a.w).toBe(632);
    expect(bb.x).toBe(166);
    expect(bb.w).toBe(300);
    expect(bb.y).toBe(a.y + 10);
  });

  it("grid-row: <ident> spans multiple rows the same way", async () => {
    const b = await boxes(
      `<div style="display:grid;width:200px;grid-template-columns:100px 100px;grid-template-rows:[tall-start] 30px 40px [tall-end] 50px"><div class="a" style="grid-row:tall;grid-column:1"></div><div class="bb" style="grid-column:2;height:5px"></div></div>`,
    );
    const a = byClass(b, "a");
    expect(a.h).toBe(70); // 30 + 40
    expect(a.y).toBe(0);
  });

  it("a one-track name, a lone number and a lone span keep their old meaning", async () => {
    const b = await boxes(
      `<div style="display:grid;width:632px;grid-template-columns:${TPL}"><div class="a" style="grid-column:content;height:10px"></div><div class="bb" style="grid-column:2;height:10px"></div><div class="cc" style="grid-column:1 / span 2;height:10px"></div></div>`,
    );
    expect(byClass(b, "a").w).toBe(300);
    expect(byClass(b, "bb").w).toBe(150); // track 2 is the 1fr before content
    expect(byClass(b, "cc").w).toBe(166); // 16 + 150
  });
});

// P0-18: grid auto-placement ignored definite lines on the locked axis.
// Placement ran as a single document-order pass over one shared cursor, so
// an item with `grid-row: 3` and an auto column was scanned from whatever
// row the previous item had reached (and a column-flow item locked to a
// fresh column kept scanning from the cursor's row). Placement now runs
// in the spec's phases -- both-axes definite, then the locked-axis items
// scanning only their own row/column, then the auto-row items with a fresh
// cursor. Found next to MDN's grid (cycle 9's tests): a span-2 item with
// `grid-row: 3` landed on row 2, tracks 3-4 instead of row 3, tracks 1-2.
describe("P0-18: locked-axis grid items scan only their own row/column", () => {
  type Box = { p: string; t: string; c?: string; x: number; y: number; w: number; h: number };

  async function boxes(bodyHtml: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head></head><body style="margin:0">${bodyHtml}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const byClass = (bs: Box[], cls: string) => bs.find((x) => (x.c || "").includes(cls))!;

  it("a span item with a definite row lands in that row, from its first track", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;grid-template-columns:100px 100px 100px 100px;grid-template-rows:10px 10px 10px 10px"><div class="a" style="grid-column:3"></div><div class="bb" style="grid-column:2"></div><div class="cc" style="grid-row:3;grid-column:span 2"></div></div>`,
    );
    const cc = byClass(b, "cc");
    expect(cc.x).toBe(0);
    expect(cc.y).toBe(20);
    expect(cc.w).toBe(200);
  });

  it("locked-row items skip occupied cells and continue after each other in the row", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;grid-template-columns:100px 100px 100px 100px;grid-template-rows:10px 10px 10px 10px"><div class="x" style="grid-column:1;grid-row:2"></div><div class="a" style="grid-row:2;grid-column:span 2"></div><div class="bb" style="grid-row:2"></div></div>`,
    );
    const a = byClass(b, "a");
    const bb = byClass(b, "bb");
    expect([a.x, a.y, a.w]).toEqual([100, 10, 200]);
    expect([bb.x, bb.y]).toEqual([300, 10]);
  });

  it("a fully-auto item after a definite-row item starts from the first cell", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;grid-template-columns:100px 100px 100px 100px;grid-template-rows:10px 10px 10px 10px"><div class="a" style="grid-row:2"></div><div class="bb"></div></div>`,
    );
    expect([byClass(b, "a").x, byClass(b, "a").y]).toEqual([0, 10]);
    expect([byClass(b, "bb").x, byClass(b, "bb").y]).toEqual([0, 0]);
  });

  it("column flow: an item locked to a fresh column scans it from the top", async () => {
    const b = await boxes(
      `<div style="display:grid;height:120px;grid-template-rows:30px 30px 30px 30px;grid-auto-flow:column;grid-auto-columns:100px"><div class="a" style="grid-row:3"></div><div class="bb" style="grid-row:2"></div><div class="cc" style="grid-column:3;grid-row:span 2"></div><div class="dd" style="grid-column:2"></div></div>`,
    );
    const cc = byClass(b, "cc");
    const dd = byClass(b, "dd");
    expect([cc.x, cc.y, cc.h]).toEqual([200, 0, 60]);
    expect([dd.x, dd.y]).toEqual([100, 0]);
  });
});

// P0-19: real page developer.mozilla.org. The homepage search button (a
// display:flex <button> with margin: 0 auto inside the flattened shadow
// tree) filled its whole 532px column: a <button> was laid out like a
// plain block, but a form control with width:auto shrink-wraps its
// content (fit-content) in a browser, and its auto margins then centre
// it. The block child path now routes an auto-width <button> through
// the same content-sizing path as width:fit-content, and auto margins
// are solved against the width on offer before the shrink, not the
// shrunk width (which also centres fit-content blocks with margin:auto).
describe("P0-19: a block-level <button> with width:auto shrink-wraps and centres", () => {
  type Box = { p: string; t: string; c?: string; x: number; y: number; w: number; h: number };

  async function boxes(bodyHtml: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head></head><body style="margin:0">${bodyHtml}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const btn = (bs: Box[]) => bs.find((x) => x.t === "button")!;
  const BTN = "margin:0 auto;padding:.8em 1em;border:2px solid #000;font-size:20px";

  it("display:block and display:flex buttons size like the inline-block button", async () => {
    const ref = btn(await boxes(`<div style="width:532px"><button style="display:inline-block;${BTN}">Search</button></div>`));
    for (const disp of ["block", "flex"]) {
      const b = btn(await boxes(`<div style="width:532px"><button style="display:${disp};${BTN}">Search</button></div>`));
      expect(b.w).toBeCloseTo(ref.w, 0);
      expect(b.w).toBeLessThan(200);
      expect(Math.abs(b.x - (532 - b.w) / 2)).toBeLessThan(1.5); // margin:auto centres it
    }
  });

  it("a long label grows to near the available width and wraps instead of shrink-wrapping", async () => {
    const b = btn(await boxes(
      `<div style="width:532px"><button style="display:block;${BTN}">Search the whole site for documentation about web platform APIs and guides</button></div>`,
    ));
    // (The shared fit-content path measures max-content as the widest line
    // of a wrap at the offered width, so an overflowing label lands a few
    // px short of the full 532 a browser reports; the point here is that
    // the button grows to the cap and wraps, not that it shrink-wraps.)
    expect(b.w).toBeGreaterThan(500);
    expect(b.w).toBeLessThanOrEqual(532);
    expect(b.h).toBeGreaterThan(60);
  });

  it("explicit widths and plain blocks are untouched", async () => {
    const fixed = btn(await boxes(`<div style="width:532px"><button style="display:block;width:200px;${BTN}">Search</button></div>`));
    expect(fixed.w).toBe(200);
    const full = btn(await boxes(`<div style="width:532px"><button style="display:block;width:100%;${BTN}">Search</button></div>`));
    expect(full.w).toBe(532);
    const div = (await boxes(`<div style="width:532px"><div class="d" style="${BTN}">Search</div></div>`)).find((x) => (x.c || "").includes("d"))!;
    expect(div.w).toBe(532);
  });

  it("a fit-content block with margin:auto centres as well", async () => {
    const d = (await boxes(
      `<div style="width:532px"><div class="d" style="width:fit-content;margin:0 auto;padding:.8em 1em;border:2px solid #000;font-size:20px">Search</div></div>`,
    )).find((x) => (x.c || "").includes("d"))!;
    expect(d.w).toBeLessThan(200);
    expect(Math.abs(d.x - (532 - d.w) / 2)).toBeLessThan(1.5);
  });
});

// P0-20: real page developer.mozilla.org. The contributor spotlight image
// (512x323, width:max-content, max-height:8rem, height:auto, and the global
// img{max-width:100%}) sits in a <figure style="display:contents"> inside a
// row flex. It rendered at 155x98 instead of the max-height-transferred
// 203x128, and the text column next to it took the width the image lost.
// Two causes: (1) flex/grid item properties were computed from the DOM
// parent, so a child of a display:contents element never got its flex-basis
// default (auto), its flex factors, or blockification -- the basis read as
// a 0 length and an inline child was not blockified at all; item properties
// are now decided by the nearest ancestor that generates a box. (2) A
// percentage max-width made a replaced element's min-content contribution
// 0 and resolved against an indefinite containing block as 0; only a
// percentage width does the former, and a percentage clamp against an
// indefinite size is now treated as none.
describe("P0-20: flex items hoisted from display:contents get item properties", () => {
  type Box = { p: string; t: string; c?: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const FIG = (inner: string) => `<figure style="display:contents;margin:0">${inner}</figure>`;
  const SVG_URI =
    "data:image/svg+xml," +
    encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='512' height='323'><rect width='512' height='323' fill='#00f'/></svg>`);
  const SVG = `<img width="512" height="323" src="${SVG_URI}" style="width:max-content;max-height:128px;max-width:100%;height:auto">`;

  it("a definite-width block child of display:contents is a flex item at that width", async () => {
    const b = await boxes(
      `<div style="display:flex;width:768px"><div style="width:100px;height:10px"></div>${FIG(`<div class="h" style="width:200px;height:50px"></div>`)}</div>`,
    );
    const h = b.find((x) => (x.c || "").includes("h"))!;
    expect(h.w).toBe(200);
    expect(h.x).toBe(100);
  });

  it("an inline child of display:contents is blockified, so its width applies", async () => {
    const b = await boxes(
      `<div style="display:flex;width:768px"><div style="width:100px;height:10px"></div>${FIG(`<span class="h" style="width:200px;height:50px"></span>`)}</div>`,
    );
    const h = b.find((x) => (x.c || "").includes("h"))!;
    expect(h.w).toBe(200);
    expect(h.h).toBe(50);
  });

  it("flex-basis and flex-grow declared on a contents child take effect", async () => {
    const b = await boxes(
      `<div style="display:flex;width:768px"><div style="width:100px;height:10px"></div>${FIG(`<div class="b" style="flex:0 0 150px;height:50px"></div><div class="g" style="flex-grow:1;width:100px;height:50px"></div>`)}</div>`,
    );
    expect(b.find((x) => (x.c || "").includes("b"))!.w).toBe(150);
    expect(b.find((x) => (x.c || "").includes("g"))!.w).toBe(518); // 768 - 100 - 150, grown from 100
  });

  it("the contributor shape: a replaced contents child keeps its transferred size as its minimum", async () => {
    const b = await boxes(
      `<div style="display:flex;width:768px"><div class="s" style="width:600px;height:10px"></div>${FIG(SVG)}</div>`,
    );
    const svg = b.find((x) => x.t === "img")!;
    expect(svg.w).toBeCloseTo(202.9, 0); // 128 x 512/323, frozen at its automatic minimum
    expect(svg.h).toBeCloseTo(128, 0);
    expect(b.find((x) => (x.c || "").includes("s"))!.w).toBeCloseTo(565.1, 0); // the sibling absorbs the shrink
  });

  it("the same replaced shape as a direct flex item (percentage max-width is not a 0 min-content)", async () => {
    const b = await boxes(`<div style="display:flex;width:768px"><div class="s" style="width:600px;height:10px"></div>${SVG}</div>`);
    const svg = b.find((x) => x.t === "img")!;
    expect(svg.w).toBeCloseTo(202.9, 0);
    expect(svg.h).toBeCloseTo(128, 0);
    expect(b.find((x) => (x.c || "").includes("s"))!.w).toBeCloseTo(565.1, 0);
  });

  it("a percentage width still contributes 0 to a replaced item's min-content", async () => {
    const b = await boxes(
      `<div style="display:flex;width:400px"><div class="a" style="width:300px;height:10px"></div><svg width="512" height="323" viewBox="0 0 512 323" style="width:50%;height:auto"></svg></div>`,
    );
    const svg = b.find((x) => x.t === "svg")!;
    // Bases 300 + 200 (50% of 400) overflow by 100, split in proportion to
    // the bases because the percentage-width item may shrink to 0.
    expect(svg.w).toBeCloseTo(160, 0);
    expect(b.find((x) => (x.c || "").includes("a"))!.w).toBeCloseTo(240, 0);
  });

  it("a grid item hoisted from display:contents is blockified too", async () => {
    const b = await boxes(
      `<div style="display:grid;grid-template-columns:100px 1fr;width:768px"><div style="height:10px"></div>${FIG(`<span class="h" style="width:200px;height:50px"></span>`)}</div>`,
    );
    const h = b.find((x) => (x.c || "").includes("h"))!;
    expect(h.w).toBe(200);
    expect(h.x).toBe(100);
  });
});

// P0-21: a max-content measure laid the inline content out at the width on
// offer and reported the widest WRAPPED line, so every shrink-to-fit
// consumer under-sized: a fit-content block with overflowing text came back
// at 525px in a 532px container (the last line's slack), a width:max-content
// block wrapped instead of overflowing, a width:auto float and a column
// flex item's fit-content cross size shrank the same way (MDN's contributor
// name link 341 vs 533 and blockquote 503 vs 533). A max-content query now
// lays the inline content out unbounded in render_inline_context (block
// children keep the caller's context, so a nested grid's fr tracks still
// resolve against the area on offer), an auto/fit-content atomic inline is
// clamped to its fit-content size when placed, a max-content block wider
// than its container is placed at its content width, and a column flex
// item measured as content is re-measured at its resolved inline size so
// its main size belongs to the box it ends up with (react.dev's max-w-3xl
// paragraphs in align-items:flex-start columns). (Real pages
// developer.mozilla.org contributor section and react.dev.)
describe("P0-21: max-content measures do not wrap at the offered width", () => {
  type Box = { p: string; t: string; c?: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const T =
    "MDN Web Docs is a learning platform for Web technologies and the software that powers the Web, including CSS, HTML, and JavaScript for websites and Web applications, and it also sets the standards.";
  const F = (x: Box[], cls: string) => x.find((b) => (b.c || "").includes(cls))!;

  it("a fit-content block with overflowing text takes the full available width", async () => {
    const b = await boxes(
      `<div style="width:532px"><div class="f" style="width:fit-content;font-size:16px;line-height:18px">${T}</div></div>`,
    );
    expect(F(b, "f").w).toBe(532);
    expect(F(b, "f").h).toBe(54); // still wrapped into 3 lines at its used width
  });

  it("a max-content block overflows its container on one line", async () => {
    const b = await boxes(
      `<div style="width:532px"><div class="f" style="width:max-content;font-size:16px;line-height:18px">${T}</div></div>`,
    );
    expect(F(b, "f").w).toBeGreaterThan(1000);
    expect(F(b, "f").h).toBe(18);
  });

  it("a fit-content block with short text takes its max-content width", async () => {
    const b = await boxes(
      `<div style="width:532px"><div class="f" style="width:fit-content;font-size:16px;line-height:18px">Hello world</div></div>`,
    );
    expect(F(b, "f").w).toBeLessThan(200);
    expect(F(b, "f").h).toBe(18);
  });

  it("a min-content block still measures its longest word", async () => {
    const b = await boxes(
      `<div style="width:532px"><div class="f" style="width:min-content;font-size:16px;line-height:18px">${T}</div></div>`,
    );
    expect(F(b, "f").w).toBeLessThan(200);
    expect(F(b, "f").h).toBeGreaterThan(150);
  });

  it("a width:auto float with overflowing text takes the full available width", async () => {
    const b = await boxes(`<div style="width:532px"><div class="f" style="float:left;font-size:16px;line-height:18px">${T}</div></div>`);
    expect(F(b, "f").w).toBe(532);
    expect(F(b, "f").h).toBe(54);
  });

  it("a column flex item's fit-content cross size fills the column when the text overflows", async () => {
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;align-items:start;width:533px"><a class="f" style="width:fit-content;font-size:16px;line-height:18px">${T}</a></div>`,
    );
    expect(F(b, "f").w).toBe(533);
    expect(F(b, "f").h).toBe(54);
  });

  it("a plain block flex item sizes through a nested block child", async () => {
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;align-items:start;width:533px"><blockquote class="f" style="margin:0"><p style="margin:0;font-size:16px;line-height:18px">${T}</p></blockquote></div>`,
    );
    expect(F(b, "f").w).toBe(533);
  });

  it("a max-width still caps a shrink-to-fit float at the cap", async () => {
    const b = await boxes(
      `<div style="width:1000px"><div class="f" style="float:left;max-width:488px;font-size:16px;line-height:18px">${T}</div></div>`,
    );
    expect(F(b, "f").w).toBe(488);
  });

  it("a column flex item capped by max-width keeps the height of its capped width", async () => {
    const item = `<p class="f" style="max-width:768px;font-size:16px;line-height:18px;margin:0">${T}</p>`;
    const flex = await boxes(
      `<div style="display:flex;flex-direction:column;align-items:flex-start;width:1000px">${item}</div>`,
    );
    const block = await boxes(`<div style="width:1000px">${item}</div>`);
    expect(F(flex, "f").w).toBe(768);
    expect(F(flex, "f").h).toBe(F(block, "f").h);
    expect(F(flex, "f").h).toBeGreaterThan(18); // wrapped at 768, not the max-content measure's one line
  });
});

// P0-22: a percentage max-width on a replaced flex item resolved against the
// item's own size instead of the flex container's. The base measure clamped
// correctly (max-content 512 -> 384 at 50% of 768), but the automatic minimum
// came from a min-content measure where the percentage is treated as none
// (512) and overrode the max in the hypothetical size, and the final layout
// measure re-resolved the percentage against the assigned main size -- and
// ignored that size for a keyword width -- so the item landed at 512, or at
// half of its clamped size (202.89 -> 101.45 with a max-height in play).
// The automatic minimum is now clamped by the max main size, an exact size
// handed down by flex layout is the used size for a replaced item, and a
// percentage limit is not re-derived against an exact size (the same rule
// calculate_containing_block_context applies to blocks). Real page shape:
// developer.mozilla.org contributor image as a direct flex item.
describe("P0-22: a replaced flex item's percentage max size resolves against the container", () => {
  type Box = { p: string; t: string; c?: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const SVG_URI =
    "data:image/svg+xml," +
    encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='512' height='323'><rect width='512' height='323' fill='#00f'/></svg>`);
  const IMG = (style: string) => `<img width="512" height="323" src="${SVG_URI}" style="${style}">`;
  const F = (x: Box[]) => x.find((b) => b.t === "img")!;

  it("max-width:50% clamps a max-content flex item to half the container", async () => {
    const b = await boxes(`<div style="display:flex;width:768px">${IMG("width:max-content;max-width:50%")}</div>`);
    expect(F(b).w).toBe(384);
  });

  it("max-width:25% clamps a max-content flex item to a quarter of the container", async () => {
    const b = await boxes(`<div style="display:flex;width:768px">${IMG("width:max-content;max-width:25%")}</div>`);
    expect(F(b).w).toBe(192);
  });

  it("a max-height transfer is not halved again by a percentage max-width", async () => {
    const b = await boxes(
      `<div style="display:flex;width:768px">${IMG("width:max-content;max-height:128px;max-width:50%")}</div>`,
    );
    expect(F(b).h).toBe(128);
    expect(F(b).w).toBeCloseTo(202.9, 0);
  });

  it("a definite-width flex item is clamped once by its percentage max-width", async () => {
    const b = await boxes(`<div style="display:flex;width:300px">${IMG("width:200px;max-width:50%")}</div>`);
    expect(F(b).w).toBe(150);
  });

  it("a percentage max-height in a column flex resolves against the container height", async () => {
    const b = await boxes(
      `<div style="display:flex;flex-direction:column;width:768px;height:400px">${IMG("width:max-content;max-height:50%")}</div>`,
    );
    expect(F(b).h).toBe(200);
    expect(F(b).w).toBeCloseTo(317, 0);
  });

  it("the same image in block flow is unchanged", async () => {
    const b = await boxes(`<div style="width:768px">${IMG("width:max-content;max-height:128px;max-width:50%")}</div>`);
    expect(F(b).h).toBe(128);
    expect(F(b).w).toBeCloseTo(202.9, 0);
  });
});

// P0-23: replaced-element constraint resolution. render_image applied the max
// pair by transferring the ratio into whichever axis it clamped -- including a
// definite one (width:400px;max-height:128px came out 202.90x128) -- and the
// min pair not at all (width:100px;min-width:300px rendered 100 wide in block
// and grid flow; flex items were fine because flex_item clamps itself). The
// constraints now resolve in the CSS sequence: clamp the width, re-derive an
// auto height, clamp the height, re-derive and re-clamp an auto width; a
// definite axis is never re-derived, and on a same-axis conflict the min wins.
// (The images carry no width/height attributes on purpose: the attributes
// map to definite sizes as presentational hints -- Chromium sizes an
// attributed axis the same way -- so they would make the axes definite
// instead of exercising the intrinsic path.)
describe("P0-23: replaced element min/max constraints resolve per axis", () => {
  type Box = { p: string; t: string; c?: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const SVG_URI =
    "data:image/svg+xml," +
    encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='512' height='323'><rect width='512' height='323' fill='#00f'/></svg>`);
  const IMG = (style: string) => `<img src="${SVG_URI}" style="${style}">`;
  const F = (x: Box[]) => x.find((b) => b.t === "img")!;
  const B = (style: string) => `<div style="width:768px">${IMG(style)}</div>`;

  it("min-width grows a definite-width image and transfers to its auto height", async () => {
    const b = await boxes(B("width:100px;min-width:300px"));
    expect(F(b).w).toBe(300);
    expect(F(b).h).toBeCloseTo(189.26, 1);
  });

  it("min-height grows a definite-height image and transfers to its auto width", async () => {
    const b = await boxes(B("height:100px;min-height:200px"));
    expect(F(b).h).toBe(200);
    expect(F(b).w).toBeCloseTo(317.02, 1);
  });

  it("a percentage min-width resolves against the containing block", async () => {
    const b = await boxes(B("width:100px;min-width:50%"));
    expect(F(b).w).toBe(384);
  });

  it("min-width beyond the intrinsic size grows an auto image", async () => {
    const b = await boxes(B("min-width:600px"));
    expect(F(b).w).toBe(600);
    expect(F(b).h).toBeCloseTo(378.52, 1);
  });

  it("a max-height does not transfer into a definite width", async () => {
    const b = await boxes(B("width:400px;max-height:128px"));
    expect(F(b).w).toBe(400);
    expect(F(b).h).toBe(128);
  });

  it("with both axes definite a clamp applies to its own axis only", async () => {
    const b = await boxes(B("width:400px;height:200px;max-height:128px"));
    expect(F(b).w).toBe(400);
    expect(F(b).h).toBe(128);
    const c = await boxes(B("width:100px;height:200px;min-width:300px"));
    expect(F(c).w).toBe(300);
    expect(F(c).h).toBe(200);
  });

  it("a min-width and a max-height are both honoured, breaking the ratio", async () => {
    const b = await boxes(B("width:100px;min-width:300px;max-height:150px"));
    expect(F(b).w).toBe(300);
    expect(F(b).h).toBe(150);
  });

  it("a min-height and a max-width are both honoured, breaking the ratio", async () => {
    const b = await boxes(B("height:100px;min-height:200px;max-width:200px"));
    expect(F(b).w).toBe(200);
    expect(F(b).h).toBe(200);
  });

  it("on a same-axis conflict the min wins and the auto axis follows it", async () => {
    const b = await boxes(B("width:100px;min-width:300px;max-width:200px"));
    expect(F(b).w).toBe(300);
    expect(F(b).h).toBeCloseTo(189.26, 1);
  });
});

// P0-24: a ratio-only replaced item (a viewBox-only <svg>) in a grid. Its track-sizing
// contribution is cyclic and counts as 0, but at placement its used size is the block-
// level fill of its grid area: under start/center/end alignment it must not collapse
// to the 0 contribution, and a keyword width must not stretch it to the area when a
// definite height gives the width through the ratio transfer. With an auto height a
// keyword width has nothing to transfer from and fills like auto.
describe("P0-24: ratio-only grid item placement size", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const SVG = (style = "") => `<svg viewBox="0 0 200 100" style="${style}"></svg>`;
  const grid = (gstyle: string, inner: string) =>
    `<div style="display:grid;width:400px;height:200px;${gstyle}">${inner}</div>`;

  it("fills its area under place-items:start instead of vanishing", async () => {
    const b = await boxes(grid("place-items:start", SVG()));
    expect(at(b, "0.1.0.0").w).toBe(400);
    expect(at(b, "0.1.0.0").h).toBe(200);
  });

  it("fills its area under place-items:center and end", async () => {
    const c = await boxes(grid("place-items:center", SVG()));
    expect(at(c, "0.1.0.0").w).toBe(400);
    expect(at(c, "0.1.0.0").h).toBe(200);
    const e = await boxes(grid("place-items:end", SVG()));
    expect(at(e, "0.1.0.0").w).toBe(400);
    expect(at(e, "0.1.0.0").h).toBe(200);
  });

  it("fills each column under justify-items:start in a two-column grid", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;height:200px;grid-template-columns:1fr 1fr;place-items:start">${SVG()}${SVG()}</div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(200);
    expect(at(b, "0.1.0.0").h).toBe(100);
    expect(at(b, "0.1.0.1").w).toBe(200);
    expect(at(b, "0.1.0.1").h).toBe(100);
  });

  it("transfers from a definite height for a fit-content width", async () => {
    const b = await boxes(grid("", SVG("width:fit-content;height:40px")));
    expect(at(b, "0.1.0.0").w).toBe(80);
    expect(at(b, "0.1.0.0").h).toBe(40);
  });

  it("transfers from a definite height for a max-content width", async () => {
    const b = await boxes(grid("", SVG("width:max-content;height:40px")));
    expect(at(b, "0.1.0.0").w).toBe(80);
    expect(at(b, "0.1.0.0").h).toBe(40);
  });

  it("fills for a fit-content width when the height is auto", async () => {
    const b = await boxes(grid("", SVG("width:fit-content")));
    expect(at(b, "0.1.0.0").w).toBe(400);
    expect(at(b, "0.1.0.0").h).toBe(200);
  });

  it("fills for a min-content width when the height is auto", async () => {
    const b = await boxes(grid("", SVG("width:min-content")));
    expect(at(b, "0.1.0.0").w).toBe(400);
    expect(at(b, "0.1.0.0").h).toBe(200);
  });

  it("still transfers under place-items:start with a definite height", async () => {
    const b = await boxes(grid("place-items:start", SVG("width:fit-content;height:40px")));
    expect(at(b, "0.1.0.0").w).toBe(80);
    expect(at(b, "0.1.0.0").h).toBe(40);
  });
});

// P0-25: an <img> whose source is a viewBox-only SVG has an aspect ratio but no
// intrinsic size: it is a ratio-only replaced box, like an inline <svg>. The
// decoder used to report a 512x512 fallback size for it, so the box came out
// square (512x512 in a block, 50x50 at width:50px). The ratio now travels from
// the decoder through the image cache and the container to el_image, and the
// layout-path raster is the default object size fitted to the ratio (300x150),
// so the graphic fills its box instead of letterboxing.
describe("P0-25: img of a viewBox-only SVG is ratio-only", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const URI = (attrs: string, vb = "0 0 200 100") =>
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' ${attrs} viewBox='${vb}'><rect width='100%' height='100%' fill='#00f'/></svg>`,
    );
  const IMG = (style = "", attrs = "", vb?: string) =>
    `<img src="${URI(attrs, vb)}" style="${style}">`;

  it("fills its block and derives the height from the viewBox ratio", async () => {
    const b = await boxes(`<div style="width:400px">${IMG()}</div>`);
    expect(at(b, "0.1.0.0").w).toBe(400);
    expect(at(b, "0.1.0.0").h).toBe(200);
  });

  it("derives the height from a definite width", async () => {
    const b = await boxes(`<div style="width:400px">${IMG("width:50px")}</div>`);
    expect(at(b, "0.1.0.0").w).toBe(50);
    expect(at(b, "0.1.0.0").h).toBe(25);
  });

  it("derives the width from a definite height", async () => {
    const b = await boxes(`<div style="width:400px">${IMG("height:50px")}</div>`);
    expect(at(b, "0.1.0.0").w).toBe(100);
    expect(at(b, "0.1.0.0").h).toBe(50);
  });

  it("keeps the ratio under a max-width clamp", async () => {
    const b = await boxes(`<div style="width:400px">${IMG("max-width:100px")}</div>`);
    expect(at(b, "0.1.0.0").w).toBe(100);
    expect(at(b, "0.1.0.0").h).toBe(50);
  });

  it("fills its grid area under place-items:start", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;height:200px;place-items:start">${IMG()}</div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(400);
    expect(at(b, "0.1.0.0").h).toBe(200);
  });

  it("transfers in a grid from a definite height", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;height:200px">${IMG("width:fit-content;height:40px")}</div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(80);
    expect(at(b, "0.1.0.0").h).toBe(40);
  });

  it("uses the viewBox ratio of a square and a tall SVG", async () => {
    const s = await boxes(`<div style="width:400px">${IMG("", "", "0 0 100 100")}</div>`);
    expect(at(s, "0.1.0.0").w).toBe(400);
    expect(at(s, "0.1.0.0").h).toBe(400);
    const t = await boxes(`<div style="width:400px">${IMG("", "", "0 0 100 200")}</div>`);
    expect(at(t, "0.1.0.0").w).toBe(400);
    expect(at(t, "0.1.0.0").h).toBe(800);
  });

  it("an SVG with width/height attributes keeps its intrinsic size", async () => {
    const b = await boxes(
      `<div style="width:800px">${IMG("", "width='512' height='323'", "0 0 512 323")}</div>`,
    );
    expect(at(b, "0.1.0.0").w).toBe(512);
    expect(at(b, "0.1.0.0").h).toBe(323);
  });
});

// P0-26: grid placement line resolution. A definite END line pins an item
// whose start is auto or a span keyword (start = end - span, clamped to the
// first line with the span shrinking, down to 0 for end line 1), on either
// axis and in either flow; two definite lines are swapped when the end
// precedes the start. The engine used to ignore an end line unless the
// start was also a line number, so `grid-column: auto / 3` auto-placed.
describe("P0-26: grid end-line placement resolution", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const D = (style = "") => `<div style="background:#ccc;height:20px;${style}"></div>`;
  const G = (inner: string, extra = "") =>
    `<div style="display:grid;grid-template-columns:100px 100px 100px;width:300px;${extra}">${inner}</div>`;

  it("pins an auto-start item to its end line", async () => {
    const b = await boxes(G(D("grid-column:auto/3") + D() + D()));
    expect(at(b, "0.1.0.0").x).toBe(100);
    expect(at(b, "0.1.0.1").x).toBe(200);
    expect(at(b, "0.1.0.2").y).toBe(20);
  });

  it("keeps the column lock when the item comes last in DOM order", async () => {
    const b = await boxes(G(D() + D() + D("grid-column:auto/3")));
    expect(at(b, "0.1.0.2").x).toBe(100);
    expect(at(b, "0.1.0.2").y).toBe(20);
  });

  it("derives the start from a span and an end line", async () => {
    const b = await boxes(G(D("grid-column:span 2/4") + D()));
    expect(at(b, "0.1.0.0").x).toBe(100);
    expect(at(b, "0.1.0.0").w).toBe(200);
  });

  it("resolves a negative end line from the explicit grid end", async () => {
    const b = await boxes(G(D("grid-column:auto/-1") + D()));
    expect(at(b, "0.1.0.0").x).toBe(200);
  });

  it("locks the row for a row end line, ahead of auto items", async () => {
    const b = await boxes(G(D() + D("grid-row:auto/2") + D()));
    expect(at(b, "0.1.0.1").x).toBe(0);
    expect(at(b, "0.1.0.1").y).toBe(0);
    expect(at(b, "0.1.0.0").x).toBe(100);
  });

  it("applies an end-derived column inside a definite row", async () => {
    const b = await boxes(G(D("grid-row:1;grid-column:auto/3") + D() + D()));
    expect(at(b, "0.1.0.0").x).toBe(100);
    expect(at(b, "0.1.0.0").y).toBe(0);
  });

  it("swaps two definite lines when the end precedes the start", async () => {
    const b = await boxes(G(D("grid-column:4/2") + D()));
    expect(at(b, "0.1.0.0").x).toBe(100);
    expect(at(b, "0.1.0.0").w).toBe(200);
    const r = await boxes(
      `<div style="display:grid;grid-template-columns:100px 100px 100px;grid-template-rows:20px 20px 20px;width:300px"><div style="background:#ccc;grid-row:3/1"></div>${D()}</div>`,
    );
    expect(at(r, "0.1.0.0").y).toBe(0);
    expect(at(r, "0.1.0.0").h).toBe(40);
  });

  it("clamps a derived start to line 1, shrinking the span", async () => {
    const b = await boxes(G(D("grid-column:span 3/2") + D()));
    expect(at(b, "0.1.0.0").x).toBe(0);
    expect(at(b, "0.1.0.0").w).toBe(100);
    const z = await boxes(G(D("grid-column:auto/1") + D()));
    expect(at(z, "0.1.0.0").w).toBe(0);
    expect(at(z, "0.1.0.1").x).toBe(0);
  });

  it("extends implicit columns for an end-derived start", async () => {
    const b = await boxes(G(D("grid-column:auto/5") + D()));
    expect(at(b, "0.1.0.0").x).toBe(300);
    expect(at(b, "0.1.0.1").y).toBe(20);
  });
});

// P0-27: a <select> is sized to its longest option label, measured with the
// real text machinery plus a fixed allowance for the control chrome. The
// longest label used to be estimated per character (0.55em per ASCII byte,
// 1em per wide byte) plus 4.4em, which overshot Chromium by ~30px on a
// three-option select and by 70px on rust-lang.org's language switcher.
// The injected width is in em of the select's own (fractional, 13.33px)
// font size; the expectations below are the post-P0-28 values, where em
// resolves against the computed size instead of the rounded font's.
describe("P0-27: select width from the measured longest option", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const sel = (b: Box[]) => b.find((x) => x.t === "select")!;

  it("sizes to the longest option, selected or not", async () => {
    const b = await boxes(
      `<select><option selected>En</option><option>A very long language name</option><option>Fr</option></select>`,
    );
    expect(sel(b).w).toBeCloseTo(189.5, 0);
    expect(sel(b).h).toBe(19);
  });

  it("sizes a short single option to the label plus chrome", async () => {
    const b = await boxes(`<select><option>x</option></select>`);
    expect(sel(b).w).toBeCloseTo(29.3, 0);
  });

  it("an empty option still gets the chrome width", async () => {
    const b = await boxes(`<select><option></option></select>`);
    expect(sel(b).w).toBeCloseTo(26, 0);
  });
});

// P0-28: em lengths resolve against the element's computed font size, even
// when it is fractional. The font is created at a whole-pixel size and the
// metrics carried that rounded size, so 0.8rem (12.8px) resolved ems at
// 13px: width:10em came out 130 instead of 128, and MDN's
// min-height:calc(3em*1.2) summaries were 46.8 instead of 46.08.
describe("P0-28: em resolves against the computed (fractional) font size", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;

  it("width:10em at font-size 12.8px is 128, not 130", async () => {
    const b = await boxes(`<div style="font-size:12.8px;width:10em;height:5px"></div>`);
    expect(at(b, "0.1.0").w).toBeCloseTo(128, 0);
  });

  it("width:10em at font-size 12.5px is 125, not 130", async () => {
    const b = await boxes(`<div style="font-size:12.5px;width:10em;height:5px"></div>`);
    expect(at(b, "0.1.0").w).toBeCloseTo(125, 0);
  });

  it("min-height calc(3em * 1.2) at 0.8rem is 46.08", async () => {
    const b = await boxes(
      `<p style="font-size:0.8rem;min-height:calc(3em*1.2);max-height:calc(3em*1.2);margin:0">x</p>`,
    );
    expect(at(b, "0.1.0").h).toBeCloseTo(46.08, 0);
  });

  it("an inherited fractional size resolves ems on the child too", async () => {
    const b = await boxes(
      `<div style="font-size:12.8px"><div style="width:10em;height:5px"></div></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBeCloseTo(128, 0);
  });

  it("whole-pixel sizes are unchanged", async () => {
    const b = await boxes(`<div style="font-size:13px;width:10em;height:5px"></div>`);
    expect(at(b, "0.1.0").w).toBe(130);
  });
});

// P0-29: three flex/replaced sizing fixes from the rust-lang.org page.
// (1) A percentage max-width on a replaced element measured as a flex item's
//     content (a descendant query whose basis is indefinite once the direct
//     measure bit has been stripped) behaves as none, so a definite-width
//     ratio-only img keeps its size instead of collapsing to its padding.
// (2) A column flex line's cross size is bounded by the container's used
//     inline size (the definite size and the max property combine with min,
//     and a definite render size bounds it directly), so a stretched item
//     cannot overflow a column whose width an outer flex container assigned.
// (3) A flex item's base measure that came back capped by the item's own max
//     main size is re-measured unbounded: the flex base size is the
//     unclamped max-content size (the clamp belongs to the hypothetical).
describe("P0-29: flex base/cross sizing and replaced percentage max-width", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string, width = 1000): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${body}</body></html>`,
      width,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;

  it("ratio-only img with max-width:100% inside a flex item keeps its definite width", async () => {
    const svg =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 512"><rect width="480" height="512" fill="#00f"/></svg>`,
      );
    const b = await boxes(
      `<div style="display:flex;flex-wrap:wrap;width:277px"><a><img src="${svg}" style="width:40px;padding:0 10px;max-width:100%"></a></div>`,
    );
    expect(at(b, "0.1.0.0").w).toBeCloseTo(60, 0);
    expect(at(b, "0.1.0.0.0").w).toBeCloseTo(60, 0);
    expect(at(b, "0.1.0.0.0").h).toBeCloseTo((40 * 512) / 480, 0);
  });

  it("a stretched column item is capped by the column's used width", async () => {
    const words = "word ".repeat(60);
    const col = `<div style="box-sizing:border-box;flex:0 0 200px;display:flex;flex-direction:column;max-width:612px;padding:0 24px"><ul style="margin:0;padding:0"><li>${words}</li></ul></div>`;
    const b = await boxes(`<div style="display:flex;width:600px">${col}</div>`, 600);
    // The outer row assigns the column 200px; its list stretches to the
    // column's content width (200 - 48 padding), not to its single-line
    // width, even though the column's own max-width is much larger.
    expect(at(b, "0.1.0.0.0").w).toBeCloseTo(152, 0);
  });

  it("flex bases are the unclamped max-content sizes under a percentage max-width", async () => {
    const col = (w: number, extra: string) =>
      `<div style="display:flex;flex-direction:column;max-width:50%;${extra}"><div style="width:${w}px;height:10px"></div></div>`;
    const b = await boxes(
      `<div style="display:flex;width:976px">${col(885, "margin-right:24px")}${col(893, "")}</div>`,
    );
    // Bases 885 (+24 margin) and 893 shrink proportionally into 976.
    expect(at(b, "0.1.0.0").w).toBeCloseTo(473.8, 0);
    expect(at(b, "0.1.0.1").w).toBeCloseTo(478.2, 0);
  });
});

// P0-30: a non-stretched grid item is sized fit-content against its grid
// area: the content measure answers with its max-content, which the area
// bounds, so an item whose text is wider than its area wraps inside it
// instead of overflowing at its single-line width (MDN's footer legal
// paragraph, grid-area spanning both columns with justify-items:start).
// width:max-content is exempt: it overflows by definition.
describe("P0-30: non-stretched grid item clamped to its area (fit-content)", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string, width = 1000): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${body}</body></html>`,
      width,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (b: Box[], p: string) => b.find((x) => x.p === p)!;
  const T = "Portions of this content are by individual mozilla.org contributors. Content available under a Creative Commons license.";

  it("a justify-items:start item spanning both columns takes the area width", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;grid-template-columns:min-content 1fr;column-gap:24px;justify-items:start"><div style="width:128px;height:10px"></div><div></div><p style="grid-column:1/3;margin:0">${T}</p></div>`,
      400,
    );
    expect(at(b, "0.1.0.2").w).toBeCloseTo(400, 0);
  });

  it("a single-column start item is clamped the same way", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;grid-template-columns:1fr;justify-items:start"><p style="margin:0">${T}</p></div>`,
      400,
    );
    expect(at(b, "0.1.0.0").w).toBeCloseTo(400, 0);
  });

  it("width:max-content still overflows its area", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;grid-template-columns:1fr;justify-items:start"><p style="margin:0;width:max-content">${T}</p></div>`,
      400,
    );
    expect(at(b, "0.1.0.0").w).toBeGreaterThan(400);
  });

  it("a stretched item is unchanged (area width)", async () => {
    const b = await boxes(
      `<div style="display:grid;width:400px;grid-template-columns:1fr"><p style="margin:0">${T}</p></div>`,
      400,
    );
    expect(at(b, "0.1.0.0").w).toBeCloseTo(400, 0);
  });
});

// P0-31: a select's height comes from its font, not a fixed 19px: the UA
// rule used to pin height:19px, so a select at any other font size kept a
// 19px box (rust-lang.org's language selects: 19 vs Chromium's 23.25) and
// authored padding could not grow it (font-size:20px + padding:10px gave
// 22 vs 46). The height is now content-driven with a 1px block padding in
// the UA rule modelling the native button's insets: at the default
// 13.333px size the box is unchanged (19px), and it tracks Chromium
// within a pixel at other sizes (15px -> 21, 20px -> 27 vs Chromium 26,
// 20px + padding:10px -> 45 vs Chromium 46).
describe("P0-31: select height follows its font size", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const sel = (style: string) =>
    `<select style="${style}"><option>English (en-US)</option><option>Français (fr)</option></select>`;

  it("the default-size select keeps its 19px height", async () => {
    const b = await boxes(sel(""));
    expect(b.find((x) => x.t === "select")!.h).toBeCloseTo(19, 0);
  });

  it("font-size:15px gives 21px", async () => {
    const b = await boxes(sel("font-size:15px"));
    expect(b.find((x) => x.t === "select")!.h).toBeCloseTo(21, 0);
  });

  it("font-size:20px gives 27px", async () => {
    const b = await boxes(sel("font-size:20px"));
    expect(b.find((x) => x.t === "select")!.h).toBeCloseTo(27, 0);
  });

  it("authored padding grows the box", async () => {
    const b = await boxes(sel("font-size:20px;padding:10px"));
    expect(b.find((x) => x.t === "select")!.h).toBeCloseTo(45, 0);
  });
});

// P0-32: a select with size > 1 or multiple renders as a list box. It used
// to ignore size/multiple entirely and draw the one-line dropdown box
// (19px) whatever the display size. Now every option (and optgroup
// label) becomes a row of a pre-formatted text child and the box is
// pinned to the display size: Chromium's list box at the default
// 13.333px size is rows * 17px + 2px border (size 4 -> 70, size 2 -> 36,
// size 8 -> 138, even when fewer options exist), and its width is the
// widest row plus ~6px of padding and border (this platform's overlay
// scrollbars reserve no width). The engine's row ratio is the measure
// font's (ascent + descent) at the UA select size plus 2px per row,
// expressed in em; widths carry the usual substitute-font advance gap
// vs Chromium (cf. the dropdown widths in P0-27).
describe("P0-32: select list box (size / multiple)", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function boxes(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const sel = (attrs: string, labels: string[]) =>
    `<select ${attrs}>${labels.map((l) => `<option>${l}</option>`).join("")}</select>`;
  const SHORT = ["a", "bb", "ccc", "dddd"];
  const MANY = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const h = async (attrs: string, labels: string[]) =>
    (await boxes(sel(attrs, labels))).find((x) => x.t === "select")!.h;

  it("size=4 shows four rows (70px)", async () => {
    expect(await h('size="4"', SHORT)).toBeCloseTo(70, 0);
  });

  it("size=4 with only two options is still four rows tall", async () => {
    expect(await h('size="4"', SHORT.slice(0, 2))).toBeCloseTo(70, 0);
  });

  it("size=2 shows two rows (36px)", async () => {
    expect(await h('size="2"', SHORT)).toBeCloseTo(36, 0);
  });

  it("size=8 with ten options shows eight rows (138px)", async () => {
    expect(await h('size="8"', MANY)).toBeCloseTo(138, 0);
  });

  it("multiple without size defaults to four rows", async () => {
    expect(await h("multiple", SHORT)).toBeCloseTo(70, 0);
  });

  it("optgroup labels count as rows (size=6 -> 104px)", async () => {
    const b = await boxes(
      `<select size="6"><optgroup label="Group A"><option>one</option><option>two</option></optgroup><optgroup label="Group B"><option>three</option></optgroup></select>`,
    );
    expect(b.find((x) => x.t === "select")!.h).toBeCloseTo(104, 0);
  });

  it("size=1 and size=0 stay dropdowns (19px)", async () => {
    expect(await h('size="1"', SHORT)).toBeCloseTo(19, 0);
    expect(await h('size="0"', SHORT)).toBeCloseTo(19, 0);
    expect(await h("", SHORT)).toBeCloseTo(19, 0);
  });

  it("the list box width follows the widest row, not the dropdown chrome", async () => {
    const b = await boxes(sel('size="4"', MANY));
    const s = b.find((x) => x.t === "select")!;
    // Chromium: 41.58 for these labels; the engine's substitute advances
    // run slightly wide (42.00 measured).
    expect(s.w).toBeGreaterThan(38);
    expect(s.w).toBeLessThan(46);
  });
});

// P0-33: a font-family declared on html (or :root) must inherit into the
// page. The UA stylesheet used to carry `font-family: sans-serif` on
// body, and a cascaded value on body beats anything inherited, so the
// widespread `html { font-family: ... }` pattern (MDN's base font is
// declared exactly this way) never reached any element: the whole page
// rendered in the fallback font (MDN's "Contributor Spotlight" h2
// measured 247.25 against Chromium's 231.75 with Inter applied). The UA
// default now sits on html, where an author rule on html/:root
// overrides it and body or below still win as before. Monospace stands
// in for a webfont here: its advance profile differs clearly from the
// sans default, so an inherited family is observable in the width.
describe("P0-33: font-family on html inherits into the page", () => {
  type Box = { p: string; t: string; x: number; y: number; w: number; h: number };

  async function width(css: string, attrs = ""): Promise<number> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html ${attrs}><head><style>html,body{margin:0}${css}</style></head><body><div id="w" style="width:fit-content">Contributor Spotlight</div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.t === "div")!.w;
  }

  it("html { font-family: monospace } reaches body content", async () => {
    const viaHtml = await width(`html{font-family:monospace}`);
    const viaBody = await width(`body{font-family:monospace}`);
    const plain = await width(``);
    expect(viaHtml).toBeCloseTo(viaBody, 0);
    expect(Math.abs(viaHtml - plain)).toBeGreaterThan(10);
  });

  it(":root { font-family: monospace } reaches body content", async () => {
    const viaRoot = await width(`:root{font-family:monospace}`);
    const viaBody = await width(`body{font-family:monospace}`);
    expect(viaRoot).toBeCloseTo(viaBody, 0);
  });

  it("a class rule on html reaches body content", async () => {
    const viaClass = await width(`.x{font-family:monospace}`, `class="x"`);
    const viaBody = await width(`body{font-family:monospace}`);
    expect(viaClass).toBeCloseTo(viaBody, 0);
  });

  it("var() indirection on html works", async () => {
    const viaVar = await width(`:root{--f:monospace}html{font-family:var(--f)}`);
    const viaBody = await width(`body{font-family:monospace}`);
    expect(viaVar).toBeCloseTo(viaBody, 0);
  });

  it("an element's own font-family still wins over the html rule", async () => {
    const own = await width(`html{font-family:monospace}div{font-family:serif}`);
    const plainSerif = await width(`div{font-family:serif}`);
    expect(own).toBeCloseTo(plainSerif, 0);
  });

  it("the unstyled default is unchanged (sans by inheritance from html)", async () => {
    const plain = await width(``);
    const viaBodySans = await width(`body{font-family:sans-serif}`);
    expect(plain).toBeCloseTo(viaBodySans, 0);
  });
});

// P0-34: scrollbar-gutter must narrow the containing block of positioned
// boxes too. document::render subtracted the reserved 15px for in-flow
// layout (P0-14), but render_positioned built the initial containing
// block from the raw viewport width, so an absolutely positioned or
// fixed box resolved percentages and auto sizes against the full
// viewport: MDN's off-screen .a11y-menu (left/right 2px,
// width: calc(100% - 4px)) measured 996 against Chromium's 981 on a
// 1000px viewport. The positioned containing block now subtracts the
// same gutter (30px for stable both-edges).
describe("P0-34: scrollbar-gutter applies to positioned containing blocks", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function box(css: string, style: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}${css}</style></head><body><div id="w" style="${style}"></div><div style="height:2000px"></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const GUT = `html{scrollbar-gutter:stable}`;

  it("absolute width:100% resolves against the narrowed ICB (585 of 600)", async () => {
    const b = await box(GUT, "position:absolute;left:0;top:0;width:100%;height:10px");
    expect(b.w).toBeCloseTo(585, 0);
  });

  it("absolute width:calc(100% - 4px) matches the a11y-menu shape (581)", async () => {
    const b = await box(GUT, "position:absolute;left:2px;right:2px;top:0;width:calc(100% - 4px);height:10px");
    expect(b.w).toBeCloseTo(581, 0);
    expect(b.x).toBeCloseTo(2, 0);
  });

  it("absolute auto width between left and right uses the narrowed ICB", async () => {
    const b = await box(GUT, "position:absolute;left:2px;right:2px;top:0;height:10px");
    expect(b.w).toBeCloseTo(581, 0);
  });

  it("fixed width:100% resolves against the narrowed viewport", async () => {
    const b = await box(GUT, "position:fixed;left:0;top:0;width:100%;height:10px");
    expect(b.w).toBeCloseTo(585, 0);
  });

  it("without the gutter, positioned boxes keep the full viewport width", async () => {
    const b = await box("", "position:absolute;left:0;top:0;width:100%;height:10px");
    expect(b.w).toBeCloseTo(600, 0);
  });

  it("stable both-edges reserves twice the gutter (570)", async () => {
    const b = await box(`html{scrollbar-gutter:stable both-edges}`, "position:absolute;left:0;top:0;width:100%;height:10px");
    expect(b.w).toBeCloseTo(570, 0);
  });
});

// P0-35: font-relative units inside calc() resolve against the owning
// element's font size (em) and the root font size (rem). The calc
// parser used to fold em into px at a hardcoded 16 and the evaluator
// did the same for rem, so `width: calc(2em)` at font-size 20px
// measured 32 instead of 40 wherever the size came from (own,
// inherited, or the root's), and `line-height: calc(...)` computed to
// 0 because a calc length carries css_units_none and fell into the
// unitless-number branch. A calc length now keeps an em component
// alongside px/%/rem, document::to_pixels evaluates with the caller's
// metrics, and cvt_units folds the font-relative components into px
// at the owning element's sizes during style computation (including
// plain em/rem operands of min()/max()/clamp()).
describe("P0-35: em/rem inside calc() resolve with the element's fonts", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function box(css: string, inner: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}${css}</style></head><body>${inner}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const D = (style: string) => `<div id="w" style="${style}">x</div>`;

  it("width: calc(2em) uses the element's own font size", async () => {
    const b = await box("", D("font-size:20px;width:calc(2em);height:10px"));
    expect(b.w).toBeCloseTo(40, 0);
  });

  it("width: calc(2em) uses an inherited font size", async () => {
    const b = await box("", `<div style="font-size:20px">${D("width:calc(2em);height:10px")}</div>`);
    expect(b.w).toBeCloseTo(40, 0);
  });

  it("width: calc(2rem) uses the root font size", async () => {
    const b = await box("html{font-size:20px}", D("width:calc(2rem);height:10px"));
    expect(b.w).toBeCloseTo(40, 0);
  });

  it("margin-left: calc(2em) offsets by the element's font size", async () => {
    const b = await box("", D("font-size:20px;margin-left:calc(2em);width:10px;height:10px"));
    expect(b.x).toBeCloseTo(40, 0);
  });

  it("calc() mixing % and em keeps both bases", async () => {
    const b = await box("", `<div style="width:400px">${D("font-size:20px;width:calc(50% - 1em);height:10px")}</div>`);
    expect(b.w).toBeCloseTo(180, 0);
  });

  it("font-size: calc(1em + 4px) resolves em against the parent", async () => {
    const b = await box("", `<div style="font-size:20px"><div id="w" style="font-size:calc(1em + 4px);width:1em;height:10px"></div></div>`);
    expect(b.w).toBeCloseTo(24, 0);
  });

  it("line-height: calc(1em + 2px) is the sum, not zero", async () => {
    const b = await box("", D("font-size:20px;line-height:calc(1em + 2px)"));
    expect(b.h).toBeCloseTo(22, 0);
  });

  it("min()/clamp() operands in em use the element's font size", async () => {
    const b1 = await box("", D("font-size:20px;width:min(3em, 100px);height:10px"));
    expect(b1.w).toBeCloseTo(60, 0);
    const b2 = await box("", D("font-size:20px;width:clamp(10px, 3em, 100px);height:10px"));
    expect(b2.w).toBeCloseTo(60, 0);
  });
});

// P0-36: a named family that resolves through a metric profile (Courier
// New, Georgia, the Liberation clones, ...) is drawn with the profile
// generic's substitute typeface, but when the font stack named no
// generic, that substitute was never requested -- so the metric
// fallback degraded to the sans typeface carrying only the profile's
// vertical metrics: 'Courier New' alone measured the proportional
// sans width (118.5px for "mmmmmmmm" at 16px) instead of the mono
// width (64px) the same stack with an explicit `monospace` produced.
// The collect stage now also requests the profile's generic family,
// and the Liberation fonts (metric clones of Arial / Times New Roman
// / Courier New by design) have profile aliases.
describe("P0-36: profiled named families shape with their generic's glyphs", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function measure(family: string): Promise<number> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div id="w" style="font-family:${family};font-size:16px;width:fit-content">mmmmmmmm</div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!.w;
  }

  it("'Courier New' alone matches the monospace generic's width", async () => {
    const generic = await measure("monospace");
    const named = await measure("'Courier New'");
    expect(Math.abs(named - generic)).toBeLessThan(1);
  });

  it("'Liberation Mono' alone matches the monospace generic's width", async () => {
    const generic = await measure("monospace");
    const named = await measure("'Liberation Mono'");
    expect(Math.abs(named - generic)).toBeLessThan(1);
  });

  it("'Georgia' alone matches the serif generic's width", async () => {
    const generic = await measure("serif");
    const named = await measure("'Georgia'");
    expect(Math.abs(named - generic)).toBeLessThan(1);
  });
});

// P0-37: a table row with no cells at all (an empty <tr>, e.g. Hacker
// News's <tr class="spacer" style="height:5px"></tr>) still occupies
// its grid slot -- the following rows are placed after it -- but the
// layout dump derived row boxes from the union of their cells, so a
// cell-less row reported a degenerate 0x0 box at the table origin.
// The dump now interpolates a cell-less row's band from its
// neighbouring rows (x/width already came from the column-band pass).
describe("P0-37: cell-less table rows report their grid slot", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function rows(body: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const T = (mid: string) =>
    `<table cellspacing="0" cellpadding="0"><tr><td>a</td></tr>${mid}<tr><td>b</td></tr></table>`;

  it("an empty tr with height:5px reports y=18 h=5", async () => {
    const out = await rows(T(`<tr id="sp" style="height:5px"></tr>`));
    const sp = out.find((x) => x.i === "sp")!;
    expect(sp.y).toBeCloseTo(18, 0);
    expect(sp.h).toBeCloseTo(5, 0);
  });

  it("an empty tr with height:9px reports h=9", async () => {
    const out = await rows(T(`<tr id="sp" style="height:9px"></tr>`));
    const sp = out.find((x) => x.i === "sp")!;
    expect(sp.h).toBeCloseTo(9, 0);
  });

  it("an empty tr without height reports h=0 at the right y", async () => {
    const out = await rows(T(`<tr id="sp"></tr>`));
    const sp = out.find((x) => x.i === "sp")!;
    expect(sp.y).toBeCloseTo(18, 0);
    expect(sp.h).toBeCloseTo(0, 0);
  });
});

// P0-38: <img srcset> was ignored entirely -- the engine always loaded
// src. For the common pattern where src is the 2x file (or a
// placeholder) and srcset carries the candidate a DPR-1 browser would
// pick, that fetched the wrong resource (and missed entirely against
// offline stores holding only the 1x). Candidates are now selected
// the way a browser at device pixel ratio 1 does: with x descriptors,
// the smallest density >= 1 (else the largest); with w descriptors,
// the smallest width covering the sizes slot (default 100vw, with
// (max/min-width) conditions understood), else the largest.
describe("P0-38: img srcset candidate selection", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  // Renders an img whose candidates are data: URIs of different-sized
  // SVGs and returns the laid-out box: the chosen candidate is visible
  // through the intrinsic size it contributes (no CSS size set).
  async function imgBox(attrs: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body><img id="w" ${attrs}></body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const svg = (w: number, h: number) =>
    "data:image/svg+xml," +
    encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'></svg>`);

  it("x descriptors: the 1x candidate wins over the 2x in src", async () => {
    const b = await imgBox(`src="${svg(200, 100)}" srcset="${svg(50, 25)} 1x, ${svg(200, 100)} 2x"`);
    expect(b.w).toBeCloseTo(50, 0);
    expect(b.h).toBeCloseTo(25, 0);
  });

  it("x descriptors: with only densities below 1... none, falls to the largest", async () => {
    const b = await imgBox(`src="${svg(200, 100)}" srcset="${svg(80, 40)} 2x, ${svg(120, 60)} 3x"`);
    expect(b.w).toBeCloseTo(80, 0);
  });

  it("w descriptors: the smallest width covering 100vw wins", async () => {
    const b = await imgBox(`src="${svg(10, 10)}" srcset="${svg(300, 30)} 300w, ${svg(700, 70)} 700w, ${svg(1200, 120)} 1200w"`);
    // viewport 600 -> slot 600 -> 700w candidate
    expect(b.w).toBeCloseTo(700, 0);
  });

  it("w descriptors with sizes: the sizes slot drives the pick", async () => {
    const b = await imgBox(`sizes="200px" src="${svg(10, 10)}" srcset="${svg(300, 30)} 300w, ${svg(700, 70)} 700w"`);
    expect(b.w).toBeCloseTo(300, 0);
  });

  it("w descriptors with a matching media condition in sizes", async () => {
    const b = await imgBox(`sizes="(max-width: 700px) 150px, 900px" src="${svg(10, 10)}" srcset="${svg(300, 30)} 300w, ${svg(1200, 120)} 1200w"`);
    // viewport 600 <= 700 -> slot 150 -> 300w candidate
    expect(b.w).toBeCloseTo(300, 0);
  });

  it("no srcset keeps src; an unparseable srcset falls back to src", async () => {
    const b1 = await imgBox(`src="${svg(64, 32)}"`);
    expect(b1.w).toBeCloseTo(64, 0);
    const b2 = await imgBox(`src="${svg(64, 32)}" srcset="  "`);
    expect(b2.w).toBeCloseTo(64, 0);
  });
});

// P0-39: a var() reference that forms a cycle (a custom property
// referencing itself, the design-token alias idiom
// `--x: var(--x, fallback)` used by Wikipedia's .vector-icon) was
// dropped outright during substitution, emptying the whole
// declaration: width became auto and only the min-width clamp
// remained (10px instead of 16px). A cyclic reference makes the
// property invalid at computed-value time, so the var() must take
// its fallback exactly like an undefined property does.
describe("P0-39: cyclic var() references fall back", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function box(html: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: html,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const page = (css: string, body: string) =>
    `<!doctype html><html><head><style>html,body{margin:0}span{display:inline-block}${css}</style></head><body>${body}</body></html>`;

  it("self-referential alias resolves through the inner fallback", async () => {
    const b = await box(page(
      `.b{--fsm:var(--fsm,1rem);width:var(--fsm,1rem);height:var(--fsm,1rem);min-width:10px;min-height:10px}`,
      `<span class="b" id="w"></span>`));
    expect(b.w).toBeCloseTo(16, 0);
    expect(b.h).toBeCloseTo(16, 0);
  });

  it("the element's own alias shadows an inherited chain, via its fallback", async () => {
    const b = await box(page(
      `.a{--fsm:var(--font-size-x-large,1.25rem)}.b{--fsm:var(--fsm,1rem);width:var(--fsm,1rem);height:var(--fsm,1rem);min-width:10px;min-height:10px}`,
      `<span class="a"><span class="b" id="w"></span></span>`));
    expect(b.w).toBeCloseTo(16, 0);
  });

  it("a two-property cycle falls back on both sides", async () => {
    const b = await box(page(
      `.b{--a:var(--b,2rem);--b:var(--a,3rem);width:var(--a,1rem);height:var(--b,1rem)}`,
      `<span class="b" id="w"></span>`));
    // --a: var(--b) -> --b is var(--a) -> cycle: --b's var() takes
    // its fallback 3rem, so --a = 3rem; height reads --b, whose own
    // substitution hits the same cycle and takes 3rem as well...
    // (browsers agree on width here; keep to the width assertion)
    expect(b.w).toBeCloseTo(48, 0);
  });

  it("a cyclic var() without a fallback still empties only itself", async () => {
    const b = await box(page(
      `.b{--a:var(--a);width:var(--a);height:22px;background:#f00}`,
      `<span class="b" id="w"></span>`));
    expect(b.h).toBeCloseTo(22, 0);
    expect(b.w).toBeCloseTo(0, 0);
  });
});

// P0-40: a line box was capped at the largest line-height among its
// runs. But each run's inline box is its own line-height tall with
// the leading split around its own ascent/descent, so an
// ascent-dominant run beside ordinary text extends the union past
// the line-height in browsers (python.org's widget titles: a
// Pythonicon glyph, ascent 0.94em, beside 0.90em body text grows the
// line 33.4 -> 35.4). line_box::finish now recomputes the per-run
// extents for such runs and grows the box by the union's excess.
// The growth is deliberately restricted to runs whose ascent
// exceeds the strut's: descent-side splits of ordinary text runs
// are dominated by substitute-font noise in this engine's
// per-element fallback resolution, and counting them grew plain
// lines by a pixel across whole pages (Wikipedia).
describe("P0-40: line box grows for ascent-dominant runs", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function para(html: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${html}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }

  it("an ascent-dominant run extends the line past the line-height", async () => {
    // Strut font Courier New at 20px: metrics 17/6, line-height 34
    // -> above 22, below 12. Segoe UI run: metrics 22/5 (ascent
    // past the strut's) -> above 25, below 9. Union 25 + 12 = 37.
    const b = await para(
      `<p id="w" style="font-family:'Courier New';font-size:20px;line-height:34px">A<span style="font-family:'Segoe UI'">B</span></p>`);
    expect(b.h).toBeCloseTo(37, 0);
  });

  it("a single font keeps the line at its line-height", async () => {
    const b = await para(
      `<p id="w" style="font-family:'Courier New';font-size:20px;line-height:34px">AB</p>`);
    expect(b.h).toBeCloseTo(34, 0);
  });

  it("a top-aligned inline box's font does not extend the line", async () => {
    const b = await para(
      `<p id="w" style="font-family:'Courier New';font-size:20px;line-height:34px">A<span style="font-family:'Segoe UI';vertical-align:top">B</span></p>`);
    expect(b.h).toBeCloseTo(34, 0);
  });

  it("a descent-side-only divergence does not extend the line", async () => {
    // Verdana strut (20/4) with a Courier New run (17/6): the
    // descent split differs but no run's ascent passes the
    // strut's, so the restricted growth stays out.
    const b = await para(
      `<p id="w" style="font-family:Verdana;font-size:20px;line-height:30px">A<span style="font-family:'Courier New'">B</span></p>`);
    expect(b.h).toBeCloseTo(30, 0);
  });
});

// P0-41: two replaced-element sizing gaps. (1) An SVG image with
// exactly one absolute dimension (width=80, no height) had no
// intrinsic size at all in decode_svg -- Skia's containerSize() is
// empty for that shape and the layout path fell to 512x512, where a
// browser derives the other dimension from the viewBox ratio, or
// from the default object size (300x150) without a viewBox.
// (2) A replaced flex item stretched to a definite container height
// transfers that height through its ratio to its flex base size, but
// its automatic minimum stayed the intrinsic width, so flex-shrink
// pulled it back (120x50 in a 60px-tall, 80px-wide row: Chrome keeps
// the transferred 144 and overflows; the engine shrank to 120). The
// shrink floor is now the transferred size for non-ratio-only items
// (ratio-only items are re-transferred by render_flex afterwards and
// keep the old floor).
describe("P0-41: one-dimension SVG images and the flex stretch floor", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };
  const uri = (inner: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${inner}><rect width="80" height="40" fill="#69c"/></svg>`)}`;

  async function box(html: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }

  it("width-only SVG image with a viewBox derives height from the ratio", async () => {
    const b = await box(`<img id="w" src="${uri('width="80" viewBox="0 0 80 10"')}">`);
    expect(b.w).toBeCloseTo(80, 0);
    expect(b.h).toBeCloseTo(10, 0);
  });

  it("width-only SVG image without a viewBox gets the default object height", async () => {
    const b = await box(`<img id="w" src="${uri('width="80"')}">`);
    expect(b.w).toBeCloseTo(80, 0);
    expect(b.h).toBeCloseTo(150, 0);
  });

  it("height-only SVG image with a viewBox derives width from the ratio", async () => {
    const b = await box(`<img id="w" src="${uri('height="40" viewBox="0 0 80 10"')}">`);
    expect(b.w).toBeCloseTo(320, 0);
    expect(b.h).toBeCloseTo(40, 0);
  });

  it("height-only SVG image without a viewBox gets the default object width", async () => {
    const b = await box(`<img id="w" src="${uri('height="40"')}">`);
    expect(b.w).toBeCloseTo(300, 0);
    expect(b.h).toBeCloseTo(40, 0);
  });

  it("a stretched flex image keeps its transferred width under shrink pressure", async () => {
    const b = await box(
      `<div style="display:flex;height:60px;width:80px"><img id="w" src="${uri('width="120" height="50" viewBox="0 0 120 50"')}"></div>`);
    expect(b.w).toBeCloseTo(144, 0);
    expect(b.h).toBeCloseTo(60, 0);
  });

  it("an image stretched to a shorter container narrows below its intrinsic width", async () => {
    const b = await box(
      `<div style="display:flex;height:30px;width:300px"><img id="w" src="${uri('width="120" height="50" viewBox="0 0 120 50"')}"></div>`);
    expect(b.w).toBeCloseTo(72, 0);
    expect(b.h).toBeCloseTo(30, 0);
  });
});

// P0-42: a ratio-only replaced grid item with a content-keyword width
// (fit-content / max-content / min-content) was sent down the
// ratio_fill path -- it filled its track (or vanished to 0) -- even
// when its block size resolved. A keyword width is not stretched, so
// when the height is definite, a percentage of the row, or the align
// stretch, the used width is the ratio transfer from that block size
// (unclamped by the track), exactly like an auto width. The
// justify-stretch fill exception now covers auto widths only, and
// with the block size unresolved the fill stays.
describe("P0-42: keyword widths on ratio-only grid items transfer from the block size", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function box(html: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const svg = (style: string) =>
    `<svg id="w" viewBox="0 0 40 20" style="${style}"><rect width="40" height="20" fill="#69c"/></svg>`;
  const grid = (cols: string, extra: string, inner: string) =>
    `<div style="display:grid;grid-template-columns:${cols};${extra}">${inner}</div>`;

  it("fit-content transfers from the stretched row height", async () => {
    const b = await box(grid("50px", "grid-template-rows:20px;align-items:stretch;justify-items:stretch", svg("width:fit-content")));
    expect(b.w).toBeCloseTo(40, 0);
    expect(b.h).toBeCloseTo(20, 0);
  });

  it("fit-content transfers from a percentage height", async () => {
    const b = await box(grid("50px", "grid-template-rows:20px;align-items:stretch;justify-items:stretch", svg("width:fit-content;height:50%")));
    expect(b.w).toBeCloseTo(20, 0);
    expect(b.h).toBeCloseTo(10, 0);
  });

  it("fit-content transfers from a definite height", async () => {
    const b = await box(grid("50px", "grid-template-rows:20px;align-items:stretch;justify-items:stretch", svg("width:fit-content;height:12px")));
    expect(b.w).toBeCloseTo(24, 0);
    expect(b.h).toBeCloseTo(12, 0);
  });

  it("max-content is not clamped by a narrower track", async () => {
    const b = await box(grid("30px", "grid-template-rows:20px;align-items:stretch;justify-items:stretch", svg("width:max-content")));
    expect(b.w).toBeCloseTo(40, 0);
    expect(b.h).toBeCloseTo(20, 0);
  });

  it("an unresolved block size keeps the fill", async () => {
    const b = await box(grid("50px", "align-items:start;justify-items:stretch", svg("width:fit-content")));
    expect(b.w).toBeCloseTo(50, 0);
    expect(b.h).toBeCloseTo(25, 0);
  });

  it("an auto width under justify stretch still fills its track", async () => {
    const b = await box(grid("50px", "grid-template-rows:20px;align-items:stretch;justify-items:stretch", svg("")));
    expect(b.w).toBeCloseTo(50, 0);
    expect(b.h).toBeCloseTo(20, 0);
  });
});

// P0-43: the fr-track floor pass and the auto-track give-back pass
// skipped every non-replaced item with overflow != visible, applying
// the scroll container's zero automatic minimum (CSS Grid 6.6) to its
// specified sizes as well. A scroll container with a definite width
// or min-width still sizes its box to that width, so the track floor
// is that size (plus padding); only the content-based minimum of an
// auto-width, no-min-width scroll container is 0.
describe("P0-43: scroll containers floor fr/auto tracks at their specified sizes", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function box(html: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const uri = (attrs: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="100%" height="100%" fill="#69c"/></svg>`)}`;
  // The first item forces track 1 to 304 (300 + 2x2 margins); the
  // target img sits in the min-content track 3, so its x reads out
  // track 2's resolved size: x = 304 + 16 + track2 + 16.
  const frGrid = (item2: string) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr min-content;gap:16px;width:80px">` +
    `<div style="margin:2px"><div style="width:300px;height:10px"></div></div>${item2}` +
    `<img id="w" style="width:fit-content" src="${uri('width="20" height="30" viewBox="0 0 20 30"')}"></div>`;

  it("a definite-width scroll container floors its fr track", async () => {
    const b = await box(frGrid(`<div style="width:20px;padding:2px;overflow:hidden">mm</div>`));
    expect(b.x).toBeCloseTo(360, 0);
  });

  it("an overflow:scroll container floors the same way", async () => {
    const b = await box(frGrid(`<div style="width:20px;padding:2px;overflow:scroll">mm</div>`));
    expect(b.x).toBeCloseTo(360, 0);
  });

  it("a min-width scroll container floors its fr track at the min-width", async () => {
    const b = await box(frGrid(`<div style="min-width:44px;overflow:hidden">mm</div>`));
    expect(b.x).toBeCloseTo(380, 0);
  });

  it("an auto-width scroll container contributes no floor", async () => {
    const b = await box(frGrid(`<div style="overflow:hidden"><img src="${uri('width="80" height="90" viewBox="0 0 80 90"')}" style="width:60px"></div>`));
    expect(b.x).toBeCloseTo(336, 0);
  });

  it("an auto track gives back only down to a scroll container's definite width", async () => {
    const b = await box(
      `<div style="display:grid;grid-template-columns:auto auto;width:80px"><div style="width:90px;overflow:hidden">mm</div><div id="w" style="width:10px"></div></div>`);
    expect(b.x).toBeCloseTo(90, 0);
  });

  it("an auto track gives an auto-width scroll container's space back fully", async () => {
    const b = await box(
      `<div style="display:grid;grid-template-columns:auto auto;width:80px"><div style="overflow:hidden"><img src="${uri('width="200" height="10" viewBox="0 0 200 10"')}"></div><div id="w" style="width:10px"></div></div>`);
    expect(b.x).toBeCloseTo(70, 0);
  });
});

// P0-44: under a min-content constraint, a fit-content(limit) track
// contributed max(min-content, min(max-content, limit)) -- the
// max-content side of the formula -- so a grid being measured for its
// min-content size came out too wide whenever an item's max-content
// exceeded the limit (fuzz replaced seed 6: the grid's min-content
// was 240 instead of 200 and it could not shrink as a flex item).
// The min-content contribution is the track's floor instead: an
// explicit min-width replaces the content contribution, and a
// measured min-content is not capped by the limit.
describe("P0-44: fit-content tracks contribute their floor under a min-content constraint", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function box(html: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const uri = (attrs: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="100%" height="100%" fill="#69c"/></svg>`)}`;
  // Grid min-content = fit-content track + 0 (fr floors) + 60 + 0.
  const gridMin = (item: string) =>
    `<div style="width:min-content"><div id="w" style="display:grid;grid-template-columns:fit-content(80px) 2fr 60px 2fr">${item}</div></div>`;
  const blk = (minW: number | null, kidW: number) =>
    `<div style="${minW === null ? "" : `min-width:${minW}px;`}padding:4px"><div style="width:${kidW}px;height:10px"></div></div>`;

  it("a definite min-width replaces the content contribution", async () => {
    expect((await box(gridMin(blk(40, 200)))).w).toBeCloseTo(108, 0);
  });

  it("a larger min-width raises the contribution", async () => {
    expect((await box(gridMin(blk(100, 200)))).w).toBeCloseTo(168, 0);
  });

  it("a min-width above the content size still rules", async () => {
    expect((await box(gridMin(blk(300, 200)))).w).toBeCloseTo(368, 0);
  });

  it("a definite min-width rules even when the content is narrower than the limit", async () => {
    expect((await box(gridMin(blk(40, 50)))).w).toBeCloseTo(108, 0);
  });

  it("without a min-width the full min-content counts, uncapped by the limit", async () => {
    expect((await box(gridMin(blk(null, 200)))).w).toBeCloseTo(268, 0);
  });

  it("a flex container item follows the same rule", async () => {
    const item = `<div style="display:flex;flex-wrap:wrap;gap:8px;min-width:40px;padding:4px"><img src="${uri('width="120" height="50" viewBox="0 0 120 50"')}"></div>`;
    expect((await box(gridMin(item))).w).toBeCloseTo(108, 0);
  });

  it("the max-content side keeps the clamped formula", async () => {
    const html = `<div style="width:max-content"><div id="w" style="display:grid;grid-template-columns:fit-content(80px) 2fr 60px 2fr">${blk(40, 200)}</div></div>`;
    expect((await box(html)).w).toBeCloseTo(140, 0);
  });
});

// P0-45: a block's min-width clamp was applied to its measured width
// only AFTER its content had been laid out, so a measure (a grid row
// sizing to the item, say) kept the height of the unclamped layout:
// width:10% + min-width:40px in a 50px track laid its percentage-sized
// child out at the 5px width and measured 92.1 tall where the final
// layout at the clamped 40px is 105 (fuzz replaced seed 6's row came
// out 12.9px short). The clamp now bounds the measure itself, for
// length-typed and percentage-typed resolved widths alike.
describe("P0-45: min-width bounds a block measure before its content is laid out", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function box(html: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const uri = (attrs: string) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="100%" height="100%" fill="#69c"/></svg>`)}`;
  const kids = `<img src="${uri('width="80" height="90" viewBox="0 0 80 90"')}"><svg viewBox="0 0 40 60" style="width:25%"><rect width="40" height="60" fill="#69c"/></svg>`;
  const grid = (item: string) =>
    `<div id="w" style="display:grid;grid-template-columns:50px;width:200px">${item}</div>`;

  it("a percentage width below min-width measures its content at the clamped width", async () => {
    // img line 90 + svg at 25% of 40 = 10 wide -> 15 tall + margins 16
    const b = await box(grid(`<div style="width:10%;min-width:40px;margin:8px">${kids}</div>`));
    expect(b.h).toBeCloseTo(121, 0);
  });

  it("a length width below min-width does the same", async () => {
    const b = await box(grid(`<div style="width:5px;min-width:40px;margin:8px">${kids}</div>`));
    expect(b.h).toBeCloseTo(121, 0);
  });

  it("without min-width the percentage width stands as resolved", async () => {
    // svg at 25% of 5 = 1.25 wide -> 1.9 tall: 90 + 1.9 + margins 16
    const b = await box(grid(`<div style="width:10%;margin:8px">${kids}</div>`));
    expect(b.h).toBeCloseTo(107.9, 0);
  });

  it("content without percentage sizes is unaffected by the clamp", async () => {
    const b = await box(
      grid(`<div style="width:10%;min-width:40px;margin:8px"><img src="${uri('width="80" height="90" viewBox="0 0 80 90"')}"></div>`));
    expect(b.h).toBeCloseTo(106, 0);
  });
});

// P0-46: the automatic minimum size of a flex item with a percentage
// width clamped that width by the item's MIN-content size, so a
// replaced item measured at ~0 and shrank freely: an image with
// width:30% and a 300px intrinsic width in a 496px container shrank
// to 113.8 instead of holding its specified 148.8 (fuzz replaced seed
// 35's shrink distribution was off for every item in the row). Per
// Flexbox 4.5 the content size suggestion is the MAX-content size, so
// the floor is min(specified percentage, max-content): width:30%
// floors at min(148.8, 300), width:90% at min(446.4, 300) = 300.
describe("P0-46: a percentage-width flex item floors at min(specified, max-content)", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function boxes(html: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const uri = (w: number, h: number) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#69c"/></svg>`)}`;
  const wrap = (kids: string) =>
    `<div style="width:500px"><div style="display:flex;padding:2px">${kids}</div></div>`;
  const div = (id: string, w: string) => `<div id="${id}" style="width:${w};height:20px"></div>`;
  const w = (out: Box[], id: string) => out.find((x) => x.i === id)!.w;

  it("an image at width:30% does not shrink below its specified size", async () => {
    const out = await boxes(wrap(`<img id="b" src="${uri(300, 10)}" style="width:30%">${div("c", "500px")}`));
    expect(w(out, "b")).toBeCloseTo(148.8, 0);
    expect(w(out, "c")).toBeCloseTo(347.2, 0);
  });

  it("an image at width:90% floors at its intrinsic width instead", async () => {
    const out = await boxes(wrap(`${div("a", "120px")}<img id="b" src="${uri(300, 10)}" style="width:90%">${div("c", "500px")}`));
    expect(w(out, "b")).toBeCloseTo(300, 0);
    expect(w(out, "a")).toBeCloseTo(37.9, 0);
    expect(w(out, "c")).toBeCloseTo(158.1, 0);
  });

  it("two percentage images both hold, the length item absorbs the shrink", async () => {
    const out = await boxes(wrap(`<img id="a" src="${uri(300, 10)}" style="width:30%"><img id="b" src="${uri(300, 10)}" style="width:30%">${div("c", "500px")}`));
    expect(w(out, "a")).toBeCloseTo(148.8, 0);
    expect(w(out, "b")).toBeCloseTo(148.8, 0);
    expect(w(out, "c")).toBeCloseTo(198.4, 0);
  });

  it("a larger flex-shrink factor does not move the floor", async () => {
    const out = await boxes(wrap(`${div("a", "120px")}<img id="b" src="${uri(300, 10)}" style="width:30%;flex-shrink:2">${div("c", "500px")}`));
    expect(w(out, "b")).toBeCloseTo(148.8, 0);
  });

  it("a percentage-width block item still shrinks to its content floor", async () => {
    const out = await boxes(wrap(`${div("a", "120px")}${div("b", "30%")}${div("c", "500px")}`));
    expect(w(out, "b")).toBeCloseTo(96, 0);
  });

  it("percentage text columns shrink proportionally with their siblings", async () => {
    // The floor applies to replaced items only: a text block's content
    // suggestion is its min-content (its longest word), so 33.333%
    // columns share the shrink with a fixed sibling instead of
    // crushing it to zero (rust-lang.org's three-column row).
    const txt = "Rust is a systems programming language that runs blazingly fast, prevents segfaults, and guarantees thread safety for everyone building reliable software.";
    const col = (id: string) => `<div id="${id}" style="width:33.333%;font-size:16px;line-height:20px"><p>${txt}</p></div>`;
    const out = await boxes(
      `<div style="display:flex;width:1000px">${col("a")}${col("b")}${col("c")}<div id="d" style="width:200px;height:10px"></div></div>`);
    expect(w(out, "a")).toBeCloseTo(277.8, 0);
    expect(w(out, "b")).toBeCloseTo(277.8, 0);
    expect(w(out, "d")).toBeCloseTo(166.7, 0);
  });
});

// P0-47: the grid row measure pass measured every item at the full grid
// area width, but a non-stretched item is placed at its fit-content
// width -- so the row took the height of the wide layout: a centered
// shrink-to-fit grid whose 1fr track only opens at the area width
// reported 116.8 for a row that renders 16 tall at its used 32px
// (fuzz replaced seed 14). The measure pass now resolves the used
// width the same way place_grid_items does (content measure, clamped
// by max(min-content, area) for auto/fit-content widths) and measures
// the height there.
describe("P0-47: a grid row measures a non-stretched item at its used width", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function box(html: string): Promise<Box> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out.find((x) => x.i === "w")!;
  }
  const S = (vb: string) => `<svg viewBox="${vb}"><rect width="100" height="60" fill="#69c"/></svg>`;
  const inner = (extra = "") =>
    `<div id="w" style="display:grid;grid-template-columns:min-content min-content 1fr;gap:8px;padding:8px;${extra}">${S("0 0 100 60")}${S("0 0 100 20")}${S("0 0 100 60")}</div>`;

  it("a centered shrink-to-fit item contributes its fit-width height", async () => {
    const b = await box(`<div style="display:grid;grid-template-columns:1fr;justify-items:center;width:200px">${inner()}</div>`);
    expect(b.w).toBeCloseTo(32, 0);
    expect(b.h).toBeCloseTo(16, 0);
  });

  it("a start-aligned item does the same", async () => {
    const b = await box(`<div style="display:grid;grid-template-columns:1fr;justify-items:start;width:200px">${inner()}</div>`);
    expect(b.h).toBeCloseTo(16, 0);
  });

  it("at a definite width the wide height stands", async () => {
    const b = await box(inner("width:200px"));
    expect(b.w).toBeCloseTo(216, 0);
    expect(b.h).toBeCloseTo(126.4, 0);
  });

  it("a stretched item still measures at the area width", async () => {
    const b = await box(`<div style="display:grid;grid-template-columns:1fr;justify-items:stretch;width:200px">${inner()}</div>`);
    expect(b.h).toBeCloseTo(116.8, 0);
  });
});

// P0-48: under a min-content constraint, a grid item with a definite
// min-width contributed its full content size to an auto track, so the
// grid's own min-content came out at its max-content and the grid
// could not shrink as a flex item (fuzz replaced seed 25: the grid
// stayed 250 wide where Chrome shrinks it to 52). The fit-content
// floor already replaced the contribution with the min-width; an auto
// track under a min-content constraint now does the same.
describe("P0-48: a definite min-width replaces an auto track's min-content contribution", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function boxes(html: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const uri = (w: number, h: number) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#69c"/></svg>`)}`;
  const gridIn = (mode: string, item: string) =>
    `<div style="width:${mode}"><div id="g" style="display:grid;grid-template-columns:auto;padding:4px">${item}</div></div>`;
  const w = (out: Box[], id: string) => out.find((x) => x.i === id)!.w;

  it("a block with min-width:40px around wide content contributes 40", async () => {
    const out = await boxes(gridIn("min-content", `<div id="f" style="min-width:40px;padding:2px;margin:2px"><div style="width:200px;height:10px"></div></div>`));
    expect(w(out, "g")).toBeCloseTo(56, 0);
    expect(w(out, "f")).toBeCloseTo(44, 0);
  });

  it("without min-width the content contribution stands", async () => {
    const out = await boxes(gridIn("min-content", `<div id="f" style="padding:2px;margin:2px"><div style="width:200px;height:10px"></div></div>`));
    expect(w(out, "g")).toBeCloseTo(216, 0);
  });

  it("a max-content measure is unaffected by the min-width", async () => {
    const out = await boxes(gridIn("max-content", `<div id="f" style="min-width:40px;padding:2px;margin:2px"><div style="width:200px;height:10px"></div></div>`));
    expect(w(out, "g")).toBeCloseTo(216, 0);
  });

  it("a definite width counts in full, above the min-width", async () => {
    const out = await boxes(gridIn("min-content", `<div id="f" style="width:200px;min-width:100px;margin:2px"></div>`));
    expect(w(out, "g")).toBeCloseTo(212, 0);
    expect(w(out, "f")).toBeCloseTo(200, 0);
  });

  it("a flex item with a definite min-width contributes it too", async () => {
    const out = await boxes(gridIn("min-content", `<div id="f" style="display:flex;min-width:40px;padding:2px;margin:2px"><img src="${uri(80, 30)}" style="width:120px"></div>`));
    expect(w(out, "g")).toBeCloseTo(56, 0);
  });
});

// P0-49: content distribution fallbacks. (a) justify-content space-around /
// space-evenly with negative free space fell back to flex-start even for
// reverse directions, packing an oversized item at the main-start edge;
// Chrome packs at the container's start edge (the line overflows only
// toward the end side), which for row-reverse is the physical left
// (fuzz replaced seed 41: the whole subtree sat 114px too far right,
// exactly the negative free space). (b) align-content: space-evenly was
// never distributed at all, and space-around with negative free cross
// space fell back to center instead of cross-start packing.
describe("P0-49: space distribution fallbacks for justify-content and align-content", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function boxes(html: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (out: Box[], id: string) => out.find((x) => x.i === id)!;
  const flex = (dir: string, jc: string, items: string, extra = "") =>
    `<div style="display:flex;flex-direction:${dir};justify-content:${jc};gap:4px;width:60px;${extra}">${items}</div>`;
  const item = (id: string, w: number) => `<div id="${id}" style="width:${w}px;height:20px;flex:none"></div>`;

  it("row-reverse space-around packs an oversized item at the left edge", async () => {
    const out = await boxes(flex("row-reverse", "space-around", item("a", 150)));
    expect(at(out, "a").x).toBeCloseTo(0, 0);
  });

  it("row-reverse space-evenly packs oversized items at the left edge", async () => {
    const out = await boxes(flex("row-reverse", "space-evenly", item("a", 150) + item("b", 30)));
    expect(at(out, "a").x).toBeCloseTo(34, 0);
    expect(at(out, "b").x).toBeCloseTo(0, 0);
  });

  it("row-reverse space-between keeps the flex-start fallback", async () => {
    const out = await boxes(flex("row-reverse", "space-between", item("a", 150)));
    expect(at(out, "a").x).toBeCloseTo(-90, 0);
  });

  it("row space-around packs an oversized item at the left edge", async () => {
    const out = await boxes(flex("row", "space-around", item("a", 150)));
    expect(at(out, "a").x).toBeCloseTo(0, 0);
  });

  it("column-reverse space-around packs an oversized item at the top", async () => {
    const out = await boxes(
      `<div style="display:flex;flex-direction:column-reverse;justify-content:space-around;width:60px;height:60px"><div id="a" style="height:150px;width:20px;flex:none"></div></div>`,
    );
    expect(at(out, "a").y).toBeCloseTo(0, 0);
  });

  const wrap = (ac: string, w: number, h: number) =>
    `<div style="display:flex;flex-wrap:wrap;align-content:${ac};width:${w}px;height:${h}px"><div id="a" style="width:90px;height:50px;flex:none"></div><div id="b" style="width:90px;height:50px;flex:none"></div></div>`;

  it("align-content space-evenly distributes the lines", async () => {
    const out = await boxes(wrap("space-evenly", 100, 200));
    expect(at(out, "a").y).toBeCloseTo(33.33, 0);
    expect(at(out, "b").y).toBeCloseTo(116.67, 0);
  });

  it("align-content space-evenly with negative free space packs at cross-start", async () => {
    const out = await boxes(wrap("space-evenly", 100, 60));
    expect(at(out, "a").y).toBeCloseTo(0, 0);
    expect(at(out, "b").y).toBeCloseTo(50, 0);
  });

  it("align-content space-around with negative free space packs at cross-start", async () => {
    const out = await boxes(wrap("space-around", 100, 60));
    expect(at(out, "a").y).toBeCloseTo(0, 0);
    expect(at(out, "b").y).toBeCloseTo(50, 0);
  });

  it("align-content space-around distributes the lines", async () => {
    const out = await boxes(wrap("space-around", 100, 200));
    expect(at(out, "a").y).toBeCloseTo(25, 0);
    expect(at(out, "b").y).toBeCloseTo(125, 0);
  });
});

// P0-50: the grid row measure pass measured a non-stretched item in
// content mode and kept that height whenever the content width fit the
// grid area. The content-mode measure resolves the item's own layout
// intrinsically, which can differ from the placed layout at the same
// width: a nested grid's tracks open up intrinsically (a ratio-only
// svg inside measures 300 wide / 60 tall) where the placed layout
// resolves them against the definite used width (0 wide, the 30px row
// floor) -- the row came out 60 where Chrome gets 30 (fuzz replaced
// seed 4). The pass now always finishes with an exact-width measure at
// the used width, and a width:min-content item is measured at its
// min-content width instead of its max-content width.
describe("P0-50: grid row measure takes the height at the used width", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function boxes(html: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (out: Box[], id: string) => out.find((x) => x.i === id)!;
  const SVG = `<svg viewBox="0 0 100 20" style="width:100%"><rect width="100" height="20" fill="#69c"/></svg>`;
  const innerG = `<div id="g" style="display:grid;grid-template-columns:1fr minmax(40px,1fr);grid-auto-rows:minmax(30px,auto);align-items:center">${SVG}</div>`;
  const outer = (decl: string, item: string, cols = "min-content 2fr") =>
    `<div style="display:grid;grid-template-columns:${cols};margin:8px;${decl}">${item}</div>`;

  it("a centered nested grid takes its placed height, not its intrinsic height", async () => {
    const out = await boxes(outer("justify-items:center", innerG));
    expect(at(out, "g").w).toBeCloseTo(40, 0);
    expect(at(out, "g").h).toBeCloseTo(30, 0);
  });

  it("the same holds for justify-items:start", async () => {
    const out = await boxes(outer("justify-items:start", innerG));
    expect(at(out, "g").h).toBeCloseTo(30, 0);
  });

  it("a stretched nested grid is unaffected", async () => {
    const out = await boxes(outer("", innerG));
    expect(at(out, "g").h).toBeCloseTo(30, 0);
  });

  it("a width:min-content flex item is measured at its min-content width", async () => {
    const item = `<div id="g" style="display:flex;flex-wrap:wrap;width:min-content"><div style="width:80px;height:20px;flex:none"></div><div style="width:80px;height:20px;flex:none"></div></div>`;
    const out = await boxes(outer("justify-items:start", item, "200px"));
    expect(at(out, "g").w).toBeCloseTo(80, 0);
    expect(at(out, "g").h).toBeCloseTo(40, 0);
  });

  it("a width:max-content flex item keeps its max-content height", async () => {
    const item = `<div id="g" style="display:flex;flex-wrap:wrap;width:max-content"><div style="width:80px;height:20px;flex:none"></div><div style="width:80px;height:20px;flex:none"></div></div>`;
    const out = await boxes(outer("justify-items:start", item, "200px"));
    expect(at(out, "g").w).toBeCloseTo(160, 0);
    expect(at(out, "g").h).toBeCloseTo(20, 0);
  });
});

// P0-51: a ratio-only replaced item with a percentage width measured as a
// row flex item took the "definite main size" fill even when the flex
// container itself was being sized from its content: render_image's
// flex_main_definite read the space on offer as a definite main size, so
// a width:10% svg (viewBox only) in a fit-content row flex contributed
// the full available width (1000) and the container capped out there
// (fuzz replaced seed 37: Chrome 506, ours 1000+). A percentage width is
// cyclic while the container's own inline size is an intrinsic keyword
// or itself cyclic, so the container is indefinite then and the item
// contributes the 300px default object size, as in Chrome. A container
// with a definite inline size keeps the fill (a ratio-only item in a
// 500px row flex is 500 wide in Chrome too).
describe("P0-51: ratio-only percentage-width flex item in a shrink-to-fit row flex", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function boxes(html: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (out: Box[], id: string) => out.find((x) => x.i === id)!;
  const C = (extra: string) =>
    `<svg id="c" viewBox="0 0 40 20" style="${extra}"><rect width="40" height="20" fill="#69c"/></svg>`;
  const A = `<div id="a" style="width:10%"><div style="width:150px;height:10px"></div><div style="width:120px;height:10px"></div></div>`;
  const B = `<div id="b" style="padding:8px"><div style="width:40px;height:10px"></div></div>`;

  it("a lone percentage-width ratio-only item contributes the default object width", async () => {
    const out = await boxes(`<div id="r" style="display:flex;width:fit-content">${C("width:10%")}</div>`);
    expect(at(out, "r").w).toBeCloseTo(300, 0);
    expect(at(out, "c").w).toBeCloseTo(30, 0);
    expect(at(out, "c").h).toBeCloseTo(15, 0);
  });

  it("the seed shape: row-reverse wrap fit-content sums the 300px contribution", async () => {
    const out = await boxes(
      `<div id="r" style="display:flex;flex-direction:row-reverse;flex-wrap:wrap;width:fit-content">${A}${B}${C("width:10%")}</div>`,
    );
    expect(at(out, "r").w).toBeCloseTo(506, 0);
    expect(at(out, "c").w).toBeCloseTo(50.6, 0);
  });

  it("a max-content container takes the same contribution", async () => {
    const out = await boxes(`<div id="r" style="display:flex;width:max-content">${A}${B}${C("width:10%")}</div>`);
    expect(at(out, "r").w).toBeCloseTo(506, 0);
  });

  it("a definite-width container keeps the fill for an auto-width item", async () => {
    const out = await boxes(`<div id="r" style="display:flex;width:500px">${C("")}</div>`);
    expect(at(out, "c").w).toBeCloseTo(500, 0);
    expect(at(out, "c").h).toBeCloseTo(250, 0);
  });

  it("an auto-width ratio-only item still contributes 0", async () => {
    const out = await boxes(
      `<div id="r" style="display:flex;width:fit-content">${C("")}<div style="width:50px;height:10px"></div></div>`,
    );
    expect(at(out, "r").w).toBeCloseTo(50, 0);
    expect(at(out, "c").w).toBeCloseTo(25, 0);
  });

  it("a min-content container still counts the percentage item as 0", async () => {
    const out = await boxes(
      `<div id="r" style="display:flex;width:min-content">${C("width:10%")}<div style="width:50px;height:10px"></div></div>`,
    );
    expect(at(out, "r").w).toBeCloseTo(50, 0);
  });

  it("a column container is unaffected (cross axis was already indefinite)", async () => {
    const out = await boxes(
      `<div id="r" style="display:flex;flex-direction:column;width:fit-content">${C("width:10%")}</div>`,
    );
    expect(at(out, "r").w).toBeCloseTo(300, 0);
    expect(at(out, "c").w).toBeCloseTo(30, 0);
  });
});

// P0-52: the intrinsic column pass of a grid measured under a min-content
// constraint handed the grid's own min-content bit down to the items of a
// max-content track. A max-content track takes its items' MAX-content
// contribution regardless of the constraint on the grid itself (CSS Grid:
// the min-content contribution of a max-content track is its max-content
// size), so a percentage-width image in such a track contributed 0 (the
// min-content treatment of a cyclic percentage) instead of its intrinsic
// 40px. The grid's min-content came out one contribution too narrow, and
// a shrink-to-fit flex ancestor sized from it squeezed the grid and
// shifted every centered sibling (fuzz replaced seed 8). Min-content,
// auto and minmax tracks keep the inherited constraint.
describe("P0-52: max-content tracks contribute max-content under a min-content constraint", () => {
  type Box = { p: string; t: string; i?: string; x: number; y: number; w: number; h: number };

  async function boxes(html: string): Promise<Box[]> {
    let out: Box[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${html}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (b) => {
        out = b as Box[];
      },
    });
    return out;
  }
  const at = (out: Box[], id: string) => out.find((x) => x.i === id)!;
  const svgfile = (w: number, h: number) =>
    `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'%3E%3Crect width='${w}' height='${h}' fill='%2369c'/%3E%3C/svg%3E`;
  const I1 = `<img src="${svgfile(80, 50)}">`;
  const I2 = `<img style="width:100%" src="${svgfile(40, 30)}">`;
  const I3 = `<img style="width:60px" src="${svgfile(300, 90)}">`;
  const I4 = `<svg viewBox="0 0 100 60"><rect width="100" height="60" fill="#69c"/></svg>`;
  const G = (cols: string, wmode: string) =>
    `<div id="g" style="display:grid;grid-template-columns:${cols};gap:4px;height:200px;padding:2px;width:${wmode}">${I1}${I2}${I3}${I4}</div>`;

  it("a min-content grid with max-content tracks keeps the percentage image's intrinsic width", async () => {
    const out = await boxes(G("max-content max-content", "min-content"));
    expect(at(out, "g").w).toBeCloseTo(128, 0);
  });

  it("the seed shape: the grid as a flex item sizes its fit-content flex parent from 128", async () => {
    const el =
      `<div style="width:234px"><div id="f" style="display:flex;justify-content:flex-end;align-items:center;width:fit-content">` +
      `<div style="width:200px;height:90px;flex:none"></div>` +
      G("max-content max-content", "auto").replace('id="g" style="', 'id="g" style="margin:4px;') +
      `</div></div>`;
    const out = await boxes(el);
    expect(at(out, "g").w).toBeCloseTo(128, 0);
    expect(at(out, "f").w).toBeCloseTo(336, 0);
  });

  it("min-content tracks still take the items' minima", async () => {
    const out = await boxes(G("min-content min-content", "min-content"));
    expect(at(out, "g").w).toBeCloseTo(88, 0);
  });

  it("an auto track next to a max-content track still takes the minimum", async () => {
    const out = await boxes(G("max-content auto", "min-content"));
    expect(at(out, "g").w).toBeCloseTo(88, 0);
  });

  it("a minmax(0, max-content) track is unchanged", async () => {
    const out = await boxes(G("max-content minmax(0px, max-content)", "min-content"));
    expect(at(out, "g").w).toBeCloseTo(88, 0);
  });

  it("without the constraint the max-content size is the same", async () => {
    const out = await boxes(G("max-content max-content", "max-content"));
    expect(at(out, "g").w).toBeCloseTo(128, 0);
  });
});

describe("P0-53 scrollbar-gutter stable both-edges insets the scrollport on both sides", () => {
  const gutterPage = (css: string, body: string) => ({
    value: `<!doctype html><html><head><style>${css}html,body{margin:0}</style></head><body>${body}</body></html>`,
    width: 1000,
    format: "png" as const,
  });
  const box = (layout: any[], id: string) => layout.find((b: any) => b.i === id);

  it("in-flow content starts one gutter in and is two gutters narrower", async () => {
    let layout: any[] = [];
    await render({
      ...gutterPage("html{scrollbar-gutter:stable both-edges}", `<div id="c" style="height:10px"></div>`),
      onLayout: (l: any) => (layout = l),
    } as never);
    const c = box(layout, "c");
    expect(Math.round(c.x)).toBe(15);
    expect(Math.round(c.w)).toBe(970);
  });

  it("stable alone keeps the start edge at 0 and narrows by one gutter", async () => {
    let layout: any[] = [];
    await render({
      ...gutterPage("html{scrollbar-gutter:stable}", `<div id="c" style="height:10px"></div>`),
      onLayout: (l: any) => (layout = l),
    } as never);
    const c = box(layout, "c");
    expect(Math.round(c.x)).toBe(0);
    expect(Math.round(c.w)).toBe(985);
  });

  it("a fixed box at left:0 sits inside the start gutter", async () => {
    let layout: any[] = [];
    await render({
      ...gutterPage(
        "html{scrollbar-gutter:stable both-edges}",
        `<div style="height:50px"></div><div id="c" style="position:fixed;left:0;top:0;width:100px;height:10px"></div>`,
      ),
      onLayout: (l: any) => (layout = l),
    } as never);
    const c = box(layout, "c");
    expect(Math.round(c.x)).toBe(15);
    expect(Math.round(c.w)).toBe(100);
  });

  it("a fixed box at right:0 ends one gutter before the page edge", async () => {
    let layout: any[] = [];
    await render({
      ...gutterPage(
        "html{scrollbar-gutter:stable both-edges}",
        `<div style="height:50px"></div><div id="c" style="position:fixed;right:0;top:0;width:100px;height:10px"></div>`,
      ),
      onLayout: (l: any) => (layout = l),
    } as never);
    const c = box(layout, "c");
    expect(Math.round(c.x)).toBe(885);
  });

  it("a fixed box stretched between both insets starts at the start gutter", async () => {
    let layout: any[] = [];
    await render({
      ...gutterPage(
        "html{scrollbar-gutter:stable both-edges}",
        `<div style="height:50px"></div><div id="c" style="position:fixed;left:0;right:0;top:0;height:10px"></div>`,
      ),
      onLayout: (l: any) => (layout = l),
    } as never);
    const c = box(layout, "c");
    expect(Math.round(c.x)).toBe(15);
    expect(Math.round(c.w)).toBe(970);
  });
});

describe("P0-54 a line-height on the select does not change the control's geometry", () => {
  const page = (body: string) => ({
    value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${body}</body></html>`,
    width: 1000,
    format: "png" as const,
  });
  const box = (layout: any[], id: string) => layout.find((b: any) => b.i === id);
  const render1 = async (body: string) => {
    let layout: any[] = [];
    await render({ ...page(body), onLayout: (l: any) => (layout = l) } as never);
    return box(layout, "c");
  };
  const OPTS = `<option>Alpha</option><option>Beta</option><option>Gamma</option>`;

  it("dropdown with line-height:30px keeps the font-driven height", async () => {
    const c = await render1(`<select id="c" style="line-height:30px">${OPTS}</select>`);
    expect(Math.round(c.h)).toBe(19);
  });

  it("dropdown with line-height:2 keeps the font-driven height", async () => {
    const c = await render1(`<select id="c" style="line-height:2">${OPTS}</select>`);
    expect(Math.round(c.h)).toBe(19);
  });

  it("list box with an author line-height keeps its pinned height", async () => {
    const c = await render1(`<select id="c" size="3" style="line-height:30px">${OPTS}</select>`);
    expect(Math.round(c.h)).toBe(53);
  });

  it("list box with only an author line-height in the style attribute keeps its pinned height", async () => {
    const c = await render1(`<select id="c" size="3" style="line-height:1.3em">${OPTS}</select>`);
    expect(Math.round(c.h)).toBe(53);
  });
});

describe("P0-55 list box rows are block rows (selection painting) with unchanged geometry", () => {
  const page = (body: string) => ({
    value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body>${body}</body></html>`,
    width: 1000,
    format: "png" as const,
  });
  const render1 = async (body: string) => {
    let layout: any[] = [];
    await render({ ...page(body), onLayout: (l: any) => (layout = l) } as never);
    return layout.find((b: any) => b.i === "c");
  };

  it("a selected middle row keeps the pinned height", async () => {
    const c = await render1(
      `<select id="c" size="3"><option>Alpha</option><option selected>Beta</option><option>Gamma</option></select>`,
    );
    expect(Math.round(c.h)).toBe(53);
  });

  it("an empty option still occupies its row", async () => {
    const c = await render1(`<select id="c" size="2"><option>Alpha</option><option></option></select>`);
    expect(Math.round(c.h)).toBe(36);
  });

  it("optgroup labels and a selected option keep the pinned height", async () => {
    const c = await render1(
      `<select id="c" size="4"><optgroup label="Group"><option>Alpha</option><option selected>Beta</option></optgroup><option>Gamma</option></select>`,
    );
    expect(Math.round(c.h)).toBe(70);
  });
});

describe("P0-56 flexible grid rows resolve against the container, floored by content", () => {
  const img621 = `<img src="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='375' height='621'></svg>`,
  )}">`;
  const render1 = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png" as const,
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const grid = (rows: string, inner: string, h = "height:448px") =>
    render1(`<div id="g" style="display:grid;width:375px;${h};grid-template-rows:${rows}"><div id="i">${inner}</div></div>`);
  const hOf = (layout: any[], id: string) => layout.find((b: any) => b.i === id)!.h;

  it("minmax(0, 1fr) in a definite-height grid takes the container height, not the content", async () => {
    expect(hOf(await grid("minmax(0,1fr)", img621), "i")).toBeCloseTo(448, 0);
  });

  it("a plain 1fr row is floored by its content (automatic minimum)", async () => {
    expect(hOf(await grid("1fr", img621), "i")).toBeCloseTo(621, 0);
  });

  it("minmax(0, 1fr) with an in-flow block child also stays at the container height", async () => {
    expect(hOf(await grid("minmax(0,1fr)", `<div style="height:621px"></div>`), "i")).toBeCloseTo(448, 0);
  });

  it("minmax(0, 1fr) with an indefinite container height sizes to content", async () => {
    expect(hOf(await grid("minmax(0,1fr)", img621, ""), "i")).toBeCloseTo(621, 0);
  });

  it("two minmax(0, 1fr) rows share the container height", async () => {
    const layout = await render1(
      `<div id="g" style="display:grid;width:375px;height:448px;grid-template-rows:minmax(0,1fr) minmax(0,1fr)"><div id="i">${img621}</div><div id="j">${img621}</div></div>`,
    );
    expect(hOf(layout, "i")).toBeCloseTo(224, 0);
    expect(hOf(layout, "j")).toBeCloseTo(224, 0);
  });

  it("minmax(100px, 1fr) floors at its minimum when the share is smaller", async () => {
    const layout = await render1(
      `<div id="g" style="display:grid;width:375px;height:150px;grid-template-rows:minmax(100px,1fr) minmax(100px,1fr)"><div id="i"></div><div id="j"></div></div>`,
    );
    expect(hOf(layout, "i")).toBeCloseTo(100, 0);
    expect(hOf(layout, "j")).toBeCloseTo(100, 0);
  });
});

describe("P0-57 container queries compare against the content box, once", () => {
  const render1 = async (body: string, style: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}${style}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png" as const,
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const box = (layout: any[], id: string) => layout.find((b: any) => b.i === id)!;
  // #h is a column flex; the query switches it to row, dropping its height 102 -> 72.
  const page = (w: number, extra = "") =>
    `<div id="c" style="container-type:inline-size;width:${w}px;padding:8px;${extra}"><div id="h"><div style="width:112px;height:72px"></div><div style="height:30px"></div></div></div>`;
  const minStyle = `#h{display:flex;flex-direction:column}@container (min-width: 448px){#h{flex-direction:row}}`;

  it("a container with 448px of content matches (min-width: 448px)", async () => {
    const layout = await render1(page(448), minStyle);
    expect(box(layout, "h").h).toBeCloseTo(72, 0);
  });

  it("a container with 430px of content does not match", async () => {
    const layout = await render1(page(430), minStyle);
    expect(box(layout, "h").h).toBeCloseTo(102, 0);
  });

  it("borders do not shrink the queried size either", async () => {
    const layout = await render1(page(448, "border:4px solid black"), minStyle);
    expect(box(layout, "h").h).toBeCloseTo(72, 0);
  });

  it("(max-width: 448px) matches at exactly 448 and not above", async () => {
    const maxStyle = `#h{display:flex;flex-direction:column}@container (max-width: 448px){#h{flex-direction:row}}`;
    expect(box(await render1(page(448), maxStyle), "h").h).toBeCloseTo(72, 0);
    expect(box(await render1(page(500), maxStyle), "h").h).toBeCloseTo(102, 0);
  });
});

describe("P0-58 negated container queries (@container not (...))", () => {
  const render1 = async (body: string, style: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}${style}</style></head><body>${body}</body></html>`,
      width: 1400,
      format: "png" as const,
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const shown = (layout: any[], id: string) => layout.some((b: any) => b.i === id);
  const page = (w: number, nameDecl = "") =>
    `<div id="c" style="container-type:inline-size;${nameDecl}width:${w}px"><div style="height:10px"></div><div id="t" style="height:50px"></div></div>`;

  it("not (min-width: 1024px) applies below the threshold", async () => {
    const layout = await render1(page(920), `@container not (min-width: 1024px){#t{display:none}}`);
    expect(shown(layout, "t")).toBe(false);
  });

  it("not (min-width: 1024px) does not apply above the threshold", async () => {
    const layout = await render1(page(1200), `@container not (min-width: 1024px){#t{display:none}}`);
    expect(shown(layout, "t")).toBe(true);
  });

  it("a named container keeps working with a negated condition", async () => {
    const layout = await render1(
      page(920, "container-name: card;"),
      `@container card not (min-width: 1024px){#t{display:none}}`,
    );
    expect(shown(layout, "t")).toBe(false);
  });

  it("a plain query on a named container still matches by name only", async () => {
    const layout = await render1(
      page(920, "container-name: card;"),
      `@container other (min-width: 100px){#t{display:none}}`,
    );
    expect(shown(layout, "t")).toBe(true);
  });
});

describe("P0-59 lh / rlh units resolve against computed line-heights", () => {
  const render1 = async (body: string, style = "") => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}${style}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png" as const,
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const hOf = (layout: any[], id: string) => layout.find((b: any) => b.i === id)!.h;

  it("min-height: 1lh on an empty block takes the line height", async () => {
    const layout = await render1(
      `<div style="font-size:14px;line-height:28px"><span id="t" style="display:block;min-height:1lh"></span></div>`,
    );
    expect(hOf(layout, "t")).toBeCloseTo(28, 0);
  });

  it("height: 2lh scales with the element's line height", async () => {
    const layout = await render1(`<div id="t" style="line-height:30px;height:2lh"></div>`);
    expect(hOf(layout, "t")).toBeCloseTo(60, 0);
  });

  it("lh uses the computed value of a unitless line-height", async () => {
    const layout = await render1(
      `<div id="t" style="font-size:20px;line-height:1.5;min-height:1lh"></div>`,
    );
    expect(hOf(layout, "t")).toBeCloseTo(30, 0);
  });

  it("line-height: 1lh refers to the parent's line height", async () => {
    const layout = await render1(
      `<div style="line-height:40px"><div style="font-size:20px;line-height:1lh"><div id="t" style="min-height:1lh"></div></div></div>`,
    );
    expect(hOf(layout, "t")).toBeCloseTo(40, 0);
  });

  it("height: 1rlh takes the root element's line height", async () => {
    const layout = await render1(`<div id="t" style="height:1rlh"></div>`, `html{line-height:32px}`);
    expect(hOf(layout, "t")).toBeCloseTo(32, 0);
  });
});

describe("P0-60 definite minmax tracks size intrinsically by the query kind", () => {
  const render1 = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png" as const,
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const wOf = (layout: any[], id: string) => layout.find((b: any) => b.i === id)!.w;
  const svg = (w: number, h: number) =>
    `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'%3E%3C/svg%3E`;

  it("a min-content grid keeps a minmax(0,100px) track at its minimum", async () => {
    const layout = await render1(
      `<div id="g" style="display:grid;grid-template-columns:minmax(0px,100px);width:min-content"><img src="${svg(40, 30)}"></div>`,
    );
    expect(wOf(layout, "g")).toBeCloseTo(0, 0);
  });

  it("a max-content grid puts a minmax(0,100px) track at its maximum", async () => {
    const layout = await render1(
      `<div id="g" style="display:grid;grid-template-columns:minmax(0px,100px);width:max-content"><img src="${svg(40, 30)}"></div>`,
    );
    expect(wOf(layout, "g")).toBeCloseTo(100, 0);
  });

  it("a fit-content grid also uses the maximum", async () => {
    const layout = await render1(
      `<div id="g" style="display:grid;grid-template-columns:minmax(0px,100px);width:fit-content"><img src="${svg(200, 30)}"></div>`,
    );
    expect(wOf(layout, "g")).toBeCloseTo(100, 0);
  });

  it("minmax(50px,100px): min-content uses 50, max-content uses 100", async () => {
    const minc = await render1(
      `<div id="g" style="display:grid;grid-template-columns:minmax(50px,100px);width:min-content"><img src="${svg(40, 30)}"></div>`,
    );
    expect(wOf(minc, "g")).toBeCloseTo(50, 0);
    const maxc = await render1(
      `<div id="g" style="display:grid;grid-template-columns:minmax(50px,100px);width:max-content"><img src="${svg(40, 30)}"></div>`,
    );
    expect(wOf(maxc, "g")).toBeCloseTo(100, 0);
  });

  it("seed 8 shape: a min-content grid next to a max-content track stays 88", async () => {
    const layout = await render1(
      `<div id="g" style="display:grid;grid-template-columns:max-content minmax(0px, 100px);gap:4px;height:200px;padding:2px;width:min-content">` +
        `<img src="${svg(80, 50)}"><img style="width:100%" src="${svg(40, 30)}">` +
        `<img style="width:60px" src="${svg(300, 90)}"><svg viewBox="0 0 100 60"><rect width="100" height="60"/></svg></div>`,
    );
    expect(wOf(layout, "g")).toBeCloseTo(88, 0);
  });
});

describe("P0-61 a float after inline content joins or drops below its line", () => {
  const render1 = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png" as const,
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const IMG = `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30' viewBox='0 0 40 30'%3E%3C/svg%3E">`;
  const FL = (id: string) => `<div id="${id}" style="float:left;width:80px;height:60px"></div>`;

  it("a block-level float joining the previous run's line displaces its content", async () => {
    const layout = await render1(
      `<div style="width:120px"><div style="height:10px"></div>${IMG}${FL("fl")}</div>`,
    );
    const img = layout.find((b: any) => b.t === "img")!;
    expect(img.x).toBeCloseTo(80, 0);
    expect(img.y).toBeCloseTo(10, 0);
  });

  it("the second of two runs is displaced, the first is not", async () => {
    const layout = await render1(
      `<div style="width:120px">${IMG}<div style="height:10px"></div>${IMG}${FL("fl")}</div>`,
    );
    const imgs = layout.filter((b: any) => b.t === "img");
    expect(imgs[0].x).toBeCloseTo(0, 0);
    expect(imgs[1].x).toBeCloseTo(80, 0);
  });

  it("a shrink-to-fit container counts a run and its following float side by side", async () => {
    const layout = await render1(
      `<div id="ct" style="float:left;padding:12px"><div style="height:10px"></div>${IMG}${FL("fl")}</div>`,
    );
    const ct = layout.find((b: any) => b.i === "ct")!;
    expect(ct.w).toBeCloseTo(144, 0);
    const img = layout.find((b: any) => b.t === "img")!;
    expect(img.x).toBeCloseTo(92, 0);
  });

  it("a mid-line float that does not fit beside the content drops below the line", async () => {
    const layout = await render1(
      `<div style="width:120px"><div style="display:inline-block;width:30px;height:10px"></div>${IMG}${FL("fl")}</div>`,
    );
    const img = layout.find((b: any) => b.t === "img")!;
    expect(img.x).toBeCloseTo(30, 0);
    const fl = layout.find((b: any) => b.i === "fl")!;
    expect(fl.y).toBeCloseTo(30, 0);
  });
});

describe("P0-62 inflexible item min-content contribution", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const RESET = "";
  it("a flex:0 0 item contributes its flex base size to min-content, not its width", async () => {
    const boxes = await page(
      `${RESET}<div style="display:flex;width:min-content"><div style="width:50px;height:10px"></div><div style="height:24px;margin:12px"></div><div style="height:36px"></div><div style="width:20px;height:40px;flex:0 0 40px"></div></div>`,
    );
    const c = boxes.find((b: any) => b.p === "0.1.0");
    expect(Math.round(c.w)).toBe(114); // 50 + 24 margins + 0 + 40 (basis, not the 20px width)
  });
  it("a growing item floors at that min-content and the shrinkable sibling absorbs the rest", async () => {
    const boxes = await page(
      `${RESET}<div style="display:flex;width:300px;padding:4px"><div style="padding:2px;flex:0 1 auto"><div style="width:90px;height:40px"></div></div><div style="width:50px;height:10px;flex:0 1 100px"></div><div style="display:flex;margin:8px;flex:1"><div style="width:50px;height:10px"></div><div style="height:24px;margin:12px"></div><div style="height:36px"></div><div style="width:20px;height:40px;flex:0 0 40px"></div></div></div>`,
    );
    const grower = boxes.find((b: any) => b.p === "0.1.0.2");
    const shrinker = boxes.find((b: any) => b.p === "0.1.0.1");
    expect(Math.round(grower.w)).toBe(114);
    expect(Math.round(shrinker.w)).toBe(76);
  });
});

describe("P0-63 percentage height under a cyclic flex height", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const INNER = `<div style="display:flex;align-items:flex-end;padding:4px;margin:2px"><div style="padding:2px;flex:0 1 auto"><div style="height:24px;margin:12px"></div><div style="width:90px;height:40px"></div><div style="height:24px"></div></div><div style="display:grid;grid-template-columns:auto max-content minmax(40px,1fr);height:10%;min-width:100px;margin:8px"><div style="min-width:10px;min-height:30px"></div><div style="height:24px"></div><div style="width:90px;height:10px"></div></div></div>`;
  it("a % height stays auto when the column flex ancestor's height is content-derived", async () => {
    const boxes = await page(`<div style="display:flex;flex-direction:column;width:80px;padding:8px">${INNER}</div>`);
    const g = boxes.find((b: any) => b.p === "0.1.0.0.1");
    expect(Math.round(g.h)).toBe(30); // the grid's content height, not 10% of 116
  });
  it("the same % height resolves when the column flex height is definite", async () => {
    const boxes = await page(`<div style="display:flex;flex-direction:column;width:80px;padding:8px;height:300px">${INNER}</div>`);
    const g = boxes.find((b: any) => b.p === "0.1.0.0.1");
    expect(Math.abs(g.h - 11.6)).toBeLessThan(1);
  });
});

describe("P0-64 min-content contribution clamped by a definite flex-basis", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const wrap = (flex: string) =>
    `<div style="display:flex;flex-wrap:wrap;gap:4px;width:600px"><div style="display:flex;padding:8px"><div style="width:50px;height:40px;flex:${flex}"></div></div></div>`;
  it("an inflexible item contributes its basis, not its wider width", async () => {
    const boxes = await page(wrap("0 0 40px"));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0").w)).toBe(56);
  });
  it("a shrinkable item's contribution is clamped by its basis too", async () => {
    const boxes = await page(wrap("0 1 40px"));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0").w)).toBe(56);
  });
  it("a growable item still contributes its width", async () => {
    const boxes = await page(wrap("1 0 40px"));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0").w)).toBe(66);
  });
});

describe("P0-65 percentage height in nested wrapping column flex containers", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const MID = (inner: string) =>
    `<div style="display:flex;flex-direction:column;flex-wrap:wrap;gap:16px">${inner}</div>`;
  const T = `<div style="display:flex;flex-wrap:wrap;height:30%;min-width:100px;margin:4px"><div style="width:90px;height:40px;flex:1"></div><div style="height:12px;margin:8px"></div><div style="width:20px;height:10px;flex:0 0 40px"></div></div>`;
  const SIBS = `<div style="min-width:40px;padding:8px"><div style="height:118px"></div></div><div style="width:20px;height:40px"></div><div style="width:90px;height:10px"></div>`;
  it("a % height stays auto through a %-width wrapping column ancestor, so the container does not wrap", async () => {
    const boxes = await page(
      `<div style="display:flex;flex-direction:column;gap:8px"><div style="height:12px"></div><div style="display:flex;flex-direction:column;flex-wrap:wrap;width:10%">${MID(T + SIBS)}</div></div>`,
    );
    const mid = boxes.find((b: any) => b.p === "0.1.0.1.0");
    const t = boxes.find((b: any) => b.p === "0.1.0.1.0.0");
    expect(Math.round(mid.w)).toBe(108); // one column: widest item + nothing else
    expect(Math.round(t.w)).toBe(100);
    expect(Math.round(t.h)).toBe(40); // content height, not 30% of the content height 280
  });
  it("a % height is content height when every column ancestor is content-sized", async () => {
    const boxes = await page(
      `<div style="display:flex;flex-direction:column"><div style="display:flex;flex-direction:column">${MID(`<div style="height:30%"><div style="width:100px;height:40px"></div></div><div style="width:20px;height:40px"></div>`)}</div></div>`,
    );
    const t = boxes.find((b: any) => b.p === "0.1.0.0.0.0");
    expect(Math.round(t.h)).toBe(40);
  });
  it("the same % height resolves when the outer column height is definite", async () => {
    const boxes = await page(
      `<div style="display:flex;flex-direction:column;height:280px"><div style="display:flex;flex-direction:column">${MID(`<div style="height:30%"><div style="width:100px;height:40px"></div></div><div style="width:20px;height:40px"></div>`)}</div></div>`,
    );
    const t = boxes.find((b: any) => b.p === "0.1.0.0.0.0");
    expect(Math.abs(t.h - 28.8)).toBeLessThan(1); // 30% of the 96px flex base height
  });
});

describe("P0-66 min-content contribution of an item with a definite min-width", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  it("a definite min-width floors the contribution but does not replace the content size", async () => {
    const boxes = await page(
      `<div style="display:inline-flex"><div style="min-width:100px"><div style="width:206px;height:10px"></div></div></div>`,
    );
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(206);
  });
  it("a min-width larger than the content still floors the contribution", async () => {
    const boxes = await page(
      `<div style="display:inline-flex"><div style="min-width:300px"><div style="width:50px;height:10px"></div></div></div>`,
    );
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(300);
  });
  it("a percentage-width item with min-width contributes its content to a shrink-to-fit ancestor", async () => {
    const boxes = await page(
      `<div style="width:20px"><div style="display:inline-flex;padding:12px;margin:4px;overflow:hidden"><div style="width:106px;height:76px"></div><div style="width:16px;height:76px"></div><div style="display:inline-flex;gap:16px;width:30%;min-width:100px;margin:4px;flex:2"><div style="width:50px;height:40px"></div><div style="width:50px;height:10px"></div><div style="width:50px;height:10px"></div><div style="height:36px"></div></div><div style="height:36px"></div></div></div>`,
    );
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0").w)).toBe(352);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0.2").w)).toBe(198);
  });
});

describe("P0-67 min-content contribution of a cyclic-percentage grid item with non-visible overflow", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const grid = (a: string) =>
    `<div style="display:grid;grid-template-columns:auto 1fr 2fr fit-content(80px);gap:16px">${a}<div style="display:grid;grid-template-columns:1fr fit-content(80px) 60px;grid-auto-rows:40px;height:fit-content;margin:8px"><div style="width:20px;height:25px"></div></div></div>`;
  const item = (style: string) => `<div style="${style}"><div style="width:20px;height:25px"></div></div>`;
  it("a cyclic percentage width with overflow:hidden contributes zero at min-content", async () => {
    const boxes = await page(`<div style="width:min-content">${grid(item("width:10%;max-width:150px;overflow:hidden"))}</div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(144);
  });
  it("the same item with visible overflow contributes its content", async () => {
    const boxes = await page(`<div style="width:min-content">${grid(item("width:10%;max-width:150px"))}</div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(164);
  });
  it("at max-content the percentage item contributes its content either way", async () => {
    const boxes = await page(`<div style="width:max-content">${grid(item("width:10%;max-width:150px;overflow:hidden"))}</div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(356);
  });
});

describe("P0-68 percentage sizes of grid items against content-sized tracks", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const G = (a: string) =>
    `<div style="display:grid;grid-template-columns:auto 1fr 2fr fit-content(80px);gap:16px;align-items:stretch;width:144px">${a}<div style="display:grid;grid-template-columns:1fr fit-content(80px) 60px;grid-auto-rows:40px;height:fit-content;margin:8px"><div style="width:20px;height:25px"></div></div></div>`;
  const A = (style: string) => `<div style="${style}"><div style="width:20px;height:25px"></div></div>`;
  it("an overflowing auto track gives back down to zero for a cyclic-percentage scroll item", async () => {
    const boxes = await page(G(A("width:10%;max-width:150px;overflow:hidden")));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0").w)).toBe(0);
  });
  it("with visible overflow the track keeps the content contribution", async () => {
    const boxes = await page(G(A("width:10%;max-width:150px")));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0").w)).toBe(2);
  });
  it("a percentage height behaves as auto while its row is sized, then resolves against the row", async () => {
    const boxes = await page(
      `<div style="display:grid;height:120px;width:300px"><div style="height:10%;padding:4px;margin:12px"><div style="height:142px"></div></div></div>`);
    expect(boxes.find((b: any) => b.p === "0.1.0.0").h).toBeCloseTo(25.4, 0);
  });
  it("height:50% resolves against the content-sized row too", async () => {
    const boxes = await page(
      `<div style="display:grid;height:120px;width:300px"><div style="height:50%;padding:4px;margin:12px"><div style="height:142px"></div></div></div>`);
    expect(boxes.find((b: any) => b.p === "0.1.0.0").h).toBeCloseTo(95, 0);
  });
});

describe("P0-69 track floors: margins of zero-minimum items, definite width vs min-width", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  it("the give-back floor of a scroll item is its margin box, not zero", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:repeat(4,auto);width:20px;padding:4px"><div style="min-width:40px;min-height:30px;height:120px"></div><div style="display:grid;grid-template-columns:minmax(40px,1fr) 60px auto;margin:2px;overflow:hidden"><div style="min-width:10px;min-height:10px"></div></div><div style="width:80px;margin:8px;height:50px"></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.2").x)).toBe(56);
  });
  it("a definite width floors an fr track at the width, not at a smaller min-width", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:1fr 1fr;width:80px"><div style="width:200px;min-width:100px;height:30px"></div><div style="height:36px;margin:4px"></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.1").x)).toBe(204);
  });
  it("with an automatic width the min-width is the floor", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:1fr 1fr;width:80px"><div style="min-width:100px;height:30px"><div style="width:200px;height:10px"></div></div><div style="height:36px;margin:4px"></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.1").x)).toBe(104);
  });
  it("a definite width is clamped by max-width for the floor", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:1fr 1fr;width:80px"><div style="width:200px;max-width:100px;height:30px"></div><div style="height:36px;margin:4px"></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.1").x)).toBe(104);
  });
});
describe("P0-70 percentage height of a grid item resolves against its own content height for contributions", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const grid = (h: string) =>
    `<div style="width:fit-content"><div style="display:grid;grid-template-columns:1fr auto auto;gap:4px;width:25%"><div style="display:flex;flex-direction:column;flex-wrap:wrap;justify-content:space-around;align-items:stretch;height:${h};padding:8px;margin:12px"><div style="height:36px;margin:2px"></div><div style="height:36px;width:10px"></div><div style="width:90px;height:10px;flex:1"></div></div><div style="width:90px;height:10px"></div></div></div>`;
  it("height:30% forms three columns in the contribution measure", async () => {
    const boxes = await page(grid("30%"));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(242);
  });
  it("height:60% forms two columns in the contribution measure", async () => {
    const boxes = await page(grid("60%"));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(232);
  });
  it("a definite height forms the same columns (control)", async () => {
    const boxes = await page(grid("30px"));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(242);
  });
  it("without a height the item contributes its single-column width (control)", async () => {
    const boxes = await page(grid("auto"));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(228);
  });
});
describe("P0-71 min-content contribution of a scroll-container flex item", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  it("an overflow:hidden item contributes its min-content to a shrink-wrapped flex container", async () => {
    const boxes = await page(
      `<div style="width:min-content"><div style="display:flex"><div style="display:flex;overflow:hidden;width:30%"><div style="width:60px;height:10px"></div></div><div style="margin:12px;height:36px"></div></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(84);
  });
  it("a block item with overflow:hidden contributes its min-content too", async () => {
    const boxes = await page(
      `<div style="width:min-content"><div style="display:flex"><div style="overflow:hidden"><div style="width:60px;height:10px"></div></div><div style="margin:12px;height:36px"></div></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0").w)).toBe(84);
  });
  it("the item's automatic minimum stays zero: it still shrinks away in a narrow container", async () => {
    const boxes = await page(
      `<div style="display:flex;width:20px"><div style="overflow:hidden"><div style="width:60px;height:10px"></div></div><div style="margin:12px;height:36px"></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0").w)).toBe(0);
  });
});
describe("P0-72 percentage-width abspos box is re-rendered at its solved width", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 1000,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const root = (inner: string) =>
    `<div style="position:absolute;left:10px;top:0px;width:120px;padding:2px;margin:8px">${inner}</div>`;
  const child = `<div style="width:50%;margin:4px"><div style="min-width:10px;min-height:10px"></div></div>`;
  it("a % child of a min-width-clamped abspos box resolves against the solved width", async () => {
    const boxes = await page(root(
      `<div style="width:20px;height:10px"></div><div style="position:absolute;left:30px;top:0px;width:25%;height:42px;min-width:40px;max-width:250px">${child}</div>`));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.1.0").w)).toBe(20);
  });
  it("the same shape with a fit-content height on the abspos box", async () => {
    const boxes = await page(root(
      `<div style="width:20px;height:10px"></div><div style="position:absolute;left:30px;top:0px;width:25%;height:fit-content;min-width:40px;max-width:250px">${child}</div>`));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.1.0").w)).toBe(20);
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.1").h)).toBe(18);
  });
  it("without the in-flow sibling the result is the same (control)", async () => {
    const boxes = await page(root(
      `<div style="position:absolute;left:30px;top:0px;width:25%;height:42px;min-width:40px;max-width:250px">${child}</div>`));
    expect(Math.round(boxes.find((b: any) => b.p === "0.1.0.0.0").w)).toBe(20);
  });
});

describe("P0-73 floats sharing a line sum into intrinsic width; re-layout drops stale float entries", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const R = `<div style="float:right"><div style="width:90px;height:10px"></div></div>`;
  const Rb = `<div style="float:right;width:25%"><div style="width:90px;height:10px"></div></div>`;
  const L = `<div style="float:left"><div style="min-width:10px;min-height:10px;padding:8px"></div></div>`;
  const B = `<div style="min-width:10px;min-height:10px;padding:8px"></div>`;
  const IB = `<div style="display:inline-block"><div style="height:12px;margin:8px"></div></div>`;
  it("two floats in a shrink-to-fit block size it by their sum, not the widest one", async () => {
    const boxes = await page(`<div id="w" style="width:fit-content">${R}${L}${B}</div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "w").w)).toBe(116);
  });
  it("floats followed by an inline-block share the line in max-content sizing", async () => {
    const boxes = await page(
      `<div id="w" style="width:fit-content"><div style="width:10%;margin:8px">${Rb}${L}${IB}</div></div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "w").w)).toBe(148);
  });
  it("a fit-content parent's trial layout does not push the final floats down", async () => {
    const boxes = await page(
      `<div style="width:fit-content;padding:8px"><div id="inn" style="width:14px;margin:8px">${Rb}${L}${B}</div><div style="width:132px;height:10px"></div></div>`);
    const inn = boxes.find((b: any) => b.i === "inn");
    const fr = boxes.find((b: any) => b.p === "0.1.0.0.0");
    const fl = boxes.find((b: any) => b.p === "0.1.0.0.1");
    expect(Math.round(fr.y - inn.y)).toBe(0);
    expect(Math.round(fl.y - inn.y)).toBe(10);
  });
  it("an earlier float in the parent does not widen a nested fit-content measure", async () => {
    const boxes = await page(
      `<div><div style="float:right;max-width:150px"><div style="width:20px;height:10px"></div><div style="min-width:40px;min-height:30px"></div><div style="height:12px"></div></div>` +
      `<div id="d2" style="width:fit-content;padding:8px"><div style="width:10%;margin:8px">${Rb}${L}${B}${IB}</div>` +
      `<div style="min-width:40px;min-height:30px"></div><div style="min-width:10px;min-height:10px"></div></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "d2").w)).toBe(148);
  });
});

describe("P0-74 margins collapse through a block whose only content is a float", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const A = `<div style="height:24px;margin:12px"></div>`;
  const FL = `<div style="float:right"><div style="width:50px;height:40px"></div><div style="min-width:10px;min-height:30px"></div></div>`;
  const FL2 = `<div style="float:left"><div style="height:36px;margin:8px"></div><div style="display:inline-block;height:fit-content"><div style="min-width:40px;min-height:30px"></div></div></div>`;
  it("the trailing margin leaves through the float-only block and out of the parent", async () => {
    const boxes = await page(`<div id="p" style="width:200px">${A}<div>${FL}</div>${FL2}</div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "p").h)).toBe(24);
  });
  it("the same without the trailing float", async () => {
    const boxes = await page(`<div id="p" style="width:200px">${A}<div>${FL}</div></div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "p").h)).toBe(24);
  });
  it("an actually empty block behaves the same (control)", async () => {
    const boxes = await page(`<div id="p" style="width:200px">${A}<div></div>${FL2}</div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "p").h)).toBe(24);
  });
});

describe("P0-75 a margined float joining a run's line still displaces the line's content", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const IB = `<div id="ib" style="display:inline-block;width:20px;height:80px"></div>`;
  const FL = `<div id="fl" style="float:left;width:20px;margin:2px;height:30px"></div>`;
  const BK = `<div style="min-width:40px;min-height:30px;padding:4px"></div>`;
  it("with a block after the float, the inline-block moves right of the float", async () => {
    const boxes = await page(`<div style="width:48px">${IB}${FL}${BK}</div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "ib").x)).toBe(24);
    expect(Math.round(boxes.find((b: any) => b.i === "fl").x)).toBe(2);
  });
  it("without the trailing block the result is the same (control)", async () => {
    const boxes = await page(`<div style="width:48px">${IB}${FL}</div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "ib").x)).toBe(24);
  });
  it("inside a floated fit-content box with nested inline-blocks", async () => {
    const boxes = await page(
      `<div id="c" style="float:left;width:fit-content;padding:8px;margin:2px">` +
      `<div id="ib" style="display:inline-block;max-width:250px"><div style="display:inline-block;width:20px;height:80px"><div style="min-width:40px;min-height:10px;padding:12px"></div><div style="min-width:10px;min-height:30px"></div></div></div>` +
      `<div id="fl" style="float:left;width:20px;margin:2px"><div style="min-width:40px;min-height:30px"></div><div style="height:12px"></div></div>${BK}</div>`);
    const c = boxes.find((b: any) => b.i === "c");
    expect(Math.round(boxes.find((b: any) => b.i === "ib").x - c.x)).toBe(32);
  });
});

describe("P0-76 a wrap column flex item's base size is measured at its hypothetical width", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0;font-size:0;line-height:0}*{box-sizing:border-box}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const KIDS =
    `<div style="height:12px"></div><div style="min-width:10px;min-height:30px;padding:2px"></div>` +
    `<div style="display:grid;grid-template-columns:1fr min-content fit-content(80px) 2fr;min-width:40px;padding:4px"><div style="width:20px;height:10px"></div><div style="min-width:40px;min-height:10px"></div><div style="min-width:10px;min-height:10px"></div><div style="width:90px;height:10px"></div></div>` +
    `<div style="width:25%;aspect-ratio:0.889"></div>`;
  it("wrap: the stretched item keeps the height measured at its fit-content width", async () => {
    const boxes = await page(
      `<div style="display:flex;flex-direction:column;flex-wrap:wrap;gap:4px;height:20px;padding:2px"><div id="t" style="margin:12px">${KIDS}</div></div>`);
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.w)).toBe(572);
    expect(Math.round(t.h)).toBe(114);
  });
  it("nowrap: the same item is measured at the stretched width (control)", async () => {
    const boxes = await page(
      `<div style="display:flex;flex-direction:column;gap:4px;height:20px;padding:2px"><div id="t" style="margin:12px">${KIDS}</div></div>`);
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.h)).toBe(221);
  });
  it("a ratio-only svg item beside the div still flexes and transfers (control)", async () => {
    const boxes = await page(
      `<div style="display:flex;flex-direction:column;flex-wrap:wrap;gap:4px;height:20px;padding:2px"><svg id="s" viewBox="0 0 100 60"><rect width="100" height="60"/></svg><div id="t" style="margin:12px">${KIDS}</div></div>`);
    const s = boxes.find((b: any) => b.i === "s");
    expect(Math.round(s.h)).toBe(16);
    expect(Math.round(s.w)).toBe(201);
  });
});

describe("P0-77 an abspos box measured provisionally is re-rendered at its solved size", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const INNER =
    `<div style="float:left;width:50%;height:80px"><div id="g" style="display:grid;grid-template-columns:60px min-content minmax(40px,1fr);gap:8px;padding:12px;margin:12px">` +
    `<div style="height:24px;margin:2px"></div><div style="width:50px;height:10px"></div><div style="min-width:10px;min-height:30px;padding:8px"></div><div style="height:12px"></div></div></div>`;
  const ABS = `<div style="position:absolute;left:30px;top:30px;width:60px;height:80px;min-width:40px;max-width:250px">${INNER}</div>`;
  it("inside an inline-flex (measured for the container's intrinsic size)", async () => {
    const boxes = await page(`<div style="display:inline-flex;flex-wrap:wrap;height:40px;padding:12px;margin:2px">${ABS}</div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "g").w)).toBe(24);
  });
  it("in a plain block parent the result is the same (control)", async () => {
    const boxes = await page(ABS);
    expect(Math.round(boxes.find((b: any) => b.i === "g").w)).toBe(24);
  });
});

describe("P0-78 a grid item's percentage height resolves against a fixed row under a cyclic container", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const IMG = `<img id="im" src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2210%22%20viewBox%3D%220%200%2020%2010%22%3E%3Crect%20width%3D%2220%22%20height%3D%2210%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E">`;
  const wrap = (grid: string) =>
    `<div style="display:flex;flex-wrap:wrap;gap:4px;width:120px;height:100%;margin:4px">${grid}</div>`;
  it("fixed 40px row: height:50% resolves to 20 and the stretched img transfers", async () => {
    const boxes = await page(wrap(
      `<div style="display:grid;grid-template-columns:max-content;grid-auto-rows:40px;gap:16px"><div id="t" style="display:flex;height:50%">${IMG}</div></div>`));
    expect(Math.round(boxes.find((b: any) => b.i === "t").h)).toBe(20);
    const im = boxes.find((b: any) => b.i === "im");
    expect(Math.round(im.w)).toBe(40);
    expect(Math.round(im.h)).toBe(20);
  });
  it("content-sized row: the percentage resolves against the used row height", async () => {
    // Chrome-verified (cycle 76): at final placement the grid area is a
    // definite size once the tracks are sized, so height:50% of the 30px
    // row is 15 -- the earlier guard expectation (auto, 30) enshrined the
    // pre-fix engine behaviour, not Chrome's.
    const boxes = await page(wrap(
      `<div style="display:grid;grid-template-columns:max-content;grid-auto-rows:auto;gap:16px"><div id="t" style="height:50%"><div style="height:30px"></div></div></div>`));
    expect(Math.round(boxes.find((b: any) => b.i === "t").h)).toBe(15);
  });
});

describe("P0-79 a stretched ratio item's transferred size is its min-content contribution", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const SVG = `<svg id="sv" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>`;
  it("min-content track: the flex row contributes the transferred width", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:min-content;width:600px"><div id="t" style="display:flex;height:120px">${SVG}</div></div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "t").w)).toBe(200);
    expect(Math.round(boxes.find((b: any) => b.i === "sv").w)).toBe(200);
  });
  it("max-content track: same result (control)", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:max-content;width:600px"><div id="t" style="display:flex;height:120px">${SVG}</div></div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "t").w)).toBe(200);
  });
  it("a plain block of the same height contributes nothing (control)", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:min-content;width:600px"><div id="t" style="height:120px">${SVG}</div></div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "t").w)).toBe(0);
  });
});

describe("P0-80 grid item used widths, measure-mode float push-down, pushed BFC margins", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const IMG = (w: number, h: number, style = "") =>
    `<img ${style ? `style="${style}" ` : ""}src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22${w}%22%20height%3D%22${h}%22%20viewBox%3D%220%200%20${w}%20${h}%22%3E%3Crect%20width%3D%22${w}%22%20height%3D%22${h}%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E">`;
  it("justify-items:stretch does not stretch a fit-content img; its row is sized at the placed size", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:1fr 60px;justify-items:stretch;height:200px;width:100px"><div id="a" style="min-width:40px;min-height:10px"></div>${IMG(120, 30)}${IMG(20, 90, "width:fit-content")}</div>`);
    const a = boxes.find((b: any) => b.i === "a");
    expect(Math.abs(a.h - 62.5)).toBeLessThan(0.6);
    const imgs = boxes.filter((b: any) => b.t === "img");
    expect(Math.round(imgs[1].w)).toBe(20);
    expect(Math.round(imgs[1].h)).toBe(90);
  });
  it("a BFC block pushed below a float puts its border at the float's bottom edge", async () => {
    const boxes = await page(
      `<div style="overflow:hidden;width:20px"><div style="float:left;width:40px;height:50px"></div><div id="t" style="display:flex;height:80px;min-width:40px;margin:2px"></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "t").y)).toBe(50);
  });
  it("a measure pass pushes a BFC child below measured floats (container height keeps the float)", async () => {
    const boxes = await page(
      `<div id="g" style="display:grid;grid-template-columns:max-content;max-width:150px;padding:8px"><div style="float:left;width:20px"><div style="float:left;width:30%;min-width:40px;max-width:250px"><div style="height:50px"></div></div><div style="display:grid;height:200px;min-width:100px"><div style="height:15px"></div><div style="height:90px"></div></div></div></div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "g").h)).toBe(266);
  });
});

describe("P0-81 stretched flex item measured at its definite cross size", () => {
  const page = async (body: string, width = 800) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const COL = `<div id="t" style="display:flex;flex-direction:column;flex-wrap:wrap;padding:12px"><div style="width:20px;height:25px;flex:2 1 0"></div><div style="width:420px;height:228px"></div></div>`;
  it("a wrapped column-flex item of a definite-height row flex is measured wrapped", async () => {
    const boxes = await page(`<div style="display:flex;height:60px;width:700px">${COL}</div>`);
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.w)).toBe(464);
    expect(Math.round(t.h)).toBe(60);
  });
  it("an auto-height row flex leaves the item unwrapped (control)", async () => {
    const boxes = await page(`<div style="display:flex;width:700px">${COL}</div>`);
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.w)).toBe(444);
    expect(Math.round(t.h)).toBe(252);
  });
  it("an intrinsic (shrink-to-fit) query keeps the unwrapped measure (control)", async () => {
    const boxes = await page(`<div style="position:absolute;left:0;top:0">${COL}</div>`);
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.w)).toBe(444);
    expect(Math.round(t.h)).toBe(252);
  });
});

describe("P0-82 grid contributions of replaced items transfer from a definite row height", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const IMG = `<img id="im" src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2280%22%20height%3D%2290%22%20viewBox%3D%220%200%2080%2090%22%3E%3Crect%20width%3D%2280%22%20height%3D%2290%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E" style="width:10%">`;
  const SVG = `<svg id="sv" viewBox="0 0 40 60" style="width:fit-content"><rect width="40" height="60" fill="#69c"/></svg>`;
  it("fr tracks share what the transferred fit-content and min-content tracks leave", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:1fr min-content fit-content(80px) 2fr;grid-auto-rows:40px;align-items:stretch;width:104px"><div id="a" style="height:36px"></div>${SVG}${IMG}<div id="d" style="min-width:10px;min-height:10px;padding:8px"></div></div>`);
    const g = (id: string) => boxes.find((b: any) => b.i === id);
    expect(Math.abs(g("a").w - 13.9)).toBeLessThan(0.6);
    expect(Math.abs(g("sv").w - 26.7)).toBeLessThan(0.6);
    expect(Math.abs(g("im").w - 3.6)).toBeLessThan(0.6);
    expect(Math.abs(g("im").x - 40.6)).toBeLessThan(0.6);
    expect(Math.abs(g("d").w - 27.9)).toBeLessThan(0.6);
  });
  it("a fit-content track takes the transferred size as its contribution", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:fit-content(80px);grid-auto-rows:40px;align-items:stretch;width:104px">${IMG}</div>`);
    expect(Math.abs(boxes.find((b: any) => b.i === "im").w - 3.6)).toBeLessThan(0.6);
  });
  it("an auto row leaves the contribution intrinsic (control)", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:fit-content(80px);width:104px">${IMG}</div>`);
    expect(Math.round(boxes.find((b: any) => b.i === "im").w)).toBe(8);
  });
});

describe("P0-83 abspos shrink-to-fit clamps to the available width", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const CONTENT = `<svg viewBox="0 0 100 20" style="width:10%"><rect width="100" height="20" fill="#69c"/></svg><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2250%22%20viewBox%3D%220%200%2020%2050%22%3E%3Crect%20width%3D%2220%22%20height%3D%2250%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E" style="width:fit-content">`;
  const wrap = (w: number, inner: string) =>
    `<div style="position:absolute;left:0;top:0;width:${w}px;height:200px"><div id="t" style="position:absolute;left:0;top:0">${inner}</div></div>`;
  it("caps the preferred width at the containing block's width", async () => {
    const boxes = await page(wrap(100, CONTENT));
    expect(Math.round(boxes.find((b: any) => b.i === "t").w)).toBe(100);
  });
  it("never shrinks below the preferred minimum width", async () => {
    const boxes = await page(wrap(6, CONTENT));
    expect(Math.round(boxes.find((b: any) => b.i === "t").w)).toBe(20);
  });
  it("a definite min-content floor wins over a narrower containing block", async () => {
    const boxes = await page(wrap(30, `<div style="width:50px;height:10px"></div>`));
    expect(Math.round(boxes.find((b: any) => b.i === "t").w)).toBe(50);
  });
});

describe("P0-84 grid contribution of a percentage-height item uses the row height", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 800,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    return layout;
  };
  const IMG = `<img id="im" src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2210%22%20viewBox%3D%220%200%2020%2010%22%3E%3Crect%20width%3D%2220%22%20height%3D%2210%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E">`;
  const FLEX = `<div id="t" style="display:flex;justify-content:flex-end;height:100%;padding:2px">${IMG}</div>`;
  it("the minmax() row floor is the percentage basis during column sizing", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:fit-content(80px);grid-auto-rows:minmax(30px,auto);width:200px">${FLEX}</div>`,
    );
    const t = boxes.find((b: any) => b.i === "t");
    const im = boxes.find((b: any) => b.i === "im");
    expect(Math.round(t.w)).toBe(56);
    expect(Math.round(im.w)).toBe(52);
  });
  it("a taller row-mate raises the basis (the track passes its fit-content limit)", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:fit-content(80px) auto;grid-auto-rows:minmax(30px,auto);width:400px">${FLEX}<div style="height:60px"></div></div>`,
    );
    const t = boxes.find((b: any) => b.i === "t");
    const im = boxes.find((b: any) => b.i === "im");
    expect(Math.round(t.w)).toBe(116);
    expect(Math.round(im.w)).toBe(112);
  });
});

describe("P0-85 a grid item's percentage height resolves at final placement", () => {
  it("a height:30% item in a content-sized row under a cyclic ancestor takes the row height", async () => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:content-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body><div style="display:flex;flex-direction:column"><div style="width:fit-content;flex:0 1 auto"><div id="g" style="display:grid;grid-template-columns:1fr auto auto;gap:4px;width:200px"><div id="t" style="display:flex;flex-direction:column;flex-wrap:wrap;height:30%;padding:8px;margin:12px"><div style="height:36px;margin:2px"></div><div style="height:36px"></div><div style="width:90px;height:10px;flex:1"></div></div><div style="width:90px;height:10px"></div></div></div></div></body></html>`,
      width: 800,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as never);
    const g = layout.find((b: any) => b.i === "g");
    const t = layout.find((b: any) => b.i === "t");
    expect(Math.round(g.h)).toBe(116);
    // 30% of the 116px row = 34.8 content + 16 padding (content-box)
    expect(Math.round(t.h)).toBe(51);
  });
});

describe("P0-86 an SVG <img> with no dimensions and no viewBox uses the default object size, with no ratio transfer", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 800,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout;
  };
  const NODIM = `data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E`;
  it("both axes auto: 300x150 (not the 512x512 raster fallback)", async () => {
    const boxes = await page(`<img id="t" src="${NODIM}">`);
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.w)).toBe(300);
    expect(Math.round(t.h)).toBe(150);
  });
  it("width specified: the height stays the default 150 (no intrinsic ratio to transfer)", async () => {
    const boxes = await page(`<img id="t" style="width:100px" src="${NODIM}">`);
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.w)).toBe(100);
    expect(Math.round(t.h)).toBe(150);
  });
  it("height specified: the width stays the default 300", async () => {
    const boxes = await page(`<img id="t" style="height:100px" src="${NODIM}">`);
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.w)).toBe(300);
    expect(Math.round(t.h)).toBe(100);
  });
});

describe("P0-87 cascade order between a var() shorthand and later longhand declarations", () => {
  const page = async (css: string, cls: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>:root{--spacing:0.25rem}${css}</style></head><body><div id="t" class="${cls}"></div></body></html>`,
      width: 800,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout;
  };
  const P6 = `.p-6{padding:calc(var(--spacing) * 6)}`;
  const PB10 = `.pb-10{padding-bottom:calc(var(--spacing) * 10)}`;
  it("a preceding universal padding rule does not make the shorthand clobber the later longhand", async () => {
    const boxes = await page(`*{padding:0}${P6}${PB10}`, "p-6 pb-10");
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.h)).toBe(64);
  });
  it("a later plain shorthand legitimately overrides an earlier var() shorthand", async () => {
    const boxes = await page(`.z{padding:0}${P6}`, "z p-6");
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.h)).toBe(48);
  });
  it("an earlier var() shorthand does not override a later plain shorthand", async () => {
    const boxes = await page(`${P6}.z{padding:0}`, "p-6 z");
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.h)).toBe(0);
  });
  it("a shorthand after the longhand wins (source order), even with a universal rule present", async () => {
    const boxes = await page(`*{padding:0}${PB10}${P6}`, "p-6 pb-10");
    const t = boxes.find((b: any) => b.i === "t");
    expect(Math.round(t.h)).toBe(48);
  });
});

describe("P0-88 a definite-width replaced flex item's automatic minimum is the cross-size ratio transfer", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:content-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 800,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout;
  };
  const IMG = `data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2280%22%20height%3D%2290%22%20viewBox%3D%220%200%2080%2090%22%3E%3Crect%20width%3D%2280%22%20height%3D%2290%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E`;
  it("flex-shrink freezes the width:200px img at the transferred 97.2, not its intrinsic 80", async () => {
    const boxes = await page(
      `<div style="display:flex;width:200px;height:109.3px">` +
        `<svg id="a" viewBox="0 0 100 60"><rect width="100" height="60" fill="#69c"/></svg>` +
        `<svg id="b" viewBox="0 0 100 20"><rect width="100" height="20" fill="#69c"/></svg>` +
        `<svg id="c" viewBox="0 0 40 60"><rect width="40" height="60" fill="#69c"/></svg>` +
        `<img id="t" src="${IMG}" style="width:200px"></div>`,
    );
    const w = (id: string) => boxes.find((b: any) => b.i === id).w;
    // Chromium: 23.4 / 70.1 / 9.3 / 97.1 (uniform shrink; the img freezes at
    // 109.3 * 80/90 = 97.2). Without the fix: 27.3 / 81.8 / 10.9 / 80.
    expect(Math.abs(w("a") - 23.4)).toBeLessThan(1.5);
    expect(Math.abs(w("b") - 70.1)).toBeLessThan(1.5);
    expect(Math.abs(w("c") - 9.3)).toBeLessThan(1.5);
    expect(Math.abs(w("t") - 97.2)).toBeLessThan(1.5);
  });
});

describe("P0-89 a fit-content item in a wrapping column flex sizes its line by the resolved width", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:content-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 800,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout;
  };
  const IMG = `data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22300%22%20height%3D%2230%22%20viewBox%3D%220%200%20300%2030%22%3E%3Crect%20width%3D%22300%22%20height%3D%2230%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E`;
  it("the following column starts after the resolved 379.4, not the 420 max-content", async () => {
    const boxes = await page(
      `<div style="display:flex;flex-direction:row;gap:4px;height:60px;padding:12px;margin:12px;width:473.7px">` +
        `<div style="display:grid;grid-template-columns:60px auto;grid-auto-rows:minmax(30px,auto);align-items:stretch;margin:12px;overflow:hidden"><div style="height:36px"></div></div>` +
        `<div style="display:flex;flex-direction:column;flex-wrap:wrap;padding:12px">` +
        `<div style="width:20px;height:25px;flex:2 1 0"></div>` +
        `<div id="ib" style="display:inline-block;width:fit-content"><div style="height:12px"></div><div style="height:36px"></div><svg viewBox="0 0 40 60" style="width:120px"><rect width="40" height="60" fill="#69c"/></svg><img src="${IMG}" style="width:fit-content"></div>` +
        `<div id="third" style="margin:4px;flex:0 1 auto"><div style="width:90px;height:40px"></div><svg viewBox="0 0 100 20"><rect width="100" height="20" fill="#69c"/></svg></div>` +
        `</div></div>`,
    );
    const ib = boxes.find((b: any) => b.i === "ib");
    const third = boxes.find((b: any) => b.i === "third");
    // Chromium: the fit-content wrapper resolves to 379.4 (its flexed container's
    // content width) and the third column starts right after it: x = 509.7.
    // Without the fix the line is sized by the 420 max-content: x = 550.3.
    expect(Math.abs(ib.w - 379.4)).toBeLessThan(1.5);
    expect(Math.abs(third.x - 509.7)).toBeLessThan(1.5);
  });
});

describe("P0-90 a percentage height inside a stretched auto-height grid item resolves against the row height for the inline contribution", () => {
  const page = async (body: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 800,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout;
  };
  const IMG = `data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2210%22%20viewBox%3D%220%200%2020%2010%22%3E%3Crect%20width%3D%2220%22%20height%3D%2210%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E`;
  it("the height:100% flex inside a plain wrapper contributes the transferred image width", async () => {
    const boxes = await page(
      `<div style="display:grid;grid-template-columns:fit-content(80px) auto;grid-auto-rows:minmax(30px,auto);width:400px">` +
        `<div><div id="t" style="display:flex;justify-content:flex-end;height:100%;padding:2px"><img id="im" src="${IMG}"></div></div>` +
        `<div style="height:60px"></div></div>`,
    );
    const t = boxes.find((b: any) => b.i === "t");
    const im = boxes.find((b: any) => b.i === "im");
    // Chromium: the row is 60 tall (the mate), the flex fills the wrapper at
    // 60, the image stretches to 56 high and transfers to 112 wide, so the
    // fit-content column is 116. Without the fix the percentage stays cyclic
    // and the column is 24 (image at its intrinsic 20 wide).
    expect(Math.round(t.w)).toBe(116);
    expect(Math.round(t.h)).toBe(60);
    expect(Math.round(im.w)).toBe(112);
    expect(Math.round(im.h)).toBe(56);
  });
});

describe("P0-91 a column-flex item's keyword inline size resolves in line sizing and final layout", () => {
  const page = async (kw: string) => {
    let layout: any[] = [];
    const SVG = `data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2290%22%3E%3Crect%20width%3D%22120%22%20height%3D%2290%22%20fill%3D%22%23666%22%2F%3E%3C%2Fsvg%3E`;
    const IMG = `data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22300%22%20height%3D%22246%22%3E%3Crect%20width%3D%22300%22%20height%3D%22246%22%20fill%3D%22%23999%22%2F%3E%3C%2Fsvg%3E`;
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>` +
        `<div style="display:flex;flex-direction:column;flex-wrap:wrap;width:403.4px;height:84px;padding:12px">` +
        `<div style="width:20px;height:36px"></div>` +
        `<div id="ib" style="display:inline-block;width:${kw}"><img src="${SVG}"><img src="${IMG}"></div>` +
        `<div style="width:90px;height:58px"></div></div></body></html>`,
      width: 800,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout.find((b: any) => b.i === "ib");
  };
  it("width:auto is the fit-content size (max-content clamped to the column)", async () => {
    const ib = await page("auto");
    // Chromium: 379.4 wide (the column's content width), the images wrap and
    // the item is 336 high. The engine used the raw max-content 420 x 246.
    expect(Math.round(ib.w)).toBe(379);
    expect(Math.round(ib.h)).toBe(336);
  });
  it("width:min-content is the widest unbreakable piece", async () => {
    const ib = await page("min-content");
    // Chromium: 300 wide (the img), 336 high. The engine used max-content 420.
    expect(Math.round(ib.w)).toBe(300);
    expect(Math.round(ib.h)).toBe(336);
  });
  it("width:fit-content and max-content are unchanged", async () => {
    const fit = await page("fit-content");
    expect(Math.round(fit.w)).toBe(379);
    const max = await page("max-content");
    expect(Math.round(max.w)).toBe(420);
  });
});

describe("P0-92 a keyword-width item contributes its resolved size to its flex container's base and minimum", () => {
  const BODY = `<div style="background:#ddf;display:flex;flex-direction:row;justify-content:flex-start;gap:4px;height:60px;min-width:100px;padding:12px;margin:12px;width:473.7px"><div style="background:#fdf;display:grid;grid-template-columns:60px auto;grid-auto-rows:minmax(30px,auto);align-items:stretch;margin:12px;overflow:hidden"><div style="background:#dff;height:36px;"></div></div><div style="background:#fdf;display:flex;flex-direction:column;flex-wrap:wrap;padding:12px"><div style="background:#fed;width:20px;height:25px;flex:2 1 0;"></div><div style="background:#ddf;display:inline-block;width:max-content"><div style="background:#ffd;height:12px;"></div><div style="background:#fdd;height:36px;"></div><svg viewBox="0 0 40 60" style="width:120px;"><rect width="40" height="60" fill="#69c"/></svg><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22300%22%20height%3D%2230%22%20viewBox%3D%220%200%20300%2030%22%3E%3Crect%20width%3D%22300%22%20height%3D%2230%22%20fill%3D%22%2369c%22%2F%3E%3C%2Fsvg%3E" style="width:fit-content"></div><div style="background:#eee;margin:4px;flex:0 1 auto"><div style="background:#fdd;width:90px;height:40px;"></div><svg viewBox="0 0 100 20" style=""><rect width="100" height="20" fill="#69c"/></svg></div></div></div>`;
  const page = async (kw: string, rootW: number) => {
    let layout: any[] = [];
    const body = BODY.replace("width:max-content", `width:${kw}`).replace("width:473.7px", `width:${rootW}px`);
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:content-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body>${body}</body></html>`,
      width: 2400,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return {
      a: layout.find((b: any) => b.p === "0.1.0.0"),
      b: layout.find((b: any) => b.p === "0.1.0.1"),
    };
  };
  it("the container's flex base uses a min-content item at its min-content size", async () => {
    const { b } = await page("min-content", 2000);
    // Chromium: B's base is 442 (the item at 300), not 562 (item at max-content).
    expect(Math.round(b.w)).toBe(442);
  });
  it("the container's automatic minimum uses a max-content item at its max-content size", async () => {
    const { b } = await page("max-content", 100);
    // Chromium: B's minimum is 444 (the item at 420), not 324 (item at min-content).
    expect(Math.round(b.w)).toBe(444);
  });
  it("the final distribution freezes the container at that minimum", async () => {
    const { a, b } = await page("max-content", 473.7);
    // Chromium: B stays 444 and the grid sibling is crushed to ~2 wide.
    expect(Math.round(b.w)).toBe(444);
    expect(a.w).toBeLessThan(10);
  });
});

describe("P0-93 a grid item's percentage height resolves against the area (margin-box) height", () => {
  const page = async (h: string) => {
    let layout: any[] = [];
    const a = `<div style="display:flex;flex-direction:column;flex-wrap:wrap;justify-content:space-around;align-items:stretch;height:${h};padding:8px;margin:12px"><div style="height:36px;margin:2px"></div><div style="height:36px;width:10px"></div><div style="width:90px;height:10px;flex:1"></div></div>`;
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body><div id="w" style="width:fit-content"><div style="display:grid;grid-template-columns:1fr auto auto;gap:4px;width:25%">${a}<div style="width:90px;height:10px"></div></div></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout.find((b: any) => b.i === "w");
  };
  it("height:80% resolves against 116 (margin box), so the flex stays in one column", async () => {
    // Chromium: the wrapper is 228 wide. Resolving against the border-box
    // height (92) wraps the flex into two columns and widens it to 232.
    expect(Math.round((await page("80%")).w)).toBe(228);
  });
  it("height:60% still wraps under either basis", async () => {
    expect(Math.round((await page("60%")).w)).toBe(232);
  });
});

describe("P0-93b the percentage re-measure is not served from the cyclic measure's memo", () => {
  it("a height:30% item inside a grid > column-flex > grid chain contributes its wrapped width", async () => {
    let layout: any[] = [];
    const a = `<div style="display:flex;flex-direction:column;flex-wrap:wrap;justify-content:space-around;align-items:stretch;height:30%;padding:8px;margin:12px"><div style="height:36px;margin:2px"></div><div style="height:36px"></div><div style="width:90px;height:10px;flex:1"></div></div>`;
    const inner = `<div style="display:grid;grid-template-columns:1fr auto auto;gap:4px;width:25%">${a}<div style="width:90px;height:10px"></div></div>`;
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:content-box}html,body{margin:0;font-size:0;line-height:0}</style></head><body><div style="display:grid;grid-template-columns:auto auto 2fr;align-items:end;padding:4px"><div id="cf" style="display:flex;flex-direction:column">${inner}</div></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    const cf = layout.find((b: any) => b.i === "cf");
    // Chromium: the column flex is 232 wide (the item wraps at 30% of the
    // 116px area). Serving the re-measure from the cyclic pass's memo
    // returns the unwrapped contribution and the flex comes out 228.
    expect(Math.round(cf.w)).toBe(232);
  });
});

describe("P0-94 ::part() rules from the document apply to shadow-tree part elements", () => {
  const page = async (withPartRule: boolean) => {
    let layout: any[] = [];
    const rules = withPartRule
      ? `.bar x-host, .bar x-host::part(button) { height: 100% } .bar x-host::part(other) { height: 7px }`
      : `.bar x-host { height: 100% }`;
    await render({
      value: `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;font-size:0;line-height:0}${rules}</style></head><body><div class="bar" style="height:30px;display:flex"><x-host style="display:flex"><template shadowrootmode="open"><div style="position:relative"><button id="b" part="button" style="display:flex;align-items:center;margin:0;padding:0 8px;border:none;background:none"><span style="font-size:16px;line-height:24px">Theme</span></button><span id="o" part="other" style="display:block">x</span></div></template></x-host></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout;
  };
  it("the part element takes the ::part height (100% of the stretched shadow div)", async () => {
    // Chromium: button 30 (its content alone is 24), span#o 7 (its content
    // alone is 0 at font-size 0). Without ::part support both rules are
    // inert: button 24, span 0.
    const layout = await page(true);
    expect(Math.round(layout.find((b: any) => b.i === "b").h)).toBe(30);
    expect(Math.round(layout.find((b: any) => b.i === "o").h)).toBe(7);
  });
  it("without the ::part rules the elements keep their content heights", async () => {
    const layout = await page(false);
    expect(Math.round(layout.find((b: any) => b.i === "b").h)).toBe(24);
    expect(Math.round(layout.find((b: any) => b.i === "o").h)).toBe(0);
  });
});

describe("P0-95 a block inside an inline keeps its margins collapsing through the parent", () => {
  // Hacker News's vote arrow: <center><a><div style="margin:3px 2px 6px"></div></a></center>. The empty
  // halves of the split <a> make no line box, so the margins leave the <center> (Chromium: y 6, h 10).
  const page = async (inner: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div style="padding-top:1px"><center id="c">${inner}</center></div></body></html>`,
      width: 300,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout.find((b: any) => b.i === "c");
  };
  const arrow = `<div style="width:10px;height:10px;margin:3px 2px 6px"></div>`;
  it("with an <a> around the block, the <center> is as tall as the block alone", async () => {
    const plain = await page(arrow);
    const wrapped = await page(`<a href="x">${arrow}</a>`);
    expect(Math.round(wrapped.h)).toBe(Math.round(plain.h));
    expect(Math.round(wrapped.y)).toBe(Math.round(plain.y));
  });
  it("an inline with real content on both sides still makes its own lines", async () => {
    const c = await page(`<a href="x">before${arrow}after</a>`);
    expect(c.h).toBeGreaterThan(30);
  });
});

describe("P0-96 a stretched replaced item with a definite width keeps that width", () => {
  // CSS Flexbox 4.5: the automatic minimum is min(specified size, content size suggestion). The
  // transferred size (60 * 300/50 = 360) must not lift the minimum above the specified 120px.
  const svg = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="50" viewBox="0 0 300 50"><rect width="300" height="50" fill="#69c"/></svg>`);
  const img = async (style: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div style="display:flex;height:60px"><img id="i" src="${svg}" style="${style}"></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout.find((b: any) => b.i === "i");
  };
  it("width:120px stays 120 wide and stretches to 60 tall", async () => {
    const b = await img("width:120px");
    expect(Math.round(b.w)).toBe(120);
    expect(Math.round(b.h)).toBe(60);
  });
  it("an auto width still takes the transferred 360", async () => {
    expect(Math.round((await img("")).w)).toBe(360);
  });
});

describe("P0-97 a percentage-width ratio-only svg in a shrink-to-fit column contributes its default width", () => {
  // Blink: an `auto` viewBox-only svg contributes 0 to a shrink-to-fit column, a width:100% one the
  // 300px default object width. The engine filled the whole 600px line instead.
  const svg = async (style: string) => {
    let layout: any[] = [];
    await render({
      value: `<!doctype html><html><head><style>html,body{margin:0}</style></head><body><div style="display:flex"><div id="c" style="display:flex;flex-direction:column"><svg id="s" viewBox="0 0 100 20" style="${style}"></svg></div></div></body></html>`,
      width: 600,
      format: "png",
      onLayout: (l: any) => (layout = l),
    } as any);
    return layout.find((b: any) => b.i === "c");
  };
  it("width:100% makes the column 300 wide and 60 tall", async () => {
    const c = await svg("width:100%");
    expect(Math.round(c.w)).toBe(300);
    expect(Math.round(c.h)).toBe(60);
  });
  it("an auto width contributes nothing", async () => {
    expect(Math.round((await svg("")).w)).toBe(0);
  });
});

// An SVG loaded as an image (<img>, or the input itself) used to come out without its text: SkSVGDOM bakes the
// text in when the image is decoded, and it had neither the page's fonts nor, for an input, any font at all.
describe("SVG as an image keeps its text and its external images", () => {
  const SVG_TEXT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><rect width="300" height="60" fill="#fff"/>' +
    '<text x="10" y="40" font-size="28" font-family="sans-serif" fill="#000">Hello 日本語</text></svg>';
  const dark = (img: PNG) => {
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) n++;
    return n;
  };
  const b64 = (s: string) => Buffer.from(s).toString("base64");

  it("<img src=svg> draws the same text as the inline <svg>", async () => {
    const asImg = await renderPng(`<img src="data:image/svg+xml;base64,${b64(SVG_TEXT)}" style="display:block">`, 300, 60);
    const inline = await renderPng(SVG_TEXT, 300, 60);
    expect(dark(asImg.img)).toBeGreaterThan(200);
    expect(dark(asImg.img)).toBe(dark(inline.img));
  });

  it("an SVG given as the input draws its text, whatever the output format", async () => {
    const png = await render({ value: SVG_TEXT, format: "png" });
    expect(png.originalFormat).toBe("svg");
    expect(png.width).toBe(300);
    expect(dark(PNG.sync.read(Buffer.from(png.data)))).toBeGreaterThan(200);
    const resized = await render({ value: new TextEncoder().encode(SVG_TEXT), format: "webp", width: 150 });
    expect(resized.width).toBe(150);
    expect(resized.height).toBe(30);
  });

  it("an SVG without text still goes straight through the converter", async () => {
    const out = await render({ value: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>', format: "png" });
    expect(out.width).toBe(40);
    expect(out.originalFormat).toBe("svg");
  });

  it("an <image> that points at another URL is fetched and drawn", async () => {
    const red = new PNG({ width: 20, height: 20 });
    for (let i = 0; i < red.data.length; i += 4) red.data.set([255, 0, 0, 255], i);
    const png = PNG.sync.write(red);
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "image/png");
      res.end(png);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as { port: number };
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#fff"/><image href="http://127.0.0.1:${port}/r.png" x="10" y="10" width="40" height="40"/></svg>`;
      const { at } = await renderPng(`<img src="data:image/svg+xml;base64,${b64(svg)}" style="display:block">`, 60, 60);
      expect(near(at(30, 30), RED)).toBe(true);
      expect(isWhite(at(3, 3))).toBe(true);
    } finally {
      server.close();
    }
  });
});
