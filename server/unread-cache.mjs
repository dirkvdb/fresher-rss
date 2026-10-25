import { readConfig } from "./config.mjs";
import { downloadImage, webUrl } from "./network.mjs";
import { extractFeedImage } from "./extract.mjs";

const READ = "user/-/state/com.google/read";
const ALL = "user/-/state/com.google/reading-list";

/** One unread snapshot drives shared thumbnail and readable-content prefetching. */
export function createUnreadCache({
  config = readConfig(),
  lookupImage,
  lookupContent,
  fetchImpl = fetch,
  downloadThumbnail = downloadImage,
  onError = () =>
    console.warn("Could not synchronize the FreshRSS unread article cache."),
} = {}) {
  const imagesEnabled = config.imageEnabled && config.imageUnreadCacheEnabled;
  const contentEnabled = config.contentUnreadCacheEnabled;
  const enabled =
    (imagesEnabled || contentEnabled) &&
    !!config.upstream &&
    !!config.apiPasswords;
  const users = new Map();
  const cache = new Map();
  const contents = new Map();
  let bytes = 0;
  let contentBytes = 0;
  let timer;
  let pending;
  let prefetch;
  let stopped = false;
  const shutdown = new AbortController();
  const base = enabled ? new URL(`${config.upstream}/`) : undefined;
  const passwords = enabled ? JSON.parse(config.apiPasswords) : {};

  async function api(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([
        shutdown.signal,
        AbortSignal.timeout(config.refreshApiTimeoutMs),
      ]),
    });
    if (!response.ok) throw new Error("FreshRSS API request failed.");
    return response;
  }

  async function unread(user, password) {
    const response = await api(
      new URL(`${config.apiPath}/accounts/ClientLogin`, base),
      {
        method: "POST",
        body: new URLSearchParams({ Email: user, Passwd: password }),
      },
    );
    const token = (await response.text()).match(/^Auth=(\S+)\s*$/m)?.[1];
    if (!token) throw new Error("FreshRSS API authentication failed.");
    const articles = new Map();
    const seen = new Set();
    let continuation;
    do {
      const url = new URL(
        `${config.apiPath}/reader/api/0/stream/contents/${ALL}`,
        base,
      );
      url.search = new URLSearchParams({
        output: "json",
        xt: READ,
        n: "1000",
      }).toString();
      if (continuation) url.searchParams.set("c", continuation);
      const page = await (
        await api(url, {
          headers: {
            Authorization: `GoogleLogin auth=${token}`,
            Accept: "application/json",
          },
        })
      ).json();
      if (!Array.isArray(page.items))
        throw new Error("Invalid FreshRSS unread response.");
      for (const article of page.items) {
        if (article.categories?.includes(READ)) continue;
        const value = article.alternate?.[0]?.href;
        const articleUrl =
          typeof value === "string" &&
          value.length <= config.imageMaxUrlLength &&
          webUrl(value, undefined, config.imageAllowedPorts)?.href;
        const key =
          articleUrl ||
          (typeof article.id === "string" &&
            article.id.length <= config.imageMaxUrlLength &&
            `entry:${article.id}`);
        if (key)
          articles.set(
            key,
            imagesEnabled ? extractFeedImage(article, { config }) : null,
          );
      }
      continuation = page.continuation;
      if (
        continuation &&
        (typeof continuation !== "string" || seen.has(continuation))
      )
        throw new Error("Invalid FreshRSS pagination.");
      seen.add(continuation);
    } while (continuation);
    return articles;
  }

  function remove(url) {
    bytes -= cache.get(url).body.length;
    cache.delete(url);
  }

  function removeContent(url) {
    contentBytes -= contents.get(url).size;
    contents.delete(url);
  }

  async function synchronize() {
    // A failed or incomplete snapshot must never evict that user's cached articles.
    for (const [user, password] of Object.entries(passwords)) {
      try {
        const snapshot = await unread(user, password);
        if (stopped) return;
        const previous = users.get(user);
        for (const [url, image] of snapshot)
          if (!image && previous?.has(url))
            snapshot.set(url, previous.get(url));
        users.set(user, snapshot);
      } catch {
        if (!stopped) onError();
      }
    }
    if (stopped) return;
    // Membership polling must not wait for a slow publisher backlog to finish.
    prefetch?.abort();
    const cycle = new AbortController();
    prefetch = cycle;
    const articles = new Map(
      [...users.values()].flatMap((items) => [...items]),
    );
    const sources = new Set([...articles.values()].filter(Boolean));
    for (const url of cache.keys()) if (!sources.has(url)) remove(url);
    for (const url of contents.keys())
      if (!articles.has(url)) removeContent(url);

    // Bound memory and prefetch work even when an account has a very large backlog.
    const work = imagesEnabled
      ? [...articles].slice(0, config.imageCacheMaxEntries)
      : [];
    const contentWork = contentEnabled
      ? [...articles.keys()]
          .filter((url) => webUrl(url, undefined, config.imageAllowedPorts))
          .slice(0, config.contentUnreadCacheMaxEntries)
      : [];
    const downloads = new Map();
    let cursor = 0;
    async function worker() {
      while (!stopped && !cycle.signal.aborted && cursor < work.length) {
        const [url, feedImage] = work[cursor++];
        try {
          const image =
            feedImage ??
            (webUrl(url, undefined, config.imageAllowedPorts)
              ? (await lookupImage(url)).image
              : null);
          if (!image || stopped || cycle.signal.aborted) continue;
          for (const snapshot of users.values())
            if (snapshot.has(url)) snapshot.set(url, image);
          if (cache.has(image)) continue;
          if (!downloads.has(image))
            downloads.set(
              image,
              downloadThumbnail(image, {
                config,
                signal: AbortSignal.any([
                  shutdown.signal,
                  cycle.signal,
                  AbortSignal.timeout(config.imageTimeoutMs),
                ]),
              }).finally(() => downloads.delete(image)),
            );
          const result = await downloads.get(image);
          if (
            stopped ||
            cycle.signal.aborted ||
            !result.body?.length ||
            result.body.length > config.imageThumbnailMaxBytes ||
            result.body.length > config.imageThumbnailCacheMaxBytes
          )
            continue;
          // Another article/worker may share this source.
          if (cache.has(image)) continue;
          while (
            cache.size >= config.imageCacheMaxEntries ||
            bytes + result.body.length > config.imageThumbnailCacheMaxBytes
          )
            remove(cache.keys().next().value);
          cache.set(image, {
            body: result.body,
            contentType: result.contentType,
          });
          bytes += result.body.length;
        } catch {
          // Publisher failures are retried next cycle, without disrupting other covers.
        }
      }
    }
    let contentCursor = 0;
    async function contentWorker() {
      while (
        !stopped &&
        !cycle.signal.aborted &&
        contentCursor < contentWork.length
      ) {
        const url = contentWork[contentCursor++];
        if (contents.has(url)) continue;
        try {
          const result = await lookupContent(url, { signal: shutdown.signal });
          if (stopped || cycle.signal.aborted || result.status !== 200)
            continue;
          const size = Buffer.byteLength(JSON.stringify(result.data));
          if (size > config.contentUnreadCacheMaxBytes) continue;
          while (
            contents.size >= config.contentUnreadCacheMaxEntries ||
            contentBytes + size > config.contentUnreadCacheMaxBytes
          )
            removeContent(contents.keys().next().value);
          contents.set(url, { result, size });
          contentBytes += size;
        } catch {
          // Retry failed extractions next cycle; thumbnail prefetching is independent.
        }
      }
    }
    return {
      warmup: Promise.all([
        ...Array.from(
          { length: Math.min(config.imageMaxConcurrent, work.length) },
          worker,
        ),
        ...Array.from(
          { length: Math.min(config.imageMaxConcurrent, contentWork.length) },
          contentWorker,
        ),
      ]),
    };
  }

  function sync() {
    if (!enabled || stopped) return Promise.resolve();
    if (!pending)
      pending = synchronize().finally(() => {
        pending = undefined;
      });
    return pending.then((result) => result?.warmup);
  }

  return {
    get: (url) => cache.get(url),
    contentForArticle: (url) => contents.get(url)?.result,
    imageForArticle: (url) => {
      for (const snapshot of users.values()) {
        const image = snapshot.get(url);
        if (cache.has(image)) return image;
      }
      return null;
    },
    sync,
    start() {
      if (!enabled || stopped || timer) return;
      void sync().catch(onError);
      timer = setInterval(() => {
        void sync().catch(onError);
      }, config.imageUnreadSyncIntervalMs);
      timer.unref?.();
    },
    close() {
      stopped = true;
      clearInterval(timer);
      shutdown.abort();
      cache.clear();
      contents.clear();
      users.clear();
      bytes = 0;
      contentBytes = 0;
    },
  };
}
