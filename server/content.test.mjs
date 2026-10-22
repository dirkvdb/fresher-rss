import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { readConfig } from "./config.mjs";
import {
  extractArticleContent,
  sanitizeArticleContent,
} from "./content-extract.mjs";
import { createContentService } from "./content-service.mjs";
import { downloadArticlePage } from "./article-download.mjs";
import { createAppService } from "./app.mjs";
import { ImageError } from "./network.mjs";

const prose =
  "Careful software testing keeps readers safe, preserves useful article content, and avoids surprising network requests. ".repeat(
    12,
  );
const page = (extra = "", head = "") =>
  `<!doctype html><html><head><title>A useful article</title><meta name="author" content="Example Author">${head}</head><body><nav>Unrelated navigation</nav><article><h1>A useful article</h1><p>${prose}</p>${extra}<p>${prose}</p></article><footer>Unrelated footer</footer></body></html>`;
const config = (overrides = {}) => ({ ...readConfig({}), ...overrides });
const query = (url = "https://publisher.example/story") =>
  `?url=${encodeURIComponent(url)}`;
async function withServer(handler, work) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await work(`http://127.0.0.1:${server.address().port}/api/article-content`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("inert main article extraction", () => {
  it("extracts article metadata and content, not navigation or footer", () => {
    const result = extractArticleContent(
      page(),
      "https://publisher.example/posts/story",
    );
    expect(result).toMatchObject({
      title: "A useful article",
      byline: "Example Author",
      url: "https://publisher.example/posts/story",
    });
    expect(result.content).toContain(prose);
    expect(result.content).not.toMatch(/Unrelated navigation|Unrelated footer/);
  });

  it("resolves media and links using the final page URL or safe publisher base", () => {
    const html = page(
      '<p><a href="../about#section">About</a><img src="photo.jpg" width="800" height="600"></p>',
    );
    const result = extractArticleContent(
      html,
      "https://publisher.example/redirected/story",
    );
    expect(result.content).toContain(
      'href="https://publisher.example/about#section"',
    );
    expect(result.content).toContain(
      'src="https://publisher.example/redirected/photo.jpg"',
    );
    const based = extractArticleContent(
      page(
        '<p><a href="more">More</a><img src="photo.jpg"></p>',
        '<base href="https://cdn.example/articles/">',
      ),
      result.url,
    );
    expect(based.content).toContain('href="https://cdn.example/articles/more"');
    expect(based.content).toContain(
      'src="https://cdn.example/articles/photo.jpg"',
    );
    expect(based.url).toBe(result.url);
    const unsafeBase = extractArticleContent(
      page(
        '<p><a href="more">More</a></p>',
        '<base href="javascript:alert(1)">',
      ),
      result.url,
    );
    expect(unsafeBase.content).toContain(
      'href="https://publisher.example/redirected/more"',
    );
  });

  it("never executes publisher scripts or loads subresources", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Unexpected subresource request");
    });
    try {
      const result = extractArticleContent(
        page(
          '<script>globalThis.__articleExecuted = true; throw Error("executed")</script><iframe src="https://evil.example/"></iframe><img src="https://images.example/photo.jpg" onerror="evil()">',
          '<link rel="stylesheet" href="https://evil.example/style.css">',
        ),
        "https://publisher.example/story",
      );
      expect(globalThis.__articleExecuted).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.content).not.toMatch(/script|iframe|onerror|stylesheet/);
      expect(result.content).toContain(
        'src="https://images.example/photo.jpg"',
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("serializes only allowed HTML and attributes, blocking unsafe URL forms", () => {
    const { content } = sanitizeArticleContent(
      '<p id="root" style="position:fixed" onclick="evil()">Safe &amp; sound</p><svg><a href="https://evil.example">SVG</a></svg><math><mi>X</mi></math><form><input name="x">Form</form><script>evil()</script><iframe src="https://evil.example"></iframe><a href="jav&#x61;script:alert(1)">Bad</a><a href="https://user:pass@example.com/">Credentials</a><img src="data:image/png;base64,AAAA"><img src="//images.example/photo.jpg" srcset="evil" onerror="evil()"><a href="../other" ping="https://tracker.example/">Good</a><custom-element><strong>Keep text</strong></custom-element>',
      "https://publisher.example/posts/story",
    );
    expect(content).toContain("Safe &amp; sound");
    expect(content).toContain("<strong>Keep text</strong>");
    expect(content).not.toMatch(
      /<svg|<math|<form|<input|<script|<iframe|<custom|id=|style=|onclick|onerror|srcset|ping=|javascript:|data:|user:pass/,
    );
    expect(content).toContain(
      'href="https://publisher.example/other" target="_blank" rel="noopener noreferrer"',
    );
    expect(content).toContain(
      'src="https://images.example/photo.jpg" loading="lazy" referrerpolicy="no-referrer"',
    );
  });

  it("handles malformed markup and rejects empty or oversized documents", () => {
    expect(
      extractArticleContent(
        `<html><body><article><p>${prose}`,
        "https://publisher.example/",
      ).content,
    ).toContain(prose);
    for (const html of [
      null,
      "",
      "<html><body><script>bad()</script></body></html>",
    ])
      expect(() =>
        extractArticleContent(html, "https://publisher.example/"),
      ).toThrow();
    expect(() =>
      extractArticleContent(page(), "https://publisher.example/", {
        config: config({ imageMaxHtmlBytes: 1024 }),
      }),
    ).toThrow("too large");
    expect(() =>
      extractArticleContent(
        `<html><body>${"<span></span>".repeat(20001)}</body></html>`,
        "https://publisher.example/",
      ),
    ).toThrow("too many elements");
    expect(() =>
      extractArticleContent(
        `<html><body>${"<div>".repeat(129)}text${"</div>".repeat(129)}</body></html>`,
        "https://publisher.example/",
      ),
    ).toThrow("nested too deeply");
  });
});

describe("article content HTTP service", () => {
  it("extracts the original Tweakers article after its functional consent redirect", async () => {
    const articleUrl =
      "https://tweakers.net/nieuws/253658/ncsc-krijgt-eerste-signalen-dat-php-lekken-succesvol-zijn-misbruikt.html";
    const authId = "12345678-1234-4abc-8def-123456789abc";
    const callback = `https://tweakers.net/privacy-gate/store/?authId=${authId}`;
    const rawDownload = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://myprivacy.dpgmedia.nl/consent?siteKey=tweakers",
        html: `<html><body><script>const callbackUrl = new URL(decodeURIComponent('${encodeURIComponent(callback)}'));</script></body></html>`,
      })
      .mockResolvedValueOnce({ url: articleUrl, html: page() });
    await withServer(
      createContentService({
        download: (input, options) =>
          downloadArticlePage(input, { ...options, download: rawDownload }),
      }),
      async (endpoint) => {
        const response = await fetch(endpoint + query(articleUrl), {
          headers: { Cookie: "browser=secret", Authorization: "secret" },
        });
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.url).toBe(articleUrl);
        expect(result.content).toContain(prose);
        expect(result.content).not.toContain("callbackUrl");
        expect(rawDownload).toHaveBeenCalledTimes(2);
        expect(rawDownload.mock.calls[0][1]).not.toHaveProperty(
          "publisherCookie",
        );
        expect(rawDownload.mock.calls[1][1].publisherCookie).toEqual({
          origin: "https://tweakers.net",
          value: `authId=${authId}`,
        });
      },
    );
  });
  it("dispatches independently of imageEnabled and does not forward credentials", async () => {
    const download = vi.fn().mockResolvedValue({
      html: page(),
      url: "https://publisher.example/final/story",
    });
    await withServer(
      createAppService({ config: config({ imageEnabled: false }), download }),
      async (endpoint) => {
        const response = await fetch(endpoint + query(), {
          headers: { Authorization: "secret", Cookie: "session=secret" },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          title: "A useful article",
          byline: "Example Author",
          url: "https://publisher.example/final/story",
          content: expect.any(String),
        });
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(download.mock.calls[0]).toEqual([
          "https://publisher.example/story",
          { signal: expect.any(AbortSignal), config: expect.any(Object) },
        ]);
      },
    );
  });

  it("rejects methods, cross-site requests, invalid URLs, long URLs and private destinations", async () => {
    await withServer(createContentService(), async (endpoint) => {
      expect(
        (await fetch(endpoint, { method: "POST" })).headers.get("allow"),
      ).toBe("GET");
      expect((await fetch(endpoint, { method: "POST" })).status).toBe(405);
      expect(
        (
          await fetch(endpoint + query(), {
            headers: { "Sec-Fetch-Site": "cross-site" },
          })
        ).status,
      ).toBe(403);
      for (const url of [
        "file:///etc/passwd",
        "https://user:pass@example.com/",
        "https://example.com:8080/",
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://169.254.169.254/",
        `https://example.com/${"a".repeat(4096)}`,
      ])
        expect((await fetch(endpoint + query(url))).status, url).toBe(400);
      expect((await fetch(endpoint)).status).toBe(400);
      expect(
        (await fetch(endpoint.replace("article-content", "other"))).status,
      ).toBe(404);
    });
  });

  it("caches successes and misses, expires entries, and bounds cache size", async () => {
    let now = 0;
    const download = vi.fn(async (url) => ({
      html: url.includes("missing") ? null : page(),
      url,
    }));
    await withServer(
      createContentService({
        download,
        now: () => now,
        config: config({
          imageCacheMaxEntries: 1,
          imageCacheTtlSeconds: 10,
          imageMissTtlSeconds: 2,
        }),
      }),
      async (endpoint) => {
        const get = (url) => fetch(endpoint + query(url));
        expect((await get("https://publisher.example/story")).status).toBe(200);
        const cached = await get("https://publisher.example/story");
        expect(cached.headers.get("cache-control")).toBe("private, max-age=10");
        expect(download).toHaveBeenCalledTimes(1);
        now = 10001;
        await get("https://publisher.example/story");
        expect(download).toHaveBeenCalledTimes(2);
        expect((await get("https://publisher.example/missing")).status).toBe(
          422,
        );
        expect((await get("https://publisher.example/missing")).status).toBe(
          422,
        );
        expect(download).toHaveBeenCalledTimes(3);
        now += 2001;
        await get("https://publisher.example/missing");
        expect(download).toHaveBeenCalledTimes(4);
        await get("https://publisher.example/story");
        expect(download).toHaveBeenCalledTimes(5);
      },
    );
  });

  it("deduplicates requests and bounds concurrent extraction", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const download = vi.fn(async (url) => {
      await gate;
      return { html: page(), url };
    });
    await withServer(
      createContentService({
        download,
        config: config({ imageMaxConcurrent: 1 }),
      }),
      async (endpoint) => {
        const first = fetch(endpoint + query());
        const duplicate = fetch(endpoint + query());
        try {
          await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
          const busy = await fetch(
            endpoint + query("https://publisher.example/other"),
          );
          expect(busy.status).toBe(429);
          expect(busy.headers.get("retry-after")).toBe("10");
        } finally {
          release();
        }
        expect((await first).status).toBe(200);
        expect((await duplicate).status).toBe(200);
        expect(download).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("rate limits clients even on cache hits and resets the window", async () => {
    let now = 0;
    const download = vi.fn(async (url) => ({ html: page(), url }));
    await withServer(
      createContentService({
        download,
        now: () => now,
        config: config({ imageRateLimit: 1, imageRateWindowMs: 1000 }),
      }),
      async (endpoint) => {
        expect((await fetch(endpoint + query())).status).toBe(200);
        expect((await fetch(endpoint + query())).status).toBe(429);
        now = 1001;
        expect((await fetch(endpoint + query())).status).toBe(200);
        expect(download).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("returns meaningful upstream errors without leaking exceptions and recovers capacity", async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException("private timeout details", "TimeoutError"),
      )
      .mockRejectedValueOnce(new Error("private failure details"))
      .mockRejectedValueOnce(
        new ImageError(
          "Private and reserved network targets are not allowed.",
          400,
        ),
      )
      .mockResolvedValue({
        html: page(),
        url: "https://publisher.example/story",
      });
    await withServer(
      createContentService({
        download,
        config: config({ imageMaxConcurrent: 1 }),
      }),
      async (endpoint) => {
        for (const status of [504, 502, 400, 200]) {
          const response = await fetch(endpoint + query());
          expect(response.status).toBe(status);
          expect(await response.text()).not.toMatch(
            /private failure details|private timeout details/,
          );
        }
      },
    );
  });

  it("passes an aborting timeout signal to the downloader", async () => {
    const download = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    await withServer(
      createContentService({
        download,
        config: config({ imageTimeoutMs: 20 }),
      }),
      async (endpoint) => {
        const response = await fetch(endpoint + query());
        expect(response.status).toBe(504);
        expect(await response.json()).toEqual({
          error: "Article retrieval timed out.",
        });
      },
    );
  });
});
