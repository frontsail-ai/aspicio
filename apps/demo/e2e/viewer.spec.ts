import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
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

  await expect(page.locator("#stats")).toHaveText("21 ENT · 485 SEG");
  await expect(page.locator("#skipped-btn")).toContainText("1 SKIPPED");
  await expect(page.locator("#empty-state")).toBeHidden();
  await expect(page.locator("#controls")).toBeVisible();

  const probe = await probeViewer(page);
  expect(probe.entityCount).toBe(21);
  expect(probe.segmentCount).toBe(485);
  expect(probe.unsupported).toEqual({ ATTDEF: 1 });
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
  await expect(page.locator("#skipped-detail")).toContainText("1 ATTDEF");
  await page.locator(".brand").click();
  await expect(page.locator("#skipped-pop")).toBeHidden();
});

test("renders every layer's signature color on the canvas", async ({ page }) => {
  await loadSample(page);
  const colors = await canvasColors(page);
  expect(colors.green).toBeGreaterThan(100); // walls
  expect(colors.red).toBeGreaterThan(20); // door arc
  expect(colors.cyan).toBeGreaterThan(100); // furniture
  expect(colors.magenta).toBeGreaterThan(50); // rug ellipse + spline
  expect(colors.yellow).toBeGreaterThan(100); // TEXT / MTEXT on NOTES
});

test("renders TEXT and MTEXT as stroke glyphs (NOTES layer, soloed)", async ({ page }) => {
  await loadSample(page);
  // Solo NOTES: only the text ("ROOM A" + "Floor plan") remains, in yellow.
  await row(page, "NOTES").dblclick();
  await page.waitForTimeout(150);
  const colors = await canvasColors(page);
  expect(colors.yellow).toBeGreaterThan(100); // glyph strokes present
  expect(colors.cyan).toBeLessThan(10); // furniture hidden
  expect(colors.green).toBeLessThan(10); // walls hidden
});

test("renders the SPLINE curve (DECOR layer, soloed)", async ({ page }) => {
  await loadSample(page);
  await row(page, "DECOR").dblclick();
  await page.waitForTimeout(150);
  const colors = await canvasColors(page);
  // DECOR carries the ellipse and the spline — both magenta, everything else gone.
  expect(colors.magenta).toBeGreaterThan(80);
  expect(colors.green).toBeLessThan(10);
});

test("renders SOLID entities as filled regions (DOORS layer, soloed)", async ({ page }) => {
  await loadSample(page);
  await row(page, "DOORS").dblclick();
  await page.waitForTimeout(150);
  const colors = await canvasColors(page);
  // DOORS carries a thin arc + a filled SOLID arrowhead. The solid block dwarfs
  // the outline — proof the fill pipeline runs, not just line tessellation.
  expect(colors.red).toBeGreaterThan(600);
  expect(colors.green).toBeLessThan(10);
});

test("renders a solid HATCH as a filled block (FURNITURE layer, soloed)", async ({ page }) => {
  await loadSample(page);
  await row(page, "FURNITURE").dblclick();
  await page.waitForTimeout(150);
  const colors = await canvasColors(page);
  // The cyan HATCH rectangle is a dense fill — far more pixels than any outline.
  expect(colors.cyan).toBeGreaterThan(3000);
  expect(colors.green).toBeLessThan(10);
});

test("renders DIMENSION geometry — block lines, arrowheads, and text (NOTES soloed)", async ({
  page,
}) => {
  await loadSample(page);
  await row(page, "NOTES").dblclick();
  await page.waitForTimeout(150);
  const colors = await canvasColors(page);
  // NOTES = two text strings PLUS the *D1 dimension block (extension/dim lines,
  // two filled SOLID arrowheads, and the "100" value). Yellow far exceeds what
  // the glyphs alone produce, confirming the DIMENSION block was expanded.
  expect(colors.yellow).toBeGreaterThan(1500);
  expect(colors.cyan).toBeLessThan(10);
});

test("parses per-entity lineweights (group 370)", async ({ page }) => {
  await loadSample(page);
  const weights = await page.evaluate(() => {
    const doc = window.__aspicio?.document;
    const arc = doc?.entities.find((e) => e.type === "ARC");
    const doorLine = doc?.entities.find((e) => e.type === "LINE" && e.layer === "DOORS");
    const circle = doc?.entities.find((e) => e.type === "CIRCLE");
    return { arc: arc?.lineWeight, doorLine: doorLine?.lineWeight, circle: circle?.lineWeight };
  });
  // The door swing arc is bold (1.0 mm); the door line and table are lighter.
  expect(weights.arc).toBe(100);
  expect(weights.doorLine).toBe(50);
  expect(weights.circle).toBe(50);
});

test("clicking an entity selects it and shows a measured info panel", async ({ page }) => {
  await loadSample(page);
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");
  // The round table is a CIRCLE at world (30,45), r=8 — click its top edge.
  const top = await page.evaluate(() => window.__aspicio!.worldToScreen({ x: 30, y: 53 }));
  await page.mouse.click(box.x + top.x, box.y + top.y);

  await expect(page.locator("#info-panel")).toBeVisible();
  await expect(page.locator("#info-type")).toHaveText("CIRCLE");
  await expect(page.locator("#info-rows")).toContainText("RADIUS");
  await expect(page.locator("#info-rows")).toContainText("FURNITURE");
  expect(await page.evaluate(() => window.__demo?.selectedIndex)).not.toBeNull();

  // Clicking empty space clears the selection.
  await page.mouse.click(box.x + 6, box.y + 6);
  await expect(page.locator("#info-panel")).toBeHidden();
  expect(await page.evaluate(() => window.__demo?.selectedIndex)).toBeNull();
});

/** Screen point of the round table's edge (a CIRCLE at world 30,45, r=8). */
async function clickTable(page: Page): Promise<void> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");
  const p = await page.evaluate(() => window.__aspicio!.worldToScreen({ x: 30, y: 53 }));
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

test("keyboard: ? opens the shortcuts cheat sheet, Esc closes it", async ({ page }) => {
  await loadSample(page);
  await page.keyboard.press("?");
  await expect(page.locator("#shortcuts")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#shortcuts")).toBeHidden();
});

test("keyboard: F refits and M toggles the measure tool", async ({ page }) => {
  await loadSample(page);
  const baseline = (await probeViewer(page)).view.unitsPerPixel;
  const c = await canvasCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, -300);
  await page.keyboard.press("f");
  await expect
    .poll(async () => (await probeViewer(page)).view.unitsPerPixel, { timeout: 2000 })
    .toBeCloseTo(baseline, 5);

  await page.keyboard.press("m");
  expect(await page.evaluate(() => window.__demo?.measureActive)).toBe(true);
  await page.keyboard.press("m");
  expect(await page.evaluate(() => window.__demo?.measureActive)).toBe(false);
});

test("selection shortcuts: I isolates, A shows all, H hides the layer", async ({ page }) => {
  await loadSample(page);
  await clickTable(page);
  await expect(page.locator("#info-type")).toHaveText("CIRCLE");

  await page.keyboard.press("i"); // isolate FURNITURE
  let probe = await probeViewer(page);
  for (const l of probe.layers) expect(l.visible, l.name).toBe(l.name === "FURNITURE");

  await page.keyboard.press("a"); // show all
  probe = await probeViewer(page);
  for (const l of probe.layers) expect(l.visible, l.name).toBe(true);

  await clickTable(page);
  await page.keyboard.press("h"); // hide FURNITURE + drop selection
  await expect(page.locator("#info-panel")).toBeHidden();
  expect((await probeViewer(page)).layers.find((l) => l.name === "FURNITURE")?.visible).toBe(false);
});

test("the info-panel action buttons mirror the selection shortcuts", async ({ page }) => {
  await loadSample(page);
  await clickTable(page);
  await page.locator("#info-isolate").click();
  const probe = await probeViewer(page);
  for (const l of probe.layers) expect(l.visible, l.name).toBe(l.name === "FURNITURE");
});

test("keyboard: C copies the selection details to the clipboard", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await loadSample(page);
  await clickTable(page);
  await page.keyboard.press("c");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("CIRCLE");
  expect(text).toContain("radius: 8");
  expect(text).toContain("layer: FURNITURE");
});

test("the cursor coordinate readout tracks the pointer in world units", async ({ page }) => {
  await loadSample(page);
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");
  const s = await page.evaluate(() => window.__aspicio!.worldToScreen({ x: 50, y: 35 }));
  await page.mouse.move(box.x + s.x, box.y + s.y);
  await expect
    .poll(async () => Number(await page.locator("#cur-x").textContent()))
    .toBeGreaterThan(48);
  const x = Number(await page.locator("#cur-x").textContent());
  const y = Number(await page.locator("#cur-y").textContent());
  expect(Math.abs(x - 50)).toBeLessThan(1.5);
  expect(Math.abs(y - 35)).toBeLessThan(1.5);
});

test("the measure tool reports segment length, total, and area", async ({ page }) => {
  await loadSample(page);
  await page.locator("#measure-btn").click();
  expect(await page.evaluate(() => window.__demo?.measureActive)).toBe(true);

  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");
  // A right triangle in world units: (0,0)→(60,0)→(60,40). Perimeter-so-far
  // for the two placed legs is 60+40=100; enclosed area is 60·40/2 = 1200.
  const pts = await page.evaluate(() =>
    [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 40 },
    ].map((p) => window.__aspicio!.worldToScreen(p)),
  );
  for (const p of pts) await page.mouse.click(box.x + p.x, box.y + p.y);
  expect(await page.evaluate(() => window.__demo?.measurePoints.length)).toBe(3);

  // Values carry a unit suffix ("100 mm") — parseFloat reads the leading number.
  const total = parseFloat((await page.locator("#measure-total").textContent()) ?? "");
  const area = parseFloat((await page.locator("#measure-area").textContent()) ?? "");
  expect(Math.abs(total - 100)).toBeLessThan(2);
  expect(Math.abs(area - 1200)).toBeLessThan(50);

  // Escape clears the path, then exits the tool.
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await page.evaluate(() => window.__demo?.measurePoints.length)) ?? -1)
    .toBe(0);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__demo?.measureActive)).toBe(false);
});

test("the measure tool snaps to geometry (exact endpoint and center)", async ({ page }) => {
  await loadSample(page);
  await page.locator("#measure-btn").click();
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("no canvas box");

  // A few px off the outer wall corner (world 0,0) still snaps exactly to it.
  const corner = await page.evaluate(() => window.__aspicio!.worldToScreen({ x: 0, y: 0 }));
  const snap = await page.evaluate((c) => window.__demo!.snapAt(c.x + 4, c.y - 4), corner);
  expect(snap?.kind).toBe("endpoint");
  expect(snap?.point).toEqual({ x: 0, y: 0 });

  // Placing records the snapped point, not the raw cursor.
  await page.mouse.click(box.x + corner.x + 4, box.y + corner.y - 4);
  const pts = await page.evaluate(() => window.__demo!.measurePoints);
  expect(pts[0]).toEqual({ x: 0, y: 0 });

  // Hovering the round table's center draws a snap marker.
  const center = await page.evaluate(() => window.__aspicio!.worldToScreen({ x: 30, y: 45 }));
  await page.mouse.move(box.x + center.x + 3, box.y + center.y + 3);
  await expect(page.locator(".measure-snap")).toHaveCount(1);
});

test("reports drawing units (mm) with a scale bar and measure suffix", async ({ page }) => {
  await loadSample(page);
  expect(await page.evaluate(() => window.__aspicio!.document?.units)).toBe("mm");
  await expect(page.locator("#scale-bar")).toBeVisible();
  await expect(page.locator("#scale-label")).toContainText("mm");
});

test("exports the drawing as a downloadable SVG and PNG", async ({ page }) => {
  await loadSample(page);

  await page.locator("#export-btn").click();
  const [svg] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-svg").click(),
  ]);
  expect(svg.suggestedFilename()).toBe("sample.svg");
  const path = await svg.path();
  const content = await readFile(path, "utf8");
  expect(content).toContain("<svg");
  expect(content).toContain("viewBox=");

  await page.locator("#export-btn").click();
  const [png] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-png").click(),
  ]);
  expect(png.suggestedFilename()).toBe("sample.png");
});

test("model-only files show no space tabs", async ({ page }) => {
  await loadSample(page);
  expect(await page.evaluate(() => window.__aspicio!.getSpaces())).toEqual(["Model"]);
  await expect(page.locator("#space-tabs")).toBeHidden();
});

test("paper-space layouts appear as tabs and switch model ↔ sheet", async ({ page }) => {
  await page.locator("#file").setInputFiles(fixture("layout.dxf"));
  await expect(page.locator("#file-chip")).toHaveText("layout.dxf");

  // Model space + one paper layout, offered as two tabs.
  expect(await page.evaluate(() => window.__aspicio!.getSpaces())).toEqual(["Model", "Layout1"]);
  await expect(page.locator("#space-tabs")).toBeVisible();
  await expect(page.locator(".space-tab")).toHaveCount(2);
  await expect(page.locator(".space-tab.active")).toHaveText("Model");

  // Model space draws its geometry (green MODEL layer).
  expect((await canvasColors(page)).green).toBeGreaterThan(100);

  // Switching to the layout re-fits and renders the sheet + scaled model.
  await page.locator(".space-tab", { hasText: "Layout1" }).click();
  await expect(page.locator(".space-tab.active")).toHaveText("Layout1");
  expect(await page.evaluate(() => window.__aspicio!.activeSpaceName)).toBe("Layout1");
  expect((await canvasColors(page)).green).toBeGreaterThan(100); // model inside the viewport
});

test("parse separates model entities from the layout's paper geometry", async ({ page }) => {
  await page.locator("#file").setInputFiles(fixture("layout.dxf"));
  await expect(page.locator("#file-chip")).toHaveText("layout.dxf");
  const split = await page.evaluate(() => {
    const doc = window.__aspicio!.document!;
    return { model: doc.entities.length, layout: doc.layouts?.[0].entities.length };
  });
  expect(split.model).toBe(4); // rect, diagonal, circle, overshoot
  expect(split.layout).toBe(3); // border, titleblock box, text
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

test("double-clicking a row solos it; double-clicking again shows all but that layer", async ({
  page,
}) => {
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

  // Double-click in solo leaves solo, showing everything BUT the clicked layer.
  await walls.dblclick();
  await page.waitForTimeout(150);
  await expect(page.locator("#solo-banner")).toBeHidden();
  probe = await probeViewer(page);
  for (const layer of probe.layers) expect(layer.visible, layer.name).toBe(layer.name !== "WALLS");
  colors = await canvasColors(page);
  expect(colors.cyan).toBeGreaterThan(100); // furniture back
  expect(colors.green).toBeLessThan(10); // walls now hidden
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

test("single-clicking a layer row toggles that layer's visibility", async ({ page }) => {
  await loadSample(page);
  const box = await row(page, "DOORS").boundingBox();
  if (!box) throw new Error("no row box");
  // Click the name area (well clear of the checkbox on the far left).
  const clickRow = () => page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  const doorsVisible = async () =>
    (await probeViewer(page)).layers.find((l) => l.name === "DOORS")?.visible;

  await clickRow();
  await expect.poll(doorsVisible).toBe(false);
  await clickRow();
  await expect.poll(doorsVisible).toBe(true);
});

test("single-clicking a row while soloing exits solo and shows every layer", async ({ page }) => {
  await loadSample(page);
  await row(page, "WALLS").dblclick();
  await expect(page.locator("#solo-banner")).toBeVisible();

  const box = await row(page, "DOORS").boundingBox();
  if (!box) throw new Error("no row box");
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);

  // A single click in solo just leaves solo — every layer visible again.
  await expect(page.locator("#solo-banner")).toBeHidden();
  await expect
    .poll(async () => (await probeViewer(page)).layers.every((l) => l.visible))
    .toBe(true);
});

test("double-clicking a row while soloing shows every layer but that one", async ({ page }) => {
  await loadSample(page);
  await row(page, "WALLS").dblclick();
  await expect(page.locator("#solo-banner")).toBeVisible();

  await row(page, "DOORS").dblclick();

  // Double-click in solo leaves solo, hiding only the clicked layer.
  await expect(page.locator("#solo-banner")).toBeHidden();
  const probe = await probeViewer(page);
  for (const l of probe.layers) expect(l.visible, l.name).toBe(l.name !== "DOORS");
});

test("entering solo does not shift the rows — a second click at the same spot toggles it", async ({
  page,
}) => {
  await loadSample(page);
  const doors = row(page, "DOORS");
  const before = await doors.boundingBox();
  if (!before) throw new Error("no row box");

  await doors.dblclick();
  await expect(page.locator("#solo-banner")).toBeVisible();
  const after = await doors.boundingBox();
  if (!after) throw new Error("no row box");
  // The banner overlays the header slot instead of pushing the list down.
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);

  // A double-click at the ORIGINAL cursor position lands on the same row and
  // exits solo — the whole point of not shifting the rows. Double-click in
  // solo shows all but the clicked (DOORS) row, proving it hit the same row.
  await page.mouse.dblclick(before.x + before.width / 2, before.y + before.height / 2);
  await expect(page.locator("#solo-banner")).toBeHidden();
  const probe = await probeViewer(page);
  for (const layer of probe.layers) expect(layer.visible, layer.name).toBe(layer.name !== "DOORS");
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
