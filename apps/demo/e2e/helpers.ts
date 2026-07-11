import type { Page } from "@playwright/test";
import { PNG } from "pngjs";

/** Camera + stats snapshot pulled from the window.__observo test hook. */
export interface ViewerProbe {
  entityCount: number;
  segmentCount: number;
  unsupported: Record<string, number>;
  layers: { name: string; visible: boolean }[];
  view: { center: { x: number; y: number }; unitsPerPixel: number; rotation: number };
}

export async function probeViewer(page: Page): Promise<ViewerProbe> {
  return page.evaluate(() => {
    const viewer = window.__observo;
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
}

export function countColors(buffer: Buffer): ColorCounts {
  const png = PNG.sync.read(buffer);
  const counts: ColorCounts = { green: 0, red: 0, cyan: 0, magenta: 0 };
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (g > 140 && r < 90 && b < 90) counts.green += 1;
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
