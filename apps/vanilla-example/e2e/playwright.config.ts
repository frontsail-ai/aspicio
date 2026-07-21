import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4178",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.E2E_PREVIEW ? "vp preview --port 4178" : "vp dev --port 4178",
    url: "http://localhost:4178",
    cwd: "..",
    reuseExistingServer: !process.env.CI,
  },
});
