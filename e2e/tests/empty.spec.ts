import { expect, test } from "@playwright/test";
import { serveEmpty } from "../support/app.ts";

const url = serveEmpty();

test("an empty diff shows the friendly empty state, not the grid", async ({ page }) => {
  await page.goto(url());
  await expect(page.locator(".overlay--empty")).toBeVisible();
  await expect(page.locator(".overlay__title")).toHaveText("Nothing to review");
  await expect(page.locator(".grid")).toBeHidden();
});
