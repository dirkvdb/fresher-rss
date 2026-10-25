import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readConfig, browserConfigScript } from "./config.mjs";
import { renderApache, renderNginx } from "./runtime.mjs";

describe("environment configuration", () => {
  it("configures ports, limits, feature switches, and browser defaults without rebuilding", () => {
    const config = readConfig({
      FRESHRSS_URL: "https://rss.example.com/freshrss/",
      SERVER_PORT: "4001",
      NGINX_PORT: "8080",
      IMAGE_MAX_CONCURRENT: "2",
      IMAGE_CACHE_TTL_SECONDS: "60",
      IMAGE_TIMEOUT_MS: "20000",
      REFRESH_FEED_CONCURRENCY: "4",
      REFRESH_TIMEOUT_MS: "360000",
      REFRESH_ENABLED: "false",
      FRESHER_DEFAULT_PALETTE: "ocean",
      FRESHER_DEFAULT_MODE: "dark",
      FRESHER_DEFAULT_FONT: "sans",
      FRESHER_DEFAULT_FONT_SIZE: "21",
      FRESHER_PAGE_SIZE: "100",
      FRESHER_MARK_READ_ON_OPEN: "false",
    });
    expect(config.upstream).toBe("https://rss.example.com/freshrss");
    expect(config.serverPort).toBe(4001);
    expect(config.public).toMatchObject({
      defaultPalette: "ocean",
      defaultMode: "dark",
      defaultFont: "sans",
      defaultFontSize: 21,
      pageSize: 100,
      markReadOnOpen: false,
      refreshEnabled: false,
      imageClientConcurrency: 2,
      imageClientTimeoutMs: 25000,
      imageCacheTtlSeconds: 60,
    });
    expect(config.public.refreshClientTimeoutMs).toBeGreaterThan(
      config.refreshTimeoutMs,
    );
  });
  it("keeps server tokens, internal hosts, and arbitrary environment variables out of config.js", () => {
    const config = readConfig({
      FRESHRSS_URL: "http://private-freshrss:8080",
      FRESHRSS_REFRESH_TOKENS: '{"reader":"MASTER_SECRET"}',
      FRESHRSS_API_PASSWORDS: '{"reader":"API_SECRET"}',
      DOCKERHUB_TOKEN: "DOCKER_SECRET",
      FRESHER_API_URL: "/freshrss-api",
    });
    const script = browserConfigScript(config);
    expect(script).not.toMatch(
      /MASTER_SECRET|API_SECRET|DOCKER_SECRET|private-freshrss|refreshTokens|apiPasswords/,
    );
    expect(script).toContain('"apiUrl":"/freshrss-api"');
  });
  it("rejects invalid environment values and unsafe template strings", () => {
    for (const env of [
      { SERVER_PORT: "not-a-number" },
      { NGINX_PORT: "70000" },
      { IMAGE_ENABLED: "maybe" },
      { FRESHER_DEFAULT_PALETTE: "invalid" },
      { FRESHER_DEFAULT_FONT_SIZE: "100" },
      { FRESHRSS_URL: "https://user:secret@example.com" },
      { FRESHER_API_URL: "javascript:alert(1)" },
      { NGINX_SERVER_NAME: "_; return 200;" },
      { DNS_RESOLVER: "8.8.8.8; foo" },
      { IMAGE_USER_AGENT: "hello\r\nInjected: value" },
      { FRESHRSS_API_PATH: "../private" },
      { FRESHRSS_REFRESH_TOKENS: '{"reader":false}' },
      { FRESHRSS_API_PASSWORDS: '{"reader":false}' },
      { FRESHRSS_API_PASSWORDS: '{"reader":""}' },
      { IMAGE_UNREAD_CACHE_ENABLED: "invalid" },
      { IMAGE_UNREAD_SYNC_INTERVAL_MS: "0" },
      { CONTENT_UNREAD_CACHE_ENABLED: "invalid" },
      { CONTENT_UNREAD_CACHE_MAX_BYTES: "0" },
      { CONTENT_UNREAD_CACHE_MAX_ENTRIES: "0" },
    ])
      expect(() => readConfig(env)).toThrow();
  });
  it("enables unread caching only when configured, and allows it to be disabled", () => {
    const env = {
      FRESHRSS_URL: "https://rss.example",
      FRESHRSS_API_PASSWORDS: '{"reader":"secret"}',
    };
    expect(readConfig(env).public.imageUnreadCacheEnabled).toBe(true);
    expect(
      readConfig({ ...env, IMAGE_UNREAD_CACHE_ENABLED: "false" }).public
        .imageUnreadCacheEnabled,
    ).toBe(false);
    expect(
      readConfig({ ...env, IMAGE_ENABLED: "false" }).public
        .imageUnreadCacheEnabled,
    ).toBe(false);
    expect(readConfig({}).public.imageUnreadCacheEnabled).toBe(false);
    expect(readConfig({}).imageUnreadSyncIntervalMs).toBe(300000);
    expect(readConfig({}).contentUnreadCacheEnabled).toBe(true);
    expect(
      readConfig({ CONTENT_UNREAD_CACHE_ENABLED: "false" })
        .contentUnreadCacheEnabled,
    ).toBe(false);
  });
  it("renders matching web-server upstreams for custom service ports and deadlines", () => {
    const config = readConfig({
      FRESHRSS_URL: "http://freshrss/base",
      SERVER_PORT: "4001",
      NGINX_PORT: "8080",
      FRESHER_REFRESH_CLIENT_TIMEOUT_MS: "420000",
    });
    const template = readFileSync(
      new URL("../docker/default.conf.template", import.meta.url),
      "utf8",
    );
    const nginx = renderNginx(template, config);
    expect(nginx).toContain("listen 8080;");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:4001;");
    expect(nginx).toContain("proxy_read_timeout 420s;");
    expect(nginx).toContain("$freshrss_path");
    expect(nginx).not.toMatch(/\$\{[A-Z_0-9]+\}/);
    expect(renderApache(config)).toContain(
      "http://127.0.0.1:4001/api/refresh connectiontimeout=3 timeout=420",
    );
  });
  it("overrides FreshRSS caching for runtime configuration and reader HTML only", () => {
    const apache = renderApache(readConfig({}));
    const policies = [
      ...apache.matchAll(
        /<LocationMatch "([^"]+)">([\s\S]*?)<\/LocationMatch>/g,
      ),
    ];
    expect(policies).toHaveLength(2);
    for (const [path, directive] of [
      ["/reader/config.js", 'Header always set Cache-Control "no-store"'],
      ["/reader/", 'Header always set Cache-Control "no-cache"'],
      ["/reader/index.html", 'Header always set Cache-Control "no-cache"'],
    ]) {
      const policy = policies.find(([, pattern]) =>
        new RegExp(pattern).test(path),
      );
      expect(policy?.[2]).toContain("ExpiresActive Off");
      expect(policy?.[2]).toContain("Header unset Cache-Control");
      expect(policy?.[2]).toContain(directive);
    }
    for (const path of ["/reader/assets/index-hash.js", "/i/", "/config.js"])
      expect(
        policies.some(([, pattern]) => new RegExp(pattern).test(path)),
      ).toBe(false);
  });
  it("preserves IMAGE_PORT as a legacy alias", () => {
    expect(readConfig({ IMAGE_PORT: "4567" }).serverPort).toBe(4567);
    expect(
      readConfig({ IMAGE_PORT: "4567", SERVER_PORT: "3456" }).serverPort,
    ).toBe(3456);
  });
});
