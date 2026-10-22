import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadArticlePage } from "./article-download.mjs";
import { DEFAULT_CONFIG } from "./config.mjs";
import { downloadPage } from "./network.mjs";

const original =
  "https://tweakers.net/nieuws/253658/ncsc-krijgt-eerste-signalen-dat-php-lekken-succesvol-zijn-misbruikt.html";
const consentUrl = "https://myprivacy.dpgmedia.nl/consent";
const authId = "12345678-1234-4abc-8def-123456789abc";
const publisherCookie = {
  origin: "https://tweakers.net",
  value: `authId=${authId}`,
};
const callbackUrl = `https://tweakers.net/privacy-gate/store/?returnUrl=${encodeURIComponent(original)}&authId=${authId}`;
const consentHtml = (callback = callbackUrl, quote = "'") =>
  `<script>const callbackUrl = new URL(decodeURIComponent(${quote}${encodeURIComponent(callback)}${quote})); throw Error("must not execute");</script>`;
const consentPage = (callback = callbackUrl) => ({
  url: consentUrl,
  html: consentHtml(callback),
});
const articlePage = { url: original, html: "<article>Full article</article>" };
const publicLookup = async () => [{ address: "1.1.1.1", family: 4 }];

afterEach(() => vi.restoreAllMocks());

describe("Tweakers article consent retry", () => {
  it.each(["'", '"'])(
    "reads a %s-quoted encoded callback inertly and retries the original URL with only authId",
    async (quote) => {
      const download = vi
        .fn()
        .mockResolvedValueOnce({
          url: consentUrl,
          html: consentHtml(callbackUrl, quote),
        })
        .mockResolvedValueOnce(articlePage);
      const signal = new AbortController().signal;
      const result = await downloadArticlePage(original, {
        download,
        signal,
        headers: { Cookie: "browser=secret", Authorization: "secret" },
        publisherCookie: {
          origin: "https://evil.example",
          value: "tracking=yes",
        },
      });
      expect(result).toBe(articlePage);
      expect(download.mock.calls).toEqual([
        [original, { config: DEFAULT_CONFIG, signal }],
        [original, { config: DEFAULT_CONFIG, signal, publisherCookie }],
      ]);
    },
  );

  it("accepts a consent query string without broadening the exact origin or path", async () => {
    const download = vi
      .fn()
      .mockResolvedValueOnce({
        ...consentPage(),
        url: `${consentUrl}?siteKey=tweakers`,
      })
      .mockResolvedValueOnce(articlePage);
    await expect(downloadArticlePage(original, { download })).resolves.toBe(
      articlePage,
    );
    expect(download).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://publisher.example/story",
    "https://www.tweakers.net/story",
    "https://tweakers.net.evil.example/story",
    "https://tweakers.net@evil.example/story",
    "https://evil.example@tweakers.net/story",
    "https://tweakers.net./story",
    "https://tweakers.net:8443/story",
    "http://tweakers.net/story",
  ])("never retries another original origin: %s", async (input) => {
    const page = consentPage();
    const download = vi.fn().mockResolvedValue(page);
    await expect(downloadArticlePage(input, { download })).resolves.toBe(page);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).not.toHaveProperty("publisherCookie");
  });

  it.each([
    "http://myprivacy.dpgmedia.nl/consent",
    "https://myprivacy.dpgmedia.nl.evil.example/consent",
    "https://myprivacy.dpgmedia.nl@evil.example/consent",
    "https://evil.example@myprivacy.dpgmedia.nl/consent",
    "https://myprivacy.dpgmedia.nl:8443/consent",
    "https://myprivacy.dpgmedia.nl./consent",
    "https://myprivacy.dpgmedia.nl/consent/",
    "https://myprivacy.dpgmedia.nl/consent/other",
    "https://myprivacy.dpgmedia.nl/other",
    "https://myprivacy.dpgmedia.nl/consent#other",
    "not a URL",
  ])("does not recognize a different final consent URL: %s", async (url) => {
    const page = { ...consentPage(), url };
    const download = vi.fn().mockResolvedValue(page);
    await expect(downloadArticlePage(original, { download })).resolves.toBe(
      page,
    );
    expect(download).toHaveBeenCalledTimes(1);
  });

  it.each([
    `http://tweakers.net/privacy-gate/store/?authId=${authId}`,
    `https://tweakers.net.evil.example/privacy-gate/store/?authId=${authId}`,
    `https://tweakers.net@evil.example/privacy-gate/store/?authId=${authId}`,
    `https://evil.example@tweakers.net/privacy-gate/store/?authId=${authId}`,
    `https://tweakers.net:8443/privacy-gate/store/?authId=${authId}`,
    `https://www.tweakers.net/privacy-gate/store/?authId=${authId}`,
    `https://tweakers.net/privacy-gate/store?authId=${authId}`,
    `https://tweakers.net/privacy-gate/store/other?authId=${authId}`,
    `https://tweakers.net/other/?authId=${authId}`,
    `https://tweakers.net/privacy-gate/store/?authId=${authId}#other`,
    `https://127.0.0.1/privacy-gate/store/?authId=${authId}`,
    `/privacy-gate/store/?authId=${authId}`,
    "javascript:alert(1)",
    "not a URL",
    "https://tweakers.net/privacy-gate/store/",
    "https://tweakers.net/privacy-gate/store/?authId=",
    "https://tweakers.net/privacy-gate/store/?authId=not-a-uuid",
    `https://tweakers.net/privacy-gate/store/?authId=${authId}0`,
    `https://tweakers.net/privacy-gate/store/?authId=${authId};tracking=yes`,
    `https://tweakers.net/privacy-gate/store/?authId=${authId}%0d%0aCookie:tracking=yes`,
    `https://tweakers.net/privacy-gate/store/?authId=${authId}&authId=${authId}`,
    `https://tweakers.net/privacy-gate/store/?returnUrl=${encodeURIComponent(`https://tweakers.net/?authId=${authId}`)}`,
  ])("rejects malformed or adversarial callbacks: %s", async (callback) => {
    const page = consentPage(callback);
    const download = vi.fn().mockResolvedValue(page);
    await expect(downloadArticlePage(original, { download })).resolves.toBe(
      page,
    );
    expect(download).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    "",
    `<a href="${callbackUrl}">Continue</a>`,
    "const callbackUrl = new URL(decodeURIComponent('%ZZ'));",
    "const callbackUrl = new URL(decodeURIComponent('%E0%A4%A'));",
    `const callbackUrl = new URL(decodeURIComponent(getCallback()));`,
    `const callbackUrl = new URL(decodeURIComponent('${encodeURIComponent(callbackUrl)}' + evil()));`,
    `${consentHtml()}${consentHtml()}`,
  ])(
    "does not evaluate expressions or accept missing/ambiguous literals (%#)",
    async (html) => {
      const page = { url: consentUrl, html };
      const download = vi.fn().mockResolvedValue(page);
      await expect(downloadArticlePage(original, { download })).resolves.toBe(
        page,
      );
      expect(download).toHaveBeenCalledTimes(1);
    },
  );

  it("returns normal publisher pages unchanged and never persists the retry cookie", async () => {
    const normal = {
      url: "https://publisher.example/final",
      html: "<article>Normal</article>",
    };
    const download = vi
      .fn()
      .mockResolvedValueOnce(consentPage())
      .mockResolvedValueOnce(articlePage)
      .mockResolvedValueOnce(normal)
      .mockResolvedValueOnce(articlePage);
    await downloadArticlePage(original, { download });
    await expect(
      downloadArticlePage("https://publisher.example/story", { download }),
    ).resolves.toBe(normal);
    await expect(downloadArticlePage(original, { download })).resolves.toBe(
      articlePage,
    );
    expect(download).toHaveBeenCalledTimes(4);
    for (const index of [0, 2, 3])
      expect(download.mock.calls[index][1]).not.toHaveProperty(
        "publisherCookie",
      );
  });

  it("allows only one retry even when it returns the consent gate again", async () => {
    const page = consentPage();
    const download = vi.fn().mockResolvedValue(page);
    await expect(downloadArticlePage(original, { download })).resolves.toBe(
      page,
    );
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("does not retry initial errors or errors from the single retry", async () => {
    const error = new Error("Publisher failed");
    const download = vi.fn().mockRejectedValueOnce(error);
    await expect(downloadArticlePage(original, { download })).rejects.toBe(
      error,
    );
    expect(download).toHaveBeenCalledTimes(1);
    download
      .mockReset()
      .mockResolvedValueOnce(consentPage())
      .mockRejectedValueOnce(error);
    await expect(downloadArticlePage(original, { download })).rejects.toBe(
      error,
    );
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("creates one timeout deadline shared by initial download and retry", async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    const config = { ...DEFAULT_CONFIG, imageTimeoutMs: 123 };
    const reason = new DOMException("Deadline expired", "TimeoutError");
    const download = vi.fn(async (_url, { signal }) => {
      expect(signal).toBe(controller.signal);
      if (download.mock.calls.length === 1) return consentPage();
      controller.abort(reason);
      signal.throwIfAborted();
    });
    await expect(
      downloadArticlePage(original, { config, download }),
    ).rejects.toBe(reason);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(123);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("uses the caller's signal unchanged and does not retry after it aborts", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const download = vi.fn(async (_url, { signal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return consentPage();
    });
    await expect(
      downloadArticlePage(original, { download, signal: controller.signal }),
    ).rejects.toBe(controller.signal.reason);
    expect(download).toHaveBeenCalledTimes(1);
    expect(timeout).not.toHaveBeenCalled();
    download.mockClear();
    await expect(
      downloadArticlePage(original, { download, signal: controller.signal }),
    ).rejects.toBe(controller.signal.reason);
    expect(download).not.toHaveBeenCalled();
  });
});

// Exercise readResponse's real header construction without opening network sockets.
function mockRequests(responses) {
  const calls = [];
  const request = (url, options, callback) => {
    calls.push({ url: url.href, options });
    const pending = new EventEmitter();
    pending.end = () => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected publisher request");
      const response = Readable.from([Buffer.from(next.html ?? "")]);
      response.statusCode = next.status ?? 200;
      response.headers = { "content-type": "text/html", ...next.headers };
      callback(response);
    };
    return pending;
  };
  vi.spyOn(http, "request").mockImplementation(request);
  vi.spyOn(https, "request").mockImplementation(request);
  return calls;
}

describe("origin-scoped publisher cookie networking", () => {
  it("omits Cookie normally and ignores publisher Set-Cookie headers", async () => {
    const calls = mockRequests([
      {
        status: 302,
        headers: { location: "/final", "set-cookie": ["tracking=yes"] },
      },
      { html: articlePage.html },
    ]);
    await downloadPage(original, { lookup: publicLookup });
    expect(calls).toHaveLength(2);
    for (const { options } of calls) {
      expect(options.headers).not.toHaveProperty("Cookie");
      expect(options.headers).not.toHaveProperty("Authorization");
    }
  });

  it("sends only authId on exact HTTPS origin hops, not external hosts, subdomains, ports or downgrades", async () => {
    const destinations = [
      "https://tweakers.net/same-origin",
      "https://external.example/story",
      "https://www.tweakers.net/story",
      "http://tweakers.net/story",
      "https://tweakers.net:8443/story",
      "https://tweakers.net/final",
    ];
    const calls = mockRequests([
      ...destinations.map((location) => ({
        status: 302,
        headers: {
          location,
          "set-cookie": ["tracking=yes", "authId=untrusted"],
        },
      })),
      { html: articlePage.html },
    ]);
    const config = {
      ...DEFAULT_CONFIG,
      imageMaxRedirects: 6,
      imageAllowedPorts: [80, 443, 8443],
    };
    await downloadPage(original, {
      config,
      lookup: publicLookup,
      publisherCookie,
    });
    expect(calls.map(({ url }) => url)).toEqual([original, ...destinations]);
    expect(calls.map(({ options }) => options.headers.Cookie)).toEqual([
      publisherCookie.value,
      publisherCookie.value,
      undefined,
      undefined,
      undefined,
      undefined,
      publisherCookie.value,
    ]);
    for (const { options } of calls) {
      expect(options.headers).not.toHaveProperty("Authorization");
      expect(options.headers.Cookie ?? "").not.toContain("tracking");
    }
  });

  it("passes the scoped option to requestPage only for an exact origin match", async () => {
    const requestPage = vi
      .fn()
      .mockResolvedValueOnce({ status: 302, location: consentUrl })
      .mockResolvedValueOnce({
        status: 302,
        location: "http://tweakers.net/story",
      })
      .mockResolvedValueOnce({ status: 200, html: "No consent" });
    await downloadPage(original, {
      lookup: publicLookup,
      requestPage,
      publisherCookie,
    });
    expect(requestPage.mock.calls.map((call) => call[3])).toEqual([
      publisherCookie,
      undefined,
      undefined,
    ]);
  });

  it("uses the normal downloader's SSRF validation again on the consent retry", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValueOnce([
        { address: "1.1.1.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    const requestPage = vi
      .fn()
      .mockResolvedValueOnce({ status: 302, location: consentUrl })
      .mockResolvedValueOnce({ status: 200, html: consentHtml() });
    await expect(
      downloadArticlePage(original, {
        download: (url, options) =>
          downloadPage(url, { ...options, lookup, requestPage }),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(requestPage).toHaveBeenCalledTimes(2);
    expect(requestPage.mock.calls.every((call) => call[3] === undefined)).toBe(
      true,
    );
  });

  it("rejects private redirect targets even when a publisher cookie is present", async () => {
    const requestPage = vi.fn().mockResolvedValue({
      status: 302,
      location: "http://169.254.169.254/latest/meta-data/",
    });
    await expect(
      downloadPage(original, {
        lookup: publicLookup,
        requestPage,
        publisherCookie,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(requestPage).toHaveBeenCalledTimes(1);
  });

  it("performs the complete consent flow through downloadPage with no callback request", async () => {
    const calls = mockRequests([
      { status: 302, headers: { location: consentUrl } },
      { html: consentHtml() },
      { html: articlePage.html },
    ]);
    await expect(
      downloadArticlePage(original, {
        download: (url, options) =>
          downloadPage(url, { ...options, lookup: publicLookup }),
      }),
    ).resolves.toEqual(articlePage);
    expect(calls.map(({ url }) => url)).toEqual([
      original,
      consentUrl,
      original,
    ]);
    expect(calls.map(({ options }) => options.headers.Cookie)).toEqual([
      undefined,
      undefined,
      publisherCookie.value,
    ]);
  });
});
