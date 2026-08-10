/**
 * The SVG export's embedded raster images rasterize correctly through resvg
 * — the engine behind every headless PNG this server returns. Placement and
 * row order are asserted per corner, because the classic failure modes
 * (flipped rows, transposed axes, wrong matrix composition) each move a
 * corner somewhere it shouldn't be. Complements core's image-entity tests,
 * which stop at the SVG string.
 */
import { Resvg } from "@resvg/resvg-js";
import { tessellate, tessellationToSvg } from "@aspicio/core";
import type { DrawingDocument } from "@aspicio/core";
import { expect, test } from "vite-plus/test";

test("an embedded image renders with every corner in place", () => {
  // 2×2 image, distinct corners: rgba rows are top-to-bottom, so row 0 is
  // the image's top edge — TL=red, TR=green, BL=blue, BR=white.
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const doc: DrawingDocument = {
    layers: new Map([["0", { name: "0", color: 0, visible: true, frozen: false, entityCount: 0 }]]),
    entities: [
      {
        type: "IMAGE",
        layer: "0",
        color: null,
        transform: [100, 0, 0, 100, 0, 0],
        image: { width: 2, height: 2, rgba },
      },
    ],
    blocks: new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };

  const svg = tessellationToSvg(tessellate(doc));
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: 100 } }).render();
  expect(rendered.width).toBe(100);

  const px = (x: number, y: number): number[] => {
    const i = (y * rendered.width + x) * 4;
    return [...rendered.pixels.subarray(i, i + 3)];
  };
  // The rendered PNG is y-down, the drawing y-up: the drawing's top edge is
  // the PNG's top rows. Sample well inside each quadrant (bilinear filtering
  // softens the seams), dominant channel ≥ 200, foreign channels ≤ 60.
  const dominant = ([x, y]: [number, number], on: number[], off: number[]): void => {
    const p = px(x, y);
    for (const ch of on) expect(p[ch], `px(${x},${y})[${ch}]`).toBeGreaterThan(200);
    for (const ch of off) expect(p[ch], `px(${x},${y})[${ch}]`).toBeLessThan(60);
  };
  dominant([25, 25], [0], [1, 2]); // top-left: red
  dominant([75, 25], [1], [0, 2]); // top-right: green
  dominant([25, 75], [2], [0, 1]); // bottom-left: blue
  dominant([75, 75], [0, 1, 2], []); // bottom-right: white
});
