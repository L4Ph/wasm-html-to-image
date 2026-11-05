# cloudflare-screenshot

A Cloudflare Worker that turns a web page into an image, **its scripts included**.

```
GET /?url=https://example.com&width=1280&format=png
```

A Worker cannot `eval`, so the page's scripts run in QuickJS (WebAssembly) on a DOM written in C
(`wasm-html-to-image/javascript`). The result is rendered by the same engine as the rest of the library.
This is not a browser: there is no layout and no canvas, heavy pages are slow, and a page that needs
a feature the engine lacks renders as it was before its scripts ran. Pages that build their content with
JavaScript (React, Vue, Vite and Next.js builds among them) are the target.

## Query parameters

| Parameter | Default | |
| --------- | ------- | --- |
| `url` | (required) | The page. Only `http` and `https`; `localhost`, private addresses and hosts without a dot are refused. The page's scripts (and the scripts and modules they load) and every redirect are held to the same rule, with caps on the number and size of their requests. |
| `width` | `1280` | Viewport width, 200–2400. |
| `height` | auto | Viewport height, 100–8000. |
| `format` | `png` | `png`, `jpeg` or `webp`. |
| `quality` | `85` | 1–100, for `jpeg` and `webp`. |
| `js` | `1` | `0` renders the page without running its scripts. |
| `wait` | | A CSS selector to wait for after the scripts start (up to `timeout`). |
| `settle` | `1000` | Milliseconds to let timers and requests run after load, up to 5000 (ignored with `wait`). |
| `timeout` | `10000` | Upper limit for the scripts, 1000–20000 ms. |

Errors are JSON: `400` for a bad request, `502` when the page could not be captured, `504` on a timeout.
Images are cached for five minutes with the Workers cache.

## Run and deploy

```bash
pnpm --filter cloudflare-screenshot dev      # local workerd
pnpm --filter cloudflare-screenshot deploy
pnpm --filter cloudflare-screenshot test     # smoke test: a local page whose script builds its content
```

`ALLOW_PRIVATE_HOSTS=1` (a `.dev.vars` entry; the smoke test writes it for its run) lets the Worker reach
`localhost`. Never set it on a deployed Worker.

## Notes

- Fonts: the Worker has no CJK fonts of its own; text in those scripts is drawn with empty boxes unless the page loads a web font.
- The Worker fetches whatever public URL it is given. Put it behind authentication or an allow-list of hosts before exposing it.
