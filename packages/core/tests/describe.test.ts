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

test("parseDxfBytes rejects binary DXF with a clear error", () => {
  const sentinel = "AutoCAD Binary DXF\r\n\x1a\0";
  const bytes = new Uint8Array(64);
  for (let i = 0; i < sentinel.length; i++) bytes[i] = sentinel.charCodeAt(i);
  expect(() => parseDxfBytes(bytes)).toThrow(/Binary DXF.*ASCII/);
  // A short buffer that can't hold the sentinel is treated as text, not binary.
  expect(() => parseDxfBytes(new Uint8Array([48, 10]))).toThrow(/end of input|EOF/i);
});

test("texts collects TEXT strings, including inside reachable blocks, deduped", () => {
  const dxf = [
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    "0",
    "BLOCK",
    "2",
    "TITLE",
    "10",
    "0",
    "20",
    "0",
    "0",
    "TEXT",
    "8",
    "0",
    "10",
    "0",
    "20",
    "0",
    "40",
    "2",
    "1",
    "PART-42",
    "0",
    "ENDBLK",
    "0",
    "BLOCK",
    "2",
    "UNUSED",
    "10",
    "0",
    "20",
    "0",
    "0",
    "TEXT",
    "8",
    "0",
    "10",
    "0",
    "20",
    "0",
    "40",
    "2",
    "1",
    "GHOST",
    "0",
    "ENDBLK",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "TEXT",
    "8",
    "NOTES",
    "10",
    "0",
    "20",
    "0",
    "40",
    "3",
    "1",
    "ROOM A",
    "0",
    "INSERT",
    "2",
    "TITLE",
    "10",
    "5",
    "20",
    "5",
    "0",
    "INSERT",
    "2",
    "TITLE",
    "10",
    "50",
    "20",
    "5",
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n");
  const doc = parseDxf(dxf);
  const summary = describeDrawing(doc, tessellate(doc, {}));
  // Top-level text first, block text once despite two inserts, unused block excluded.
  expect(summary.texts).toEqual(["ROOM A", "PART-42"]);
});

test("texts includes dimension values (DIMENSION → its block) and MTEXT content", () => {
  const dxf = [
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    "0",
    "BLOCK",
    "2",
    "*D1",
    "10",
    "0",
    "20",
    "0",
    "0",
    "TEXT",
    "8",
    "NOTES",
    "10",
    "0",
    "20",
    "0",
    "40",
    "2",
    "1",
    "100",
    "0",
    "ENDBLK",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "DIMENSION",
    "8",
    "NOTES",
    "2",
    "*D1",
    "10",
    "0",
    "20",
    "0",
    "70",
    "0",
    "0",
    "MTEXT",
    "8",
    "NOTES",
    "10",
    "0",
    "20",
    "0",
    "40",
    "3",
    "1",
    "\\pxqc;{\\fArial;Part No. 7}",
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n");
  const doc = parseDxf(dxf);
  const summary = describeDrawing(doc, tessellate(doc, {}));
  // The dimension's value text comes from inside its *D1 block; the MTEXT
  // arrives with its format codes stripped by the parser.
  expect(summary.texts).toContain("100");
  expect(summary.texts).toContain("Part No. 7");
});

test("texts survives block reference cycles and respects the insert depth cap", () => {
  // A ↔ B cycle plus a chain deeper than MAX_INSERT_DEPTH: the walk must
  // terminate, keep cycle-reachable text, and drop text past the cap —
  // matching what tessellation would render.
  const blocks: string[] = [];
  const mkBlock = (name: string, inner: string[]): void => {
    blocks.push("0", "BLOCK", "2", name, "10", "0", "20", "0", ...inner, "0", "ENDBLK");
  };
  mkBlock("A", [
    "0",
    "TEXT",
    "8",
    "0",
    "10",
    "0",
    "20",
    "0",
    "40",
    "1",
    "1",
    "IN-A",
    "0",
    "INSERT",
    "2",
    "B",
    "10",
    "0",
    "20",
    "0",
  ]);
  mkBlock("B", ["0", "INSERT", "2", "A", "10", "0", "20", "0"]);
  // C0 → C1 → … → C20, with text only at the deep end.
  for (let i = 0; i < 20; i++) {
    mkBlock(
      `C${i}`,
      i === 19
        ? ["0", "TEXT", "8", "0", "10", "0", "20", "0", "40", "1", "1", "TOO-DEEP"]
        : ["0", "INSERT", "2", `C${i + 1}`, "10", "0", "20", "0"],
    );
  }
  const dxf = [
    "0",
    "SECTION",
    "2",
    "BLOCKS",
    ...blocks,
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "INSERT",
    "2",
    "A",
    "10",
    "0",
    "20",
    "0",
    "0",
    "INSERT",
    "2",
    "C0",
    "10",
    "0",
    "20",
    "0",
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n");
  const doc = parseDxf(dxf);
  const summary = describeDrawing(doc, tessellate(doc, {}));
  expect(summary.texts).toContain("IN-A"); // the cycle terminated, text kept
  expect(summary.texts).not.toContain("TOO-DEEP"); // past the shared depth cap
});
