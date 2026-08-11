import { encodePng, toBase64 } from "./png.ts";
import type { Tessellation } from "./tessellate/tessellate.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Production guides, matching the canvas (VIEW-19). */
const GUIDE_TRIM = "#7a7a7a";
const GUIDE_BLEED = "#e0301e";

/** Round to 3 decimals and drop trailing zeros, to keep the SVG small. */
function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** rgb triplet (0..1 floats) → #rrggbb. */
function hex(r: number, g: number, b: number): string {
  const c = (x: number): string =>
    Math.max(0, Math.min(255, Math.round(x * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export interface SvgExportOptions {
  /** Solid background rect (e.g. "#16181d"). Omit for a transparent SVG. */
  background?: string;
  /**
   * Paper drawn under a bounded space (e.g. "#ffffff"), matching the canvas
   * (VIEW-12, VIEW-17). Ignored when the space declares no page box, so a
   * DXF export is unaffected. Omit to export page content with no sheet.
   */
  sheet?: string;
  /** Draw the page's trim and bleed guides, when it declares them (VIEW-19). */
  guides?: boolean;
}

/**
 * Serialize a tessellation to a standalone SVG string. Only layers passing
 * `isVisible` are drawn. Lines are grouped by colour+lineweight, fills by
 * colour. The DXF y-up axis is flipped to SVG's y-down inside one group.
 */
export function tessellationToSvg(
  tessellation: Tessellation,
  isVisible: (layer: string) => boolean = () => true,
  options: SvgExportOptions = {},
): string {
  const b = tessellation.bounds;
  if (!b) {
    // No geometry: a minimal but renderable SVG (zero sizes break rasterizers).
    const bg = options.background
      ? `<rect width="1" height="1" fill="${options.background}"/>`
      : "";
    return `<svg xmlns="${SVG_NS}" viewBox="0 0 1 1" width="1" height="1">${bg}</svg>`;
  }

  const o = tessellation.offset;
  // Pad the tight bounds so strokes on the drawing's edge are not half
  // clipped, and clamp degenerate extents (a single point or axis-aligned
  // line) to a nonzero size.
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
  const pad = extent * 0.01;
  const minX = b.minX - o.x - pad;
  const minY = b.minY - o.y - pad;
  const w = b.maxX - b.minX + 2 * pad;
  const h = b.maxY - b.minY + 2 * pad;
  const hair = Math.max(extent * 0.0006, 1e-4);

  const fillPaths = new Map<string, string[]>(); // color → triangle path data
  const linePaths = new Map<string, { stroke: string; width: number; d: string[] }>();
  const images: string[] = [];

  for (const [name, geo] of tessellation.layers) {
    if (!isVisible(name)) continue;

    for (const placed of geo.images) {
      const [a, b, c, d, tx, ty] = placed.transform;
      // The placement maps the unit square with v up and the top pixel row
      // at v=1; SVG's <image> space runs y-down from the top-left. Compose
      // with (u, w) -> (u, 1 - w) so the rows land upright.
      const matrix = [a, b, -c, -d, c + tx, d + ty].map(n).join(" ");
      const href = `data:image/png;base64,${toBase64(encodePng(placed.image))}`;
      images.push(
        `<image width="1" height="1" preserveAspectRatio="none" ` +
          `transform="matrix(${matrix})" href="${href}"/>`,
      );
    }

    const fp = geo.fillPositions;
    const fc = geo.fillColors;
    for (let i = 0; i + 8 < fp.length; i += 9) {
      const color = hex(fc[i], fc[i + 1], fc[i + 2]);
      const d = `M${n(fp[i])} ${n(fp[i + 1])}L${n(fp[i + 3])} ${n(fp[i + 4])}L${n(fp[i + 6])} ${n(fp[i + 7])}Z`;
      (fillPaths.get(color) ?? fillPaths.set(color, []).get(color)!).push(d);
    }

    const p = geo.positions;
    const c = geo.colors;
    const widths = geo.widths;
    for (let i = 0, s = 0; i + 5 < p.length; i += 6, s++) {
      const stroke = hex(c[i], c[i + 1], c[i + 2]);
      const weight = widths[s];
      const width = weight > 0 ? weight / 100 : hair;
      const key = `${stroke}|${width}`;
      let group = linePaths.get(key);
      if (!group) linePaths.set(key, (group = { stroke, width, d: [] }));
      group.d.push(`M${n(p[i])} ${n(p[i + 1])}L${n(p[i + 3])} ${n(p[i + 4])}`);
    }
  }

  // The sheet goes first: it is the bottom render band on the canvas and must
  // be the bottom of the SVG too, or a headless render disagrees with what the
  // viewer shows. It belongs inside the flipped group, unlike the `bg` rect
  // below, because its coordinates are drawing-space, not viewBox-space.
  const page = tessellation.backdrop;
  const sheet =
    page && options.sheet
      ? `<rect x="${n(page.sheet.minX)}" y="${n(page.sheet.minY)}" ` +
        `width="${n(page.sheet.maxX - page.sheet.minX)}" ` +
        `height="${n(page.sheet.maxY - page.sheet.minY)}" fill="${options.sheet}"/>`
      : "";

  const parts: string[] = [sheet, ...images].filter(Boolean);
  // Images sit under everything; fills next (under the lines), then strokes.
  for (const [color, ds] of fillPaths) {
    parts.push(`<path fill="${color}" stroke="none" d="${ds.join("")}"/>`);
  }
  for (const { stroke, width, d } of linePaths.values()) {
    parts.push(
      `<path fill="none" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" d="${d.join("")}"/>`,
    );
  }

  // Guides last: above the artwork they measure. The dash is in drawing units
  // rather than screen pixels, because an SVG has no zoom to stay constant
  // against — 1% of the extent reads as a guide at any output size.
  if (page && options.guides) {
    const dash = n(extent * 0.01);
    for (const [box, color] of [
      [page.bleed, GUIDE_BLEED],
      [page.trim, GUIDE_TRIM],
    ] as const) {
      if (!box) continue;
      parts.push(
        `<rect x="${n(box.minX)}" y="${n(box.minY)}" width="${n(box.maxX - box.minX)}" ` +
          `height="${n(box.maxY - box.minY)}" fill="none" stroke="${color}" ` +
          `stroke-width="${n(hair)}" stroke-dasharray="${dash} ${dash}"/>`,
      );
    }
  }

  const bg = options.background
    ? `<rect x="${n(minX)}" y="${n(minY)}" width="${n(w)}" height="${n(h)}" fill="${options.background}"/>`
    : "";
  // Flip y around the drawing's (unpadded) vertical extent so y-up content
  // reads upright and stays centered in the padded viewBox.
  const flip = `matrix(1 0 0 -1 0 ${n(b.minY - o.y + (b.maxY - o.y))})`;
  return (
    `<svg xmlns="${SVG_NS}" viewBox="${n(minX)} ${n(minY)} ${n(w)} ${n(h)}" ` +
    `width="${n(w)}" height="${n(h)}">${bg}<g transform="${flip}">${parts.join("")}</g></svg>`
  );
}
