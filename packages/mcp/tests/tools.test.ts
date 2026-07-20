import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { describeDxf, loadDxf, renderPng } from "../src/tools.ts";

const DXF = [
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

const PNG_MAGIC = "89504e47";

test("loadDxf treats multi-line DXF text as inline bytes (not a path)", async () => {
  const bytes = await loadDxf(DXF);
  expect(new TextDecoder().decode(bytes)).toContain("SECTION");
});

test("loadDxf reads a local file path", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "aspicio-mcp-")), "drawing.dxf");
  writeFileSync(path, DXF);
  const summary = describeDxf(await loadDxf(path));
  expect(summary.entityCount).toBe(2);
});

test("describeDxf summarizes entity types", () => {
  const summary = describeDxf(new TextEncoder().encode(DXF));
  expect(summary.entityTypes).toEqual({ LINE: 1, CIRCLE: 1 });
});

test("renderPng returns PNG bytes", () => {
  const png = renderPng(new TextEncoder().encode(DXF), 300);
  expect(Buffer.from(png.subarray(0, 4)).toString("hex")).toBe(PNG_MAGIC);
  expect(png.length).toBeGreaterThan(100);
});
