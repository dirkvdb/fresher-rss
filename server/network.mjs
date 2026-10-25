import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import ipaddr from "ipaddr.js";
import { DEFAULT_CONFIG } from "./config.mjs";

export class ImageError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
export function webUrl(
  value,
  base,
  allowedPorts = DEFAULT_CONFIG.imageAllowedPorts,
) {
  try {
    const url = new URL(value, base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !allowedPorts.includes(
        Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      )
    )
      return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}
export function publicAddress(value) {
  try {
    return ipaddr.process(value).range() === "unicast";
  } catch {
    return false;
  }
}

export async function resolvePublicTarget(
  input,
  {
    config = DEFAULT_CONFIG,
    signal = AbortSignal.timeout(config.imageDnsTimeoutMs),
    lookup = dnsLookup,
  } = {},
) {
  signal = AbortSignal.any([
    signal,
    AbortSignal.timeout(config.imageDnsTimeoutMs),
  ]);
  signal.throwIfAborted();
  const url = webUrl(input, undefined, config.imageAllowedPorts);
  if (!url)
    throw new ImageError(
      "Only public HTTP(S) article URLs on standard ports are supported.",
      400,
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  if (ipaddr.isValid(hostname))
    addresses = [
      {
        address: hostname,
        family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6,
      },
    ];
  else {
    let abort;
    try {
      addresses = await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise((_, reject) => {
          abort = () => reject(signal.reason);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }),
      ]);
    } finally {
      if (abort) signal.removeEventListener("abort", abort);
    }
  }
  // Reject mixed public/private DNS answers, then pin the socket to a checked address.
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new ImageError(
      "Private and reserved network targets are not allowed.",
      400,
    );
  const address = ipaddr.process(addresses[0].address);
  return {
    url,
    hostname,
    address: address.toString(),
    family: address.kind() === "ipv4" ? 4 : 6,
  };
}

async function readResponse(
  target,
  signal,
  config = DEFAULT_CONFIG,
  publisherCookie,
  binary = false,
) {
  const response = await new Promise((resolve, reject) => {
    const request = (target.url.protocol === "https:" ? https : http).request(
      target.url,
      {
        method: "GET",
        agent: false,
        signal,
        headers: {
          "User-Agent": config.imageUserAgent,
          Accept: binary
            ? "image/avif,image/webp,image/*"
            : "text/html,application/xhtml+xml",
          "Accept-Encoding": "gzip, deflate, br",
          ...(publisherCookie?.origin === target.url.origin
            ? { Cookie: publisherCookie.value }
            : {}),
        },
        // No second DNS lookup, including IPv4-mapped IPv6 and redirect destinations.
        lookup: (_hostname, options, callback) => {
          if (options.all)
            callback(null, [
              { address: target.address, family: target.family },
            ]);
          else callback(null, target.address, target.family);
        },
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  });
  const status = response.statusCode ?? 502;
  if ([301, 302, 303, 307, 308].includes(status)) {
    const location = response.headers.location;
    response.destroy();
    return { location, status };
  }
  const contentType = String(response.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const maxBytes = binary
    ? config.imageThumbnailMaxBytes
    : config.imageMaxHtmlBytes;
  if (
    status !== 200 ||
    (binary
      ? ![
          "image/jpeg",
          "image/png",
          "image/gif",
          "image/webp",
          "image/avif",
          "image/x-icon",
        ].includes(contentType)
      : !contentType.includes("html"))
  ) {
    response.destroy();
    return { html: null, status };
  }
  const encoding = String(
    response.headers["content-encoding"] ?? "",
  ).toLowerCase();
  const decoder =
    encoding === "gzip"
      ? createGunzip()
      : encoding === "br"
        ? createBrotliDecompress()
        : encoding === "deflate"
          ? createInflate()
          : null;
  if (encoding && encoding !== "identity" && !decoder) {
    response.destroy();
    throw new ImageError("Unsupported publisher encoding.");
  }
  let transferred = 0;
  response.on("data", (chunk) => {
    transferred += chunk.length;
    if (transferred > maxBytes)
      response.destroy(new ImageError("Publisher response too large."));
  });
  if (decoder) response.on("error", (error) => decoder.destroy(error));
  const stream = decoder ? response.pipe(decoder) : response;
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      if (binary && size + chunk.length > maxBytes)
        throw new ImageError("Thumbnail response too large.");
      const bounded = chunk.subarray(0, maxBytes - size);
      chunks.push(bounded);
      size += bounded.length;
      if (size >= maxBytes && !binary) break;
    }
    if (binary) return { body: Buffer.concat(chunks), contentType, status };
    return { html: Buffer.concat(chunks).toString("utf8"), status };
  } finally {
    decoder?.destroy();
    response.destroy();
  }
}

/** Downloads raster images with the same DNS pinning and redirect checks as HTML. */
export async function downloadImage(
  input,
  {
    config = DEFAULT_CONFIG,
    signal = AbortSignal.timeout(config.imageTimeoutMs),
    lookup = dnsLookup,
    requestImage = (target, signal, config) =>
      readResponse(target, signal, config, undefined, true),
  } = {},
) {
  let url = input;
  for (let redirects = 0; redirects <= config.imageMaxRedirects; redirects++) {
    signal.throwIfAborted();
    const target = await resolvePublicTarget(url, { signal, lookup, config });
    const response = await requestImage(target, signal, config);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next =
        response.location &&
        webUrl(response.location, target.url, config.imageAllowedPorts);
      if (!next) throw new ImageError("Invalid thumbnail redirect.");
      url = next.href;
      continue;
    }
    if (response.status !== 200 || !response.body?.length)
      throw new ImageError("Could not retrieve thumbnail.");
    return response;
  }
  throw new ImageError("Too many thumbnail redirects.");
}

export async function downloadPage(
  input,
  {
    config = DEFAULT_CONFIG,
    signal = AbortSignal.timeout(config.imageTimeoutMs),
    lookup = dnsLookup,
    requestPage = readResponse,
    publisherCookie,
  } = {},
) {
  let url = input;
  for (let redirects = 0; redirects <= config.imageMaxRedirects; redirects++) {
    signal.throwIfAborted();
    const target = await resolvePublicTarget(url, { signal, lookup, config });
    const response = await requestPage(
      target,
      signal,
      config,
      publisherCookie?.origin === target.url.origin
        ? publisherCookie
        : undefined,
    );
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next =
        response.location &&
        webUrl(response.location, target.url, config.imageAllowedPorts);
      if (!next) throw new ImageError("Invalid publisher redirect.");
      url = next.href;
      continue;
    }
    return { html: response.html, url: target.url.href };
  }
  throw new ImageError("Too many publisher redirects.");
}
