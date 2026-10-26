// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchArticleImage,
  imageFromPage,
  thumbnailUrl,
} from "./articleImages";

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.FRESHER_CONFIG;
});
const base = "https://publisher.example/posts/story";

describe("client-side article images", () => {
  it("routes thumbnails through the cache only when enabled, including subdirectory deployments", () => {
    const image = "https://cdn.example/photo.jpg";
    expect(thumbnailUrl(image)).toBe(image);
    window.FRESHER_CONFIG = {
      imageUnreadCacheEnabled: true,
      imageApiUrl: "/reader/api/article-image",
    };
    const url = new URL(thumbnailUrl(image));
    expect(url.pathname).toBe("/reader/api/article-image");
    expect(url.searchParams.get("thumbnail")).toBe("1");
    expect(url.searchParams.get("url")).toBe(image);
    window.FRESHER_CONFIG.imageUnreadCacheEnabled = false;
    expect(thumbnailUrl(image)).toBe(image);
  });
  it("reads social metadata and resolves relative image URLs without executing scripts", () => {
    const html =
      '<script>throw Error("executed")</script><meta property="og:image" content="../cover.jpg"><meta name="twitter:image" content="/other.jpg">';
    expect(imageFromPage(html, base)).toBe(
      "https://publisher.example/cover.jpg",
    );
    expect(
      imageFromPage(
        '<meta property="og:image" content="javascript:alert(1)"><meta name="twitter:image" content="//cdn.example/photo.jpg">',
        base,
      ),
    ).toBe("https://cdn.example/photo.jpg");
  });
  it("resolves referenced images in a publisher’s structured-data graph", () => {
    const data = {
      "@graph": [
        { "@type": "NewsArticle", image: { "@id": "#photo" } },
        { "@type": "ImageObject", "@id": "#photo", contentUrl: "/actual.jpg" },
      ],
    };
    expect(
      imageFromPage(
        `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
        base,
      ),
    ).toBe("https://publisher.example/actual.jpg");
  });
  it("skips tiny article images and unsupported protocols", () => {
    expect(
      imageFromPage(
        '<article><img src="/pixel.gif" width="1"><img data-src="/photo.jpg"></article>',
        base,
      ),
    ).toBe("https://publisher.example/photo.jpg");
    expect(
      imageFromPage(
        '<meta property="og:image" content="file:///etc/passwd">',
        base,
      ),
    ).toBeNull();
  });
  it("uses the same-origin image service without forwarding credentials", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ image: "https://cdn.example/photo.jpg" }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchArticleImage(base)).toBe("https://cdn.example/photo.jpg");
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.pathname).toMatch(/\/api\/article-image$/);
    expect(url.searchParams.get("url")).toBe(base);
    expect(fetcher.mock.calls[0][1].credentials).toBe("omit");
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("falls back to direct CORS access for static-only hosting", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValue(
        new Response('<meta name="twitter:image" content="/cover.jpg">', {
          headers: { "Content-Type": "text/html" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchArticleImage(base)).toBe(
      "https://publisher.example/cover.jpg",
    );
    expect(fetcher.mock.calls[1][0]).toBe(base);
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  });
  it("gracefully handles a publisher blocking CORS", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 404 }))
        .mockRejectedValue(new TypeError("Failed to fetch")),
    );
    expect(await fetchArticleImage(base)).toBeNull();
  });
});
