# Development

```sh
devenv shell
just run
```

Open **http://localhost:5173**. Choose **Explore the demo** or connect an instance with an API password. `devenv shell -- just run` is the equivalent one-command form.

`devenv.nix` supplies Node.js 22, npm, Just, Docker/Compose clients, Chromium for browser tests, actionlint, and the GitHub CLI. `just run` installs exact dependencies from `package-lock.json` and starts Vite. The Node image and refresh services are integrated into Vite development and preview, so no separate process is needed for local photos.

`devenv up` starts the frontend after installing dependencies with `setup` or `npm ci`. A Docker daemon is needed for container commands.

## Commands

| Command               | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `just run`            | Install dependencies and start the frontend               |
| `just build`          | Install dependencies and build `dist/` and `dist-server/` |
| `just check`          | Install dependencies, run unit/browser tests, and build   |
| `just test-browser`   | Run desktop/mobile/API browser tests                      |
| `just image`          | Build the standalone companion image                      |
| `just image-freshrss` | Build the combined FreshRSS image                         |
| `just images`         | Run the built Node service on loopback port 3001          |
| `just up`             | Build and start the companion using `compose.yaml`        |

`devenv test` installs dependencies and runs the complete test/build checks. Outside devenv, use Node.js 22.12+ and `npm ci`. Browser tests need a Playwright Chromium installation or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing to installed Chromium.

Runtime settings are read from `.env` or process environment. See [configuration](configuration.md) and [refresh setup](deployment.md#server-side-article-refresh).

## Architecture

React, TypeScript, Vite, Radix Dialog, Lucide icons, and DOMPurify provide the reader. CSS design tokens implement the shadcn-inspired interface. Node uses built-in HTTP/TLS clients, parse5 for inert HTML parsing, and ipaddr.js for address validation. No additional database or PHP helper is required. FreshRSS remains the source of article content and reading state.
