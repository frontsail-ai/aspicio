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
export { buildSnapIndex, SnapIndex } from "./snap/snap.ts";
export type { SnapKind, SnapResult } from "./snap/snap.ts";
export { unitLabel, niceLength } from "./units.ts";
export { tessellationToSvg } from "./export.ts";
export type { SvgExportOptions } from "./export.ts";
export { parseDxf, parseDxfBytes } from "./parse/parse.ts";
export { describeDrawing } from "./describe.ts";
export type { DrawingSummary, LayerSummary } from "./describe.ts";
export { tessellate, tessellateLayout, registerEntityHandler } from "./tessellate/tessellate.ts";
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
export { attachShortcuts } from "./input/shortcuts.ts";
export type { ShortcutHandlers, ShortcutViewer } from "./input/shortcuts.ts";

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
  Layout,
  Viewport,
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
