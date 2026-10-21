# Docker publishing

[`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) runs on **every push**, with a manual `workflow_dispatch` trigger. It tests and builds the project, then publishes both Docker targets for `linux/amd64` and `linux/arm64`:

| Docker target | Published tags                                                                                  | Contents                                                             |
| ------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `freshrss`    | `dirkvdb/fresher-rss:latest`, `dirkvdb/fresher-rss:sha-<full-commit-sha>`                       | FreshRSS with the frontend at `/reader/` and Node services           |
| `standalone`  | `dirkvdb/fresher-rss-standalone:latest`, `dirkvdb/fresher-rss-standalone:sha-<full-commit-sha>` | Nginx, frontend, and Node services for an existing FreshRSS instance |

A newer push cancels an older publishing run, keeping both `latest` tags on the latest pushed revision. The targets have separate Buildx cache scopes and share the builder's common layers.

## Repository Actions secrets

| Secret               | Purpose                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `DOCKERHUB_TOKEN`    | Required Docker Hub access token with push permission for both image repositories. |
| `DOCKERHUB_USERNAME` | Optional login account; defaults to `dirkvdb`.                                     |

Both Docker Hub repositories must exist, or the token must permit creating them. Supply FreshRSS credentials when starting the container; they are not build arguments or workflow secrets. [Runtime configuration](configuration.md).

The former companion tag `dirkvdb/fresher-rss:latest` now contains the combined FreshRSS image. Existing companion deployments should use `dirkvdb/fresher-rss-standalone:latest`; the supplied Compose file already selects it.

## CI maintenance

Actions use supported Node.js 24 runtimes. Checkout supplies its initial branch through process-local Git configuration. QEMU installs only ARM64 emulation and leaves its redundant image cache disabled to avoid cache-write collisions; Buildx layer caching remains enabled. npm update/funding advertisements are disabled in automated builds, while warnings, deprecations, and audit findings remain visible.
