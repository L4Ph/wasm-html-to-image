import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The CLI tests spawn a node process and the jsdom ones load jsdom: under a loaded machine
    // (the visual tests running beside them) the first of each takes longer than the default 5 s.
    testTimeout: 30_000,
  },
});
