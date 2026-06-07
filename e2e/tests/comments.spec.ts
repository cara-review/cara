import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";

// The inline comment composer lives in a Monaco *view zone*, which shares the
// content layer with `.view-lines`. Without a stacking context the text layer
// paints over the zone and swallows pointer events — the composer looks present
// but its buttons are unclickable by a real mouse. These specs use Playwright's
// default click (which enforces hit-testing) so that regression cannot return
// unnoticed: a JS-dispatched .click() would mask it.

const url = serveReview();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
  await selectSection(page, "src/alpha.ts");
});

test("the composer opens on a real click and posts a comment that renders in the thread", async ({ page }) => {
  const file = page.locator("section.file", { hasText: "src/alpha.ts" });

  await file.locator(".cd-composer__open").first().click();
  const input = file.locator(".cd-composer__input").first();
  await expect(input).toBeVisible();

  await input.fill("needs a guard for the empty case");
  await file.locator(".cd-composer__accept").first().click();

  await expect(file.locator(".cd-comment__body", { hasText: "needs a guard for the empty case" })).toBeVisible();
});

test("the composer's open button is the top element at its own centre (not covered by Monaco)", async ({ page }) => {
  const covered = await page.evaluate(() => {
    const btn = document.querySelector(".cd-composer__open");
    if (!btn) return "no button";
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return btn.contains(top) || top === btn ? "clickable" : `covered by ${top?.className}`;
  });
  expect(covered).toBe("clickable");
});
