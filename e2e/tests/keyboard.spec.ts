import { expect, test, type Page } from "@playwright/test";
import { gotoReview, serveReview } from "../support/app.ts";

const url = serveReview();

const activeTitle = (page: Page) => page.locator(".section--active .section__title");
const navTitle = (page: Page, n: number) => page.locator(".section__title").nth(n);

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("j / k move the active Section with a visible highlight", async ({ page }) => {
  await expect(activeTitle(page)).toHaveText(await navTitle(page, 0).textContent() ?? "");

  await page.keyboard.press("j");
  await expect(activeTitle(page)).toHaveText(await navTitle(page, 1).textContent() ?? "");

  await page.keyboard.press("k");
  await expect(activeTitle(page)).toHaveText(await navTitle(page, 0).textContent() ?? "");
});

test("arrow keys move the active Section too", async ({ page }) => {
  await page.keyboard.press("ArrowDown");
  await expect(activeTitle(page)).toHaveText(await navTitle(page, 1).textContent() ?? "");

  await page.keyboard.press("ArrowUp");
  await expect(activeTitle(page)).toHaveText(await navTitle(page, 0).textContent() ?? "");
});

test("D from the keyboard marks the active Section", async ({ page }) => {
  const first = (await navTitle(page, 0).textContent()) ?? "";
  await page.keyboard.press("d");
  await expect(page.locator(".section", { hasText: first }).locator(".glyph")).toHaveClass(
    /glyph--done/,
  );
});

// A focusable input stands in for the comment composer (built later): the document
// listener must yield to typing so a keystroke lands in the field, not on the review.
async function addFocusedInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "probe";
    document.body.append(input);
    input.focus();
  });
}

test("navigation hot-keys are suppressed while a text input is focused", async ({ page }) => {
  const before = (await activeTitle(page).textContent()) ?? "";
  await addFocusedInput(page);
  await page.locator("#probe").press("j");

  await expect(page.locator("#probe")).toHaveValue("j");
  await expect(activeTitle(page)).toHaveText(before);
});

test("destructive hot-keys do not fire while a text input is focused", async ({ page }) => {
  // The dangerous keys: 'd'/'s' mark/skip a Section. Typed into a field they must do
  // neither — a guard that only whitelisted nav keys would silently mark on "done".
  await addFocusedInput(page);
  await page.locator("#probe").press("d");
  await page.locator("#probe").press("s");

  await expect(page.locator("#probe")).toHaveValue("ds");
  await expect(page.locator(".glyph--done")).toHaveCount(0);
  await expect(page.locator(".glyph--skipped")).toHaveCount(0);
});
