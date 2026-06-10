// Line-anchored comment rendering and composer affordance (ADR-0012 §2).
// A comment with a resolved `line` renders with a "line N" badge at that line's zone;
// the composer exposes a line picker (select) for the human to optionally pin.

import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveWithLineComment } from "../support/app.ts";

const url = serveWithLineComment();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
  // The seeded line-anchored comment is on an atom in src/alpha.ts (first atom with added lines).
  await selectSection(page, "src/alpha.ts");
});

test("a pre-seeded line-anchored comment renders with a 'line N' badge", async ({ page }) => {
  // Wait for Monaco surface to load
  await expect(page.locator("section.file", { hasText: "src/alpha.ts" }).locator(".monaco-diff-editor")).toBeVisible();
  // The seeded comment should render with the badge
  const badge = page.locator(".cd-comment__line").first();
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("line");
});

test("the composer exposes a line picker with 'Whole change block' as default", async ({ page }) => {
  const file = page.locator("section.file", { hasText: "src/alpha.ts" });
  await file.locator(".cd-composer__open").first().click();
  const picker = file.locator(".cd-composer__line-select").first();
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue(""); // default: whole block
});

test("the composer submits a block-level comment when no line is pinned", async ({ page }) => {
  const file = page.locator("section.file", { hasText: "src/alpha.ts" });
  await file.locator(".cd-composer__open").first().click();
  const input = file.locator(".cd-composer__input").first();
  await input.fill("block-level review note");
  await file.locator(".cd-composer__accept").first().click();
  // Comment should render; a block-level comment has no line badge
  await expect(file.locator(".cd-comment__body", { hasText: "block-level review note" })).toBeVisible();
});

test("vocabulary: 'atom' and 'hunk' do not appear in the line-comment UI", async ({ page }) => {
  await expect(page.locator("body")).not.toContainText(/atom/i);
  await expect(page.locator("body")).not.toContainText(/hunk/i);
});
