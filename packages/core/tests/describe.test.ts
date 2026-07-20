import { expect, test } from "vite-plus/test";
import { describeDrawing, parseDxf, parseDxfBytes } from "../src/index.ts";
import { tessellate } from "../src/tessellate/tessellate.ts";

// A tiny drawing: mm units, one WALLS layer (ACI 3 = green), a LINE and a CIRCLE.
const DXF = [
  "0",
  "SECTION",
  "2",
  "HEADER",
  "9",
  "$INSUNITS",
  "70",
  "4",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "TABLES",
  "0",
  "TABLE",
  "2",
  "LAYER",
  "0",
  "LAYER",
  "2",
  "WALLS",
  "70",
  "0",
  "62",
  "3",
  "0",
  "ENDTAB",
  "0",
  "ENDSEC",
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "LINE",
  "8",
  "WALLS",
  "10",
  "0",
  "20",
  "0",
  "11",
  "10",
  "21",
  "0",
  "0",
  "CIRCLE",
  "8",
  "WALLS",
  "10",
  "5",
  "20",
  "5",
  "40",
  "2",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

test("parseDxfBytes parses string, Uint8Array, and ArrayBuffer identically", () => {
  const fromText = parseDxfBytes(DXF);
  const bytes = new TextEncoder().encode(DXF);
  const fromBytes = parseDxfBytes(bytes);
  const fromBuffer = parseDxfBytes(bytes.buffer as ArrayBuffer);

  expect(fromText.entities.length).toBe(2);
  expect(fromBytes.entities.length).toBe(2);
  expect(fromBuffer.entities.length).toBe(2);
  expect(fromBytes.entities.map((e) => e.type)).toEqual(["LINE", "CIRCLE"]);
});

test("describeDrawing summarizes units, bounds, layers, and entity types", () => {
  const doc = parseDxf(DXF);
  const summary = describeDrawing(doc, tessellate(doc, {}));

  expect(summary.units).toBe("mm");
  expect(summary.entityCount).toBe(2);
  expect(summary.entityTypes).toEqual({ LINE: 1, CIRCLE: 1 });
  expect(summary.segmentCount).toBeGreaterThan(0);

  expect(summary.bounds).not.toBeNull();
  expect(summary.bounds!.minX).toBeCloseTo(0, 3);
  expect(summary.bounds!.maxX).toBeCloseTo(10, 3);
  expect(summary.bounds!.maxY).toBeCloseTo(7, 3);
  expect(summary.size!.width).toBeCloseTo(10, 3);
  expect(summary.size!.height).toBeCloseTo(7, 3);

  const walls = summary.layers.find((l) => l.name === "WALLS");
  expect(walls).toMatchObject({ name: "WALLS", entityCount: 2, visible: true, color: "#00ff00" });
});

test("describeDrawing reports an empty drawing as null bounds", () => {
  const empty = parseDxf(["0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF"].join("\n"));
  const summary = describeDrawing(empty, tessellate(empty, {}));
  expect(summary.bounds).toBeNull();
  expect(summary.size).toBeNull();
  expect(summary.entityCount).toBe(0);
  expect(summary.entityTypes).toEqual({});
});
