import { EventEmitter } from "node:events";
import https from "node:https";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadImage } from "./network.mjs";
import { readConfig } from "./config.mjs";

afterEach(() => vi.restoreAllMocks());
const lookup = async () => [{ address: "1.1.1.1", family: 4 }];
const url = "https://cdn.example/cover.jpg";

function mockResponse(body, headers = {}) {
  return vi
    .spyOn(https, "request")
    .mockImplementation((_url, _options, callback) => {
      const request = new EventEmitter();
      request.end = () => {
        const response = Readable.from([body]);
        response.statusCode = 200;
        response.headers = { "content-type": "image/jpeg", ...headers };
        callback(response);
      };
      return request;
    });
}

describe("thumbnail downloading", () => {
  it("downloads bytes using pinned DNS without forwarding credentials", async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const request = mockResponse(body);
    const result = await downloadImage(url, {
      lookup,
      headers: { Authorization: "secret", Cookie: "secret" },
      publisherCookie: { origin: "https://cdn.example", value: "secret" },
    });
    expect(result.body).toEqual(body);
    expect(result.contentType).toBe("image/jpeg");
    const options = request.mock.calls[0][1];
    expect(options.headers).not.toHaveProperty("Cookie");
    expect(options.headers).not.toHaveProperty("Authorization");
    const callback = vi.fn();
    options.lookup("cdn.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "1.1.1.1", 4);
  });

  it.each(["image/svg+xml", "text/html", "application/octet-stream"])(
    "rejects unsupported content type %s",
    async (contentType) => {
      mockResponse(Buffer.from("not a raster image"), {
        "content-type": contentType,
      });
      await expect(downloadImage(url, { lookup })).rejects.toThrow(
        "Could not retrieve thumbnail",
      );
    },
  );

  it("rejects oversized transfers and decompression expansion instead of caching truncated images", async () => {
    const config = readConfig({ IMAGE_THUMBNAIL_MAX_BYTES: "128" });
    mockResponse(Buffer.alloc(129));
    await expect(downloadImage(url, { lookup, config })).rejects.toThrow();
    mockResponse(gzipSync(Buffer.alloc(1024)), { "content-encoding": "gzip" });
    await expect(downloadImage(url, { lookup, config })).rejects.toThrow(
      "too large",
    );
  });

  it("rejects private targets and revalidates redirects before fetching", async () => {
    const requestImage = vi
      .fn()
      .mockResolvedValue({
        status: 302,
        location: "http://127.0.0.1/private.jpg",
      });
    await expect(
      downloadImage("http://127.0.0.1/", { requestImage }),
    ).rejects.toMatchObject({ status: 400 });
    expect(requestImage).not.toHaveBeenCalled();
    await expect(
      downloadImage(url, { lookup, requestImage }),
    ).rejects.toMatchObject({ status: 400 });
    expect(requestImage).toHaveBeenCalledTimes(1);
  });

  it("caps redirect loops and observes cancellation", async () => {
    const requestImage = vi
      .fn()
      .mockResolvedValue({ status: 302, location: "/again.jpg" });
    await expect(downloadImage(url, { lookup, requestImage })).rejects.toThrow(
      "Too many",
    );
    expect(requestImage).toHaveBeenCalledTimes(4);
    requestImage.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadImage(url, { lookup, requestImage, signal: controller.signal }),
    ).rejects.toThrow();
    expect(requestImage).not.toHaveBeenCalled();
  });
});
