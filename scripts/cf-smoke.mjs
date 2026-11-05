// Shared `cf dev` harness for the Cloudflare package smoke scripts.
//
// Both `packages/e2e-cloudflare` and `examples/cloudflare-ogp` used to carry a
// near-identical copy of the start/wait/stop plumbing. This module owns it:
// the package scripts only declare the route assertions they care about.
//
// Usage:
//   import { runCfSmoke } from "../../../scripts/cf-smoke.mjs";
//   process.exitCode = await runCfSmoke({ pkgDir, checks: [async (base) => {...}] });
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const PNG_MAGIC = "89504e47";
export const READY_TIMEOUT_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 180_000;

/** Allocate a free loopback port. */
export function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port =
        typeof addr === "object" && addr !== null ? addr.port : undefined;
      if (!port) {
        server.close(() => reject(new Error("could not allocate port")));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/** Lower-case hex of the first four bytes. */
export function headHex(bytes) {
  return Array.from(bytes.subarray(0, 4))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

export function assert(cond, message) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}

/** Spawn `cf dev` in `pkgDir` on `port`; output is buffered for failure logs. */
export function startCfDev(pkgDir, port) {
  const require = createRequire(path.join(pkgDir, "package.json"));
  const cfEntry = path.join(path.dirname(require.resolve("cf/package.json")), "bin", "cf");
  const child = spawn(process.execPath, [cfEntry, "dev", "--port", String(port)], {
    cwd: pkgDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BROWSER: "none",
      CI: "true",
      CF_SEND_TELEMETRY: "false",
      CF_QUIET: "1",
    },
  });
  let output = "";
  const onData = (d) => {
    const s = String(d);
    output += s;
    if (output.length > 20000) output = output.slice(-20000);
    process.stdout.write(`[cf] ${s}`);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (e) => {
    output += `\n[spawn error] ${e}\n`;
  });
  return { child, output: () => output };
}

/**
 * Poll an unknown route until the worker answers. Any HTTP status means the
 * workerd is serving; connection errors mean "not yet".
 */
export async function waitForReady(base, child, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `cf dev exited early (code=${child.exitCode} signal=${child.signalCode})`,
      );
    }
    try {
      const res = await fetch(`${base}/__smoke__`, {
        signal: AbortSignal.timeout(5000),
      });
      await res.text().catch(() => "");
      return;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() >= deadline) {
      throw new Error(`cf dev not ready within ${timeoutMs}ms: ${lastError}`);
    }
    await delay(1000);
  }
}

/** Terminate `cf` and its workerd children, then print the tail on failure. */
export async function stopCf(child, output = "") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      // Kill the whole process tree (cf spawns workerd children).
      await new Promise((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
        const done = () => resolve();
        killer.on("exit", done);
        killer.on("error", done);
        setTimeout(done, 10_000);
      });
    } else {
      child.kill("SIGTERM");
      const exited = await Promise.race([
        new Promise((resolve) => {
          child.on("exit", () => resolve(true));
        }),
        delay(10_000).then(() => false),
      ]);
      if (!exited) child.kill("SIGKILL");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
  if (output.length > 0) {
    console.log("--- cf output (tail) ---");
    console.log(output.slice(-4000));
  }
}

/** Fetch `path`, assert the status and the PNG magic/length; returns the bytes. */
export async function expectPng(base, route, expectedStatus = 200) {
  const res = await fetch(`${base}${route}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert(res.status === expectedStatus, `GET ${route} status=${res.status}`);
  const hex = headHex(bytes);
  assert(hex === PNG_MAGIC, `GET ${route} magic=${hex}`);
  assert(bytes.length > 100, `GET ${route} length=${bytes.length}`);
  const ct = res.headers.get("content-type") ?? "";
  assert(ct.toLowerCase().includes("image/png"), `GET ${route} content-type=${ct}`);
  console.log(`${route}: ${bytes.length}B png`);
  return bytes;
}

/** Fetch `path` and assert a plain status (no body expectations). */
export async function expectStatus(base, route, expectedStatus) {
  const res = await fetch(`${base}${route}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await res.text().catch(() => "");
  assert(res.status === expectedStatus, `GET ${route} status=${res.status}`);
  console.log(`${route}: ${res.status} ok`);
}

/**
 * Start `cf dev` for `pkgDir`, run every `check(base)`, and always stop the
 * worker. Returns the process exit code (0 = all checks passed).
 */
export async function runCfSmoke({ pkgDir, checks, readyTimeoutMs = READY_TIMEOUT_MS }) {
  const port = await getFreePort();
  const base = `http://127.0.0.1:${port}`;
  console.log(`[smoke] starting cf dev (${path.basename(pkgDir)}) on port ${port}`);
  const { child, output } = startCfDev(pkgDir, port);
  let failed = false;
  try {
    // Fail fast if cf exits before becoming ready.
    const earlyExit = new Promise((_, reject) => {
      child.on("exit", (code, signal) => {
        reject(
          new Error(
            `cf dev exited early (code=${code} signal=${signal})\n${output().slice(-4000)}`,
          ),
        );
      });
    });
    // The race below consumes the rejection while waiting for readiness; a
    // later exit must not surface as an unhandled rejection.
    earlyExit.catch(() => {});
    await Promise.race([waitForReady(base, child, readyTimeoutMs), earlyExit]);
    console.log(`[smoke] cf dev ready on port ${port}`);
    for (const check of checks) await check(base);
    console.log("smoke: all assertions passed");
  } catch (e) {
    failed = true;
    console.error(String(e?.stack ?? e));
  } finally {
    await stopCf(child, failed ? output() : "");
    // Give the OS a moment to release the port / reap children.
    await delay(1000);
  }
  return failed ? 1 : 0;
}
