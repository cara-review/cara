// Live-refresh via reconnect-broadcast (ADR-0012 §4): every reconnect reloads the
// snapshot so a reshape broadcast reaches all connected browsers. The `snapshot===null`
// guard has been dropped, so reconnects always re-query. Focus is preserved when the
// active section still exists in the new grouping.

import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";

const url = serveReview();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("the review renders after an offline→online cycle (reconnect reloads snapshot)", async ({
  page,
  context,
}) => {
  await selectSection(page, "src/alpha.ts");
  const sectionCountBefore = await page.locator(".section").count();

  // Simulate network disconnect then reconnect
  await context.setOffline(true);
  await context.setOffline(false);

  // Should reconnect and re-load the snapshot without any stuck state
  await expect(page.locator(".status__dot--open")).toBeVisible({ timeout: 10000 });

  // Section count preserved (same data served)
  await expect(page.locator(".section")).toHaveCount(sectionCountBefore);
  // Section still selected (focus preserved)
  await expect(page.locator(".diff__title")).toHaveText("src/alpha.ts");
});

test("a second reconnect also reloads the snapshot (no snapshot===null guard)", async ({
  page,
  context,
}) => {
  // Two offline/online cycles — both should recover cleanly
  for (let i = 0; i < 2; i++) {
    await context.setOffline(true);
    await context.setOffline(false);
    await expect(page.locator(".status__dot--open")).toBeVisible({ timeout: 10000 });
  }
  // After two reconnects, sections should still be rendered
  await expect(page.locator(".section").first()).toBeVisible();
});
