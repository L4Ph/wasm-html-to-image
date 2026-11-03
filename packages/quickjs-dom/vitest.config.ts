import { defineConfig } from "vitest/config";

// The CLI tests spawn a node process and the jsdom ones load jsdom: under a loaded machine
// (the visual tests running beside them) the first of each takes longer than the default 5 s.
const testTimeout = 30_000;

export default defineConfig({
  test: {
    testTimeout,
    projects: [
      { extends: true, test: { name: "node", include: ["tests/*.test.ts"] } },
      // the tests of the Vitest environment run in it (tests/env/)
      { extends: true, test: { name: "dom-environment", include: ["tests/env/**/*.test.{ts,tsx}"], environment: "./src/vitest.ts" } },
    ],
  },
});
