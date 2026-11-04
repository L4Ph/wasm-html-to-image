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

// QuickJS recurses on the wasm stack: STACK_LIMIT in src/page.ts (192 KiB) only works while the stack is larger than it.
// Emscripten's default was 64 KB (4.x) and -Wl,-z,stack-size did not survive the link (emcc appends its own stack size
// after the user's flags, so the default won). 1 MiB keeps a 5x margin over the JS-side limit.
const STACK_BYTES = 1024 * 1024;

function emccVersion() {
  try {
    const match = execSync("emcc --version", { encoding: "utf8" }).match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1, 4).map(Number) : undefined;
  } catch {
    return undefined; // the build below reports the missing emcc
  }
}
const version = emccVersion();
// STACK_SIZE is the current name (Emscripten >= 3.1.28); older emsdk calls the same setting TOTAL_STACK.
const useStackSize = !version || version[0] > 3 || (version[0] === 3 && (version[1] > 1 || (version[1] === 1 && version[2] >= 28)));
const stackFlag = `-s${useStackSize ? "STACK_SIZE" : "TOTAL_STACK"}=${STACK_BYTES}`;

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
  stackFlag,
  // the check below reads the real stack size: wasm-ld puts the stack first, so __stack_pointer starts near
  // STACK_SIZE and emscripten_stack_get_base() - emscripten_stack_get_end() is exactly the stack
  "-Wl,--export=emscripten_stack_init",
  "-Wl,--export=emscripten_stack_get_base",
  "-Wl,--export=emscripten_stack_get_end",
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
const wasm = new WebAssembly.Module(readFileSync(out));
const stray = WebAssembly.Module.imports(wasm).map((i) => `${i.module}.${i.name}`).filter((n) => !allowed.test(n));
if (stray.length) throw new Error(`build-quickjs: unexpected imports: ${stray.join(", ")}`);

// Verify the stack that was actually linked (not just the flag that was passed). Instantiate without _initialize: only
// emscripten_stack_init() runs, so no constructor or host import is exercised.
function linkedStackBytes(module) {
  const exports = WebAssembly.Module.exports(module);
  const missing = ["emscripten_stack_init", "emscripten_stack_get_base", "emscripten_stack_get_end"].filter(
    (name) => !exports.some((e) => e.name === name && e.kind === "function"),
  );
  if (missing.length) return undefined;
  const imports = {};
  for (const i of WebAssembly.Module.imports(module)) (imports[i.module] ??= {})[i.name] = () => 0;
  const { exports: x } = new WebAssembly.Instance(module, imports);
  x.emscripten_stack_init();
  return x.emscripten_stack_get_base() - x.emscripten_stack_get_end();
}
const stackBytes = linkedStackBytes(wasm);
if (stackBytes === undefined) throw new Error("build-quickjs: the wasm does not export emscripten_stack_get_base/get_end, so its stack size cannot be checked");
if (stackBytes < STACK_BYTES) throw new Error(`build-quickjs: quickjs.wasm has only ${stackBytes} bytes of stack (expected >= ${STACK_BYTES}); ${stackFlag} did not take effect`);
// src/page.ts clamps STACK_LIMIT against this: a wasm module cannot expose a constant otherwise.
function leb128(n) {
  const bytes = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    bytes.push(byte);
  } while (n);
  return bytes;
}
function withStackSection(binary, bytes) {
  const name = new TextEncoder().encode("quickjs-stack");
  const payload = [...leb128(name.length), ...name, bytes & 0xff, (bytes >>> 8) & 0xff, (bytes >>> 16) & 0xff, (bytes >>> 24) & 0xff];
  const section = [0, ...leb128(payload.length), ...payload];
  return Buffer.concat([binary.subarray(0, 8), Buffer.from(section), binary.subarray(8)]);
}
const patched = withStackSection(readFileSync(out), stackBytes);
const recorded = new DataView(WebAssembly.Module.customSections(new WebAssembly.Module(patched), "quickjs-stack")[0]).getUint32(0, true);
if (recorded !== stackBytes) throw new Error(`build-quickjs: the stack section records ${recorded}, expected ${stackBytes}`);
writeFileSync(out, patched);
// what `import wasm from "wasm-quickjs-dom/quickjs.wasm"` is typed as (bundlers for Workers give a compiled module)
writeFileSync(join(root, "dist", "quickjs-wasm.d.ts"), "declare const quickjsWasm: WebAssembly.Module;\nexport default quickjsWasm;\n");
console.log(`quickjs.wasm: ${(statSync(out).size / 1024).toFixed(0)} KiB, stack ${(stackBytes / 1024).toFixed(0)} KiB`);
