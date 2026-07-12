import { expect, test } from "vite-plus/test";
import { ocsToWcs } from "../src/geom/ocs.ts";
import type { DxfDocument, Entity } from "../src/model/types.ts";
import { parseDxf } from "../src/parse/parse.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

/* ---------- the Arbitrary Axis Algorithm itself ---------- */

test("default +Z normal is the identity", () => {
  expect(ocsToWcs({ x: 0, y: 0, z: 1 })).toEqual([1, 0, 0, 1, 0, 0]);
});

test("mirrored (-Z) normal flips the X axis", () => {
  expect(ocsToWcs({ x: 0, y: 0, z: -1 })).toEqual([-1, 0, 0, 1, 0, 0]);
});

test("non-unit normals are normalized", () => {
  expect(ocsToWcs({ x: 0, y: 0, z: -7 })).toEqual([-1, 0, 0, 1, 0, 0]);
});

test("tilted normal projects OCS axes onto the view plane", () => {
  // n = (1,0,1)/√2: OCS x-axis maps to world +Y, OCS y-axis to (-1/√2, 0).
  const m = ocsToWcs({ x: 1, y: 0, z: 1 });
  expect(m[0]).toBeCloseTo(0); // ax.x
  expect(m[1]).toBeCloseTo(1); // ax.y
  expect(m[2]).toBeCloseTo(-Math.SQRT1_2); // ay.x
  expect(m[3]).toBeCloseTo(0); // ay.y
});

/* ---------- mirrored entities through the pipeline ---------- */

function makeDoc(entities: Entity[], blocks: DxfDocument["blocks"] = new Map()): DxfDocument {
  return {
    layers: new Map([
      ["0", { name: "0", color: 0xffffff, visible: true, frozen: false, entityCount: 0 }],
    ]),
    entities,
    blocks,
    unsupported: {},
  };
}

const MIRROR = { x: 0, y: 0, z: -1 };

test("mirrored ARC lands on the mirrored side with correct sweep", () => {
  // Quarter arc around (10, 0), r=1, 0..90° — unmirrored spans x ∈ [10, 11].
  const tess = tessellate(
    makeDoc([
      {
        type: "ARC",
        layer: "0",
        color: null,
        extrusion: MIRROR,
        center: { x: 10, y: 0 },
        radius: 1,
        startAngle: 0,
        endAngle: Math.PI / 2,
      } as Entity,
    ]),
  );
  expect(tess.bounds?.minX).toBeCloseTo(-11);
  expect(tess.bounds?.maxX).toBeCloseTo(-10);
  expect(tess.bounds?.minY).toBeCloseTo(0);
  expect(tess.bounds?.maxY).toBeCloseTo(1);
});

test("mirrored POLYLINE flips X, keeps Y", () => {
  const tess = tessellate(
    makeDoc([
      {
        type: "POLYLINE",
        layer: "0",
        color: null,
        extrusion: MIRROR,
        points: [
          { x: 1, y: 2 },
          { x: 5, y: 3 },
        ],
        bulges: [0, 0],
        closed: false,
      } as Entity,
    ]),
  );
  expect(tess.bounds).toEqual({ minX: -5, minY: 2, maxX: -1, maxY: 3 });
});

test("mirrored INSERT mirrors placement and block content", () => {
  const tess = tessellate(
    makeDoc(
      [
        {
          type: "INSERT",
          layer: "0",
          color: null,
          extrusion: MIRROR,
          blockName: "B",
          position: { x: 5, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
        } as Entity,
      ],
      new Map([
        [
          "B",
          {
            name: "B",
            basePoint: { x: 0, y: 0 },
            entities: [
              {
                type: "LINE",
                layer: "0",
                color: null,
                start: { x: 0, y: 0 },
                end: { x: 1, y: 0 },
              } as Entity,
            ],
          },
        ],
      ]),
    ),
  );
  // Placement (5,0) and the +X line both flip: world span x ∈ [-6, -5].
  expect(tess.bounds?.minX).toBeCloseTo(-6);
  expect(tess.bounds?.maxX).toBeCloseTo(-5);
});

test("unmirrored entities are untouched (no extrusion field)", () => {
  const tess = tessellate(
    makeDoc([
      {
        type: "POLYLINE",
        layer: "0",
        color: null,
        points: [
          { x: 1, y: 2 },
          { x: 5, y: 3 },
        ],
        bulges: [0, 0],
        closed: false,
      } as Entity,
    ]),
  );
  expect(tess.bounds).toEqual({ minX: 1, minY: 2, maxX: 5, maxY: 3 });
});

/* ---------- parse-side extraction ---------- */

test("parse extracts 210/230 extrusion for ARC and defaults to undefined", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "ARC",
      "8",
      "L",
      "10",
      "0",
      "20",
      "0",
      "40",
      "1",
      "50",
      "0",
      "51",
      "90",
      "210",
      "0",
      "220",
      "0",
      "230",
      "-1",
      "0",
      "ARC",
      "8",
      "L",
      "10",
      "0",
      "20",
      "0",
      "40",
      "1",
      "50",
      "0",
      "51",
      "90",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  expect(doc.entities[0].extrusion).toEqual({ x: 0, y: 0, z: -1 });
  expect(doc.entities[1].extrusion).toBeUndefined();
});

test("parse extracts extrusion for mirrored INSERT", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "BLOCKS",
      "0",
      "BLOCK",
      "8",
      "0",
      "2",
      "B",
      "70",
      "0",
      "10",
      "0",
      "20",
      "0",
      "3",
      "B",
      "0",
      "LINE",
      "8",
      "0",
      "10",
      "0",
      "20",
      "0",
      "11",
      "1",
      "21",
      "0",
      "0",
      "ENDBLK",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "INSERT",
      "8",
      "L",
      "2",
      "B",
      "10",
      "5",
      "20",
      "0",
      "210",
      "0",
      "220",
      "0",
      "230",
      "-1",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  expect(doc.entities[0].extrusion).toEqual({ x: 0, y: 0, z: -1 });
});

test("end to end: a mirrored DXF arc renders on the mirrored side", () => {
  const doc = parseDxf(
    [
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "ARC",
      "8",
      "L",
      "10",
      "10",
      "20",
      "0",
      "40",
      "1",
      "50",
      "0",
      "51",
      "90",
      "210",
      "0",
      "220",
      "0",
      "230",
      "-1",
      "0",
      "ENDSEC",
      "0",
      "EOF",
    ].join("\n"),
  );
  const tess = tessellate(doc);
  expect(tess.bounds?.maxX).toBeCloseTo(-10);
  expect(tess.bounds?.minX).toBeCloseTo(-11);
});
