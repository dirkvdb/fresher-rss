// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  FreshRSS,
  READ,
  STARRED,
  login,
  normalizeApiUrl,
} from "./api";

afterEach(() => vi.unstubAllGlobals());
const session = {
  apiUrl: "https://rss.example.com/api/greader.php",
  username: "reader",
  token: "reader/token",
};

describe("FreshRSS API contract", () => {
  it("normalizes subdirectory deployments and accepts explicit API endpoints", () => {
    expect(normalizeApiUrl("https://rss.example.com/freshrss/")).toBe(
      "https://rss.example.com/freshrss/api/greader.php",
    );
    expect(normalizeApiUrl(session.apiUrl)).toBe(session.apiUrl);
    expect(normalizeApiUrl("/freshrss-api")).toMatch(/\/freshrss-api$/);
    expect(() => normalizeApiUrl("javascript:alert(1)")).toThrow();
    expect(() =>
      normalizeApiUrl("https://user:password@example.com"),
    ).toThrow();
  });

  it("sends credentials only in a POST body and parses the auth token", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("SID=reader/token\nLSID=null\nAuth=reader/token\n"),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await login("https://rss.example.com", "reader", "secret&+"),
    ).toEqual(session);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`${session.apiUrl}/accounts/ClientLogin`);
    expect(init.method).toBe("POST");
    expect(init.body.get("Passwd")).toBe("secret&+");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
  });

  it("preserves Unicode and slash-containing folders, filters, and continuation IDs", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [], continuation: "1750000000000001" }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await new FreshRSS(session).articles(
      "user/-/label/Design / 设计",
      true,
      true,
      "1750000000000000",
    );
    const [input, init] = fetcher.mock.calls[0];
    const url = new URL(input);
    expect(url.pathname).toBe(
      "/api/greader.php/reader/api/0/stream/contents/user/-/label/Design%20%2F%20%E8%AE%BE%E8%AE%A1",
    );
    expect(url.searchParams.get("xt")).toBe(READ);
    expect(url.searchParams.get("r")).toBe("o");
    expect(url.searchParams.get("c")).toBe("1750000000000000");
    expect(init.headers.Authorization).toBe("GoogleLogin auth=reader/token");
    expect(result.continuation).toBe("1750000000000001");
  });

  it("uses the write token and preserves full 64-bit item IDs", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("write-token\n"))
      .mockResolvedValueOnce(new Response("OK"));
    vi.stubGlobal("fetch", fetcher);
    await new FreshRSS(session).tag(
      ["tag:google.com,2005:reader/item/ffffffffffffffff", "9007199254740993"],
      STARRED,
      true,
    );
    const body = fetcher.mock.calls[1][1].body as URLSearchParams;
    expect(body.get("T")).toBe("write-token");
    expect(body.get("a")).toBe(STARRED);
    expect(body.getAll("i")).toEqual([
      "tag:google.com,2005:reader/item/ffffffffffffffff",
      "9007199254740993",
    ]);
  });

  it("marks only explicitly supplied article IDs as read", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("write-token"))
      .mockResolvedValueOnce(new Response("OK"));
    vi.stubGlobal("fetch", fetcher);
    await new FreshRSS(session).tag(["displayed-1", "displayed-2"], READ, true);
    expect(fetcher.mock.calls[1][0]).toBe(
      `${session.apiUrl}/reader/api/0/edit-tag?output=json`,
    );
    const body = fetcher.mock.calls[1][1].body as URLSearchParams;
    expect(body.get("a")).toBe(READ);
    expect(body.getAll("i")).toEqual(["displayed-1", "displayed-2"]);
    expect(body.has("s")).toBe(false);
    expect(body.has("ts")).toBe(false);
  });

  it("distinguishes disabled API access from an expired session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    );
    await expect(new FreshRSS(session).subscriptions()).rejects.toThrow(
      "API is disabled",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 401 })),
    );
    await expect(new FreshRSS(session).counts()).rejects.toMatchObject({
      status: 401,
    });
    expect(new ApiError("expired", 401)).toBeInstanceOf(Error);
  });
});
