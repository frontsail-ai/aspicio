import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * DEMO-19. The GA4 tag is gated to the production host, so these tests never
 * load it; `?asp_consent_ui=1` renders the banner alone. Every assertion that
 * the tag stays away is therefore also a check that the host gate holds on
 * localhost, which is where CI runs.
 */

const BANNER = "#consent-banner";
const PREVIEW = "/?asp_consent_ui=1";

/** Requests to Google's tag host, recorded for the life of the page. */
async function trackGoogleRequests(page: Page): Promise<string[]> {
  const hits: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("googletagmanager.com")) hits.push(req.url());
  });
  return hits;
}

/** The consent value persisted in localStorage, or null when unanswered. */
function storedChoice(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("aspicio.analyticsConsent"));
}

test("no banner and no tag on an ordinary visit to a non-production host", async ({ page }) => {
  const hits = await trackGoogleRequests(page);
  await page.goto("/");
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator(BANNER)).toBeHidden();
  expect(hits).toEqual([]);
});

test("the banner names Google Analytics, cookies, and links the policy", async ({ page }) => {
  await page.goto(PREVIEW);
  const banner = page.locator(BANNER);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Google Analytics");
  await expect(banner).toContainText("cookies");
  await expect(banner.locator("a[href='/privacy/']")).toBeVisible();
  await expect(banner.locator("#consent-accept")).toBeVisible();
  await expect(banner.locator("#consent-decline")).toBeVisible();
});

test("nothing is stored until the visitor answers", async ({ page }) => {
  await page.goto(PREVIEW);
  await expect(page.locator(BANNER)).toBeVisible();
  expect(await storedChoice(page)).toBe(null);
});

test("accepting dismisses the banner and persists across a reload", async ({ page }) => {
  await page.goto(PREVIEW);
  await page.locator("#consent-accept").click();
  await expect(page.locator(BANNER)).toBeHidden();
  expect(await storedChoice(page)).toBe("granted");

  await page.goto(PREVIEW);
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator(BANNER)).toBeHidden();
});

test("declining persists too, and never loads the tag", async ({ page }) => {
  const hits = await trackGoogleRequests(page);
  await page.goto(PREVIEW);
  await page.locator("#consent-decline").click();
  await expect(page.locator(BANNER)).toBeHidden();
  expect(await storedChoice(page)).toBe("denied");

  await page.goto(PREVIEW);
  await expect(page.locator("#viewer")).toBeVisible();
  await expect(page.locator(BANNER)).toBeHidden();
  expect(hits).toEqual([]);
});

test("a corrupted stored choice re-asks rather than assuming consent", async ({ page }) => {
  await page.goto(PREVIEW);
  await page.evaluate(() => localStorage.setItem("aspicio.analyticsConsent", "yes"));
  await page.goto(PREVIEW);
  await expect(page.locator(BANNER)).toBeVisible();
});

test("the banner does not block the Open dialog", async ({ page }) => {
  // The dialog sits at z-index 100 and the banner at 95 — an interaction the
  // user just started must stay on top of a persistent banner.
  await page.goto(PREVIEW);
  await expect(page.locator(BANNER)).toBeVisible();
  await page.locator("#open").click();
  await expect(page.locator("#open-dialog")).toBeVisible();
  await page.locator("#od-input").fill("https://example.test/x.dxf");
  await expect(page.locator("#od-input")).toHaveValue("https://example.test/x.dxf");
});
