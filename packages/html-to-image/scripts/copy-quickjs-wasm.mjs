// Keeps `wasm-html-to-image/quickjs.wasm` working: the QuickJS wasm now belongs to `wasm-quickjs-dom`, whose copy is
// placed in dist/ so the old import (`import wasm from "wasm-html-to-image/quickjs.wasm"`) still finds a module.
//
// Usage (from `packages/html-to-image/`): node scripts/copy-quickjs-wasm.mjs
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
mkdirSync(join(root, "dist"), { recursive: true });
copyFileSync(require.resolve("wasm-quickjs-dom/quickjs.wasm"), join(root, "dist", "quickjs.wasm"));
writeFileSync(join(root, "dist", "quickjs-wasm.d.ts"), "declare const quickjsWasm: WebAssembly.Module;\nexport default quickjsWasm;\n");
