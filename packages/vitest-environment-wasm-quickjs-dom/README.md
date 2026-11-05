# vitest-environment-wasm-quickjs-dom

The [`wasm-quickjs-dom`](https://www.npmjs.com/package/wasm-quickjs-dom) environment for [Vitest](https://vitest.dev/), under the name Vitest looks for.

Vitest turns `environment: "<name>"` into the package `vitest-environment-<name>` and resolves it from the project's root. This package is that name, so the config is one line, whatever the package manager does with `node_modules` (pnpm does not hoist, which is what breaks a path or a subpath of another package in a monorepo).

```sh
pnpm add -D vitest vitest-environment-wasm-quickjs-dom
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "wasm-quickjs-dom",
    environmentOptions: {
      wasmQuickjsDom: { url: "http://localhost:3000" }, // any JSDOMOptions
    },
  },
});
```

In a monorepo whose root config lists the projects of the packages, give each project its own `root`, so the environment is looked up from the package that depends on it:

```ts
projects: [
  {
    root: "apps/app",
    test: { environment: "wasm-quickjs-dom", include: ["test/client/**/*.test.tsx"] },
  },
],
```

The environment itself is `wasm-quickjs-dom/vitest`; its options and what it provides are described in the [`wasm-quickjs-dom` README](https://www.npmjs.com/package/wasm-quickjs-dom). This package has the same version as `wasm-quickjs-dom` and depends on exactly that version.
