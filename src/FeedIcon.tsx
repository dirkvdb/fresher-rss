import { useState } from "react";
import { Rss } from "lucide-react";
import type { Feed } from "./api";
import { safeUrl } from "./content";

export function FeedIcon({ feed }: { feed?: Feed }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = safeUrl(feed?.iconUrl);
  return (
    <span
      className={`feed-icon feed-color-${(feed?.title.charCodeAt(0) ?? 0) % 6}`}
    >
      {url && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        feed?.title.slice(0, 1) || <Rss size={12} />
      )}
    </span>
  );
}
