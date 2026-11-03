import "@testing-library/jest-dom/vitest";
import { fireEvent, getByRole, getByText, screen, waitFor, within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// @testing-library/dom (and user-event, jest-dom) running against the page through the bridge: the library's own
// queries walk the DOM from the host, so this is the real use of a jsdom replacement.

afterEach(() => {
  document.body.innerHTML = "";
});

describe("queries", () => {
  it("finds by role, text, label, placeholder and test id", () => {
    document.body.innerHTML = `
      <main>
        <h1>Title</h1>
        <button type="button">Save</button>
        <label for="email">Email</label><input id="email" placeholder="you@example.com" />
        <a href="/x" data-testid="link">Go</a>
        <ul><li>one</li><li>two</li></ul>
      </main>`;
    expect(screen.getByRole("heading", { name: "Title" }).tagName).toBe("H1");
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email").id).toBe("email");
    expect(screen.getByPlaceholderText("you@example.com").id).toBe("email");
    expect(screen.getByTestId("link").getAttribute("href")).toBe("/x");
    expect(screen.getByText("Go").tagName).toBe("A");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("missing")).toBeNull();
    expect(within(screen.getByRole("list")).getByText("two")).toBeInTheDocument();
    expect(getByRole(document.body, "link", { name: "Go" })).toBeVisible();
  });

  it("explains a failed query", () => {
    document.body.innerHTML = "<p>hello</p>";
    expect(() => screen.getByText("nope")).toThrow(/Unable to find an element with the text: nope/);
  });
});

describe("events", () => {
  it("fireEvent reaches the host's listeners", () => {
    document.body.innerHTML = "<button>Go</button><input />";
    const onClick = vi.fn();
    const onInput = vi.fn();
    screen.getByText("Go").addEventListener("click", onClick);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    input.addEventListener("input", (e) => onInput((e.target as HTMLInputElement).value));
    fireEvent.click(screen.getByText("Go"));
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.input(input, { target: { value: "abcd" } });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith("abcd");
    expect(input.value).toBe("abcd");
  });

  it("user-event types, clicks and tabs", async () => {
    document.body.innerHTML = "<input aria-label=a /><input aria-label=b /><button>ok</button>";
    const user = userEvent.setup();
    const clicks: string[] = [];
    screen.getByText("ok").addEventListener("click", () => clicks.push("ok"));
    await user.type(screen.getByLabelText("a"), "hello");
    expect((screen.getByLabelText("a") as HTMLInputElement).value).toBe("hello");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("b"));
    await user.click(screen.getByText("ok"));
    expect(clicks).toEqual(["ok"]);
  });
});

describe("waiting", () => {
  it("waitFor sees a change made by a timer", async () => {
    document.body.innerHTML = "<p id=p>waiting</p>";
    setTimeout(() => {
      document.getElementById("p")!.textContent = "done";
    }, 20);
    await waitFor(() => expect(getByText(document.body, "done")).toBeInTheDocument());
  });

  it("findBy waits for an element that appears", async () => {
    setTimeout(() => {
      document.body.innerHTML = "<button>late</button>";
    }, 20);
    expect(await screen.findByRole("button", { name: "late" })).toBeInTheDocument();
  });

  it("MutationObserver, which waitFor uses, reports changes", async () => {
    const seen: number[] = [];
    const obs = new MutationObserver((records) => seen.push(records.length));
    obs.observe(document.body, { childList: true, subtree: true });
    document.body.appendChild(document.createElement("div"));
    await new Promise((r) => setTimeout(r, 10));
    obs.disconnect();
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("jest-dom matchers", () => {
  it("checks state through the DOM", () => {
    document.body.innerHTML = `<input disabled value="x" /><input type=checkbox checked /><div hidden>h</div><p class="a b" style="color: red">t</p>`;
    expect(document.querySelector("input")).toBeDisabled();
    expect(document.querySelector("input")).toHaveValue("x");
    expect(document.querySelector("[type=checkbox]")).toBeChecked();
    expect(document.querySelector("p")).toHaveClass("a", "b");
    expect(document.querySelector("p")).toHaveStyle({ color: "rgb(255, 0, 0)" });
    expect(document.querySelector("p")).toHaveTextContent("t");
    expect(document.querySelector("div")).not.toBeVisible();
  });
});
