import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview, type PreviewServer } from "vite";
import { cdpEvaluate, ephemeralPort, launchChrome } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PNG_MAGIC = "89504e47";

async function assertPng(buf: ArrayBuffer): Promise<number> {
  const bytes = new Uint8Array(buf);
  const head = Buffer.from(bytes.subarray(0, 4)).toString("hex");
  expect(head).toBe(PNG_MAGIC);
  expect(bytes.length).toBeGreaterThan(100);
  return bytes.length;
}

// ---------------------------------------------------------------------------
// backend (build): the built output renders through the served middleware;
// the test only fetches PNG bytes over HTTP and checks the magic.
// The dev server and the in-browser cells are covered elsewhere.
// ---------------------------------------------------------------------------

describe("backend [build]", () => {
  let server: PreviewServer | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    await build({ root: ROOT, logLevel: "warn" });
    const pv = await preview({
      root: ROOT,
      logLevel: "warn",
      preview: { host: "127.0.0.1", port: await ephemeralPort(), strictPort: true },
    });
    const local = pv.resolvedUrls?.local?.[0]?.replace(/\/$/, "");
    if (!local) throw new Error("preview server URL unknown");
    baseUrl = local;
    server = pv;
  }, 180000);

  afterAll(async () => {
    await server?.close();
  });

  it(
    "renders PNG through the server middleware",
    async () => {
      const res = await fetch(`${baseUrl}/__render`);
      expect(res.ok).toBe(true);
      const len = await assertPng(await res.arrayBuffer());
      console.log(`backend[build]: PNG ${len}B via ${baseUrl}/__render`);
    },
    120000,
  );

  // A real browser: the QuickJS engine finds and compiles its own quickjs.wasm (quickjs-web.ts) and runs a page's script.
  it(
    "runs a page's scripts with QuickJS in the browser",
    async () => {
      const chrome = await launchChrome();
      try {
        const text = await cdpEvaluate(
          chrome.port,
          `${baseUrl}/qjs.html`,
          "(() => { const t = document.getElementById('out').textContent; return t === 'running' ? null : t; })()",
        );
        expect(text).toBe("ok");
      } finally {
        await chrome.close();
      }
    },
    120000,
  );
});
