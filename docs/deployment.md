# Deployment

## FreshRSS API login

1. Enable **Allow API access** under FreshRSS **Administration → Authentication**.
2. Set an **API password** under **Profile → API management**.
3. Sign into Fresher with your instance URL, FreshRSS username, and API password.

Fresher uses the Google Reader-compatible API at `/api/greader.php`. Root installations, subdirectories such as `https://example.com/freshrss/`, and full API endpoint URLs are supported.

## Server-side article refresh

The Google Reader API cannot trigger feed polling. Fresher verifies your API session against the configured instance, then calls FreshRSS's documented token-protected refresh action for specific feed IDs.

1. Set a **Master authentication token** in FreshRSS **Profile**. This is separate from the API password.
2. Put these server-only variables in `.env` for development/Compose, or in the combined container's environment:

```dotenv
FRESHRSS_URL=https://rss.example.com
FRESHRSS_REFRESH_TOKENS='{"reader":"your-master-authentication-token"}'
```

The JSON keys are FreshRSS usernames; multiple users can share the map. The instance URL must be reachable from Node, include any subdirectory, and have no trailing slash. The combined image defaults to its own `http://127.0.0.1` instance. Restart after changing environment variables.

Tokens remain on Node, never appear in browser configuration, and are never forwarded to feed publishers. The refresh bridge uses HTTP calls to the existing FreshRSS installation, with no additional PHP code, shell commands, or database access. See [refresh behavior](usage.md#article-refresh).

## Companion container

**`dirkvdb/fresher-rss-standalone:latest`** supports `linux/amd64` and `linux/arm64`. The `standalone` Docker target combines Nginx, a loopback-only Node service, and a fixed-upstream FreshRSS API proxy. Browser requests stay same-origin; FreshRSS can remain internal to the Docker network. This image contains no PHP runtime.

```sh
docker run -d --name fresher-rss-standalone --network freshrss_default \
  -p 8081:80 \
  -e FRESHRSS_URL=http://freshrss \
  -e FRESHRSS_REFRESH_TOKENS='{"reader":"your-master-authentication-token"}' \
  -e FRESHER_DEFAULT_PALETTE=ocean \
  -e FRESHER_DEFAULT_MODE=dark \
  --restart unless-stopped dirkvdb/fresher-rss-standalone:latest
```

Open **http://localhost:8081**. The configured upstream removes the instance-URL field from login; enter only username and API password. Your existing reverse proxy can serve the port over HTTPS.

### Compose

Create `.env` based on [`.env.example`](../.env.example):

```dotenv
FRESHRSS_URL=http://freshrss
FRESHRSS_NETWORK=freshrss_default
```

- `FRESHRSS_URL` must be reachable **from the companion**, include any subdirectory (e.g. `http://freshrss/freshrss`), have no trailing slash, and use the final URL without redirects.
- `FRESHRSS_NETWORK` names an existing network shared with FreshRSS. List networks with `docker network ls`.

```sh
just up                                      # Build locally
docker compose pull && docker compose up -d   # Use the published image
```

Alternatively, add the service directly to the existing FreshRSS Compose project:

```yaml
services:
  fresher:
    build:
      context: /absolute/path/to/fresher-rss
      target: standalone
    ports:
      - "8081:80"
    environment:
      FRESHRSS_URL: http://freshrss
    restart: unless-stopped
```

This assumes the FreshRSS service is `freshrss` and both services use the project's default network. Docker commands need a running daemon; devenv supplies the clients.

## Combined FreshRSS image

**`dirkvdb/fresher-rss:latest`** supports `linux/amd64` and `linux/arm64`. Its `freshrss` target embeds Fresher and Node in the official **Debian-based** FreshRSS image. Build it locally if needed:

```sh
just image-freshrss
```

Set your existing service's image to `dirkvdb/fresher-rss:latest` (or locally built `fresher-rss:latest`), retaining its data volumes and environment. Visit **https://your-freshrss-host/reader/**. Apache proxies `/reader/api/` to loopback Node; no extra port is exposed. For a fresh installation, complete the normal FreshRSS setup at the site's root first.

To use a specific version of the official base image:

```sh
docker build --target freshrss \
  --build-arg FRESHRSS_IMAGE=freshrss/freshrss:YOUR_CURRENT_TAG \
  -t fresher-rss .
```

## Mount the frontend in an existing container

```sh
devenv shell -- just build
```

Add this bind mount alongside your existing FreshRSS volumes:

```yaml
services:
  freshrss:
    volumes:
      - /absolute/path/to/fresher-rss/dist:/var/www/FreshRSS/p/reader:ro
```

Recreate the service from its existing Compose project:

```sh
docker compose up -d freshrss
```

Open **https://your-freshrss-host/reader/**, including the trailing slash. For subdirectory installations, append `/reader/` to the instance URL. Fresher suggests the parent instance URL at login.

The public web-root path above is for `freshrss/freshrss`. For another image, mount under a `reader` directory in its public web root. This serves only the frontend: automatic image discovery and manual article refresh require the Node service, supplied by either Docker target or a separately proxied service below.

## Static hosting and a separate Node service

Any static web server can serve `dist/`, including under a subdirectory. The browser connects directly to the entered FreshRSS URL. FreshRSS provides API CORS headers; ordinary direct API connections need no extra backend. An HTTPS reader needs an HTTPS instance URL. The companion proxy handles internal-only instances or reverse proxies that strip CORS headers.

For image discovery and manual article refresh:

1. Build the project and run `just images` or `npm run start:images`.
2. Proxy `/api/article-image` and `/api/refresh` to those paths on `http://127.0.0.1:3001`.
3. Allow a 300-second upstream timeout for `/api/refresh` and forward its Authorization header.

Under a subdirectory, proxy the corresponding paths there. The self-contained bundle is `dist-server/index.mjs` and needs only Node.js 22.12+ at runtime. `SERVER_PORT` changes its loopback port; legacy `IMAGE_PORT` remains an alias.

Preconfigure a static deployment in `dist/config.js`:

```js
window.FRESHER_CONFIG = {
  apiUrl: "https://rss.example.com/api/greader.php",
  // Optional custom same-origin proxy paths:
  // imageApiUrl: "/api/article-image",
  // refreshApiUrl: "/api/refresh",
};
```

This is public: never put passwords or tokens in it. Without Node, feed images still work and CORS-accessible article pages can supply metadata.

## Environment settings

Use `-e`, `--env-file`, or Compose's optional `.env` file; recreate the container after changes. Docker startup generates browser config and matching Nginx/Apache upstreams, including custom service ports and deadlines. `just run` reads `.env` directly. Existing browser appearance preferences override UI defaults.

See the [full environment reference](configuration.md) for URLs, ports, UI defaults, service limits, feature switches, caches, and rate limits. No rebuild is needed for runtime settings.
