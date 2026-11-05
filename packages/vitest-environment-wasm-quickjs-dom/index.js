// Vitest loads an environment by the name `vitest-environment-<name>`, resolved from the project's root. This package is
// that name for `wasm-quickjs-dom`, so a config can say `environment: "wasm-quickjs-dom"` and nothing else, however the
// package manager lays out node_modules (pnpm does not hoist, so the environment of a dependency of another package is
// not reachable by its own name from the root of a monorepo).
export { default } from "wasm-quickjs-dom/vitest";
