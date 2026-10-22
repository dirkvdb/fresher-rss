import { ImageError, webUrl } from "./network.mjs";
import { downloadArticlePage } from "./article-download.mjs";
import { extractArticleContent } from "./content-extract.mjs";
import { readConfig } from "./config.mjs";

export function createContentService({
  config = readConfig(),
  download = downloadArticlePage,
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
  async function findContent(url) {
    if (pending.has(url)) return pending.get(url);
    if (active >= config.imageMaxConcurrent)
      throw new ImageError(
        "Article extraction is busy. Please try again.",
        429,
      );
    active++;
    const work = (async () => {
      const signal = AbortSignal.timeout(config.imageTimeoutMs);
      let result;
      try {
        const page = await download(url, { signal, config });
        signal.throwIfAborted();
        const data = extractArticleContent(page.html, page.url, { config });
        signal.throwIfAborted();
        result = { status: 200, data, ttl: config.imageCacheTtlSeconds };
      } catch (error) {
        if (!(error instanceof ImageError && error.status === 422)) throw error;
        result = {
          status: 422,
          data: { error: error.message },
          ttl: config.imageMissTtlSeconds,
        };
      }
      if (cache.size >= config.imageCacheMaxEntries)
        cache.delete(cache.keys().next().value);
      cache.set(url, { ...result, expires: now() + result.ttl * 1000 });
      return result;
    })();
    pending.set(url, work);
    try {
      return await work;
    } finally {
      pending.delete(url);
      active--;
    }
  }
  return async function contentHandler(request, response) {
    let parsed;
    try {
      parsed = new URL(request.url ?? "/", "http://localhost");
    } catch {
      json(response, 400, { error: "Invalid request URL." });
      return;
    }
    if (parsed.pathname !== "/api/article-content") {
      json(response, 404, { error: "Not found." });
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      json(response, 405, { error: "Only GET is supported." });
      return;
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      json(response, 403, {
        error: "Cross-site article requests are not allowed.",
      });
      return;
    }
    const value = parsed.searchParams.get("url");
    const url =
      value &&
      value.length <= config.imageMaxUrlLength &&
      webUrl(value, undefined, config.imageAllowedPorts);
    if (!url) {
      json(response, 400, { error: "Invalid article URL." });
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
      json(response, 429, { error: "Too many article requests." });
      return;
    }
    const cached = cache.get(url.href);
    if (cached && cached.expires > now()) {
      json(
        response,
        cached.status,
        cached.data,
        Math.floor((cached.expires - now()) / 1000),
      );
      return;
    }
    try {
      const result = await findContent(url.href);
      json(response, result.status, result.data, result.ttl);
    } catch (error) {
      const timeout = ["TimeoutError", "AbortError"].includes(error?.name);
      json(
        response,
        error instanceof ImageError ? error.status : timeout ? 504 : 502,
        {
          error:
            error instanceof ImageError
              ? error.message
              : timeout
                ? "Article retrieval timed out."
                : "Could not retrieve readable article content.",
        },
      );
    }
  };
}
