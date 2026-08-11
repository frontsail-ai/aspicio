import type { Page } from "@playwright/test";
import { PNG } from "pngjs";

/** Camera + stats snapshot pulled from the window.__aspicio test hook. */
export interface ViewerProbe {
  entityCount: number;
  segmentCount: number;
  unsupported: Record<string, number>;
  layers: { name: string; visible: boolean }[];
  view: { center: { x: number; y: number }; unitsPerPixel: number; rotation: number };
}

export async function probeViewer(page: Page): Promise<ViewerProbe> {
  return page.evaluate(() => {
    const viewer = window.__aspicio;
    if (!viewer) throw new Error("test hook missing");
    return {
      entityCount: viewer.stats.entityCount,
      segmentCount: viewer.stats.segmentCount,
      unsupported: viewer.stats.unsupported,
      layers: viewer.getLayers().map((l) => ({ name: l.name, visible: l.visible })),
      view: viewer.view,
    };
  });
}

/** Count pixels per signature color on the sample drawing. */
export interface ColorCounts {
  green: number;
  red: number;
  cyan: number;
  magenta: number;
  yellow: number;
}

export function countColors(buffer: Buffer): ColorCounts {
  const png = PNG.sync.read(buffer);
  const counts: ColorCounts = { green: 0, red: 0, cyan: 0, magenta: 0, yellow: 0 };
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (r > 140 && g > 140 && b < 90) counts.yellow += 1;
    else if (g > 140 && r < 90 && b < 90) counts.green += 1;
    else if (r > 140 && g < 90 && b < 90) counts.red += 1;
    else if (g > 140 && b > 140 && r < 90) counts.cyan += 1;
    else if (r > 140 && b > 140 && g < 90) counts.magenta += 1;
  }
  return counts;
}

export async function canvasColors(page: Page): Promise<ColorCounts> {
  const shot = await page.locator("#viewer canvas").screenshot();
  return countColors(shot);
}

/**
 * Pixels matching one colour, within `tolerance` per channel.
 *
 * {@link countColors} buckets only saturated hues, so it is blind to paper,
 * the surround, and every neutral the page backdrop introduced — a sheet
 * could vanish entirely without moving one of its counters.
 */
export function countNear(buffer: Buffer, rgb: [number, number, number], tolerance = 10): number {
  const png = PNG.sync.read(buffer);
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (
      Math.abs(png.data[i] - rgb[0]) <= tolerance &&
      Math.abs(png.data[i + 1] - rgb[1]) <= tolerance &&
      Math.abs(png.data[i + 2] - rgb[2]) <= tolerance
    )
      n += 1;
  }
  return n;
}

/** Pixels satisfying an arbitrary predicate — for hues no bucket names. */
export function countWhere(
  buffer: Buffer,
  match: (r: number, g: number, b: number) => boolean,
): number {
  const png = PNG.sync.read(buffer);
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4)
    if (match(png.data[i], png.data[i + 1], png.data[i + 2])) n += 1;
  return n;
}

/** {@link countWhere} against the live canvas. */
export async function canvasCountWhere(
  page: Page,
  match: (r: number, g: number, b: number) => boolean,
): Promise<number> {
  return countWhere(await page.locator("#viewer canvas").screenshot(), match);
}

/** The colour at one point of the canvas, given as viewport fractions. */
export async function canvasPixel(
  page: Page,
  fx: number,
  fy: number,
): Promise<[number, number, number]> {
  const png = PNG.sync.read(await page.locator("#viewer canvas").screenshot());
  const x = Math.min(png.width - 1, Math.max(0, Math.round(png.width * fx)));
  const y = Math.min(png.height - 1, Math.max(0, Math.round(png.height * fy)));
  const i = (png.width * y + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

/**
 * The channel-mean of the darkest pixel on the canvas.
 *
 * Scale-invariant, unlike a pixel count: how *dark* the darkest pixel gets
 * says which colour was drawn, while how *many* dark pixels there are says
 * only how big the viewport was.
 */
export async function canvasDarkest(page: Page): Promise<number> {
  const png = PNG.sync.read(await page.locator("#viewer canvas").screenshot());
  let min = 255;
  for (let i = 0; i < png.data.length; i += 4) {
    const mean = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
    if (mean < min) min = mean;
  }
  return min;
}

/** {@link countNear} against the live canvas. */
export async function canvasCountNear(
  page: Page,
  rgb: [number, number, number],
  tolerance = 10,
): Promise<number> {
  return countNear(await page.locator("#viewer canvas").screenshot(), rgb, tolerance);
}
