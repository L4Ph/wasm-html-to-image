import { render, renderMermaid } from "wasm-html-to-image/workerd";
import { markdownToDocument, markdownToHtml } from "wasm-html-to-image/markdown";
import { katexMath } from "wasm-html-to-image/markdown-math";
import { applyJavaScript, runPageScriptsQuickJS } from "wasm-html-to-image/javascript";

/**
 * Minimal worker that exercises the workerd entry over HTTP.
 * Used by scripts/smoke.mjs via `cf dev` (no fixed port).
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/png") {
      const out = await render({
        value: "<h1>hi</h1>",
        width: 800,
        format: "png",
      });
      return new Response(out.data as BodyInit, {
        headers: { "Content-Type": "image/png" },
      });
    }

    if (url.pathname === "/svg") {
      const out = await render({
        value: "<h1>hi</h1>",
        width: 800,
        format: "svg",
      });
      return new Response(out.data, {
        headers: { "Content-Type": "image/svg+xml" },
      });
    }

    if (url.pathname === "/pdf") {
      const out = await render({ value: "<h1>hi</h1>", width: 600, format: "pdf" });
      return new Response(out.data as BodyInit, {
        headers: { "Content-Type": "application/pdf" },
      });
    }

    // Markdown -> styled HTML (marked + highlight.js bundled into the worker) -> PDF.
    if (url.pathname === "/markdown-pdf") {
      const html = markdownToHtml(
        "---\ntitle: Worker\n---\n\n# Hello\n\n```ts\nconst a: number = 1;\n```\n",
        { paged: true },
      );
      const out = await render({ value: html, width: 600, format: "pdf" });
      return new Response(out.data as BodyInit, {
        headers: { "Content-Type": "application/pdf" },
      });
    }

    // A template (cover, contents, running header and footer) from Markdown, as a PDF, inside the worker.
    if (url.pathname === "/markdown-template") {
      const md = ["---", "title: Worker report", "author: W", "---", "", "# One", "", "text", "", "# Two", "", "text", ""].join("\n");
      const { html, renderOptions } = markdownToDocument(md, { template: "report", paged: true });
      const out = await render({ value: html, format: "pdf", ...renderOptions });
      return new Response(out.data as BodyInit, { headers: { "Content-Type": "application/pdf" } });
    }

    // Maths in Markdown: KaTeX bundled into the worker, its fonts fetched from the CDN while drawing.
    // The reply is the PNG's height, which a typeset display fraction makes far taller than its source text.
    if (url.pathname === "/markdown-math") {
      const md = String.raw`$$\frac{a}{b}$$`;
      const heightOf = async (html: string) => {
        const out = await render({ value: html, width: 300, format: "png" });
        return new DataView((out.data as Uint8Array).buffer, (out.data as Uint8Array).byteOffset).getUint32(20);
      };
      const typeset = await heightOf(markdownToHtml(md, { math: katexMath() }));
      const plain = await heightOf(markdownToHtml(md));
      return Response.json({ typeset, plain });
    }

    // Mermaid: drawn by the engine itself, so no DOM and no extra bundle in the worker.
    if (url.pathname === "/mermaid") {
      const out = await renderMermaid("flowchart LR\n  A[Start] --> B{Ok?}\n  B --> C[Done]", {
        format: "png",
        theme: "dark",
      });
      return new Response(out.data as BodyInit, { headers: { "Content-Type": "image/png" } });
    }

    // The page's scripts run in QuickJS (WebAssembly) on a linkedom DOM: Workers cannot eval, so this is the only way here.
    if (url.pathname === "/javascript") {
      const html =
        '<!doctype html><body><h1 id="t">before</h1><ul id="l"></ul><script>' +
        'document.getElementById("t").textContent = "after";' +
        'for (const n of [1, 2, 3]) { const li = document.createElement("li"); li.textContent = "item " + n; document.getElementById("l").appendChild(li); }' +
        'setTimeout(() => { document.body.setAttribute("data-timer", "yes"); }, 20);' +
        "</script></body>";
      const page = await runPageScriptsQuickJS({ html }, { settleMs: 100 }, 800);
      const png = await render(await applyJavaScript({ value: html, javascript: { settleMs: 100 }, width: 400, format: "png" }));
      return Response.json({ html: page.html, pngBytes: (png.data as Uint8Array).length });
    }

    if (url.pathname === "/invalid") {
      try {
        await render({ width: 800, format: "png" } as never);
      } catch {
        return new Response("bad request", { status: 400 });
      }
      return new Response("expected render to throw", { status: 500 });
    }

    return new Response("not found", { status: 404 });
  },
};
