import { expect, test } from "@playwright/test";

test("demo supports reading, stars, appearance, themes, search, and focus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await expect(
    page.getByRole("heading", { name: "All articles", exact: true }),
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
  await page.getByRole("button", { name: "Explore the demo" }).click();
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
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect width="600" height="300" fill="#658673"/></svg>',
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
    const rect = img.getBoundingClientRect();
    return {
      rendered: rect.width / rect.height,
      original: img.naturalWidth / img.naturalHeight,
    };
  });
  expect(dimensions.rendered).toBeCloseTo(dimensions.original, 2);
  expect(requests.filter((r) => r.path.endsWith("edit-tag"))).toHaveLength(0);
  await page.getByRole("button", { name: "Load more articles" }).click();
  await expect(page.locator(".article-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Open An actual API article", exact: true })
    .click();
  await expect(page.locator(".article-content h1")).toHaveText(
    "An actual API article",
  );
  await expect(page.locator(".article-card")).toHaveCount(3);
  await expect(page.locator(".prose")).toHaveText("Hello from FreshRSS.");
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
  await page.getByRole("button", { name: "Explore the demo" }).click();
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
    page.getByText("No unread articles. Showing recent articles.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".overview-card")).toHaveCount(12);
  await page.locator(".overview-card").first().click();
  await expect(page.locator(".article-content h1")).toBeVisible();
});
