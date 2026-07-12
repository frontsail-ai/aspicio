/** Normalized document model. Decoupled from the parser's output shape. */

export interface Point2 {
  x: number;
  y: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 2D affine transform: [a, b, c, d, tx, ty] mapping (x,y) → (a·x+c·y+tx, b·x+d·y+ty). */
export type Affine2D = [number, number, number, number, number, number];

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
  /** Layer's default linetype name (resolved against the document map). */
  lineType?: string;
}

interface EntityBase {
  layer: string;
  /** Resolved 24-bit RGB, or null for ByLayer/ByBlock. */
  color: number | null;
  /**
   * OCS extrusion normal (codes 210/220/230) for entity types whose
   * coordinates are OCS-relative (ARC, POLYLINE, INSERT). Undefined means
   * the default +Z (world coordinates). (0,0,-1) marks mirrored entities.
   */
  extrusion?: Point3;
  /**
   * Linetype name, or "BYLAYER"/undefined to inherit the layer's. Resolved
   * against the document's `lineTypes` map to a dash pattern at render time.
   */
  lineType?: string;
}

/**
 * Linetype dash pattern: alternating drawn/gap lengths in drawing units.
 * Positive = dash (pen down), negative = gap (pen up), 0 = dot.
 */
export interface LineTypeDef {
  name: string;
  pattern: number[];
  /** Sum of |pattern|; 0 for a continuous line. */
  patternLength: number;
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

export type TextHAlign = "left" | "center" | "right";
export type TextVAlign = "baseline" | "bottom" | "middle" | "top";

/** Normalized TEXT and MTEXT. MTEXT format codes are collapsed to plain text. */
export interface TextEntity extends EntityBase {
  type: "TEXT";
  /** Insertion/alignment point. */
  position: Point2;
  /** Content; may contain newlines (from MTEXT paragraphs). */
  text: string;
  /** Cap height in drawing units. */
  height: number;
  /** Radians, CCW. */
  rotation: number;
  /** Horizontal scale (DXF xScale). */
  widthFactor: number;
  hAlign: TextHAlign;
  vAlign: TextVAlign;
}

export interface SplineEntity extends EntityBase {
  type: "SPLINE";
  controlPoints: Point2[];
  /** Knot vector; empty means "generate a clamped uniform vector". */
  knots: number[];
  degree: number;
  closed: boolean;
}

/** Filled triangle/quad: SOLID, TRACE, or a projected 3DFACE. */
export interface SolidEntity extends EntityBase {
  type: "SOLID";
  /** 3 or 4 corners, already reordered to a simple (non-crossing) ring. */
  points: Point2[];
}

/** A POINT — rendered as a small crosshair marker. */
export interface PointEntity extends EntityBase {
  type: "POINT";
  position: Point2;
}

/** DIMENSION — rendered by drawing its anonymous geometry block. */
export interface DimensionEntity extends EntityBase {
  type: "DIMENSION";
  /** Name of the anonymous "*D…" block holding the lines, arrows, and text. */
  block: string;
  /** Block insertion point (usually the origin). */
  position: Point2;
}

/** HATCH — filled region(s). Boundaries are pre-sampled to polyline loops. */
export interface HatchEntity extends EntityBase {
  type: "HATCH";
  /** Boundary loops in drawing coordinates (outer + holes, unspecified order). */
  loops: Point2[][];
  /** Solid fill vs. a line pattern (patterns render as boundary outlines). */
  solid: boolean;
}

export type Entity =
  | LineEntity
  | PolylineEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | InsertEntity
  | TextEntity
  | SplineEntity
  | SolidEntity
  | PointEntity
  | DimensionEntity
  | HatchEntity;

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
  /** Linetype definitions from the LTYPE table, keyed by name. */
  lineTypes: Map<string, LineTypeDef>;
  /** Counts of raw DXF entity types that were skipped by the parser stage. */
  unsupported: Record<string, number>;
}
