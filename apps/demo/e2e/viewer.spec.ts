import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { canvasColors, probeViewer } from "./helpers.ts";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const status = (page: Page) => page.locator("#status");
const canvas = (page: Page) => page.locator("#viewer canvas");

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toContainText("sample.dxf —");
});

test("loads the sample with correct stats, layers, and skip report", async ({ page }) => {
  await expect(status(page)).toContainText("13 entities, 226 segments");
  await expect(status(page)).toContainText("skipped: 1 MTEXT");

  const probe = await probeViewer(page);
  expect(probe.entityCount).toBe(13);
  expect(probe.segmentCount).toBe(226);
  expect(probe.unsupported).toEqual({ MTEXT: 1 });
  expect(probe.layers.map((l) => l.name)).toEqual(
    expect.arrayContaining(["WALLS", "DOORS", "FURNITURE", "DECOR", "NOTES"]),
  );
  await expect(page.locator("#layer-list li")).toHaveCount(6);
});

test("renders every layer's signature color on the canvas", async ({ page }) => {
  const colors = await canvasColors(page);
  expect(colors.green).toBeGreaterThan(100); // walls
  expect(colors.red).toBeGreaterThan(20); // door arc
  expect(colors.cyan).toBeGreaterThan(100); // furniture
  expect(colors.magenta).toBeGreaterThan(50); // rug ellipse
});

test("toggling a layer hides and restores its geometry", async ({ page }) => {
  const furniture = page.getByRole("checkbox", { name: "FURNITURE" });

  await furniture.uncheck();
  await page.waitForTimeout(100); // one rAF for the re-render
  let colors = await canvasColors(page);
  expect(colors.cyan).toBeLessThan(10);
  expect(colors.green).toBeGreaterThan(100); // others untouched

  await furniture.check();
  await page.waitForTimeout(100);
  colors = await canvasColors(page);
  expect(colors.cyan).toBeGreaterThan(100);

  const probe = await probeViewer(page);
  expect(probe.layers.find((l) => l.name === "FURNITURE")?.visible).toBe(true);
});

test("wheel zoom scales the view and anchors the cursor point", async ({ page }) => {
  const before = (await probeViewer(page)).view;
  const c = await canvasCenter(page);

  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, -240);
  await page.mouse.wheel(0, -240);

  const after = (await probeViewer(page)).view;
  expect(after.unitsPerPixel).toBeLessThan(before.unitsPerPixel);
  // Zooming at the viewport center must not move the center
  // (allow ~2px of drift: mouse coordinates land on integer pixels).
  const tolerance = before.unitsPerPixel * 2;
  expect(Math.abs(after.center.x - before.center.x)).toBeLessThan(tolerance);
  expect(Math.abs(after.center.y - before.center.y)).toBeLessThan(tolerance);
});

test("drag pans the drawing", async ({ page }) => {
  const before = (await probeViewer(page)).view;
  const c = await canvasCenter(page);

  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y, { steps: 5 });
  await page.mouse.up();

  const after = (await probeViewer(page)).view;
  // Dragging right moves the view center left in world space.
  expect(after.center.x).toBeLessThan(before.center.x);
  expect(after.center.y).toBeCloseTo(before.center.y, 5);
});

test("shift+drag rotates", async ({ page }) => {
  const c = await canvasCenter(page);
  await page.keyboard.down("Shift");
  await page.mouse.move(c.x + 200, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y - 150, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const view = (await probeViewer(page)).view;
  expect(Math.abs(view.rotation)).toBeGreaterThan(0.1);
});

test("double click restores the fitted view", async ({ page }) => {
  const initial = (await probeViewer(page)).view;
  const c = await canvasCenter(page);

  // Mess up the camera.
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, -480);
  await page.keyboard.down("Shift");
  await page.mouse.move(c.x + 200, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 100, c.y - 150, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await canvas(page).dblclick();
  // The reset is animated; wait for it to settle.
  await expect
    .poll(async () => (await probeViewer(page)).view.unitsPerPixel, { timeout: 2000 })
    .toBeCloseTo(initial.unitsPerPixel, 5);
  const restored = (await probeViewer(page)).view;
  expect(restored.rotation).toBe(0);
  expect(restored.center.x).toBeCloseTo(initial.center.x, 3);
  expect(restored.center.y).toBeCloseTo(initial.center.y, 3);
});

test("synthetic two-finger pinch zooms in", async ({ page }) => {
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
    fire("pointermove", 2, cx + 150, cy); // spread: 100px → 200px
    fire("pointerup", 1, cx - 50, cy);
    fire("pointerup", 2, cx + 150, cy);
  });

  const after = (await probeViewer(page)).view;
  expect(after.unitsPerPixel).toBeCloseTo(before.unitsPerPixel / 2, 5);
});

test("synthetic two-finger twist rotates", async ({ page }) => {
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
    fire("pointermove", 2, cx, cy - 100); // finger 2 sweeps 90° visually CCW
    fire("pointerup", 1, cx, cy);
    fire("pointerup", 2, cx, cy - 100);
  });

  const view = (await probeViewer(page)).view;
  expect(view.rotation).toBeCloseTo(Math.PI / 2, 1);
});

test("opens a DXF via the file picker", async ({ page }) => {
  await page.locator("#open").click();
  await page.locator("#file").setInputFiles(fixture("box.dxf"));
  await expect(status(page)).toContainText("box.dxf — 1 entities, 4 segments");

  const probe = await probeViewer(page);
  expect(probe.layers.map((l) => l.name)).toContain("BOX");
});

test("drag-and-drop shows the overlay, then loads the file", async ({ page }) => {
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
  await expect(status(page)).toContainText("dropped.dxf — 13 entities");
});

test("drag leaving the window hides the overlay without loading", async ({ page }) => {
  const overlay = page.locator("#drop");
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "x.dxf"));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
  });
  await expect(overlay).toBeHidden();
  await expect(status(page)).toContainText("sample.dxf —");
});

test("an invalid file reports a load failure", async ({ page }) => {
  await page.locator("#file").setInputFiles(fixture("invalid.dxf"));
  await expect(status(page)).toContainText("Failed to load invalid.dxf");
});

test("mobile viewport: layer panel slides in and out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.locator("#panel");
  const toggle = page.locator("#toggle-layers");

  await expect(toggle).toBeVisible();
  await expect(panel).not.toHaveClass(/open/);

  await toggle.click();
  await expect(panel).toHaveClass(/open/);
  await expect(page.getByRole("checkbox", { name: "WALLS" })).toBeVisible();

  await toggle.click();
  await expect(panel).not.toHaveClass(/open/);
});

test("hovering a layer row draws that layer thicker", async ({ page }) => {
  const before = await canvasColors(page);

  await page.locator("#layer-list label", { hasText: "WALLS" }).hover();
  await page.waitForTimeout(150);
  const during = await canvasColors(page);
  // 3px overlay lines on top of 1px ones → far more green pixels.
  expect(during.green).toBeGreaterThan(before.green * 1.8);
  // Other layers unchanged (rough band, antialiasing wiggles a little).
  expect(during.cyan).toBeGreaterThan(before.cyan * 0.7);

  // Moving off the row removes the highlight.
  await page.locator(".brand").hover();
  await page.waitForTimeout(150);
  const after = await canvasColors(page);
  expect(after.green).toBeLessThan(during.green * 0.7);
});

test("double-clicking a layer row solos it, double-clicking again restores", async ({ page }) => {
  const walls = page.locator("#layer-list label", { hasText: "WALLS" });

  await walls.dblclick();
  await page.waitForTimeout(150);
  let probe = await probeViewer(page);
  for (const layer of probe.layers) {
    expect(layer.visible, layer.name).toBe(layer.name === "WALLS");
  }
  let colors = await canvasColors(page);
  expect(colors.green).toBeGreaterThan(100);
  expect(colors.cyan).toBeLessThan(10);
  expect(colors.magenta).toBeLessThan(10);

  await walls.dblclick();
  await page.waitForTimeout(150);
  probe = await probeViewer(page);
  for (const layer of probe.layers) expect(layer.visible, layer.name).toBe(true);
  colors = await canvasColors(page);
  expect(colors.cyan).toBeGreaterThan(100);
});

test("hovering geometry on the canvas highlights its layer row", async ({ page }) => {
  const probe = await probeViewer(page);
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");

  // Sample bounds are (0,0)-(100,70) → tessellation offset (50,35).
  // The inner wall line runs x=60, y=0..30; aim at world (60,15).
  const wx = 60 - 50;
  const wy = 15 - 35;
  const sx = box.width / 2 + (wx - probe.view.center.x) / probe.view.unitsPerPixel;
  const sy = box.height / 2 - (wy - probe.view.center.y) / probe.view.unitsPerPixel;

  await page.mouse.move(box.x + sx, box.y + sy);
  await expect(page.locator("#layer-list li", { hasText: "WALLS" })).toHaveClass(/hovered/);

  // Move to empty space → highlight clears.
  await page.mouse.move(box.x + sx + 60, box.y + sy);
  await expect(page.locator("#layer-list li.hovered")).toHaveCount(0);
});

test("double-clicking the canvas animates the pose reset", async ({ page }) => {
  const fitted = (await probeViewer(page)).view;
  const c = await canvasCenter(page);

  // Zoom well in so the animation has distance to cover.
  await page.mouse.move(c.x, c.y);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -240);
  const zoomed = (await probeViewer(page)).view;
  expect(zoomed.unitsPerPixel).toBeLessThan(fitted.unitsPerPixel / 2);

  await canvas(page).dblclick();
  // Immediately after the double click the camera must still be in flight…
  const mid = (await probeViewer(page)).view;
  expect(mid.unitsPerPixel).toBeLessThan(fitted.unitsPerPixel * 0.98);
  // …and settle at the fitted pose when the animation completes.
  await expect
    .poll(async () => (await probeViewer(page)).view.unitsPerPixel, { timeout: 2000 })
    .toBeCloseTo(fitted.unitsPerPixel, 5);
});

test("canvas resizes with the window without breaking rendering", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(150);
  const colors = await canvasColors(page);
  expect(colors.green).toBeGreaterThan(50);
});
