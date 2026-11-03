import { describe, expect, it } from "vitest";

describe("the environment", () => {
  it("has a document and the page's classes", () => {
    expect(typeof document).toBe("object");
    expect(document.body.tagName).toBe("BODY");
    const div = document.createElement("div");
    expect(div instanceof HTMLElement).toBe(true);
    expect(div instanceof Node).toBe(true);
    expect(window.document).toBe(document);
    document.body.appendChild(div);
    expect(document.querySelectorAll("div").length).toBe(1);
    expect(new Event("x") instanceof Event).toBe(true);
    expect(typeof window.addEventListener).toBe("function");
  });
});
