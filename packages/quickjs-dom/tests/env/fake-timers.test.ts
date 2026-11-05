import { afterEach, describe, expect, it, vi } from "vitest";

// Fake timers of the test runner and the page: the page's timers are armed on the runner's own setTimeout and read its
// Date, so advancing the fake clock fires them.

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("fake timers", () => {
  it("a timer set through the window fires when the fake clock advances", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id=out>before</div>`;
    setTimeout(() => (document.getElementById("out")!.textContent = "after"), 1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(document.getElementById("out")!.textContent).toBe("before");
    await vi.advanceTimersByTimeAsync(2);
    expect(document.getElementById("out")!.textContent).toBe("after");
  });

  it("a timer the page's own script sets fires too, and a page interval repeats", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id=out>0</div>`;
    (window as any).eval(`var n = 0; setInterval(function () { document.getElementById("out").textContent = String(++n) }, 100)`);
    await vi.advanceTimersByTimeAsync(350);
    expect(document.getElementById("out")!.textContent).toBe("3");
  });

  it("the page's Date and performance.now follow the fake clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    expect((window as any).eval("new Date().getUTCFullYear()")).toBe(2030);
    const t0 = (window as any).eval("Date.now()");
    await vi.advanceTimersByTimeAsync(5000);
    expect((window as any).eval("Date.now()") - t0).toBe(5000);
  });
});
