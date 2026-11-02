/**
 * Ambient declaration for Emscripten `.wasm` artifacts imported as
 * pre-compiled `WebAssembly.Module` (Cloudflare Workers / workerd).
 * Used by `src/workerd.ts` (`../dist/html-to-image.wasm`).
 */
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
