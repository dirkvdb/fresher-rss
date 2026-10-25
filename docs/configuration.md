# Environment configuration

The Docker images generate `config.js` and their web-server configuration at startup. Change environment variables and recreate the container; no image rebuild is needed. For `just run`, put settings in `.env` or export them in the shell. Saved browser appearance preferences override deployment defaults.

Only an explicit public allowlist is written to `config.js`. `FRESHRSS_REFRESH_TOKENS`, `FRESHRSS_API_PASSWORDS`, the internal upstream address, and unrelated secrets are never included. Boolean values accept `true`/`false` or `1`/`0`. Invalid settings stop startup with the variable name and expected format.

## Connection and ports

| Variable                    | Default                                                              | Purpose                                                                                                   |
| --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `FRESHRSS_URL`              | `http://freshrss` in companion; `http://127.0.0.1` in combined image | FreshRSS instance URL reachable from Node/Nginx, including any subdirectory.                              |
| `FRESHRSS_REFRESH_TOKENS`   | empty                                                                | JSON map of FreshRSS usernames to master authentication tokens. Required for server-side article refresh. |
| `FRESHRSS_API_PASSWORDS`    | empty                                                                | Server-only JSON map of usernames to API passwords for unread thumbnail and readable-content caching.     |
| `FRESHRSS_API_PATH`         | `api/greader.php`                                                    | API path relative to the instance URL.                                                                    |
| `FRESHRSS_REFRESH_PATH`     | `i/`                                                                 | Native refresh route relative to the instance URL.                                                        |
| `FRESHER_BIND_ADDRESS`      | `0.0.0.0`                                                            | Compose host port binding.                                                                                |
| `FRESHER_PORT`              | `8081`                                                               | Compose host port.                                                                                        |
| `NGINX_PORT`                | `80`                                                                 | Companion container HTTP port; Compose mapping follows this value.                                        |
| `NGINX_SERVER_NAME`         | `_`                                                                  | Nginx server name.                                                                                        |
| `SERVER_HOST`               | `127.0.0.1`                                                          | Node service bind IP address.                                                                             |
| `SERVER_PORT`               | `3001`                                                               | Node service port; generated Nginx/Apache upstreams follow this value.                                    |
| `IMAGE_PORT`                | unset                                                                | Legacy alias for `SERVER_PORT`; the latter takes precedence.                                              |
| `SERVER_UID` / `SERVER_GID` | `65534` / `65534`                                                    | Unprivileged Node runtime identity when launched as root.                                                 |
| `FRESHRSS_NETWORK`          | `freshrss_default`                                                   | Existing Docker network used by Compose.                                                                  |
| `DNS_RESOLVER`              | `127.0.0.11`                                                         | Nginx upstream DNS resolver; Docker's embedded DNS by default.                                            |
| `DNS_RESOLVER_TTL_SECONDS`  | `30`                                                                 | Nginx DNS cache duration.                                                                                 |
| `DNS_IPV6`                  | `false`                                                              | Enable IPv6 resolution in the Nginx upstream resolver.                                                    |
| `STATIC_CACHE_SECONDS`      | `3600`                                                               | Browser cache lifetime for static JS, CSS, and SVG files.                                                 |
| `FRESHRSS_PROXY_TIMEOUT_MS` | `30000`                                                              | Nginx FreshRSS API read timeout.                                                                          |
| `FRESHRSS_TLS_CA_FILE`      | `/etc/ssl/certs/ca-certificates.crt`                                 | Nginx CA bundle. Node also supports standard `NODE_EXTRA_CA_CERTS` for a mounted custom CA.               |

The combined image also supports the environment options of its official FreshRSS base image, such as `TZ`, `CRON_MIN`, and `LISTEN`. If changing FreshRSS's own listening port, update `FRESHRSS_URL` accordingly.

## Public browser configuration and defaults

| Variable                            | Default                                         | Purpose                                                            |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `FRESHER_API_URL`                   | `/freshrss-api` in companion; empty otherwise   | Public API endpoint. Empty shows the instance URL field at login.  |
| `FRESHER_IMAGE_API_URL`             | `api/article-image`                             | Public image-service endpoint, resolved relative to the page.      |
| `FRESHER_CONTENT_API_URL`           | `api/article-content`                           | Public original-article extraction endpoint, relative to the page. |
| `FRESHER_REFRESH_API_URL`           | `api/refresh`                                   | Public article-refresh endpoint.                                   |
| `FRESHER_DEFAULT_PALETTE`           | `forest`                                        | `forest`, `stone`, `sepia`, `ocean`, `rose`, or `lavender`.        |
| `FRESHER_DEFAULT_MODE`              | `system`                                        | `light`, `dark`, or `system`.                                      |
| `FRESHER_DEFAULT_FONT`              | `serif`                                         | `serif` or `sans`.                                                 |
| `FRESHER_DEFAULT_FONT_SIZE`         | `18`                                            | Reading text size, 14–26 pixels.                                   |
| `FRESHER_DEFAULT_SORT`              | `newest`                                        | `newest` or `oldest`.                                              |
| `FRESHER_DEFAULT_UNREAD_ONLY`       | `true`                                          | Start in the unread view.                                          |
| `FRESHER_MARK_READ_ON_OPEN`         | `true`                                          | Mark an article read when it opens.                                |
| `FRESHER_PAGE_SIZE`                 | `50`                                            | API page size, 1–1000 articles.                                    |
| `FRESHER_API_TIMEOUT_MS`            | `30000`                                         | Browser FreshRSS API timeout.                                      |
| `FRESHER_IMAGE_CLIENT_TIMEOUT_MS`   | image timeout + 5000                            | Browser image-service timeout; generated proxy timeout follows it. |
| `FRESHER_REFRESH_CLIENT_TIMEOUT_MS` | at least 300000, derived from refresh deadlines | Browser refresh timeout; generated proxy timeout follows it.       |
| `FRESHER_IMAGE_CLIENT_CONCURRENCY`  | `IMAGE_MAX_CONCURRENT`                          | Number of simultaneous browser image lookups.                      |
| `FRESHER_IMAGE_CACHE_TTL_SECONDS`   | `IMAGE_CACHE_TTL_SECONDS`                       | Browser cache lifetime for images.                                 |
| `FRESHER_IMAGE_MISS_TTL_SECONDS`    | `IMAGE_MISS_TTL_SECONDS`                        | Browser cache lifetime for missing images.                         |

Public endpoint overrides change what the browser requests. Configure your external reverse proxy to route custom public paths to the service's fixed internal routes. Keep credentials in server-only variables rather than in public endpoint URLs.

## Image service

| Variable                  | Default                               | Purpose                                                                                    |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `IMAGE_ENABLED`           | `true`                                | Enable original-page image discovery. Feed-provided images remain available when disabled. |
| `IMAGE_TIMEOUT_MS`        | `10000`                               | Total outbound lookup deadline.                                                            |
| `IMAGE_DNS_TIMEOUT_MS`    | `5000`                                | Per-resolution DNS deadline within the total deadline.                                     |
| `IMAGE_MAX_HTML_BYTES`    | `1048576`                             | Compressed-transfer and decompressed HTML size bound.                                      |
| `IMAGE_MAX_REDIRECTS`     | `3`                                   | Maximum redirect hops.                                                                     |
| `IMAGE_MAX_CONCURRENT`    | `4`                                   | Concurrent server lookups.                                                                 |
| `IMAGE_CACHE_MAX_ENTRIES` | `512`                                 | Maximum cached URLs in memory.                                                             |
| `IMAGE_CACHE_TTL_SECONDS` | `86400`                               | Server cache lifetime for discovered images; zero disables reuse.                          |
| `IMAGE_MISS_TTL_SECONDS`  | `900`                                 | Server cache lifetime for missing images.                                                  |
| `IMAGE_RATE_LIMIT`        | `120`                                 | Requests per client per rate window.                                                       |
| `IMAGE_RATE_WINDOW_MS`    | `60000`                               | Rate-limit window length.                                                                  |
| `IMAGE_MAX_CLIENTS`       | `512`                                 | Maximum rate-limit buckets.                                                                |
| `IMAGE_MAX_URL_LENGTH`    | `4096`                                | Maximum article URL length.                                                                |
| `IMAGE_MAX_CANDIDATES`    | `8`                                   | Maximum extracted image candidates to validate.                                            |
| `IMAGE_ALLOWED_PORTS`     | `80,443`                              | Comma-separated allowed outbound TCP ports.                                                |
| `IMAGE_USER_AGENT`        | FresherRSS article-preview user agent | Publisher request user agent.                                                              |

Private/reserved address rejection, DNS pinning, redirect validation, and credential isolation are always enforced.

### Unread thumbnail cache

With `FRESHRSS_URL` and `FRESHRSS_API_PASSWORDS='{"reader":"your-api-password"}'` configured, Node fetches unread articles at startup and every five minutes, independently of connected browsers. Use the API password from FreshRSS **Profile → API management**, not a web-login password or master refresh token. These credentials stay server-side and are sent only to the configured FreshRSS instance.

Feed images are preferred; missing covers are discovered from publisher pages. Thumbnail bytes are kept only in memory, shared across clients, and removed when no configured user still has the article unread. Failed/incomplete FreshRSS responses retain the previous snapshot until polling succeeds. Cache misses, oversized/unsupported images, read articles, and server restarts fall back to direct publisher images. Slow publishers do not block the next unread-status poll.

| Variable                          | Default    | Purpose                                                                                             |
| --------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `IMAGE_UNREAD_CACHE_ENABLED`      | `true`     | Set `false` to disable thumbnail prefetching; original on-demand image discovery remains available. |
| `IMAGE_UNREAD_SYNC_INTERVAL_MS`   | `300000`   | Shared unread-status polling interval for thumbnails and readable contents (five minutes).          |
| `IMAGE_THUMBNAIL_MAX_BYTES`       | `2097152`  | Maximum bytes per cached raster image (2 MiB); SVGs are not cached.                                 |
| `IMAGE_THUMBNAIL_CACHE_MAX_BYTES` | `67108864` | Total thumbnail-byte memory limit (64 MiB).                                                         |

`IMAGE_CACHE_MAX_ENTRIES` also caps thumbnail entries and the articles prefetched per cycle (512 by default). `IMAGE_MAX_CONCURRENT` bounds prefetch workers; existing network deadlines, allowed ports, DNS pinning, and redirect checks apply. `IMAGE_ENABLED=false` disables this feature too. Without server API credentials, existing on-demand behavior is unchanged.

## Original article extraction

`/api/article-content` shares the image service's network deadlines, HTML-size and URL bounds, allowed ports, redirect policy, user agent, cache settings, concurrency limit, and rate-limit settings listed above. Its cache, concurrency counter, and per-client rate-limit buckets are separate from image discovery. `FRESHER_IMAGE_CLIENT_TIMEOUT_MS` also bounds browser extraction requests. Extraction remains available when `IMAGE_ENABLED=false`.

The endpoint fetches public pages without publisher credentials, extracts the main article, and returns sanitized HTML as JSON. It never executes publisher scripts or fetches page subresources during extraction. Private/reserved targets are rejected and redirect destinations are revalidated. The browser sanitizes the returned HTML again before displaying it.

### Unread readable-content cache

With the same `FRESHRSS_URL` and `FRESHRSS_API_PASSWORDS` settings used for thumbnail prefetching, Node also fetches and extracts readable contents for unread articles at startup. One shared FreshRSS poll reconciles both caches every five minutes (`IMAGE_UNREAD_SYNC_INTERVAL_MS`), even while publisher requests are still running. Thumbnail and content prefetching are independent: contents can be cached with images disabled, and failed image fetches never prevent article extraction.

Successful extractions, including sanitized HTML, title, byline, and final publisher URL, are shared in memory across clients and served through the existing `/api/article-content` endpoint. They stay cached while unread and within the memory limits, and are removed when no configured user has the article unread. Incomplete or failed FreshRSS polls preserve the affected user's last snapshot. Failed extractions are retried on the next sync; oversized results are not retained. Cache misses continue to use normal on-demand extraction and the existing reader fallback to RSS content. No browser changes or additional credentials are needed.

| Variable                           | Default    | Purpose                                                                                             |
| ---------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `CONTENT_UNREAD_CACHE_ENABLED`     | `true`     | Set `false` to disable background readable-content caching; on-demand extraction remains available. |
| `CONTENT_UNREAD_CACHE_MAX_ENTRIES` | `512`      | Maximum readable-content entries and articles prefetched per cycle.                                 |
| `CONTENT_UNREAD_CACHE_MAX_BYTES`   | `67108864` | Total serialized readable-content memory budget (64 MiB), separate from thumbnail bytes.            |

Existing extraction limits, sanitization, credential isolation, and network restrictions apply to prefetching. Background requests and client requests share the extraction concurrency bound and deduplicate in-flight work. The on-demand TTL cache remains separate; background prefetches do not populate it. Disable both `IMAGE_UNREAD_CACHE_ENABLED` and `CONTENT_UNREAD_CACHE_ENABLED` to stop all background unread polling. Without server API credentials, both features remain inactive.

## Article refresh

| Variable                       | Default  | Purpose                                                   |
| ------------------------------ | -------- | --------------------------------------------------------- |
| `REFRESH_ENABLED`              | `true`   | Enable manual article refresh.                            |
| `REFRESH_API_TIMEOUT_MS`       | `10000`  | FreshRSS API authentication/subscription request timeout. |
| `REFRESH_FEED_TIMEOUT_MS`      | `30000`  | Per-feed native refresh timeout.                          |
| `REFRESH_TIMEOUT_MS`           | `240000` | Overall feed-update deadline.                             |
| `REFRESH_MAX_CONCURRENT_USERS` | `2`      | Concurrent user refresh jobs.                             |
| `REFRESH_FEED_CONCURRENCY`     | `2`      | Concurrent feed updates within each job.                  |
| `REFRESH_MAX_BODY_BYTES`       | `8192`   | Maximum refresh request body size.                        |

## Node HTTP server

| Variable                       | Default |
| ------------------------------ | ------- |
| `HTTP_MAX_HEADER_BYTES`        | `8192`  |
| `HTTP_HEADERS_TIMEOUT_MS`      | `5000`  |
| `HTTP_REQUEST_TIMEOUT_MS`      | `15000` |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS`   | `5000`  |
| `HTTP_MAX_REQUESTS_PER_SOCKET` | `100`   |
| `HTTP_MAX_HEADERS`             | `30`    |
| `SHUTDOWN_TIMEOUT_MS`          | `11000` |
