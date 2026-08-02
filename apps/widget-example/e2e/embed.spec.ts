import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/*
 * The showcase drives apps/widget through a fake MCP Apps host — these
 * are the widget's first end-to-end protocol tests (AGT-14). Requires
 * apps/widget/dist/widget.html (vp run -r build).
 */

const widget = (page: Page) => page.frameLocator("iframe");

/*
 * Never assert on `widget(page).locator("body")` text.
 *
 * `widget.html` inlines the entire bundle into <body>, so the body's text is
 * minified source, not UI. A text assertion there matches any string that
 * appears anywhere in the widget's code — including the very UI strings a test
 * means to look for — so it passes whether or not the UI rendered. Three tests
 * here did exactly that, and one of them kept passing with the PDF parser
 * removed entirely.
 *
 * This is not looseness that a stricter regex would fix: the assertion cannot
 * fail. The real UI lives in a shadow root, which CSS locators pierce, so
 * target its elements instead.
 */

async function open(page: Page, configId?: string): Promise<void> {
  await page.goto("/");
  if (configId) await page.locator(`button[data-id="${configId}"]`).click();
  await page.waitForFunction(
    (id) => window.__showcase?.ready && (!id || window.__showcase.current === id),
    configId,
  );
}

test("the default config renders the drawing inside the widget iframe", async ({ page }) => {
  await open(page);
  await expect(widget(page).locator("canvas")).toBeVisible();
  // The status chip reports the layer count from the delivered drawing.
  await expect(widget(page).locator("#chip")).toHaveText(/\d+ LAYER/i);
});

test("the light theme config themes the widget document", async ({ page }) => {
  await open(page, "inline-light-large");
  await expect
    .poll(() => page.frameLocator("iframe").locator("html").getAttribute("data-theme"))
    .toBe("light");
  await expect(widget(page).locator("canvas")).toBeVisible();
});

test("the fullscreen light config shows light chrome around the dark canvas", async ({ page }) => {
  await open(page, "fullscreen-light");
  await expect
    .poll(() => page.frameLocator("iframe").locator("html").getAttribute("data-theme"))
    .toBe("light");
  // Fullscreen chrome is where the light theme is actually visible.
  await expect(widget(page).locator('button[aria-label="Exit fullscreen"]')).toBeVisible();
  await expect(widget(page).locator(".layers-head .h").first()).toHaveText(/^Layers · \d+/);
  await expect(widget(page).locator("canvas")).toBeVisible();
});

test("the too-large config shows the state card instead of a canvas", async ({ page }) => {
  await open(page, "too-large");
  await expect(widget(page).locator("#state .card .title")).toContainText(
    "Too large to view inline",
  );
  await expect(widget(page).locator("#root")).toHaveAttribute("data-state", "toolarge");
  await expect(widget(page).locator("canvas")).not.toBeVisible();
});

test("the pull config loads the drawing through chunked load_dxf_for_viewer", async ({ page }) => {
  await open(page, "pull-chunked");
  await expect(widget(page).locator("canvas")).toBeVisible({ timeout: 10000 });
});

// AGT-14: the in-chat viewer opens vector PDF too. The fake host delivers PDF
// bytes through the same _meta path a real one would, so this proves the
// widget's own parser wiring rather than the Worker's.
test("the PDF config renders the PDF's vector content in the widget", async ({ page }) => {
  await open(page, "inline-pdf");
  await expect(widget(page).locator("canvas")).toBeVisible();
  // PDF-7 ships exactly one "Content" layer — no OCG layers. The chip is the
  // single-element summary; the panel markup exists twice (inline + fullscreen).
  await expect(widget(page).locator("#chip")).toHaveText(/^1 LAYER/);
  await expect(widget(page).locator(".layer-rows .name").first()).toHaveText("Content");
  // The widget posts its terminal state onto #root; a parse failure would
  // leave anything but "loaded" and hide the canvas behind the state card.
  await expect(widget(page).locator("#root")).toHaveAttribute("data-state", "loaded");
});

// PDF-7: a PDF's optional-content groups reach the in-chat viewer's panel
// too, not just the demo's — one implementation of the classification, two
// surfaces (isEmptyLayer).
test("the widget lists a PDF's optional-content groups as layers", async ({ page }) => {
  await open(page, "inline-pdf-layers");
  await expect(widget(page).locator("canvas")).toBeVisible();
  // Two declared groups; the chip counts them.
  await expect(widget(page).locator("#chip")).toHaveText(/^2 LAYERS/);
  const names = widget(page).locator(".layer-rows .name");
  await expect(names.first()).toHaveText("Visible Layer");
  await expect(names.nth(1)).toHaveText("Hidden Layer");
});
