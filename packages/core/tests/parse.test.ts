import { expect, test } from "vite-plus/test";
import { parseDxf } from "../src/parse/parse.ts";

const SAMPLE = [
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
  "5",
  "0",
  "ARC",
  "8",
  "WALLS",
  "10",
  "1",
  "20",
  "2",
  "40",
  "3",
  "50",
  "0",
  "51",
  "90",
  "0",
  "MTEXT",
  "8",
  "WALLS",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

test("parses layers, entities, and unsupported counts", () => {
  const doc = parseDxf(SAMPLE);

  const walls = doc.layers.get("WALLS");
  expect(walls).toBeDefined();
  expect(walls?.color).toBe(0x00ff00); // ACI 3 = green
  expect(walls?.entityCount).toBe(2);

  expect(doc.entities).toHaveLength(2);
  const [line, arc] = doc.entities;
  expect(line).toMatchObject({ type: "LINE", start: { x: 0, y: 0 }, end: { x: 10, y: 5 } });
  expect(arc).toMatchObject({ type: "ARC", center: { x: 1, y: 2 }, radius: 3 });
  if (arc.type === "ARC") {
    expect(arc.endAngle).toBeCloseTo(Math.PI / 2); // degrees → radians
  }

  expect(doc.unsupported.MTEXT).toBe(1);
});
