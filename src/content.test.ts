// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { articleHtml, articlePreview, plainText, safeUrl } from "./content";
import type { Article } from "./api";

const article = (html: string): Article => ({
  id: "1",
  title: "Title",
  published: 1,
  categories: [],
  alternate: [{ href: "https://example.com/posts/story" }],
  origin: { title: "Feed", streamId: "feed/1" },
  summary: { content: html },
});
describe("untrusted feed content", () => {
  it("removes executable HTML, forms, inline styling, and unsafe URLs", () => {
    const html = articleHtml(
      article(
        '<script>alert(1)</script><img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe><form><input></form><p style="position:fixed" id="root">Hello</p><a href="javascript:alert(1)">bad link</a><svg onload="alert(1)"></svg>',
      ),
    );
    expect(html).not.toMatch(
      /<script|onerror|<iframe|<form|<input|style=|id=|javascript:|<svg/i,
    );
    expect(html).toContain("Hello");
  });
  it("resolves relative media and isolates outgoing links", () => {
    const doc = new DOMParser().parseFromString(
      articleHtml(
        article(
          '<p><a href="../about">About</a><img src="/photo.jpg" srcset="/evil.jpg 2x"></p>',
        ),
      ),
      "text/html",
    );
    expect(doc.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/about",
    );
    expect(doc.querySelector("a")?.getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/photo.jpg",
    );
    expect(doc.querySelector("img")?.hasAttribute("srcset")).toBe(false);
    expect(doc.querySelector("img")?.getAttribute("referrerpolicy")).toBe(
      "no-referrer",
    );
  });
  it("decodes entities for titles and blocks non-web original URLs", () => {
    expect(plainText("Design &amp; <b>craft</b>")).toBe("Design & craft");
    expect(plainText("<p>First paragraph.</p><p>Second paragraph.</p>")).toBe(
      "First paragraph. Second paragraph.",
    );
    expect(safeUrl("data:text/html,hello")).toBeUndefined();
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
  });
  it("finds a safe article cover while skipping tracking pixels and unsafe sources", () => {
    const preview = articlePreview(
      article(
        '<img src="https://tracker.example/pixel" width="1" height="1"><img src="javascript:alert(1)"><img src="../cover.jpg" onerror="alert(1)"><p>A short introduction.</p>',
      ),
    );
    expect(preview.image).toBe("https://example.com/cover.jpg");
    expect(preview.excerpt).toBe("A short introduction.");
    expect(preview.minutes).toBe(1);
    expect(
      articlePreview(article('<img src="data:image/png;base64,AAAA">')).image,
    ).toBeUndefined();
  });
  it("uses lazy-loaded and responsive feed images", () => {
    expect(
      articlePreview(
        article('<img src="/placeholder.gif" data-src="/photo.jpg">'),
      ).image,
    ).toBe("https://example.com/photo.jpg");
    expect(
      articlePreview(
        article('<img srcset="/small.jpg 400w, /large.jpg 1200w">'),
      ).image,
    ).toBe("https://example.com/large.jpg");
  });
  it("uses image enclosures when the article body has no photo", () => {
    const item = {
      ...article("<p>Text only.</p>"),
      enclosure: [{ href: "/attachment.jpg", type: "image/jpeg" }],
    };
    expect(articlePreview(item).image).toBe(
      "https://example.com/attachment.jpg",
    );
  });
});
