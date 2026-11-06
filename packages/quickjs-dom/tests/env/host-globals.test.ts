import { afterEach, describe, expect, it, vi } from "vitest";

// What the environment installs on the host's globals, beyond the page's own: the names a test sees, and how the host's
// classes work with what the page hands them.

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("a window function a test replaces", () => {
  it("stays the test's, with its own properties, and calls through to the original", () => {
    const original = window.getComputedStyle;
    let calls = 0;
    const fake = Object.assign((...args: Parameters<typeof original>) => (calls++, original(...args)), { hadOwnProperty: true });
    window.getComputedStyle = fake as typeof original;
    try {
      expect(window.getComputedStyle).toBe(fake);
      expect(getComputedStyle(document.body).display).toBe("block");
      expect(calls).toBe(1);
    } finally {
      window.getComputedStyle = original;
    }
  });
});

describe("names jsdom does not have", () => {
  it("hides ImageData from the test", () => {
    expect(typeof (globalThis as any).ImageData).toBe("undefined");
  });
  it("hides getAnimations", () => {
    expect((document.body as any).getAnimations).toBeUndefined();
  });
});

describe("the page's jobs", () => {
  it("delivers one batch of mutations to a MutationObserver for a whole synchronous change", async () => {
    const seen: number[] = [];
    const observer = new MutationObserver((records) => seen.push(records.length));
    observer.observe(document.body, { childList: true });
    for (let i = 0; i < 5; i++) document.body.appendChild(document.createElement("p"));
    await Promise.resolve();
    await Promise.resolve();
    observer.disconnect();
    expect(seen).toEqual([5]);
  });
});

describe("FormData", () => {
  it("reads a form as a submission would send it, and Node's classes take it", async () => {
    document.body.innerHTML = `<form id="f">
      <input name="text" value="a"><input name="off" value="x" disabled>
      <fieldset disabled><input name="inFieldset" value="x"></fieldset>
      <input type="radio" name="r" value="1"><input type="radio" name="r" value="2" checked>
      <select name="s"><option value="p">P</option><option value="q" selected>Q</option></select>
      <button name="go" value="yes" id="go">go</button><button name="other" value="no">other</button>
    </form>`;
    const form = document.getElementById("f") as HTMLFormElement;
    const data = new FormData(form, document.getElementById("go") as HTMLElement);
    expect([...data.entries()]).toEqual([["text", "a"], ["r", "2"], ["s", "q"], ["go", "yes"]]);
    const body = await new Request("http://localhost/", { method: "POST", body: data }).text();
    expect(body).toContain('name="text"');
  });
});

describe("FileReader", () => {
  const read = (start: (r: FileReader) => void) =>
    new Promise<{ reader: FileReader; events: string[] }>((resolve) => {
      const reader = new FileReader();
      const events: string[] = [];
      for (const type of ["loadstart", "load", "error", "loadend"]) reader.addEventListener(type, () => events.push(type));
      reader.addEventListener("loadend", () => resolve({ reader, events }));
      start(reader);
    });

  it("reads text, a data URL and bytes, with its events in order", async () => {
    const blob = new Blob(["hi"], { type: "text/plain" });
    const text = await read((r) => r.readAsText(blob));
    expect(text.reader.result).toBe("hi");
    expect(text.events).toEqual(["loadstart", "load", "loadend"]);
    expect((await read((r) => r.readAsDataURL(blob))).reader.result).toBe("data:text/plain;base64,aGk=");
    expect(new Uint8Array((await read((r) => r.readAsArrayBuffer(blob))).reader.result as ArrayBuffer)).toEqual(new Uint8Array([104, 105]));
  });

  it("reads a large blob as a binary string", async () => {
    const { reader, events } = await read((r) => r.readAsBinaryString(new Blob([new Uint8Array(1_000_000).fill(65)])));
    expect(events).toEqual(["loadstart", "load", "loadend"]);
    expect((reader.result as string).length).toBe(1_000_000);
  });

  it("falls back to UTF-8 for an encoding it does not know", async () => {
    const { reader } = await read((r) => r.readAsText(new Blob(["hi"]), "bogus"));
    expect(reader.result).toBe("hi");
  });
});

describe("the page's events on Node's own targets", () => {
  it("arrive with their members, and a cancelled one reports it", () => {
    const target = new AbortController().signal;
    const seen: unknown[] = [];
    target.addEventListener("x", (e) => {
      seen.push((e as CustomEvent).detail);
      e.preventDefault();
    });
    const event = new CustomEvent("x", { detail: 1, cancelable: true });
    expect(target.dispatchEvent(event)).toBe(false);
    expect(seen).toEqual([1]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("are refused when they are not events", () => {
    expect(() => new AbortController().signal.dispatchEvent({ type: "x" } as Event)).toThrow();
  });
});
