import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { PdfDocument } from "../src/parse/pdf/document.ts";
import {
  CONTENT_LAYER,
  IDENTITY,
  apply,
  cmykToRgb,
  grayToRgb,
  interpretContent,
  matrixScale,
  multiply,
} from "../src/parse/pdf/interpret.ts";
import type { Matrix } from "../src/parse/pdf/interpret.ts";
import type { HatchEntity, PolylineEntity } from "../src/model/types.ts";

const encode = (s: string) => new TextEncoder().encode(s);

/** Interpret a bare content stream with no resources. */
async function run(content: string, ctm: Matrix = IDENTITY) {
  const doc = await PdfDocument.parse(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./fixtures/pdf/minimal.pdf", import.meta.url))),
    ),
  );
  return await interpretContent(doc, encode(content), undefined, {}, ctm);
}

const polylines = (entities: readonly { type: string }[]): PolylineEntity[] =>
  entities.filter((e): e is PolylineEntity => e.type === "POLYLINE");
const hatches = (entities: readonly { type: string }[]): HatchEntity[] =>
  entities.filter((e): e is HatchEntity => e.type === "HATCH");

/* ---------- matrices ---------- */

test("multiply applies the left matrix first", () => {
  const translate: Matrix = [1, 0, 0, 1, 10, 20];
  const scale: Matrix = [2, 0, 0, 2, 0, 0];
  // `cm` semantics: the new matrix is concatenated *before* the existing one.
  expect(apply(multiply(translate, scale), 0, 0)).toEqual({ x: 20, y: 40 });
  expect(apply(multiply(scale, translate), 0, 0)).toEqual({ x: 10, y: 20 });
});

test("matrixScale reports the average scale factor", () => {
  expect(matrixScale(IDENTITY)).toBe(1);
  expect(matrixScale([3, 0, 0, 3, 0, 0])).toBeCloseTo(3, 10);
  expect(matrixScale([2, 0, 0, 8, 0, 0])).toBeCloseTo(4, 10); // geometric mean
});

/* ---------- colour ---------- */

test("converts CMYK and gray to RGB", () => {
  expect(cmykToRgb(0, 0, 0, 0)).toBe(0xffffff);
  expect(cmykToRgb(0, 0, 0, 1)).toBe(0x000000);
  expect(cmykToRgb(1, 0, 0, 0)).toBe(0x00ffff);
  expect(cmykToRgb(0, 1, 0, 0)).toBe(0xff00ff);
  expect(grayToRgb(1)).toBe(0xffffff);
  expect(grayToRgb(0)).toBe(0x000000);
});

test("stroke and fill colour are tracked separately", async () => {
  const { entities } = await run("1 0 0 RG 0 0 1 rg 0 0 m 10 10 l S 0 0 m 5 0 l 5 5 l f");
  expect(polylines(entities)[0]?.color).toBe(0xff0000);
  expect(hatches(entities)[0]?.color).toBe(0x0000ff);
});

/* ---------- paths ---------- */

test("emits a stroked polyline in device space", async () => {
  const { entities } = await run("10 20 m 30 40 l S");
  const [line] = polylines(entities);
  expect(line?.points).toEqual([
    { x: 10, y: 20 },
    { x: 30, y: 40 },
  ]);
  expect(line?.layer).toBe(CONTENT_LAYER);
});

test("applies the CTM to every point", async () => {
  const { entities } = await run("q 2 0 0 2 5 5 cm 0 0 m 10 0 l S Q");
  expect(polylines(entities)[0]?.points).toEqual([
    { x: 5, y: 5 },
    { x: 25, y: 5 },
  ]);
});

test("q/Q restores the previous state", async () => {
  const { entities } = await run("1 0 0 RG q 0 1 0 RG 0 0 m 1 1 l S Q 0 0 m 2 2 l S");
  const lines = polylines(entities);
  expect(lines[0]?.color).toBe(0x00ff00);
  expect(lines[1]?.color).toBe(0xff0000); // outer red survived the Q
});

test("re emits a closed rectangle", async () => {
  const { entities } = await run("10 10 100 50 re S");
  const points = polylines(entities)[0]?.points ?? [];
  expect(points).toHaveLength(5);
  expect(points[0]).toEqual({ x: 10, y: 10 });
  expect(points[2]).toEqual({ x: 110, y: 60 });
  expect(points[4]).toEqual(points[0]); // closed back to the start
});

test("h closes a subpath back to its start", async () => {
  const { entities } = await run("0 0 m 10 0 l 10 10 l h S");
  const points = polylines(entities)[0]?.points ?? [];
  expect(points[points.length - 1]).toEqual({ x: 0, y: 0 });
});

test("s closes the path before stroking", async () => {
  const { entities } = await run("0 0 m 10 0 l 10 10 l s");
  const points = polylines(entities)[0]?.points ?? [];
  expect(points[points.length - 1]).toEqual({ x: 0, y: 0 });
});

test("flattens cubic curves into polyline points", async () => {
  const { entities } = await run("0 0 m 0 10 10 10 10 0 c S");
  const points = polylines(entities)[0]?.points ?? [];
  expect(points.length).toBeGreaterThan(3);
  expect(points[0]).toEqual({ x: 0, y: 0 });
  expect(points[points.length - 1]?.x).toBeCloseTo(10, 6);
  expect(points[points.length - 1]?.y).toBeCloseTo(0, 6);
  // The curve bulges upward, so its midpoint must sit above the chord.
  const mid = points[Math.floor(points.length / 2)];
  expect(mid?.y).toBeGreaterThan(1);
});

test("v and y curve operators use their implied control points", async () => {
  const v = await run("0 0 m 10 10 10 0 v S");
  const y = await run("0 0 m 0 10 10 0 y S");
  for (const result of [v, y]) {
    const points = polylines(result.entities)[0]?.points ?? [];
    expect(points.length).toBeGreaterThan(3);
    expect(points[points.length - 1]?.x).toBeCloseTo(10, 6);
    expect(points[points.length - 1]?.y).toBeCloseTo(0, 6);
  }
});

test("multiple subpaths each become their own polyline", async () => {
  const { entities } = await run("0 0 m 1 1 l 5 5 m 6 6 l S");
  expect(polylines(entities)).toHaveLength(2);
});

/* ---------- fills ---------- */

test("f emits a solid fill whose first loop is the outer boundary", async () => {
  const { entities } = await run("0 0 m 10 0 l 10 10 l h 2 2 m 8 2 l 8 8 l h f");
  const [hatch] = hatches(entities);
  expect(hatch?.solid).toBe(true);
  expect(hatch?.loops).toHaveLength(2);
  expect(hatch?.loops[0]?.[0]).toEqual({ x: 0, y: 0 });
});

test("B fills and strokes the same path", async () => {
  const { entities } = await run("0 0 m 10 0 l 10 10 l h B");
  expect(hatches(entities)).toHaveLength(1);
  expect(polylines(entities)).toHaveLength(1);
});

test("n discards the path without painting", async () => {
  const { entities } = await run("0 0 m 10 10 l n");
  expect(entities).toHaveLength(0);
});

test("a degenerate subpath never becomes a fill", async () => {
  const { entities } = await run("0 0 m 10 0 l f");
  expect(hatches(entities)).toHaveLength(0);
});

/* ---------- line width and dashes ---------- */

test("line width converts points to hundredths of a millimetre", async () => {
  const { entities } = await run("1 w 0 0 m 10 0 l S");
  // 1 pt = 25.4/72 mm = 0.3528 mm = ~35 hundredths.
  expect(polylines(entities)[0]?.lineWeight).toBe(35);
});

test("line width scales with the CTM", async () => {
  const { entities } = await run("q 2 0 0 2 0 0 cm 1 w 0 0 m 10 0 l S Q");
  expect(polylines(entities)[0]?.lineWeight).toBe(71); // 2 pt
});

test("zero width means hairline, not zero", async () => {
  const { entities } = await run("0 w 0 0 m 10 0 l S");
  expect(polylines(entities)[0]?.lineWeight).toBeUndefined();
});

test("a dash array becomes a named linetype the renderer resolves", async () => {
  const { entities, lineTypes } = await run("[3 2] 0 d 0 0 m 10 0 l S");
  const name = polylines(entities)[0]?.lineType;
  expect(name).toBeDefined();
  const def = lineTypes.get(name as string);
  expect(def?.pattern).toEqual([3, -2]); // on, off
  expect(def?.patternLength).toBe(5);
});

test("the same dash array reuses one linetype", async () => {
  const { lineTypes } = await run("[3 2] 0 d 0 0 m 1 0 l S [3 2] 0 d 0 5 m 1 5 l S");
  expect(lineTypes.size).toBe(1);
});

test("an odd-length dash array is doubled so the cycle is consistent", async () => {
  const { lineTypes } = await run("[4] 0 d 0 0 m 10 0 l S");
  const [def] = [...lineTypes.values()];
  expect(def?.pattern).toEqual([4, -4]);
});

test("an empty dash array means solid", async () => {
  const { entities, lineTypes } = await run("[] 0 d 0 0 m 10 0 l S");
  expect(polylines(entities)[0]?.lineType).toBeUndefined();
  expect(lineTypes.size).toBe(0);
});

/* ---------- unsupported counting (PDF-8) ---------- */

test("counts clipping without cropping anything", async () => {
  const { entities, unsupported } = await run("0 0 10 10 re W n 0 0 m 20 20 l S");
  expect(unsupported["Clip"]).toBe(1);
  // The line still draws at full length — clipping is counted, not applied.
  expect(polylines(entities)[0]?.points[1]).toEqual({ x: 20, y: 20 });
});

test("counts shadings and inline images", async () => {
  const { unsupported } = await run("/Sh0 sh BI /W 1 /H 1 ID    EI");
  expect(unsupported["Shading"]).toBe(1);
  expect(unsupported["Image"]).toBe(1);
});

test("counts a pattern colour rather than guessing a colour", async () => {
  const { unsupported } = await run("/Pattern cs /P0 scn 0 0 m 10 10 l 5 5 l f");
  expect(unsupported["PatternFill"]).toBe(1);
});

test("inline image data is never mistaken for operators", async () => {
  // The payload contains bytes that look like operators; skipping to EI is
  // what stops them being interpreted.
  const { entities, unsupported } = await run("BI /W 2 ID 0 0 m 99 99 l S EI 1 1 m 2 2 l S");
  expect(unsupported["Image"]).toBe(1);
  expect(polylines(entities)).toHaveLength(1);
  expect(polylines(entities)[0]?.points).toEqual([
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ]);
});

test("malformed content degrades instead of throwing", async () => {
  await expect(run("0 0 m ] ] ) 10 10 l S")).resolves.toBeDefined();
  await expect(run("Q Q Q 0 0 m 1 1 l S")).resolves.toBeDefined();
});
