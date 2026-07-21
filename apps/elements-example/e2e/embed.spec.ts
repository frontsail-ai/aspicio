import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const canvas = (page: Page) => page.locator("canvas");

async function loadEmbed(page: Page): Promise<void> {
  await page.goto("/");
  await canvas(page).waitFor();
  // Wait for the DXF to load (the `loaded` event fills the header).
  await expect(page.locator("header")).toContainText("ENT");
  await page.waitForFunction(() => window.__viewer != null);
}

test("the plain-HTML embed renders the drawing with a layer panel", async ({ page }) => {
  await loadEmbed(page);
  await expect(canvas(page)).toBeVisible();
  // Playwright locators pierce open shadow roots: these are the panel rows.
  await expect(page.locator("li")).toHaveCount(6);
  await expect(page.locator("header")).toContainText("21 ENT");
});

test("panel checkbox toggles layer visibility on the viewer", async ({ page }) => {
  await loadEmbed(page);
  await page.locator('[aria-label="FURNITURE"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__viewer!.getLayers().find((l) => l.name === "FURNITURE")?.visible,
      ),
    )
    .toBe(false);
});

test("the shortcuts attribute enables focus-scoped keyboard control", async ({ page }) => {
  await loadEmbed(page);
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => window.__viewer!.setLayerVisible("FURNITURE", false));
  await page.keyboard.press("a");
  await expect
    .poll(() => page.evaluate(() => window.__viewer!.getLayers().every((l) => l.visible)))
    .toBe(true);
});

test("changing the src-url attribute loads the new document", async ({ page }) => {
  await loadEmbed(page);
  const entityCount = () =>
    page.evaluate(() => document.querySelector("header .stats")?.textContent);
  expect(await entityCount()).toContain("21");
  // Re-point the attribute at the same URL with a cache-buster: the embed
  // reloads and fires `loaded` again (attribute-driven, no JS API needed).
  await page.evaluate(() => {
    document.querySelector("header .stats")!.textContent = "";
    document.querySelector("aspicio-embed")!.setAttribute("src-url", "/sample.dxf?again");
  });
  await expect(page.locator("header .stats")).toContainText("21 ENT");
});
