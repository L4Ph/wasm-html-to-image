# cloudflare-prerender

A Cloudflare Worker that **compares web pages when JavaScript is disabled vs when JavaScript is enabled**.

```
GET /
→ 200 text/html (Top page with URL input form)

GET /?url=https://example.com
→ 200 text/html (Diff Viewer UI)
```

A Worker cannot `eval`, so the page's scripts run in QuickJS (WebAssembly) on a DOM written in C
([`wasm-quickjs-dom`](../quickjs-dom)). The Worker fetches the initial page without running scripts,
renders it with QuickJS, and outputs a visual diff comparison of both the **visible text** and the
**HTML source code**.

## Query parameters

| Parameter | Default | Description |
| --------- | ------- | ----------- |
| `url` | (required) | Target page URL (`http` and `https` only). |
| `format` | `ui` | `ui` (Diff Viewer HTML UI), `json` (diff data, stats, and logs), or `raw` (rendered HTML only, backward compatible). |
| `wait` | | A CSS selector to wait for after scripts start (up to `timeout`). |
| `settle` | `1000` | Milliseconds to let timers and requests run after load, up to 5000 (ignored with `wait`). |
| `timeout` | `10000` | Upper limit for fetch and script execution (1000–20000 ms). |
| `trackers` | | `1` lets the page load analytics, ads, and tracker scripts. Skipped by default. |
| `base` | `1` | `0` leaves out `<base href>` in `format=raw`. |
| `debug` | | `1` is an alias for `format=json`. |

## Diff Viewer UI features

- **Text Content Diff**: Compares visible content extracted after stripping scripts, styles, and tags. Ideal for seeing what content requires client-side JavaScript (e.g. for SEO or accessibility checks).
- **HTML Source Diff**: Compares initial raw HTML vs post-execution serialized DOM.
- **Layout Switcher**: Toggle between side-by-side (split) and unified inline diffs.
- **Title and Character Stats**: Tracks `<title>` mutations and total character changes.

## Run and deploy

```bash
pnpm --filter cloudflare-prerender dev      # local workerd
pnpm --filter cloudflare-prerender deploy
pnpm --filter cloudflare-prerender test     # smoke assertions
```

`ALLOW_PRIVATE_HOSTS=1` (a `.dev.vars` entry; the smoke test writes it for its run) lets the Worker reach
localhost and private addresses. Never set it on a deployed Worker.
