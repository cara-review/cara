import { expect, test, type Page } from "@playwright/test";
import { gotoReview, serveReview } from "../support/app.ts";

// Pane resize / collapse + persisted layout (#17). Drives the real shell on a single
// page: a seeded width is restored at first paint (installLayout reads localStorage
// before painting), then a divider keyboard-resizes and collapses its pane, writing
// each change back to storage. Parsing/clamping of the stored value is unit-tested in
// apps/web/src/ui/layout.test.ts.
//
// Kept to one fast page (the nav divider, which never sits at the viewport edge) so it
// behaves like the rest of the suite under full-parallel load.

const url = serveReview();
const KEY = "cara:layout";
const stored = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), KEY);

test("restores a seeded width on load, then resizes/collapses and persists", async ({ page }) => {
  // Seed a non-default nav width so the first paint must restore it.
  // (Old pre-pivot state with chatWidth/chatCollapsed keys is silently ignored — see layout.test.ts.)
  await page.addInitScript(
    ([key]) =>
      localStorage.setItem(
        key as string,
        JSON.stringify({ navWidth: 320, navCollapsed: false }),
      ),
    [KEY],
  );
  await gotoReview(page, url());

  const nav = page.locator(".nav");
  const navDivider = page.locator(".pane-divider").nth(0);
  const navWidth = () => nav.evaluate((el) => el.getBoundingClientRect().width);

  // Exactly one divider (2-pane layout: nav + diff; no chat pane), and seeded width restored.
  await expect(page.locator(".pane-divider")).toHaveCount(1);
  await expect(nav).toBeVisible();
  expect(await navWidth()).toBeCloseTo(320, 0);

  // Keyboard-resize the nav narrower; the new width is persisted.
  await navDivider.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  expect(await navWidth()).toBeLessThan(320);
  await expect.poll(async () => (await stored(page)).navWidth).toBeLessThan(320);

  // Collapse the nav via its divider toggle; the pane hides and the state persists.
  await navDivider.locator(".pane-divider__toggle").click();
  await expect(nav).toBeHidden();
  await expect(page.locator(".grid")).toHaveClass(/grid--nav-collapsed/);
  await expect.poll(async () => (await stored(page)).navCollapsed).toBe(true);
});
