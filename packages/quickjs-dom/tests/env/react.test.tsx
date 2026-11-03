import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

// React 18 and @testing-library/react running against the page through the bridge: react-dom does its work in Node, and
// every DOM call it makes goes into QuickJS.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

function Counter({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start);
  return (
    <div>
      <p data-testid="count">Count: {n}</p>
      <button onClick={() => setN(n + 1)}>increment</button>
      <button onClick={() => setN(0)} disabled={n === 0}>
        reset
      </button>
    </div>
  );
}

function Form({ onSubmit }: { onSubmit: (v: { name: string; agree: boolean; color: string }) => void }) {
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [color, setColor] = useState("red");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, agree, color });
      }}
    >
      <label htmlFor="name">Name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      <label>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree
      </label>
      <select aria-label="color" value={color} onChange={(e) => setColor(e.target.value)}>
        <option value="red">Red</option>
        <option value="green">Green</option>
      </select>
      <button type="submit">send</button>
    </form>
  );
}

function Loader() {
  const [items, setItems] = useState<string[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setItems(["a", "b", "c"]), 20);
    return () => clearTimeout(t);
  }, []);
  return items ? (
    <ul>
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  ) : (
    <p>loading</p>
  );
}

describe("react", () => {
  it("renders and re-renders on events (fireEvent)", () => {
    render(<Counter start={2} />);
    expect(screen.getByTestId("count")).toHaveTextContent("Count: 2");
    fireEvent.click(screen.getByText("increment"));
    fireEvent.click(screen.getByText("increment"));
    expect(screen.getByTestId("count")).toHaveTextContent("Count: 4");
    expect(screen.getByText("reset")).toBeEnabled();
    fireEvent.click(screen.getByText("reset"));
    expect(screen.getByTestId("count")).toHaveTextContent("Count: 0");
    expect(screen.getByText("reset")).toBeDisabled();
  });

  it("handles user-event clicks", async () => {
    const user = userEvent.setup();
    render(<Counter />);
    await user.click(screen.getByRole("button", { name: "increment" }));
    await user.click(screen.getByRole("button", { name: "increment" }));
    expect(screen.getByTestId("count")).toHaveTextContent("Count: 2");
  });

  it("controlled inputs: typing, checkbox, select, submit", async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    render(<Form onSubmit={(v) => submitted.push(v)} />);
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.click(screen.getByLabelText("I agree"));
    await user.selectOptions(screen.getByLabelText("color"), "green");
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
    expect(screen.getByLabelText("I agree")).toBeChecked();
    expect(screen.getByLabelText("color")).toHaveValue("green");
    await user.click(screen.getByRole("button", { name: "send" }));
    expect(submitted).toEqual([{ name: "Ada", agree: true, color: "green" }]);
  });

  it("user-event tab moves focus through the form in order", async () => {
    const user = userEvent.setup();
    render(
      <form>
        <label>first <input id="f1" /></label>
        <button type="button">middle</button>
        <label>last <input id="f2" /></label>
      </form>,
    );
    const seen: string[] = [];
    await user.tab();
    seen.push(document.activeElement?.id || document.activeElement?.textContent || "?");
    await user.tab();
    seen.push(document.activeElement?.id || document.activeElement?.textContent || "?");
    await user.tab();
    seen.push(document.activeElement?.id || document.activeElement?.textContent || "?");
    expect(seen).toEqual(["f1", "middle", "f2"]);
    expect(document.hasFocus()).toBe(true);
  });

  it("effects and timers: findBy waits for what a timer renders", async () => {
    render(<Loader />);
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findAllByRole("listitem")).toHaveLength(3);
    await waitFor(() => expect(screen.queryByText("loading")).toBeNull());
  });

  it("rerender and unmount", () => {
    const { rerender, unmount, container } = render(<Counter start={1} />);
    expect(container.querySelector("[data-testid=count]")!.textContent).toBe("Count: 1");
    rerender(<Counter start={1} />);
    unmount();
    expect(container.innerHTML).toBe("");
  });
});
