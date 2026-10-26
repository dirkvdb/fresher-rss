import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  CheckCheck,
  Folder,
  LoaderCircle,
} from "lucide-react";
import { ALL, FreshRSS, READ, type Article, type Feed } from "./api";
import { articlePreview, plainText } from "./content";
import { FeedIcon } from "./FeedIcon";
import { useArticleImage } from "./useArticleImage";
import "./overview.css";

interface OverviewProps {
  api: FreshRSS;
  isDemo: boolean;
  demoArticles: Article[];
  recentArticles: Article[];
  listLoading: boolean;
  feeds: Feed[];
  stream: string;
  reload: number;
  marking: boolean;
  actionsContainer: HTMLDivElement | null;
  onMarkRead: (articles: Article[]) => Promise<void>;
  onOpen: (article: Article) => void;
  onShowAll: () => void;
  onError: (error: unknown) => void;
}

function OverviewCard({
  article,
  feed,
  onOpen,
}: {
  article: Article;
  feed?: Feed;
  onOpen: (article: Article) => void;
}) {
  const preview = useMemo(() => articlePreview(article), [article]);
  const cover = useArticleImage(article, preview.image);
  const unread = !article.categories.includes(READ);
  return (
    <button
      className="overview-card"
      aria-label={`Open ${preview.title}`}
      onClick={() => onOpen(article)}
    >
      <div
        ref={cover.ref}
        className={`overview-card-media ${cover.image ? "has-image" : "no-image"}`}
      >
        {cover.image ? (
          <img
            src={cover.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={cover.onError}
            onLoad={(event) => {
              if (
                event.currentTarget.naturalWidth < 32 ||
                event.currentTarget.naturalHeight < 32
              )
                cover.onError();
            }}
          />
        ) : (
          <div
            className={`overview-cover cover-tone-${(article.origin.title.charCodeAt(0) || 0) % 4}`}
            aria-hidden="true"
          >
            <span className="cover-lines" />
            <span className="cover-monogram">
              {plainText(article.origin.title).slice(0, 1)}
            </span>
            <BookOpen size={22} strokeWidth={1.3} />
          </div>
        )}
        <span className="overview-card-status">
          {unread ? (
            <>
              <span className="status-dot" /> Unread
            </>
          ) : (
            <>
              <CheckCheck size={11} /> Read
            </>
          )}
        </span>
      </div>
      <div className="overview-card-body">
        <div className="overview-card-source">
          <FeedIcon feed={feed} />
          <span>{plainText(article.origin.title)}</span>
        </div>
        <h3>{preview.title}</h3>
        {preview.excerpt && <p>{preview.excerpt}</p>}
        <div className="overview-card-footer">
          <span>
            <time dateTime={new Date(article.published * 1000).toISOString()}>
              {new Date(article.published * 1000).toLocaleDateString(
                undefined,
                { month: "short", day: "numeric" },
              )}
            </time>
            <span>·</span>
            {preview.minutes} min read
          </span>
          <ArrowRight size={15} />
        </div>
      </div>
    </button>
  );
}

export function ArticleOverview({
  api,
  isDemo,
  demoArticles,
  recentArticles,
  listLoading,
  feeds,
  stream,
  reload,
  marking,
  actionsContainer,
  onMarkRead,
  onOpen,
  onShowAll,
  onError,
}: OverviewProps) {
  const [items, setItems] = useState<Article[]>([]);
  const [continuation, setContinuation] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [markError, setMarkError] = useState("");
  const [showRecent, setShowRecent] = useState(true);
  const generation = useRef(0);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  useEffect(() => {
    const controller = new AbortController();
    const request = ++generation.current;
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setMarkError("");
    setItems([]);
    setContinuation(undefined);
    if (isDemo) {
      setItems(
        demoArticles.filter(
          (a) =>
            !a.categories.includes(READ) &&
            (stream === ALL ||
              a.origin.streamId === stream ||
              a.categories.includes(stream)),
        ),
      );
      setLoading(false);
    } else {
      // Fetch unread articles independently: the first page of the list can be entirely read.
      api
        .articles(stream, true, false, undefined, controller.signal)
        .then((data) => {
          if (request === generation.current) {
            setItems(data.items.filter((a) => !a.categories.includes(READ)));
            setContinuation(data.continuation);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(
              e instanceof Error ? e.message : "Could not load your reading.",
            );
            errorHandler.current(e);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => {
      controller.abort();
      ++generation.current;
    };
  }, [api, isDemo, demoArticles, stream, reload, attempt]);

  async function loadMore() {
    if (!continuation || loadingMore || marking) return;
    const request = generation.current;
    setLoadingMore(true);
    setError("");
    try {
      const data = await api.articles(stream, true, false, continuation);
      if (request !== generation.current) return;
      setItems((prev) => [
        ...prev,
        ...data.items.filter(
          (a) =>
            !a.categories.includes(READ) && !prev.some((p) => p.id === a.id),
        ),
      ]);
      setContinuation(data.continuation);
    } catch (e) {
      if (request === generation.current) {
        setError(
          e instanceof Error ? e.message : "Could not load more articles.",
        );
        errorHandler.current(e);
      }
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  }

  async function markVisibleRead() {
    if (marking || loading || loadingMore || !items.length) return;
    const request = generation.current;
    setMarkError("");
    try {
      await onMarkRead(items);
      // Once processing batches, keep read tiles out of the overview even when caught up.
      setShowRecent(false);
    } catch (e) {
      if (request === generation.current) {
        setMarkError(
          e instanceof Error
            ? e.message
            : "Could not mark these articles as read.",
        );
        errorHandler.current(e);
      }
    }
  }

  const busy = loading || (!items.length && listLoading);
  const caughtUp = !busy && !items.length && !error;
  const feedMap = useMemo(
    () => new Map(feeds.map((feed) => [feed.id, feed])),
    [feeds],
  );
  const groups = useMemo(() => {
    const articles = [
      ...(items.length ? items : showRecent ? recentArticles : []),
    ].sort((a, b) => b.published - a.published);
    const result = new Map<string, { label: string; articles: Article[] }>();
    for (const article of articles) {
      const category = feedMap.get(article.origin.streamId)?.categories?.[0];
      const id = category?.id ?? "other";
      if (!result.has(id))
        result.set(id, {
          label: category?.label ?? "Articles",
          articles: [],
        });
      result.get(id)!.articles.push(article);
    }
    return [...result.entries()];
  }, [items, recentArticles, feedMap, showRecent]);

  return (
    <section
      className="article-overview"
      aria-label="Article overview"
      aria-busy={busy || marking}
    >
      {actionsContainer &&
        createPortal(
          <button
            className="button"
            disabled={busy || marking || loadingMore || !items.length}
            onClick={markVisibleRead}
            title="Mark the displayed tiles as read and load the next unread batch"
          >
            {marking ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <CheckCheck size={15} />
            )}
            {marking ? "Marking as read…" : "Mark as read"}
          </button>,
          actionsContainer,
        )}
      {markError && (
        <div className="overview-error" role="alert">
          <p>{markError}</p>
        </div>
      )}
      {caughtUp && groups.length > 0 && (
        <p className="overview-status">
          <CheckCheck size={14} /> No unread articles. Showing recent articles.
        </p>
      )}
      {busy ? (
        <div role="status">
          <span className="sr-only">Loading your latest unread articles…</span>
          <div className="overview-grid overview-skeletons" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="overview-skeleton" key={i}>
                <div />
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {error && (
            <div className="overview-error" role="alert">
              <p>{error}</p>
              <button
                className="button"
                disabled={loadingMore || marking}
                onClick={() =>
                  items.length ? void loadMore() : setAttempt((v) => v + 1)
                }
              >
                Try again
              </button>
            </div>
          )}
          {!error || items.length
            ? groups.map(([id, group]) => (
                <section
                  className="overview-section"
                  key={id}
                  aria-label={group.label}
                >
                  <div className="overview-section-heading">
                    <Folder size={15} />
                    <h2>{plainText(group.label)}</h2>
                    <span>
                      {group.articles.length} {caughtUp ? "recent" : "unread"}
                    </span>
                    <i />
                  </div>
                  <div className="overview-grid">
                    {group.articles.map((article) => (
                      <OverviewCard
                        key={article.id}
                        article={article}
                        feed={feedMap.get(article.origin.streamId)}
                        onOpen={onOpen}
                      />
                    ))}
                  </div>
                </section>
              ))
            : null}
          {caughtUp && !groups.length && (
            <div className="overview-empty">
              <span className="empty-icon">
                <BookOpen size={26} />
              </span>
              <h2>{showRecent ? "No articles" : "No unread articles"}</h2>
              <p>
                {showRecent
                  ? "Refresh your feeds or select another view."
                  : "You’re all caught up. Refresh your feeds or browse all articles."}
              </p>
              <button
                className="button"
                onClick={() => {
                  setShowRecent(true);
                  onShowAll();
                }}
              >
                Browse all articles <ArrowRight size={14} />
              </button>
            </div>
          )}
          {continuation && !error && (
            <div className="overview-more">
              <button
                className="button"
                disabled={loadingMore || marking}
                onClick={loadMore}
              >
                {loadingMore ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ArrowDown size={15} />
                )}
                {loadingMore ? "Loading more…" : "Load more articles"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
