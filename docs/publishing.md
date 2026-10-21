# Docker publishing

[`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) runs on **every push**, with a manual `workflow_dispatch` trigger. It tests and builds the project, builds the `standalone` companion for `linux/amd64` and `linux/arm64`, and publishes:

- `dirkvdb/fresher-rss:latest`
- `dirkvdb/fresher-rss:sha-<full-commit-sha>`

A newer push cancels an older publishing run, keeping `latest` on the latest pushed revision.

## Repository Actions secrets

| Secret               | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `DOCKERHUB_TOKEN`    | Required Docker Hub access token with push permission for `dirkvdb/fresher-rss`. |
| `DOCKERHUB_USERNAME` | Optional login account; defaults to `dirkvdb`.                                   |

The Docker Hub repository must exist, or the token must permit creating it. Supply FreshRSS credentials when starting the container; they are not build arguments or workflow secrets. [Runtime configuration](configuration.md).

## CI maintenance

Actions use supported Node.js 24 runtimes. Checkout supplies its initial branch through process-local Git configuration. QEMU installs only ARM64 emulation and leaves its redundant image cache disabled to avoid cache-write collisions; Buildx layer caching remains enabled. npm update/funding advertisements are disabled in automated builds, while warnings, deprecations, and audit findings remain visible.
