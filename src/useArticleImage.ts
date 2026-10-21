import { useEffect, useRef, useState } from "react";
import type { Article } from "./api";
import { safeUrl } from "./content";
import { fetchArticleImage } from "./articleImages";
import { runtimeConfig } from "./runtime";

type CachedImage = { image: string | null; expires: number };
const requests = new Map<string, Promise<string | null>>();
const queue: (() => void)[] = [];
let active = 0;

function discoverImage(url: string): Promise<string | null> {
  if (requests.has(url)) return requests.get(url)!;
  const key = `fresher-server-image:${url}`;
  try {
    const cached: CachedImage | null = JSON.parse(
      sessionStorage.getItem(key) ?? "null",
    );
    if (cached && cached.expires > Date.now())
      return Promise.resolve(safeUrl(cached.image ?? undefined) ?? null);
  } catch {
    /* Storage is optional. */
  }
  const request = new Promise<string | null>((resolve) => {
    const run = async () => {
      active++;
      try {
        const image = await fetchArticleImage(url);
        try {
          sessionStorage.setItem(
            key,
            JSON.stringify({
              image,
              expires:
                Date.now() +
                (image
                  ? runtimeConfig().imageCacheTtlSeconds
                  : runtimeConfig().imageMissTtlSeconds) *
                  1000,
            }),
          );
        } catch {
          /* Storage is optional. */
        }
        resolve(image);
      } catch {
        // A transient service error must not become a cached "no image" result.
        resolve(null);
      } finally {
        active--;
        queue.shift()?.();
      }
    };
    if (active < runtimeConfig().imageClientConcurrency) void run();
    else queue.push(() => void run());
  });
  requests.set(url, request);
  void request.finally(() => requests.delete(url));
  return request;
}

export function useArticleImage(article: Article, feedImage?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [discovered, setDiscovered] = useState<string | null>();
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const url = safeUrl(article.alternate?.[0]?.href);
  const image = [feedImage, discovered].find(
    (candidate): candidate is string => !!candidate && !failed.has(candidate),
  );
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !url || image || discovered !== undefined) return;
    let cancelled = false;
    discoverImage(url).then((result) => {
      if (!cancelled) setDiscovered(result);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, url, image, discovered]);
  function onError() {
    if (image) setFailed((previous) => new Set([...previous, image]));
  }
  return { ref, image, onError };
}
