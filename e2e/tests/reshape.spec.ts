// Reshape affordance (ADR-0012 §3): the human can request a review reorganisation via
// the header button or the ⌘K palette. The request is recorded and a pending-state pill
// appears until the agent re-presents (which clears it mechanically).

import { expect, test } from "@playwright/test";
import { gotoReview, serveReview } from "../support/app.ts";

const url = serveReview();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("the header shows a 'Reshape…' button when no reshape is pending", async ({ page }) => {
  await expect(page.locator("button.reshape-btn")).toBeVisible();
  await expect(page.locator("button.reshape-btn")).toHaveText("Reshape…");
});

test("clicking 'Reshape…' opens the dialog", async ({ page }) => {
  await page.locator("button.reshape-btn").click();
  await expect(page.locator(".reshape-dialog")).toBeVisible();
  await expect(page.locator(".reshape-dialog__input")).toBeVisible();
  await expect(page.locator(".reshape-dialog__title")).toHaveText("Reshape this review");
});

test("submitting a reshape request dismisses the dialog and shows the pending pill", async ({ page }) => {
  await page.locator("button.reshape-btn").click();
  await page.locator(".reshape-dialog__input").fill("group by subsystem");
  await page.locator(".reshape-dialog__accept").click();

  // Dialog should close
  await expect(page.locator(".reshape-dialog")).not.toBeVisible();
  // Pending pill should appear in the header
  await expect(page.locator(".reshape-pending")).toBeVisible();
  await expect(page.locator(".reshape-pending")).toContainText("Reshape asked");
});

test("the 'Reshape…' button is replaced by the pending pill after a request", async ({ page }) => {
  await page.locator("button.reshape-btn").click();
  await page.locator(".reshape-dialog__input").fill("filter to public API only");
  await page.locator(".reshape-dialog__accept").click();

  await expect(page.locator("button.reshape-btn")).not.toBeVisible();
  await expect(page.locator(".reshape-pending")).toBeVisible();
});

test("cancelling the dialog closes it without creating a request", async ({ page }) => {
  await page.locator("button.reshape-btn").click();
  await page.locator(".reshape-dialog__cancel").click();
  await expect(page.locator(".reshape-dialog")).not.toBeVisible();
  await expect(page.locator(".reshape-pending")).not.toBeVisible();
  // Button should still be there
  await expect(page.locator("button.reshape-btn")).toBeVisible();
});

test("clicking the backdrop dismisses the dialog", async ({ page }) => {
  await page.locator("button.reshape-btn").click();
  await expect(page.locator(".reshape-dialog")).toBeVisible();
  // Click the backdrop (the dialog element itself, outside the panel)
  await page.locator(".reshape-dialog").click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".reshape-dialog")).not.toBeVisible();
});

test("the ⌘K palette contains a 'Reshape this review…' command", async ({ page }) => {
  await page.keyboard.press("Meta+k");
  await expect(page.locator(".palette")).toBeVisible();
  await page.locator(".palette__input").fill("reshape");
  await expect(page.locator(".palette__item", { hasText: "Reshape this review" })).toBeVisible();
});

test("the palette 'Reshape' command opens the dialog", async ({ page }) => {
  await page.keyboard.press("Meta+k");
  await page.locator(".palette__input").fill("reshape");
  await page.locator(".palette__item", { hasText: "Reshape this review" }).click();
  await expect(page.locator(".reshape-dialog")).toBeVisible();
});
