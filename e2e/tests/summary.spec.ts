import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveAnnotated } from "../support/app.ts";

const url = serveAnnotated();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
  await selectSection(page, "src/alpha.ts");
});

test("the AI-summary band is present and labelled", async ({ page }) => {
  await expect(page.locator(".summary__label")).toHaveText("AI summary");
  await expect(page.locator(".summary__body")).toContainText("Overview of src/alpha.ts");
});

test("agent summary markup is escaped, never executed", async ({ page }) => {
  // The probe is rendered as inert text (textContent), so the literal tag is visible…
  await expect(page.locator(".summary__body")).toContainText("<img");
  // …no element is injected, and its onerror never runs.
  await expect(page.locator(".summary img")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "__xss"))).toBeFalsy();
});
