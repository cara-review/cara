import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveWithAnswer } from "../support/app.ts";

// Inline answer rendering (ADR-0004, ADR-0011). When the CLI agent answers a comment
// the answer is agent-authored (untrusted overlay), rendered via renderMarkdown
// (markdown-it html:false + DOMPurify). The comment's status flips to "addressed".

const url = serveWithAnswer();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
  // The first section is "src/alpha.ts" (default grouping groups by file).
  await selectSection(page, "src/alpha.ts");
  // Wait for the comment zone to render in Monaco.
  await page.locator(".cd-comment-thread").first().waitFor({ timeout: 5000 });
});

test("an answered comment shows the answer rendered under the body", async ({ page }) => {
  const thread = page.locator(".cd-comment-thread").first();
  const comment = thread.locator(".cd-comment").first();

  // Comment body is present (human text, escaped).
  await expect(comment.locator(".cd-comment__body")).toContainText("This needs a guard.");

  // Answer section is present and contains rendered markdown.
  const answer = comment.locator(".cd-comment__answer");
  await expect(answer).toBeVisible();
  // "**Addressed**" should be rendered as <strong> by markdown-it.
  await expect(answer.locator("strong")).toHaveText("Addressed");
});

test("an answered comment shows 'addressed' status badge", async ({ page }) => {
  const comment = page.locator(".cd-comment").first();
  const badge = comment.locator(".cd-comment__status");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/cd-comment__status--addressed/);
});

test("comment answer markdown is sanitized: no injected elements survive", async ({ page }) => {
  // Even if an agent answer contained a raw <script> or <img onerror>, DOMPurify strips it.
  // Verify no script tags were injected into the answer area.
  const answer = page.locator(".cd-comment__answer").first();
  await expect(answer).toBeVisible();
  await expect(answer.locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "__xss"))).toBeFalsy();
});
