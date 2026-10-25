import { parse } from "parse5";
import { webUrl } from "./network.mjs";
import { DEFAULT_CONFIG } from "./config.mjs";

/** Match the reader's feed-image preference before falling back to publisher HTML. */
export function extractFeedImage(article, { config = DEFAULT_CONFIG } = {}) {
  const base = article.alternate?.[0]?.href ?? article.origin?.htmlUrl;
  const resolve = (value) =>
    value && webUrl(value, base, config.imageAllowedPorts)?.href;
  const nodes = [
    parse(article.content?.content ?? article.summary?.content ?? ""),
  ];
  while (nodes.length) {
    const node = nodes.shift();
    nodes.unshift(...(node.childNodes ?? []));
    if (node.tagName !== "img") continue;
    const attr = (name) =>
      node.attrs?.find((item) => item.name === name)?.value;
    if (["width", "height"].some((key) => parseFloat(attr(key)) < 32)) continue;
    const srcset = attr("data-srcset") ?? attr("srcset");
    for (const value of [
      attr("data-src"),
      attr("data-lazy-src"),
      attr("data-original"),
      ...(srcset
        ?.split(",")
        .reverse()
        .map((source) => source.trim().split(/\s+/)[0]) ?? []),
      attr("src"),
    ]) {
      const image = resolve(value);
      if (image) return image;
    }
  }
  for (const enclosure of article.enclosure ?? []) {
    const image =
      enclosure.type?.startsWith("image/") && resolve(enclosure.href);
    if (image) return image;
  }
  return null;
}

/** HTML parsing only: no browser, JavaScript execution, subresource loading, or cookies. */
export function extractImages(html, pageUrl, { config = DEFAULT_CONFIG } = {}) {
  const document = parse(html);
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(document);
  const attr = (node, name) =>
    node.attrs?.find((item) => item.name === name)?.value;
  const resolve = (value) =>
    typeof value === "string" && value.trim()
      ? webUrl(value.trim(), base, config.imageAllowedPorts)?.href
      : undefined;
  let base = pageUrl;
  const baseElement = nodes.find(
    (node) => node.tagName === "base" && attr(node, "href"),
  );
  base = resolve(baseElement && attr(baseElement, "href")) ?? pageUrl;
  const candidates = [];
  const add = (value) => {
    const image = resolve(value);
    if (image && !candidates.includes(image)) candidates.push(image);
  };
  const metadata = new Map();
  for (const node of nodes)
    if (node.tagName === "meta") {
      const key = (
        attr(node, "property") ??
        attr(node, "name") ??
        ""
      ).toLowerCase();
      if (!metadata.has(key)) metadata.set(key, attr(node, "content"));
    }
  for (const key of [
    "og:image:secure_url",
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
  ])
    add(metadata.get(key));
  for (const node of nodes)
    if (node.tagName === "link" && attr(node, "rel") === "image_src")
      add(attr(node, "href"));
  for (const node of nodes)
    if (
      node.tagName === "script" &&
      attr(node, "type") === "application/ld+json"
    ) {
      try {
        const data = JSON.parse(
          (node.childNodes ?? []).map((child) => child.value ?? "").join(""),
        );
        const graph = Array.isArray(data)
          ? data
          : Array.isArray(data?.["@graph"])
            ? data["@graph"]
            : [data];
        const byId = new Map(
          graph
            .filter((item) => item && typeof item["@id"] === "string")
            .map((item) => [item["@id"], item]),
        );
        function image(value, depth = 0) {
          if (!value || depth > 6) return;
          if (typeof value === "string") {
            add(value);
            return;
          }
          if (Array.isArray(value)) {
            value.forEach((item) => image(item, depth + 1));
            return;
          }
          if (typeof value !== "object") return;
          image(value.image, depth + 1);
          image(value.thumbnailUrl, depth + 1);
          if (!value["@type"] || value["@type"] === "ImageObject") {
            add(value.contentUrl);
            add(value.url);
          }
          const reference = byId.get(value["@id"]);
          if (reference && reference !== value) image(reference, depth + 1);
        }
        for (const item of graph)
          if (item && !["Person", "Organization"].includes(item["@type"])) {
            image(item.image);
            image(item.thumbnailUrl);
          }
      } catch {
        /* Continue past malformed publisher metadata. */
      }
    }
  for (const node of nodes)
    if (node.tagName === "img") {
      let ancestor = node.parentNode;
      while (ancestor && !["article", "main"].includes(ancestor.tagName))
        ancestor = ancestor.parentNode;
      if (
        !ancestor ||
        ["width", "height"].some(
          (key) => attr(node, key) && parseFloat(attr(node, key)) < 64,
        )
      )
        continue;
      for (const key of ["data-src", "data-lazy-src", "data-original", "src"])
        add(attr(node, key));
    }
  return candidates.slice(0, config.imageMaxCandidates);
}
