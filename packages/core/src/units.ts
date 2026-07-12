/**
 * DXF drawing units. `$INSUNITS` (header) codes map to short display labels;
 * unknown or unitless drawings return "" so the UI can show bare numbers.
 */
const INSUNITS: Record<number, string> = {
  0: "", // unitless
  1: "in",
  2: "ft",
  3: "mi",
  4: "mm",
  5: "cm",
  6: "m",
  7: "km",
  8: "µin",
  9: "mil",
  10: "yd",
  11: "Å",
  12: "nm",
  13: "µm",
  14: "dm",
  15: "dam",
  16: "hm",
  17: "Gm",
  18: "AU",
  19: "ly",
  20: "pc",
};

/** Short unit label for an `$INSUNITS` code (e.g. 4 → "mm"), or "" if unitless/unknown. */
export function unitLabel(insunits: number | undefined): string {
  return (insunits !== undefined && INSUNITS[insunits]) || "";
}

/**
 * Largest "nice" length (1, 2, or 5 × 10ⁿ) not exceeding `max`. Used to size a
 * scale bar to a round number of drawing units. Returns 0 for non-positive max.
 */
export function niceLength(max: number): number {
  if (!(max > 0) || !Number.isFinite(max)) return 0;
  const base = 10 ** Math.floor(Math.log10(max));
  for (const m of [5, 2, 1]) {
    if (m * base <= max) return m * base;
  }
  return base;
}
