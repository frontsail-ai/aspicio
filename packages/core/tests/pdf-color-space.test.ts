import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { PdfDocument } from "../src/parse/pdf/document.ts";
import {
  CS_TINT_TRANSFORM,
  CS_UNSUPPORTED,
  resolveColorSpace,
} from "../src/parse/pdf/color-space.ts";
import { interpretContent } from "../src/parse/pdf/interpret.ts";
import type { PdfDict, PdfValue } from "../src/parse/pdf/objects.ts";
import type { HatchEntity, PolylineEntity } from "../src/model/types.ts";

const encode = (s: string) => new TextEncoder().encode(s);
const name = (n: string): PdfValue => ({ name: n });
const dict = (entries: Record<string, PdfValue>): PdfDict => new Map(Object.entries(entries));

const openDoc = async () =>
  await PdfDocument.parse(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./fixtures/pdf/minimal.pdf", import.meta.url))),
    ),
  );

/** Resources declaring the two separations of a corrugated dieline. */
const dielineResources = (): PdfDict =>
  dict({
    ColorSpace: dict({
      Cut: [
        name("Separation"),
        name("Cutting"),
        name("DeviceCMYK"),
        dict({ FunctionType: 2, Domain: [0, 1], N: 1, C0: [0, 0, 0, 0], C1: [0, 1, 1, 0] }),
      ],
      Crease: [
        name("Separation"),
        name("Creasing"),
        name("DeviceCMYK"),
        dict({ FunctionType: 2, Domain: [0, 1], N: 1, C0: [0, 0, 0, 0], C1: [1, 0, 1, 0] }),
      ],
    }),
  });

async function run(content: string, resources?: PdfDict) {
  const doc = await openDoc();
  return await interpretContent(doc, encode(content), resources, {});
}

const polylines = (entities: readonly { type: string }[]): PolylineEntity[] =>
  entities.filter((e): e is PolylineEntity => e.type === "POLYLINE");
const hatches = (entities: readonly { type: string }[]): HatchEntity[] =>
  entities.filter((e): e is HatchEntity => e.type === "HATCH");

/* ---------- resolution ---------- */

test("device families resolve to their direct converters", async () => {
  const doc = await openDoc();
  const gray = await resolveColorSpace(doc, name("DeviceGray"), undefined);
  const cmyk = await resolveColorSpace(doc, name("DeviceCMYK"), undefined);
  expect(gray?.toRgb([0.5])).toBe(0x808080);
  expect(cmyk?.toRgb([0, 0, 0, 1])).toBe(0x000000);
  expect(gray?.counted).toBeUndefined();
});

test("ICCBased approximates by component count", async () => {
  const doc = await openDoc();
  const model = await resolveColorSpace(doc, [name("ICCBased"), dict({ N: 3 })], undefined);
  expect(model?.toRgb([1, 0, 0])).toBe(0xff0000);
  expect(model?.counted).toBeUndefined();
});

test("a Type 2 tint transform interpolates C0 to C1", async () => {
  const doc = await openDoc();
  const model = await resolveColorSpace(doc, name("Cut"), dielineResources());
  expect(model?.toRgb([1])).toBe(0xff0000); // full ink: cmyk(0,1,1,0)
  expect(model?.toRgb([0])).toBe(0xffffff); // no ink: cmyk(0,0,0,0)
  expect(model?.toRgb([0.5])).toBe(0xff8080); // midpoint of each component
  expect(model?.counted).toBeUndefined();
});

test("a Type 3 stitching function delegates to its pieces", async () => {
  const doc = await openDoc();
  const half = (c1: number[]) => dict({ FunctionType: 2, Domain: [0, 1], N: 1, C0: [0], C1: c1 });
  const space: PdfValue = [
    name("Separation"),
    name("Ink"),
    name("DeviceGray"),
    dict({
      FunctionType: 3,
      Domain: [0, 1],
      Functions: [half([0.5]), half([1])],
      Bounds: [0.5],
      Encode: [0, 1, 0, 1],
    }),
  ];
  const model = await resolveColorSpace(doc, space, undefined);
  // t=0.25 lands in the first piece at its own t=0.5 → gray 0.25.
  expect(model?.toRgb([0.25])).toBe(0x404040);
  // t=1 lands in the second piece at t=1 → gray 1.
  expect(model?.toRgb([1])).toBe(0xffffff);
});

test("single-colorant DeviceN behaves as a Separation", async () => {
  const doc = await openDoc();
  const space: PdfValue = [
    name("DeviceN"),
    [name("Varnish")],
    name("DeviceCMYK"),
    dict({ FunctionType: 2, Domain: [0, 1], N: 1, C0: [0, 0, 0, 0], C1: [0, 0, 0, 1] }),
  ];
  const model = await resolveColorSpace(doc, space, undefined);
  expect(model?.toRgb([1])).toBe(0x000000);
  expect(model?.counted).toBeUndefined();
});

test("an unevaluable tint transform is counted and falls back to ink coverage", async () => {
  const doc = await openDoc();
  const space: PdfValue = [
    name("Separation"),
    name("Ink"),
    name("DeviceCMYK"),
    dict({ FunctionType: 4 }),
  ];
  const model = await resolveColorSpace(doc, space, undefined);
  expect(model?.counted).toBe(CS_TINT_TRANSFORM);
  expect(model?.toRgb([1])).toBe(0x000000); // full ink goes dark, never white
  expect(model?.toRgb([0])).toBe(0xffffff);
});

test("Lab, Indexed, multi-colorant DeviceN, and unknown names are counted", async () => {
  const doc = await openDoc();
  const cases: PdfValue[] = [
    [name("Lab"), dict({})],
    [name("Indexed"), name("DeviceRGB"), 1, { bytes: new Uint8Array(6) } as PdfValue],
    [name("DeviceN"), [name("A"), name("B")], name("DeviceCMYK"), dict({ FunctionType: 4 })],
    name("NoSuchResource"),
  ];
  for (const value of cases) {
    const model = await resolveColorSpace(doc, value, dict({}));
    expect(model?.counted).toBe(CS_UNSUPPORTED);
    expect(model?.toRgb([1])).toBeUndefined();
  }
});

/* ---------- the interpreter, end to end ---------- */

test("a stroked spot colour keeps its intended colour, not white", async () => {
  // The captured failure's shape: white default, then full-tint separations.
  const { entities, unsupported } = await run(
    "1 g 1 G /Cut CS 1 SCN 0 0 m 10 10 l S /Crease CS 1 SCN 0 0 m 5 0 l S",
    dielineResources(),
  );
  const lines = polylines(entities);
  expect(lines[0]?.color).toBe(0xff0000);
  expect(lines[1]?.color).toBe(0x00ff00);
  expect(unsupported).toEqual({});
});

test("a filled spot colour colours the hatch", async () => {
  const { entities } = await run("/Cut cs 1 scn 0 0 m 10 0 l 10 10 l h f", dielineResources());
  expect(hatches(entities)[0]?.color).toBe(0xff0000);
});

test("q/Q restores the selected colour space", async () => {
  const { entities } = await run(
    "/Cut CS q /Crease CS 1 SCN 0 0 m 1 1 l S Q 1 SCN 0 0 m 2 2 l S",
    dielineResources(),
  );
  const lines = polylines(entities);
  expect(lines[0]?.color).toBe(0x00ff00);
  expect(lines[1]?.color).toBe(0xff0000); // outer Cut survived the Q
});

test("an unresolvable space leaves the colour and counts, never guesses white", async () => {
  const { entities, unsupported } = await run(
    "0 0 1 RG /Missing CS 1 SCN 0 0 m 10 10 l S",
    dielineResources(),
  );
  expect(polylines(entities)[0]?.color).toBe(0x0000ff); // the blue stands
  expect(unsupported[CS_UNSUPPORTED]).toBe(1);
});

test("scn without cs still identifies device spaces by component count", async () => {
  const { entities } = await run("1 0 0 sc 0 0 m 10 0 l 10 10 l h f");
  expect(hatches(entities)[0]?.color).toBe(0xff0000);
});

test("a pattern operand is still counted, not coloured", async () => {
  const { unsupported } = await run("/Pattern cs /P0 scn 0 0 m 10 0 l 10 10 l h f");
  expect(unsupported.PatternFill).toBe(1);
});
