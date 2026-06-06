import { expect, test } from "@playwright/test";
import { gotoReview, sectionRow, selectSection, serveReview } from "../support/app.ts";

const url = serveReview();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("block ticks complete a Section and auto-advance", async ({ page }) => {
  await selectSection(page, "src/alpha.ts");

  // Tick the first of two blocks: it dims, the Section reads partly reviewed, no advance.
  await page.locator(".tick").first().click();
  await expect(page.locator(".tick--on")).toHaveCount(1);
  await expect(page.locator(".block--reviewed")).toHaveCount(1);
  await expect(page.locator(".diff__count")).toHaveText("1/2 reviewed");
  await expect(page.locator(".diff__title")).toHaveText("src/alpha.ts");

  // Tick the second: the Section completes (glyph done) and focus auto-advances away.
  await page.locator(".tick").nth(1).click();
  await expect(sectionRow(page, "src/alpha.ts").locator(".glyph")).toHaveClass(/glyph--done/);
  await expect(page.locator(".diff__title")).not.toHaveText("src/alpha.ts");
});

test("D marks the whole Section done", async ({ page }) => {
  await selectSection(page, "src/gamma.ts");
  await page.keyboard.press("d");
  await expect(sectionRow(page, "src/gamma.ts").locator(".glyph")).toHaveClass(/glyph--done/);
});

test("S skips a Section without hiding it", async ({ page }) => {
  await selectSection(page, "src/delta-renamed.ts");
  await page.keyboard.press("s");
  const row = sectionRow(page, "src/delta-renamed.ts");
  await expect(row.locator(".glyph")).toHaveClass(/glyph--skipped/);
  await expect(row).toBeVisible();
});

test("header progress updates as changes are addressed", async ({ page }) => {
  await selectSection(page, "src/alpha.ts");
  await page.keyboard.press("d"); // marks both of alpha's changes done

  await expect(page.locator(".progress__label")).toHaveText("3 of 5 changes left");
  await expect(page.locator("[role=progressbar]")).toHaveAttribute("aria-valuenow", "2");
  await expect(page.locator(".status__counts")).toHaveText("2/5 changes reviewed");
});
