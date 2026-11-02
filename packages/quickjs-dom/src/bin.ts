#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { run } from "./cli.js";

const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

const code = await run(
  process.argv.slice(2),
  {
    stdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    // a pipe closed early (`| head`) is not an error worth a stack trace
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
  },
  version,
);
process.exitCode = code;
