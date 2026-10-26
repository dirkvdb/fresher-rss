import { expect, test } from "@playwright/test";
import { startDemo } from "./demo";

test("demo supports reading, stars, appearance, themes, search, and focus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await startDemo(page);
  await expect(
    page.getByRole("heading", { name: "Unread", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".overview-card")).toHaveCount(9);
  await page
    .getByRole("button", {
      name: "Open The quiet pleasure of paying attention",
      exact: true,
    })
    .click();
  await expect(page.locator(".article-content h1")).toHaveText(
    "The quiet pleasure of paying attention",
  );
  await expect(page.locator(".list-subtitle")).toContainText("8 unread");
  await page
    .getByRole("button", { name: "Star article (S)", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove star (S)", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reading appearance" }).click();
  await page.getByRole("button", { name: "Sans", exact: true }).click();
  await page.getByRole("button", { name: "Larger text" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".article-content")).toHaveClass(/sans/);
  await page.keyboard.press("f");
  await expect(page.locator(".article-list-pane")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(".article-list-pane")).toBeVisible();
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Close theme picker" }).click();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(page.locator(".article-card")).toHaveCount(3);
  await page
    .getByRole("searchbox", { name: "Search loaded articles" })
    .fill("quiet pleasure");
  await expect(page.locator(".article-card")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("mobile reader has working navigation and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await startDemo(page);
  await page.getByRole("button", { name: "Show article overview" }).click();
  await expect(
    page.getByRole("region", { name: "Article overview", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.locator(".overview-card").first().click();
  await expect(page.locator(".article-content")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "Back to articles" }).click();
  await expect(page.locator(".article-list-pane")).toBeVisible();
  await page.getByRole("button", { name: "Show navigation" }).click();
  await expect(
    page.getByRole("complementary", { name: "Feed navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Starred", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".article-card")).toHaveCount(2);
});

for (const mode of ["desktop", "mobile", "focus"] as const) {
  test(`overview mark-as-read stays in the toolbar while scrolling in ${mode} mode`, async ({
    page,
  }) => {
    const width = mode === "mobile" ? 320 : 1440;
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    await startDemo(page);
    if (mode === "mobile")
      await page.getByRole("button", { name: "Show article overview" }).click();
    if (mode === "focus") await page.keyboard.press("f");

    const markRead = page.locator(".reader-toolbar").getByRole("button", {
      name: "Mark as read",
      exact: true,
    });
    await expect(markRead).toBeEnabled();
    await expect(markRead).toBeInViewport({ ratio: 1 });
    const initialPosition = await markRead.boundingBox();
    await page.locator(".reader-scroll").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() =>
        page.locator(".reader-scroll").evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(0);
    await expect(markRead).toBeInViewport({ ratio: 1 });
    expect(await markRead.boundingBox()).toEqual(initialPosition);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);

    await markRead.click();
    await expect(page.locator(".overview-card")).toHaveCount(0);
    await expect(markRead).toBeDisabled();
  });
}

test("API login, pagination, and mutations use FreshRSS endpoints", async ({
  page,
}) => {
  const requests: { path: string; body: string }[] = [];
  let metadataRequests = 0;
  const article = {
    id: "tag:google.com,2005:reader/item/1234567890abcdef",
    title: "An actual API article",
    published: 1750000000,
    categories: [],
    origin: { streamId: "feed/1", title: "Test feed" },
    summary: {
      content:
        '<p>Hello from FreshRSS.</p><script>throw Error("unsafe")</script>',
    },
    alternate: [{ href: "https://example.com/article" }],
  };
  await page.route("**/api/article-image?*", (route) => {
    metadataRequests++;
    expect(route.request().headers().authorization).toBeUndefined();
    expect(new URL(route.request().url()).searchParams.get("url")).toBe(
      "https://example.com/article",
    );
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ image: "https://example.com/cover.jpg" }),
    });
  });
  await page.route("https://example.com/cover.jpg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 600"><rect width="300" height="600" fill="#658673"/></svg>',
    }),
  );
  await page.route("**/api/greader.php/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ path: url.pathname, body: request.postData() ?? "" });
    let body: unknown = {};
    if (url.pathname.endsWith("ClientLogin")) body = "Auth=reader/token\n";
    else {
      expect(request.headers().authorization).toBe(
        "GoogleLogin auth=reader/token",
      );
      if (url.pathname.endsWith("subscription/list"))
        body = {
          subscriptions: [
            {
              id: "feed/1",
              title: "Test feed",
              categories: [{ id: "user/-/label/Test", label: "Test" }],
            },
          ],
        };
      else if (url.pathname.endsWith("unread-count"))
        body = {
          unreadcounts: [
            { id: "user/-/state/com.google/reading-list", count: 2 },
            { id: "feed/1", count: 2 },
          ],
        };
      else if (url.pathname.endsWith("/token")) body = "write-token";
      else if (url.pathname.endsWith("/edit-tag")) body = "OK";
      else if (url.pathname.includes("/stream/contents/"))
        body =
          url.searchParams.get("xt") === "user/-/state/com.google/read"
            ? { items: [article] }
            : url.searchParams.has("c")
              ? {
                  items: [{ ...article, id: "second", title: "The next page" }],
                }
              : {
                  items: [
                    {
                      ...article,
                      id: "read-article",
                      title: "A recently read article",
                      categories: ["user/-/state/com.google/read"],
                    },
                  ],
                  continuation: "1750000000000000",
                };
    }
    await route.fulfill({
      status: 200,
      contentType: typeof body === "string" ? "text/plain" : "application/json",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("FreshRSS instance URL")
    .fill("https://rss.example.com");
  await page.getByLabel("Username", { exact: true }).fill("reader");
  await page.getByLabel("API password", { exact: true }).fill("api-secret");
  await page.getByRole("button", { name: "Connect to FreshRSS" }).click();
  await expect(page.locator(".overview-card")).toHaveCount(1);
  await expect(page.locator(".overview-card-media img")).toHaveAttribute(
    "src",
    "https://example.com/cover.jpg",
  );
  const photo = page.locator(".overview-card-media img");
  await expect
    .poll(() =>
      photo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await photo.hover();
  const dimensions = await photo.evaluate((image) => {
    const img = image as HTMLImageElement;
    const media = img.parentElement!;
    return {
      mediaRatio: media.offsetWidth / media.offsetHeight,
      imageWidth: img.offsetWidth,
      imageHeight: img.offsetHeight,
      mediaWidth: media.clientWidth,
      mediaHeight: media.clientHeight,
      fit: getComputedStyle(img).objectFit,
      overflow: getComputedStyle(media).overflow,
    };
  });
  expect(dimensions.mediaRatio).toBeCloseTo(1.9, 1);
  expect(dimensions.imageWidth).toBe(dimensions.mediaWidth);
  expect(dimensions.imageHeight).toBe(dimensions.mediaHeight);
  expect(dimensions.fit).toBe("contain");
  expect(dimensions.overflow).toBe("hidden");
  expect(requests.filter((r) => r.path.endsWith("edit-tag"))).toHaveLength(0);
  await page.getByRole("button", { name: /^All articles/ }).click();
  await page.getByRole("button", { name: "Load more articles" }).click();
  await expect(page.locator(".article-card")).toHaveCount(2);
  let contentRequests = 0;
  let releaseContent!: () => void;
  const contentReady = new Promise<void>((resolve) => {
    releaseContent = resolve;
  });
  await page.route("**/api/article-content?*", async (route) => {
    contentRequests++;
    expect(new URL(route.request().url()).searchParams.get("url")).toBe(
      article.alternate[0].href,
    );
    expect(route.request().headers().authorization).toBeUndefined();
    await contentReady;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        content:
          '<p>Full original article in a calm reader.</p><script>throw Error("unsafe")</script>',
        title: "Publisher title",
        byline: null,
        url: article.alternate[0].href,
      }),
    });
  });
  await page
    .getByRole("button", { name: "Open An actual API article", exact: true })
    .click();
  await expect(page.locator(".article-content h1")).toHaveText(
    "An actual API article",
  );
  await expect(page.locator(".article-card")).toHaveCount(3);
  await expect(page.getByRole("status")).toContainText(
    "Loading original article",
  );
  await expect(page.locator(".prose")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Read original", exact: true }),
  ).toHaveCount(0);
  releaseContent();
  const externalLink = page.getByRole("link", {
    name: "Open original article",
    exact: true,
  });
  const articleUrl = await externalLink.getAttribute("href");
  expect(articleUrl).toBeTruthy();
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(page.locator(".prose")).toHaveText(
    "Full original article in a calm reader.",
  );
  await expect(page.locator(".prose script, iframe")).toHaveCount(0);
  expect(contentRequests).toBe(1);
  await expect(externalLink).toBeVisible();
  await expect(externalLink).toHaveAttribute("target", "_blank");
  expect(page.context().pages()).toHaveLength(1);

  await page.route("**/api/article-content?*", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Could not extract readable article content.",
      }),
    }),
  );
  await page.locator(".article-card").nth(1).click();
  await expect(page.getByRole("alert")).toContainText(
    "Showing feed content instead",
  );
  await expect(page.locator(".prose")).toHaveText("Hello from FreshRSS.");
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(page.locator(".article-content")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to article", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mark unread (M)", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Star article (S)", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove star (S)", exact: true }),
  ).toBeVisible();
  const writes = requests
    .filter((r) => r.path.endsWith("edit-tag"))
    .map((r) => new URLSearchParams(r.body));
  expect(
    writes.some((w) => w.get("a") === "user/-/state/com.google/read"),
  ).toBe(true);
  expect(
    writes.some(
      (w) =>
        w.get("a") === "user/-/state/com.google/starred" &&
        w.get("T") === "write-token",
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("api-secret");
  expect(metadataRequests).toBe(1);
});

test("overview marks only displayed tiles read and loads the next unread batch", async ({
  page,
}) => {
  const read = "user/-/state/com.google/read";
  const stories = Array.from({ length: 5 }, (_, index) => ({
    id: `story-${index}`,
    title: `Batch story ${index}`,
    published: 1750000000 - index,
    categories: [] as string[],
    origin: { streamId: "feed/1", title: "Test feed" },
    summary: { content: "<p>A batch article.</p>" },
  }));
  const batches: string[][] = [];
  let failNextWrite = true;
  let releaseWrite: () => void;
  const writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.FRESHER_CONFIG = { pageSize: 2 };",
    }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "fresher-session",
      JSON.stringify({
        apiUrl: "https://fixture.invalid/api/greader.php",
        username: "reader",
        token: "reader/token",
      }),
    );
  });
  await page.route("https://fixture.invalid/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith("/subscription/list")) {
      body = {
        subscriptions: [{ id: "feed/1", title: "Test feed", categories: [] }],
      };
    } else if (url.pathname.endsWith("/unread-count")) {
      const count = stories.filter(
        (story) => !story.categories.includes(read),
      ).length;
      body = {
        unreadcounts: [
          { id: "user/-/state/com.google/reading-list", count },
          { id: "feed/1", count },
        ],
      };
    } else if (url.pathname.endsWith("/token")) {
      body = "write-token";
    } else if (url.pathname.endsWith("/edit-tag")) {
      const params = new URLSearchParams(route.request().postData() ?? "");
      expect(params.get("a")).toBe(read);
      expect(params.get("T")).toBe("write-token");
      const ids = params.getAll("i");
      batches.push(ids);
      if (failNextWrite) {
        failNextWrite = false;
        await route.fulfill({
          status: 500,
          body: "Could not save this batch.",
        });
        return;
      }
      await writeGate;
      for (const story of stories)
        if (ids.includes(story.id)) story.categories.push(read);
      body = "OK";
    } else {
      expect(url.pathname).toContain("/stream/contents/");
      const available = stories.filter(
        (story) =>
          !url.searchParams.has("xt") || !story.categories.includes(read),
      );
      const start = Number(url.searchParams.get("c") ?? 0);
      const size = Number(url.searchParams.get("n"));
      body = {
        items: available.slice(start, start + size),
        ...(start + size < available.length
          ? { continuation: String(start + size) }
          : {}),
      };
    }
    await route.fulfill({
      contentType: typeof body === "string" ? "text/plain" : "application/json",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^All articles/ }).click();
  const overview = page.getByRole("region", {
    name: "Article overview",
    exact: true,
  });
  const cards = overview.locator(".overview-card");
  const markRead = page.locator(".reader-toolbar").getByRole("button", {
    name: "Mark as read",
    exact: true,
  });
  await expect(cards).toHaveCount(2);
  await markRead.click();
  await expect(overview.getByRole("alert")).toBeVisible();
  await expect(cards).toHaveCount(2);
  expect(stories.every((story) => !story.categories.includes(read))).toBe(true);

  await markRead.click();
  await expect(
    page.getByRole("button", { name: "Marking as read…", exact: true }),
  ).toBeDisabled();
  await expect(cards).toHaveCount(2);
  releaseWrite!();
  await expect(
    overview.getByRole("button", { name: "Open Batch story 2", exact: true }),
  ).toBeVisible();
  await expect(cards).toHaveCount(2);
  await expect(
    overview.getByRole("button", { name: "Open Batch story 0", exact: true }),
  ).toHaveCount(0);
  expect(batches).toEqual([
    ["story-0", "story-1"],
    ["story-0", "story-1"],
  ]);
  expect(
    stories.filter((story) => !story.categories.includes(read)),
  ).toHaveLength(3);
  await expect(page.locator(".list-subtitle")).toContainText("3 unread");

  await overview
    .getByRole("button", { name: "Load more articles", exact: true })
    .click();
  await expect(cards).toHaveCount(3);
  await markRead.click();
  await expect(cards).toHaveCount(0);
  await expect(
    overview.getByRole("heading", { name: "No unread articles", exact: true }),
  ).toBeVisible();
  await expect(markRead).toBeDisabled();
  expect(batches[2]).toEqual(["story-2", "story-3", "story-4"]);
  expect(stories.every((story) => story.categories.includes(read))).toBe(true);
  await expect(page.locator(".list-subtitle")).toContainText("0 unread");
  await overview
    .getByRole("button", { name: "Browse all articles", exact: true })
    .click();
  await expect(cards).toHaveCount(2);
  await expect(markRead).toBeDisabled();
});

test("demo overview batch reading respects the selected folder", async ({
  page,
}) => {
  await page.goto("/");
  await startDemo(page);
  await page.getByRole("button", { name: /^Technology/ }).click();
  const overview = page.getByRole("region", {
    name: "Article overview",
    exact: true,
  });
  await expect(overview.locator(".overview-card")).toHaveCount(3);
  await page
    .locator(".reader-toolbar")
    .getByRole("button", { name: "Mark as read", exact: true })
    .click();
  await expect(overview.locator(".overview-card")).toHaveCount(0);
  await expect(
    overview.getByRole("heading", { name: "No unread articles", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("complementary", { name: "Feed navigation" })
    .getByRole("button", { name: /^Unread/ })
    .click();
  await expect(overview.locator(".overview-card")).toHaveCount(6);
  await expect(page.locator(".list-subtitle")).toContainText("6 unread");
});

test("Node image service rejects local URLs and non-web schemes", async ({
  request,
}) => {
  for (const url of [
    "http://127.0.0.1/",
    "http://[::1]/",
    "file:///etc/passwd",
    "https://example.com:8080/",
  ]) {
    const response = await request.get("/api/article-image", {
      params: { url },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).image).toBeNull();
  }
});

test("Refresh fetches new articles on FreshRSS before reloading the reader", async ({
  page,
}) => {
  let revision = 0;
  let articleRequests = 0;
  let refreshCalls = 0;
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const story = {
    id: "old",
    title: "Existing article",
    published: 1750000000,
    categories: [],
    origin: { streamId: "feed/1", title: "Test feed" },
    summary: { content: "<p>A feed article.</p>" },
  };
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "fresher-session",
      JSON.stringify({
        apiUrl: "https://fixture.invalid/api/greader.php",
        username: "reader",
        token: "reader/token",
      }),
    ),
  );
  await page.route("https://fixture.invalid/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path.endsWith("/subscription/list"))
      body = {
        subscriptions: [{ id: "feed/1", title: "Test feed", categories: [] }],
      };
    else if (path.endsWith("/unread-count"))
      body = {
        unreadcounts: [
          { id: "user/-/state/com.google/reading-list", count: revision + 1 },
        ],
      };
    else {
      articleRequests++;
      body = {
        items: revision
          ? [story, { ...story, id: "new", title: "Newly fetched article" }]
          : [story],
      };
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.route("**/api/refresh", async (route) => {
    refreshCalls++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers().authorization).toBe(
      "GoogleLogin auth=reader/token",
    );
    expect(route.request().postDataJSON()).toEqual({
      stream: "user/-/state/com.google/reading-list",
    });
    if (refreshCalls === 1) {
      await gate;
      revision++;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ completed: 1, failed: 0, total: 1 }),
      });
    } else
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Refresh token is not configured." }),
      });
  });
  await page.goto("/");
  await expect(page.locator(".article-card")).toHaveCount(1);
  await expect(page.locator(".overview-card")).toHaveCount(1);
  const initialRequests = articleRequests;
  await page
    .getByRole("button", { name: "Refresh articles", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Refresh articles", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".list-subtitle")).toContainText(
    "Fetching new articles",
  );
  expect(articleRequests).toBe(initialRequests);
  release!();
  await expect(page.locator(".article-card")).toHaveCount(2);
  await expect(page.locator(".overview-card")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Refresh articles", exact: true }),
  ).toBeEnabled();
  const beforeFailure = articleRequests;
  await page
    .getByRole("button", { name: "Refresh articles", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Refresh token is not configured",
  );
  expect(articleRequests).toBe(beforeFailure);
  await expect(
    page.getByRole("button", { name: "Refresh articles", exact: true }),
  ).toBeEnabled();
});

test("overview refreshes unread cards and keeps recent stories after marking all read", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await startDemo(page);
  await expect(page.locator(".overview-card")).toHaveCount(9);
  await page.locator(".overview-card").first().click();
  await page
    .getByRole("button", { name: "Back to overview", exact: true })
    .click();
  await expect(page.locator(".overview-card")).toHaveCount(8);
  await expect(
    page.getByRole("button", {
      name: "Open The quiet pleasure of paying attention",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mark all read", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No unread articles", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show all articles", exact: true })
    .click();
  await expect(
    page.getByText("No unread articles. Showing recent articles.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".overview-card")).toHaveCount(12);
  await page.locator(".overview-card").first().click();
  await expect(page.locator(".article-content h1")).toBeVisible();
});
