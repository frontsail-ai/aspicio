import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function loadPage(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("canvas").waitFor();
  await expect(page.locator("header")).toContainText("ENT");
  await page.waitForFunction(() => window.__viewer != null);
}

test("the hand-rolled page renders the drawing with a custom layer list", async ({ page }) => {
  await loadPage(page);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("#layers label")).toHaveCount(6);
  await expect(page.locator("header")).toContainText("21 ENT");
});

test("the custom checkboxes drive setLayerVisible", async ({ page }) => {
  await loadPage(page);
  await page.locator("#layers label", { hasText: "FURNITURE" }).locator("input").uncheck();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__viewer!.getLayers().find((l) => l.name === "FURNITURE")?.visible,
      ),
    )
    .toBe(false);
});

test("the Fit button refits after a zoom", async ({ page }) => {
  await loadPage(page);
  const upp = () => page.evaluate(() => window.__viewer!.view.unitsPerPixel);
  const fitted = await upp();
  await page.evaluate(() => window.__viewer!.zoomBy(3));
  await page.locator("#fit").click();
  await expect
    .poll(async () => Math.abs((await upp()) - fitted) / fitted, { timeout: 2000 })
    .toBeLessThan(0.05);
});
