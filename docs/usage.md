# Reader guide

## Reading and navigation

- The shadcn-inspired three-pane reader includes feeds, collapsible folders, an article list, and a typography-focused reading pane. Mobile uses dedicated navigation and article views.
- The overview groups the latest unread article cards by folder. Click a card to open it; the grid button returns to the overview. When caught up, recent articles appear instead.
- All, unread, and starred views display unread counts. Opening an article marks it read by default; read/unread and star changes sync to FreshRSS.
- Articles load in pages with newest/oldest sorting. Search covers title, author, and body **within loaded articles**.
- Focus mode hides surrounding panes. Serif/sans fonts and reading text size are adjustable.
- Forest, Stone, Sepia, Ocean, Rose, and Lavender each support light, dark, and system modes, with live previews and saved preferences.
- Feed HTML is sanitized, outgoing links are isolated, and fonts are hosted locally.

FreshRSS manages subscriptions, fetching, and administration. Article text comes from the feed; Fresher does not scrape full article bodies.

## Authentication and storage

Use your FreshRSS username and API password, not your regular web-login password. The API password is never stored. Only the API token is retained: session-only by default, or persistently if **Remember me** is selected. Signing out clears it. [API setup](deployment.md#freshrss-api-login).

## Article images

Covers come from feed content, lazy-loaded/responsive images, or image attachments. For missing covers, Node reads the original page's Open Graph, Twitter, and structured-data metadata. Only cards near the viewport request it; results are cached.

The browser requests the same-origin `/api/article-image` endpoint because publishers commonly block cross-origin HTML access. Node returns only the image URL; it never executes publisher scripts. The image itself loads directly from the publisher. Natural image proportions are preserved, including uniform hover zoom.

Default service limits are a 10-second network deadline, 1 MiB compressed/decompressed HTML bound, four concurrent lookups, rate limits, and a bounded cache: 24 hours for covers and 15 minutes for missing images. Requests allow only public HTTP(S) destinations on standard ports, pin validated DNS addresses, revalidate redirects, and reject private/reserved addresses for both articles and images. Cookies and FreshRSS credentials are never forwarded to publishers.

Production Node binds to loopback port 3001 and drops root privileges. Both Docker targets place it behind their web server. Static-only hosting displays feed images and can try publisher pages that allow CORS. [Deployment](deployment.md#static-hosting-and-a-separate-node-service) · [All limits and defaults](configuration.md).

## Article refresh

The sidebar refresh button updates all subscribed feeds. The article-list refresh button updates its selected feed/folder, or all feeds for All/Unread/Starred views. Both buttons show a spinner and are disabled during the operation. The reader waits for FreshRSS to finish, then reloads articles and unread counts.

FreshRSS applies its own HTTP cache and publisher retry rules, as with its native manual-refresh action. Missing setup or failures are shown explicitly; a local reload is not reported as a server refresh. [One-time master-token setup](deployment.md#server-side-article-refresh).

## Keyboard shortcuts

| Key       | Action                                         |
| --------- | ---------------------------------------------- |
| `J` / `K` | Next / previous article                        |
| `S`       | Star / unstar                                  |
| `M`       | Mark read / unread                             |
| `/`       | Search loaded articles                         |
| `F`       | Toggle focus mode                              |
| `Esc`     | Exit focus / return to the mobile article list |
| `?`       | Shortcut reference                             |
