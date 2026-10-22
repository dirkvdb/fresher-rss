import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { parseFragment, serialize } from "parse5";
import { DEFAULT_CONFIG } from "./config.mjs";
import { ImageError, webUrl } from "./network.mjs";

const tags = new Set(
  "article section div p br hr h1 h2 h3 h4 h5 h6 blockquote pre code strong b em i u s del ins sub sup small mark span a img figure figcaption ul ol li dl dt dd table caption thead tbody tfoot tr th td abbr time".split(
    " ",
  ),
);
const discard = new Set(
  "script style template noscript iframe frame frameset object embed applet form input button textarea select option link meta base audio video source track canvas svg math".split(
    " ",
  ),
);

function contentUrl(value, base, config) {
  try {
    const url = new URL(value, base);
    return webUrl(url.href, undefined, config.imageAllowedPorts)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Rebuild a parse5 tree with HTML-only elements and explicitly permitted attributes. */
export function sanitizeArticleContent(html, base, config = DEFAULT_CONFIG) {
  const fragment = parseFragment(html);
  let text = "";
  function clean(parent, depth = 0) {
    if (depth > 128) return [];
    const children = [];
    for (const node of parent.childNodes ?? []) {
      if (node.nodeName === "#text") {
        text += node.value;
        children.push(node);
        continue;
      }
      if (
        !node.tagName ||
        node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
        discard.has(node.tagName)
      )
        continue;
      node.childNodes = clean(node, depth + 1);
      if (!tags.has(node.tagName)) {
        children.push(...node.childNodes);
        continue;
      }
      const attrs = new Map();
      for (const attr of node.attrs ?? []) {
        if (attr.namespace || attr.prefix) continue;
        const { name, value } = attr;
        if (
          name === "title" ||
          (node.tagName === "img" && name === "alt") ||
          (node.tagName === "time" && name === "datetime") ||
          (node.tagName === "abbr" && name === "title")
        )
          attrs.set(name, value);
        if (
          ((node.tagName === "a" && name === "href") ||
            (node.tagName === "img" && name === "src")) &&
          value.trim()
        ) {
          const url = contentUrl(value.trim(), base, config);
          if (url) attrs.set(name, url);
        }
        if (
          ((["td", "th"].includes(node.tagName) &&
            ["colspan", "rowspan"].includes(name)) ||
            (node.tagName === "img" && ["width", "height"].includes(name))) &&
          /^\d{1,4}$/.test(value) &&
          Number(value) > 0
        )
          attrs.set(name, value);
      }
      if (node.tagName === "img") {
        if (!attrs.has("src")) continue;
        attrs.set("loading", "lazy");
        attrs.set("referrerpolicy", "no-referrer");
      }
      if (node.tagName === "a" && attrs.has("href")) {
        attrs.set("target", "_blank");
        attrs.set("rel", "noopener noreferrer");
      }
      node.attrs = Array.from(attrs, ([name, value]) => ({ name, value }));
      children.push(node);
    }
    for (const child of children) child.parentNode = parent;
    return children;
  }
  fragment.childNodes = clean(fragment);
  return { content: serialize(fragment), text: text.trim() };
}

export function extractArticleContent(
  html,
  pageUrl,
  { config = DEFAULT_CONFIG } = {},
) {
  if (!html)
    throw new ImageError("Publisher did not return an HTML article.", 422);
  if (Buffer.byteLength(html) > config.imageMaxHtmlBytes)
    throw new ImageError("Publisher response too large.", 502);
  const url = webUrl(pageUrl, undefined, config.imageAllowedPorts)?.href;
  if (!url) throw new ImageError("Invalid publisher URL.", 502);
  // linkedom never executes scripts or fetches subresources. Readability needs
  // explicit document/base URIs, which linkedom does not supply from parseHTML.
  const { document } = parseHTML(html);
  // linkedom's getElementsByTagName("*") does not count all elements, so
  // enforce Readability's element limit ourselves, and also bound tree depth.
  const stack = [{ node: document, depth: 0 }];
  let elements = 0;
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (node.nodeType === 1 && ++elements > 20000)
      throw new ImageError("Publisher document has too many elements.", 422);
    if (depth > 128)
      throw new ImageError("Publisher document is nested too deeply.", 422);
    for (const child of node.children ?? [])
      stack.push({ node: child, depth: depth + 1 });
  }
  const base =
    contentUrl(
      document.querySelector("base[href]")?.getAttribute("href") ?? url,
      url,
      config,
    ) ?? url;
  for (const node of document.querySelectorAll("base")) node.remove();
  Object.defineProperties(document, {
    documentURI: { value: url, configurable: true },
    baseURI: { value: base, configurable: true },
  });

  const article = new Readability(document, {
    maxElemsToParse: 20000,
    keepClasses: false,
    disableJSONLD: true,
  }).parse();
  if (!article?.content)
    throw new ImageError("Could not extract readable article content.", 422);
  const sanitized = sanitizeArticleContent(article.content, base, config);
  if (!sanitized.text)
    throw new ImageError("Could not extract readable article content.", 422);
  if (Buffer.byteLength(sanitized.content) > config.imageMaxHtmlBytes)
    throw new ImageError("Extracted article is too large.", 502);
  return {
    content: sanitized.content,
    title: article.title?.trim() || "",
    byline: article.byline?.trim() || null,
    url,
  };
}
