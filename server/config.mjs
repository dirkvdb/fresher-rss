import { isIP } from "node:net";

/** All deployment defaults live here. Only `public` is sent to the browser. */
export function readConfig(env = process.env) {
  const value = (key, fallback) =>
    env[key] === undefined || env[key] === "" ? fallback : String(env[key]);
  function integer(key, fallback, min = 1, max = 2147483647) {
    const raw = value(key, String(fallback));
    const number = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(number) ||
      number < min ||
      number > max
    )
      throw new Error(`${key} must be an integer from ${min} to ${max}.`);
    return number;
  }
  function boolean(key, fallback) {
    const raw = value(key, String(fallback)).toLowerCase();
    if (["true", "1"].includes(raw)) return true;
    if (["false", "0"].includes(raw)) return false;
    throw new Error(`${key} must be true or false.`);
  }
  function choice(key, fallback, choices) {
    const raw = value(key, fallback);
    if (!choices.includes(raw))
      throw new Error(`${key} must be one of: ${choices.join(", ")}.`);
    return raw;
  }
  function publicUrl(key, fallback) {
    const raw = value(key, fallback);
    if (!raw) return "";
    const url = new URL(raw, "http://fresher.invalid/");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /[\r\n]/.test(raw)
    )
      throw new Error(
        `${key} must be an HTTP(S) URL or relative path without credentials.`,
      );
    return raw;
  }
  function relativePath(key, fallback) {
    const raw = value(key, fallback).replace(/^\/+/, "");
    if (!raw || raw.includes("..") || !/^[a-zA-Z0-9_./-]+$/.test(raw))
      throw new Error(`${key} must be a relative path.`);
    return raw;
  }
  const upstreamValue = value("FRESHRSS_URL", "");
  let upstream = "";
  if (upstreamValue) {
    const url = new URL(upstreamValue);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "FRESHRSS_URL must be an HTTP(S) instance URL without credentials, query, or fragment.",
      );
    upstream = url.href.replace(/\/+$/, "");
  }
  const config = {
    upstream,
    refreshTokens: value("FRESHRSS_REFRESH_TOKENS", ""),
    apiPath: relativePath("FRESHRSS_API_PATH", "api/greader.php"),
    refreshPath: relativePath("FRESHRSS_REFRESH_PATH", "i/"),
    serverHost: value("SERVER_HOST", "127.0.0.1"),
    serverPort: integer("SERVER_PORT", value("IMAGE_PORT", "3001"), 1, 65535),
    serverUid: integer("SERVER_UID", 65534, 1),
    serverGid: integer("SERVER_GID", 65534, 1),
    httpMaxHeaderBytes: integer("HTTP_MAX_HEADER_BYTES", 8192, 1024),
    httpHeadersTimeoutMs: integer("HTTP_HEADERS_TIMEOUT_MS", 5000),
    httpRequestTimeoutMs: integer("HTTP_REQUEST_TIMEOUT_MS", 15000),
    httpKeepAliveTimeoutMs: integer("HTTP_KEEP_ALIVE_TIMEOUT_MS", 5000),
    httpMaxRequestsPerSocket: integer("HTTP_MAX_REQUESTS_PER_SOCKET", 100),
    httpMaxHeaders: integer("HTTP_MAX_HEADERS", 30),
    shutdownTimeoutMs: integer("SHUTDOWN_TIMEOUT_MS", 11000),
    imageEnabled: boolean("IMAGE_ENABLED", true),
    imageTimeoutMs: integer("IMAGE_TIMEOUT_MS", 10000),
    imageDnsTimeoutMs: integer("IMAGE_DNS_TIMEOUT_MS", 5000),
    imageMaxHtmlBytes: integer("IMAGE_MAX_HTML_BYTES", 1048576, 1024),
    imageMaxRedirects: integer("IMAGE_MAX_REDIRECTS", 3, 0, 20),
    imageMaxConcurrent: integer("IMAGE_MAX_CONCURRENT", 4, 1, 128),
    imageCacheMaxEntries: integer("IMAGE_CACHE_MAX_ENTRIES", 512),
    imageCacheTtlSeconds: integer("IMAGE_CACHE_TTL_SECONDS", 86400, 0),
    imageMissTtlSeconds: integer("IMAGE_MISS_TTL_SECONDS", 900, 0),
    imageRateLimit: integer("IMAGE_RATE_LIMIT", 120),
    imageRateWindowMs: integer("IMAGE_RATE_WINDOW_MS", 60000),
    imageMaxClients: integer("IMAGE_MAX_CLIENTS", 512),
    imageMaxUrlLength: integer("IMAGE_MAX_URL_LENGTH", 4096, 256, 65536),
    imageMaxCandidates: integer("IMAGE_MAX_CANDIDATES", 8, 1, 64),
    imageUserAgent: value(
      "IMAGE_USER_AGENT",
      "Mozilla/5.0 (compatible; FresherRSS/1.0; article image preview)",
    ),
    imageAllowedPorts: value("IMAGE_ALLOWED_PORTS", "80,443")
      .split(",")
      .map((port) => Number(port.trim())),
    refreshEnabled: boolean("REFRESH_ENABLED", true),
    refreshApiTimeoutMs: integer("REFRESH_API_TIMEOUT_MS", 10000),
    refreshFeedTimeoutMs: integer("REFRESH_FEED_TIMEOUT_MS", 30000),
    refreshTimeoutMs: integer("REFRESH_TIMEOUT_MS", 240000),
    refreshMaxConcurrentUsers: integer(
      "REFRESH_MAX_CONCURRENT_USERS",
      2,
      1,
      32,
    ),
    refreshFeedConcurrency: integer("REFRESH_FEED_CONCURRENCY", 2, 1, 32),
    refreshMaxBodyBytes: integer("REFRESH_MAX_BODY_BYTES", 8192, 1024),
    nginxPort: integer("NGINX_PORT", 80, 1, 65535),
    nginxServerName: value("NGINX_SERVER_NAME", "_"),
    dnsResolver: value("DNS_RESOLVER", "127.0.0.11"),
    dnsResolverTtlSeconds: integer("DNS_RESOLVER_TTL_SECONDS", 30),
    dnsIpv6: boolean("DNS_IPV6", false),
    staticCacheSeconds: integer("STATIC_CACHE_SECONDS", 3600, 0),
    apiProxyTimeoutMs: integer("FRESHRSS_PROXY_TIMEOUT_MS", 30000),
    tlsCaFile: value(
      "FRESHRSS_TLS_CA_FILE",
      "/etc/ssl/certs/ca-certificates.crt",
    ),
  };
  if (config.refreshTokens) {
    try {
      const tokens = JSON.parse(config.refreshTokens);
      if (
        !tokens ||
        typeof tokens !== "object" ||
        Array.isArray(tokens) ||
        Object.values(tokens).some(
          (token) =>
            typeof token !== "string" || !token.trim() || token.length > 1024,
        )
      )
        throw new Error();
    } catch {
      throw new Error(
        "FRESHRSS_REFRESH_TOKENS must be a JSON object mapping usernames to non-empty master tokens.",
      );
    }
  }
  if (!isIP(config.serverHost))
    throw new Error("SERVER_HOST must be an IP address.");
  if (!isIP(config.dnsResolver))
    throw new Error("DNS_RESOLVER must be an IP address.");
  if (
    !config.imageAllowedPorts.length ||
    config.imageAllowedPorts.some(
      (port) => !Number.isInteger(port) || port < 1 || port > 65535,
    )
  )
    throw new Error("IMAGE_ALLOWED_PORTS must be comma-separated TCP ports.");
  if (!/^[a-zA-Z0-9_.*:-]+$/.test(config.nginxServerName))
    throw new Error("NGINX_SERVER_NAME is invalid.");
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(config.tlsCaFile))
    throw new Error(
      "FRESHRSS_TLS_CA_FILE must be an absolute path without spaces.",
    );
  if (
    /[\r\n]/.test(config.imageUserAgent) ||
    config.imageUserAgent.length > 512
  )
    throw new Error("IMAGE_USER_AGENT is invalid.");
  config.public = {
    imageEnabled: config.imageEnabled,
    refreshEnabled: config.refreshEnabled,
    imageMaxHtmlBytes: config.imageMaxHtmlBytes,
    apiUrl: publicUrl("FRESHER_API_URL", ""),
    imageApiUrl: publicUrl("FRESHER_IMAGE_API_URL", "api/article-image"),
    refreshApiUrl: publicUrl("FRESHER_REFRESH_API_URL", "api/refresh"),
    defaultPalette: choice("FRESHER_DEFAULT_PALETTE", "forest", [
      "forest",
      "stone",
      "sepia",
      "ocean",
      "rose",
      "lavender",
    ]),
    defaultMode: choice("FRESHER_DEFAULT_MODE", "system", [
      "light",
      "dark",
      "system",
    ]),
    defaultFont: choice("FRESHER_DEFAULT_FONT", "serif", ["serif", "sans"]),
    defaultFontSize: integer("FRESHER_DEFAULT_FONT_SIZE", 18, 14, 26),
    defaultSort: choice("FRESHER_DEFAULT_SORT", "newest", ["newest", "oldest"]),
    defaultUnreadOnly: boolean("FRESHER_DEFAULT_UNREAD_ONLY", false),
    markReadOnOpen: boolean("FRESHER_MARK_READ_ON_OPEN", true),
    pageSize: integer("FRESHER_PAGE_SIZE", 50, 1, 1000),
    apiTimeoutMs: integer("FRESHER_API_TIMEOUT_MS", 30000),
    imageClientTimeoutMs: integer(
      "FRESHER_IMAGE_CLIENT_TIMEOUT_MS",
      config.imageTimeoutMs + 5000,
    ),
    refreshClientTimeoutMs: integer(
      "FRESHER_REFRESH_CLIENT_TIMEOUT_MS",
      Math.max(
        300000,
        config.refreshTimeoutMs + config.refreshApiTimeoutMs * 2 + 5000,
      ),
    ),
    imageClientConcurrency: integer(
      "FRESHER_IMAGE_CLIENT_CONCURRENCY",
      config.imageMaxConcurrent,
      1,
      128,
    ),
    imageCacheTtlSeconds: integer(
      "FRESHER_IMAGE_CACHE_TTL_SECONDS",
      config.imageCacheTtlSeconds,
      0,
    ),
    imageMissTtlSeconds: integer(
      "FRESHER_IMAGE_MISS_TTL_SECONDS",
      config.imageMissTtlSeconds,
      0,
    ),
  };
  return config;
}

export const DEFAULT_CONFIG = readConfig({});

export function browserConfigScript(config) {
  return `window.FRESHER_CONFIG = ${JSON.stringify(config.public).replace(/</g, "\\u003c")};\n`;
}
