// Cross-axis reshape round trip (ADR-0012 §3/§4): the visible end of the loop the
// browser-only reshape.spec and reconnect-reload.spec stop short of. A human requests a
// reshape in the UI (pending pill appears); the agent re-presents over the CLI
// present-handover against the SAME live server; the open browser live-refreshes —
// the pill clears and the new grouping renders. One server throughout (no sibling).

import { expect, test } from "@playwright/test";
import { makeReviewFixture, type ReviewFixture } from "../support/fixture-repo.ts";
import { bootReshapeRoundTrip, type ReshapeRoundTripServer } from "../support/server.ts";
import { handReshapeToServer } from "../../packages/node/src/cli/reshape-client.ts";

let fixture: ReviewFixture;
let server: ReshapeRoundTripServer;

test.beforeEach(async ({ page }) => {
  fixture = await makeReviewFixture();
  server = await bootReshapeRoundTrip(fixture.dir, fixture.range);
  await page.goto(server.url);
  await page.locator(".nav__tree .section").first().waitFor();
});

test.afterEach(async () => {
  await server.close();
  await fixture.cleanup();
});

test("a human reshape request clears and the grouping live-refreshes when the agent re-presents", async ({ page }) => {
  // The default grouping is one Section per file — several rows.
  expect(await page.locator(".section").count()).toBeGreaterThan(1);

  // 1) The human asks for a reshape; the pending pill appears.
  await page.locator("button.reshape-btn").click();
  await page.locator(".reshape-dialog__input").fill("collapse everything into one section");
  await page.locator(".reshape-dialog__accept").click();
  await expect(page.locator(".reshape-pending")).toBeVisible();

  // 2) The agent re-presents a single-Section grouping to the SAME live server (the CLI
  //    present-handover, over WS). The server reconnect-broadcasts; the open browser reloads.
  const grouping = {
    chapters: [
      { title: "Everything", summary: "the whole change, regrouped", sections: [{ title: "Everything", summary: "all atoms", atomHashes: server.hashes }] },
    ],
  };
  await handReshapeToServer(server.rawUrl, server.context, grouping, true);

  // 3) The open browser live-refreshes: the pill clears (pendingReshape resolved) and the
  //    new grouping renders — one Section titled "Everything".
  await expect(page.locator(".reshape-pending")).not.toBeVisible({ timeout: 10000 });
  await expect(page.locator("button.reshape-btn")).toBeVisible();
  await expect(page.locator(".section")).toHaveCount(1);
  await expect(page.locator(".section")).toContainText("Everything");
});
