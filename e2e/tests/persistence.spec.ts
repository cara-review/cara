import { expect, test } from "@playwright/test";
import { sectionRow } from "../support/app.ts";
import { makeReviewFixture, type ReviewFixture } from "../support/fixture-repo.ts";
import { bootReal, type BootedServer } from "../support/server.ts";

// This spec manages its own server lifecycle (rather than the per-test `serve`
// helper) because durability is only proven by a *new process* reading the log it
// did not author: a fresh backend over the same repo + state dir.

let fixture: ReviewFixture;
const servers: BootedServer[] = [];

test.beforeEach(async () => {
  fixture = await makeReviewFixture();
});

test.afterEach(async () => {
  for (const server of servers) {
    try {
      await server.close();
    } catch {
      /* already closed by the test */
    }
  }
  servers.length = 0;
  await fixture.cleanup();
});

/** Boot a fresh backend against the test's repo + state dir. */
async function boot(): Promise<string> {
  const server = await bootReal(fixture.dir, fixture.range);
  servers.push(server);
  return server.url;
}

test("marks survive a backend restart (read back from the JSONL log)", async ({ page }) => {
  await page.goto(await boot());
  await page.locator(".nav__tree .section").first().waitFor();

  await sectionRow(page, "src/beta.ts").click();
  await expect(page.locator(".diff__title")).toHaveText("src/beta.ts");
  await page.keyboard.press("d");
  await expect(sectionRow(page, "src/beta.ts").locator(".glyph")).toHaveClass(/glyph--done/);

  // Restart the backend: a new process must rebuild mark state from disk, not memory.
  await servers[0]?.close();
  await page.goto(await boot());
  await page.locator(".nav__tree .section").first().waitFor();

  await expect(sectionRow(page, "src/beta.ts").locator(".glyph")).toHaveClass(/glyph--done/);
  await expect(page.locator(".progress__label")).toHaveText("4 of 5 changes left");
});
