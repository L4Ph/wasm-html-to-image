// Builds dist/quickjs.wasm: QuickJS-ng (vendor/quickjs) plus csrc/qjsdom.c as a standalone WebAssembly module, with
// Emscripten (`emcc` on PATH, as set up by emsdk). No Emscripten JS glue is produced: src/runtime.ts instantiates it.
//
// Usage (from `packages/quickjs-dom/`): node scripts/build-quickjs.mjs
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor", "quickjs");
const out = join(root, "dist", "quickjs.wasm");
mkdirSync(join(root, "dist"), { recursive: true });

const args = [
  "-O2",
  "-D_GNU_SOURCE",
  "-DNDEBUG",
  `-I${vendor}`,
  join(root, "csrc", "qjsdom.c"),
  join(vendor, "quickjs.c"),
  join(vendor, "libregexp.c"),
  join(vendor, "libunicode.c"),
  join(vendor, "dtoa.c"),
  "-o",
  out,
  "--no-entry",
  "-sSTANDALONE_WASM=1",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sINITIAL_MEMORY=16777216",
  // the `host` imports (see csrc/qjsdom.c) are undefined to the linker on purpose; the check below catches stray ones
  "-sERROR_ON_UNDEFINED_SYMBOLS=0",
  "-Wl,-z,stack-size=1048576",
];
try {
  execSync(["emcc", ...args.map((a) => JSON.stringify(a))].join(" "), { stdio: "inherit" });
} catch (error) {
  throw new Error(
    "build-quickjs: could not run `emcc` (Emscripten). Install emsdk and put emcc on PATH (the repository's wasm build needs it too).",
    { cause: error },
  );
}
// every import must be one src/runtime.ts provides
const allowed = /^(host\.(call|module)|wasi_snapshot_preview1\.\w+|env\.emscripten_notify_memory_growth)$/;
const stray = WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(out))).map((i) => `${i.module}.${i.name}`).filter((n) => !allowed.test(n));
if (stray.length) throw new Error(`build-quickjs: unexpected imports: ${stray.join(", ")}`);
// what `import wasm from "wasm-quickjs-dom/quickjs.wasm"` is typed as (bundlers for Workers give a compiled module)
writeFileSync(join(root, "dist", "quickjs-wasm.d.ts"), "declare const quickjsWasm: WebAssembly.Module;\nexport default quickjsWasm;\n");
console.log(`quickjs.wasm: ${(statSync(out).size / 1024).toFixed(0)} KiB`);
