/**
 * The `wasm-quickjs-dom` command: load a page, let its scripts run, print the result.
 *
 *   wasm-quickjs-dom https://example.com/ --wait "#app" > rendered.html
 *   wasm-quickjs-dom page.html --base-url https://example.com/ -e "document.title"
 *   curl -s https://example.com/ | wasm-quickjs-dom - --base-url https://example.com/
 *
 * `run` takes its streams as arguments so it can be tested; `bin.ts` wires it to the process.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDOM, type CreateDOMOptions, type FetchLimits, type PageLogEntry } from "./index.js";

export interface CliIO {
  /** Everything of standard input (read only when the input is `-`). */
  stdin(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
}

const HELP = `wasm-quickjs-dom - run a page's scripts in QuickJS (WebAssembly) and print the result

Usage: wasm-quickjs-dom [options] <url | file | ->

  <url>      an http(s) page to fetch and run
  <file>     an HTML file ("-" reads standard input); use --base-url to say where it belongs,
             which is also where its relative scripts are fetched from

Output (default: the HTML as it is after the scripts ran)
  -o, --output <file>      write to a file instead of standard output
  -e, --eval <code>        print the value of this code, run in the page (strings as they are, the rest as JSON)
      --json               print { baseUrl, html, logs } as JSON
      --logs               also print what happened in the page (console, errors, rejections, requests) to standard error

Running
      --wait <selector>    wait until a CSS selector matches (up to --timeout)
      --settle <ms>        at most this long for timers and requests after load (default 1000; ends early when idle)
      --timeout <ms>       upper limit for the scripts (default 10000)
      --width <px>         window width of the page (default 800)
      --base-url <url>     the page's URL, for file and standard input

Limits (set these for pages you do not control)
      --protocol <p>       allowed protocol such as https: (repeatable)
      --allow-host <host>  only these hosts may be fetched (repeatable)
      --block-host <host>  these hosts may not be fetched (repeatable)
      --block-private      refuse localhost and private networks
      --max-bytes <n>      refuse a response over n bytes
      --max-requests <n>   at most n requests
      --skip <text>        do not fetch URLs containing text (repeatable; analytics, ads, ...)

  -h, --help               show this help
  -v, --version            show the version
`;

const fail = (io: CliIO, message: string): number => {
  io.stderr(`wasm-quickjs-dom: ${message}\n`);
  return 2;
};

/** An error's message with the reason under it (Node's `fetch failed` hides the real one in `cause`). */
function describe(error: unknown): string {
  const e = error as Error & { cause?: { message?: string; code?: string } };
  const why = e.cause?.message ?? e.cause?.code;
  return why && !e.message.includes(why) ? `${e.message}: ${why}` : e.message;
}

function number(name: string, value: string | undefined): number | undefined | Error {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : new Error(`--${name} needs a number, got "${value}"`);
}

function formatLog(entry: PageLogEntry): string {
  switch (entry.type) {
    case "console":
      return `console.${entry.level}: ${entry.message}`;
    case "error":
      return `error in ${entry.source}: ${entry.message.trim()}`;
    case "rejection":
      return `unhandled rejection: ${entry.message.trim()}`;
    case "request":
      return `${entry.method} ${entry.url} -> ${entry.error ?? entry.status}`;
  }
}

/** Run the command. Returns the exit code: 0 done, 1 the page could not be loaded, 2 wrong usage. */
export async function run(argv: string[], io: CliIO, version = "0.0.0"): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        eval: { type: "string", short: "e" },
        json: { type: "boolean" },
        logs: { type: "boolean" },
        wait: { type: "string" },
        settle: { type: "string" },
        timeout: { type: "string" },
        width: { type: "string" },
        "base-url": { type: "string" },
        protocol: { type: "string", multiple: true },
        "allow-host": { type: "string", multiple: true },
        "block-host": { type: "string", multiple: true },
        "block-private": { type: "boolean" },
        "max-bytes": { type: "string" },
        "max-requests": { type: "string" },
        skip: { type: "string", multiple: true },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    return fail(io, `${(error as Error).message}\nTry --help.`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${version}\n`);
    return 0;
  }
  if (positionals.length !== 1) return fail(io, `give exactly one page (a URL, a file, or - for standard input)\nTry --help.`);
  if (values.json && values.eval !== undefined) return fail(io, "--json and --eval cannot be used together");

  const numbers = {
    settle: number("settle", values.settle),
    timeout: number("timeout", values.timeout),
    width: number("width", values.width),
    maxBytes: number("max-bytes", values["max-bytes"]),
    maxRequests: number("max-requests", values["max-requests"]),
  };
  for (const v of Object.values(numbers)) if (v instanceof Error) return fail(io, v.message);
  const n = numbers as Record<keyof typeof numbers, number | undefined>;

  const limits: FetchLimits = {
    allowedProtocols: values.protocol,
    allowedHosts: values["allow-host"],
    blockedHosts: values["block-host"],
    blockPrivateHosts: values["block-private"] || undefined,
    maxResourceBytes: n.maxBytes,
    maxResourceCount: n.maxRequests,
  };
  const skips = values.skip ?? [];
  const options: CreateDOMOptions = {
    settleMs: n.settle,
    timeout: n.timeout,
    waitFor: values.wait,
    width: n.width,
    limits,
    skip: skips.length ? (url) => skips.some((s) => url.includes(s)) : undefined,
  };

  const input = positionals[0];
  let source: { url?: string; html?: string; baseUrl?: string };
  try {
    if (/^https?:\/\//i.test(input)) source = { url: input };
    else source = { html: input === "-" ? await io.stdin() : readFileSync(input, "utf8"), baseUrl: values["base-url"] };
  } catch (error) {
    return fail(io, `cannot read ${input}: ${(error as Error).message}`);
  }

  let dom;
  try {
    dom = await createDOM(source, options);
  } catch (error) {
    io.stderr(`wasm-quickjs-dom: ${describe(error)}\n`);
    return 1;
  }
  try {
    let out: string;
    if (values.eval !== undefined) {
      const value = await dom.eval(values.eval);
      out = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "undefined";
    } else if (values.json) {
      out = JSON.stringify({ baseUrl: dom.baseUrl, html: dom.serialize(), logs: dom.logs }, null, 2);
    } else {
      out = dom.serialize();
    }
    if (values.logs) for (const entry of dom.logs) io.stderr(`${formatLog(entry)}\n`);
    if (values.output) writeFileSync(values.output, out.endsWith("\n") ? out : `${out}\n`);
    else io.stdout(out.endsWith("\n") ? out : `${out}\n`);
    return 0;
  } catch (error) {
    if (values.logs) for (const entry of dom.logs) io.stderr(`${formatLog(entry)}\n`);
    io.stderr(`wasm-quickjs-dom: ${(error as Error).message}\n`);
    return 1;
  } finally {
    dom.close();
  }
}
