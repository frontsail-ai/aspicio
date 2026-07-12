import { expect, test } from "vite-plus/test";
import { dashPolyline } from "../src/geom/dash.ts";
import type { DxfDocument, Entity, LineTypeDef, Point2 } from "../src/model/types.ts";
import { parseDxf } from "../src/parse/parse.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

const line = (x0: number, x1: number): Point2[] => [
  { x: x0, y: 0 },
  { x: x1, y: 0 },
];

test("a simple dash pattern breaks a line into drawn pieces", () => {
  // pattern: 1 drawn, 1 gap, over a length-4 line -> 2 dashes.
  const pieces = dashPolyline(line(0, 4), [1, -1]);
  expect(pieces).toHaveLength(2);
  expect(pieces[0][0].x).toBeCloseTo(0);
  expect(pieces[0].at(-1)?.x).toBeCloseTo(1);
  expect(pieces[1][0].x).toBeCloseTo(2);
  expect(pieces[1].at(-1)?.x).toBeCloseTo(3);
});

test("the dash phase carries continuously across a corner", () => {
  // L-shape, 2 units each leg; pattern 1 on / 1 off. The phase should not
  // reset at the corner, so the corner falls mid-pattern.
  const pts: Point2[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
  ];
  const pieces = dashPolyline(pts, [1, -1]);
  // total length 4 -> 2 drawn pieces of length 1.
  expect(pieces).toHaveLength(2);
});

test("a starting gap produces no piece until the first dash", () => {
  const pieces = dashPolyline(line(0, 3), [-1, 1]); // gap first
  expect(pieces[0][0].x).toBeCloseTo(1); // first drawn piece starts after the gap
});

test("dots (0-length) still emit a short visible piece", () => {
  const pieces = dashPolyline(line(0, 4), [0, -1]);
  expect(pieces.length).toBeGreaterThan(0);
});

/* ---------- through the pipeline ---------- */

function dashDoc(entities: Entity[], lineTypes: [string, LineTypeDef][]): DxfDocument {
  return {
    layers: new Map([
      ["0", { name: "0", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
      [
        "DASHLAYER",
        {
          name: "DASHLAYER",
          color: 0xffffff,
          visible: true,
          frozen: false,
          entityCount: 0,
          lineType: "DASHED",
        },
      ],
    ]),
    entities,
    blocks: new Map(),
    lineTypes: new Map(lineTypes),
    unsupported: {},
  };
}

const DASHED: LineTypeDef = { name: "DASHED", pattern: [0.5, -0.5], patternLength: 1 };

test("an entity's linetype dashes its geometry", () => {
  const solid = tessellate(
    dashDoc(
      [
        {
          type: "LINE",
          layer: "0",
          color: null,
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
        } as Entity,
      ],
      [],
    ),
  );
  const dashed = tessellate(
    dashDoc(
      [
        {
          type: "LINE",
          layer: "0",
          color: null,
          lineType: "DASHED",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
        } as Entity,
      ],
      [["DASHED", DASHED]],
    ),
  );
  expect(solid.segmentCount).toBe(1);
  // 10 units / 1-unit pattern -> ~10 dashes, each a segment.
  expect(dashed.segmentCount).toBeGreaterThan(5);
});

test("linetype is inherited from the layer when the entity has none", () => {
  const tess = tessellate(
    dashDoc(
      [
        {
          type: "LINE",
          layer: "DASHLAYER",
          color: null,
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
        } as Entity,
      ],
      [["DASHED", DASHED]],
    ),
  );
  expect(tess.segmentCount).toBeGreaterThan(5);
});

test("text is never dashed even on a dashed layer", () => {
  const tess = tessellate(
    dashDoc(
      [
        {
          type: "TEXT",
          layer: "DASHLAYER",
          color: null,
          position: { x: 0, y: 0 },
          text: "I",
          height: 10,
          rotation: 0,
          widthFactor: 1,
          hAlign: "left",
          vAlign: "baseline",
        } as Entity,
      ],
      [["DASHED", DASHED]],
    ),
  );
  // 'I' is a single stroke -> exactly one segment, not chopped into dashes.
  expect(tess.segmentCount).toBe(1);
});

test("parse extracts the LTYPE table pattern", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "TABLES",
      "0",
      "TABLE",
      "2",
      "LTYPE",
      "0",
      "LTYPE",
      "2",
      "DASHED",
      "70",
      "0",
      "3",
      "Dashed",
      "72",
      "65",
      "73",
      "2",
      "40",
      "0.75",
      "49",
      "0.5",
      "74",
      "0",
      "49",
      "-0.25",
      "74",
      "0",
      "0",
      "ENDTAB",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  const lt = doc.lineTypes.get("DASHED");
  expect(lt?.pattern).toEqual([0.5, -0.25]);
  expect(lt?.patternLength).toBeCloseTo(0.75);
});
