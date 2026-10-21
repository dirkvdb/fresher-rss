import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Folder,
  Inbox,
  Leaf,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Maximize2,
  Menu,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Type,
  X,
} from "lucide-react";
import {
  ALL,
  ApiError,
  FreshRSS,
  READ,
  STARRED,
  login,
  type Article,
  type Feed,
  type Session,
} from "./api";
import { articleHtml, plainText, safeUrl } from "./content";
import { demoCounts, demoFeeds, makeDemo } from "./demo";
import { ArticleOverview } from "./ArticleOverview";
import { FeedIcon } from "./FeedIcon";
import { ThemePicker } from "./ThemePicker";
import { useTheme } from "./themes";
import { runtimeConfig } from "./runtime";

const DEMO: Session = { apiUrl: "demo", username: "Alex", token: "" };
function stored(key: string, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private browsing can disable storage. */
  }
}
function savedSession(): Session | null {
  try {
    const s = JSON.parse(
      sessionStorage.getItem("fresher-session") ||
        localStorage.getItem("fresher-session") ||
        "null",
    );
    return s &&
      typeof s.apiUrl === "string" &&
      typeof s.token === "string" &&
      typeof s.username === "string"
      ? s
      : null;
  } catch {
    return null;
  }
}
function IconButton({
  label,
  children,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}
function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <Dialog.Close asChild>
            <button className="icon-button dialog-close" aria-label="Close">
              <X size={18} />
            </button>
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <BookOpen size={20} strokeWidth={1.7} />
      </span>
      <span>
        fresher<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Login({
  onLogin,
  error: initialError,
  themeControl,
}: {
  onLogin: (session: Session) => void;
  error: string;
  themeControl: ReactNode;
}) {
  const configured = window.FRESHER_CONFIG?.apiUrl;
  const defaultUrl = `${window.location.origin}${window.location.pathname.replace(/\/(reader|index\.html)\/?$/, "").replace(/\/$/, "")}`;
  const [instance, setInstance] = useState(
    stored("fresher-instance", defaultUrl),
  );
  const [username, setUsername] = useState(stored("fresher-username"));
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await login(
        configured || instance.trim(),
        username.trim(),
        password,
      );
      save("fresher-instance", instance.trim());
      save("fresher-username", username.trim());
      try {
        localStorage.removeItem("fresher-session");
        sessionStorage.removeItem("fresher-session");
        (remember ? localStorage : sessionStorage).setItem(
          "fresher-session",
          JSON.stringify(session),
        );
      } catch {
        /* Login still works without persistence. */
      }
      setPassword("");
      onLogin(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <header>
        <Brand />
        {themeControl}
      </header>
      <div className="login-layout">
        <section className="login-card">
          <span className="small-logo">
            <BookOpen size={23} />
          </span>
          <h2>Sign in</h2>
          <p>Connect to your FreshRSS instance.</p>
          <form onSubmit={submit}>
            {!configured && (
              <label>
                FreshRSS instance URL
                <input
                  type="url"
                  placeholder="https://rss.example.com"
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  required
                  autoComplete="url"
                />
              </label>
            )}
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                placeholder="Your FreshRSS username"
              />
            </label>
            <label>
              API password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Your API password"
              />
            </label>
            <p className="field-help">
              Use the API password from FreshRSS → Profile → API management. API
              access must be enabled.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />{" "}
              Remember me on this device
            </label>
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
            <button className="button primary login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ArrowRight size={16} />
              )}{" "}
              {busy ? "Connecting…" : "Connect to FreshRSS"}
            </button>
          </form>
          <div className="login-divider">
            <span>or</span>
          </div>
          <button className="button demo-button" onClick={() => onLogin(DEMO)}>
            Explore the demo <ArrowRight size={15} />
          </button>
          <p className="privacy-note">Your API password is never stored.</p>
        </section>
      </div>
    </main>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(savedSession);
  const [loginError, setLoginError] = useState("");
  const theme = useTheme();
  const themeControl = (
    <ThemePicker
      mode={theme.mode}
      palette={theme.palette}
      resolvedMode={theme.resolvedMode}
      onModeChange={theme.setMode}
      onPaletteChange={theme.setPalette}
    />
  );
  function logout(message = "") {
    try {
      sessionStorage.removeItem("fresher-session");
      localStorage.removeItem("fresher-session");
    } catch {
      /* Storage unavailable. */
    }
    setLoginError(message);
    setSession(null);
  }
  return session ? (
    <Reader
      key={session.apiUrl + session.username}
      session={session}
      logout={logout}
      themeControl={themeControl}
    />
  ) : (
    <Login
      onLogin={setSession}
      error={loginError}
      themeControl={themeControl}
    />
  );
}

function Reader({
  session,
  logout,
  themeControl,
}: {
  session: Session;
  logout: (message?: string) => void;
  themeControl: ReactNode;
}) {
  const isDemo = session.apiUrl === "demo";
  const api = useMemo(() => new FreshRSS(session), [session]);
  const [demoArticles, setDemoArticles] = useState(makeDemo);
  const [feeds, setFeeds] = useState<Feed[]>(isDemo ? demoFeeds : []);
  const [counts, setCounts] = useState<Record<string, number>>(
    isDemo ? demoCounts(demoArticles) : {},
  );
  const [stream, setStream] = useState(ALL);
  const [view, setView] = useState(
    runtimeConfig().defaultUnreadOnly ? "Unread" : "All articles",
  );
  const [unread, setUnread] = useState(runtimeConfig().defaultUnreadOnly);
  const [oldest, setOldest] = useState(
    runtimeConfig().defaultSort === "oldest",
  );
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [serverRefreshing, setServerRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const serverRefreshPending = useRef(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [mobileArticle, setMobileArticle] = useState(false);
  const [focus, setFocus] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [preferences, setPreferences] = useState(false);
  const [help, setHelp] = useState(false);
  const [marking, setMarking] = useState(false);
  const [fontSize, setFontSize] = useState(
    () =>
      Number(
        stored("fresher-font-size", String(runtimeConfig().defaultFontSize)),
      ) || runtimeConfig().defaultFontSize,
  );
  const [serif, setSerif] = useState(
    () => stored("fresher-font", runtimeConfig().defaultFont) === "serif",
  );
  const [lastSync, setLastSync] = useState<Date>();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const listRequest = useRef(0);
  const articleScroll = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = articles.find((a) => a.id === selectedId);
  const selectedFeed = feeds.find((f) => f.id === selected?.origin.streamId);
  const visible = useMemo(
    () =>
      articles.filter(
        (a) =>
          !query ||
          `${plainText(a.title)} ${a.author ?? ""} ${plainText(a.summary?.content ?? a.content?.content ?? "")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [articles, query],
  );
  const index = visible.findIndex((a) => a.id === selectedId);
  const folders = useMemo(() => {
    const result = new Map<
      string,
      { id: string; label: string; feeds: Feed[] }
    >();
    for (const feed of feeds)
      for (const cat of feed.categories?.length
        ? feed.categories
        : [{ id: "uncategorized", label: "Uncategorized" }]) {
        if (!result.has(cat.id)) result.set(cat.id, { ...cat, feeds: [] });
        result.get(cat.id)!.feeds.push(feed);
      }
    return [...result.values()];
  }, [feeds]);
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        logout(e.message);
        return;
      }
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    },
    [logout],
  );
  const failRef = useRef(fail);
  failRef.current = fail;

  useEffect(() => {
    if (isDemo) {
      setCounts(demoCounts(demoArticles));
      return;
    }
    let active = true;
    setRefreshing(true);
    Promise.all([api.subscriptions(), api.counts()])
      .then(([f, c]) => {
        if (active) {
          setFeeds(f);
          setCounts(c);
          setLastSync(new Date());
        }
      })
      .catch((e) => {
        if (active) failRef.current(e);
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [api, isDemo, reload, demoArticles]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++listRequest.current;
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setArticles([]);
    setSelectedId(null);
    setContinuation(undefined);
    if (isDemo) {
      const filtered = demoArticles.filter(
        (a) =>
          (stream === ALL ||
            a.origin.streamId === stream ||
            a.categories.includes(stream)) &&
          (!unread || !a.categories.includes(READ)),
      );
      setArticles(oldest ? [...filtered].reverse() : filtered);
      setLoading(false);
      setLastSync(new Date());
    } else {
      api
        .articles(stream, unread, oldest, undefined, controller.signal)
        .then((data) => {
          if (generation === listRequest.current) {
            setArticles(data.items);
            setContinuation(data.continuation);
            setLastSync(new Date());
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) failRef.current(e);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => {
      controller.abort();
      ++listRequest.current;
    };
    // Demo mutations update the visible list in place, just like server-backed mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, isDemo, stream, unread, oldest, reload]);

  function chooseView(id: string, title: string, onlyUnread = false) {
    setStream(id);
    setView(title);
    setUnread(onlyUnread);
    setQuery("");
    setSidebar(false);
    setMobileArticle(false);
  }
  async function refreshArticles(target = stream) {
    if (serverRefreshPending.current) return;
    serverRefreshPending.current = true;
    setServerRefreshing(true);
    setRefreshError("");
    try {
      if (!isDemo) {
        const result = await api.refresh(target);
        if (result.failed)
          setRefreshError(
            `${result.completed} feeds refreshed; ${result.failed} could not be refreshed. Check the FreshRSS logs.`,
          );
      }
      setReload((value) => value + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        failRef.current(error);
      else
        setRefreshError(
          error instanceof Error
            ? error.message
            : "Could not refresh articles on FreshRSS.",
        );
    } finally {
      serverRefreshPending.current = false;
      setServerRefreshing(false);
    }
  }
  async function loadMore() {
    if (!continuation || loadingMore) return;
    const generation = listRequest.current;
    setLoadingMore(true);
    try {
      const data = await api.articles(stream, unread, oldest, continuation);
      if (generation !== listRequest.current) return;
      setArticles((prev) => [
        ...prev,
        ...data.items.filter((a) => !prev.some((p) => p.id === a.id)),
      ]);
      setContinuation(data.continuation);
    } catch (e) {
      if (generation === listRequest.current) failRef.current(e);
    } finally {
      if (generation === listRequest.current) setLoadingMore(false);
    }
  }
  async function toggleTag(article: Article, tag: string, add: boolean) {
    if (pendingRef.current.has(article.id)) return;
    pendingRef.current.add(article.id);
    setPending(new Set(pendingRef.current));
    try {
      if (!isDemo) await api.tag([article.id], tag, add);
      const update = (items: Article[]) =>
        items.map((a) =>
          a.id === article.id
            ? {
                ...a,
                categories: add
                  ? [...new Set([...a.categories, tag])]
                  : a.categories.filter((c) => c !== tag),
              }
            : a,
        );
      setArticles(update);
      if (isDemo) setDemoArticles(update);
      else if (tag === READ) {
        const feed = feeds.find((f) => f.id === article.origin.streamId);
        const ids = [
          ALL,
          article.origin.streamId,
          ...(feed?.categories.map((c) => c.id) ?? []),
        ];
        setCounts((prev) => {
          const next = { ...prev };
          for (const id of ids)
            next[id] = Math.max(0, (next[id] ?? 0) + (add ? -1 : 1));
          return next;
        });
      }
    } catch (e) {
      failRef.current(e);
    } finally {
      pendingRef.current.delete(article.id);
      setPending(new Set(pendingRef.current));
    }
  }
  function selectArticle(article: Article) {
    // Overview results may include unread articles beyond the list’s loaded page.
    setArticles((prev) =>
      prev.some((a) => a.id === article.id) ? prev : [...prev, article],
    );
    setSelectedId(article.id);
    setMobileArticle(true);
    if (runtimeConfig().markReadOnOpen && !article.categories.includes(READ))
      void toggleTag(article, READ, true);
  }
  const selectRef = useRef(selectArticle);
  selectRef.current = selectArticle;
  useEffect(() => {
    articleScroll.current?.scrollTo({ top: 0 });
  }, [selectedId]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, select, [contenteditable], [role="dialog"]',
        ) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        preferences ||
        help
      )
        return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = e.key === "j" ? index + 1 : index - 1;
        if (visible[next]) selectRef.current(visible[next]);
      }
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      }
      if (e.key === "f") setFocus((v) => !v);
      if (e.key === "Escape") {
        setFocus(false);
        setMobileArticle(false);
        setSidebar(false);
      }
      if (e.key === "s" && selected)
        void toggleTag(
          selected,
          STARRED,
          !selected.categories.includes(STARRED),
        );
      if (e.key === "m" && selected)
        void toggleTag(selected, READ, !selected.categories.includes(READ));
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  async function markAll() {
    if (marking) return;
    setMarking(true);
    try {
      if (isDemo) {
        const updated = demoArticles.map((a) =>
          stream === ALL ||
          a.origin.streamId === stream ||
          a.categories.includes(stream)
            ? { ...a, categories: [...new Set([...a.categories, READ])] }
            : a,
        );
        setDemoArticles(updated);
      } else await api.markAllRead(stream, Date.now());
      setReload((v) => v + 1);
    } catch (e) {
      failRef.current(e);
    } finally {
      setMarking(false);
    }
  }
  async function markOverviewRead(batch: Article[]) {
    if (marking) return;
    const ids = new Set(
      batch
        .filter((article) => !article.categories.includes(READ))
        .map((article) => article.id),
    );
    if (!ids.size) return;
    setMarking(true);
    try {
      if (isDemo) {
        setDemoArticles((prev) =>
          prev.map((article) =>
            ids.has(article.id)
              ? {
                  ...article,
                  categories: [...new Set([...article.categories, READ])],
                }
              : article,
          ),
        );
      } else {
        await api.tag([...ids], READ, true);
      }
      // Restart at the first unread page: the old continuation can skip entries after a batch is read.
      setReload((value) => value + 1);
      articleScroll.current?.scrollTo({ top: 0 });
    } finally {
      setMarking(false);
    }
  }
  const body = useMemo(
    () => (selected ? articleHtml(selected) : ""),
    [selected],
  );
  const wordCount = selected
    ? plainText(
        selected.content?.content ?? selected.summary?.content ?? "",
      ).split(/\s+/).length
    : 0;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 220));
  const articleUrl = safeUrl(selected?.alternate?.[0]?.href);
  const totalUnread = counts[ALL] ?? 0;

  return (
    <div
      className={`app-shell ${sidebarHidden ? "sidebar-hidden" : ""} ${focus ? "focus-mode" : ""} ${mobileArticle ? "mobile-reading" : ""}`}
    >
      {sidebar && (
        <button
          className="sidebar-backdrop"
          onClick={() => setSidebar(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        className={`sidebar ${sidebar ? "mobile-open" : ""}`}
        aria-label="Feed navigation"
      >
        <nav className="main-nav">
          <button
            className={
              stream === ALL && !unread ? "nav-item selected" : "nav-item"
            }
            onClick={() => chooseView(ALL, "All articles")}
          >
            <Inbox size={17} />
            <span>All articles</span>
            <span className="nav-count">{totalUnread}</span>
          </button>
          <button
            className={
              stream === ALL && unread ? "nav-item selected" : "nav-item"
            }
            onClick={() => chooseView(ALL, "Unread", true)}
          >
            <BookOpen size={17} />
            <span>Unread</span>
            <span className="nav-count">{totalUnread}</span>
          </button>
          <button
            className={stream === STARRED ? "nav-item selected" : "nav-item"}
            onClick={() => chooseView(STARRED, "Starred")}
          >
            <Star size={17} />
            <span>Starred</span>
          </button>
        </nav>
        <div className="feeds-heading">
          <span>YOUR FEEDS</span>
          <IconButton
            label="Refresh feeds"
            disabled={
              !runtimeConfig().refreshEnabled ||
              serverRefreshing ||
              refreshing ||
              loading
            }
            onClick={() => refreshArticles(ALL)}
          >
            <RefreshCw
              size={14}
              className={serverRefreshing || refreshing ? "spin" : ""}
            />
          </IconButton>
        </div>
        <div className="feeds-scroll">
          {folders.map((folder) => (
            <div className="folder-group" key={folder.id}>
              <div className="folder-row">
                <button
                  className="folder-toggle"
                  aria-label={`${collapsed.has(folder.id) ? "Expand" : "Collapse"} ${folder.label}`}
                  aria-expanded={!collapsed.has(folder.id)}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(folder.id)) next.delete(folder.id);
                      else next.add(folder.id);
                      return next;
                    })
                  }
                >
                  {collapsed.has(folder.id) ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                </button>
                <button
                  className={`folder-title ${stream === folder.id ? "current" : ""}`}
                  onClick={() =>
                    folder.id !== "uncategorized" &&
                    chooseView(folder.id, folder.label)
                  }
                >
                  <Folder size={15} />
                  <span>{folder.label}</span>
                  <span className="nav-count">{counts[folder.id] || ""}</span>
                </button>
              </div>
              {!collapsed.has(folder.id) &&
                folder.feeds.map((feed) => (
                  <button
                    className={`nav-item feed-item ${stream === feed.id ? "selected" : ""}`}
                    key={feed.id}
                    onClick={() => chooseView(feed.id, plainText(feed.title))}
                  >
                    <FeedIcon feed={feed} />
                    <span>{plainText(feed.title)}</span>
                    <span className="nav-count">{counts[feed.id] || ""}</span>
                  </button>
                ))}
            </div>
          ))}
          {!loading && feeds.length === 0 && (
            <p className="empty-feeds">
              Your subscriptions will appear here. Add feeds in FreshRSS to get
              started.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-tools">
            <div>
              <IconButton
                label="Hide sidebar"
                onClick={() => {
                  setSidebarHidden(true);
                  setSidebar(false);
                }}
              >
                <PanelLeftClose size={17} />
              </IconButton>
              {themeControl}
              <IconButton
                label="Keyboard shortcuts"
                onClick={() => setHelp(true)}
              >
                <CircleHelp size={17} />
              </IconButton>
            </div>
            <IconButton
              label={isDemo ? "Leave demo and sign in" : "Sign out"}
              onClick={() => logout()}
            >
              <LogOut size={16} />
            </IconButton>
          </div>
        </div>
      </aside>
      <section className="article-list-pane" aria-label="Article list">
        <header className="list-header">
          <div className="list-heading">
            <div>
              <IconButton
                label="Show navigation"
                onClick={() => {
                  setSidebarHidden(false);
                  setSidebar(true);
                }}
              >
                <Menu size={18} />
              </IconButton>
              <h1>{view}</h1>
            </div>
            <div className="list-view-actions">
              <IconButton
                label="Show article overview"
                onClick={() => {
                  setSelectedId(null);
                  setMobileArticle(true);
                }}
              >
                <LayoutGrid size={16} />
              </IconButton>
              <IconButton
                label="Refresh articles"
                disabled={
                  !runtimeConfig().refreshEnabled || serverRefreshing || loading
                }
                onClick={() => refreshArticles()}
              >
                <RefreshCw
                  size={16}
                  className={serverRefreshing || loading ? "spin" : ""}
                />
              </IconButton>
            </div>
          </div>
          <div className="list-subtitle">
            <span>
              {serverRefreshing
                ? "Fetching new articles from feeds…"
                : loading
                  ? "Gathering your reading…"
                  : `${counts[stream] ?? (stream === ALL ? totalUnread : articles.filter((a) => !a.categories.includes(READ)).length)} unread articles`}
            </span>
            <button
              className="text-button"
              disabled={loading || marking || !articles.length}
              onClick={markAll}
            >
              {marking ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <CheckCheck size={14} />
              )}{" "}
              {marking ? "Marking read…" : "Mark all read"}
            </button>
          </div>
          <div className="search-box">
            <Search size={15} />
            <input
              ref={search}
              type="search"
              aria-label="Search loaded articles"
              placeholder="Search your reading…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>/</kbd>
          </div>
          <div className="list-filters">
            <div className="segmented">
              <button
                className={!unread ? "chosen" : ""}
                onClick={() => setUnread(false)}
              >
                All
              </button>
              <button
                className={unread ? "chosen" : ""}
                onClick={() => setUnread(true)}
              >
                Unread
              </button>
            </div>
            <button
              className="sort-button"
              onClick={() => setOldest((v) => !v)}
            >
              {oldest ? "Oldest first" : "Newest first"}
              {oldest ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            </button>
          </div>
        </header>
        {(error || refreshError) && (
          <div className="error-banner" role="alert">
            <span>{refreshError || error}</span>
            <IconButton
              label="Dismiss error"
              onClick={() => {
                setError("");
                setRefreshError("");
              }}
            >
              <X size={14} />
            </IconButton>
          </div>
        )}
        <div className="article-list" aria-busy={loading}>
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={22} />
              <p>Loading articles…</p>
            </div>
          ) : visible.length ? (
            <>
              {visible.map((article) => {
                const read = article.categories.includes(READ);
                const starred = article.categories.includes(STARRED);
                return (
                  <button
                    key={article.id}
                    className={`article-card ${selectedId === article.id ? "selected" : ""} ${read ? "is-read" : ""}`}
                    onClick={() => selectArticle(article)}
                  >
                    <div className="card-source">
                      <FeedIcon
                        feed={feeds.find(
                          (f) => f.id === article.origin.streamId,
                        )}
                      />
                      <span>{plainText(article.origin.title)}</span>
                      <time
                        dateTime={new Date(
                          article.published * 1000,
                        ).toISOString()}
                      >
                        {relativeDate(article.published)}
                      </time>
                    </div>
                    <div className="card-title">
                      <span className={`unread-dot ${read ? "read" : ""}`} />
                      <h2>{plainText(article.title) || "Untitled article"}</h2>
                    </div>
                    <p>
                      {plainText(
                        article.summary?.content ??
                          article.content?.content ??
                          "",
                      ).slice(0, 175)}
                    </p>
                    <div className="card-bottom">
                      <span>
                        {Math.max(
                          1,
                          Math.ceil(
                            plainText(
                              article.summary?.content ??
                                article.content?.content ??
                                "",
                            ).split(/\s+/).length / 220,
                          ),
                        )}{" "}
                        min read
                      </span>
                      {starred && (
                        <Star
                          size={12}
                          className="starred"
                          fill="currentColor"
                        />
                      )}
                    </div>
                  </button>
                );
              })}
              {continuation && (
                <button
                  className="button load-more"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore && <LoaderCircle size={14} className="spin" />}
                  Load more articles
                </button>
              )}
            </>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                {query ? <Search size={24} /> : <CheckCheck size={25} />}
              </span>
              <h2>
                {query
                  ? "Nothing found"
                  : unread
                    ? "No unread articles"
                    : "No articles"}
              </h2>
              <p>
                {query
                  ? "Try another search in the loaded articles."
                  : unread
                    ? "There are no unread articles in this view."
                    : "There are no articles in this view yet."}
              </p>
              {unread && !query && (
                <button className="button" onClick={() => setUnread(false)}>
                  Show all articles
                </button>
              )}
              {query && continuation && (
                <button
                  className="button"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  Search more articles
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="list-footer">
          <span>
            {query
              ? `${visible.length} matches in ${articles.length} loaded`
              : `${articles.length} articles${continuation ? " loaded" : ""}`}
          </span>
          <span>
            <kbd>J</kbd>
            <kbd>K</kbd> to navigate
          </span>
        </footer>
      </section>
      <main className="reading-pane" aria-label="Article reader">
        <header className="reader-toolbar">
          <div className="reader-breadcrumb">
            {selected && (
              <IconButton
                label="Back to overview"
                onClick={() => setSelectedId(null)}
              >
                <LayoutGrid size={17} />
              </IconButton>
            )}
            <button
              className="icon-button mobile-back"
              aria-label="Back to articles"
              onClick={() => setMobileArticle(false)}
            >
              <ArrowLeft size={18} />
            </button>
            {(sidebarHidden || focus) && (
              <IconButton
                label={focus ? "Exit focus mode" : "Show sidebar"}
                onClick={() => {
                  setFocus(false);
                  setSidebarHidden(false);
                }}
              >
                <PanelLeftOpen size={17} />
              </IconButton>
            )}
            <span>
              {selected ? plainText(selected.origin.title) : "Articles"}
            </span>
            <span
              className="reader-sync"
              title={
                lastSync
                  ? `Last synced: ${lastSync.toLocaleString()}`
                  : "Sync status"
              }
            >
              <span className="status-dot" />
              {serverRefreshing ? (
                "Refreshing articles…"
              ) : isDemo ? (
                "Demo mode"
              ) : lastSync ? (
                <span>
                  <span className="reader-sync-prefix">Synced at </span>
                  <time dateTime={lastSync.toISOString()}>
                    {lastSync.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
              ) : (
                "Connecting…"
              )}
            </span>
          </div>
          <div className="reader-actions">
            {selected && (
              <>
                <IconButton
                  label={
                    selected.categories.includes(STARRED)
                      ? "Remove star (S)"
                      : "Star article (S)"
                  }
                  active={selected.categories.includes(STARRED)}
                  disabled={pending.has(selected.id)}
                  onClick={() =>
                    toggleTag(
                      selected,
                      STARRED,
                      !selected.categories.includes(STARRED),
                    )
                  }
                >
                  <Star
                    size={17}
                    fill={
                      selected.categories.includes(STARRED)
                        ? "currentColor"
                        : "none"
                    }
                  />
                </IconButton>
                <IconButton
                  label={
                    selected.categories.includes(READ)
                      ? "Mark unread (M)"
                      : "Mark read (M)"
                  }
                  disabled={pending.has(selected.id)}
                  onClick={() =>
                    toggleTag(
                      selected,
                      READ,
                      !selected.categories.includes(READ),
                    )
                  }
                >
                  {selected.categories.includes(READ) ? (
                    <CheckCheck size={18} />
                  ) : (
                    <Check size={18} />
                  )}
                </IconButton>
                <span className="toolbar-divider" />
              </>
            )}
            <IconButton
              label="Reading appearance"
              onClick={() => setPreferences(true)}
            >
              <Type size={18} />
            </IconButton>
            <IconButton
              label={focus ? "Exit focus mode (F)" : "Focus mode (F)"}
              active={focus}
              onClick={() => setFocus((v) => !v)}
            >
              <Maximize2 size={16} />
            </IconButton>
            {articleUrl && (
              <>
                <span className="toolbar-divider" />
                <a
                  className="icon-button"
                  href={articleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open original article"
                  title="Open original article"
                >
                  <ExternalLink size={17} />
                </a>
              </>
            )}
          </div>
        </header>
        <div className="reader-scroll" ref={articleScroll}>
          {selected ? (
            <article
              className={`article-content ${serif ? "serif" : "sans"}`}
              style={
                {
                  "--article-font-size": `${fontSize}px`,
                } as React.CSSProperties
              }
            >
              <div className="article-kicker">
                <FeedIcon feed={selectedFeed} />
                <span>{plainText(selected.origin.title)}</span>
                <span className="meta-dot">·</span>
                <span>{readMinutes} MIN READ</span>
              </div>
              <h1>{plainText(selected.title) || "Untitled article"}</h1>
              <div className="article-meta">
                {selected.author && (
                  <>
                    <span className="author-avatar">
                      {plainText(selected.author).slice(0, 1)}
                    </span>
                    <span>{plainText(selected.author)}</span>
                    <span className="meta-dot">·</span>
                  </>
                )}
                <time
                  dateTime={new Date(selected.published * 1000).toISOString()}
                >
                  {new Date(selected.published * 1000).toLocaleDateString(
                    undefined,
                    { month: "long", day: "numeric", year: "numeric" },
                  )}
                </time>
              </div>
              <div className="article-rule" />
              {body ? (
                <div
                  className="prose"
                  dangerouslySetInnerHTML={{ __html: body }}
                />
              ) : (
                <div className="prose">
                  <p>
                    This feed only provides a title. Open the original article
                    to keep reading.
                  </p>
                </div>
              )}
              <div className="article-end">
                <span />
                <Leaf size={18} />
                <span />
              </div>
              <div className="article-end-actions">
                {articleUrl && (
                  <a
                    className="button"
                    href={articleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Read on the original site <ExternalLink size={14} />
                  </a>
                )}
                <button
                  className="text-button"
                  onClick={() =>
                    toggleTag(
                      selected,
                      STARRED,
                      !selected.categories.includes(STARRED),
                    )
                  }
                  disabled={pending.has(selected.id)}
                >
                  <Star size={15} />
                  {selected.categories.includes(STARRED)
                    ? "Unstar article"
                    : "Star article"}
                </button>
              </div>
            </article>
          ) : (
            <ArticleOverview
              key={stream}
              api={api}
              isDemo={isDemo}
              demoArticles={demoArticles}
              recentArticles={articles}
              listLoading={loading}
              feeds={feeds}
              stream={stream}
              reload={reload}
              marking={marking}
              onMarkRead={markOverviewRead}
              onOpen={(article) => {
                setQuery("");
                selectArticle(article);
              }}
              onShowAll={() => setUnread(false)}
              onError={fail}
            />
          )}
        </div>
      </main>
      <Modal
        open={preferences}
        onOpenChange={setPreferences}
        title="Reading appearance"
        description="Adjust font and text size."
      >
        <div className="preference-row">
          <span>
            <Palette size={16} /> Color theme
          </span>
          {themeControl}
        </div>
        <div className="preference-row">
          <span>
            <Type size={16} /> Typeface
          </span>
          <div className="segmented">
            <button
              className={serif ? "chosen" : ""}
              onClick={() => {
                setSerif(true);
                save("fresher-font", "serif");
              }}
            >
              Serif
            </button>
            <button
              className={!serif ? "chosen" : ""}
              onClick={() => {
                setSerif(false);
                save("fresher-font", "sans");
              }}
            >
              Sans
            </button>
          </div>
        </div>
        <div className="preference-row">
          <span>
            <SlidersHorizontal size={16} /> Text size
          </span>
          <div className="size-control">
            <button
              className="button"
              aria-label="Smaller text"
              disabled={fontSize <= 14}
              onClick={() => {
                setFontSize(fontSize - 1);
                save("fresher-font-size", String(fontSize - 1));
              }}
            >
              A−
            </button>
            <span>{fontSize}px</span>
            <button
              className="button"
              aria-label="Larger text"
              disabled={fontSize >= 26}
              onClick={() => {
                setFontSize(fontSize + 1);
                save("fresher-font-size", String(fontSize + 1));
              }}
            >
              A+
            </button>
          </div>
        </div>
        <p
          className={`font-preview ${serif ? "serif" : ""}`}
          style={{ fontSize }}
        >
          The quick brown fox jumps over the lazy dog.
        </p>
      </Modal>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="Keyboard shortcuts"
        description="Navigate and manage articles with the keyboard."
      >
        <div className="shortcut-list">
          {[
            ["J", "Next article"],
            ["K", "Previous article"],
            ["S", "Star or unstar article"],
            ["M", "Mark read or unread"],
            ["/", "Search loaded articles"],
            ["F", "Toggle focus mode"],
            ["Esc", "Back to list / exit focus"],
            ["?", "Show these shortcuts"],
          ].map(([key, label]) => (
            <div key={key}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
        </div>
      </Modal>
      {isDemo && (
        <div className="demo-ribbon">
          <Sparkles size={13} />
          <span>Demo mode</span>
          <button onClick={() => logout()}>
            Sign in <ArrowRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function relativeDate(timestamp: number) {
  const diff = Math.max(0, Date.now() / 1000 - timestamp);
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
