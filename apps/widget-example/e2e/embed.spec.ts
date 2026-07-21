import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/*
 * The showcase drives apps/widget through a fake MCP Apps host — these
 * are the widget's first end-to-end protocol tests (AGT-14). Requires
 * apps/widget/dist/widget.html (vp run -r build).
 */

const widget = (page: Page) => page.frameLocator("iframe");

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
  await expect(widget(page).locator("body")).toContainText(/layer/i);
});

test("the light theme config themes the widget document", async ({ page }) => {
  await open(page, "inline-light-large");
  await expect
    .poll(() => page.frameLocator("iframe").locator("html").getAttribute("data-theme"))
    .toBe("light");
  await expect(widget(page).locator("canvas")).toBeVisible();
});

test("the too-large config shows the state card instead of a canvas", async ({ page }) => {
  await open(page, "too-large");
  await expect(widget(page).locator("body")).toContainText("Too large to view inline");
  await expect(widget(page).locator("canvas")).not.toBeVisible();
});

test("the pull config loads the drawing through chunked load_dxf_for_viewer", async ({ page }) => {
  await open(page, "pull-chunked");
  await expect(widget(page).locator("canvas")).toBeVisible({ timeout: 10000 });
});
