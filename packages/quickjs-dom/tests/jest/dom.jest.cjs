const { screen, fireEvent, waitFor } = require("@testing-library/dom");
const userEvent = require("@testing-library/user-event").default;

test("document and the page's classes are the globals", () => {
  expect(typeof document).toBe("object");
  document.body.innerHTML = "<button>Go</button><input aria-label=a />";
  expect(document.querySelector("button") instanceof HTMLElement).toBe(true);
  expect(window.document).toBe(document);
});

test("testing-library queries and events", async () => {
  document.body.innerHTML = "<button>Go</button><input aria-label=a />";
  const clicks = [];
  screen.getByRole("button", { name: "Go" }).addEventListener("click", (e) => clicks.push(e.type));
  fireEvent.click(screen.getByText("Go"));
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("a"), "hi");
  expect(screen.getByLabelText("a").value).toBe("hi");
  expect(clicks).toEqual(["click"]);
  setTimeout(() => { document.body.innerHTML += "<p>late</p>"; }, 10);
  expect(await screen.findByText("late")).toBeTruthy();
});
