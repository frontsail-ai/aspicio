import type { DrawingParser } from "@aspicio/core";

/**
 * The formats this page has opted into (ELEM-9).
 *
 * Importing `@aspicio/elements` brings the components but no parser: a host
 * imports `@aspicio/elements/formats/dxf` (or another format entry) and that
 * module registers itself here. Keeping registration out of the components is
 * what lets a bundler drop the formats a page never imports (INV-11).
 *
 * The array identity is stable and handed straight to the viewer, which reads
 * it when a load starts — so a format imported after a component was
 * constructed still counts, and registering one never disturbs a live viewer.
 */
const registered: DrawingParser[] = [];

/** Register a format. Called by the `formats/*` entry points, not by hosts. */
export function registerFormat(parser: DrawingParser): void {
  if (!registered.some((p) => p.format === parser.format)) registered.push(parser);
}

/** The live parser list, in registration order. Do not mutate. */
export function registeredFormats(): DrawingParser[] {
  return registered;
}
