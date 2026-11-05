const { waitFor } = require("@testing-library/dom");

for (const kind of ["modern", "legacy"]) {
  test(`${kind} fake timers: a page timer and waitFor`, async () => {
    jest.useFakeTimers({ legacyFakeTimers: kind === "legacy" });
    try {
      document.body.innerHTML = "<div id=out></div>";
      window.eval(`setTimeout(function () { document.getElementById("out").textContent = "ready" }, 300)`);
      jest.advanceTimersByTime(299);
      expect(document.getElementById("out").textContent).toBe("");
      jest.advanceTimersByTime(2);
      await Promise.resolve();
      await new Promise((r) => jest.requireActual("timers").setImmediate(r));
      expect(document.getElementById("out").textContent).toBe("ready");
      document.body.innerHTML = "<div id=out></div>";
      window.eval(`setTimeout(function () { document.getElementById("out").textContent = "again" }, 300)`);
      await waitFor(() => expect(document.getElementById("out").textContent).toBe("again"), { timeout: 2000 });
    } finally {
      jest.useRealTimers();
    }
  });
}
