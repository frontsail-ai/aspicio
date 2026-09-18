import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";

/**
 * DEMO-19, end to end through the real gtag.js.
 *
 * Two claims live here, and neither survives without the real tag. That an
 * accepting visitor is measured: a `dataLayer` gtag.js silently ignored passed
 * every other check for six weeks while the property stayed empty, because a
 * tag that loads and reports nothing looks healthy from the outside. And that
 * everyone else is left alone: no hit, no cookie, and no request for gtag.js
 * itself, which is what the privacy policy promises.
 *
 * Every other suite runs on localhost, where the host gate keeps the tag away,
 * so the `chromium-prod-host` project maps the production host to the loopback
 * server and the gate passes unchanged.
 *
 * Every hit is intercepted and answered locally: gtag.js is fetched live from
 * Google's CDN, but the property never receives a test event.
 */

const BANNER = "#consent-banner";

/** Collector endpoints, including the regional ones gtag.js may pick. */
const COLLECT = /google-analytics\.com\/|analytics\.google\.com\//;

/** Anything Google-bound: the tag loader as well as the collectors. */
const GOOGLE = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/;

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

/** Every Google-bound request the page made, recorded from before the first load. */
function watchGoogle(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request: Request) => {
    if (GOOGLE.test(request.url())) seen.push(request.url());
  });
  return seen;
}

test("accepting loads the tag and measures the visit", async ({ page }) => {
  const hits = await interceptHits(page);
  await page.goto("/");
  await expect(page.locator("#viewer")).toBeVisible();
  await page.locator("#consent-accept").click();

  // The queue is only executed if gtag.js accepts its shape; an ignored queue
  // produces a loaded script, zero hits, and no error anywhere.
  await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // Analytics granted, ad storage still denied — the demo runs no ads.
  expect(consentSignal(hits[0]!)).toBe("G101");
  await expect.poll(() => gaCookie(page), { timeout: 15_000 }).toBeDefined();
});

test("an unanswered visitor reaches Google not at all", async ({ page }) => {
  // Basic consent mode, and the reason it was chosen: the privacy policy says a
  // visitor who has not accepted is not reported, so not even gtag.js may load.
  const google = watchGoogle(page);
  await interceptHits(page);
  await page.goto("/");
  await expect(page.locator(BANNER)).toBeVisible();
  await expect(page.locator("#viewer")).toBeVisible();
  await page.waitForTimeout(3_000);

  expect(google).toEqual([]);
  expect(await gaCookie(page)).toBeUndefined();
});

test("a returning granter measures on the next visit, unasked", async ({ page }) => {
  const hits = await interceptHits(page);
  await page.goto("/");
  await page.locator("#consent-accept").click();
  await expect(page.locator(BANNER)).toBeHidden();

  hits.length = 0;
  await page.goto("/");
  await expect(page.locator(BANNER)).toBeHidden();
  await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(consentSignal(hits[0]!)).toBe("G101");
});

test("a decliner reaches Google not at all, now or on the next visit", async ({ page }) => {
  const google = watchGoogle(page);
  await interceptHits(page);
  await page.goto("/");
  await page.locator("#consent-decline").click();
  await expect(page.locator(BANNER)).toBeHidden();

  await page.goto("/");
  await expect(page.locator(BANNER)).toBeHidden();
  await page.waitForTimeout(3_000);

  expect(google).toEqual([]);
  expect(await gaCookie(page)).toBeUndefined();
});
