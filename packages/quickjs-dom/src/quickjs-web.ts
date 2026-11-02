/**
 * `#quickjs-wasm` for Deno, browsers, Vercel Edge and anything else (the default of `imports` in package.json):
 * `quickjs.wasm` is fetched from beside this file and compiled once. `undefined` when that fails (the library then
 * loads its own copy on every run).
 */
let compiled: Promise<WebAssembly.Module | undefined> | undefined;

export default function defaultQuickJSWasm(): Promise<WebAssembly.Module | undefined> {
  compiled ??= (async () => {
    try {
      const url = new URL("./quickjs.wasm", import.meta.url);
      if (url.protocol === "file:") {
        const read = (globalThis as { Deno?: { readFile(u: URL): Promise<Uint8Array> } }).Deno?.readFile;
        if (read) return await WebAssembly.compile((await read(url)) as BufferSource);
      }
      return await WebAssembly.compile(await (await fetch(url)).arrayBuffer());
    } catch {
      return undefined;
    }
  })();
  return compiled;
}
