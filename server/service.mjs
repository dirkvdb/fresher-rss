import {
  downloadPage,
  ImageError,
  resolvePublicTarget,
  webUrl,
} from "./network.mjs";
import { extractImages } from "./extract.mjs";
import { readConfig } from "./config.mjs";

export function createImageService({
  config = readConfig(),
  download = downloadPage,
  resolveTarget = resolvePublicTarget,
  now = Date.now,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const clients = new Map();
  let active = 0;
  function json(response, status, data, ttl = 0) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": ttl ? `private, max-age=${ttl}` : "no-store",
      ...(status === 429 ? { "Retry-After": "10" } : {}),
    });
    response.end(JSON.stringify(data));
  }
  async function findImage(url) {
    if (pending.has(url)) return pending.get(url);
    if (active >= config.imageMaxConcurrent)
      throw new ImageError("Image lookup is busy. Please try again.", 429);
    active++;
    const work = (async () => {
      const signal = AbortSignal.timeout(config.imageTimeoutMs);
      const page = await download(url, { signal, config });
      let image = null;
      if (page.html)
        for (const candidate of extractImages(page.html, page.url, {
          config,
        })) {
          try {
            await resolveTarget(candidate, { signal, config });
            image = candidate;
            break;
          } catch (error) {
            if (!(error instanceof ImageError && error.status === 400))
              throw error;
          }
        }
      const ttl = image
        ? config.imageCacheTtlSeconds
        : config.imageMissTtlSeconds;
      if (cache.size >= config.imageCacheMaxEntries)
        cache.delete(cache.keys().next().value);
      cache.set(url, { image, expires: now() + ttl * 1000 });
      return { image, ttl };
    })();
    pending.set(url, work);
    try {
      return await work;
    } finally {
      pending.delete(url);
      active--;
    }
  }
  return async function imageHandler(request, response) {
    if (!config.imageEnabled) {
      json(response, 404, { image: null });
      return;
    }
    let parsed;
    try {
      parsed = new URL(request.url ?? "/", "http://localhost");
    } catch {
      json(response, 400, { image: null });
      return;
    }
    if (parsed.pathname !== "/api/article-image") {
      json(response, 404, { image: null });
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      json(response, 405, { image: null });
      return;
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      json(response, 403, { image: null });
      return;
    }
    const value = parsed.searchParams.get("url");
    const url =
      value &&
      value.length <= config.imageMaxUrlLength &&
      webUrl(value, undefined, config.imageAllowedPorts);
    if (!url) {
      json(response, 400, { image: null, error: "Invalid article URL." });
      return;
    }
    const client = request.socket.remoteAddress ?? "unknown";
    const bucket = clients.get(client);
    if (!bucket || bucket.expires <= now()) {
      if (clients.size >= config.imageMaxClients)
        clients.delete(clients.keys().next().value);
      clients.set(client, {
        count: 1,
        expires: now() + config.imageRateWindowMs,
      });
    } else if (++bucket.count > config.imageRateLimit) {
      json(response, 429, { image: null, error: "Too many image requests." });
      return;
    }
    const cached = cache.get(url.href);
    if (cached && cached.expires > now()) {
      json(
        response,
        200,
        { image: cached.image },
        Math.floor((cached.expires - now()) / 1000),
      );
      return;
    }
    try {
      const result = await findImage(url.href);
      json(response, 200, { image: result.image }, result.ttl);
    } catch (error) {
      json(response, error instanceof ImageError ? error.status : 502, {
        image: null,
        error:
          error instanceof ImageError
            ? error.message
            : "Could not retrieve the article image.",
      });
    }
  };
}
