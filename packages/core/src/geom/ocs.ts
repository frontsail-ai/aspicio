import type { Affine2D, Point3 } from "../model/types.ts";

const IDENTITY: Affine2D = [1, 0, 0, 1, 0, 0];

/**
 * Map OCS (Object Coordinate System) coordinates to world XY using the DXF
 * Arbitrary Axis Algorithm, projected onto the drawing plane (view from +Z).
 *
 * DXF stores several entity types (ARC, LW/POLYLINE, INSERT, ...) in a
 * coordinate system derived from their extrusion normal (codes 210/220/230).
 * The overwhelmingly common non-default case is (0,0,-1) — produced by
 * AutoCAD's MIRROR — which maps to an X-axis flip. Tilted normals project
 * correctly for a top-down view.
 */
export function ocsToWcs(normal: Point3): Affine2D {
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const n = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  if (n.x === 0 && n.y === 0 && n.z === 1) return IDENTITY;

  // Arbitrary Axis Algorithm: pick the world axis "least parallel" to n.
  const nearVertical = Math.abs(n.x) < 1 / 64 && Math.abs(n.y) < 1 / 64;
  // ax = (nearVertical ? worldY : worldZ) × n
  let ax = nearVertical ? { x: n.z, y: 0, z: -n.x } : { x: -n.y, y: n.x, z: 0 };
  const axLength = Math.hypot(ax.x, ax.y, ax.z) || 1;
  ax = { x: ax.x / axLength, y: ax.y / axLength, z: ax.z / axLength };
  // ay = n × ax
  const ay = {
    x: n.y * ax.z - n.z * ax.y,
    y: n.z * ax.x - n.x * ax.z,
    z: n.x * ax.y - n.y * ax.x,
  };
  // OCS (x, y) → world XY: columns are the OCS basis vectors' XY projections.
  return [ax.x, ax.y, ay.x, ay.y, 0, 0];
}
