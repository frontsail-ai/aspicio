/**
 * PNG smoke test over the shared jscad sample corpus
 * (packages/core/tests/fixtures/jscad): every sample — including the
 * entity-less empty.dxf — must rasterize to a real PNG (AGT-*, VIEW-12).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { renderPng } from "../src/tools.ts";

const DIR = join(import.meta.dirname, "..", "..", "core", "tests", "fixtures", "jscad");
const PNG_MAGIC = "89504e47";

const files = readdirSync(DIR).filter((f) => f.endsWith(".dxf"));

test("the shared corpus is present", () => {
  expect(files.length).toBeGreaterThanOrEqual(23);
});

test.each(files)("%s renders to PNG", (file) => {
  const png = renderPng(new Uint8Array(readFileSync(join(DIR, file))), 400);
  expect(Buffer.from(png.subarray(0, 4)).toString("hex")).toBe(PNG_MAGIC);
  expect(png.length).toBeGreaterThan(100);
});
