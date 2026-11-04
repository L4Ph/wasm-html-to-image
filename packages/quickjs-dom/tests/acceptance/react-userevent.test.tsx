import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";

// The Phase 4 acceptance measurement (design doc section 10.3/10.4): a small react-dom +
// @testing-library/react app driven by user-event's click / type / tab / pointer sequences. It is
// deliberately outside the default `tests/*.test.ts` and `tests/env/**` includes: scripts/
// react-userevent-suite.mjs runs this same file under jsdom (baseline) and under this package's
// Vitest environment, and ledgers the pass rate and the timing ratio.
//
// The test body is the measurement: each case renders the app and runs its sequence REPS times,
// timing render+setup+sequence, so one run produces a median per workload. Assertions run only
// after the last repetition; the file's timings go to REACT_UE_OUT for the runner.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OUT = process.env.REACT_UE_OUT;
const ENV = process.env.REACT_UE_ENV ?? "unknown";
const REPS = Math.max(1, Number(process.env.REACT_UE_REPS ?? 7));
const samples: Record<string, number[]> = {
  "click.button": [],
  "click.checkbox": [],
  "type.input": [],
  "type.clear": [],
  "tab.forward": [],
  "tab.back": [],
  "pointer.click": [],
  "pointer.hover": [],
};

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
};

afterEach(cleanup);
afterAll(() => {
  if (!OUT) return;
  writeFileSync(
    OUT,
    JSON.stringify({
      env: ENV,
      reps: REPS,
      samples,
      medians: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, median(v)])),
    }),
  );
});

function App() {
  const [n, setN] = useState(0);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [pointerLog, setPointerLog] = useState<string[]>([]);
  const [pointerClicks, setPointerClicks] = useState(0);
  const add = (what: string) => setPointerLog((log) => (log.includes(what) ? log : [...log, what]));
  return (
    <div>
      <p data-testid="count">Count: {n}</p>

      <label htmlFor="name">Name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      <label>
        <input id="agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree
      </label>

      <input id="first" aria-label="first" />
      <button id="middle" type="button">
        middle
      </button>
      <input id="last" aria-label="last" />
      <button type="button" onClick={() => setN((v) => v + 1)}>
        increment
      </button>

      <div
        data-testid="pointer-box"
        onPointerOver={() => add("pointerover")}
        onPointerEnter={() => add("pointerenter")}
        onPointerDown={() => add("pointerdown")}
        onPointerUp={() => add("pointerup")}
        onClick={() => {
          add("click");
          setPointerClicks((v) => v + 1);
        }}
      >
        pointer target
      </div>
      <p data-testid="pointer-log">{pointerLog.join(",")}</p>
      <p data-testid="pointer-clicks">{pointerClicks}</p>
    </div>
  );
}

const timed = async (caseName: string, act: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) => {
  // One untimed repetition first: user-event and React resolve their event paths lazily, and that
  // first-call compilation is a property of the environment, not of the interaction being compared.
  cleanup();
  (document.activeElement as HTMLElement | null)?.blur?.();
  render(<App />);
  await act(userEvent.setup({ delay: null }));
  for (let i = 0; i < REPS; i++) {
    cleanup();
    // cleanup unmounts the tree but leaves focus where it was; start every repetition from the body
    (document.activeElement as HTMLElement | null)?.blur?.();
    const t = performance.now();
    render(<App />);
    const user = userEvent.setup({ delay: null });
    await act(user);
    samples[caseName].push(performance.now() - t);
  }
};

describe("react + user-event", () => {
  it("click: two button clicks update state twice", async () => {
    await timed("click.button", async (user) => {
      await user.click(screen.getByRole("button", { name: "increment" }));
      await user.click(screen.getByRole("button", { name: "increment" }));
    });
    expect(screen.getByTestId("count")).toHaveTextContent("Count: 2");
  });

  it("click: a checkbox toggles on and off", async () => {
    await timed("click.checkbox", async (user) => {
      await user.click(screen.getByLabelText("I agree"));
      await user.click(screen.getByLabelText("I agree"));
    });
    expect(screen.getByLabelText("I agree")).not.toBeChecked();
  });

  it("type: a controlled input receives the typed text", async () => {
    await timed("type.input", async (user) => {
      await user.type(screen.getByLabelText("Name"), "Ada");
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
  });

  it("type: clear then retype replaces the controlled value", async () => {
    await timed("type.clear", async (user) => {
      await user.type(screen.getByLabelText("Name"), "wrong");
      await user.clear(screen.getByLabelText("Name"));
      await user.type(screen.getByLabelText("Name"), "Grace");
    });
    expect(screen.getByLabelText("Name")).toHaveValue("Grace");
  });

  it("tab: forward focus order follows the DOM", async () => {
    const seen: string[] = [];
    await timed("tab.forward", async (user) => {
      seen.length = 0;
      for (let i = 0; i < 5; i++) {
        await user.tab();
        seen.push((document.activeElement as HTMLElement)?.id || (document.activeElement as HTMLElement)?.tagName || "?");
      }
    });
    expect(seen).toEqual(["name", "agree", "first", "middle", "last"]);
  });

  it("tab: shift+tab walks back through the same order", async () => {
    await timed("tab.back", async (user) => {
      screen.getByLabelText("last").focus();
      await user.tab({ shift: true });
      await user.tab({ shift: true });
    });
    expect((document.activeElement as HTMLElement).id).toBe("first");
  });

  it("pointer: a left-button press sequence clicks once", async () => {
    await timed("pointer.click", async (user) => {
      const box = screen.getByTestId("pointer-box");
      await user.pointer([{ keys: "[MouseLeft>]", target: box }, { keys: "[/MouseLeft]", target: box }]);
    });
    expect(screen.getByTestId("pointer-clicks")).toHaveTextContent("1");
    const log = screen.getByTestId("pointer-log").textContent ?? "";
    expect(log).toContain("pointerdown");
    expect(log).toContain("pointerup");
    expect(log).toContain("click");
  });

  it("pointer: hover reaches the enter/over handlers", async () => {
    await timed("pointer.hover", async (user) => {
      await user.hover(screen.getByTestId("pointer-box"));
    });
    const log = screen.getByTestId("pointer-log").textContent ?? "";
    expect(log).toContain("pointerover");
    expect(log).toContain("pointerenter");
  });
});
