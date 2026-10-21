# Fresher RSS

A quieter reading interface for your existing **FreshRSS** instance. A shadcn-inspired three-pane layout, warm neutral surfaces, muted green accents, and a comfortable, typography-first article reader.

## Try it locally

All build and test tools are included in `devenv.nix`: Node.js 22, npm, Just, Docker/Compose clients, and Chromium for browser tests. The reader uses React/TypeScript, with a small Node.js service for article cover discovery. No PHP helper is used.

```sh
devenv shell
just run
```

Open **http://localhost:5173**. Choose **Explore the demo** to try the reader immediately, or enter your instance URL, FreshRSS username, and **API password**.

`just run` installs the exact dependencies from `package-lock.json` before starting Vite. You can also run it directly with `devenv shell -- just run`. `devenv up` starts the frontend process after dependencies have been installed with `setup` or `npm ci`.

The image service is integrated into Vite for development and preview, so `just run` starts everything needed for photos.

## Features

- A card-based daily overview of the latest unread stories, grouped by folder, with article images and previews. Click a card to read; use the grid button to return to the overview. When you’re caught up, recent articles are shown instead.
- Cover images come from feed content, lazy-loaded/responsive images, or image attachments. The Node.js service discovers missing photos from the original article’s Open Graph, Twitter, and structured-data metadata. Results are cached; only cards near the viewport request metadata.
- Photos retain their original aspect ratio, with natural image height and uniform hover zoom.
- Feeds and collapsible folders from your existing subscriptions.
- All articles, unread, and starred views, with unread counts.
- Read/unread and star changes synced to FreshRSS. Opening an article marks it as read.
- Refresh asks FreshRSS to fetch new articles from publishers, waits for that operation to finish, then reloads articles and unread counts. See the one-time refresh-token setup below.
- Paginated article loading, newest/oldest sorting, and title/author/body search **within loaded articles**.
- Six palettes—Forest, Stone, Sepia, Ocean, Rose, and Lavender—each with light, dark, and system modes. Live theme previews and automatic preference saving, plus serif/sans reading fonts and adjustable text size.
- Distraction-free focus mode and keyboard navigation.
- Responsive mobile navigation and a dedicated mobile article view.
- Sanitized feed HTML, safe external links, and locally hosted fonts.
- Session-only login by default, with optional persistent login. The API password is never stored; only the API token is retained. Signing out clears it.

FreshRSS remains responsible for subscriptions, fetching, and administration. Fresher reads the article content provided by the feed; it does not scrape full articles from their original sites.

### Article image service

Browsers generally cannot read another website’s HTML without that website’s CORS permission. Fresher requests metadata from its own `/api/article-image` endpoint instead. The Node.js service fetches the article and returns only its image URL; publisher scripts are never executed. Images themselves load directly from the publisher.

Outbound requests allow only public HTTP(S) destinations on standard ports. DNS addresses are validated and pinned to each connection, redirects are revalidated, and private/reserved addresses are blocked for both articles and discovered images. The service has a 10-second network deadline, a 1 MiB HTML/decompression bound, four concurrent fetches, request rate limits, and a bounded memory cache (24 hours for images, 15 minutes for missing images). Cookies and FreshRSS credentials are never forwarded.

The production service binds only to loopback port 3001 and drops root privileges before listening. Both Docker deployment targets include it behind the web server. Without the service, static-only deployments still display feed images and can try CORS-accessible article pages.

## Enable the FreshRSS API

1. In FreshRSS, enable **Allow API access** under **Administration → Authentication**.
2. In **Profile → API management**, set an **API password**.
3. Log into Fresher with your FreshRSS username and that API password.

The connection uses FreshRSS’s Google Reader-compatible API at `/api/greader.php`. Both root installations and subdirectory installations such as `https://example.com/freshrss/` are supported. You can also enter the full API endpoint.

## Enable server-side article refresh

FreshRSS’s Google Reader API cannot trigger feed polling. Fresher’s Node service uses FreshRSS’s documented token-protected refresh action instead, with a specific feed ID to perform a manual refresh. Your API session is verified against the configured instance before any refresh is allowed.

1. In FreshRSS **Profile**, set a **Master authentication token**. This is separate from the API password.
2. Configure these server-only environment variables in `.env` for `just run`/Compose, or in the combined container’s environment:

```dotenv
FRESHRSS_URL=https://rss.example.com
FRESHRSS_REFRESH_TOKENS='{"dirk":"your-master-authentication-token"}'
```

Use your FreshRSS username as the JSON key. Multiple users can be configured in the same map. `FRESHRSS_URL` must be reachable from the Node service and include any FreshRSS subdirectory, without a trailing slash. The combined image defaults to its own `http://127.0.0.1` instance. Restart the server after changing its environment.

The sidebar refresh button updates all subscribed feeds. The article-list refresh button updates the selected feed/folder, or all feeds in the All/Unread/Starred views. While FreshRSS fetches articles, both buttons are disabled and show a spinner. Failures are displayed explicitly, including missing configuration; Fresher does not report a local reload as a successful server refresh.

FreshRSS still applies its own HTTP cache and publisher retry policies, just as it does for its native manual-refresh action.

The master tokens stay on the Node server and are never included in frontend configuration or forwarded to feed publishers. No additional PHP code, shell commands, or database access are used. The refresh bridge calls the existing FreshRSS installation over HTTP.

## Host in your existing FreshRSS container

### Mount the built interface

Build the static files:

```sh
devenv shell -- just build
```

Add the following bind mount to your **existing** FreshRSS service in its Compose file, alongside its current volumes:

```yaml
services:
  freshrss:
    volumes:
      - /absolute/path/to/fresher-rss/dist:/var/www/FreshRSS/p/reader:ro
```

Recreate that service using your existing Compose project:

```sh
docker compose up -d freshrss
```

Visit **https://your-freshrss-host/reader/** (including the trailing slash). If FreshRSS is hosted under a subdirectory, append `/reader/` to that URL instead. Fresher will suggest the parent instance URL on the login screen.

This path is for the official `freshrss/freshrss` image. For a different image, mount `dist/` under a `reader` directory in that image’s public web root.

This bind-mount method serves the frontend only. For automatic photos on text-only feeds, use the combined image or companion container below, or run the Node image service and proxy `/reader/api/article-image` to it.

### Build a combined image

The Dockerfile also has a `freshrss` target that embeds the frontend and Node image service into the official **Debian-based** FreshRSS image:

```sh
just image-freshrss
```

Use `freshrss-with-fresher:latest` as the image for your existing FreshRSS service, retaining its current data volumes and environment. The alternative UI is served at `/reader/`.

Apache proxies `/reader/api/` to the loopback-only Node service. No additional port needs to be exposed.

To match a specific version of your existing official image:

```sh
docker build --target freshrss \
  --build-arg FRESHRSS_IMAGE=freshrss/freshrss:YOUR_CURRENT_TAG \
  -t freshrss-with-fresher .
```

## Run as a companion container

The published companion image is **`dirkvdb/fresher-rss:latest`**, available for `linux/amd64` and `linux/arm64`.

```sh
docker run -d --name fresher-rss --network freshrss_default \
  -p 8081:80 \
  -e FRESHRSS_URL=http://freshrss \
  -e FRESHRSS_REFRESH_TOKENS='{"dirk":"your-master-authentication-token"}' \
  -e FRESHER_DEFAULT_PALETTE=ocean \
  -e FRESHER_DEFAULT_MODE=dark \
  --restart unless-stopped dirkvdb/fresher-rss:latest
```

The `standalone` Docker target serves frontend files with Nginx, runs the Node image service on loopback, and proxies FreshRSS API requests to a fixed upstream. This keeps requests on the same browser origin and also works when FreshRSS is only reachable on the Docker network. It contains no PHP runtime.

Create a `.env` file based on `.env.example`:

```dotenv
FRESHRSS_URL=http://freshrss
FRESHRSS_NETWORK=freshrss_default
```

- `FRESHRSS_URL`: the URL reachable **from the companion container**, without a trailing slash. Include the subdirectory if applicable, e.g. `http://freshrss/freshrss`. Use the final URL without redirects.
- `FRESHRSS_NETWORK`: an existing Docker network shared with your FreshRSS container. `docker network ls` lists networks.

```sh
just up
```

Visit **http://localhost:8081**. The upstream is preconfigured, so the login form only asks for username and API password. Your existing reverse proxy can serve this port over HTTPS. To use the published image instead of building locally, run `docker compose pull && docker compose up -d`.

To add the companion directly to your existing Compose project, use:

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

This assumes the FreshRSS service is named `freshrss` and both services use that project’s default network. A Docker daemon is required for container commands; the clients are supplied by devenv.

## Other static hosting

`dist/` can be served by any static web server, including from a subdirectory. The browser connects directly to the URL entered at login. FreshRSS provides API CORS headers, so normal direct connections work without an extra backend. An HTTPS-hosted reader needs an HTTPS instance URL for direct connections. The companion proxy is useful when a reverse proxy strips CORS headers or the instance is internal-only.

To provide article photo discovery and manual article refresh on another web server, build the project, run `just images` (or `npm run start:images`), and proxy `/api/article-image` and `/api/refresh` to the same paths on `http://127.0.0.1:3001`. Allow a 300-second upstream timeout for `/api/refresh` and forward its Authorization header. For a subdirectory deployment, proxy the same paths under that subdirectory. The bundled service lives in `dist-server/index.mjs` and requires only Node.js 22.12+ at runtime. `IMAGE_PORT` can override its loopback port.

To preconfigure a static deployment, edit `dist/config.js`:

```js
window.FRESHER_CONFIG = {
  apiUrl: "https://rss.example.com/api/greader.php",
  // Optional when the image service uses a different same-origin proxy path:
  // imageApiUrl: "/api/article-image",
};
```

Do not put passwords or API tokens in this public file.

## Environment configuration

All connection settings, ports, service deadlines/concurrency/cache limits, feature switches, and UI defaults are configurable at runtime. See **[the environment reference](docs/configuration.md)** and **[.env.example](.env.example)** for the full list.

For Docker, supply variables with `-e`, `--env-file`, or Compose's optional `.env` file, then recreate the container. The entrypoint generates the browser config and matching Nginx/Apache upstreams, including custom Node ports and deadlines. `just run` reads `.env` directly. Existing browser appearance preferences take precedence over deployment defaults.

## Automatic Docker publishing

`.github/workflows/docker-publish.yml` runs on **every push** and can also be started manually. It runs unit tests and the production build, then builds the standalone companion for AMD64 and ARM64 and publishes:

- `dirkvdb/fresher-rss:latest`
- `dirkvdb/fresher-rss:sha-<full-commit-sha>`

Configure these GitHub repository **Actions secrets** before pushing:

| Secret               | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `DOCKERHUB_TOKEN`    | Docker Hub access token with permission to push `dirkvdb/fresher-rss`. Required. |
| `DOCKERHUB_USERNAME` | Docker Hub account used to log in. Optional; defaults to `dirkvdb`.              |

The repository must exist on Docker Hub or the token must be able to create it. A newer push cancels an older publishing run so `latest` follows the latest pushed revision. Runtime FreshRSS credentials are supplied when starting the container, not as build arguments or workflow secrets.

## Commands

| Command               | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `just run`            | Install dependencies and start the frontend             |
| `just build`          | Install dependencies and build `dist/`                  |
| `just check`          | Install dependencies, run unit/browser tests, and build |
| `just test-browser`   | Run desktop/mobile/API browser tests                    |
| `just image`          | Build the standalone web image                          |
| `just image-freshrss` | Build FreshRSS with Fresher included                    |
| `just images`         | Run the built Node image service on loopback port 3001  |
| `just up`             | Build and start the companion using `compose.yaml`      |

`devenv test` also installs dependencies and runs the complete test/build checks. Outside devenv, use Node.js 22.12+ and `npm ci`; browser tests additionally need a Playwright Chromium installation or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing to an installed Chromium.

## Keyboard shortcuts

| Key       | Action                                         |
| --------- | ---------------------------------------------- |
| `J` / `K` | Next / previous article                        |
| `S`       | Star / unstar                                  |
| `M`       | Mark read / unread                             |
| `/`       | Search loaded articles                         |
| `F`       | Toggle focus mode                              |
| `Esc`     | Exit focus / return to the mobile article list |
| `?`       | Shortcut reference                             |

## Stack

React, TypeScript, Vite, Radix Dialog, Lucide icons, and DOMPurify. The small Node.js image service uses the built-in HTTP/TLS clients, parse5 for inert HTML parsing, and ipaddr.js for address validation. Shadcn-style design tokens and CSS provide the interface. No additional database or PHP helper is required.
