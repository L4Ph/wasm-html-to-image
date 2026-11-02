/**
 * `#quickjs-wasm` on Vercel Edge and the Next.js Edge runtime (the `edge-light` condition of `imports` in package.json):
 * their bundlers turn `import x from "….wasm?module"` into a pre-compiled `WebAssembly.Module`, since the runtime
 * cannot compile WebAssembly from bytes it fetches.
 */
import quickjsWasm from "../dist/quickjs.wasm?module";

export default function defaultQuickJSWasm(): Promise<WebAssembly.Module | undefined> {
  return Promise.resolve(quickjsWasm);
}
