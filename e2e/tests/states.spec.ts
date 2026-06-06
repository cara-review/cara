import { expect, test } from "@playwright/test";
import { gotoReview, sectionRow, serveReview } from "../support/app.ts";

const url = serveReview();

test("reaching all-done enables Go and zeroes the remaining count", async ({ page }) => {
  await gotoReview(page, url());

  // Mark each Section done in turn; D auto-advances to the next unreviewed one.
  for (let i = 0; i < 4; i += 1) {
    const active = (await page.locator(".section--active .section__title").textContent()) ?? "";
    await page.keyboard.press("d");
    await expect(sectionRow(page, active).locator(".glyph")).toHaveClass(/glyph--done/);
  }

  await expect(page.locator(".go")).toHaveClass(/go--ready/);
  await expect(page.locator(".go")).toHaveText("Go");
  await expect(page.locator(".progress__label")).toHaveText("0 of 5 changes left");
});

test.describe("light appearance", () => {
  test.use({ colorScheme: "light" });
  test("renders on a light background", async ({ page }) => {
    await gotoReview(page, url());
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe("rgb(255, 255, 255)");
  });
});

test.describe("dark appearance", () => {
  test.use({ colorScheme: "dark" });
  test("renders on a dark background", async ({ page }) => {
    await gotoReview(page, url());
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe("rgb(10, 10, 10)");
  });
});
