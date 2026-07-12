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
}

declare interface Window {
  __aspicio?: AspicioTestHook;
}
