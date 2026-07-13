import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const canvas = (page: Page) => page.locator("canvas");

async function loadEmbed(page: Page): Promise<void> {
  await page.goto("/");
  await canvas(page).waitFor();
  // Wait for the DXF to load (header shows the entity count).
  await expect(page.locator("header")).toContainText("ENT");
  await page.waitForFunction(() => window.__viewer != null);
}

/** Click the embed to focus it — keyboard shortcuts are scoped to focus. */
async function focusEmbed(page: Page): Promise<void> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("the embed renders the drawing with a layer panel", async ({ page }) => {
  await loadEmbed(page);
  await expect(canvas(page)).toBeVisible();
  await expect(page.locator("li")).toHaveCount(6); // DxfLayerPanel rows
  await expect(page.locator("header")).toContainText("21 ENT");
});

test("shortcuts prop: A shows all layers after one is hidden", async ({ page }) => {
  await loadEmbed(page);
  await focusEmbed(page);
  await page.evaluate(() => window.__viewer!.setLayerVisible("FURNITURE", false));
  await page.keyboard.press("a");
  await expect
    .poll(async () => page.evaluate(() => window.__viewer!.getLayers().every((l) => l.visible)))
    .toBe(true);
});

test("shortcuts prop: F refits and + zooms in", async ({ page }) => {
  await loadEmbed(page);
  await focusEmbed(page);
  const upp = () => page.evaluate(() => window.__viewer!.view.unitsPerPixel);
  const fitted = await upp();

  await page.evaluate(() => window.__viewer!.zoomBy(3)); // zoom in, off-fit
  await page.keyboard.press("f"); // fit back (animated)
  await expect
    .poll(async () => Math.abs((await upp()) - fitted) / fitted, { timeout: 2000 })
    .toBeLessThan(0.05);

  const before = await upp();
  await page.keyboard.press("+"); // zoom in
  await expect.poll(upp, { timeout: 2000 }).toBeLessThan(before);
});
