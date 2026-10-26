import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadPage,
  publicAddress,
  resolvePublicTarget,
  webUrl,
} from "./network.mjs";
import { extractImages } from "./extract.mjs";
import { createImageService } from "./service.mjs";
import { downloadArticlePage } from "./article-download.mjs";
import { readConfig } from "./config.mjs";
import { createUnreadCache } from "./unread-cache.mjs";

vi.mock("./article-download.mjs", { spy: true });
afterEach(() => vi.mocked(downloadArticlePage).mockReset());

async function withServer(handler, work) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await work(
      `http://127.0.0.1:${server.address().port}/api/article-image`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const article = (url) => `?url=${encodeURIComponent(url)}`;

describe("outbound request restrictions", () => {
  it("rejects private, reserved, multicast, and mapped IPv6 addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ])
      expect(publicAddress(ip), ip).toBe(false);
    expect(publicAddress("1.1.1.1")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("rejects credentials, unsupported protocols, ports, and numeric loopback forms", async () => {
    for (const url of [
      "file:///etc/passwd",
      "https://user:password@example.com/",
      "https://example.com:8080/",
      "ftp://example.com/",
    ])
      expect(webUrl(url)).toBeNull();
    for (const url of [
      "http://2130706433/",
      "http://0x7f000001/",
      "http://[::ffff:127.0.0.1]/",
    ])
      await expect(resolvePublicTarget(url)).rejects.toMatchObject({
        status: 400,
      });
  });
  it("pins a public DNS answer and rejects mixed public/private answers", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    const target = await resolvePublicTarget(
      "https://publisher.example/article",
      { lookup },
    );
    expect(target.address).toBe("1.1.1.1");
    expect(target.hostname).toBe("publisher.example");
    lookup.mockResolvedValue([
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      resolvePublicTarget("https://publisher.example/", { lookup }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("revalidates redirect destinations before making another request", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    const requestPage = vi.fn().mockResolvedValue({
      status: 302,
      location: "http://169.254.169.254/latest/meta-data/",
    });
    await expect(
      downloadPage("https://publisher.example/article", {
        lookup,
        requestPage,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(requestPage).toHaveBeenCalledTimes(1);
    expect(requestPage.mock.calls[0][0].address).toBe("1.1.1.1");
  });
  it("times out DNS and caps redirect chains", async () => {
    await expect(
      resolvePublicTarget("https://publisher.example/", {
        lookup: () => new Promise(() => {}),
        signal: AbortSignal.timeout(20),
      }),
    ).rejects.toThrow();
    const lookup = async () => [{ address: "1.1.1.1", family: 4 }];
    const requestPage = vi
      .fn()
      .mockResolvedValue({ status: 302, location: "/next" });
    await expect(
      downloadPage("https://publisher.example/", { lookup, requestPage }),
    ).rejects.toThrow("Too many");
    expect(requestPage).toHaveBeenCalledTimes(4);
  });
});

describe("publisher metadata", () => {
  it("extracts the iCulture social-image URL without executing publisher scripts", () => {
    const html =
      '<script>throw Error("must never execute")</script><meta property="og:image" content="https://www.iculture.nl/wp-json/social-image-generator/v1/image/1466246/?v=123&amp;size=1200">';
    expect(
      extractImages(
        html,
        "https://www.iculture.nl/nieuws/iphone-duo-internationale-reviews/",
      )[0],
    ).toBe(
      "https://www.iculture.nl/wp-json/social-image-generator/v1/image/1466246/?v=123&size=1200",
    );
  });
  it("resolves structured-data graph references and ignores publisher logos", () => {
    const data = {
      "@graph": [
        { "@type": "Organization", image: "/logo.png" },
        { "@type": "NewsArticle", image: { "@id": "#photo" } },
        { "@type": "ImageObject", "@id": "#photo", contentUrl: "../photo.jpg" },
      ],
    };
    expect(
      extractImages(
        `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
        "https://publisher.example/posts/story",
      ),
    ).toEqual(["https://publisher.example/photo.jpg"]);
  });
});

describe("image HTTP service", () => {
  it("discovers, caches, and serves Tweakers covers after the functional consent redirect", async () => {
    const url =
      "https://tweakers.net/nieuws/253774/apple-erkent-probleem-met-scherm-iphone-duo-en-vervangt-getroffen-exemplaren.html";
    const image = "https://tweakers.net/ext/i/2008471590.jpeg";
    const authId = "12345678-1234-4abc-8def-123456789abc";
    const callback = `https://tweakers.net/privacy-gate/store/?authId=${authId}`;
    const rawDownload = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://myprivacy.dpgmedia.nl/consent?siteKey=tweakers",
        html: `<script>const callbackUrl = new URL(decodeURIComponent('${encodeURIComponent(callback)}'));</script>`,
      })
      .mockResolvedValueOnce({
        url,
        html: `<meta property="og:image" content="${image}">`,
      });
    const actual = await vi.importActual("./article-download.mjs");
    vi.mocked(downloadArticlePage).mockImplementationOnce((input, options) =>
      actual.downloadArticlePage(input, { ...options, download: rawDownload }),
    );
    const config = readConfig({
      FRESHRSS_URL: "https://rss.example",
      FRESHRSS_API_PASSWORDS: '{"reader":"secret"}',
      CONTENT_UNREAD_CACHE_ENABLED: "false",
    });
    const downloadThumbnail = vi.fn().mockResolvedValue({
      body: Buffer.from("Tweakers cover"),
      contentType: "image/jpeg",
    });
    const cache = createUnreadCache({
      config,
      lookupImage: (input) => service.lookup(input),
      fetchImpl: async (input) =>
        input.pathname.endsWith("ClientLogin")
          ? new Response("Auth=reader-token\n")
          : Response.json({ items: [{ alternate: [{ href: url }] }] }),
      downloadThumbnail,
    });
    const service = createImageService({
      config,
      thumbnailCache: cache,
      resolveTarget: vi.fn().mockResolvedValue({}),
    });
    try {
      await withServer(service, async (endpoint) => {
        const response = await fetch(endpoint + article(url), {
          headers: { Cookie: "browser=secret", Authorization: "secret" },
        });
        expect(await response.json()).toEqual({ image });
        expect(rawDownload).toHaveBeenCalledTimes(2);
        expect(rawDownload.mock.calls[0][1]).not.toHaveProperty(
          "publisherCookie",
        );
        expect(rawDownload.mock.calls[1][1].publisherCookie).toEqual({
          origin: "https://tweakers.net",
          value: `authId=${authId}`,
        });
        expect(rawDownload.mock.calls[1][1].signal).toBe(
          rawDownload.mock.calls[0][1].signal,
        );
        await cache.sync();
        expect(cache.imageForArticle(url)).toBe(image);
        expect(downloadThumbnail).toHaveBeenCalledExactlyOnceWith(
          image,
          expect.objectContaining({ config, signal: expect.any(AbortSignal) }),
        );
        const thumbnail = await fetch(
          endpoint + article(image) + "&thumbnail=1",
        );
        expect(thumbnail.status).toBe(200);
        expect(thumbnail.headers.get("content-type")).toBe("image/jpeg");
        expect(await thumbnail.text()).toBe("Tweakers cover");
        expect(downloadArticlePage).toHaveBeenCalledTimes(1);
      });
    } finally {
      cache.close();
    }
  });

  it("rejects internal destinations and cross-site requests", async () => {
    await withServer(createImageService(), async (endpoint) => {
      for (const url of [
        "http://127.0.0.1/",
        "http://[::1]/",
        "file:///etc/passwd",
      ]) {
        const response = await fetch(endpoint + article(url));
        expect(response.status).toBe(400);
      }
      expect(
        (
          await fetch(endpoint + article("https://example.com/"), {
            headers: { "Sec-Fetch-Site": "cross-site" },
          })
        ).status,
      ).toBe(403);
      expect((await fetch(endpoint, { method: "POST" })).status).toBe(405);
    });
  });
  it("filters unsafe discovered images, caches results, and never forwards credentials", async () => {
    const download = vi.fn().mockResolvedValue({
      html: '<meta property="og:image" content="http://127.0.0.1/private"><meta name="twitter:image" content="https://1.1.1.1/cover.jpg">',
      url: "https://publisher.example/story",
    });
    await withServer(createImageService({ download }), async (endpoint) => {
      const url = endpoint + article("https://publisher.example/story");
      const first = await fetch(url, {
        headers: { Authorization: "private-token", Cookie: "private-cookie" },
      });
      expect(await first.json()).toEqual({
        image: "https://1.1.1.1/cover.jpg",
      });
      expect(first.headers.get("cache-control")).toContain("private");
      await fetch(url);
      expect(download).toHaveBeenCalledTimes(1);
      expect(download.mock.calls[0][1]).not.toHaveProperty("headers");
      expect(download.mock.calls[0][1]).toHaveProperty("signal");
    });
  });
  it("bounds concurrent work and returns a retryable response", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const download = vi.fn(async (url) => {
      await gate;
      return { html: "", url };
    });
    await withServer(createImageService({ download }), async (endpoint) => {
      const jobs = Array.from({ length: 4 }, (_, i) =>
        fetch(endpoint + article(`https://publisher.example/${i}`)),
      );
      try {
        await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(4));
        const response = await fetch(
          endpoint + article("https://publisher.example/extra"),
        );
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("10");
      } finally {
        release();
        await Promise.all(jobs);
      }
    });
  });
});
