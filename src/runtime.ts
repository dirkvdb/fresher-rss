export interface RuntimeConfig {
  apiUrl: string;
  imageApiUrl: string;
  contentApiUrl: string;
  refreshApiUrl: string;
  defaultPalette: "forest" | "stone" | "sepia" | "ocean" | "rose" | "lavender";
  defaultMode: "light" | "dark" | "system";
  defaultFont: "serif" | "sans";
  defaultFontSize: number;
  defaultSort: "newest" | "oldest";
  defaultUnreadOnly: boolean;
  markReadOnOpen: boolean;
  pageSize: number;
  apiTimeoutMs: number;
  imageEnabled: boolean;
  refreshEnabled: boolean;
  imageClientTimeoutMs: number;
  refreshClientTimeoutMs: number;
  imageClientConcurrency: number;
  imageMaxHtmlBytes: number;
  imageCacheTtlSeconds: number;
  imageMissTtlSeconds: number;
}

declare global {
  interface Window {
    FRESHER_CONFIG?: Partial<RuntimeConfig>;
  }
}

export function runtimeConfig(): RuntimeConfig {
  return {
    apiUrl: "",
    imageApiUrl: "api/article-image",
    contentApiUrl: "api/article-content",
    refreshApiUrl: "api/refresh",
    defaultPalette: "forest",
    defaultMode: "system",
    defaultFont: "serif",
    defaultFontSize: 18,
    defaultSort: "newest",
    defaultUnreadOnly: true,
    markReadOnOpen: true,
    pageSize: 50,
    apiTimeoutMs: 30000,
    imageEnabled: true,
    refreshEnabled: true,
    imageClientTimeoutMs: 15000,
    refreshClientTimeoutMs: 300000,
    imageClientConcurrency: 4,
    imageMaxHtmlBytes: 1048576,
    imageCacheTtlSeconds: 86400,
    imageMissTtlSeconds: 900,
    ...window.FRESHER_CONFIG,
  };
}
