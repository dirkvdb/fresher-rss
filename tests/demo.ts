import type { Page } from "@playwright/test";

export async function startDemo(page: Page) {
  await page.evaluate(() => {
    sessionStorage.setItem(
      "fresher-session",
      JSON.stringify({ apiUrl: "demo", username: "Alex", token: "" }),
    );
  });
  await page.reload();
}
