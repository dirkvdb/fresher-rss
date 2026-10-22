import { createImageService } from "./service.mjs";
import { createContentService } from "./content-service.mjs";
import { createRefreshService } from "./refresh.mjs";
import { readConfig } from "./config.mjs";

export function createAppService(options = {}) {
  const config = options.config ?? readConfig();
  const images = createImageService({ config });
  const content = createContentService({ ...options, config });
  const refresh = createRefreshService({ ...options, config });
  return function handler(request, response) {
    const path = request.url?.split("?")[0];
    if (path === "/api/article-content") return content(request, response);
    return path === "/api/refresh"
      ? refresh(request, response)
      : images(request, response);
  };
}
