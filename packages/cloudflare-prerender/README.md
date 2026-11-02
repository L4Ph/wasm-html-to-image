# cloudflare-prerender

A Cloudflare Worker that returns the HTML of a web page **after its scripts ran**.

```
GET /?url=https://example.com&wait=%23app
→ 200 text/html
```

A Worker cannot `eval`, so the page's scripts run in QuickJS (WebAssembly) on a linkedom DOM
([`wasm-quickjs-dom`](../quickjs-dom)); the response is that DOM serialized as HTML. Unlike
`cloudflare-screenshot`, it does not include the image engine, so the Worker is small. This is not a
browser: there is no layout and no canvas, heavy pages are slow, and a page that needs a feature the
engine lacks comes back as it was before the failing script. Pages that build their content with
JavaScript (React, Vue, Vite and Next.js builds among them) are the target.

The HTML gets a `<base href>` of the page's final URL (unless it has one), so relative links and
resources in it still resolve.

## Query parameters

| Parameter | Default | |
| --------- | ------- | --- |
| `url` | (required) | The page. Only `http` and `https`; `localhost`, private addresses and hosts without a dot are refused. The page's scripts (and the scripts and modules they load) and every redirect are held to the same rule, with caps on the number and size of their requests. |
| `wait` | | A CSS selector to wait for after the scripts start (up to `timeout`). |
| `settle` | `1000` | Milliseconds to let timers and requests run after load, up to 5000 (ignored with `wait`). |
| `timeout` | `10000` | Upper limit for the scripts, 1000–20000 ms. |
| `base` | `1` | `0` leaves out the `<base href>`. |
| `debug` | | `1` answers JSON instead: `{ url, finalUrl, html, logs }`, where `logs` are the page's console output, script errors, unhandled rejections and requests. Use it to find out why a page came back empty. Not cached. |

The response carries `x-final-url` (the page's URL after redirects). Errors are JSON: `400` for a bad
request, `502` when the page could not be rendered, `504` on a timeout. Results are cached for five
minutes with the Workers cache.

## Run and deploy

```bash
pnpm --filter cloudflare-prerender dev      # local workerd
pnpm --filter cloudflare-prerender deploy
pnpm --filter cloudflare-prerender test     # smoke test: a local page whose script builds its content
```

`ALLOW_PRIVATE_HOSTS=1` (a `.dev.vars` entry; the smoke test writes it for its run) lets the Worker reach
localhost and private addresses. Never set it on a deployed Worker.

## Things to know

- **Anyone who can call the Worker can make it fetch pages**, and run their scripts. Put it behind your
  own authentication or an allow list before exposing it (the host checks stop requests to private
  networks, not to the public internet).
- The CPU time of a request can be long for heavy pages. Workers' free plan (10 ms) is too little: use
  a paid plan.
- The page's scripts can `fetch`; the limits above are what holds them back. Pages that need a feature
  the engine lacks (`WebSocket`, `Worker`, canvas, layout) will not behave as in a browser.
