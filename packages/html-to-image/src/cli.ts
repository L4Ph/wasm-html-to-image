#!/usr/bin/env node
import { program } from "commander";
import fs from "node:fs/promises";
import path from "node:path";
import { render, type OutputFormat } from "./single.js";
import { mermaidRenderOptions } from "./mermaid.js";
import {
  buildRenderOptions,
  inferFormat,
  isInlineHtml,
  isInlineMarkdown,
  isInlineMermaid,
  isMermaidInput,
  isUrlInput,
  loadMermaidSource,
  mermaidOptionsFromFlags,
  type CliFlags,
} from "./cli-options.js";

const OUTPUT_FORMATS = [
  "svg",
  "png",
  "pdf",
  "jpeg",
  "webp",
  "apng",
  "gif",
  "tiff",
  "avif",
  "jxl",
  "raw",
  "thumbhash",
  "none",
] as const;

function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

program
  .name("wasm-html-to-image")
  .description(
    "HTML to image converter on the single unified WASM module (svg/pdf direct, png/jpeg/webp/avif/jxl/raw/thumbhash via encode or html_to_image)",
  )
  .version("0.1.0")
  .argument("[input]", "input HTML/image file path, URL, inline HTML string (starts with <), or - for stdin")
  .option("-o, --output <path>", "output file path")
  .option("-w, --width <number>", "viewport width", (v) => parseInt(v, 10), 800)
  .option("-h, --height <number>", "viewport height (omit for auto)", (v) =>
    parseInt(v, 10),
  )
  .option(
    "-f, --format <format>",
    `output format (${OUTPUT_FORMATS.join(", ")}); default: from the --output extension, else png`,
  )
  .option(
    "--font <path>",
    "local font file or glob such as './fonts/*.woff2' (repeatable); 'Family=path' registers it under that family name, e.g. 'Segoe UI=C:/Windows/Fonts/segoeui.ttf'; repeat a family for each weight, font-weight picks the nearest file",
    (v: string, prev: string[] = []) => [...prev, v],
  )
  .option(
    "-q, --quality <number>",
    "encode quality 0-100 (encode stage only)",
    (v) => parseFloat(v),
    85,
  )
  .option(
    "--base-url <url>",
    "base URL for relative resources (URL input: defaults to the post-redirect document URL; file input: defaults to the file's directory)",
  )
  .option(
    "--color-space <srgb|cmyk>",
    "output color space of tiff and pdf (default srgb; cmyk rewrites colors for print, with no ICC profile)",
    (v) => v.toLowerCase(),
  )
  .option(
    "--scale <n>",
    "pixel density of raster output from HTML (default 1; 3.125 draws an 800px layout as 2500px)",
    (v) => parseFloat(v),
  )
  .option(
    "--dpi <n>",
    "resolution written to tiff output, in pixels per inch (default 96 x scale)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--animation <duration-ms>",
    "sample the document's @keyframes opacity / transform / color animation into an animated WebP / APNG / GIF; one loop duration in ms (webp, apng and gif output only; the CSS animation-duration wins and this value is an upper bound)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--animation-fps <n>",
    "animation frame rate (default 15, capped at ~75 frames total; requires --animation)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--animation-loop <n>",
    "how many times the animated WebP / APNG / GIF repeats (0 = infinite, the default; 1 = play once; requires --animation)",
    (v) => parseInt(v, 10),
  )
  .option(
    "--markdown",
    "treat the input as Markdown (implied by a .md / .markdown file; inline text and stdin need it; needs the optional dependency marked)",
  )
  .option("--template <name|file>", "look of a PDF from Markdown: a bundled template (see --list-templates) or a .json / .css file")
  .option("--list-templates", "print the bundled templates and exit")
  .option("--page-size <size>", "PDF page size for Markdown: A3, A4, A5, B4, B5, Letter, or e.g. '210mm 297mm'")
  .option("--accent <colour>", "accent colour of a Markdown document (links, rules, cover), e.g. '#c2410c'")
  .option("--body-font <family>", "body font family of a Markdown document (the renderer loads it; serif and sans-serif work)")
  .option("--stamp <text>", "text printed in the header of every page of a Markdown PDF (DRAFT, Confidential, ...)")
  .option("--cover", "a cover page with the title, subtitle, author and date (from the front matter)")
  .option("--no-cover", "no cover page, whatever the template says")
  .option("--no-toc", "no table of contents in a PDF made from Markdown (there is one by default)")
  .option("--toc-depth <n>", "deepest heading level in the table of contents (default 3)", (v) => parseInt(v, 10))
  .option("--no-outline", "leave the bookmarks (outline) out of a PDF (they are built from the headings by default)")
  .option("--no-math", "do not typeset $...$ and $$...$$ in Markdown (done with KaTeX when it is installed)")
  .option("--markdown-theme <light|dark>", "colour scheme of the built-in Markdown stylesheet (default light)")
  .option("--markdown-css <path>", "extra CSS file appended after the built-in Markdown stylesheet")
  .option("--mermaid", "treat the input as a Mermaid diagram (implied by a .mmd / .mermaid file; inline text and stdin need it)")
  .option("--mermaid-theme <name>", "colour theme of a Mermaid diagram: light, dark, neutral, forest, nord, dracula, solarized-light, solarized-dark, rose-pine, sepia")
  .option("--mermaid-mode <mode>", "how much a broken Mermaid source is forgiven: strict (default), compat, recover")
  .option("--mermaid-directives", "honour %%{init}%% and frontmatter config (theme, themeVariables) in a Mermaid source")
  .option(
    "--js",
    "run the page's scripts in jsdom before rendering (needs the optional dependency jsdom; trusted pages only)",
  )
  .option(
    "--js-wait <ms|selector>",
    "with --js: milliseconds to wait after load (default 1000), or a CSS selector to wait for",
  )
  .action(async (input: string | undefined, options: CliFlags & { listTemplates?: boolean }) => {
    try {
      if (options.listTemplates) {
        const { listTemplates } = await import("./markdown-template.js");
        for (const t of listTemplates()) console.log(`${t.name.padEnd(10)} ${t.description}`);
        return;
      }
      if (input === undefined) {
        console.error("error: missing required argument 'input'");
        process.exit(1);
      }
      const format = String(
        options.format ?? inferFormat(options.output) ?? "png",
      ).toLowerCase();
      if (!isOutputFormat(format)) {
        console.error(
          `Error: unsupported format "${options.format}". Choose from: ${OUTPUT_FORMATS.join(", ")}`,
        );
        process.exit(1);
      }

      if (
        options.colorSpace !== undefined &&
        options.colorSpace !== "srgb" &&
        options.colorSpace !== "cmyk"
      ) {
        console.error(
          `Error: unsupported color space "${options.colorSpace}". Choose from: srgb, cmyk`,
        );
        process.exit(1);
      }

      const isUrl = isUrlInput(input);
      const isVirtual = isInlineHtml(input) || input === "-" || (await isInlineMarkdown(input, options)) || (await isInlineMermaid(input, options));
      if (isVirtual && !options.output) {
        console.error("Error: --output is required for inline HTML or stdin input");
        process.exit(1);
      }

      let outputPath: string | undefined = options.output;
      if (!outputPath) {
        const ext = format;
        outputPath = isUrl || isVirtual
          ? `output.${ext}`
          : path.format({
              dir: path.dirname(input),
              name: path.basename(input, path.extname(input)),
              ext: `.${ext}`,
            });
      }

      const flags: CliFlags = {
        output: options.output,
        width: options.width,
        height: options.height,
        format,
        quality: options.quality,
        baseUrl: options.baseUrl,
        colorSpace: options.colorSpace,
        scale: options.scale,
        dpi: options.dpi,
        animation: options.animation,
        animationFps: options.animationFps,
        animationLoop: options.animationLoop,
        font: options.font,
        js: options.js,
        jsWait: options.jsWait,
        markdown: options.markdown,
        markdownTheme: options.markdownTheme,
        math: options.math,
        template: options.template,
        pageSize: options.pageSize,
        accent: options.accent,
        bodyFont: options.bodyFont,
        stamp: options.stamp,
        cover: options.cover,
        toc: options.toc,
        tocDepth: options.tocDepth,
        outline: options.outline,
        markdownCss: options.markdownCss,
        mermaid: options.mermaid,
        mermaidTheme: options.mermaidTheme,
        mermaidMode: options.mermaidMode,
        mermaidDirectives: options.mermaidDirectives,
      };

      if (isMermaidInput(input, options)) {
        // one diagram: the image is sized to it unless -w is given
        const source = await loadMermaidSource(input, options);
        const widthGiven = program.getOptionValueSource("width") === "cli";
        let broken = false;
        const drawn = await render(mermaidRenderOptions(source, {
          ...mermaidOptionsFromFlags(flags, widthGiven),
          onWarning: (w) => {
            if (w.code === "MERMAID_ERROR") broken = true;
            console.warn(`wasm-html-to-image: ${w.code}: ${w.message}`);
          },
        }));
        await fs.writeFile(outputPath, typeof drawn.data === "string" ? drawn.data : Buffer.from(drawn.data));
        console.log(`Successfully rendered to ${outputPath}`);
        // the file holds the error box; a script still needs to know the diagram did not parse
        if (broken) process.exit(1);
        return;
      }
      const result = await render(await buildRenderOptions(input, flags));
      await fs.writeFile(
        outputPath,
        typeof result.data === "string"
          ? result.data
          : Buffer.from(result.data),
      );
      console.log(`Successfully rendered to ${outputPath}`);
    } catch (err) {
      console.error("Error during rendering:", err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
