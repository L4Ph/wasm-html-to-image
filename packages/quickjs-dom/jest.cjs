// A Jest environment: the test file's globals (document, window, HTMLElement, Event, ...) are the page's.
//
//   // jest.config.js
//   module.exports = { testEnvironment: "wasm-quickjs-dom/jest" };
//
// Options go in `testEnvironmentOptions` (those of JSDOMOptions: url, html, ...). Needs jest-environment-node (it comes
// with Jest). The page's errors (SyntaxError, TypeError, ...) are those of the realm this runs in, not of the test's.
"use strict";
const { TestEnvironment } = require("jest-environment-node");

class WasmQuickJSDomEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.options = (config.projectConfig && config.projectConfig.testEnvironmentOptions) || {};
  }

  async setup() {
    await super.setup();
    const { JSDOM } = await import("./dist/jsdom.js");
    const { installWindow } = await import("./dist/globals.js");
    const o = this.options;
    this.dom = new JSDOM(o.html || "<!DOCTYPE html>", { url: "http://localhost/", pretendToBeVisual: true, runScripts: "dangerously", ...o });
    this.uninstall = installWindow(this.global, this.dom.window);
  }

  async teardown() {
    if (this.uninstall) this.uninstall();
    if (this.dom) this.dom.close();
    await super.teardown();
  }
}

module.exports = WasmQuickJSDomEnvironment;
