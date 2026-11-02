import { runPageScriptsQuickJS } from "wasm-html-to-image/javascript";

// The page's scripts run in QuickJS (WebAssembly) in the browser; the engine finds its own wasm.
(async () => {
  const out = document.getElementById("out")!;
  try {
    const page = await runPageScriptsQuickJS(
      { html: '<!doctype html><body><p id="p">x</p><script>document.getElementById("p").textContent = "ran in quickjs";</script></body>' },
      { settleMs: 0 },
    );
    out.textContent = page.html.includes("ran in quickjs") ? "ok" : "no script effect: " + page.html;
  } catch (e) {
    out.textContent = "error: " + String((e as Error)?.message ?? e);
  }
})();
