import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createRefreshService } from "./refresh.mjs";

const authorization = "GoogleLogin auth=reader/api-session";
const ALL = "user/-/state/com.google/reading-list";
async function withRefresh(options, work) {
  const server = createServer(createRefreshService(options));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/refresh`;
  const post = (body = { stream: ALL }) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    await work(post, endpoint);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const subscriptions = [
  { id: "feed/1", categories: [{ id: "user/-/label/Tech" }] },
  { id: "feed/2", categories: [{ id: "user/-/label/Other" }] },
];
function upstreamMock(actualize = () => new Response("OK")) {
  return vi.fn(async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/user-info"))
      return Response.json({ userName: "reader" });
    if (url.pathname.endsWith("/subscription/list"))
      return Response.json({ subscriptions });
    return actualize(url, options);
  });
}
const config = {
  upstream: "http://freshrss.internal/base/",
  refreshTokens: '{"reader":"master-secret"}',
};

describe("FreshRSS article refresh bridge", () => {
  it("authenticates the API session and forces FreshRSS to pull each subscribed feed", async () => {
    const fetchImpl = upstreamMock();
    await withRefresh({ ...config, fetchImpl }, async (post) => {
      const response = await post({
        stream: ALL,
        apiUrl: "http://attacker.invalid/",
        username: "other-user",
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ completed: 2, failed: 0, total: 2 });
      expect(text).not.toContain("master-secret");
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const [input, options] of fetchImpl.mock.calls) {
      const url = new URL(input);
      expect(url.origin).toBe("http://freshrss.internal");
      expect(options.redirect).toBe("error");
      if (url.pathname === "/base/i/") {
        expect(url.searchParams.get("a")).toBe("actualize");
        expect(url.searchParams.get("user")).toBe("reader");
        expect(url.searchParams.get("token")).toBe("master-secret");
        expect(["1", "2"]).toContain(url.searchParams.get("id"));
        expect(options.headers.Authorization).toBeUndefined();
      } else expect(options.headers.Authorization).toBe(authorization);
    }
  });
  it("limits a partial refresh to the selected folder or subscribed feed", async () => {
    const fetchImpl = upstreamMock();
    await withRefresh({ ...config, fetchImpl }, async (post) => {
      expect(
        await (await post({ stream: "user/-/label/Tech" })).json(),
      ).toEqual({ completed: 1, failed: 0, total: 1 });
      expect(await (await post({ stream: "feed/999" })).json()).toEqual({
        completed: 0,
        failed: 0,
        total: 0,
      });
    });
    expect(
      fetchImpl.mock.calls.filter(
        ([input]) => new URL(input).pathname === "/base/i/",
      ),
    ).toHaveLength(1);
  });
  it("reports an unconfigured refresh and never pretends that articles were updated", async () => {
    const fetchImpl = vi.fn();
    await withRefresh(
      { upstream: config.upstream, refreshTokens: "", fetchImpl },
      async (post) => {
        const response = await post();
        expect(response.status).toBe(503);
        expect((await response.json()).error).toContain(
          "FRESHRSS_REFRESH_TOKENS",
        );
      },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects invalid API sessions before using a refresh token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 401 }));
    await withRefresh({ ...config, fetchImpl }, async (post) =>
      expect((await post()).status).toBe(401),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("treats a login page or failed actualization as failure", async () => {
    const fetchImpl = upstreamMock(
      () => new Response("<html>Login required</html>"),
    );
    await withRefresh({ ...config, fetchImpl }, async (post) => {
      const response = await post();
      expect(response.status).toBe(502);
      expect((await response.json()).error).toContain("could not refresh");
    });
  });
  it("reports partial failures and waits for the upstream refresh to finish", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = upstreamMock(async (url) => {
      await gate;
      return new Response(url.searchParams.get("id") === "1" ? "OK" : "error");
    });
    await withRefresh({ ...config, fetchImpl }, async (post) => {
      let settled = false;
      const pending = post().then((response) => {
        settled = true;
        return response;
      });
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
      expect(settled).toBe(false);
      release();
      expect(await (await pending).json()).toEqual({
        completed: 1,
        failed: 1,
        total: 2,
      });
    });
  });
});
