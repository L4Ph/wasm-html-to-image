import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

const PAGE =
  '<!doctype html><html><head><title>t</title></head><body><h1 id="t">empty</h1>' +
  '<script>document.getElementById("t").textContent = "Rendered"; console.log("hello from page"); setTimeout(function () { var p = document.createElement("p"); p.id = "late"; document.body.appendChild(p); }, 200);</script>' +
  '<script src="/tracker.js"></script></body></html>';

let server: Server;
let origin: string;
let dir: string;
const requested: string[] = [];
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "qjsdom-cli-"));
  server = createServer((req, res) => {
    requested.push(req.url ?? "");
    if (req.url === "/tracker.js") {
      res.setHeader("content-type", "text/javascript");
      res.end('document.body.setAttribute("data-tracked", "1");');
    } else {
      res.setHeader("content-type", "text/html");
      res.end(PAGE);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function cli(args: string[], stdin = "") {
  let out = "";
  let err = "";
  const code = await run(args, { stdin: async () => stdin, stdout: (t) => (out += t), stderr: (t) => (err += t) }, "9.9.9");
  return { code, out, err };
}

describe("wasm-quickjs-dom command", () => {
  it("prints the HTML of a URL after its scripts ran", async () => {
    const { code, out, err } = await cli([`${origin}/`, "--settle", "0"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain('<h1 id="t">Rendered</h1>');
    expect(out).toContain('data-tracked="1"');
  });

  it("--wait waits for an element, --settle 0 does not", async () => {
    expect((await cli([`${origin}/`, "--settle", "0"])).out).not.toContain('id="late"');
    expect((await cli([`${origin}/`, "--wait", "#late"])).out).toContain('<p id="late">');
  });

  it("--eval prints the value (a string as it is, anything else as JSON)", async () => {
    expect((await cli([`${origin}/`, "--settle", "0", "-e", "document.getElementById('t').textContent"])).out).toBe("Rendered\n");
    expect(JSON.parse((await cli([`${origin}/`, "--settle", "0", "-e", "({ n: 1 + 1, ok: true })"])).out)).toEqual({ n: 2, ok: true });
    const failed = await cli([`${origin}/`, "--settle", "0", "-e", "throw new Error('boom')"]);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain("boom");
  });

  it("--logs writes what happened in the page to standard error; --json has it all", async () => {
    const { out, err } = await cli([`${origin}/`, "--settle", "0", "--logs"]);
    expect(err).toContain("console.log: hello from page");
    expect(err).toMatch(/GET http:\/\/127\.0\.0\.1:\d+\/tracker\.js -> 200/);
    expect(out).toContain("Rendered");
    const json = JSON.parse((await cli([`${origin}/`, "--settle", "0", "--json"])).out);
    expect(json.baseUrl).toBe(`${origin}/`);
    expect(json.html).toContain("Rendered");
    expect(json.logs.some((e: { type: string }) => e.type === "request")).toBe(true);
  });

  it("reads a file or standard input, with --base-url for what they load", async () => {
    const file = join(dir, "page.html");
    writeFileSync(file, '<!doctype html><body><p id="p">0</p><script>document.getElementById("p").textContent = "file";</script><script src="/tracker.js"></script></body>');
    const fromFile = await cli([file, "--settle", "0", "--base-url", `${origin}/`]);
    expect(fromFile.out).toContain('<p id="p">file</p>');
    expect(fromFile.out).toContain('data-tracked="1"'); // /tracker.js came from the base URL
    const fromStdin = await cli(["-", "--settle", "0"], '<p id="p">0</p><script>document.getElementById("p").textContent = "stdin";</script>');
    expect(fromStdin.out).toContain(">stdin<");
    const missing = await cli([join(dir, "nope.html")]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("cannot read");
  });

  it("-o writes a file instead of standard output", async () => {
    const target = join(dir, "out.html");
    const { code, out } = await cli([`${origin}/`, "--settle", "0", "-o", target]);
    expect(code).toBe(0);
    expect(out).toBe("");
    expect(readFileSync(target, "utf8")).toContain("Rendered");
  });

  it("--skip keeps matching URLs off the network; limits refuse the rest", async () => {
    requested.length = 0;
    const skipped = await cli([`${origin}/`, "--settle", "0", "--skip", "tracker"]);
    expect(skipped.out).not.toContain("data-tracked");
    expect(requested).not.toContain("/tracker.js");
    const blocked = await cli([`${origin}/`, "--block-private"]);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("Blocked by the fetch limits");
    const allowed = await cli([`${origin}/`, "--settle", "0", "--allow-host", "127.0.0.1", "--protocol", "http:"]);
    expect(allowed.code).toBe(0);
  });

  it("usage errors exit with 2; --help and --version exit with 0", async () => {
    for (const args of [[], ["a", "b"], ["--nope", "x"], [`${origin}/`, "--settle", "abc"], [`${origin}/`, "--json", "-e", "1"]]) {
      const r = await cli(args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.err).toContain("wasm-quickjs-dom:");
    }
    expect((await cli(["--help"])).out).toContain("Usage: wasm-quickjs-dom");
    expect(await cli(["--version"])).toEqual({ code: 0, out: "9.9.9\n", err: "" });
  });

  it("a page that cannot be loaded exits with 1 and says why", async () => {
    const r = await cli(["http://127.0.0.1:1/", "--timeout", "2000"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/fetch failed|ECONNREFUSED/);
  });

  it("--stylesheets enables fetching linked stylesheets", async () => {
    const r = await cli([`${origin}/`, "--stylesheets", "--settle", "0"]);
    expect(r.code).toBe(0);
  });
});
