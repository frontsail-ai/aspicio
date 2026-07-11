import { expect, test } from "vite-plus/test";
import { parseDxf } from "../src/parse/parse.ts";

/** Build a DXF from (code, value) pairs. */
function dxf(...pairs: (string | number)[]): string {
  return pairs.join("\n");
}

function entitiesSection(...pairs: (string | number)[]): string {
  return dxf(0, "SECTION", 2, "ENTITIES", ...pairs, 0, "ENDSEC", 0, "EOF");
}

test("explicit color index (62) overrides layer color", () => {
  const doc = parseDxf(entitiesSection(0, "LINE", 8, "L", 62, 1, 10, 0, 20, 0, 11, 1, 21, 1));
  expect(doc.entities[0].color).toBe(0xff0000); // ACI 1 = red
});

test("true color (420) is used verbatim", () => {
  const doc = parseDxf(
    entitiesSection(0, "LINE", 8, "L", 420, 0x123456, 10, 0, 20, 0, 11, 1, 21, 1),
  );
  expect(doc.entities[0].color).toBe(0x123456);
});

test("ByBlock (62=0) resolves to null", () => {
  const doc = parseDxf(entitiesSection(0, "LINE", 8, "L", 62, 0, 10, 0, 20, 0, 11, 1, 21, 1));
  expect(doc.entities[0].color).toBeNull();
});

test("degenerate LINE (missing second vertex) is dropped", () => {
  const doc = parseDxf(entitiesSection(0, "LINE", 8, "L", 10, 0, 20, 0));
  expect(doc.entities).toHaveLength(0);
});

test("single-vertex LWPOLYLINE is dropped", () => {
  const doc = parseDxf(entitiesSection(0, "LWPOLYLINE", 8, "L", 90, 1, 70, 0, 10, 0, 20, 0));
  expect(doc.entities).toHaveLength(0);
});

test("layers referenced by entities but missing from tables are created", () => {
  const doc = parseDxf(entitiesSection(0, "LINE", 8, "GHOST", 10, 0, 20, 0, 11, 1, 21, 1));
  const ghost = doc.layers.get("GHOST");
  expect(ghost).toBeDefined();
  expect(ghost?.color).toBe(0xffffff);
  expect(ghost?.entityCount).toBe(1);
});

test("frozen layer flag (70 & 1) makes layer invisible", () => {
  const doc = parseDxf(
    dxf(
      0,
      "SECTION",
      2,
      "TABLES",
      0,
      "TABLE",
      2,
      "LAYER",
      0,
      "LAYER",
      2,
      "ICE",
      70,
      1,
      62,
      3,
      0,
      "ENDTAB",
      0,
      "ENDSEC",
      0,
      "SECTION",
      2,
      "ENTITIES",
      0,
      "ENDSEC",
      0,
      "EOF",
    ),
  );
  const ice = doc.layers.get("ICE");
  expect(ice?.frozen).toBe(true);
  expect(ice?.visible).toBe(false);
});

test("negative layer color (off) makes layer invisible", () => {
  const doc = parseDxf(
    dxf(
      0,
      "SECTION",
      2,
      "TABLES",
      0,
      "TABLE",
      2,
      "LAYER",
      0,
      "LAYER",
      2,
      "OFF",
      70,
      0,
      62,
      -3,
      0,
      "ENDTAB",
      0,
      "ENDSEC",
      0,
      "SECTION",
      2,
      "ENTITIES",
      0,
      "ENDSEC",
      0,
      "EOF",
    ),
  );
  expect(doc.layers.get("OFF")?.visible).toBe(false);
});

test("POLYLINE (heavy) with vertices converts like LWPOLYLINE", () => {
  const doc = parseDxf(
    entitiesSection(
      0,
      "POLYLINE",
      8,
      "L",
      70,
      1,
      0,
      "VERTEX",
      8,
      "L",
      10,
      0,
      20,
      0,
      0,
      "VERTEX",
      8,
      "L",
      10,
      5,
      20,
      0,
      0,
      "VERTEX",
      8,
      "L",
      10,
      5,
      20,
      5,
      0,
      "SEQEND",
    ),
  );
  expect(doc.entities[0]).toMatchObject({ type: "POLYLINE", closed: true });
  if (doc.entities[0].type === "POLYLINE") {
    expect(doc.entities[0].points).toHaveLength(3);
  }
});

test("CIRCLE and ELLIPSE convert with defaults", () => {
  const doc = parseDxf(
    entitiesSection(
      0,
      "CIRCLE",
      8,
      "L",
      10,
      1,
      20,
      2,
      40,
      3,
      0,
      "ELLIPSE",
      8,
      "L",
      10,
      0,
      20,
      0,
      11,
      5,
      21,
      0,
      40,
      0.5,
      41,
      0,
      42,
      6.283185307,
    ),
  );
  expect(doc.entities[0]).toMatchObject({ type: "CIRCLE", radius: 3 });
  expect(doc.entities[1]).toMatchObject({
    type: "ELLIPSE",
    majorAxis: { x: 5, y: 0 },
    axisRatio: 0.5,
  });
});

test("INSERT rotation converts degrees to radians", () => {
  const doc = parseDxf(
    dxf(
      0,
      "SECTION",
      2,
      "BLOCKS",
      0,
      "BLOCK",
      8,
      "0",
      2,
      "B",
      70,
      0,
      10,
      0,
      20,
      0,
      3,
      "B",
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
      0,
      0,
      "ENDBLK",
      0,
      "ENDSEC",
      0,
      "SECTION",
      2,
      "ENTITIES",
      0,
      "INSERT",
      8,
      "L",
      2,
      "B",
      10,
      5,
      20,
      5,
      50,
      90,
      0,
      "ENDSEC",
      0,
      "EOF",
    ),
  );
  const insert = doc.entities[0];
  expect(insert.type).toBe("INSERT");
  if (insert.type === "INSERT") {
    expect(insert.rotation).toBeCloseTo(Math.PI / 2);
    expect(insert.scale).toEqual({ x: 1, y: 1 });
  }
  expect(doc.blocks.get("B")?.entities).toHaveLength(1);
});

test("unsupported entities inside blocks are counted too", () => {
  const doc = parseDxf(
    dxf(
      0,
      "SECTION",
      2,
      "BLOCKS",
      0,
      "BLOCK",
      8,
      "0",
      2,
      "B",
      70,
      0,
      10,
      0,
      20,
      0,
      3,
      "B",
      0,
      "MTEXT",
      8,
      "0",
      0,
      "ENDBLK",
      0,
      "ENDSEC",
      0,
      "SECTION",
      2,
      "ENTITIES",
      0,
      "ENDSEC",
      0,
      "EOF",
    ),
  );
  expect(doc.unsupported.MTEXT).toBe(1);
});

test("garbage input throws", () => {
  expect(() => parseDxf("not a dxf at all")).toThrow();
});

test("entity without a layer code lands on layer 0", () => {
  const doc = parseDxf(entitiesSection(0, "LINE", 10, 0, 20, 0, 11, 1, 21, 1));
  expect(doc.entities[0].layer).toBe("0");
  expect(doc.layers.get("0")?.entityCount).toBe(1);
});

test("CIRCLE without a radius defaults to 0", () => {
  const doc = parseDxf(entitiesSection(0, "CIRCLE", 8, "L", 10, 1, 20, 2));
  expect(doc.entities[0]).toMatchObject({ type: "CIRCLE", radius: 0 });
});

test("ARC without angles defaults to a full sweep baseline", () => {
  const doc = parseDxf(entitiesSection(0, "ARC", 8, "L", 10, 0, 20, 0, 40, 5));
  expect(doc.entities[0]).toMatchObject({ type: "ARC", startAngle: 0, endAngle: 0 });
});
