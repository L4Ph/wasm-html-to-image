/**
 * Ambient declaration for Emscripten `.wasm` artifacts imported as
 * pre-compiled `WebAssembly.Module` (Cloudflare Workers / workerd).
 * Used by `src/workerd.ts` (`../dist/html-to-image.wasm`).
 */
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

/**
 * `#quickjs-wasm` (the `imports` field of package.json) is one of `src/quickjs-{workerd,node,web}.ts` depending on the
 * runtime; each default-exports this function.
 */
declare module "#quickjs-wasm" {
  const defaultQuickJSWasm: () => Promise<WebAssembly.Module | undefined>;
  export default defaultQuickJSWasm;
}

/** The `?module` form of the Vercel / Next.js Edge bundlers: a pre-compiled module (used by `src/quickjs-edge-light.ts`). */
declare module "*.wasm?module" {
  const module: WebAssembly.Module;
  export default module;
}
