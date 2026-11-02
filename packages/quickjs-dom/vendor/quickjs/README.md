# vendor/quickjs

The core of [QuickJS-ng](https://github.com/quickjs-ng/quickjs) **v0.18.0** (tag `v0.18.0`, commit `d7215b0`), unmodified: the files `scripts/build-quickjs.mjs` compiles (`quickjs.c`, `libregexp.c`, `libunicode.c`, `dtoa.c`) and the headers they include. To update it, copy the same files from a newer tag, then rebuild: the guest program's bytecode (`dist/edge-js-payload.js`) only runs on the QuickJS it was made with, and `pnpm build` makes both together.
