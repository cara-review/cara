import { expect, test, type Page } from "@playwright/test";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";

// Diff-surface toolbar toggles: split/unified (#16) and show-all-diffs (#28).
// Monaco marks the side-by-side layout with a `.side-by-side` class on its root.

const url = serveReview();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
  await selectSection(page, "src/alpha.ts");
});

const splitToggle = (page: Page) => page.locator(".diff-toolbar__toggle", { hasText: "Side by side" });
const allToggle = (page: Page) => page.locator(".diff-toolbar__toggle", { hasText: "All file changes" });
const editor = (page: Page) => page.locator("section.file .monaco-diff-editor").first();

test("default is unified; the Side by side toggle flips Monaco to side-by-side", async ({ page }) => {
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).not.toHaveClass(/side-by-side/);
  await expect(splitToggle(page)).toHaveAttribute("aria-pressed", "false");

  await splitToggle(page).click();
  await expect(editor(page)).toHaveClass(/side-by-side/);
  await expect(splitToggle(page)).toHaveAttribute("aria-pressed", "true");
});

test("the v key toggles side-by-side", async ({ page }) => {
  await page.keyboard.press("v");
  await expect(editor(page)).toHaveClass(/side-by-side/);
  await expect(splitToggle(page)).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("v");
  await expect(editor(page)).not.toHaveClass(/side-by-side/);
});

test("the All file changes toggle flips aria-pressed", async ({ page }) => {
  await expect(allToggle(page)).toHaveAttribute("aria-pressed", "false");
  await allToggle(page).click();
  await expect(allToggle(page)).toHaveAttribute("aria-pressed", "true");
});

test("both toggles persist across a reload (localStorage)", async ({ page }) => {
  await splitToggle(page).click();
  await allToggle(page).click();
  await expect(splitToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(allToggle(page)).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await page.locator(".nav__tree .section").first().waitFor();
  await selectSection(page, "src/alpha.ts");

  await expect(splitToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(allToggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toHaveClass(/side-by-side/);
});
