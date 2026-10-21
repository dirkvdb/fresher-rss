import DOMPurify from "dompurify";
import type { Article } from "./api";

export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  doc
    .querySelectorAll("p, div, br, h1, h2, h3, h4, h5, h6, li, blockquote")
    .forEach((el) => el.append(" "));
  return doc.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
export function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function articlePreview(article: Article) {
  const html = article.content?.content ?? article.summary?.content ?? "";
  const text = plainText(html);
  const doc = new DOMParser().parseFromString(
    DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }),
    "text/html",
  );
  const base =
    safeUrl(article.alternate?.[0]?.href) ?? safeUrl(article.origin.htmlUrl);
  let image: string | undefined;
  for (const img of doc.querySelectorAll("img")) {
    // Ignore explicit tracking pixels and small feed icons.
    if (
      ["width", "height"].some((attr) => {
        const size = parseFloat(img.getAttribute(attr) ?? "");
        return Number.isFinite(size) && size < 32;
      })
    )
      continue;
    const srcset =
      img.getAttribute("data-srcset") ?? img.getAttribute("srcset");
    const sources = [
      img.getAttribute("data-src"),
      img.getAttribute("data-lazy-src"),
      img.getAttribute("data-original"),
      ...(srcset
        ?.split(",")
        .reverse()
        .map((source) => source.trim().split(/\s+/)[0]) ?? []),
      img.getAttribute("src"),
    ];
    for (const source of sources) {
      if (!source) continue;
      try {
        image = safeUrl(new URL(source, base).href);
      } catch {
        /* Try the next source. */
      }
      if (image) break;
    }
    if (image) break;
  }
  if (!image) {
    for (const enclosure of article.enclosure ?? []) {
      if (!enclosure.type?.startsWith("image/")) continue;
      try {
        image = safeUrl(new URL(enclosure.href, base).href);
      } catch {
        /* Try the next attachment. */
      }
      if (image) break;
    }
  }
  return {
    title: plainText(article.title) || "Untitled article",
    excerpt: text.slice(0, 260),
    minutes: Math.max(1, Math.ceil(text.split(/\s+/).length / 220)),
    image,
  };
}
export function articleHtml(article: Article): string {
  const sanitized = DOMPurify.sanitize(
    article.content?.content ?? article.summary?.content ?? "",
    {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["form", "input", "button", "textarea", "select", "style"],
      FORBID_ATTR: ["style", "srcset", "id", "name"],
    },
  );
  const doc = new DOMParser().parseFromString(sanitized, "text/html");
  const base =
    safeUrl(article.alternate?.[0]?.href) ?? safeUrl(article.origin.htmlUrl);
  for (const el of doc.querySelectorAll("[href], [src]")) {
    for (const attr of ["href", "src"]) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      try {
        const absolute = safeUrl(new URL(value, base).href);
        if (absolute) el.setAttribute(attr, absolute);
        else el.removeAttribute(attr);
      } catch {
        el.removeAttribute(attr);
      }
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    if (el.tagName === "IMG") {
      el.setAttribute("loading", "lazy");
      el.setAttribute("referrerpolicy", "no-referrer");
    }
  }
  return doc.body.innerHTML;
}
