/**
 * Optional-content groups → layers (PDF-7).
 *
 * Everything a page needs is resolved once, here, into plain maps keyed by
 * object number, so the interpreter can ask "what layer is this?" without
 * awaiting anything mid-content-stream.
 *
 * The shape of this module follows a corpus probe of nine real OCG files
 * rather than the PDF specification alone, because the two disagree about what
 * matters:
 *
 * - Membership dictionaries are the common case (57 of them), yet every single
 *   one references exactly one group. So a membership resolves to a group and
 *   the entity→layer 1:1 model stands; the multi-group branch exists, counts
 *   itself, and on this evidence will essentially never run.
 * - `/Order` is routinely partial — one file declares 35 groups and orders 3,
 *   another orders none — so it decides sequence, never membership.
 * - `/BaseState` was absent in all nine files, which is exactly why it is
 *   handled here: reading only `/OFF` works on every file we have and inverts
 *   the first document that ships `/BaseState /OFF`, silently.
 */

import { isName, isRef } from "./objects.ts";
import type { PdfDict, PdfValue } from "./objects.ts";
import type { PdfDocument } from "./document.ts";

/** PDF-8 kinds this module can report. */
export const OC_MEMBERSHIP = "OptionalContentMembership";
export const OC_VISIBILITY_EXPRESSION = "VisibilityExpression";
export const OC_PRINT_DIFFERS = "PrintVisibilityDiffers";

/** One optional-content group, in panel order. */
export interface OcgLayer {
  /** Object-number key; layer identity is document-wide (PDF-7). */
  readonly key: string;
  readonly name: string;
  readonly visible: boolean;
}

/** What an `/OC` reference means for the content it marks. */
export interface OcResolution {
  /** Layer to place content on; absent leaves it on "Content". */
  readonly layerKey?: string;
  /** PDF-8 kind to count, when resolving simplified or refused. */
  readonly counted?: string;
}

const refKey = (value: PdfValue | undefined): string | undefined =>
  isRef(value) ? `${value.num}R` : undefined;

export class OptionalContent {
  /** Groups in panel order: `/Order` first, then the rest of `/OCGs`. */
  readonly layers: readonly OcgLayer[];
  private readonly doc: PdfDocument | undefined;
  private readonly names: ReadonlyMap<string, string>;
  /** Membership dictionaries resolve once and are referenced many times over —
   *  one corpus file has 49 of them behind 1041 references. */
  private readonly cache = new Map<string, OcResolution | undefined>();

  constructor(
    layers: readonly OcgLayer[],
    names: ReadonlyMap<string, string> = new Map(),
    doc?: PdfDocument,
  ) {
    this.layers = layers;
    this.names = names;
    this.doc = doc;
  }

  /** Empty model — a file with no `/OCProperties` at all. */
  static empty(): OptionalContent {
    return new OptionalContent([], new Map());
  }

  get isEmpty(): boolean {
    return this.layers.length === 0;
  }

  /**
   * Resolve an `/OC` value (from `BDC` properties or an XObject's `/OC`).
   *
   * Resolves on demand rather than by scanning every object: membership
   * dictionaries are not listed in `/OCProperties`, and only the ones content
   * actually references matter. Returns undefined when the value names nothing
   * we know — unmarked content, which stays on "Content" counting nothing.
   */
  async resolve(value: PdfValue | undefined): Promise<OcResolution | undefined> {
    const key = refKey(value);
    if (key === undefined) return undefined;
    if (this.cache.has(key)) return this.cache.get(key);

    let resolution: OcResolution | undefined;
    if (this.names.has(key)) {
      resolution = { layerKey: key };
    } else if (this.doc) {
      resolution = await this.resolveMembership(value);
    }
    this.cache.set(key, resolution);
    return resolution;
  }

  private async resolveMembership(value: PdfValue | undefined): Promise<OcResolution | undefined> {
    const dict = await this.doc?.dict(value);
    const type = dict?.get("Type");
    if (!dict || !isName(type) || type.name !== "OCMD") return undefined;

    // A visibility expression is a boolean tree, not a layer. Not evaluated.
    if (dict.has("VE")) return { counted: OC_VISIBILITY_EXPRESSION };

    const members = await this.doc!.array(dict.get("OCGs"));
    const keys = members
      .map(refKey)
      .filter((k): k is string => k !== undefined && this.names.has(k));
    if (keys.length === 0) return { counted: OC_MEMBERSHIP };
    // One group is a layer. Several is a set: take the first and count the
    // simplification. No corpus file has ever taken that branch.
    return { layerKey: keys[0], ...(keys.length > 1 ? { counted: OC_MEMBERSHIP } : {}) };
  }

  /** Display name for a layer key. */
  nameOf(key: string): string | undefined {
    return this.layers.find((l) => l.key === key)?.name;
  }
}

/** Flatten `/Order`, which nests arrays and interleaves label strings. */
async function orderedKeys(doc: PdfDocument, order: PdfValue[]): Promise<string[]> {
  const keys: string[] = [];
  const walk = async (items: PdfValue[]): Promise<void> => {
    for (const item of items) {
      const key = refKey(item);
      if (key !== undefined) {
        keys.push(key);
        continue;
      }
      const resolved = await doc.resolve(item);
      if (Array.isArray(resolved)) await walk(resolved);
      // Anything else is a group label; it orders nothing.
    }
  };
  await walk(order);
  return keys;
}

/** Read `/OCProperties` into a resolved, synchronously queryable model. */
export async function readOptionalContent(
  doc: PdfDocument,
  catalog: PdfDict | undefined,
  unsupported: Record<string, number> = {},
): Promise<OptionalContent> {
  const props = await doc.dict(catalog?.get("OCProperties"));
  if (!props) return OptionalContent.empty();

  const groupRefs = await doc.array(props.get("OCGs"));
  const config = (await doc.dict(props.get("D"))) ?? new Map<string, PdfValue>();

  // Names, keyed by object number — layer identity is document-wide, so a
  // group referenced from several pages is one layer (PDF-7).
  const names = new Map<string, string>();
  for (const ref of groupRefs) {
    const key = refKey(ref);
    if (key === undefined || names.has(key)) continue;
    const group = await doc.dict(ref);
    names.set(key, await readName(doc, group, key));
  }

  // Visibility. `/BaseState` defaults to /ON, in which case `/OFF` hides;
  // with /OFF everything is hidden except `/ON`.
  const baseState = await doc.resolve(config.get("BaseState"));
  const baseVisible = !(isName(baseState) && baseState.name === "OFF");
  const listed = new Set<string>();
  for (const ref of await doc.array(config.get(baseVisible ? "OFF" : "ON"))) {
    const key = refKey(ref);
    if (key !== undefined) listed.add(key);
  }
  const visibleOf = (key: string): boolean => (listed.has(key) ? !baseVisible : baseVisible);

  // Panel order: `/Order` selects sequence, never membership.
  const ordered = await orderedKeys(doc, await doc.array(config.get("Order")));
  const seen = new Set<string>();
  const layers: OcgLayer[] = [];
  // Two groups may declare the same name — a real file does. A document's
  // layers are keyed by name, so a collision would merge them: one panel row
  // where the file has two, and a toggle hiding content the user did not ask
  // to hide. The later group is suffixed instead, so every declared group
  // keeps its own row and its own toggle (PDF-7).
  const usedNames = new Map<string, number>();
  const uniqueName = (name: string): string => {
    const seenCount = usedNames.get(name) ?? 0;
    usedNames.set(name, seenCount + 1);
    return seenCount === 0 ? name : `${name} (${seenCount + 1})`;
  };
  const push = (key: string): void => {
    if (seen.has(key) || !names.has(key)) return;
    seen.add(key);
    layers.push({ key, name: uniqueName(names.get(key) ?? key), visible: visibleOf(key) });
  };
  for (const key of ordered) push(key);
  for (const ref of groupRefs) {
    const key = refKey(ref);
    if (key !== undefined) push(key);
  }

  // Print-vs-screen divergence: the screen state is used, the difference is
  // counted (PDF-7, PDF-8). Aspicio is a viewer.
  await countPrintDivergence(doc, config, layers, visibleOf, unsupported);

  return new OptionalContent(layers, names, doc);
}

async function readName(
  doc: PdfDocument,
  group: PdfDict | undefined,
  fallback: string,
): Promise<string> {
  const name = await doc.resolve(group?.get("Name"));
  if (name && typeof name === "object" && "bytes" in name) return decodeTextString(name.bytes);
  return fallback;
}

/** PDF text strings are UTF-16BE with a BOM, or PDFDocEncoding otherwise. */
function decodeTextString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2)
      out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return out;
  }
  return String.fromCharCode(...bytes);
}

/** Count groups whose `/Print` usage state contradicts the screen state used. */
async function countPrintDivergence(
  doc: PdfDocument,
  config: PdfDict,
  layers: readonly OcgLayer[],
  visibleOf: (key: string) => boolean,
  unsupported: Record<string, number>,
): Promise<void> {
  const applications = await doc.array(config.get("AS"));
  if (applications.length === 0) return;
  const byKey = new Map(layers.map((l) => [l.key, l]));

  for (const entry of applications) {
    const app = await doc.dict(entry);
    const event = await doc.resolve(app?.get("Event"));
    if (!isName(event) || event.name !== "Print") continue;
    for (const ref of await doc.array(app?.get("OCGs"))) {
      const key = refKey(ref);
      if (key === undefined || !byKey.has(key)) continue;
      const usage = await doc.dict((await doc.dict(ref))?.get("Usage"));
      const print = await doc.dict(usage?.get("Print"));
      const state = await doc.resolve(print?.get("PrintState"));
      if (!isName(state)) continue;
      if ((state.name === "ON") !== visibleOf(key)) {
        unsupported[OC_PRINT_DIFFERS] = (unsupported[OC_PRINT_DIFFERS] ?? 0) + 1;
      }
    }
  }
}
