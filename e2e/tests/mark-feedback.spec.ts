// A mark that fails on the wire must surface feedback, not fail silently (#30). We proxy the
// tRPC WebSocket and drop the `mark` mutation so its promise rejects — the dispatch then raises a
// non-blocking retry toast.

import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveReview } from "../support/app.ts";

const url = serveReview();

test("a failed mark surfaces a non-blocking retry toast", async ({ page }) => {
  let dropMarks = false;
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      // Drop the mark mutation (closing the socket rejects its pending promise); proxy the rest.
      if (dropMarks && typeof message === "string" && message.includes('"mark"')) ws.close();
      else server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });

  await gotoReview(page, url());
  await selectSection(page, "src/alpha.ts");

  dropMarks = true;
  await page.keyboard.press("d");

  await expect(page.locator(".toast")).toContainText("Couldn’t mark this section reviewed.");
  await expect(page.locator(".toast__retry")).toBeVisible();
});
