const ALL = "user/-/state/com.google/reading-list";
const STARRED = "user/-/state/com.google/starred";
import { readConfig } from "./config.mjs";

class RefreshError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Uses FreshRSS's documented, token-protected feed actualization action. */
export function createRefreshService({
  config = readConfig(),
  upstream = config.upstream,
  refreshTokens = config.refreshTokens,
  fetchImpl = fetch,
} = {}) {
  const pending = new Map();
  let base;
  let tokens;
  try {
    base = new URL(`${String(upstream).replace(/\/+$/, "")}/`);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    )
      base = undefined;
    tokens =
      typeof refreshTokens === "string"
        ? JSON.parse(refreshTokens)
        : refreshTokens;
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens))
      tokens = undefined;
  } catch {
    /* Configuration errors are reported when refresh is requested. */
  }

  function json(response, status, data) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(data));
  }
  async function getApi(path, authorization) {
    const url = new URL(`${config.apiPath}/reader/api/0/${path}`, base);
    url.searchParams.set("output", "json");
    const response = await fetchImpl(url, {
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(config.refreshApiTimeoutMs),
    });
    if (response.status === 401 || response.status === 403)
      throw new RefreshError(
        "FreshRSS rejected the API session. Sign in again.",
        401,
      );
    if (!response.ok)
      throw new RefreshError(
        "Could not contact the configured FreshRSS instance.",
      );
    return response.json();
  }
  async function updateFeeds(user, authorization, stream) {
    const token = Object.hasOwn(tokens, user) ? tokens[user] : undefined;
    if (typeof token !== "string" || !token.trim() || token.length > 1024)
      throw new RefreshError(
        `Server-side refresh is not configured for ${user}. Set that user’s FreshRSS master authentication token in FRESHRSS_REFRESH_TOKENS.`,
        503,
      );
    const { subscriptions = [] } = await getApi(
      "subscription/list",
      authorization,
    );
    const feeds = subscriptions.filter(
      (feed) =>
        /^feed\/[1-9][0-9]*$/.test(feed.id) &&
        (stream === ALL ||
          stream === STARRED ||
          feed.id === stream ||
          feed.categories?.some((category) => category.id === stream)),
    );
    const ids = [...new Set(feeds.map((feed) => feed.id.slice(5)))];
    let cursor = 0;
    let completed = 0;
    let failed = 0;
    const deadline = AbortSignal.timeout(config.refreshTimeoutMs);
    async function worker() {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        try {
          // A specific feed ID performs the same forced fetch as FreshRSS's manual refresh.
          const url = new URL(config.refreshPath, base);
          url.search = new URLSearchParams({
            c: "feed",
            a: "actualize",
            ajax: "1",
            user,
            token,
            id,
          }).toString();
          const response = await fetchImpl(url, {
            method: "GET",
            headers: { Accept: "text/plain" },
            redirect: "error",
            cache: "no-store",
            signal: AbortSignal.any([
              deadline,
              AbortSignal.timeout(config.refreshFeedTimeoutMs),
            ]),
          });
          if (!response.ok || (await response.text()).trim() !== "OK") failed++;
          else completed++;
        } catch {
          failed++;
        }
        if (deadline.aborted) {
          failed += ids.length - cursor;
          cursor = ids.length;
        }
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(config.refreshFeedConcurrency, ids.length) },
        worker,
      ),
    );
    if (failed === ids.length && failed > 0)
      throw new RefreshError(
        "FreshRSS could not refresh the feeds. Check the configured master authentication token and the FreshRSS server logs.",
      );
    return { completed, failed, total: ids.length };
  }
  return async function refreshHandler(request, response) {
    if (!config.refreshEnabled) {
      json(response, 503, {
        error: "Server-side refresh is disabled by REFRESH_ENABLED.",
      });
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      json(response, 405, { error: "Use POST to refresh feeds." });
      return;
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      json(response, 403, {
        error: "Cross-site refresh requests are not allowed.",
      });
      return;
    }
    if (!base || !tokens) {
      json(response, 503, {
        error:
          "Server-side article refresh requires FRESHRSS_URL and FRESHRSS_REFRESH_TOKENS on the Fresher server. See the README refresh setup.",
      });
      return;
    }
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== "string" ||
      !/^GoogleLogin auth=\S{1,512}$/.test(authorization)
    ) {
      json(response, 401, {
        error: "A valid FreshRSS API session is required.",
      });
      return;
    }
    if (
      !String(request.headers["content-type"] ?? "").startsWith(
        "application/json",
      )
    ) {
      json(response, 415, { error: "Expected application/json." });
      return;
    }
    try {
      let body = "";
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > config.refreshMaxBodyBytes)
          throw new RefreshError("Refresh request too large.", 413);
        body += chunk.toString("utf8");
      }
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        throw new RefreshError("Invalid refresh request.", 400);
      }
      const stream = data?.stream ?? ALL;
      if (
        typeof stream !== "string" ||
        stream.length > 2048 ||
        !(
          stream === ALL ||
          stream === STARRED ||
          /^feed\/[1-9][0-9]*$/.test(stream) ||
          stream.startsWith("user/-/label/")
        )
      )
        throw new RefreshError("Invalid feed selection.", 400);
      const info = await getApi("user-info", authorization);
      const user = info.userName ?? info.userId;
      if (typeof user !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(user))
        throw new RefreshError("FreshRSS returned an invalid user.", 401);
      if (!pending.has(user)) {
        if (pending.size >= config.refreshMaxConcurrentUsers)
          throw new RefreshError(
            "The server is already refreshing feeds. Try again shortly.",
            429,
          );
        const job = updateFeeds(user, authorization, stream);
        pending.set(user, job);
        void job.then(
          () => pending.delete(user),
          () => pending.delete(user),
        );
      }
      json(response, 200, await pending.get(user));
    } catch (error) {
      json(response, error instanceof RefreshError ? error.status : 502, {
        error:
          error instanceof RefreshError
            ? error.message
            : "Could not refresh articles on FreshRSS.",
      });
    }
  };
}
