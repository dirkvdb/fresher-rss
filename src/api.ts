import { runtimeConfig } from "./runtime";

export const ALL = "user/-/state/com.google/reading-list";
export const READ = "user/-/state/com.google/read";
export const STARRED = "user/-/state/com.google/starred";
export interface Session {
  apiUrl: string;
  token: string;
  username: string;
}
export interface Feed {
  id: string;
  title: string;
  categories: { id: string; label: string }[];
  htmlUrl?: string;
  iconUrl?: string;
}
export interface Article {
  id: string;
  title: string;
  published: number;
  author?: string;
  categories: string[];
  summary?: { content: string };
  content?: { content: string };
  alternate?: { href: string }[];
  enclosure?: { href: string; type?: string }[];
  origin: { streamId: string; title: string; htmlUrl?: string };
}
export interface Stream {
  items: Article[];
  continuation?: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

export function normalizeApiUrl(input: string): string {
  const url = new URL(input, window.location.origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Enter a valid HTTP or HTTPS instance URL.");
  url.search = "";
  url.hash = "";
  let path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/api/greader.php") && !path.endsWith("/freshrss-api"))
    path += "/api/greader.php";
  url.pathname = path;
  return url.href.replace(/\/$/, "");
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(runtimeConfig().apiTimeoutMs),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      "Could not reach FreshRSS. Check the URL, HTTPS, and API access. For cross-origin issues, use the Docker API proxy.",
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status === 401 || response.status === 403
        ? "Your session expired or the API credentials are incorrect. Please sign in again."
        : response.status === 503
          ? "The FreshRSS API is disabled. Enable API access in FreshRSS administration."
          : `FreshRSS returned an error (${response.status}). Please try again.`,
      response.status,
    );
  return response;
}

export async function login(
  instance: string,
  username: string,
  password: string,
): Promise<Session> {
  const apiUrl = normalizeApiUrl(instance);
  const response = await request(`${apiUrl}/accounts/ClientLogin`, {
    method: "POST",
    body: new URLSearchParams({ Email: username, Passwd: password }),
  });
  const token = (await response.text()).match(/^Auth=(.+)$/m)?.[1].trim();
  if (!token)
    throw new ApiError(
      "FreshRSS did not return an API token. Check the instance URL and that API access is enabled.",
    );
  return { apiUrl, token, username };
}

export class FreshRSS {
  constructor(public session: Session) {}
  private async call(
    path: string,
    params = new URLSearchParams(),
    body?: URLSearchParams,
    signal?: AbortSignal,
  ) {
    params.set("output", "json");
    return request(`${this.session.apiUrl}/reader/api/0/${path}?${params}`, {
      method: body ? "POST" : "GET",
      body,
      signal,
      headers: { Authorization: `GoogleLogin auth=${this.session.token}` },
    });
  }
  async subscriptions(): Promise<Feed[]> {
    return (
      (await (await this.call("subscription/list")).json()).subscriptions ?? []
    );
  }
  async counts(): Promise<Record<string, number>> {
    const data = await (await this.call("unread-count")).json();
    return Object.fromEntries(
      (data.unreadcounts ?? []).map((c: { id: string; count: number }) => [
        c.id,
        c.count,
      ]),
    );
  }
  async refresh(
    stream = ALL,
  ): Promise<{ completed: number; failed: number; total: number }> {
    const url = new URL(runtimeConfig().refreshApiUrl, document.baseURI);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(runtimeConfig().refreshClientTimeoutMs),
        headers: {
          Authorization: `GoogleLogin auth=${this.session.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ stream }),
      });
    } catch {
      throw new ApiError(
        "Could not complete the server-side FreshRSS refresh. Please try again.",
      );
    }
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new ApiError(
        "The Fresher article-refresh service is unavailable. Use the Node-enabled deployment.",
      );
    const result = await response.json();
    if (!response.ok)
      throw new ApiError(
        result.error || "FreshRSS could not refresh articles.",
        response.status,
      );
    if (
      !Number.isInteger(result.completed) ||
      !Number.isInteger(result.failed) ||
      !Number.isInteger(result.total)
    )
      throw new ApiError(
        "The article-refresh service returned an invalid response.",
      );
    return result;
  }
  async articles(
    stream: string,
    unread: boolean,
    oldest: boolean,
    continuation?: string,
    signal?: AbortSignal,
  ): Promise<Stream> {
    const params = new URLSearchParams({
      n: String(runtimeConfig().pageSize),
      r: oldest ? "o" : "d",
    });
    if (unread) params.set("xt", READ);
    if (continuation) params.set("c", continuation);
    // Keep the entire folder name in one encoded segment, including embedded slashes.
    const path = stream.startsWith("user/-/label/")
      ? `user/-/label/${encodeURIComponent(stream.slice(13))}`
      : stream.split("/").map(encodeURIComponent).join("/");
    return (
      await this.call(`stream/contents/${path}`, params, undefined, signal)
    ).json();
  }
  private async write(path: string, body: URLSearchParams) {
    const token = (await (await this.call("token")).text()).trim();
    body.set("T", token);
    const response = await this.call(path, new URLSearchParams(), body);
    if ((await response.text()).trim() !== "OK")
      throw new ApiError(
        "FreshRSS could not save that change. Please try again.",
      );
  }
  async tag(ids: string[], tag: string, add: boolean) {
    const body = new URLSearchParams({ [add ? "a" : "r"]: tag });
    ids.forEach((id) => body.append("i", id));
    await this.write("edit-tag", body);
  }
  async markAllRead(stream: string, before: number) {
    // FreshRSS compares this value to microsecond-based entry IDs. `before` is milliseconds.
    await this.write(
      "mark-all-as-read",
      new URLSearchParams({ s: stream, ts: `${before}000` }),
    );
  }
}
