/**
 * `#quickjs-wasm` on Cloudflare Workers (the `workerd` condition of `imports` in package.json): the wasm is imported
 * as a pre-compiled `WebAssembly.Module`, because workerd cannot compile WebAssembly at run time.
 */
import quickjsWasm from "../dist/quickjs.wasm";

export default function defaultQuickJSWasm(): Promise<WebAssembly.Module | undefined> {
  return Promise.resolve(quickjsWasm);
}
