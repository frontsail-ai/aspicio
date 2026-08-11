/**
 * Pen-colour legibility on a light canvas (VIEW-18).
 *
 * The headline property is the one the rule exists for: after darkening,
 * every colour clears the target against the canvas. It is asserted over the
 * whole ACI-ish gamut rather than a handful of swatches, because a fixed
 * lightness threshold passes a spot check and fails the sweep — which is how
 * the first version of this rule was wrong.
 */

import { describe, expect, it } from "vite-plus/test";
import { contrastRatio, darkenForContrast, relativeLuminance } from "../src/geom/color.ts";

/** The light theme's canvas, which is what pen colours are judged against. */
const CANVAS = 0xdcd8d1;
const TARGET = 3.5;

/** The six ACI colours a DXF drawing reaches for first. */
const ACI = {
  red: 0xff0000,
  yellow: 0xffff00,
  green: 0x00ff00,
  cyan: 0x00ffff,
  blue: 0x0000ff,
  magenta: 0xff00ff,
};

describe("relativeLuminance", () => {
  it("brackets at black and white", () => {
    expect(relativeLuminance(0x000000)).toBe(0);
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 6);
  });
});

describe("contrastRatio", () => {
  it("spans 1:1 to 21:1", () => {
    expect(contrastRatio(0x808080, 0x808080)).toBeCloseTo(1, 6);
    expect(contrastRatio(0x000000, 0xffffff)).toBeCloseTo(21, 6);
  });

  it("is symmetric", () => {
    expect(contrastRatio(0xff0000, CANVAS)).toBeCloseTo(contrastRatio(CANVAS, 0xff0000), 9);
  });
});

describe("darkenForContrast", () => {
  it("leaves an already-legible colour untouched", () => {
    // Near-black on a light canvas is 15:1; nothing to do, and the exact
    // value must survive so a drawing that was fine is byte-identical.
    expect(darkenForContrast(0x101010, CANVAS, TARGET)).toBe(0x101010);
  });

  it.each(Object.entries(ACI))("brings ACI %s up to the target", (_name, color) => {
    const out = darkenForContrast(color, CANVAS, TARGET);
    expect(contrastRatio(out, CANVAS)).toBeGreaterThanOrEqual(TARGET - 0.02);
  });

  it("clears the target across the whole hue circle at full chroma", () => {
    // The property a fixed-lightness rule cannot hold: OKLab lightness and
    // WCAG luminance do not track across hues, so a threshold tuned on red
    // leaves yellow and green short.
    for (let i = 0; i < 360; i += 5) {
      const rad = (i * Math.PI) / 180;
      const to255 = (v: number): number => Math.round((v + 1) * 127.5);
      const color =
        (to255(Math.cos(rad)) << 16) | (to255(Math.sin(rad)) << 8) | to255(-Math.cos(rad));
      const out = darkenForContrast(color, CANVAS, TARGET);
      expect(contrastRatio(out, CANVAS)).toBeGreaterThanOrEqual(TARGET - 0.02);
    }
  });

  it("only ever darkens", () => {
    for (const color of Object.values(ACI)) {
      const out = darkenForContrast(color, CANVAS, TARGET);
      expect(relativeLuminance(out)).toBeLessThanOrEqual(relativeLuminance(color));
    }
  });

  it("keeps hue: a darkened red stays red, a darkened green stays green", () => {
    const red = darkenForContrast(ACI.red, CANVAS, TARGET);
    expect((red >> 16) & 0xff).toBeGreaterThan((red >> 8) & 0xff);
    expect((red >> 16) & 0xff).toBeGreaterThan(red & 0xff);

    const green = darkenForContrast(ACI.green, CANVAS, TARGET);
    expect((green >> 8) & 0xff).toBeGreaterThan((green >> 16) & 0xff);
    expect((green >> 8) & 0xff).toBeGreaterThan(green & 0xff);
  });

  it("falls back to the darkest in-hue colour when the target is unreachable", () => {
    // A mid-grey canvas no colour can clear at 7:1. The contract is "the best
    // of the two ends", not an exception and not a hang.
    const out = darkenForContrast(0xff0000, 0x777777, 7);
    expect(relativeLuminance(out)).toBeLessThan(relativeLuminance(0xff0000));
    expect(contrastRatio(out, 0x777777)).toBeGreaterThan(contrastRatio(0xff0000, 0x777777));
  });

  it("is idempotent", () => {
    for (const color of Object.values(ACI)) {
      const once = darkenForContrast(color, CANVAS, TARGET);
      expect(darkenForContrast(once, CANVAS, TARGET)).toBe(once);
    }
  });

  it("never makes a pen worse on a dark canvas", () => {
    // Darkening only helps against a light background. ACI blue is 2.1:1 on
    // the dark canvas — below the target — and walking it darker would take
    // it to invisible. The rule has to decline rather than "improve" it.
    for (const color of Object.values(ACI)) {
      const out = darkenForContrast(color, 0x16181d, TARGET);
      expect(contrastRatio(out, 0x16181d)).toBeGreaterThanOrEqual(
        contrastRatio(color, 0x16181d) - 1e-9,
      );
    }
  });
});

describe("legibleOn in tessellation", () => {
  it("darkens DXF pen colours but never PDF ink", async () => {
    const { tessellate } = await import("../src/tessellate/tessellate.ts");
    const { darkenForContrast: darken } = await import("../src/geom/color.ts");

    /** One yellow line — the worst case on a light canvas at 1.3:1. */
    const drawing = (format?: string) => ({
      layers: new Map(),
      entities: [
        {
          type: "LINE" as const,
          layer: "0",
          color: ACI.yellow,
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
        },
      ],
      blocks: new Map(),
      lineTypes: new Map(),
      unsupported: {},
      format,
    });

    const drawn = (doc: ReturnType<typeof drawing>, legibleOn?: number): number => {
      const t = tessellate(doc, legibleOn === undefined ? {} : { legibleOn });
      const c = t.layers.get("0")!.colors;
      return (
        (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255)
      );
    };

    const expected = darken(ACI.yellow, CANVAS, TARGET);
    expect(expected).not.toBe(ACI.yellow);

    // DXF: darkened. Also covers the document that names no format at all,
    // which is the case an `=== "dxf"` gate would have silently skipped.
    expect(drawn(drawing("dxf"), CANVAS)).toBe(expected);
    expect(drawn(drawing(undefined), CANVAS)).toBe(expected);

    // PDF: ink, untouched, however light the canvas.
    expect(drawn(drawing("pdf"), CANVAS)).toBe(ACI.yellow);

    // And nothing changes when the caller does not ask.
    expect(drawn(drawing("dxf"))).toBe(ACI.yellow);
  });
});
