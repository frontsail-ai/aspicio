import { expect, test } from "vite-plus/test";
import { parseDxf } from "../src/parse/parse.ts";
import { tessellate, tessellateLayout } from "../src/tessellate/tessellate.ts";

/** Build a DXF from (code, value) pairs. */
function dxf(...pairs: (string | number)[]): string {
  return pairs.join("\n");
}

// Model space: a horizontal line plus a vertical line that overshoots upward.
// One paper layout with a border and a VIEWPORT framing the model at 2× scale.
const LAYOUT_DXF = dxf(
  0,
  "SECTION",
  2,
  "ENTITIES",
  // model
  0,
  "LINE",
  8,
  "MODEL",
  10,
  0,
  20,
  0,
  11,
  10,
  21,
  0,
  0,
  "LINE",
  8,
  "MODEL",
  10,
  5,
  20,
  0,
  11,
  5,
  21,
  20,
  // paper border (inPaperSpace)
  0,
  "LWPOLYLINE",
  8,
  "SHEET",
  67,
  1,
  90,
  4,
  70,
  1,
  10,
  60,
  20,
  60,
  10,
  140,
  20,
  60,
  10,
  140,
  20,
  140,
  10,
  60,
  20,
  140,
  // viewport: center (100,100), 60×40 window, view center (5,5), view height 20 → scale 2
  0,
  "VIEWPORT",
  8,
  "SHEET",
  67,
  1,
  10,
  100,
  20,
  100,
  40,
  60,
  41,
  40,
  68,
  2,
  69,
  2,
  12,
  5,
  22,
  5,
  17,
  5,
  27,
  5,
  45,
  20,
  51,
  0,
  0,
  "ENDSEC",
  0,
  "EOF",
);

test("parse splits model from paper and captures the layout viewport", () => {
  const doc = parseDxf(LAYOUT_DXF);
  expect(doc.entities.map((e) => e.type)).toEqual(["LINE", "LINE"]); // model only
  expect(doc.layouts).toHaveLength(1);
  const layout = doc.layouts![0];
  expect(layout.entities).toHaveLength(1); // the border
  expect(layout.viewports).toHaveLength(1);
  expect(layout.viewports[0].center).toEqual({ x: 100, y: 100 });
  expect(layout.viewports[0].viewHeight).toBe(20);
  expect(doc.unsupported.VIEWPORT).toBeUndefined(); // handled, not skipped
});

test("tessellateLayout bakes the clipped, scaled model into paper coordinates", () => {
  const doc = parseDxf(LAYOUT_DXF);
  const layout = doc.layouts![0];
  const tess = tessellateLayout(doc, layout);

  // Both the sheet border and the viewport's model content are present.
  expect([...tess.layers.keys()].sort()).toEqual(["MODEL", "SHEET"]);

  // The model's overshoot line reaches paper y=130 unclipped; the window's top
  // edge is y=120, so the baked model geometry must stop at 120.
  const g = tess.layers.get("MODEL")!;
  let maxY = -Infinity;
  for (let i = 1; i < g.positions.length; i += 3)
    maxY = Math.max(maxY, g.positions[i] + tess.offset.y);
  expect(maxY).toBeCloseTo(120);

  // The model line (0,0)-(10,0) scales ×2 → 20 paper units wide.
  expect(tess.bounds).not.toBeNull();
});

test("a model-only drawing has no layouts", () => {
  const doc = parseDxf(
    dxf(
      0,
      "SECTION",
      2,
      "ENTITIES",
      0,
      "LINE",
      8,
      "0",
      10,
      0,
      20,
      0,
      11,
      1,
      21,
      1,
      0,
      "ENDSEC",
      0,
      "EOF",
    ),
  );
  expect(doc.layouts).toEqual([]);
  expect(tessellate(doc).layers.size).toBe(1);
});
