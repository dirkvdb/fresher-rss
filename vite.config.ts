import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createAppService } from "./server/app.mjs";
import { readConfig, browserConfigScript } from "./server/config.mjs";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const config = readConfig(env);
  const options = { config };
  return {
    base: "./",
    cacheDir: process.env.FRESHER_VITE_CACHE_DIR || "node_modules/.vite",
    plugins: [
      react(),
      {
        name: "fresher-images",
        configureServer(server) {
          const handler = createAppService(options);
          server.middlewares.use((request, response, next) => {
            if (request.url?.split("?")[0] === "/config.js") {
              response.setHeader(
                "Content-Type",
                "application/javascript; charset=utf-8",
              );
              response.setHeader("Cache-Control", "no-store");
              response.end(browserConfigScript(config));
              return;
            }
            if (
              [
                "/api/article-image",
                "/api/article-content",
                "/api/refresh",
              ].includes(request.url?.split("?")[0] ?? "")
            )
              void handler(request, response);
            else next();
          });
        },
        configurePreviewServer(server) {
          const handler = createAppService(options);
          server.middlewares.use((request, response, next) => {
            if (request.url?.split("?")[0] === "/config.js") {
              response.setHeader(
                "Content-Type",
                "application/javascript; charset=utf-8",
              );
              response.setHeader("Cache-Control", "no-store");
              response.end(browserConfigScript(config));
              return;
            }
            if (
              [
                "/api/article-image",
                "/api/article-content",
                "/api/refresh",
              ].includes(request.url?.split("?")[0] ?? "")
            )
              void handler(request, response);
            else next();
          });
        },
      },
    ],
  };
});
