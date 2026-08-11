/**
 * The paper a PDF page is drawn on, and the theme it is drawn in
 * (VIEW-17, VIEW-18, VIEW-19, PDF-10).
 *
 * All of this is renderer behaviour, so per INV-7 it is proven in a browser
 * against real pixels. The assertions count colours rather than compare
 * snapshots: the question is "is there paper under the drawing", which a
 * screenshot diff answers only incidentally and re-fails on every unrelated
 * pixel shift.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import {
  canvasCountNear,
  canvasCountWhere,
  canvasDarkest,
  canvasPixel,
  probeViewer,
} from "./helpers.ts";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const WHITE: [number, number, number] = [255, 255, 255];
const SURROUND_DARK: [number, number, number] = [13, 15, 19];

async function open(page: Page, name: string): Promise<void> {
  await page.locator("#file").setInputFiles(fixture(name));
  await expect(page.locator("#file-chip")).toHaveText(name);
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a vector PDF is drawn on paper, not on the canvas", async ({ page }) => {
  await open(page, "sample.pdf");
  // The fixture paints no white of its own: every white pixel is the sheet.
  // This is the whole of #177 — before it, the count here was zero.
  expect(await canvasCountNear(page, WHITE)).toBeGreaterThan(50_000);
});

test("the sheet is bounded, with the surround visible around it", async ({ page }) => {
  await open(page, "sample.pdf");
  // Paper that filled the viewport would be indistinguishable from a white
  // background, which is not what a page is. Fit frames the page, so there
  // is surround on at least two sides.
  expect(await canvasCountNear(page, SURROUND_DARK, 6)).toBeGreaterThan(5_000);
});

test("DXF model space gets no sheet (it is unbounded)", async ({ page }) => {
  await open(page, "sample.dxf");
  // The degradation path: spaces with no page box are untouched, so a DXF
  // still renders on the blueprint canvas exactly as it always did.
  expect(await canvasCountNear(page, WHITE)).toBeLessThan(500);
});

test("fit frames the whole page, with margin on every side (VIEW-2)", async ({ page }) => {
  await open(page, "page-boxes.pdf");

  // Asserted in pixels rather than on `view.center`, which is always near
  // the origin: tessellation re-centres every position on the bounds, so a
  // fitted camera sits at (0,0) by construction and would "pass" whatever
  // the bounds were.
  //
  // The real claim is that the sheet is fully inside the viewport: every
  // edge midpoint is surround, not paper. Before the page joined the
  // bounds, fit framed the ink and ran the sheet off all four edges.
  for (const [fx, fy] of [
    [0.5, 0.02],
    [0.5, 0.98],
    [0.02, 0.5],
    [0.98, 0.5],
  ] as const) {
    const [r, g, b] = await canvasPixel(page, fx, fy);
    expect(r + g + b, `edge ${fx},${fy} should be surround, got ${r},${g},${b}`).toBeLessThan(150);
  }

  // …and the sheet really is on screen between those edges.
  expect(await canvasCountNear(page, WHITE)).toBeGreaterThan(50_000);
});

test("trim and bleed guides draw on the sheet (VIEW-19)", async ({ page }) => {
  await open(page, "page-boxes.pdf");

  // Counted by predicate, not by nearness to the source colour: the guides
  // are 1px dashed lines on white, so almost every pixel is an antialiased
  // blend towards the paper and only a handful land on the pure ink.
  const reddish = await canvasCountWhere(page, (r, g, b) => r > 150 && r - Math.max(g, b) > 45);
  expect(reddish, "bleed guide").toBeGreaterThan(200);

  const neutral = await canvasCountWhere(
    page,
    (r, g, b) => r > 90 && r < 215 && Math.abs(r - g) < 14 && Math.abs(g - b) < 14,
  );
  expect(neutral, "trim guide").toBeGreaterThan(200);
});

test("the theme toggle repaints without reloading the drawing", async ({ page }) => {
  await open(page, "sample.pdf");
  const before = await probeViewer(page);

  await page.locator("#toggle-theme").click();
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  const after = await probeViewer(page);
  // Same drawing, same camera: a theme switch must not re-parse or re-fit.
  expect(after.entityCount).toBe(before.entityCount);
  expect(after.view.unitsPerPixel).toBeCloseTo(before.view.unitsPerPixel, 6);
  // The paper survives the switch; only what surrounds it changed.
  expect(await canvasCountNear(page, WHITE)).toBeGreaterThan(50_000);
  expect(await canvasCountNear(page, SURROUND_DARK, 6)).toBeLessThan(500);
});

test("light mode darkens DXF pen colours but keeps the panel honest (VIEW-18, INV-2)", async ({
  page,
}) => {
  await open(page, "sample.dxf");
  await page.locator("#toggle-theme").click();
  await page.waitForTimeout(500);

  // ACI green is 1.6:1 on the light canvas and must not survive as-is.
  expect(await canvasCountNear(page, [0, 255, 0], 20)).toBeLessThan(200);

  // …and the swatch has to show what was actually drawn, not the layer
  // table's claim. This is the regression that shipped once already: core
  // re-tessellated correctly while the panel kept painting #00ff00.
  const swatch = page
    .locator(".layer-row")
    .filter({ hasText: "WALLS" })
    .locator(".layer-swatch")
    .first();
  const color = await swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(color).not.toBe("rgb(0, 255, 0)");
});

test("the default DXF pen becomes ink in light mode, not mid-grey (VIEW-18)", async ({ page }) => {
  await open(page, "default-color.dxf");
  // ACI 7 is the default pen and the most common colour in real drawings.
  // It arrives as white, because the palette assumes a black screen.
  expect(await canvasCountNear(page, [255, 255, 255], 12)).toBeGreaterThan(50);

  await page.locator("#toggle-theme").click();
  await page.waitForTimeout(500);
  expect(await canvasCountNear(page, [255, 255, 255], 12)).toBeLessThan(20);

  // The discriminator is how *dark* the darkest pixel gets, not how many are
  // dark: antialiasing spreads a hairline towards the canvas either way, and
  // a pixel count only measures the viewport. Ink is #1c1a17 (mean 25.7); a
  // rule stopping at the contrast target gives #706f6f (mean 111.3) and can
  // never reach below it, whatever the zoom.
  expect(await canvasDarkest(page), "darkest linework pixel").toBeLessThan(70);
});

test("selection stays visible on a light-theme DXF (VIEW-8)", async ({ page }) => {
  await open(page, "default-color.dxf");
  await page.locator("#toggle-theme").click();
  await page.waitForTimeout(500);

  const canvas = page.locator("#viewer canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  // The fixture is a 10x10 box; click the middle of its bottom edge.
  const at = await page.evaluate(() => window.__aspicio!.worldToScreen({ x: 5, y: 0 }));
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await page.waitForTimeout(300);
  await expect(page.locator("#info-panel")).toBeVisible();

  // #8fc8ff is 1.25:1 against the light canvas — a selection nobody can see.
  // The theme supplies #2b78c8, which clears 3:1 on canvas and on paper.
  const selected = await canvasCountWhere(page, (r, g, b) => b > 110 && b - r > 50 && b - g > 25);
  expect(selected, "selection overlay pixels").toBeGreaterThan(100);
});
