import { expect, it } from "vitest";

// run by environment.test.ts under the environment being tried
it("has a DOM from wasm-quickjs-dom", () => {
  document.body.innerHTML = '<p id="a" class="x">hi</p>';
  expect(document.getElementById("a")?.className).toBe("x");
  expect(location.href).toBe("http://example.test/");
  expect(typeof (window as unknown as { Window?: unknown }).Window).toBe("function");
});
