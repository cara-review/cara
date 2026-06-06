// File paths that exercise git's encoding quirks: a space (git tab-delimits the
// ---/+++ line) and a non-ASCII char (git C-quotes it unless core.quotePath=false).
// Either, mishandled, surfaces a mangled filename in the nav and breaks the path
// that marks / readFile / openInEditor address. This drives the real CLI → server
// → git adapter end to end and asserts the on-disk paths reach the UI verbatim.

import { expect, test } from "@playwright/test";
import { gotoReview, sectionRow, serveSpecialPaths } from "../support/app.ts";
import { SPACE_PATH, UNICODE_PATH } from "../support/fixture-repo.ts";

const url = serveSpecialPaths();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("a path with a space and a non-ASCII path appear verbatim in the nav", async ({ page }) => {
  const titles = await page.locator(".section__title").allTextContents();
  expect(new Set(titles)).toEqual(new Set([SPACE_PATH, UNICODE_PATH]));
});

test("the mangled C-quoted / octal-escaped form never reaches the DOM", async ({ page }) => {
  const body = page.locator("body");
  await expect(body).not.toContainText(/\\303/); // octal escape of a UTF-8 byte
  await expect(body).not.toContainText(/"[ab]\//); // a C-quoted `"a/…"` path token
});

test("both Sections are selectable by their real path", async ({ page }) => {
  for (const path of [SPACE_PATH, UNICODE_PATH]) {
    await sectionRow(page, path).click();
    await expect(page.locator(".section--active .section__title")).toHaveText(path);
  }
});
