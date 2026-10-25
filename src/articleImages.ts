import { safeUrl } from "./content";
import { runtimeConfig } from "./runtime";

/** Cache misses redirect to the original, so read articles and restarts still work. */
export function thumbnailUrl(image: string): string {
  if (!runtimeConfig().imageUnreadCacheEnabled) return image;
  const endpoint = new URL(runtimeConfig().imageApiUrl, document.baseURI);
  endpoint.searchParams.set("url", image);
  endpoint.searchParams.set("thumbnail", "1");
  return endpoint.href;
}

function resolveImage(value: unknown, base: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return safeUrl(new URL(value.trim(), base).href);
  } catch {
    return undefined;
  }
}

/** Parse an inert document. Publisher scripts are never inserted into the app or executed. */
export function imageFromPage(html: string, pageUrl: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base =
    resolveImage(
      doc.querySelector("base[href]")?.getAttribute("href"),
      pageUrl,
    ) ?? pageUrl;
  const metadata = new Map<string, string>();
  for (const meta of doc.querySelectorAll("meta[property], meta[name]")) {
    const key = (
      meta.getAttribute("property") ||
      meta.getAttribute("name") ||
      ""
    ).toLowerCase();
    if (!metadata.has(key))
      metadata.set(key, meta.getAttribute("content") ?? "");
  }
  for (const key of [
    "og:image:secure_url",
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
  ]) {
    const image = resolveImage(metadata.get(key), base);
    if (image) return image;
  }
  const linked = resolveImage(
    doc.querySelector('link[rel="image_src"]')?.getAttribute("href"),
    base,
  );
  if (linked) return linked;

  for (const script of doc.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      const data = JSON.parse(script.textContent ?? "");
      const nodes: Record<string, unknown>[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.["@graph"])
          ? data["@graph"]
          : [data];
      const byId = new Map(
        nodes
          .filter((node) => node && typeof node["@id"] === "string")
          .map((node) => [node["@id"], node]),
      );
      const findImage = (value: unknown, depth = 0): string | undefined => {
        if (depth > 6 || !value) return undefined;
        if (typeof value === "string") return resolveImage(value, base);
        if (Array.isArray(value))
          return value.map((item) => findImage(item, depth + 1)).find(Boolean);
        if (typeof value !== "object") return undefined;
        const item = value as Record<string, unknown>;
        for (const key of ["image", "thumbnailUrl"]) {
          const image = findImage(item[key], depth + 1);
          if (image) return image;
        }
        if (!item["@type"] || item["@type"] === "ImageObject") {
          for (const key of ["contentUrl", "url"]) {
            const image = resolveImage(item[key], base);
            if (image) return image;
          }
        }
        const reference = byId.get(item["@id"]);
        return reference && reference !== item
          ? findImage(reference, depth + 1)
          : undefined;
      };
      // Prefer article/page image properties over publisher logos and author portraits.
      for (const node of nodes) {
        if (!node || ["Person", "Organization"].includes(String(node["@type"])))
          continue;
        const image = findImage(node.image) ?? findImage(node.thumbnailUrl);
        if (image) return image;
      }
    } catch {
      /* A malformed structured-data block should not hide other images. */
    }
  }
  for (const img of doc.querySelectorAll("article img, main img")) {
    if (
      ["width", "height"].some(
        (attr) =>
          img.hasAttribute(attr) && parseFloat(img.getAttribute(attr)!) < 64,
      )
    )
      continue;
    for (const attr of ["data-src", "data-lazy-src", "data-original", "src"]) {
      const image = resolveImage(img.getAttribute(attr), base);
      if (image) return image;
    }
  }
  return null;
}

/** Optional fallback for static-only deployments without the image service. */
async function fetchArticleImageDirect(url: string): Promise<string | null> {
  if (!safeUrl(url)) return null;
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(runtimeConfig().imageClientTimeoutMs),
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("html") ||
      !response.body
    )
      return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let size = 0;
    try {
      while (size < runtimeConfig().imageMaxHtmlBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = value.subarray(
          0,
          runtimeConfig().imageMaxHtmlBytes - size,
        );
        size += chunk.length;
        html += decoder.decode(chunk, { stream: true });
      }
      html += decoder.decode();
    } finally {
      await reader.cancel();
    }
    return imageFromPage(html, response.url || url);
  } catch {
    // CORS blocks are expected for most publishers. Feed images remain available.
    return null;
  }
}

/** The server fetches publisher HTML so browser CORS policy does not block covers. */
export async function fetchArticleImage(url: string): Promise<string | null> {
  if (!runtimeConfig().imageEnabled) return null;
  if (!safeUrl(url)) return null;
  const endpoint = new URL(runtimeConfig().imageApiUrl, document.baseURI);
  endpoint.searchParams.set("url", url);
  const response = await fetch(endpoint, {
    credentials: "omit",
    signal: AbortSignal.timeout(runtimeConfig().imageClientTimeoutMs),
    headers: { Accept: "application/json" },
  });
  if (
    response.ok &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const data = await response.json();
    if (!(data?.image === null || typeof data?.image === "string"))
      throw new Error("Invalid article-image response.");
    return safeUrl(data.image ?? undefined) ?? null;
  }
  if (response.status === 400) return null;
  if (
    response.status === 404 ||
    (response.ok && response.headers.get("content-type")?.includes("text/html"))
  )
    return fetchArticleImageDirect(url);
  throw new Error("Article-image service is temporarily unavailable.");
}
