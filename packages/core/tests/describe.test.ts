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

test("layer color reflects entity overrides (dominant drawn color, not the table)", () => {
  // WALLS is green (ACI 3) in the table, but two long red (62=1) lines dominate
  // the one short ByLayer line by segment count — the summary must say red.
  const dxf = [
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
    "LAYER",
    "2",
    "EMPTY",
    "70",
    "0",
    "62",
    "5",
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
    "62",
    "1",
    "10",
    "0",
    "20",
    "0",
    "11",
    "100",
    "21",
    "0",
    "0",
    "LINE",
    "8",
    "WALLS",
    "62",
    "1",
    "10",
    "0",
    "20",
    "5",
    "11",
    "100",
    "21",
    "5",
    "0",
    "LINE",
    "8",
    "WALLS",
    "10",
    "0",
    "20",
    "9",
    "11",
    "10",
    "21",
    "9",
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n");
  const doc = parseDxf(dxf);
  const summary = describeDrawing(doc, tessellate(doc, {}));

  const walls = summary.layers.find((l) => l.name === "WALLS");
  expect(walls!.color).toBe("#ff0000"); // entity override wins over the green table color
  // A layer with nothing drawn falls back to its table color (ACI 5 = blue).
  const empty = summary.layers.find((l) => l.name === "EMPTY");
  expect(empty!.color).toBe("#0000ff");
});

test("parseDxfBytes decodes binary DXF through the sentinel path", () => {
  // Build a tiny valid binary DXF (R13+ 2-byte codes): 0 SECTION / 2 ENTITIES /
  // 0 LINE 8 WALLS 10..21 / 0 ENDSEC / 0 EOF.
  const parts: number[] = [];
  const sentinel = "AutoCAD Binary DXF\r\n\x1a\0";
  for (let i = 0; i < sentinel.length; i++) parts.push(sentinel.charCodeAt(i));
  const u16 = (n: number): void => {
    parts.push(n & 0xff, (n >> 8) & 0xff);
  };
  const str = (code: number, s: string): void => {
    u16(code);
    for (let i = 0; i < s.length; i++) parts.push(s.charCodeAt(i));
    parts.push(0);
  };
  const f64 = (code: number, v: number): void => {
    u16(code);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    parts.push(...b);
  };
  str(0, "SECTION");
  str(2, "ENTITIES");
  str(0, "LINE");
  str(8, "WALLS");
  f64(10, 0);
  f64(20, 0);
  f64(11, 10);
  f64(21, 5);
  str(0, "ENDSEC");
  str(0, "EOF");
  const doc = parseDxfBytes(new Uint8Array(parts));
  expect(doc.entities.map((e) => e.type)).toEqual(["LINE"]);
  // A short buffer that can't hold the sentinel is treated as text, not binary.
  expect(() => parseDxfBytes(new Uint8Array([48, 10]))).toThrow(/end of input|EOF/i);
});
