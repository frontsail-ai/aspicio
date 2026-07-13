import type { ViewState } from "@aspicio/core";

/** The demo's shareable view: camera pose + which layers are hidden + which space. */
export interface ViewLink {
  view: ViewState;
  /** Indices (into `getLayers()`) of layers that are hidden; empty = all visible. */
  hiddenLayerIndices: number[];
  /** Index into `getSpaces()`; 0 = model space. */
  spaceIndex: number;
}

// Round to a sensible number of significant figures so the URL stays short
// without visibly shifting the view. Center can be large; angle is small.
const p = (n: number, sig: number): string => Number(n.toPrecision(sig)).toString();

/**
 * Serialize a view to a URL hash: `#v=cx,cy,upp,rot&h=i,j&s=n`. The `h` and `s`
 * parts are omitted when nothing is hidden / the space is model. Returns "" for
 * an empty (unloaded) view so the caller can clear the hash.
 */
export function encodeView(link: ViewLink): string {
  const { view, hiddenLayerIndices, spaceIndex } = link;
  if (!(view.unitsPerPixel > 0)) return "";
  const parts = [
    `v=${p(view.center.x, 7)},${p(view.center.y, 7)},${p(view.unitsPerPixel, 6)},${p(view.rotation, 5)}`,
  ];
  if (hiddenLayerIndices.length > 0) parts.push(`h=${hiddenLayerIndices.join(",")}`);
  if (spaceIndex > 0) parts.push(`s=${spaceIndex}`);
  return `#${parts.join("&")}`;
}

const ints = (s: string | undefined): number[] =>
  (s ?? "")
    .split(",")
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n >= 0);

/**
 * Parse a hash produced by {@link encodeView}. Returns `null` when there is no
 * usable `v=` component (missing, malformed, or non-finite) so the caller can
 * fall back to a normal fit. Tolerant of hand-edited or truncated links.
 */
export function decodeView(hash: string): ViewLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const v = params.get("v");
  if (!v) return null;
  const [cx, cy, upp, rot] = v.split(",").map(Number);
  if (![cx, cy, upp, rot].every(Number.isFinite) || !(upp > 0)) return null;
  return {
    view: { center: { x: cx, y: cy }, unitsPerPixel: upp, rotation: rot },
    hiddenLayerIndices: ints(params.get("h") ?? undefined),
    spaceIndex: Math.max(0, Number.parseInt(params.get("s") ?? "0", 10) || 0),
  };
}
