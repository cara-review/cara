import { expect, test, type Page } from "@playwright/test";
import { gotoReview, serveReview } from "../support/app.ts";

const url = serveReview();

const palette = (page: Page) => page.locator(".palette:not([hidden])");
const activeTitle = (page: Page) => page.locator(".section--active .section__title");
const navTitle = (page: Page, n: number) => page.locator(".section__title").nth(n);

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("⌘K opens the palette and Escape closes it", async ({ page }) => {
  await expect(palette(page)).toHaveCount(0);

  await page.keyboard.press("Meta+k");
  await expect(palette(page)).toBeVisible();
  await expect(page.locator(".palette__input")).toBeFocused();

  await page.locator(".palette__input").press("Escape");
  await expect(palette(page)).toHaveCount(0);
});

test("filtering then Enter runs the highlighted command", async ({ page }) => {
  await page.keyboard.press("Meta+k");
  await page.locator(".palette__input").fill("next");

  // Only "Next section" survives the filter and is the active row.
  await expect(page.locator(".palette__item")).toHaveCount(1);
  await expect(page.locator(".palette__item--active .palette__title")).toHaveText("Next section");

  const second = (await navTitle(page, 1).textContent()) ?? "";
  await page.locator(".palette__input").press("Enter");

  await expect(palette(page)).toHaveCount(0); // runs and closes
  await expect(activeTitle(page)).toHaveText(second);
});

test("a jump command focuses the chosen Section", async ({ page }) => {
  const target = (await navTitle(page, 2).textContent()) ?? "";

  await page.keyboard.press("Meta+k");
  await page.locator(".palette__input").fill(target);
  await page.locator(".palette__item--active").click();

  await expect(palette(page)).toHaveCount(0);
  await expect(activeTitle(page)).toHaveText(target);
});

test("hot-keys do not fire while typing in the palette", async ({ page }) => {
  const before = (await activeTitle(page).textContent()) ?? "";
  await page.keyboard.press("Meta+k");

  // 'd'/'j' are hot-path keys; typed into the palette they must filter, not mark/move.
  await page.locator(".palette__input").pressSequentially("dj");

  await expect(page.locator(".palette__input")).toHaveValue("dj");
  await expect(activeTitle(page)).toHaveText(before);
});
