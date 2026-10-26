// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "./api";
import { fetchArticleImage } from "./articleImages";
import { useArticleImage } from "./useArticleImage";

vi.mock("./articleImages", () => ({
  fetchArticleImage: vi.fn(),
  thumbnailUrl: (image: string) => image,
}));

const url = "https://tweakers.net/geek/253768/story.html";
const image = "https://tweakers.net/ext/i/2008467020.jpeg";
const article: Article = {
  id: "tweakers-test",
  title: "Tweakers story",
  published: 0,
  categories: [],
  alternate: [{ href: url }],
  origin: { streamId: "feed/tweakers", title: "Tweakers" },
};
let root: Root;
let container: HTMLDivElement;

function Cover() {
  const cover = useArticleImage(article);
  return createElement("div", { ref: cover.ref, "data-image": cover.image });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: (entries: object[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
  vi.mocked(fetchArticleImage).mockReset();
  sessionStorage.clear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("article image recovery", () => {
  it("ignores old cached misses and retries transient errors without caching them", async () => {
    sessionStorage.setItem(
      `fresher-server-image:${url}`,
      JSON.stringify({ image: null, expires: Date.now() + 900000 }),
    );
    vi.mocked(fetchArticleImage)
      .mockRejectedValueOnce(new Error("Publisher returned HTTP 429"))
      .mockResolvedValue(image);
    await act(async () => root.render(createElement(Cover)));
    expect(fetchArticleImage).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(`fresher-server-image:v2:${url}`)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(fetchArticleImage).toHaveBeenCalledTimes(2);
    expect(container.firstElementChild?.getAttribute("data-image")).toBe(image);
    expect(
      JSON.parse(sessionStorage.getItem(`fresher-server-image:v2:${url}`)!)
        .image,
    ).toBe(image);
  });

  it("bounds retries instead of repeatedly hammering a blocked publisher", async () => {
    vi.mocked(fetchArticleImage).mockRejectedValue(new Error("Unavailable"));
    await act(async () => root.render(createElement(Cover)));
    for (const delay of [10000, 30000, 60000, 300000])
      await act(async () => vi.advanceTimersByTimeAsync(delay));
    expect(fetchArticleImage).toHaveBeenCalledTimes(4);
    expect(sessionStorage.getItem(`fresher-server-image:v2:${url}`)).toBeNull();
  });

  it("cancels pending retries when the card is removed", async () => {
    vi.mocked(fetchArticleImage).mockRejectedValue(new Error("Unavailable"));
    await act(async () => root.render(createElement(Cover)));
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(100000));
    expect(fetchArticleImage).toHaveBeenCalledTimes(1);
  });

  it("does not retry a successful lookup that genuinely has no image", async () => {
    vi.mocked(fetchArticleImage).mockResolvedValue(null);
    await act(async () => root.render(createElement(Cover)));
    await act(async () => vi.advanceTimersByTimeAsync(100000));
    expect(fetchArticleImage).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(sessionStorage.getItem(`fresher-server-image:v2:${url}`)!)
        .image,
    ).toBeNull();
  });
});
