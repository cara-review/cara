import { expect, test } from "@playwright/test";
import { gotoReview, sectionRow, serveReview } from "../support/app.ts";

const url = serveReview();

const SECTIONS = ["src/alpha.ts", "src/beta.ts", "src/delta-renamed.ts", "src/gamma.ts"];

test.beforeEach(async ({ page }) => {
  await gotoReview(page, url());
});

test("renders the single Chapter with every Section", async ({ page }) => {
  await expect(page.locator(".chapter__title")).toHaveText("Changes");
  const titles = await page.locator(".section__title").allTextContents();
  expect(new Set(titles)).toEqual(new Set(SECTIONS));
});

test("Section counts roll up from the canonical master list", async ({ page }) => {
  // alpha has two non-contiguous hunks → two changes; the rest one each.
  await expect(sectionRow(page, "src/alpha.ts").locator(".section__count")).toHaveText("2");
  await expect(sectionRow(page, "src/beta.ts").locator(".section__count")).toHaveText("1");
  await expect(sectionRow(page, "src/gamma.ts").locator(".section__count")).toHaveText("1");
});

test("header progress and meter read the canonical total", async ({ page }) => {
  await expect(page.locator(".progress__label")).toHaveText("5 of 5 changes left");
  const meter = page.locator("[role=progressbar]");
  await expect(meter).toHaveAttribute("aria-valuenow", "0");
  await expect(meter).toHaveAttribute("aria-valuemax", "5");
  await expect(page.locator(".status__counts")).toHaveText("0/5 changes reviewed");
});

test("the first Section is active and drives the diff header", async ({ page }) => {
  const activeTitle = await page.locator(".section--active .section__title").textContent();
  expect(SECTIONS).toContain(activeTitle);
  await expect(page.locator(".diff__title")).toHaveText(activeTitle ?? "");
});
