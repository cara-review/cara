import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";

const url = serveReview();

const SECTIONS = ["src/alpha.ts", "src/beta.ts", "src/delta-renamed.ts", "src/gamma.ts"];

test("the internal words 'atom' and 'hunk' never reach the DOM", async ({ page }) => {
  await gotoReview(page, url());
  const body = page.locator("body");

  for (const title of SECTIONS) {
    await selectSection(page, title);
    await expect(body).not.toContainText(/atom/i);
    await expect(body).not.toContainText(/hunk/i);
  }

  // Expanded context is rendered the same way — check it too.
  await selectSection(page, "src/alpha.ts");
  await page.locator(".gap").first().click();
  await expect(page.locator(".line--context").first()).toBeVisible();
  await expect(body).not.toContainText(/atom/i);
  await expect(body).not.toContainText(/hunk/i);
});
