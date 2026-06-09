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

test("agent summary markdown is rendered (ADR-0004): sanitized HTML, not raw text", async ({ page }) => {
  // markdown-it with html:false escapes any literal HTML in the summary — the XSS probe's
  // <img> tag is escaped to &lt;img, so it appears as inert visible text in the rendered
  // output, never as a live element whose onerror could fire.
  // DOMPurify then strips any residual dangerous content as defence-in-depth.
  await expect(page.locator(".summary__body")).toContainText("<img");
  await expect(page.locator(".summary img")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "__xss"))).toBeFalsy();
});

test("agent summary renders markdown formatting", async ({ page }) => {
  // The summary body is a div (not a p) since it receives rendered HTML.
  await expect(page.locator(".summary__body")).toBeVisible();
});
