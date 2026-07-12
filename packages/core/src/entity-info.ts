import type { Entity, EntityType, Point2 } from "./model/types.ts";

/**
 * Human-facing summary of a picked entity: its identity plus whatever
 * measurable properties make sense for its type (length, area, radius, …).
 * Framework-free so the demo and the React bindings can both render it.
 */
export interface EntityInfo {
  type: EntityType;
  layer: string;
  /** Explicit 24-bit RGB, or null for ByLayer/ByBlock. */
  color: number | null;
  /** Path length in drawing units (LINE, POLYLINE, ARC, CIRCLE, ELLIPSE). */
  length?: number;
  /** Enclosed area for closed shapes (CIRCLE, closed POLYLINE, SOLID, HATCH). */
  area?: number;
  /** Radius (CIRCLE, ARC). */
  radius?: number;
  /** Vertex/corner/control-point count where meaningful. */
  points?: number;
  /** A representative anchor: insertion point, center, or first vertex. */
  position?: Point2;
  /** Text content (TEXT). */
  text?: string;
}

const dist = (a: Point2, b: Point2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Length of a polyline. Bulge arcs are approximated by their chords. */
function polylineLength(points: Point2[], closed: boolean): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += dist(points[i], points[i + 1]);
  if (closed && points.length > 2) total += dist(points[points.length - 1], points[0]);
  return total;
}

/** Signed-to-absolute shoelace area of a polygon ring. */
function polygonArea(points: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Summarize an entity for an info panel or a React consumer. */
export function describeEntity(entity: Entity): EntityInfo {
  const base: EntityInfo = { type: entity.type, layer: entity.layer, color: entity.color };
  switch (entity.type) {
    case "LINE":
      return { ...base, length: dist(entity.start, entity.end), position: entity.start };
    case "POLYLINE":
      return {
        ...base,
        length: polylineLength(entity.points, entity.closed),
        area: entity.closed ? polygonArea(entity.points) : undefined,
        points: entity.points.length,
        position: entity.points[0],
      };
    case "CIRCLE":
      return {
        ...base,
        radius: entity.radius,
        length: 2 * Math.PI * entity.radius,
        area: Math.PI * entity.radius ** 2,
        position: entity.center,
      };
    case "ARC": {
      let sweep = entity.endAngle - entity.startAngle;
      if (sweep <= 1e-9) sweep += 2 * Math.PI;
      return {
        ...base,
        radius: entity.radius,
        length: entity.radius * sweep,
        position: entity.center,
      };
    }
    case "ELLIPSE": {
      const a = Math.hypot(entity.majorAxis.x, entity.majorAxis.y);
      const b = a * entity.axisRatio;
      // Ramanujan's approximation for the full-ellipse perimeter.
      const h = (a - b) ** 2 / (a + b) ** 2;
      return {
        ...base,
        length: Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))),
        area: Math.PI * a * b,
        position: entity.center,
      };
    }
    case "SPLINE":
      return {
        ...base,
        points: entity.controlPoints.length,
        position: entity.controlPoints[0],
      };
    case "SOLID":
      return {
        ...base,
        area: polygonArea(entity.points),
        points: entity.points.length,
        position: entity.points[0],
      };
    case "HATCH": {
      // Outer loop area minus holes (loops after the first), floored at 0.
      const [outer, ...holes] = entity.loops;
      const area = outer
        ? Math.max(0, polygonArea(outer) - holes.reduce((s, l) => s + polygonArea(l), 0))
        : 0;
      return {
        ...base,
        area,
        points: entity.loops.reduce((s, l) => s + l.length, 0),
        position: outer?.[0],
      };
    }
    case "TEXT":
      return { ...base, text: entity.text, position: entity.position };
    case "INSERT":
      return { ...base, position: entity.position };
    case "POINT":
    case "DIMENSION":
      return { ...base, position: entity.position };
    default:
      return base;
  }
}
