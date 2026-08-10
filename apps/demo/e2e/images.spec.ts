/**
 * Raster images on the WebGL canvas (PDF-9, INV-7): the renderer is only
 * verified end-to-end, so image drawing gets browser proof — pixels, not
 * DOM. The flagship fixture is the market's file shape: raster artwork
 * under a vector dieline.
 *
 * The last test runs the real Ghent Output Suite when the acceptance
 * corpus is present (`tmp/pdf-samples/`, fetched by CI, optional locally)
 * — the same gating as core's pdf-images-acceptance suite.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canvasColors, probeViewer } from "./helpers.ts";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const GHENT = fileURLToPath(
  new URL("../../../tmp/pdf-samples/Ghent_PDF-Output-Test-V50_ALL_X4.pdf", import.meta.url),
);

const row = (page: Page, name: string) =>
  page.locator(".layer-row").filter({ hasText: name }).first();

async function loadDieline(page: Page): Promise<void> {
  await page.locator("#file").setInputFiles(fixture("artwork-dieline.pdf"));
  await expect(page.locator("#file-chip")).toHaveText("artwork-dieline.pdf");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("artwork renders under the dieline: raster below, strokes on top", async ({ page }) => {
  await loadDieline(page);

  const probe = await probeViewer(page);
  expect(probe.entityCount).toBe(3); // one image, two dieline strokes
  expect(probe.layers.map((l) => l.name)).toContain("Artwork");

  const colors = await canvasColors(page);
  // The cyan-ish artwork raster dominates the canvas…
  expect(colors.cyan).toBeGreaterThan(2000);
  // …the red cut rectangle survives along the artwork's edges…
  expect(colors.red).toBeGreaterThan(50);
  // …and the green crease runs entirely *inside* the artwork: it is only
  // visible if strokes draw over the image. Z-order regressions erase it.
  expect(colors.green).toBeGreaterThan(20);
});

test("toggling the Artwork layer hides the raster but keeps the dieline", async ({ page }) => {
  await loadDieline(page);
  await row(page, "Artwork").locator(".layer-check").click();
  await page.waitForTimeout(150);

  const colors = await canvasColors(page);
  expect(colors.cyan).toBeLessThan(10); // artwork gone
  expect(colors.red).toBeGreaterThan(50); // dieline still there
  expect(colors.green).toBeGreaterThan(20);
});

test("a baseline JPEG draws on the canvas", async ({ page }) => {
  await page.locator("#file").setInputFiles(fixture("image-jpeg.pdf"));
  await expect(page.locator("#file-chip")).toHaveText("image-jpeg.pdf");

  const probe = await probeViewer(page);
  expect(probe.entityCount).toBe(1);
  expect(probe.unsupported["Image"]).toBeUndefined();

  // The quadrant test card: red, green, and yellow all present (blue has
  // no bucket in the shared color counter).
  const colors = await canvasColors(page);
  expect(colors.red).toBeGreaterThan(100);
  expect(colors.green).toBeGreaterThan(100);
  expect(colors.yellow).toBeGreaterThan(100);
});

// The real prepress suite in the real viewer. Presence is enforced in CI by
// the corpus fetch step (PDF_CORPUS_REQUIRED); locally it may be absent.
test("the Ghent Output Suite renders its images in the browser", async ({ page }) => {
  test.skip(!existsSync(GHENT) && !process.env.PDF_CORPUS_REQUIRED, "corpus not present");
  expect(existsSync(GHENT), "corpus required but missing").toBe(true);

  await page.locator("#file").setInputFiles(GHENT);
  await expect(page.locator("#file-chip")).toHaveText("Ghent_PDF-Output-Test-V50_ALL_X4.pdf");

  const probe = await probeViewer(page);
  // Page 1 carries 12 images (pinned in core's acceptance suite); with them
  // drawn the skipped count drops to the undecodable codecs only.
  expect(probe.entityCount).toBeGreaterThan(900);
  expect(probe.unsupported["Image"]).toBe(18);

  // Visual smoke: page 1 renders substantial signature-colour content.
  // (The precise per-image pixel proofs live in the committed fixtures;
  // this guards the real file rendering end to end in a browser.)
  const colors = await canvasColors(page);
  const total = colors.red + colors.green + colors.cyan + colors.magenta + colors.yellow;
  expect(total).toBeGreaterThan(1000);
});
