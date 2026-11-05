import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(pkgDir, "package.json"));
const vitestBin = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const fixture = path.join(pkgDir, "tests", "fixtures", "dom.fixture.ts").split(path.sep).join("/");

// A config one level above the package, like a monorepo's root config that lists the projects of the packages below it.
const configDir = path.dirname(pkgDir);

const run = (config: string) => {
  const configFile = path.join(configDir, `vitest.fixture-${process.pid}-${Math.random().toString(36).slice(2)}.config.mjs`);
  writeFileSync(configFile, config);
  try {
    const result = spawnSync(process.execPath, [vitestBin, "run", "--config", configFile], { cwd: configDir, encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(configFile, { force: true });
  }
};

/** A project that runs the fixture under `environment`; `root` is the project's root. The name is looked up from it. */
const project = (environment: string, root?: string) => `
export default { test: { projects: [{ ${root ? `root: ${JSON.stringify(root.split(path.sep).join("/"))},` : ""} test: {
  environment: ${JSON.stringify(environment)},
  environmentOptions: { wasmQuickjsDom: { url: "http://example.test/" } },
  include: [${JSON.stringify(fixture)}],
} }] } };`;

describe("the environment name Vitest looks for", () => {
  it('environment: "wasm-quickjs-dom" gives the page', () => {
    const { status, output } = run(project("wasm-quickjs-dom", pkgDir));
    expect(output).toContain("1 passed");
    expect(status).toBe(0);
  });

  it('environment: "wasm-quickjs-dom/vitest" (the form the wasm-quickjs-dom README used) resolves too', () => {
    const { status, output } = run(project("wasm-quickjs-dom/vitest", pkgDir));
    expect(output).toContain("1 passed");
    expect(status).toBe(0);
  });

  it("an unknown name fails, so the passes above are the package's doing", () => {
    const { status, output } = run(project("wasm-quickjs-dom-nope", pkgDir));
    expect(status).not.toBe(0);
    expect(output).toMatch(/wasm-quickjs-dom-nope/);
  });
});

describe("the package", () => {
  const read = (rel: string) => JSON.parse(readFileSync(path.join(pkgDir, rel), "utf8")) as Record<string, any>;
  it("has the version of wasm-quickjs-dom and depends on the one beside it", () => {
    const me = read("package.json");
    const qjs = read("../quickjs-dom/package.json");
    expect(me.version).toBe(qjs.version);
    expect(me.dependencies["wasm-quickjs-dom"]).toBe("workspace:*"); // pnpm publish writes the exact version
  });
});
