// AXIS 2 (browser half) — a real human-in-the-loop session end to end. Playwright drives
// the browser as the human: marks every Section done, then clicks "Done reviewing". That
// click is the markComplete signal (ADR-0011 §4); the agent's `dispatch --wait`, driven
// here through the real `callWait` client against the same server, must then observe the
// `done` state with the human-tier marks. This is the only spec that joins a real browser
// click to the CLI wait client — the rendering details live in the other specs.

import { expect, test, type Page } from "@playwright/test";
import type { ReviewContext } from "@cara/core";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";
import { callWait } from "../../packages/node/src/cli/wait.ts";

const url = serveReview();

// The review fixture's Sections (default grouping = one Section per file).
const SECTIONS = ["src/alpha.ts", "src/beta.ts", "src/gamma.ts", "src/delta-renamed.ts"];

/** Mark every Section done from the keyboard, so the review becomes fully accounted. */
async function markEverythingDone(page: Page): Promise<void> {
  for (const title of SECTIONS) {
    await selectSection(page, title);
    await page.keyboard.press("d");
  }
}

test("a human marks everything done and finishes → dispatch --wait sees done with human marks", async ({ page }) => {
  const live = new URL(url());
  const context = live.searchParams.get("context") as string;
  const base = live.origin;

  await gotoReview(page, url());
  await markEverythingDone(page);

  // The "Done reviewing" control enables only once every change is accounted for.
  const done = page.locator("button.go", { hasText: "Done reviewing" });
  await expect(done).toBeEnabled();
  await done.click();
  await expect(page.locator("button.go--done")).toBeVisible();

  // The agent, polling from its own process, sees the human's completion.
  const verdict = await callWait(base, context as ReviewContext, {});
  expect(verdict.state).toBe("done");
  if (verdict.state === "done") {
    expect(verdict.progress.unaddressed).toBe(0);
    // Every mark came from the browser channel → human tier, no reviewer label.
    expect(verdict.comments.every((c) => c.tier === "human" && c.reviewer === null)).toBe(true);
  }
});
