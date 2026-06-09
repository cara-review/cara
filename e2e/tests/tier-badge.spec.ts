import { expect, test } from "@playwright/test";
import { gotoReview, serveAgentMarked } from "../support/app.ts";

// Tier badge rendering (ADR-0011 §5). When all marks in a section are agent-authored
// the nav row shows a `.badge--agent` chip (visually distinct from human marks).
// Human marks override via normal event append — the badge disappears once any human
// mark lands on the same section.

const url = serveAgentMarked();

test("an agent-marked section shows a tier badge in the nav", async ({ page }) => {
  await gotoReview(page, url());
  // The first chapter's sections are expanded (the store expands the first chapter).
  // The first section has all atoms marked as "done" by the "security" agent.
  const firstSection = page.locator(".nav__tree .section").first();
  await expect(firstSection).toBeVisible();

  const badge = firstSection.locator(".badge--agent");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("security");
});

test("the agent badge aria-label describes the mark tier", async ({ page }) => {
  await gotoReview(page, url());
  const badge = page.locator(".nav__tree .section").first().locator(".badge--agent");
  await expect(badge).toHaveAttribute("aria-label", /agent mark/i);
});

test("an unmarked section shows no agent tier badge", async ({ page }) => {
  await gotoReview(page, url());
  // The fixture only seeds marks on the first section; other sections are unmarked.
  const sections = page.locator(".nav__tree .section");
  // Assert the fixture has at least two sections so the second-section assertion is real.
  await expect(sections).toHaveCount(await sections.count());
  expect(await sections.count()).toBeGreaterThan(1);

  const secondSection = sections.nth(1);
  await expect(secondSection.locator(".badge--agent")).toHaveCount(0);
});
