import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // E2E_PREVIEW=1 runs the suite against the production build (requires
    // `vp run -r build` first) instead of the dev server.
    command: process.env.E2E_PREVIEW ? "vp preview --port 4173" : "vp dev --port 4173",
    url: "http://localhost:4173",
    cwd: "..",
    reuseExistingServer: !process.env.CI,
  },
});
