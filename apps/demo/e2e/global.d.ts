/** Shape of the demo app's test hook, kept structural to avoid a cross-project import. */
interface AspicioTestHook {
  stats: {
    entityCount: number;
    segmentCount: number;
    unsupported: Record<string, number>;
  };
  view: {
    center: { x: number; y: number };
    unitsPerPixel: number;
    rotation: number;
  };
  getLayers(): { name: string; visible: boolean }[];
  getSpaces(): string[];
  readonly activeSpaceName: string;
  setActiveSpace(name: string): void;
  document: {
    entities: { type: string; layer: string; lineWeight?: number }[];
    layouts?: { name: string; entities: unknown[]; viewports: unknown[] }[];
    units?: string;
  } | null;
  worldToScreen(point: { x: number; y: number }): { x: number; y: number };
  screenToWorld(x: number, y: number): { x: number; y: number };
}

/** Demo-level interaction state, exposed for e2e observation. */
interface DemoTestHook {
  readonly selectedIndex: number | null;
  readonly measureActive: boolean;
  readonly measurePoints: { x: number; y: number }[];
  pickAt(x: number, y: number): { index: number } | null;
  snapAt(x: number, y: number): { point: { x: number; y: number }; kind: string } | null;
}

declare interface Window {
  __aspicio?: AspicioTestHook;
  __demo?: DemoTestHook;
}
