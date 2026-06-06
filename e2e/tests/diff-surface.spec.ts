import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";

const url = serveReview();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("a modified file renders a Monaco diff editor showing the change", async ({ page }) => {
  await selectSection(page, "src/alpha.ts");
  const file = page.locator("section.file", { hasText: "src/alpha.ts" });
  await expect(file.locator(".file__status")).toHaveText("modified");
  await expect(file.locator(".monaco-diff-editor")).toBeVisible();
  await expect(file).toContainText("export const a2 = 22;");
});

test("non-contiguous changes in one file both render (the rest folds away)", async ({ page }) => {
  await selectSection(page, "src/alpha.ts");
  const file = page.locator("section.file", { hasText: "src/alpha.ts" });
  // alpha edits line 2 and line 9 — both changes show; Monaco folds the unchanged middle.
  await expect(file).toContainText("export const a2 = 22;");
  await expect(file).toContainText("export const a9 = 99;");
});

test("added / deleted / renamed file status labels render", async ({ page }) => {
  await selectSection(page, "src/beta.ts");
  await expect(page.locator(".file__status--added")).toHaveText("added");
  await expect(page.locator("section.file .monaco-diff-editor")).toBeVisible();

  await selectSection(page, "src/gamma.ts");
  await expect(page.locator(".file__status--deleted")).toHaveText("deleted");

  await selectSection(page, "src/delta-renamed.ts");
  await expect(page.locator(".file__status--renamed")).toHaveText("renamed");
  await expect(page.locator(".file__path")).toContainText("src/delta.ts → src/delta-renamed.ts");
});
