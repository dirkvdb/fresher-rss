import { DEFAULT_CONFIG } from "./config.mjs";
import { downloadPage } from "./network.mjs";

const publisherOrigin = "https://tweakers.net";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function matchesUrl(input, origin, pathname) {
  try {
    const url = new URL(input);
    return (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (pathname === undefined || url.pathname === pathname)
    );
  } catch {
    return false;
  }
}

function consentAuthId(input, page) {
  if (
    !matchesUrl(input, publisherOrigin) ||
    !matchesUrl(page.url, "https://myprivacy.dpgmedia.nl", "/consent") ||
    typeof page.html !== "string"
  )
    return null;

  // Read only the encoded literal; never evaluate the script or visit its callback.
  const callbacks = [
    ...page.html.matchAll(
      /\bconst\s+callbackUrl\s*=\s*new\s+URL\(\s*decodeURIComponent\(\s*(['"])([^'"\\\r\n]+)\1\s*\)\s*\)/g,
    ),
  ];
  if (callbacks.length !== 1) return null;
  try {
    const callback = decodeURIComponent(callbacks[0][2]);
    if (!matchesUrl(callback, publisherOrigin, "/privacy-gate/store/"))
      return null;
    const authIds = new URL(callback).searchParams.getAll("authId");
    return authIds.length === 1 && uuid.test(authIds[0]) ? authIds[0] : null;
  } catch {
    return null;
  }
}

export async function downloadArticlePage(
  input,
  {
    config = DEFAULT_CONFIG,
    signal = AbortSignal.timeout(config.imageTimeoutMs),
    download = downloadPage,
  } = {},
) {
  signal.throwIfAborted();
  const page = await download(input, { config, signal });
  signal.throwIfAborted();
  const authId = consentAuthId(input, page);
  if (!authId) return page;

  const result = await download(input, {
    config,
    signal,
    publisherCookie: { origin: publisherOrigin, value: `authId=${authId}` },
  });
  signal.throwIfAborted();
  return result;
}
