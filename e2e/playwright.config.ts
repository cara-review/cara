import { defineConfig, devices } from "@playwright/test";

// Headless Chromium only (the app is a desktop --app-mode Chromium window). Each spec
// boots its own backend (see support/app.ts), so there is no shared webServer here.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? "github" : "line",
  use: {
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
