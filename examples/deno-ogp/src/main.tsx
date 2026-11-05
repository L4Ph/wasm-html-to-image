/** @jsx h */
import { h, toHtml } from "html-to-image/preact";
import { createCSS } from "html-to-image/tailwind";
import { render } from "html-to-image";

const hasCache =
  typeof caches !== "undefined" &&
  typeof (caches as CacheStorage | undefined)?.open === "function";

Deno.serve(async (request) => {
  const url = new URL(request.url);
  if (url.pathname !== "/") {
    return new Response(null, { status: 404 });
  }

  const name = url.searchParams.get("name") ?? "Name";
  const title = url.searchParams.get("title") ?? "Title";
  const image = url.searchParams.get("image");

  const isDev =
    Deno.env.get("DENO_ENV") === "development" || url.hostname === "localhost";
  const cache = hasCache ? await caches.open("html-to-image-ogp") : undefined;
  const cacheKey = new Request(url.toString());

  if (!isDev && cache) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
  }

  const html = toHtml(
    <html>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="m-4 rounded-[16px] box-border overflow-hidden">
        <div
          className="box-border w-full h-full relative flex flex-col items-center bg-gradient-to-br from-[#333355] to-[#666688] bg-[length:16px_16px,100%_100%] text-white overflow-hidden"
          style={{
            border: "solid 16px",
            borderImage:
              "linear-gradient(to right, #6666aa 0%, #333366 20%, #222233 100%) 2",
          }}
        >
          {image && (
            <img
              className="rounded-full p-6 opacity-70 absolute"
              width={480}
              height={480}
              src={image}
              alt=""
            />
          )}
          <div>
            <div className="text-[80px] font-bold [text-shadow:0_8px_16px_rgba(0,0,0,0.6)] drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] backdrop-blur-[5px] z-[1] line-clamp-3 overflow-hidden m-8 rounded-[32px] p-4">
              {title}
            </div>
          </div>

          <div className="absolute bottom-10 right-10 text-[24px] font-bold px-6 py-3 border border-white/20 drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] rounded-xl backdrop-blur-[4px] text-[#EE6688] z-[1]">
            {name}
          </div>
        </div>
      </body>
    </html>,
  );
  // Render to PNG with automatic font resolution
  const { data: png } = await render({
    value: html,
    width: 1200,
    height: 630,
    css: await createCSS(html),
    format: "png",
  });
  const response = new Response(png as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": isDev
        ? "no-cache"
        : "public, max-age=31536000, immutable",
      date: new Date().toUTCString(),
    },
  });
  if (!isDev && cache) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
});
