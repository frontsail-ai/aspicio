import { isHttpUrl } from "./fetch-progress.ts";
import type { ViewState } from "@aspicio/core";

/**
 * The demo's shareable view: which drawing (for remote URLs), the camera pose,
 * which layers are off, and which space.
 *
 * Layer visibility is stored as whichever of the hidden/visible index sets is
 * smaller (`packLayers`), so soloing one layer of a many-layer drawing stays a
 * handful of characters instead of listing every hidden index. At most one of
 * `hiddenLayerIndices` / `visibleLayerIndices` is set; neither means all
 * visible.
 *
 * `view.unitsPerPixel === 0` is the "no camera pose" sentinel: a hand-crafted
 * `#src=…` link carries a source but no view, so the caller loads the URL
 * fitted rather than restoring a pose.
 */
export interface ViewLink {
  view: ViewState;
  /** Absolute http(s) URL of a remote drawing this link points at, if any. */
  src?: string;
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
 * Serialize a link to a URL hash: `#src=…&v=cx,cy,upp,rot&h=i,j&s=n` (or `V=`
 * for the visible set). `src` leads when the drawing is a remote URL; the view
 * and layer/`s` parts are omitted when there's no camera pose / nothing hidden /
 * the space is model. Returns "" only when the link carries neither a source nor
 * a usable view, so the caller can clear the hash.
 */
export function encodeView(link: ViewLink): string {
  const { view, spaceIndex } = link;
  const parts: string[] = [];
  if (link.src) parts.push(`src=${encodeURIComponent(link.src)}`);
  if (view.unitsPerPixel > 0) {
    parts.push(
      `v=${p(view.center.x, 7)},${p(view.center.y, 7)},${p(view.unitsPerPixel, 6)},${p(view.rotation, 5)}`,
    );
    if (link.visibleLayerIndices) parts.push(`V=${link.visibleLayerIndices.join(",")}`);
    else if (link.hiddenLayerIndices?.length) parts.push(`h=${link.hiddenLayerIndices.join(",")}`);
    if (spaceIndex > 0) parts.push(`s=${spaceIndex}`);
  }
  return parts.length > 0 ? `#${parts.join("&")}` : "";
}

const ints = (s: string): number[] =>
  s
    .split(",")
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n >= 0);

/**
 * Parse a hash produced by {@link encodeView}. Returns `null` only when the hash
 * carries neither a valid `src=` nor a usable `v=` component, so the caller can
 * fall back to the normal empty screen. A `src`-only link yields the zero-view
 * sentinel (`unitsPerPixel: 0`) so the caller loads the URL without restoring a
 * pose. `src` is validated as http(s) — a `javascript:`/`data:`/`file:` value is
 * dropped. Tolerant of hand-edited or truncated links.
 */
export function decodeView(hash: string): ViewLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const rawSrc = params.get("src");
  const src = rawSrc && isHttpUrl(rawSrc) ? rawSrc : undefined;

  const v = params.get("v");
  const nums = v ? v.split(",").map(Number) : [];
  const [cx, cy, upp, rot] = nums;
  const hasView = v !== null && nums.length === 4 && nums.every(Number.isFinite) && upp > 0;

  // Neither a source nor a pose to restore — nothing to do.
  if (!hasView && !src) return null;

  const link: ViewLink = {
    view: hasView
      ? { center: { x: cx, y: cy }, unitsPerPixel: upp, rotation: rot }
      : { center: { x: 0, y: 0 }, unitsPerPixel: 0, rotation: 0 },
    spaceIndex: Math.max(0, Number.parseInt(params.get("s") ?? "0", 10) || 0),
  };
  if (src) link.src = src;
  if (hasView) {
    const visible = params.get("V");
    const hidden = params.get("h");
    // `V` present (even empty ⇒ all hidden) wins; else fall back to `h`.
    if (visible !== null) link.visibleLayerIndices = ints(visible);
    else if (hidden !== null) link.hiddenLayerIndices = ints(hidden);
  }
  return link;
}
