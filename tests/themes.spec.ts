import { expect, test } from "@playwright/test";
import { startDemo } from "./demo";

test("all palettes support light/dark, persist, and apply to the reader", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Theme:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Appearance" });
  const accents = new Set<string>();
  for (const mode of ["Light", "Dark"]) {
    await dialog.getByRole("radio", { name: mode, exact: true }).check();
    for (const palette of [
      "Forest",
      "Stone",
      "Sepia",
      "Ocean",
      "Rose",
      "Lavender",
    ]) {
      await dialog.getByRole("radio", { name: palette, exact: true }).check();
      await expect(page.locator("html")).toHaveAttribute(
        "data-palette",
        palette.toLowerCase(),
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        mode.toLowerCase(),
      );
      accents.add(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--green")
            .trim(),
        ),
      );
    }
  }
  expect(accents.size).toBe(12);
  await page.getByRole("button", { name: "Close theme picker" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-palette",
    "lavender",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await startDemo(page);
  await expect(page.locator(".article-overview")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Theme: Lavender, dark/ }),
  ).toBeVisible();
  await page.locator(".overview-card").first().click();
  await page.getByRole("button", { name: "Reading appearance" }).click();
  await page
    .getByRole("dialog", { name: "Reading appearance" })
    .getByRole("button", { name: /^Theme:/ })
    .click();
  await page.getByRole("radio", { name: "Sepia", exact: true }).check();
  await page.getByRole("button", { name: "Close theme picker" }).click();
  await expect(
    page.getByRole("dialog", { name: "Reading appearance" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "sepia");
});

test("system mode follows the OS while explicit modes keep their palette", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await page.getByRole("radio", { name: "Ocean", exact: true }).check();
  await page.getByRole("radio", { name: "System", exact: true }).check();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
});

test("mobile theme picker is keyboard accessible and fits the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await page.getByRole("radio", { name: "Ocean", exact: true }).check();
  await page.getByRole("radio", { name: "Ocean", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Rose", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "rose");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Theme:/ })).toBeFocused();
});
