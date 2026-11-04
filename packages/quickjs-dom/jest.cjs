// A Jest environment: the test file's globals (document, window, HTMLElement, Event, ...) are the page's.
//
//   // jest.config.js
//   module.exports = { testEnvironment: "wasm-quickjs-dom/jest" };
//
// Options go in `testEnvironmentOptions` (those of JSDOMOptions: url, html, ...). Needs jest-environment-node (it comes
// with Jest). The page's errors (SyntaxError, TypeError, ...) are those of the realm this runs in, not of the test's.
"use strict";
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { TestEnvironment } = require("jest-environment-node");

// The environment runs the built package. When dist is missing, say what to do instead of failing deep inside setup().
const built = (file) => {
  const path = join(__dirname, "dist", file);
  if (!existsSync(path)) throw new Error(`wasm-quickjs-dom: ${path} is missing; run "npm run build" first.`);
  return pathToFileURL(path).href;
};

class WasmQuickJSDomEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.options = (config.projectConfig && config.projectConfig.testEnvironmentOptions) || {};
  }

  async setup() {
    await super.setup();
    const { JSDOM } = await import(built("jsdom.js"));
    const { installWindow } = await import(built("globals.js"));
    const o = this.options;
    this.dom = new JSDOM(o.html || "<!DOCTYPE html>", { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously", ...o });
    this.uninstall = installWindow(this.global, this.dom.window);
  }

  async teardown() {
    // Teardown target: the synchronous close of this page only. The timer is unref'd where it is armed,
    // and the shared fragment context is left alone.
    if (this.uninstall) this.uninstall();
    if (this.dom) this.dom.close();
    await super.teardown();
  }
}

module.exports = WasmQuickJSDomEnvironment;
