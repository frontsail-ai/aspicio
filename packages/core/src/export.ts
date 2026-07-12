import type { Tessellation } from "./tessellate/tessellate.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

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
  if (!b) return `<svg xmlns="${SVG_NS}" width="0" height="0"></svg>`;

  const o = tessellation.offset;
  const minX = b.minX - o.x;
  const minY = b.minY - o.y;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const hair = Math.max(Math.max(w, h) * 0.0006, 1e-4);

  const fillPaths = new Map<string, string[]>(); // color → triangle path data
  const linePaths = new Map<string, { stroke: string; width: number; d: string[] }>();

  for (const [name, geo] of tessellation.layers) {
    if (!isVisible(name)) continue;

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

  const parts: string[] = [];
  // Fills first (under the lines), then strokes.
  for (const [color, ds] of fillPaths) {
    parts.push(`<path fill="${color}" stroke="none" d="${ds.join("")}"/>`);
  }
  for (const { stroke, width, d } of linePaths.values()) {
    parts.push(
      `<path fill="none" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" d="${d.join("")}"/>`,
    );
  }

  const bg = options.background
    ? `<rect x="${n(minX)}" y="${n(minY)}" width="${n(w)}" height="${n(h)}" fill="${options.background}"/>`
    : "";
  // Flip y around the drawing's vertical extent so y-up content reads upright.
  const flip = `matrix(1 0 0 -1 0 ${n(minY + (b.maxY - o.y))})`;
  return (
    `<svg xmlns="${SVG_NS}" viewBox="${n(minX)} ${n(minY)} ${n(w)} ${n(h)}" ` +
    `width="${n(w)}" height="${n(h)}">${bg}<g transform="${flip}">${parts.join("")}</g></svg>`
  );
}
