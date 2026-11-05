import { describe, expect, it } from "vitest";
import { render } from "../src/single.js";

// PNG `speed` is the zlib level: the default 6 is level 6 (unchanged output), a higher speed a lower level.
const rows = Array.from({ length: 120 }, (_, i) => `<tr><td>row ${i}</td><td style="color:#06c">cell <b>${i}</b></td></tr>`).join("");
const html = `<table style="font-family:sans-serif">${rows}</table>`;

const png = async (speed?: number): Promise<Uint8Array> => {
  const r = await render({ value: html, width: 600, format: "png", speed, fontMap: {} });
  return r.data as Uint8Array;
};

describe("PNG speed", () => {
  it("leaves the default alone and gives a smaller-effort, larger file at a high speed", async () => {
    const def = await png();
    const same = await png(6);
    const fast = await png(10);
    expect(Buffer.from(same).equals(Buffer.from(def))).toBe(true);
    expect(fast.length).toBeGreaterThan(def.length);
    for (const d of [def, fast, await png(0)]) expect(Buffer.from(d.subarray(1, 4)).toString("latin1")).toBe("PNG");
  }, 60_000);
});
