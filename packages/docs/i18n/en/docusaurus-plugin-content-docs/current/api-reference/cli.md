---
sidebar_position: 6
title: CLI Tool
---

# Command Line Interface (CLI)

Run `wasm-html-to-image` directly from your terminal or CI pipelines without writing code.

## Usage

```bash
npx wasm-html-to-image <input> [options]
```

## Options

| Option               | Flag |   Default   | Description                                                              |
| -------------------- | :--: | :---------: | ------------------------------------------------------------------------ |
| `--output <path>`    | `-o` | Input based | Target output path                                                       |
| `--width <number>`   | `-w` |    `800`    | Viewport width                                                           |
| `--height <number>`  | `-h` |   `auto`    | Viewport height                                                          |
| `--format <format>`  | `-f` |    `png`    | Format (`svg`, `png`, `pdf`, `jpeg`, `webp`, `apng`, `gif`, `tiff`, `avif`, `jxl`, `raw`, `thumbhash`) |
| `--scale <n>` | - | `1` | Pixel density of raster output from HTML (e.g. `3.125` draws an 800px layout as 2500px) |
| `--dpi <n>` | - | `96 × scale` | Resolution written to `tiff`, in pixels per inch |
| `--color-space <srgb\|cmyk>` | - | `srgb` | Output color space of `tiff` / `pdf`. `cmyk` is for print (device conversion, no ICC profile) |
| `--quality <number>` | `-q` |    `85`     | Encode quality 0–100                                                     |
| `--base-url <url>`   |  -   |  From input | Base URL for relative resources; defaults to the post-redirect URL (URL input) or the file's directory, explicit wins |
| `--animation <duration-ms>` | - | Disabled | Sample the document's **opacity / transform / color / background-color** `@keyframes` into an animated WebP / APNG / GIF (one loop length in ms; `webp`, `apng` and `gif` output only; clamped to 5000 ms) |
| `--animation-fps <n>` | - | `15` | Animation sampling fps (used with `--animation`; ~75 frames total cap) |
| `--animation-loop <n>` | - | `0` (infinite) | How many times the animated WebP / APNG / GIF repeats (`0` = infinite, `1` = play once; used with `--animation`) |
| `--markdown` | - | Auto-detect | Treat input as Markdown (implied by `.md` / `.markdown` file extension) |
| `--template <name\|file>` | - | `default` | Document template (`default`, `report`, `proposal`, `book`, `paper`, `compact`, or path to `.json` / `.css`) |
| `--list-templates` | - | - | List available bundled templates and exit |
| `--page-size <size>` | - | From template | Page size (`A3`, `A4`, `A5`, `B4`, `B5`, `Letter`, or two lengths like `"210mm 297mm"`) |
| `--accent <color>` | - | From template | Accent color for headings, links, and cover elements (e.g. `"#c2410c"`) |
| `--body-font <family>` | - | From template | Body font family name |
| `--stamp <text>` | - | None | Text stamped into the running header of every page (e.g. `DRAFT`, `Confidential`) |
| `--cover` / `--no-cover` | - | From template | Force enable / disable the cover page |
| `--no-toc` | - | - | Disable the table of contents page (enabled by default for PDF output) |
| `--toc-depth <n>` | - | `3` | Deepest heading level included in the table of contents (1–6) |
| `--no-outline` | - | - | Disable PDF bookmarks / outline generation (enabled by default) |
| `--no-math` | - | - | Disable KaTeX math typesetting (enabled by default when `katex` is installed) |
| `--markdown-theme <light\|dark>` | - | `light` | Theme for the built-in Markdown stylesheet |
| `--markdown-css <path>` | - | None | Path to extra stylesheet appended after the built-in styles |
| `--mermaid` | - | automatic for `.mmd` / `.mermaid` | Treat the input as a Mermaid diagram (needed for inline text and stdin) |
| `--mermaid-theme <name>` | - | `light` | Colour theme of the diagram (`light`, `dark`, `neutral`, `forest`, `nord`, `dracula`, `solarized-light`, `solarized-dark`, `rose-pine`, `sepia`) |
| `--mermaid-mode <mode>` | - | `strict` | How much a broken source is forgiven: `strict`, `compat`, `recover` |
| `--mermaid-directives` | - | off | Honour `%%{init}%%` and frontmatter `config:` in the source |
| `--font <path>` | - | None | A local font file or glob (e.g. `'./fonts/*.woff2'`); repeatable. `'Family=path'` registers it under that family name (e.g. `'Segoe UI=C:/Windows/Fonts/segoeui.ttf'`). Repeat a family for each weight and `font-weight` picks the nearest file |
| `--js` | - | off | Run the page's scripts in jsdom before rendering (needs the optional dependency `jsdom`; trusted pages only) |
| `--js-wait <ms\|selector>` | - | `1000` | With `--js`: milliseconds to wait after `load`, or a CSS selector to wait for |

## Examples

```bash
# Render local HTML to WebP
npx wasm-html-to-image template.html -o card.webp -w 1200 -h 630 -f webp -q 90

# Capture screenshot from URL
npx wasm-html-to-image https://example.com -o site.png -w 1280 -h 720

# Render Markdown to a PDF document (with TOC and bookmarks)
npx wasm-html-to-image report.md -o report.pdf

# Render Markdown with report template, custom accent, and DRAFT stamp
npx wasm-html-to-image report.md -o report.pdf --template report --accent "#c2410c" --stamp DRAFT

# Render Markdown with book template in A5 size without TOC
npx wasm-html-to-image book.md -o book.pdf --template book --page-size A5 --no-toc

# List available document templates
npx wasm-html-to-image --list-templates

# Turn an opacity / transform / color @keyframes animation into an animated WebP
npx wasm-html-to-image loader.html -o loader.webp -f webp --animation 2000 --animation-fps 20

# Play the animated WebP once instead of looping forever
npx wasm-html-to-image loader.html -o loader.webp -f webp --animation 2000 --animation-loop 1
```
