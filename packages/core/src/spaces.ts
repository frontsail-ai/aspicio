import type { DrawingDocument, Entity, Layout, PageGeometry } from "./model/types.ts";

/** Thrown when a caller names a space the drawing does not have. */
export class UnknownSpaceError extends Error {
  constructor(name: string, available: readonly string[]) {
    super(
      `Unknown space "${name}" — this drawing has ${available.map((s) => `"${s}"`).join(", ")}`,
    );
    this.name = "UnknownSpaceError";
  }
}

/** The implicit space every drawing has; layouts are named alongside it. */
export const MODEL_SPACE = "Model";

/** Every space this drawing offers, model space first (VIEW-14, PDF-5). */
export function spaceNames(doc: DrawingDocument): string[] {
  return [MODEL_SPACE, ...(doc.layouts ?? []).map((l) => l.name)];
}

/**
 * The top-level entities a layout draws: its own sheet geometry, plus model
 * space when the sheet has viewports — those windows show model content, so a
 * layer used only in model space is on screen while a sheet is displayed, and
 * reporting 0 for it would contradict the canvas (INV-2).
 *
 * Model space is added once however many windows show it, so no entity is
 * counted twice within one space.
 */
export function layoutEntities(doc: DrawingDocument, layout: Layout): Entity[] {
  return layout.viewports.length > 0 ? [...layout.entities, ...doc.entities] : layout.entities;
}

/** The entities one space draws, or null when the drawing has no such space. */
export function spaceEntities(doc: DrawingDocument, name?: string): Entity[] | null {
  if (name === undefined || name === MODEL_SPACE) return doc.entities;
  const layout = doc.layouts?.find((l) => l.name === name);
  return layout ? layoutEntities(doc, layout) : null;
}

/**
 * The page geometry of one space, or null when the space is unbounded.
 *
 * This is the question the backdrop, the fit, and the host's canvas styling
 * all ask, and they must agree: a space either declares paper or it does not.
 * Deliberately keyed off the space rather than `doc.format`, because "is this
 * a PDF" and "does this space have a sheet" are not the same question — a PDF
 * page whose box would not read has no sheet, and answering from the format
 * would promise one.
 */
export function spacePage(doc: DrawingDocument, name?: string): PageGeometry | null {
  if (name === undefined || name === MODEL_SPACE) return doc.page ?? null;
  return doc.layouts?.find((l) => l.name === name)?.page ?? null;
}

/**
 * How many top-level entities the drawing holds, each counted once — the
 * length of {@link documentEntities} without building it, for the callers
 * that only want the number.
 */
export function documentEntityCount(doc: DrawingDocument): number {
  let total = doc.entities.length;
  for (const layout of doc.layouts ?? []) total += layout.entities.length;
  return total;
}

/**
 * Every top-level entity in the drawing, each once.
 *
 * Not the concatenation of {@link spaceEntities} over {@link spaceNames}:
 * spaces do not partition a drawing, because a sheet's viewports re-show model
 * geometry that is already counted in model space. This is the "how much is in
 * this file" number; a space's own count is the "what is on screen" one.
 */
export function documentEntities(doc: DrawingDocument): Entity[] {
  const out = [...doc.entities];
  for (const layout of doc.layouts ?? []) out.push(...layout.entities);
  return out;
}
