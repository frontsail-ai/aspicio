/**
 * Colour maths for keeping line work legible on a light canvas (VIEW-18).
 *
 * A DXF pen colour is a *display attribute* — ACI 2 means "the second pen",
 * and the RGB it resolves to is a convention for showing that pen on a black
 * screen. On a light canvas the bright end of that palette is unreadable:
 * ACI yellow is 1.3:1 against #dcd8d1. So pen colours are darkened until they
 * are legible, hue intact.
 *
 * PDF ink is not a display attribute and never goes through this. A dieline
 * authored in 100% cyan has to render as 100% cyan on the sheet in both
 * themes or the viewer stops being usable for prepress.
 *
 * The rule targets *contrast* rather than a fixed lightness, which matters
 * more than it sounds. OKLab lightness and WCAG relative luminance do not
 * track across hues — yellow at L=0.62 is far more luminous than blue at the
 * same L — so no fixed lightness threshold can promise a contrast ratio. A
 * threshold of L<=0.62 leaves ACI green at 2.4:1, red at 2.9:1 and yellow at
 * 2.5:1, all below the 3:1 it was meant to guarantee.
 */

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

/** WCAG 2.1 relative luminance of a 24-bit RGB colour. */
export function relativeLuminance(color: number): number {
  const r = srgbToLinear(((color >> 16) & 0xff) / 255);
  const g = srgbToLinear(((color >> 8) & 0xff) / 255);
  const b = srgbToLinear((color & 0xff) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two 24-bit RGB colours, 1..21. */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

interface Oklab {
  L: number;
  a: number;
  b: number;
}

/** 24-bit RGB → OKLab. */
function toOklab(color: number): Oklab {
  const r = srgbToLinear(((color >> 16) & 0xff) / 255);
  const g = srgbToLinear(((color >> 8) & 0xff) / 255);
  const b = srgbToLinear((color & 0xff) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab → linear sRGB triple, possibly out of gamut. */
function toLinearRgb({ L, a, b }: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const IN_GAMUT_EPS = 1e-3;
const inGamut = (rgb: readonly number[]): boolean =>
  rgb.every((c) => c >= -IN_GAMUT_EPS && c <= 1 + IN_GAMUT_EPS);

/** Pack a linear-RGB triple back into a 24-bit colour, clamping to gamut. */
function pack(rgb: readonly [number, number, number]): number {
  let out = 0;
  for (const c of rgb) {
    const v = Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255);
    out = (out << 8) | v;
  }
  return out >>> 0;
}

const SEARCH_STEPS = 24;

/**
 * The colour at lightness `L` with this hue, chroma reduced only as far as
 * gamut requires. Reducing chroma rather than clipping channels is what keeps
 * a darkened red from sliding towards brown.
 */
function atLightness(hue: number, chroma: number, L: number): number {
  let lo = 0;
  let hi = chroma;
  let best = 0;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    const candidate = { L, a: Math.cos(hue) * mid, b: Math.sin(hue) * mid };
    if (inGamut(toLinearRgb(candidate))) {
      best = mid;
      lo = mid;
    } else hi = mid;
  }
  return pack(toLinearRgb({ L, a: Math.cos(hue) * best, b: Math.sin(hue) * best }));
}

/**
 * Darken `color` until it reaches `target` contrast against `background`,
 * preserving hue. Returns it unchanged when it is already legible.
 *
 * Only darkens, never lightens: on a light canvas the illegible colours are
 * the bright ones, and lightening a dark pen would fight the same problem
 * from the other side while changing drawings that were already fine.
 *
 * That one-directionality is why the unreachable case matters. Darkening
 * only helps against a *light* background; against a dark one it walks the
 * colour towards the background, so a naive "go as dark as possible" would
 * turn a legible blue on a dark canvas into an invisible one. When the
 * target cannot be reached, this returns whichever of the two ends actually
 * reads better — which leaves dark canvases alone and still darkens fully
 * on a light canvas that no hue can quite clear.
 */

/**
 * Chroma below which a colour carries no hue worth preserving, and its
 * identity is entirely in its lightness.
 *
 * ACI 7 — the default DXF pen, and the most common colour in real drawings —
 * arrives as white, because the palette assumes a black screen. On a light
 * canvas it has to become ink, the same flip AutoCAD performs. Everything
 * else in the achromatic ramp gets the same treatment for the same reason.
 */
const ACHROMATIC = 0.05;

/** The grey at OKLab lightness `L`. */
function greyAt(L: number): number {
  const v = Math.round(Math.min(1, Math.max(0, linearToSrgb(L ** 3))) * 255);
  return ((v << 16) | (v << 8) | v) >>> 0;
}

/** The lightness whose grey exactly meets `target` against `background`. */
function greyLightnessAt(background: number, target: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(greyAt(mid), background) >= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Blend two 24-bit colours in sRGB. */
function mix(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const va = (a >> shift) & 0xff;
    const vb = (b >> shift) & 0xff;
    out = (out << 8) | Math.round(va + (vb - va) * t);
  }
  return out >>> 0;
}

/**
 * Make a pen colour legible against `canvas`, darkening towards `ink`.
 *
 * Chromatic colours stop at `target`: their identity is their hue, and
 * darkening past legibility only muddies it. Achromatic ones have no hue to
 * carry them, so their whole ramp is reflected into `[ink, just-legible]`.
 *
 * The reflection matters more than the endpoint. Clamping the achromatic
 * ramp at the target maps every grey from #a0a0a0 to #ffffff onto a single
 * mid-grey — ninety-six values to one — so a drawing that separates linework
 * by grey level loses the separation entirely. Reflecting keeps them
 * distinct and keeps their order: the lightest input, the most prominent on
 * a dark screen, becomes the darkest output, the most prominent on a light
 * one.
 */
export function darkenForLegibility(
  color: number,
  canvas: number,
  target: number,
  ink: number,
): number {
  if (contrastRatio(color, canvas) >= target) return color;

  const { L, a, b } = toOklab(color);
  if (Math.hypot(a, b) >= ACHROMATIC) return darkenForContrast(color, canvas, target);

  const floor = greyLightnessAt(canvas, target);
  const inkL = toOklab(ink).L;
  if (floor <= inkL) return ink;
  // Reflect: L = 1 (white) lands on ink, L = floor stays where it is.
  const t = Math.min(1, Math.max(0, (L - floor) / (1 - floor)));
  return mix(greyAt(floor), ink, t);
}

export function darkenForContrast(color: number, background: number, target: number): number {
  if (contrastRatio(color, background) >= target) return color;

  const { L, a, b } = toOklab(color);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);

  const darkest = atLightness(hue, chroma, 0);
  if (contrastRatio(darkest, background) < target)
    return contrastRatio(darkest, background) > contrastRatio(color, background) ? darkest : color;

  let lo = 0; // known to meet the target
  let hi = L; // known to miss it
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(atLightness(hue, chroma, mid), background) >= target) lo = mid;
    else hi = mid;
  }
  return atLightness(hue, chroma, lo);
}
