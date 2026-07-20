import type { ViewState } from "@aspicio/core";

/**
 * The demo's shareable view: camera pose + which layers are off + which space.
 *
 * Layer visibility is stored as whichever of the hidden/visible index sets is
 * smaller (`packLayers`), so soloing one layer of a many-layer drawing stays a
 * handful of characters instead of listing every hidden index. At most one of
 * `hiddenLayerIndices` / `visibleLayerIndices` is set; neither means all
 * visible.
 */
export interface ViewLink {
  view: ViewState;
  /** Indices (into `getLayers()`) that are hidden. */
  hiddenLayerIndices?: number[];
  /** Indices (into `getLayers()`) that are visible — everything else is hidden. */
  visibleLayerIndices?: number[];
  /** Index into `getSpaces()`; 0 = model space. */
  spaceIndex: number;
}

/**
 * Choose the more compact layer encoding: list the hidden indices, or the
 * visible ones, whichever set is smaller. Returns `{}` when nothing is hidden.
 */
export function packLayers(
  hidden: number[],
  layerCount: number,
): Pick<ViewLink, "hiddenLayerIndices" | "visibleLayerIndices"> {
  if (hidden.length === 0) return {};
  const hiddenSet = new Set(hidden);
  const visible: number[] = [];
  for (let i = 0; i < layerCount; i++) if (!hiddenSet.has(i)) visible.push(i);
  return visible.length < hidden.length
    ? { visibleLayerIndices: visible }
    : { hiddenLayerIndices: hidden };
}

// Round to a sensible number of significant figures so the URL stays short
// without visibly shifting the view. Center can be large; angle is small.
const p = (n: number, sig: number): string => Number(n.toPrecision(sig)).toString();

/**
 * Serialize a view to a URL hash: `#v=cx,cy,upp,rot&h=i,j&s=n` (or `V=` for the
 * visible set). The layer and `s` parts are omitted when nothing is hidden / the
 * space is model. Returns "" for an empty (unloaded) view so the caller can
 * clear the hash.
 */
export function encodeView(link: ViewLink): string {
  const { view, spaceIndex } = link;
  if (!(view.unitsPerPixel > 0)) return "";
  const parts = [
    `v=${p(view.center.x, 7)},${p(view.center.y, 7)},${p(view.unitsPerPixel, 6)},${p(view.rotation, 5)}`,
  ];
  if (link.visibleLayerIndices) parts.push(`V=${link.visibleLayerIndices.join(",")}`);
  else if (link.hiddenLayerIndices?.length) parts.push(`h=${link.hiddenLayerIndices.join(",")}`);
  if (spaceIndex > 0) parts.push(`s=${spaceIndex}`);
  return `#${parts.join("&")}`;
}

const ints = (s: string): number[] =>
  s
    .split(",")
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n >= 0);

/**
 * Parse a hash produced by {@link encodeView}. Returns `null` when there is no
 * usable `v=` component (missing, malformed, or non-finite) so the caller can
 * skip restoring (cold start then shows the normal empty screen). Tolerant
 * of hand-edited or truncated links.
 */
export function decodeView(hash: string): ViewLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const v = params.get("v");
  if (!v) return null;
  const [cx, cy, upp, rot] = v.split(",").map(Number);
  if (![cx, cy, upp, rot].every(Number.isFinite) || !(upp > 0)) return null;

  const link: ViewLink = {
    view: { center: { x: cx, y: cy }, unitsPerPixel: upp, rotation: rot },
    spaceIndex: Math.max(0, Number.parseInt(params.get("s") ?? "0", 10) || 0),
  };
  const visible = params.get("V");
  const hidden = params.get("h");
  // `V` present (even empty ⇒ all hidden) wins; else fall back to `h`.
  if (visible !== null) link.visibleLayerIndices = ints(visible);
  else if (hidden !== null) link.hiddenLayerIndices = ints(hidden);
  return link;
}
