/** Only validated configuration is interpolated into web-server syntax. */
export function renderNginx(template, config) {
  const host =
    config.serverHost === "0.0.0.0"
      ? "127.0.0.1"
      : config.serverHost === "::"
        ? "::1"
        : config.serverHost;
  const address = host.includes(":") ? `[${host}]` : host;
  const values = {
    FRESHRSS_URL: config.upstream,
    FRESHRSS_API_PATH: config.apiPath,
    NGINX_PORT: config.nginxPort,
    NGINX_SERVER_NAME: config.nginxServerName,
    DNS_RESOLVER: config.dnsResolver.includes(":")
      ? `[${config.dnsResolver}]`
      : config.dnsResolver,
    DNS_RESOLVER_TTL_SECONDS: config.dnsResolverTtlSeconds,
    DNS_IPV6: config.dnsIpv6 ? "on" : "off",
    SERVER_UPSTREAM: `http://${address}:${config.serverPort}`,
    API_PROXY_TIMEOUT_SECONDS: Math.ceil(config.apiProxyTimeoutMs / 1000),
    IMAGE_PROXY_TIMEOUT_SECONDS: Math.ceil(
      config.public.imageClientTimeoutMs / 1000,
    ),
    REFRESH_PROXY_TIMEOUT_SECONDS: Math.ceil(
      config.public.refreshClientTimeoutMs / 1000,
    ),
    STATIC_CACHE_SECONDS: config.staticCacheSeconds,
    TLS_CA_FILE: config.tlsCaFile,
  };
  // Escape upstream URL delimiters before putting the trusted URL in a quoted directive.
  values.FRESHRSS_URL = values.FRESHRSS_URL.replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$");
  return template.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, key) => {
    if (!(key in values))
      throw new Error(`Unknown Nginx template variable: ${key}`);
    return String(values[key]);
  });
}

export function renderApache(config) {
  const host =
    config.serverHost === "0.0.0.0"
      ? "127.0.0.1"
      : config.serverHost === "::"
        ? "::1"
        : config.serverHost;
  const upstream = `http://${host.includes(":") ? `[${host}]` : host}:${config.serverPort}`;
  return `ProxyRequests Off
ProxyPass /reader/api/refresh ${upstream}/api/refresh connectiontimeout=3 timeout=${Math.ceil(config.public.refreshClientTimeoutMs / 1000)}
ProxyPass /reader/api/ ${upstream}/api/ connectiontimeout=3 timeout=${Math.ceil(config.public.imageClientTimeoutMs / 1000)}
ProxyPassReverse /reader/api/ ${upstream}/api/
<Location /reader/api/>
    RequestHeader unset Cookie
</Location>
<Location /reader/api/article-image>
    RequestHeader unset Authorization
</Location>
`;
}
