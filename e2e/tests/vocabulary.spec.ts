import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";

const url = serveReview();

const SECTIONS = ["src/alpha.ts", "src/beta.ts", "src/delta-renamed.ts", "src/gamma.ts"];

test("the internal words 'atom' and 'hunk' never reach the DOM", async ({ page }) => {
  await gotoReview(page, url());
  const body = page.locator("body");

  for (const title of SECTIONS) {
    await selectSection(page, title);
    // Wait for the Monaco surface to render so its markup is in the DOM when we assert.
    await expect(page.locator("section.file", { hasText: title }).locator(".monaco-diff-editor")).toBeVisible();
    await expect(body).not.toContainText(/atom/i);
    await expect(body).not.toContainText(/hunk/i);
  }
});
