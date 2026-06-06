// Per-test server lifecycle + page-driving helpers. The `serve*` helpers register
// beforeEach/afterEach on the global Playwright test, boot a throwaway fixture +
// server per test (marks persist in JSONL, so a shared server would leak state), and
// hand back a getter for the current URL. The page helpers wrap the stable DOM hooks
// the UI exposes (nav rows, the [data-diff-surface] mount, section header) so specs
// read as behaviour, not selectors.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { AnnotatingAgent } from "./annotating-agent.ts";
import {
  makeEmptyFixture,
  makeReviewFixture,
  makeSpecialPathsFixture,
  type ReviewFixture,
} from "./fixture-repo.ts";
import { bootReal, bootWithAgent, type BootedServer } from "./server.ts";

type Boot = (fixture: ReviewFixture) => Promise<BootedServer>;

// A fresh fixture + server per test: marks persist in the JSONL store, so sharing a
// server across tests would leak state. Booting a throwaway git repo is cheap.
function serve(makeFixture: () => Promise<ReviewFixture>, boot: Boot): () => string {
  let server: BootedServer | undefined;
  let fixture: ReviewFixture | undefined;
  let url = "";
  test.beforeEach(async () => {
    fixture = await makeFixture();
    server = await boot(fixture);
    url = server.url;
  });
  test.afterEach(async () => {
    await server?.close();
    await fixture?.cleanup();
    server = undefined;
    fixture = undefined;
    url = "";
  });
  return () => url;
}

/** The standard review fixture, booted via the real CLI. */
export function serveReview(): () => string {
  return serve(makeReviewFixture, (f) => bootReal(f.dir, f.range));
}

/** The empty-diff fixture, booted via the real CLI. */
export function serveEmpty(): () => string {
  return serve(makeEmptyFixture, (f) => bootReal(f.dir, f.range));
}

/** A review whose file paths contain a space and a non-ASCII character, via the real CLI. */
export function serveSpecialPaths(): () => string {
  return serve(makeSpecialPathsFixture, (f) => bootReal(f.dir, f.range));
}

/** The review fixture booted with the summary-emitting agent. */
export function serveAnnotated(): () => string {
  return serve(makeReviewFixture, (f) => bootWithAgent(f.dir, f.range, new AnnotatingAgent()));
}

/** Navigate to a review and wait until the nav tree has rendered. */
export async function gotoReview(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator(".nav__tree .section").first().waitFor();
}

/** A nav Section row by its title (a file path). */
export function sectionRow(page: Page, title: string): Locator {
  return page.locator(".section", { hasText: title });
}

/** Focus a Section by clicking its nav row and wait for the diff header to follow. */
export async function selectSection(page: Page, title: string): Promise<void> {
  await sectionRow(page, title).click();
  await expect(page.locator(".diff__title")).toHaveText(title);
}
