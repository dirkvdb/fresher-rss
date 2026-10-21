import { createImageService } from "./service.mjs";
import { createRefreshService } from "./refresh.mjs";
import { readConfig } from "./config.mjs";

export function createAppService(options = {}) {
  const config = options.config ?? readConfig();
  const images = createImageService({ config });
  const refresh = createRefreshService({ ...options, config });
  return function handler(request, response) {
    const path = request.url?.split("?")[0];
    return path === "/api/refresh"
      ? refresh(request, response)
      : images(request, response);
  };
}
