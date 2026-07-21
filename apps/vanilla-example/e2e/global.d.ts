/** The example exposes the live viewer on window for the console and these tests. */
declare interface Window {
  __viewer?: {
    view: { unitsPerPixel: number };
    getLayers(): { name: string; visible: boolean }[];
    setLayerVisible(name: string, visible: boolean): void;
    zoomBy(factor: number, options?: { animate?: boolean }): void;
  };
}
