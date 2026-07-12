/**
 * @aspicio/core — a TypeScript-first DXF viewer library.
 *
 * Public API surface. Everything importable by consumers goes through here.
 */

export const VERSION = "0.0.0";

export { DxfViewer } from "./viewer.ts";
export type {
  DxfViewerOptions,
  DxfSource,
  FitViewOptions,
  PickedEntity,
  ViewerEvent,
  ViewerStats,
  ViewState,
} from "./viewer.ts";

export { pickLayer, pickEntity } from "./pick/pick.ts";
export type { EntityHit } from "./pick/pick.ts";
export { describeEntity } from "./entity-info.ts";
export type { EntityInfo } from "./entity-info.ts";
export { parseDxf } from "./parse/parse.ts";
export { tessellate, registerEntityHandler } from "./tessellate/tessellate.ts";
export type {
  Tessellation,
  TessellationContext,
  TessellateOptions,
  EntityHandler,
  LayerGeometry,
} from "./tessellate/tessellate.ts";

export { Camera2D } from "./camera/camera2d.ts";
export { attachGestures } from "./input/gestures.ts";
export type { GestureOptions } from "./input/gestures.ts";

export { sampleSpline } from "./geom/spline.ts";
export { dashPolyline } from "./geom/dash.ts";
export { triangulate } from "./geom/triangulate.ts";
export { layoutText, stripMText } from "./text/layout.ts";
export type { TextLayoutOptions } from "./text/layout.ts";

export type {
  Bounds,
  BlockDef,
  DxfDocument,
  Entity,
  EntityType,
  LayerInfo,
  LineTypeDef,
  Point2,
  Point3,
  LineEntity,
  PolylineEntity,
  CircleEntity,
  ArcEntity,
  EllipseEntity,
  InsertEntity,
  TextEntity,
  TextHAlign,
  TextVAlign,
  SplineEntity,
  SolidEntity,
  PointEntity,
  DimensionEntity,
  HatchEntity,
} from "./model/types.ts";
