import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";

const url = serveReview();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("a modified file renders change-block / gap / change-block", async ({ page }) => {
  await selectSection(page, "src/alpha.ts");
  const file = page.locator("section.file", { hasText: "src/alpha.ts" });
  await expect(file.locator(".file__status")).toHaveText("modified");
  await expect(file.locator(".block")).toHaveCount(2);
  await expect(page.locator(".line--added .line__code").first()).toHaveText("export const a2 = 22;");
});

test("expanding a gap fetches context lines, then collapses", async ({ page }) => {
  await selectSection(page, "src/alpha.ts");
  const gap = page.locator(".gap").first();
  await expect(gap).toHaveText("Expand 6 hidden lines");

  await gap.click();
  await expect(page.locator(".line--context")).toHaveCount(6);
  await expect(page.locator(".line--context .line__code").first()).toHaveText("export const a3 = 3;");

  await page.locator(".gap--open").click();
  await expect(page.locator(".line--context")).toHaveCount(0);
});

test("added / deleted file status labels render", async ({ page }) => {
  await selectSection(page, "src/beta.ts");
  await expect(page.locator(".file__status--added")).toHaveText("added");
  await expect(page.locator(".line--added").first()).toBeVisible();

  await selectSection(page, "src/gamma.ts");
  await expect(page.locator(".file__status--deleted")).toHaveText("deleted");
  await expect(page.locator(".line--removed").first()).toBeVisible();
});

test("a renamed file shows old → new and the renamed status", async ({ page }) => {
  await selectSection(page, "src/delta-renamed.ts");
  await expect(page.locator(".file__status--renamed")).toHaveText("renamed");
  await expect(page.locator(".file__path")).toHaveText("src/delta.ts → src/delta-renamed.ts");
});
