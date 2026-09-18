import { defineConfig, devices } from "@playwright/test";
import { ANALYTICS_HOST } from "../src/analytics.ts";
import { tlsDir } from "./tls.ts";

/** The plain server every suite but the analytics one runs against. */
const HTTP_PORT = 4173;

/**
 * The analytics suite needs the demo served under the production hostname, so
 * it gets a server of its own rather than making every other suite run over
 * TLS. See e2e/tls.ts for why TLS is unavoidable here.
 */
const TLS_PORT = 4443;

/** `vp dev`, or `vp preview` when E2E_PREVIEW=1 runs the suite on the build. */
const serve = process.env.E2E_PREVIEW ? "vp preview" : "vp dev";

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${HTTP_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "analytics-tag.spec.ts",
    },
    {
      // The tag loads on the exact production host and nowhere else, so the one
      // suite that exercises the real gtag.js is served under that name:
      // Chromium resolves it to the loopback server and the gate stays exactly
      // as it ships. The suite intercepts every measurement hit, so gtag.js is
      // fetched from Google's CDN but the property receives nothing.
      name: "chromium-prod-host",
      testMatch: "analytics-tag.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `https://${ANALYTICS_HOST}:${TLS_PORT}`,
        ignoreHTTPSErrors: true,
        launchOptions: {
          args: [`--host-resolver-rules=MAP ${ANALYTICS_HOST} 127.0.0.1`],
        },
      },
    },
  ],
  webServer: [
    {
      // E2E_PREVIEW=1 runs the suite against the production build (requires
      // `vp run -r build` first) instead of the dev server.
      command: `${serve} --port ${HTTP_PORT}`,
      url: `http://localhost:${HTTP_PORT}`,
      cwd: "..",
      reuseExistingServer: !process.env.CI,
    },
    {
      // `--host 127.0.0.1` is not cosmetic: bound to `localhost` the server
      // picks ::1 on macOS and 127.0.0.1 on Linux, and --host-resolver-rules
      // above has to name one address that works on both.
      command: `${serve} --port ${TLS_PORT} --host 127.0.0.1`,
      url: `https://127.0.0.1:${TLS_PORT}`,
      cwd: "..",
      env: { ASPICIO_E2E_TLS_DIR: tlsDir(ANALYTICS_HOST) },
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
