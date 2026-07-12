/** Normalized document model. Decoupled from the parser's output shape. */

export interface Point2 {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LayerInfo {
  name: string;
  /** Layer-table color, 24-bit RGB. May differ from what is drawn. */
  color: number;
  /**
   * Colors actually drawn on this layer, dominant first (populated after
   * tessellation). Entity-styled files override the table color per entity,
   * so UI should prefer `effectiveColors[0]` over `color`.
   */
  effectiveColors?: number[];
  visible: boolean;
  frozen: boolean;
  /** Number of top-level entities on this layer. */
  entityCount: number;
}

interface EntityBase {
  layer: string;
  /** Resolved 24-bit RGB, or null for ByLayer/ByBlock. */
  color: number | null;
}

export interface LineEntity extends EntityBase {
  type: "LINE";
  start: Point2;
  end: Point2;
}

export interface PolylineEntity extends EntityBase {
  type: "POLYLINE";
  points: Point2[];
  /** Bulge per segment starting at points[i]; same length as points. */
  bulges: number[];
  closed: boolean;
}

export interface CircleEntity extends EntityBase {
  type: "CIRCLE";
  center: Point2;
  radius: number;
}

export interface ArcEntity extends EntityBase {
  type: "ARC";
  center: Point2;
  radius: number;
  /** Radians, CCW from +X. */
  startAngle: number;
  endAngle: number;
}

export interface EllipseEntity extends EntityBase {
  type: "ELLIPSE";
  center: Point2;
  /** Major axis endpoint relative to center. */
  majorAxis: Point2;
  /** Minor/major ratio. */
  axisRatio: number;
  /** Parametric range in radians. */
  startParam: number;
  endParam: number;
}

export interface InsertEntity extends EntityBase {
  type: "INSERT";
  blockName: string;
  position: Point2;
  scale: Point2;
  /** Radians. */
  rotation: number;
}

export type Entity =
  | LineEntity
  | PolylineEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | InsertEntity;

export type EntityType = Entity["type"];

export interface BlockDef {
  name: string;
  basePoint: Point2;
  entities: Entity[];
}

export interface DxfDocument {
  layers: Map<string, LayerInfo>;
  entities: Entity[];
  blocks: Map<string, BlockDef>;
  /** Counts of raw DXF entity types that were skipped by the parser stage. */
  unsupported: Record<string, number>;
}
