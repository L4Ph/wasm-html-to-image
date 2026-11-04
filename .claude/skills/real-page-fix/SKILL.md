---
name: real-page-fix
description: Find and fix layout/render bugs in the wasm-html-to-image C++ engine (litehtml + Skia) by comparing real web pages with Chromium. Use when asked to test real sites, when a page renders too tall/short/blank/slow, or when a CSS feature is suspected to be unsupported.
---

# Real-page bug hunting and fixing

Chromium is the reference. The loop is: **score** the sites, **diff** one page to find where the layouts part ways, **reduce** that to a minimal HTML/CSS case, fix the engine, lock it in with a regression test, **score** again to see nothing else got worse.

Everything runs from `packages/visual-test` and works offline against a page snapshot (`.real-cache/`, git-ignored): both sides render the same captured bytes, so a result is reproducible and neither side can see a different page. Chromium always runs with JavaScript off, because the engine has none.

## The tools (`packages/visual-test/tools/real/`)

| Command | Use it to |
|---|---|
| `pnpm real:diff <url>` | Compare one page: height ratio, pixel difference per 200px band, and the **boxes where layouts diverge**: *entry points* (off while the parent is fine) and *height culprits* (own height differs, no child explains it). Writes `focus.png` (Chromium left, engine right) at the worst spot. Options: `--width`, `--top N`, `--refresh` (re-capture), `--out`. |
| `pnpm real:reduce <url> --select "<css>" --prop h\|w\|x\|y` | Delta-debug a divergence down to a minimal case: extracts the element plus the stylesheet rules that can touch it, then removes rules and markup while the element's `--prop` still differs from Chromium (same sign, at least half the original, at least `--min`). Writes `reduce/reduced.html`. Take the selector from a `real:diff` line (a path `0.1.2.1` is `body > :nth-child(3) > :nth-child(2)`, indexes are 0-based over element children). Options: `--ancestors N` (default 2; raise it when the case does not reproduce), `--max-trials`. |
| `pnpm real:score` | Scoreboard over `tools/real/sites.json`: per site height ratio, share of differing pixels, share of boxes off by more than 1.5px. Compares with the baseline and lists the sites that got **worse** (exit code 1). `--only a,b`, `--refresh`, `--update` (record this run as the baseline), `--timeout`. |

| `pnpm real:fuzz [--mode m] [--seed n --n 1 --verbose]` | Generate random layout cases (modes: block, abs, float, flex, flex-inline, grid, grid-flex, replaced, all) and report the share that match Chromium within 1.5px. Failing cases are saved under `.real-cache/fuzz/case-<seed>.html`. |
| `pnpm real:fuzz-reduce <mode> <seed>` | Delta-debug one failing fuzz case to a minimal body and print the first remaining divergence (`dx/dy/dw/dh` of the box path). Prints the body only: the case's `*{box-sizing}` is not shown, so check `.real-cache/fuzz/case-<seed>.html`. |

How it works: the engine can report every element's border box (`onLayout` option of `render()`, binding `satoru_layout_json`); the tools walk Chromium's flat tree the same way. Boxes are joined by their path among element children (`0.1.2.1`), with `::before`/`::after` pseudo nodes, `br`, and unboxed elements left out on both sides. A new site goes into `sites.json`; its snapshot is captured on first use.

`onLayout` is also the fastest way to answer "where does this element land?" for your own probes: `render({ value, width, format: "png", onLayout: (boxes) => ... })`.

## 1. Find the divergence

1. `pnpm real:score --only <site>` (or `real:diff <url>`). Read the height ratio first: 2x+ taller than Chromium is a layout bug, shorter or blank a paint/fetch bug.
2. In `real:diff`, start from the **height culprits** and the first **entry points** by page position. A culprit with no bad child is the element to look at; entries further down are usually consequences.
3. Open `focus.png`. Look at pictures, not only numbers.

### Or: the fuzz loop (no site needed)

1. `pnpm real:fuzz --mode <m>` and pick a failing seed from the weakest mode.
2. `pnpm real:fuzz-reduce <mode> <seed>`: the reduced body plus the box that still differs (`0.1.0 <div> dh=...`).
3. Probe it with tiny HTML using a scratch script in the git-ignored `temp/` (take the page from the fuzz case: `*{box-sizing:...}`, `html,body{margin:0;font-size:0;line-height:0}`; print each element's box from Chromium's `getBoundingClientRect` next to the `onLayout` boxes, with the width and box-sizing as parameters: the box-sizing must match the case, otherwise the reduced body may not reproduce). Vary one property at a time until the trigger is named (an `overflow:hidden`, a margin, a nesting level).
4. Fix, add a regression test, then run the gate in section 5. A fix that raises one seed but lowers `all` or a site in `real:score` is not a fix.

Some seeds need a targeted change, not a global one: widening a shared measurement (for example measuring every flex-basis `content` item at width 0) fixed one seed and made go.dev 1.43x taller. Revert such experiments (`git checkout <file>` and rebuild so `dist` matches) and note the seed as open.

## 2. Sanity-check before blaming the engine

- Is the page unstyled in Chromium too? (Stale deploy, bot block: NHK did this.) Then it is not an engine bug.
- Different fonts change widths and line heights a little (sans-serif maps to Noto Sans JP here, monospace differs). Widths of text-bearing boxes and 1px shifts are font noise; chase height culprits and box structure.
- Chromium full-page screenshots repeat content beyond ~16384px; the tools cap comparison at 16000 rows.
- **Compare like with like.** `scrollHeight` is floored at the viewport height and includes the text-box overflow of a `line-height` smaller than the font; an element's `getBoundingClientRect().height` is neither. Mixing them produced a false bug report once. The tools use the same definition on both sides; follow them in ad-hoc probes.

## 3. Reduce

`pnpm real:reduce <url> --select "..." --prop h`. If it says the case does not reproduce, the cause is context: raise `--ancestors`, or pick the parent that actually diverges. The result is a self-contained `reduced.html` (`<base>` points at the page; resources come from the snapshot). Check it by hand with `render({ value, baseUrl })` and a `getBoundingClientRect` in Chromium, then probe one property at a time with tiny HTML to name the cause rather than guess.

## 4. Fix

- Engine code: `src/cpp/libs/litehtml/src/*` (layout/CSS), `src/cpp/core/*` (Satoru layer: fonts, SVG, UA CSS in `core/master_css.h`).
- Rebuild: `pnpm wasm:build` (minutes; run in background if a reconfigure is needed) then `pnpm --filter wasm-html-to-image build`. Debug with `emscripten_log(EM_LOG_CONSOLE, ...)` or `fprintf(stderr, ...)`; remove it before committing.
- The emscripten build has no RTTI: `dynamic_cast` fails to compile (the build then ends with a bare `Exit status 1`; re-read the compile errors with `pnpm wasm:build 2>&1 | grep error`). Print values through accessors instead. A debug round is one rebuild (about 3 minutes): run it with `run_in_background`, and print every value you will need in the same round.
- Specificity/cascade bugs are common: UA rules should use `:where()`, presentational hints specificity `(0,0,0,1)`.
- Percent heights against auto-height containers behave as auto; `float`/`absolute` blockify `inline-flex`/`inline-grid`; `overflow` takes 1-2 values.
- Pathological nesting: layout work is bounded by a per-pass measure budget (`document::k_measure_budget`); deep flex/table trees are otherwise exponential.
- A measure-only pass (`size_mode_measure`) builds no line boxes: anything read from lines (baselines) must be kept across it, as `render_item_inline_context` now does.
- Gumbo hands `<template>` over as its own node type (`GUMBO_NODE_TEMPLATE`) and has no `slot` tag constant.

## 5. Lock in, then check the rest

- Add a probe test to `packages/visual-test/test/regression.test.ts` (helper `renderPng(body, w, h)` returns `{img, at(x,y)}`; or assert `render(...).height`). Make it fail without the fix.
- Run `pnpm test` (unit) and `pnpm test:visual` (`vitest run` in `packages/visual-test`; all must pass), delete stray `packages/visual-test/[object Object]-*.png`.
- **`pnpm real:score`** before committing a layout or UA-CSS change: it lists every site that got worse, which the unit and visual suites cannot see. `--update` after you accept a result.
- The gate for a layout change is all three: `test:visual`, `real:score` (no site worse than the baseline), and `real:fuzz` (`all` not lower). Commit only when it holds; push only when asked.
- A package-level change (CLI, options): check what a user gets with `npm pack` in `packages/html-to-image`, then `npx -y -p <path-to.tgz> wasm-html-to-image ...` from another directory (optional dependencies and the CLI entry behave as when installed).
- Commit one fix per commit, Conventional-Commit style, with the repo's co-author trailer.

## Pitfalls seen

- Writing C++ with Python: open with `encoding='utf-8'`, keep CRLF files CRLF (`newline=''`), and write `\n` inside C string literals as `r'...\n'`; prefer the Edit tool for small C++ edits.
- Several C++ files mix CRLF and LF (`html_tag.cpp`, `render_grid.cpp`): when scripting an edit, try the snippet with LF and with CRLF and require exactly one match. In a shell heredoc a Python `'\\n'` can reach Python as a real newline: write C string escapes with the Edit tool and check the result with `cat -A`.
- `real:reduce`'s extraction can come back with an empty `<style>` for nested or layered CSS (zenn). Read the element's computed style and matching rules straight from Chromium with `page.evaluate` instead, then probe.
- Pages that only look right with JavaScript: render the engine side with `javascript: true` / `--js` (QuickJS in WebAssembly, every runtime) and compare against Chromium with JavaScript on; the default comparison stays JavaScript off on both sides.
- `pnpm test:visual` imports the built package; rebuild before running it after C++ changes.
- `render({ value: url })` renders the URL string as HTML; use `url`/`baseUrl`. Do not pass `baseUrl: url` for a URL input: it pins resolution to the request host and defeats post-redirect base following.
- Ad-hoc scripts: write them as plain `.mjs` (tsx wraps functions in `__name`, which breaks `page.evaluate` with a function); keep `\n` out of template literals passed to `evaluate`; `page.addStyleTag` can crash Chromium on a big page, inject through `setContent` instead; run each URL in its own process with a timeout.
- Declarative shadow DOM is flattened into the host (`document.cpp`, `shadow_css.h`); a document-level tag selector (`button {}`) still reaches into it.
- SVG text needs the font manager from `container->get_context().fontManager`; CJK glyphs in SVG `<text>` are still partial.
