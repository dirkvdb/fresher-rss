import { useCallback, useEffect, useRef } from "react";

function historyArticleId(state: unknown): string | null {
  return state &&
    typeof state === "object" &&
    "fresherArticle" in state &&
    typeof state.fresherArticle === "string"
    ? state.fresherArticle
    : null;
}

export function useArticleHistory(
  selectedId: string | null,
  onNavigate: (id: string | null) => void,
) {
  const selected = useRef(selectedId);
  const navigate = useRef(onNavigate);
  const returning = useRef(false);
  selected.current = selectedId;
  navigate.current = onNavigate;

  const syncHistory = useCallback(() => {
    if (returning.current) return;
    const currentId = historyArticleId(window.history.state);
    if (selected.current === currentId) return;
    if (selected.current) {
      // Keep a single article entry, even when navigating between articles.
      window.history[currentId ? "replaceState" : "pushState"](
        { ...window.history.state, fresherArticle: selected.current },
        "",
      );
    } else if (currentId) {
      // In-app navigation consumes the same entry as the browser Back button.
      returning.current = true;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    function popstate(event: PopStateEvent) {
      if (returning.current) {
        returning.current = false;
        // An article may have been opened while history.back() was pending.
        syncHistory();
        return;
      }
      navigate.current(historyArticleId(event.state));
    }
    window.addEventListener("popstate", popstate);
    return () => window.removeEventListener("popstate", popstate);
  }, [syncHistory]);

  useEffect(syncHistory, [selectedId, syncHistory]);
}
