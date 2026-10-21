# Fresher RSS

A reading-focused interface for **FreshRSS**: three panes, folder-grouped article cards, unread/starred views, search, keyboard navigation, focus mode, and mobile layouts. Six palettes support light, dark, and system modes; reading font and size are adjustable. Read/star changes sync to FreshRSS. A Node.js service discovers cover images and triggers article refreshes. No additional database or PHP helper is required.

## Quickstart

```sh
devenv shell
just run
```

Open **http://localhost:5173** and choose **Explore the demo**, or sign in with your FreshRSS username and **API password**. First enable **Administration → Authentication → Allow API access** and set the API password under **Profile → API management**. Root and subdirectory installations are supported.

## Docker

Published image: **`dirkvdb/fresher-rss:latest`** (`linux/amd64`, `linux/arm64`).

```sh
docker run -d --name fresher-rss --network freshrss_default \
  -p 8081:80 -e FRESHRSS_URL=http://freshrss \
  -e FRESHRSS_REFRESH_TOKENS='{"dirk":"your-master-authentication-token"}' \
  --restart unless-stopped dirkvdb/fresher-rss:latest
```

Open **http://localhost:8081**. Use a network shared with FreshRSS and an upstream URL reachable from the container. The refresh token comes from FreshRSS **Profile → Master authentication token**, is separate from the API password, and stays server-side.

For Compose, create `.env` using [`.env.example`](.env.example), then run `docker compose pull && docker compose up -d`; `just up` builds locally. For the combined FreshRSS image, run `just image-freshrss` and open `/reader/`.

## Configuration and documentation

All deployment settings are configurable through environment variables without rebuilding. Restart/recreate after changes; saved browser appearance preferences override UI defaults.

- **[Environment reference](docs/configuration.md):** connection URLs, ports, UI defaults, feature switches, timeouts, concurrency, caches, rate limits, and complete defaults.
- **[Deployment](docs/deployment.md):** API and refresh setup, standalone/combined Docker, Compose, static hosting, reverse proxies, and version pinning.
- **[Reader guide](docs/usage.md):** features, shortcuts, image discovery, refresh behavior, and authentication storage.
- **[Development](docs/development.md):** tools, commands, tests, builds, and architecture.
- **[Publishing](docs/publishing.md):** GitHub Actions, Docker Hub secrets, platforms, tags, and publishing behavior.

Every push tests/builds the project and publishes `latest` plus `sha-<commit>`. Configure GitHub Actions secret **`DOCKERHUB_TOKEN`**; **`DOCKERHUB_USERNAME`** optionally overrides the default `dirkvdb`.
