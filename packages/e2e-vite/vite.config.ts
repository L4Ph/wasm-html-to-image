import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Resolve the wasm-html-to-image dist dir (workspace-linked package).
// NOTE: the package does not export ./package.json, so resolve via ./single.
const wasmDist = path.dirname(
  createRequire(import.meta.url).resolve("wasm-html-to-image/single"),
);

async function renderPng(): Promise<Buffer> {
  const { render } = (await import("wasm-html-to-image/single")) as {
    render: (o: unknown) => Promise<{ data: Uint8Array | string }>;
  };
  const { data } = await render({ value: "<h1>e2e backend</h1>", width: 800, format: "png" });
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
  return Buffer.from(bytes);
}

function pngHandler() {
  return async (
    _req: unknown,
    res: import("node:http").ServerResponse,
  ) => {
    try {
      const png = await renderPng();
      res.setHeader("Content-Type", "image/png");
      res.end(png);
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  };
}

/**
 * Backend cells need `/__render` in front of vite's SPA fallback, so it is
 * registered here (plugin hooks run before built-in middlewares) rather than
 * from the test file. Dev resolves the fixture entry through the SSR
 * pipeline; preview (built output) renders through the shipped dist.
 */
function e2eBackend(): Plugin {
  return {
    name: "e2e-backend",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/__render",
        async (
          _req: import("node:http").IncomingMessage,
          res: import("node:http").ServerResponse,
        ) => {
          try {
            const mod = (await server.ssrLoadModule("/src/backend-entry.ts")) as {
              handleRender: () => Promise<Uint8Array>;
            };
            const out = await mod.handleRender();
            res.setHeader("Content-Type", "image/png");
            res.end(Buffer.from(out));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        },
      );
    },
    configurePreviewServer(server: PreviewServer) {
      const use = (
        server.middlewares as unknown as {
          use: (
            route: string,
            fn: (
              req: import("node:http").IncomingMessage,
              res: import("node:http").ServerResponse,
            ) => void,
          ) => void;
        }
      ).use.bind(server.middlewares);
      use("/__render", pngHandler());
    },
  };
}

export default defineConfig({
  build: { rollupOptions: { input: { main: path.resolve(import.meta.dirname, "index.html"), qjs: path.resolve(import.meta.dirname, "qjs.html") } } },
  // Keep the WASM-adjacent modules out of esbuild pre-bundling: the loader
  // resolves glue/wasm URLs relative to its own module URL at runtime, which
  // must keep working in dev exactly as in the built output.
  optimizeDeps: {
    exclude: ["wasm-html-to-image", "worker-lib"],
  },
  plugins: [
    e2eBackend(),
    {
      name: "copy-wasm-glue",
      apply: "build",
      // The bundled chunk resolves `./html-to-image.js` relative to its own
      // URL (dist/assets/), so ship the glue + wasm next to the chunks.
      async writeBundle(opts) {
        const assetsDir = path.join(opts.dir ?? "dist", "assets");
        for (const f of ["html-to-image.js", "html-to-image.wasm"]) {
          await fs.promises.copyFile(path.join(wasmDist, f), path.join(assetsDir, f));
        }
      },
    },
  ],
});
