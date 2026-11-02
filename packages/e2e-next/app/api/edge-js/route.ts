import { render } from "wasm-html-to-image/workerd";
import { applyJavaScript } from "wasm-html-to-image/javascript";

export const runtime = "edge";
export const dynamic = "force-dynamic";

let cachedModule: WebAssembly.Module | undefined;

// The engine's own wasm still has to be handed over here (see edge-render/route.ts); the QuickJS wasm is not:
// `wasm-html-to-image/javascript` brings its own, chosen for the runtime.
async function getWasmModule(baseUrl: string): Promise<WebAssembly.Module> {
  if (!cachedModule) {
    const res = await fetch(`${baseUrl}/api/wasm-glue-wasm`);
    if (!res.ok) throw new Error(`wasm fetch failed: ${res.status}`);
    cachedModule = await WebAssembly.compile(await res.arrayBuffer());
  }
  return cachedModule;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const html =
      '<!doctype html><body><h1 id="t">before</h1><script>document.getElementById("t").textContent = "run by QuickJS on the edge";</script></body>';
    const options = await applyJavaScript({ value: html, javascript: { settleMs: 50 }, width: 600, format: "svg" });
    const out = await render(options, await getWasmModule(new URL(req.url).origin));
    return Response.json({ scripted: String(options.value).includes("run by QuickJS"), rendered: out.data.length > 100 });
  } catch (e) {
    return new Response(`edge js failed: ${String((e as Error)?.message ?? e)}`, { status: 500 });
  }
}
