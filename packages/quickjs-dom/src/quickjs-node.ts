/**
 * `#quickjs-wasm` on Node.js and Bun (the `node` condition of `imports` in package.json): the package's own
 * `quickjs.wasm`, read from beside this file and compiled once. `undefined` when it cannot be read (the library
 * then loads its own copy on every run).
 */
let compiled: Promise<WebAssembly.Module | undefined> | undefined;

export default function defaultQuickJSWasm(): Promise<WebAssembly.Module | undefined> {
  compiled ??= (async () => {
    try {
      const fs = "node:fs/promises", url = "node:url"; // not literals: a bundler must not try to resolve them
      const file = (await import(/* @vite-ignore */ url)).fileURLToPath(new URL("./quickjs.wasm", import.meta.url));
      const bytes: Uint8Array = await (await import(/* @vite-ignore */ fs)).readFile(file);
      return await WebAssembly.compile(bytes as BufferSource);
    } catch {
      return undefined;
    }
  })();
  return compiled;
}
