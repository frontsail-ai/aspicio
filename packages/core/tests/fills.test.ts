import { expect, test } from "vite-plus/test";
import { triangulate } from "../src/geom/triangulate.ts";
import type { DxfDocument, Entity } from "../src/model/types.ts";
import { parseDxf } from "../src/parse/parse.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

/* ---------- triangulation ---------- */

test("triangulates a quad into two triangles (6 vertices)", () => {
  const tris = triangulate([
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ],
  ]);
  expect(tris).toHaveLength(6);
});

test("triangulates a polygon with a hole", () => {
  const tris = triangulate([
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ],
  ]);
  expect(tris.length).toBeGreaterThan(6); // more triangles once a hole is cut
  expect(tris.length % 3).toBe(0);
});

test("degenerate rings produce no triangles", () => {
  expect(triangulate([])).toHaveLength(0);
  expect(
    triangulate([
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ]),
  ).toHaveLength(0);
});

/* ---------- pipeline: SOLID / POINT / DIMENSION / HATCH ---------- */

function makeDoc(entities: Entity[], blocks?: DxfDocument["blocks"]): DxfDocument {
  return {
    layers: new Map([
      ["0", { name: "0", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities,
    blocks: blocks ?? new Map(),
    lineTypes: new Map(),
    unsupported: {},
  };
}

function fillTriangleCount(tess: ReturnType<typeof tessellate>): number {
  let verts = 0;
  for (const [, g] of tess.layers) verts += g.fillPositions.length / 3;
  return verts / 3;
}

test("SOLID fills a quad and contributes to the fill buffer", () => {
  const tess = tessellate(
    makeDoc([
      {
        type: "SOLID",
        layer: "0",
        color: null,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      } as Entity,
    ]),
  );
  expect(fillTriangleCount(tess)).toBe(2);
  expect(tess.segmentCount).toBe(0); // filled, not outlined
  expect(tess.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
});

test("POINT renders a crosshair marker", () => {
  const tess = tessellate(
    makeDoc([{ type: "POINT", layer: "0", color: null, position: { x: 5, y: 5 } } as Entity]),
  );
  expect(tess.segmentCount).toBe(2); // horizontal + vertical stroke
});

test("DIMENSION renders its anonymous block", () => {
  const tess = tessellate(
    makeDoc(
      [
        {
          type: "DIMENSION",
          layer: "0",
          color: null,
          block: "*D1",
          position: { x: 0, y: 0 },
        } as Entity,
      ],
      new Map([
        [
          "*D1",
          {
            name: "*D1",
            basePoint: { x: 0, y: 0 },
            entities: [
              {
                type: "LINE",
                layer: "0",
                color: null,
                start: { x: 0, y: 0 },
                end: { x: 20, y: 0 },
              } as Entity,
            ],
          },
        ],
      ]),
    ),
  );
  expect(tess.segmentCount).toBe(1);
  expect(tess.bounds?.maxX).toBeCloseTo(20);
});

test("solid HATCH fills its boundary; pattern HATCH outlines it", () => {
  const loop = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const solid = tessellate(
    makeDoc([{ type: "HATCH", layer: "0", color: null, loops: [loop], solid: true } as Entity]),
  );
  expect(fillTriangleCount(solid)).toBe(2);

  const pattern = tessellate(
    makeDoc([{ type: "HATCH", layer: "0", color: null, loops: [loop], solid: false } as Entity]),
  );
  expect(fillTriangleCount(pattern)).toBe(0);
  expect(pattern.segmentCount).toBe(4); // closed outline
});

/* ---------- parse ---------- */

test("parse converts SOLID (reordering the DXF quad) and POINT", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "SOLID",
      "8",
      "0",
      "10",
      "0",
      "20",
      "0",
      "11",
      "10",
      "21",
      "0",
      "12",
      "0",
      "22",
      "10",
      "13",
      "10",
      "23",
      "10",
      "0",
      "POINT",
      "8",
      "0",
      "10",
      "5",
      "20",
      "5",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  const solid = doc.entities[0];
  expect(solid.type).toBe("SOLID");
  if (solid.type === "SOLID") {
    // DXF order 0,1,3,2 -> ring [ (0,0),(10,0),(10,10),(0,10) ]
    expect(solid.points[2]).toEqual({ x: 10, y: 10 });
    expect(solid.points[3]).toEqual({ x: 0, y: 10 });
  }
  expect(doc.entities[1].type).toBe("POINT");
});

test("parse reads a solid HATCH with a polyline boundary", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "HATCH",
      "8",
      "0",
      "2",
      "SOLID",
      "70",
      "1",
      "91",
      "1",
      "92",
      "2",
      "72",
      "0",
      "73",
      "1",
      "93",
      "4",
      "10",
      "0",
      "20",
      "0",
      "10",
      "20",
      "20",
      "0",
      "10",
      "20",
      "20",
      "20",
      "10",
      "0",
      "20",
      "20",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  const hatch = doc.entities[0];
  expect(hatch.type).toBe("HATCH");
  if (hatch.type === "HATCH") {
    expect(hatch.solid).toBe(true);
    expect(hatch.loops).toHaveLength(1);
    expect(hatch.loops[0].length).toBeGreaterThanOrEqual(4);
  }
  expect(doc.unsupported.HATCH).toBeUndefined(); // handled, not skipped
});
