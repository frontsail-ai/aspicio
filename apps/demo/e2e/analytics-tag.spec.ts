import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";

/**
 * DEMO-19, end to end through the real gtag.js.
 *
 * Every other suite runs on localhost, where the host gate keeps the tag away
 * — so nothing ever ran our queue through Google's code, and a `dataLayer`
 * gtag.js silently ignored passed every check for six weeks while the property
 * stayed empty. A tag that loads and reports nothing is indistinguishable from
 * a healthy one unless you assert on the measurement hit itself, which is what
 * this file does. The `chromium-prod-host` project maps the production host to
 * the loopback server so the gate passes unchanged.
 *
 * Every hit is intercepted and answered locally: gtag.js is fetched live from
 * Google's CDN, but the property never receives a test event.
 */

const BANNER = "#consent-banner";

/** Collector endpoints, including the regional ones gtag.js may pick. */
const COLLECT = /google-analytics\.com\/|analytics\.google\.com\//;

/** The `gcs` parameter: `G1<ad_storage><analytics_storage>`, 0 denied, 1 granted. */
function consentSignal(url: string): string | null {
  return new URL(url).searchParams.get("gcs");
}

/**
 * Stub the collector and record what the page tried to send. Must be installed
 * before the first navigation — the boot pageview fires during load.
 */
async function interceptHits(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.route(COLLECT, async (route, request: Request) => {
    hits.push(request.url());
    await route.fulfill({ status: 204, body: "" });
  });
  return hits;
}

/** The GA4 client-id cookie, set by gtag.js only once consent is granted. */
async function gaCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === "_ga")?.value;
}

test("the tag loads on the production host and measures the visit", async ({ page }) => {
  const hits = await interceptHits(page);
  await page.goto("/");
  await expect(page.locator("#viewer")).toBeVisible();

  // The queue is only executed if gtag.js accepts its shape; an ignored queue
  // produces a loaded script, zero hits, and no error anywhere.
  await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("an unanswered visitor is measured without cookies", async ({ page }) => {
  const hits = await interceptHits(page);
  await page.goto("/");
  await expect(page.locator(BANNER)).toBeVisible();
  await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // Consent Mode v2: the pageview travels cookielessly while storage is denied.
  expect(consentSignal(hits[0]!)).toBe("G100");
  expect(await gaCookie(page)).toBeUndefined();
});

test("accepting lets gtag.js set the client-id cookie", async ({ page }) => {
  await interceptHits(page);
  await page.goto("/");
  await page.locator("#consent-accept").click();
  await expect(page.locator(BANNER)).toBeHidden();

  await expect.poll(() => gaCookie(page), { timeout: 15_000 }).toBeDefined();
});

test("a returning granter is restored before the pageview", async ({ page }) => {
  const hits = await interceptHits(page);
  await page.goto("/");
  await page.locator("#consent-accept").click();
  await expect(page.locator(BANNER)).toBeHidden();

  hits.length = 0;
  await page.goto("/");
  await expect(page.locator(BANNER)).toBeHidden();
  await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // Analytics granted, ad storage still denied — the demo runs no ads.
  expect(consentSignal(hits[0]!)).toBe("G101");
});

test("declining keeps every hit cookieless", async ({ page }) => {
  const hits = await interceptHits(page);
  await page.goto("/");
  await page.locator("#consent-decline").click();
  await expect(page.locator(BANNER)).toBeHidden();

  hits.length = 0;
  await page.goto("/");
  await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(consentSignal(hits[0]!)).toBe("G100");
  expect(await gaCookie(page)).toBeUndefined();
});
