import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ephemeralPort } from "../../e2e-vite/test/helpers.js";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PNG_MAGIC = "89504e47";
const NEXT_BIN = require.resolve("next/dist/bin/next");
const DIST_DIR = path.resolve(__dirname, "..", "..", "html-to-image", "dist");

/** Env shared by build/start children: pins the lib dist for the routes. */
function childEnv(): NodeJS.ProcessEnv {
  return { ...process.env, WASM_HTML_TO_IMAGE_DIST: DIST_DIR };
}

async function assertPng(buf: ArrayBuffer): Promise<number> {
  const bytes = new Uint8Array(buf);
  const head = Buffer.from(bytes.subarray(0, 4)).toString("hex");
  expect(head).toBe(PNG_MAGIC);
  expect(bytes.length).toBeGreaterThan(100);
  return bytes.length;
}

interface StartedApp {
  baseUrl: string;
  close: () => Promise<void>;
}

/** `next build` once, then `next start` on an ephemeral port. */
async function startBuiltApp(): Promise<StartedApp> {
  const build = spawn(process.execPath, [NEXT_BIN, "build", ROOT], {
    stdio: "pipe",
    env: childEnv(),
  });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    build.stdout?.on("data", (d) => {
      out += String(d);
    });
    build.stderr?.on("data", (d) => {
      out += String(d);
    });
    build.on("error", reject);
    build.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`next build failed (${code}):\n${out.slice(-3000)}`));
    });
  });
  const port = await ephemeralPort();
  const proc: ChildProcess = spawn(process.execPath, [NEXT_BIN, "start", ROOT, "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv(),
  });
  const deadline = Date.now() + 120000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline || proc.exitCode !== null) {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      throw new Error("next start did not become ready");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        proc.kill();
      } catch {
        // ignore
      }
    },
  };
}

let app: StartedApp | undefined;

beforeAll(async () => {
  app = await startBuiltApp();
}, 600000);

afterAll(async () => {
  await app?.close();
});

// Only the edge route is checked here: the Node route handler and the
// in-browser cells are covered by the other e2e packages.
describe("next edge (Route Handler, edge runtime + workerd entry)", () => {
  it(
    "renders PNG through the edge route",
    async () => {
      const res = await fetch(`${app!.baseUrl}/api/edge-render`);
      if (!res.ok) {
        console.log(`edge body: ${JSON.stringify(await res.text()).slice(0, 300)}`);
      }
      expect(res.ok).toBe(true);
      const len = await assertPng(await res.arrayBuffer());
      console.log(`edge: PNG ${len}B via /api/edge-render`);
    },
    120000,
  );

  it(
    "runs a page's scripts with QuickJS, without being handed its wasm",
    async () => {
      const res = await fetch(`${app!.baseUrl}/api/edge-js`);
      const body = await res.text();
      expect(res.ok, body.slice(0, 300)).toBe(true);
      expect(JSON.parse(body)).toEqual({ scripted: true, rendered: true });
    },
    120000,
  );
});
