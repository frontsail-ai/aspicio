/**
 * @observo/core — a TypeScript-first DXF viewer library.
 *
 * Public API surface. Everything importable by consumers goes through here.
 */

export const VERSION = "0.0.0";

export { DxfViewer } from "./viewer.ts";
export type {
  DxfViewerOptions,
  DxfSource,
  FitViewOptions,
  ViewerEvent,
  ViewerStats,
  ViewState,
} from "./viewer.ts";

export { pickLayer } from "./pick/pick.ts";
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

export type {
  Bounds,
  BlockDef,
  DxfDocument,
  Entity,
  EntityType,
  LayerInfo,
  Point2,
  LineEntity,
  PolylineEntity,
  CircleEntity,
  ArcEntity,
  EllipseEntity,
  InsertEntity,
} from "./model/types.ts";
