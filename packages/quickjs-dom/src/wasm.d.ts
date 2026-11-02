/** A `.wasm` imported by a bundler for Workers is a pre-compiled module (`src/quickjs-workerd.ts`). */
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

/**
 * `#quickjs-wasm` (the `imports` field of package.json) is one of `src/quickjs-{workerd,edge-light,node,web}.ts`
 * depending on the runtime; each default-exports this function.
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
