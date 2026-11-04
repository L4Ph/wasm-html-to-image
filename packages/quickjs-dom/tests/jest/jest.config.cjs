module.exports = {
  rootDir: __dirname,
  testEnvironment: "../../jest.cjs",
  testMatch: ["**/*.jest.cjs"],
  transform: {},
  // The options of the environment are resolved in three layers (wasmQuickjsDom, jsdom, then this
  // top level). An explicit undefined in either of the first two must not erase the fallback below
  // it: the test file checks that the top-level url arrives.
  testEnvironmentOptions: {
    url: "http://top.test/",
    jsdom: { url: undefined },
    wasmQuickjsDom: { url: undefined, html: undefined },
  },
};
