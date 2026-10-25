import { createImageService } from "./service.mjs";
import { createContentService } from "./content-service.mjs";
import { createRefreshService } from "./refresh.mjs";
import { readConfig } from "./config.mjs";
import { createUnreadCache } from "./unread-cache.mjs";

export function createAppService(options = {}) {
  const config = options.config ?? readConfig();
  const unread = createUnreadCache({
    ...options,
    config,
    lookupImage: (url) => images.lookup(url),
    lookupContent: (url, options) => content.prefetch(url, options),
  });
  const images = createImageService({
    ...options,
    config,
    thumbnailCache: unread,
  });
  const content = createContentService({
    ...options,
    config,
    unreadCache: unread,
  });
  const refresh = createRefreshService({ ...options, config });
  const handler = function handler(request, response) {
    const path = request.url?.split("?")[0];
    if (path === "/api/article-content") return content(request, response);
    return path === "/api/refresh"
      ? refresh(request, response)
      : images(request, response);
  };
  handler.close = () => unread.close();
  unread.start();
  return handler;
}
