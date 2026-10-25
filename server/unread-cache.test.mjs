import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { readConfig } from "./config.mjs";
import { createUnreadCache } from "./unread-cache.mjs";
import { createImageService } from "./service.mjs";
import { extractFeedImage } from "./extract.mjs";

const source = "https://cdn.example/photo.jpg";
const story = "https://publisher.example/story";
const article = (url = story, image = source) => ({
  alternate: [{ href: url }],
  summary: { content: image ? `<img src="${image}">` : "No cover" },
});
const fixtures = [];
afterEach(() => {
  for (const cache of fixtures.splice(0)) cache.close();
  vi.useRealTimers();
});

function setup(env = {}, passwords = { reader: "secret" }) {
  const config = readConfig({
    FRESHRSS_URL: "https://rss.example/subdir",
    FRESHRSS_API_PASSWORDS: JSON.stringify(passwords),
    CONTENT_UNREAD_CACHE_ENABLED: "false",
    ...env,
  });
  const pages = new Map(
    Object.keys(passwords).map((user) => [user, [{ items: [article()] }]]),
  );
  const fetchImpl = vi.fn(async (url, options) => {
    expect(url.href).toMatch(
      /^https:\/\/rss.example\/subdir\/api\/greader.php\//,
    );
    expect(options.redirect).toBe("error");
    if (url.pathname.endsWith("ClientLogin")) {
      const user = options.body.get("Email");
      expect(options.body.get("Passwd")).toBe(passwords[user]);
      return new Response(`SID=unused\nAuth=${user}-token\n`);
    }
    const user = options.headers.Authorization.match(/auth=(.*)-token/)[1];
    expect(url.searchParams.get("xt")).toBe("user/-/state/com.google/read");
    const responses = pages.get(user);
    if (responses instanceof Error) throw responses;
    const index = Number(url.searchParams.get("c") ?? "0");
    return Response.json(responses[index]);
  });
  const lookupImage = vi.fn().mockResolvedValue({ image: source });
  const lookupContent = vi
    .fn()
    .mockResolvedValue({
      status: 200,
      data: {
        content: "<p>Readable article</p>",
        title: "A story",
        byline: null,
        url: story,
      },
      ttl: config.imageCacheTtlSeconds,
    });
  const downloadThumbnail = vi.fn().mockResolvedValue({
    body: Buffer.from("thumbnail bytes"),
    contentType: "image/jpeg",
  });
  const onError = vi.fn();
  const cache = createUnreadCache({
    config,
    fetchImpl,
    lookupImage,
    lookupContent,
    downloadThumbnail,
    onError,
  });
  fixtures.push(cache);
  return {
    config,
    cache,
    pages,
    fetchImpl,
    lookupImage,
    lookupContent,
    downloadThumbnail,
    onError,
  };
}

describe("unread thumbnail cache", () => {
  it("prefetches on startup, polls every five minutes, and evicts read articles", async () => {
    vi.useFakeTimers();
    const { cache, pages, downloadThumbnail, fetchImpl } = setup();
    cache.start();
    await cache.sync();
    expect(cache.get(source)?.body.toString()).toBe("thumbnail bytes");
    expect(cache.imageForArticle(story)).toBe(source);
    expect(downloadThumbnail).toHaveBeenCalledTimes(1);
    pages.set("reader", [{ items: [] }]);
    await vi.advanceTimersByTimeAsync(299999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cache.get(source)).toBeUndefined();
    expect(cache.imageForArticle(story)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("discovers covers missing from feeds, paginates, and does not refetch cached bytes", async () => {
    const { cache, pages, lookupImage, downloadThumbnail } = setup();
    pages.set("reader", [
      { items: [article(story, null)], continuation: "1" },
      { items: [article(`${story}-2`, "https://cdn.example/other.png")] },
    ]);
    await Promise.all([cache.sync(), cache.sync()]);
    expect(lookupImage).toHaveBeenCalledExactlyOnceWith(story);
    expect(cache.get(source)).toBeDefined();
    expect(cache.get("https://cdn.example/other.png")).toBeDefined();
    await cache.sync();
    expect(lookupImage).toHaveBeenCalledTimes(1);
    expect(downloadThumbnail).toHaveBeenCalledTimes(2);
  });

  it("retains shared images while unread for any user and preserves failed user snapshots", async () => {
    const { cache, pages, onError } = setup({}, { alice: "a", bob: "b" });
    await cache.sync();
    pages.set("alice", [{ items: [] }]);
    pages.set("bob", new Error("offline"));
    await cache.sync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(cache.get(source)).toBeDefined();
    pages.set("bob", [{ items: [] }]);
    await cache.sync();
    expect(cache.get(source)).toBeUndefined();
  });

  it("coalesces downloads for articles sharing an image", async () => {
    const { cache, pages, downloadThumbnail } = setup();
    pages.set("reader", [{ items: [article(), article(`${story}-2`)] }]);
    await cache.sync();
    expect(downloadThumbnail).toHaveBeenCalledTimes(1);
    expect(cache.imageForArticle(`${story}-2`)).toBe(source);
  });

  it("prefetches feed attachments even when an article has no alternate link", async () => {
    const { cache, pages, lookupImage } = setup();
    pages.set("reader", [
      {
        items: [
          {
            id: "tag:google.com,2005:reader/item/123",
            enclosure: [{ type: "image/jpeg", href: source }],
          },
        ],
      },
    ]);
    await cache.sync();
    expect(cache.get(source)).toBeDefined();
    expect(lookupImage).not.toHaveBeenCalled();
  });

  it("keeps polling unread state while downloads are pending, without repopulating evicted entries", async () => {
    vi.useFakeTimers();
    const { cache, pages, fetchImpl, downloadThumbnail } = setup();
    let release;
    downloadThumbnail.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    cache.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(downloadThumbnail).toHaveBeenCalledTimes(1);
    pages.set("reader", [{ items: [] }]);
    await vi.advanceTimersByTimeAsync(300000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    release({ body: Buffer.from("late image"), contentType: "image/jpeg" });
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.get(source)).toBeUndefined();
    expect(cache.imageForArticle(story)).toBeNull();
  });

  it("does not commit partial or invalid paginated snapshots", async () => {
    const { cache, pages, onError } = setup();
    await cache.sync();
    pages.set("reader", [
      { items: [], continuation: "1" },
      { error: "bad response" },
    ]);
    await cache.sync();
    expect(cache.get(source)).toBeDefined();
    expect(onError).toHaveBeenCalledTimes(1);
    pages.set("reader", [{ items: [], continuation: "0" }]);
    await cache.sync();
    expect(cache.get(source)).toBeDefined();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it.each([
    { IMAGE_UNREAD_CACHE_ENABLED: "false" },
    { IMAGE_ENABLED: "false" },
    { FRESHRSS_API_PASSWORDS: "" },
    { FRESHRSS_URL: "" },
  ])(
    "does no background work when disabled or unconfigured: %j",
    async (env) => {
      vi.useFakeTimers();
      const { cache, fetchImpl, downloadThumbnail } = setup(env);
      cache.start();
      await cache.sync();
      await vi.advanceTimersByTimeAsync(600000);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(downloadThumbnail).not.toHaveBeenCalled();
    },
  );

  it("bounds byte storage and retries publisher failures next cycle", async () => {
    const { cache, pages, downloadThumbnail } = setup({
      IMAGE_THUMBNAIL_CACHE_MAX_BYTES: "15",
      IMAGE_MAX_CONCURRENT: "1",
    });
    const other = "https://cdn.example/other.png";
    pages.set("reader", [{ items: [article(), article(`${story}-2`, other)] }]);
    downloadThumbnail.mockRejectedValueOnce(new Error("publisher unavailable"));
    await cache.sync();
    expect(cache.get(source)).toBeUndefined();
    expect(cache.get(other)).toBeDefined();
    await cache.sync();
    expect(downloadThumbnail).toHaveBeenCalledWith(source, expect.any(Object));
    expect([cache.get(source), cache.get(other)].filter(Boolean)).toHaveLength(
      1,
    );
  });

  it("bounds the number of prefetched articles", async () => {
    const { cache, pages, downloadThumbnail } = setup({
      IMAGE_CACHE_MAX_ENTRIES: "1",
    });
    pages.set("reader", [
      {
        items: [
          article(),
          article(`${story}-2`, "https://cdn.example/other.png"),
        ],
      },
    ]);
    await cache.sync();
    expect(downloadThumbnail).toHaveBeenCalledTimes(1);
  });

  it("stops polling and clears bytes on shutdown", async () => {
    vi.useFakeTimers();
    const { cache, fetchImpl } = setup();
    cache.start();
    await cache.sync();
    cache.close();
    await vi.advanceTimersByTimeAsync(600000);
    expect(cache.get(source)).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serves prefetched bytes without contacting publishers, and redirects after eviction", async () => {
    const { config, cache, pages } = setup();
    await cache.sync();
    const download = vi
      .fn()
      .mockRejectedValue(new Error("must not fetch publisher"));
    const server = createServer(
      createImageService({ config, thumbnailCache: cache, download }),
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/api/article-image`;
    try {
      const metadata = await fetch(
        `${endpoint}?url=${encodeURIComponent(story)}`,
      );
      expect(await metadata.json()).toEqual({ image: source });
      const url = `${endpoint}?thumbnail=1&url=${encodeURIComponent(source)}`;
      const image = await fetch(url);
      expect(image.headers.get("content-type")).toBe("image/jpeg");
      expect(await image.text()).toBe("thumbnail bytes");
      expect(download).not.toHaveBeenCalled();
      pages.set("reader", [{ items: [] }]);
      await cache.sync();
      const missing = await fetch(url, { redirect: "manual" });
      expect(missing.status).toBe(302);
      expect(missing.headers.get("location")).toBe(source);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("feed thumbnail extraction", () => {
  it("matches relative lazy images, skips tracking pixels, and supports enclosures", () => {
    expect(
      extractFeedImage({
        ...article(),
        summary: {
          content:
            '<img src="/pixel.gif" width="1"><img data-src="/cover.jpg">',
        },
      }),
    ).toBe("https://publisher.example/cover.jpg");
    expect(
      extractFeedImage({
        ...article(story, null),
        enclosure: [{ type: "image/jpeg", href: "/attachment.jpg" }],
      }),
    ).toBe("https://publisher.example/attachment.jpg");
    expect(extractFeedImage(article(story, "javascript:alert(1)"))).toBeNull();
  });
});

describe("unread readable-content cache", () => {
  it("prefetches at startup, reuses contents while unread, and evicts on the five-minute sync", async () => {
    vi.useFakeTimers();
    const { cache, pages, lookupContent, fetchImpl } = setup({
      CONTENT_UNREAD_CACHE_ENABLED: "true",
    });
    cache.start();
    await cache.sync();
    expect(cache.contentForArticle(story)?.data.content).toBe(
      "<p>Readable article</p>",
    );
    expect(lookupContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300000);
    expect(lookupContent).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    pages.set("reader", [{ items: [] }]);
    await vi.advanceTimersByTimeAsync(300000);
    expect(cache.contentForArticle(story)).toBeUndefined();
    expect(cache.get(source)).toBeUndefined();
  });

  it("uses the shared paginated unread snapshot and deduplicates articles across users", async () => {
    const { cache, pages, lookupContent, fetchImpl } = setup(
      { CONTENT_UNREAD_CACHE_ENABLED: "true" },
      { alice: "a", bob: "b" },
    );
    pages.set("alice", [
      { items: [article()], continuation: "1" },
      { items: [article(`${story}-2`)] },
    ]);
    await cache.sync();
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(lookupContent).toHaveBeenCalledTimes(2);
    expect(cache.contentForArticle(story)).toBeDefined();
    expect(cache.contentForArticle(`${story}-2`)).toBeDefined();
    pages.set("alice", [{ items: [] }]);
    pages.set("bob", new Error("FreshRSS offline"));
    await cache.sync();
    expect(cache.contentForArticle(story)).toBeDefined();
    expect(cache.contentForArticle(`${story}-2`)).toBeUndefined();
    pages.set("bob", [{ items: [] }]);
    await cache.sync();
    expect(cache.contentForArticle(story)).toBeUndefined();
  });

  it.each([
    { IMAGE_ENABLED: "false" },
    { IMAGE_UNREAD_CACHE_ENABLED: "false" },
  ])("prefetches contents independently of images: %j", async (env) => {
    const { cache, lookupContent, lookupImage, downloadThumbnail } = setup({
      ...env,
      CONTENT_UNREAD_CACHE_ENABLED: "true",
    });
    await cache.sync();
    expect(cache.contentForArticle(story)).toBeDefined();
    expect(lookupContent).toHaveBeenCalledTimes(1);
    expect(lookupImage).not.toHaveBeenCalled();
    expect(downloadThumbnail).not.toHaveBeenCalled();
  });

  it("can disable content prefetching while retaining thumbnail caching", async () => {
    const { cache, lookupContent } = setup({
      CONTENT_UNREAD_CACHE_ENABLED: "false",
    });
    await cache.sync();
    expect(lookupContent).not.toHaveBeenCalled();
    expect(cache.contentForArticle(story)).toBeUndefined();
    expect(cache.get(source)).toBeDefined();
  });

  it("does no polling when both caches are disabled", async () => {
    vi.useFakeTimers();
    const { cache, fetchImpl, lookupContent, downloadThumbnail } = setup({
      IMAGE_UNREAD_CACHE_ENABLED: "false",
      CONTENT_UNREAD_CACHE_ENABLED: "false",
    });
    cache.start();
    await vi.advanceTimersByTimeAsync(600000);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lookupContent).not.toHaveBeenCalled();
    expect(downloadThumbnail).not.toHaveBeenCalled();
  });

  it("retries failed extractions without interrupting thumbnails or other contents", async () => {
    const { cache, pages, lookupContent } = setup({
      CONTENT_UNREAD_CACHE_ENABLED: "true",
      IMAGE_MAX_CONCURRENT: "1",
    });
    pages.set("reader", [
      { items: [article(), article(`${story}-2`), article(`${story}-3`)] },
    ]);
    lookupContent
      .mockRejectedValueOnce(new Error("publisher failed"))
      .mockResolvedValueOnce({
        status: 422,
        data: { error: "No article" },
        ttl: 900,
      });
    await cache.sync();
    expect(cache.contentForArticle(story)).toBeUndefined();
    expect(cache.contentForArticle(`${story}-2`)).toBeUndefined();
    expect(cache.contentForArticle(`${story}-3`)).toBeDefined();
    expect(cache.get(source)).toBeDefined();
    await cache.sync();
    expect(cache.contentForArticle(story)).toBeDefined();
    expect(cache.contentForArticle(`${story}-2`)).toBeDefined();
    expect(lookupContent).toHaveBeenCalledTimes(5);
  });

  it("bounds content entries and total bytes separately from thumbnails", async () => {
    const { cache, pages, lookupContent } = setup({
      CONTENT_UNREAD_CACHE_ENABLED: "true",
      CONTENT_UNREAD_CACHE_MAX_ENTRIES: "2",
      CONTENT_UNREAD_CACHE_MAX_BYTES: "200",
      IMAGE_MAX_CONCURRENT: "1",
    });
    pages.set("reader", [
      { items: [article(), article(`${story}-2`), article(`${story}-3`)] },
    ]);
    await cache.sync();
    expect(lookupContent).toHaveBeenCalledTimes(2);
    expect(cache.contentForArticle(story)).toBeUndefined();
    expect(cache.contentForArticle(`${story}-2`)).toBeDefined();
    expect(cache.contentForArticle(`${story}-3`)).toBeUndefined();
    expect(cache.get(source)).toBeDefined();
  });

  it("does not retain content larger than the byte budget", async () => {
    const { cache } = setup({
      CONTENT_UNREAD_CACHE_ENABLED: "true",
      CONTENT_UNREAD_CACHE_MAX_BYTES: "1",
    });
    await cache.sync();
    expect(cache.contentForArticle(story)).toBeUndefined();
  });

  it("polls during slow extraction and never repopulates contents after an article becomes read", async () => {
    vi.useFakeTimers();
    const { cache, pages, lookupContent, fetchImpl } = setup({
      CONTENT_UNREAD_CACHE_ENABLED: "true",
    });
    let release;
    lookupContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    cache.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(lookupContent).toHaveBeenCalledTimes(1);
    pages.set("reader", [{ items: [] }]);
    await vi.advanceTimersByTimeAsync(300000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    release({ status: 200, data: { content: "late content" }, ttl: 86400 });
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.contentForArticle(story)).toBeUndefined();
  });

  it("clears readable contents and aborts background work on shutdown", async () => {
    const { cache, lookupContent } = setup({
      CONTENT_UNREAD_CACHE_ENABLED: "true",
    });
    await cache.sync();
    const signal = lookupContent.mock.calls[0][1].signal;
    expect(cache.contentForArticle(story)).toBeDefined();
    cache.close();
    expect(signal.aborted).toBe(true);
    expect(cache.contentForArticle(story)).toBeUndefined();
  });
});
