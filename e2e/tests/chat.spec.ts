import { expect, test } from "@playwright/test";
import { gotoReview, selectSection, serveChat } from "../support/app.ts";

// Chapter Q&A (ADR-0009, #15): ask a free-form question scoped to the focused Chapter
// and get the agent's answer, rendered as untrusted text. The grouping is the FakeAgent's
// single "Changes" Chapter, and the answering agent is deterministic (see AnsweringAgent).

const url = serveChat();

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
  await selectSection(page, "src/alpha.ts");
});

test("the chat pane scopes to the focused Chapter and enables its composer", async ({ page }) => {
  await expect(page.locator(".chat__scope")).toHaveText("Changes");
  await expect(page.locator(".chat__input")).toBeEnabled();
});

test("asking a question shows the question and the agent's answer", async ({ page }) => {
  await page.locator(".chat__input").fill("is this backwards compatible?");
  await page.locator(".cd-chat-send").click();

  await expect(page.locator(".cd-chat-msg--user")).toHaveText("is this backwards compatible?");
  await expect(page.locator(".cd-chat-msg--agent")).toContainText("this Chapter has");
  // Q&A is ephemeral (ADR-0009): no durable comment is created on the diff surface.
  await expect(page.locator(".cd-comment__body")).toHaveCount(0);
});

test("Enter sends the question (Shift+Enter would not)", async ({ page }) => {
  const input = page.locator(".chat__input");
  await input.fill("how many changes?");
  await input.press("Enter");
  await expect(page.locator(".cd-chat-msg--user")).toHaveText("how many changes?");
});

test("the agent's answer is rendered as inert text, never executed (ADR-0004)", async ({ page }) => {
  await page.locator(".chat__input").fill("anything");
  await page.locator(".cd-chat-send").click();

  // The probe in the answer is shown as literal text (textContent)…
  await expect(page.locator(".cd-chat-msg--agent")).toContainText("<img");
  // …no element is injected into the pane, and its onerror never runs.
  await expect(page.locator(".chat img")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "__chatXss"))).toBeFalsy();
});
