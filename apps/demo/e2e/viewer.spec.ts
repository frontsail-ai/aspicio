import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { canvasColors, probeViewer } from "./helpers.ts";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const canvas = (page: Page) => page.locator("#viewer canvas");
const row = (page: Page, name: string) =>
  page.locator(".layer-row").filter({ hasText: name }).first();

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function loadSample(page: Page): Promise<void> {
  await page.locator("#empty-sample").click();
  await expect(page.locator("#file-chip")).toHaveText("sample.dxf");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("starts in the empty state with canvas chrome hidden", async ({ page }) => {
  await expect(page.locator("#empty-state")).toBeVisible();
  await expect(page.locator("#empty-state")).toContainText("Open a DXF to view it");
  await expect(page.locator("#controls")).toBeHidden();
  await expect(page.locator("#readout")).toBeHidden();
  await expect(page.locator("#file-status")).toBeHidden();
  await expect(page.locator("#layer-list li")).toHaveCount(0);
});

test("loads the sample with stats, layers, and skip report", async ({ page }) => {
  await loadSample(page);

  await expect(page.locator("#stats")).toHaveText("13 ENT · 226 SEG");
  await expect(page.locator("#skipped-btn")).toContainText("1 SKIPPED");
  await expect(page.locator("#empty-state")).toBeHidden();
  await expect(page.locator("#controls")).toBeVisible();

  const probe = await probeViewer(page);
  expect(probe.entityCount).toBe(13);
  expect(probe.segmentCount).toBe(226);
  expect(probe.unsupported).toEqual({ MTEXT: 1 });
  expect(probe.layers.map((l) => l.name)).toEqual(
    expect.arrayContaining(["WALLS", "DOORS", "FURNITURE", "DECOR", "NOTES"]),
  );
  await expect(page.locator("#layer-list li")).toHaveCount(6);
  await expect(page.locator("#layer-count")).toHaveText("6");
});

test("skipped-entities popover opens with detail and closes outside", async ({ page }) => {
  await loadSample(page);
  await page.locator("#skipped-btn").click();
  await expect(page.locator("#skipped-pop")).toBeVisible();
  await expect(page.locator("#skipped-detail")).toContainText("1 MTEXT");
  await page.locator(".brand").click();
  await expect(page.locator("#skipped-pop")).toBeHidden();
});

test("renders every layer's signature color on the canvas", async ({ page }) => {
  await loadSample(page);
  const colors = await canvasColors(page);
  expect(colors.green).toBeGreaterThan(100); // walls
  expect(colors.red).toBeGreaterThan(20); // door arc
  expect(colors.cyan).toBeGreaterThan(100); // furniture
  expect(colors.magenta).toBeGreaterThan(50); // rug ellipse
});

test("toggling a layer hides and restores its geometry", async ({ page }) => {
  await loadSample(page);
  const furniture = page.getByRole("checkbox", { name: "FURNITURE" });

  await furniture.uncheck();
  await page.waitForTimeout(100);
  let colors = await canvasColors(page);
  expect(colors.cyan).toBeLessThan(10);
  expect(colors.green).toBeGreaterThan(100);

  await furniture.check();
  await page.waitForTimeout(100);
  colors = await canvasColors(page);
  expect(colors.cyan).toBeGreaterThan(100);

  const probe = await probeViewer(page);
  expect(probe.layers.find((l) => l.name === "FURNITURE")?.visible).toBe(true);
});

test("wheel zoom scales the view, anchors the cursor, updates readout", async ({ page }) => {
  await loadSample(page);
  const before = (await probeViewer(page)).view;
  const c = await canvasCenter(page);

  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, -240);
  await page.mouse.wheel(0, -240);

  const after = (await probeViewer(page)).view;
  expect(after.unitsPerPixel).toBeLessThan(before.unitsPerPixel);
  const tolerance = before.unitsPerPixel * 2;
  expect(Math.abs(after.center.x - before.center.x)).toBeLessThan(tolerance);
  expect(Math.abs(after.center.y - before.center.y)).toBeLessThan(tolerance);

  const pct = Number(await page.locator("#zoom-pct").textContent());
  expect(pct).toBeGreaterThan(100);
});

test("drag pans the drawing", async ({ page }) => {
  await loadSample(page);
  const before = (await probeViewer(page)).view;
  const c = await canvasCenter(page);

  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y, { steps: 5 });
  await page.mouse.up();

  const after = (await probeViewer(page)).view;
  expect(after.center.x).toBeLessThan(before.center.x);
  expect(after.center.y).toBeCloseTo(before.center.y, 5);
});

test("shift+drag rotates and updates the rotation readout", async ({ page }) => {
  await loadSample(page);
  const c = await canvasCenter(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(c.x + 200, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y - 150, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const view = (await probeViewer(page)).view;
  expect(Math.abs(view.rotation)).toBeGreaterThan(0.1);
  const deg = Number(await page.locator("#rot-deg").textContent());
  expect(deg).toBeGreaterThan(0);
});

test("double click restores the fitted view (animated)", async ({ page }) => {
  await loadSample(page);
  const initial = (await probeViewer(page)).view;
  const c = await canvasCenter(page);

  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, -480);
  await page.keyboard.down("Shift");
  await page.mouse.move(c.x + 200, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 100, c.y - 150, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await canvas(page).dblclick();
  await expect
    .poll(async () => (await probeViewer(page)).view.unitsPerPixel, { timeout: 2000 })
    .toBeCloseTo(initial.unitsPerPixel, 5);
  const restored = (await probeViewer(page)).view;
  expect(restored.rotation).toBe(0);
  expect(restored.center.x).toBeCloseTo(initial.center.x, 3);
  expect(restored.center.y).toBeCloseTo(initial.center.y, 3);
});

test("canvas control buttons zoom and reset rotation", async ({ page }) => {
  await loadSample(page);
  const initial = (await probeViewer(page)).view;

  await page.locator("#zoom-in").click();
  await expect
    .poll(async () => (await probeViewer(page)).view.unitsPerPixel, { timeout: 1000 })
    .toBeLessThan(initial.unitsPerPixel);

  // Rotate, then reset via the compass button.
  const c = await canvasCenter(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(c.x + 200, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y - 100, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect((await probeViewer(page)).view.rotation).not.toBe(0);

  await page.locator("#reset-rot").click();
  await expect.poll(async () => (await probeViewer(page)).view.rotation, { timeout: 1000 }).toBe(0);

  await page.locator("#fit-btn").click();
  await expect
    .poll(async () => (await probeViewer(page)).view.unitsPerPixel, { timeout: 2000 })
    .toBeCloseTo(initial.unitsPerPixel, 5);
});

test("synthetic two-finger pinch zooms in", async ({ page }) => {
  await loadSample(page);
  const before = (await probeViewer(page)).view;

  await canvas(page).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fire = (type: string, id: number, x: number, y: number): void => {
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: "touch",
          clientX: x,
          clientY: y,
        }),
      );
    };
    fire("pointerdown", 1, cx - 50, cy);
    fire("pointerdown", 2, cx + 50, cy);
    fire("pointermove", 2, cx + 150, cy);
    fire("pointerup", 1, cx - 50, cy);
    fire("pointerup", 2, cx + 150, cy);
  });

  const after = (await probeViewer(page)).view;
  expect(after.unitsPerPixel).toBeCloseTo(before.unitsPerPixel / 2, 5);
});

test("synthetic two-finger twist rotates", async ({ page }) => {
  await loadSample(page);
  await canvas(page).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fire = (type: string, id: number, x: number, y: number): void => {
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: "touch",
          clientX: x,
          clientY: y,
        }),
      );
    };
    fire("pointerdown", 1, cx, cy);
    fire("pointerdown", 2, cx + 100, cy);
    fire("pointermove", 2, cx, cy - 100);
    fire("pointerup", 1, cx, cy);
    fire("pointerup", 2, cx, cy - 100);
  });

  const view = (await probeViewer(page)).view;
  expect(view.rotation).toBeCloseTo(Math.PI / 2, 1);
});

test("hovering a layer row draws that layer thicker", async ({ page }) => {
  await loadSample(page);
  const before = await canvasColors(page);

  await row(page, "WALLS").hover();
  await page.waitForTimeout(150);
  const during = await canvasColors(page);
  expect(during.green).toBeGreaterThan(before.green * 1.8);
  expect(during.cyan).toBeGreaterThan(before.cyan * 0.7);

  await page.locator(".brand").hover();
  await page.waitForTimeout(150);
  const after = await canvasColors(page);
  expect(after.green).toBeLessThan(during.green * 0.7);
});

test("double-clicking a row solos it with banner, again restores", async ({ page }) => {
  await loadSample(page);
  const walls = row(page, "WALLS");

  await walls.dblclick();
  await page.waitForTimeout(150);
  await expect(page.locator("#solo-banner")).toBeVisible();
  await expect(page.locator("#solo-name")).toHaveText("WALLS");
  await expect(walls).toHaveClass(/solo/);

  let probe = await probeViewer(page);
  for (const layer of probe.layers) {
    expect(layer.visible, layer.name).toBe(layer.name === "WALLS");
  }
  let colors = await canvasColors(page);
  expect(colors.green).toBeGreaterThan(100);
  expect(colors.cyan).toBeLessThan(10);

  await walls.dblclick();
  await page.waitForTimeout(150);
  await expect(page.locator("#solo-banner")).toBeHidden();
  probe = await probeViewer(page);
  for (const layer of probe.layers) expect(layer.visible, layer.name).toBe(true);
  colors = await canvasColors(page);
  expect(colors.cyan).toBeGreaterThan(100);
});

test("the solo banner EXIT button restores all layers", async ({ page }) => {
  await loadSample(page);
  await row(page, "DOORS").dblclick();
  await expect(page.locator("#solo-banner")).toBeVisible();
  await page.locator("#exit-solo").click();
  await expect(page.locator("#solo-banner")).toBeHidden();
  const probe = await probeViewer(page);
  for (const layer of probe.layers) expect(layer.visible, layer.name).toBe(true);
});

test("hovering geometry on the canvas reverse-highlights its layer row", async ({ page }) => {
  await loadSample(page);
  const probe = await probeViewer(page);
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");

  // Sample bounds are (0,0)-(100,70) → tessellation offset (50,35);
  // the inner wall runs x=60, y=0..30 — aim at world (60,15).
  const wx = 60 - 50;
  const wy = 15 - 35;
  const sx = box.width / 2 + (wx - probe.view.center.x) / probe.view.unitsPerPixel;
  const sy = box.height / 2 - (wy - probe.view.center.y) / probe.view.unitsPerPixel;

  await page.mouse.move(box.x + sx, box.y + sy);
  await expect(row(page, "WALLS")).toHaveClass(/reverse/);

  await page.mouse.move(box.x + sx + 60, box.y + sy);
  await expect(page.locator(".layer-row.reverse")).toHaveCount(0);
});

test("entity-styled files show effective colors in the layer list", async ({ page }) => {
  // CAM/die-cut exports color every entity individually and leave the layer
  // table at ACI 7 (white). Swatches must show what is actually drawn.
  await page.locator("#file").setInputFiles(fixture("entity-colors.dxf"));
  await expect(page.locator("#file-chip")).toHaveText("entity-colors.dxf");

  const swatchColor = (name: string) =>
    row(page, name)
      .locator(".layer-swatch")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await swatchColor("CUT")).toBe("rgb(255, 0, 0)"); // ACI 1 entities
  expect(await swatchColor("MARK")).toBe("rgb(0, 0, 255)"); // ACI 5 entities
});

test("opens a DXF via the file picker", async ({ page }) => {
  await loadSample(page);
  await page.locator("#file").setInputFiles(fixture("box.dxf"));
  await expect(page.locator("#file-chip")).toHaveText("box.dxf");
  await expect(page.locator("#stats")).toHaveText("1 ENT · 4 SEG");
  await expect(page.locator("#skipped-btn")).toBeHidden();

  const probe = await probeViewer(page);
  expect(probe.layers.map((l) => l.name)).toContain("BOX");
});

test("drag-and-drop shows the overlay, then loads the file", async ({ page }) => {
  await loadSample(page);
  const overlay = page.locator("#drop");
  await expect(overlay).toBeHidden();

  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["placeholder"], "drop.dxf"));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
  });
  await expect(overlay).toBeVisible();

  await page.evaluate(async () => {
    const text = await (await fetch("/sample.dxf")).text();
    const dt = new DataTransfer();
    dt.items.add(new File([text], "dropped.dxf"));
    window.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  });
  await expect(overlay).toBeHidden();
  await expect(page.locator("#file-chip")).toHaveText("dropped.dxf");
});

test("drag leaving the window hides the overlay without loading", async ({ page }) => {
  await loadSample(page);
  const overlay = page.locator("#drop");
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "x.dxf"));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
  });
  await expect(overlay).toBeHidden();
  await expect(page.locator("#file-chip")).toHaveText("sample.dxf");
});

test("an invalid file shows the error toast; dismiss hides it", async ({ page }) => {
  await loadSample(page);
  await page.locator("#file").setInputFiles(fixture("invalid.dxf"));
  await expect(page.locator("#error-toast")).toBeVisible();
  await expect(page.locator("#error-title")).toContainText("Couldn't open invalid.dxf");
  // Previous drawing stays visible under the toast.
  await expect(page.locator("#file-chip")).toHaveText("sample.dxf");

  await page.locator("#error-dismiss").click();
  await expect(page.locator("#error-toast")).toBeHidden();
});

test("error state from the empty state offers recovery actions", async ({ page }) => {
  await page.locator("#file").setInputFiles(fixture("invalid.dxf"));
  await expect(page.locator("#error-toast")).toBeVisible();
  await expect(page.locator("#empty-state")).toBeVisible();
  await page.locator("#error-sample").click();
  await expect(page.locator("#file-chip")).toHaveText("sample.dxf");
  await expect(page.locator("#error-toast")).toBeHidden();
});

test("mobile viewport: layer panel slides in and out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadSample(page);
  const panel = page.locator("#panel");
  const toggle = page.locator("#toggle-layers");

  await expect(toggle).toBeVisible();
  await expect(panel).not.toHaveClass(/open/);

  await toggle.click();
  await expect(panel).toHaveClass(/open/);
  await expect(page.getByRole("checkbox", { name: "WALLS" })).toBeVisible();

  await page.locator("#close-panel").click();
  await expect(panel).not.toHaveClass(/open/);

  // Backdrop click also closes.
  await toggle.click();
  await expect(panel).toHaveClass(/open/);
  // Click the strip of backdrop not covered by the 300px panel.
  await page.locator("#panel-backdrop").click({ position: { x: 355, y: 300 } });
  await expect(panel).not.toHaveClass(/open/);
});

test("canvas resizes with the window without breaking rendering", async ({ page }) => {
  await loadSample(page);
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(150);
  const colors = await canvasColors(page);
  expect(colors.green).toBeGreaterThan(50);
});
