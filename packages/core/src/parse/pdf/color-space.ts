/**
 * Colour spaces → RGB (PDF-3).
 *
 * `cs`/`CS` name a space; `sc`/`scn` supply components whose meaning depends
 * entirely on that space. Guessing the space from the component count reads a
 * spot-colour tint of 1 — full ink — as "gray 1", which is white: the most
 * visible content in a prepress file becomes the least. So spaces resolve
 * here, once, into a model the interpreter can query synchronously
 * mid-content-stream (the same shape optional-content.ts uses), and every
 * space this viewer cannot convert faithfully colours loudly: it is counted
 * (PDF-8), and a tint falls back to ink coverage — dark where the ink is
 * dense — never to white.
 *
 * What converts, what approximates, what falls back:
 *
 * - Device spaces (and their Cal* siblings) convert exactly as the direct
 *   operators (`rg`, `k`, `g`) do.
 * - ICCBased approximates by component count — the alternate reading the PDF
 *   specification itself prescribes for viewers without colour management.
 *   Not counted, for the same reason `k` isn't.
 * - Separation and single-colorant DeviceN evaluate their tint transform
 *   (FunctionType 2, and 3 stitching over evaluable children) into the
 *   alternate space. This is the dieline case: /Cutting and /Creasing keep
 *   their intended colours.
 * - A tint transform this module cannot evaluate (sampled or PostScript
 *   functions) is counted and approximated as `gray(1 - tint)`.
 * - Indexed, Lab, multi-colorant DeviceN, and unknown families are counted
 *   and leave the current colour untouched.
 */

import { isName } from "./objects.ts";
import type { PdfDict, PdfValue } from "./objects.ts";
import type { PdfDocument } from "./document.ts";

/** PDF-8 kinds this module can report. */
export const CS_UNSUPPORTED = "ColorSpace";
export const CS_TINT_TRANSFORM = "TintTransform";

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

export const rgb = (r: number, g: number, b: number): number =>
  (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);

/** Naive CMYK → RGB, which is what a viewer without colour management can do. */
export const cmykToRgb = (c: number, m: number, y: number, k: number): number =>
  rgb((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));

export const grayToRgb = (g: number): number => rgb(g, g, g);

/** A resolved colour space: everything asynchronous already happened. */
export interface ColorSpaceModel {
  /** RGB for these operands, or undefined to leave the current colour. */
  readonly toRgb: (nums: readonly number[]) => number | undefined;
  /** PDF-8 kind to count each time this space colours content. */
  readonly counted?: string;
  /**
   * Components one colour takes, when the family defines it — what the
   * image decoder needs to unpack packed samples (PDF-9). Absent for
   * spaces that never colour (`UNSUPPORTED`).
   */
  readonly components?: number;
}

const at = (nums: readonly number[], i: number): number =>
  typeof nums[i] === "number" ? (nums[i] as number) : 0;

const DEVICE_GRAY: ColorSpaceModel = { toRgb: (n) => grayToRgb(at(n, 0)), components: 1 };
const DEVICE_RGB: ColorSpaceModel = {
  toRgb: (n) => rgb(at(n, 0), at(n, 1), at(n, 2)),
  components: 3,
};
const DEVICE_CMYK: ColorSpaceModel = {
  toRgb: (n) => cmykToRgb(at(n, 0), at(n, 1), at(n, 2), at(n, 3)),
  components: 4,
};

const UNSUPPORTED: ColorSpaceModel = { toRgb: () => undefined, counted: CS_UNSUPPORTED };

const DEVICE_FAMILIES: ReadonlyMap<string, ColorSpaceModel> = new Map([
  ["DeviceGray", DEVICE_GRAY],
  ["DeviceRGB", DEVICE_RGB],
  ["DeviceCMYK", DEVICE_CMYK],
  ["CalGray", DEVICE_GRAY],
  ["CalRGB", DEVICE_RGB],
]);

/** Alternate spaces may nest (a Separation over an ICCBased over …). */
const MAX_ALTERNATE_DEPTH = 4;

/**
 * Resolve a `cs`/`CS` operand — or a nested alternate — into a model.
 *
 * `undefined` means "no opinion": device names the arity heuristic already
 * handles, a Pattern space (whose `scn` operand names the pattern and is
 * counted at the operator), or a value that names nothing at all.
 */
export async function resolveColorSpace(
  doc: PdfDocument,
  value: PdfValue | undefined,
  resources: PdfDict | undefined,
  depth = 0,
): Promise<ColorSpaceModel | undefined> {
  if (depth > MAX_ALTERNATE_DEPTH) return UNSUPPORTED;

  if (isName(value)) {
    const device = DEVICE_FAMILIES.get(value.name);
    if (device) return device;
    // Pattern's scn operand is a pattern name; the operator counts it.
    if (value.name === "Pattern") return undefined;
    const spaces = await doc.dict(resources?.get("ColorSpace"));
    const entry = spaces?.get(value.name);
    // A name that resolves to nothing is a broken file; treating it as the
    // arity heuristic would repeat the white-spot-colour failure, so it is
    // counted and the current colour stands.
    if (entry === undefined) return UNSUPPORTED;
    return resolveColorSpace(doc, await doc.resolve(entry), resources, depth + 1);
  }

  const array = await doc.array(value);
  const family = array[0];
  if (!isName(family)) return value === undefined ? undefined : UNSUPPORTED;
  const device = DEVICE_FAMILIES.get(family.name);
  if (device) return device;

  switch (family.name) {
    case "ICCBased": {
      // The stream itself is the profile; /N is the component count, and
      // reading it as the matching device space is the alternate the spec
      // prescribes for viewers without colour management.
      const n = (await doc.dict(array[1]))?.get("N");
      if (n === 1) return DEVICE_GRAY;
      if (n === 3) return DEVICE_RGB;
      if (n === 4) return DEVICE_CMYK;
      return UNSUPPORTED;
    }
    case "Separation":
    case "DeviceN": {
      const colorants = family.name === "DeviceN" ? await doc.array(array[1]) : [array[1]];
      // Several colorants means several tint operands feeding one function —
      // sampled or PostScript in practice, so it lands in the fallback anyway.
      if (colorants.length !== 1) return UNSUPPORTED;
      const alternate = await resolveColorSpace(
        doc,
        await doc.resolve(array[2]),
        resources,
        depth + 1,
      );
      const transform = await compileFunction(doc, array[3]);
      if (!transform || !alternate) {
        // Approximate the tint as ink coverage: full ink is dark, never white.
        return {
          toRgb: (nums) => grayToRgb(1 - at(nums, 0)),
          counted: CS_TINT_TRANSFORM,
          components: 1,
        };
      }
      return {
        toRgb: (nums) => alternate.toRgb(transform(at(nums, 0))),
        ...(alternate.counted ? { counted: alternate.counted } : {}),
        components: 1,
      };
    }
    default:
      // Indexed, Lab, and anything newer: counted, colour left untouched.
      return UNSUPPORTED;
  }
}

type TintTransform = (t: number) => number[];

/**
 * Compile a tint transform into a synchronous evaluator.
 *
 * FunctionType 2 is exponential interpolation; 3 stitches subfunctions over a
 * partitioned domain. Sampled (0) and PostScript (4) functions return
 * undefined, which the caller reports as a counted fallback (PDF-8).
 */
async function compileFunction(
  doc: PdfDocument,
  value: PdfValue | undefined,
): Promise<TintTransform | undefined> {
  // doc.dict resolves a stream to its dictionary, so Type 0/4 — which are
  // streams — still identify themselves here and decline.
  const dict = await doc.dict(await doc.resolve(value));
  const type = dict?.get("FunctionType");
  if (!dict) return undefined;

  const domain = (await doc.array(dict.get("Domain"))).map((v) => toFinite(v));
  const lo = domain[0] ?? 0;
  const hi = domain[1] ?? 1;

  if (type === 2) {
    const c0 = (await doc.array(dict.get("C0"))).map((v) => toFinite(v));
    const c1 = (await doc.array(dict.get("C1"))).map((v) => toFinite(v));
    const n = toFinite(dict.get("N"), 1);
    const size = Math.max(c0.length, c1.length, 1);
    return (t) => {
      const x = clamp(t, lo, hi) ** n;
      const out: number[] = [];
      for (let i = 0; i < size; i++) out.push((c0[i] ?? 0) + x * ((c1[i] ?? 1) - (c0[i] ?? 0)));
      return out;
    };
  }

  if (type === 3) {
    const parts: TintTransform[] = [];
    for (const fn of await doc.array(dict.get("Functions"))) {
      const part = await compileFunction(doc, fn);
      if (!part) return undefined;
      parts.push(part);
    }
    const bounds = (await doc.array(dict.get("Bounds"))).map((v) => toFinite(v));
    const encode = (await doc.array(dict.get("Encode"))).map((v) => toFinite(v));
    if (parts.length === 0) return undefined;
    return (t) => {
      const x = clamp(t, lo, hi);
      let k = 0;
      while (k < bounds.length && x >= (bounds[k] as number)) k++;
      const start = k === 0 ? lo : (bounds[k - 1] as number);
      const end = k === bounds.length ? hi : (bounds[k] as number);
      const e0 = encode[2 * k] ?? 0;
      const e1 = encode[2 * k + 1] ?? 1;
      const span = end - start;
      const mapped = span === 0 ? e0 : e0 + ((x - start) / span) * (e1 - e0);
      return (parts[Math.min(k, parts.length - 1)] as TintTransform)(mapped);
    };
  }

  return undefined;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const toFinite = (v: PdfValue | undefined, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
