import { Camera2D } from "./camera/camera2d.ts";
import { describeEntity } from "./entity-info.ts";
import type { EntityInfo } from "./entity-info.ts";
import { tessellationToSvg } from "./export.ts";
import { attachGestures } from "./input/gestures.ts";
import type { DxfDocument, Entity, LayerInfo, Point2 } from "./model/types.ts";
import { parseDxf } from "./parse/parse.ts";
import { pickEntity as pickEntityHit, pickLayer } from "./pick/pick.ts";
import { SceneRenderer } from "./render/renderer.ts";
import { buildSnapIndex } from "./snap/snap.ts";
import type { SnapIndex, SnapResult } from "./snap/snap.ts";
import { tessellate, tessellateLayout } from "./tessellate/tessellate.ts";
import type { Tessellation } from "./tessellate/tessellate.ts";

/** The model space's name in `getSpaces()` / `setActiveSpace()`. */
const MODEL_SPACE = "Model";

export interface DxfViewerOptions {
  /**
   * Canvas clear color, 24-bit RGB — or null for a transparent canvas
   * (the page background shows through). Default: dark slate.
   */
  background?: number | null;
  /** Segments per full circle when flattening curves. Default: 72. */
  curveSegments?: number;
}

export interface ViewerStats {
  entityCount: number;
  segmentCount: number;
  unsupported: Record<string, number>;
}

/** Read-only snapshot of the camera state. */
export interface ViewState {
  center: { x: number; y: number };
  unitsPerPixel: number;
  rotation: number;
}

export interface FitViewOptions {
  /** Animate the camera to the fitted pose instead of jumping. */
  animate?: boolean;
  /** Animation length in milliseconds. Default: 400. */
  durationMs?: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type ViewerEvent = "loaded" | "render";
type Listener = () => void;

/** A picked entity plus its precomputed summary. */
export interface PickedEntity {
  /** Index into `document.entities`. */
  index: number;
  entity: Entity;
  info: EntityInfo;
  layer: string;
}

/** Everything the viewer accepts as a DXF source. */
export type DxfSource = string | ArrayBuffer | Blob;

/**
 * The Aspicio viewer facade: owns a canvas inside `container`, renders a
 * DXF document, and exposes layers, camera fitting, and events.
 */
export class DxfViewer {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: SceneRenderer;
  private readonly camera = new Camera2D();
  private readonly options: DxfViewerOptions;
  private readonly detachGestures: () => void;
  private readonly resizeObserver: ResizeObserver;
  private readonly listeners = new Map<ViewerEvent, Set<Listener>>();
  private tessellation: Tessellation | null = null;
  private snapIndex: SnapIndex | null = null;
  private activeSpace = MODEL_SPACE;
  private renderQueued = false;
  private highlightedLayer: string | null = null;
  private selectedIndex: number | null = null;
  private animationFrame: number | null = null;

  document: DxfDocument | null = null;

  constructor(container: HTMLElement, options: DxfViewerOptions = {}) {
    this.container = container;
    this.options = options;

    this.canvas = window.document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    container.appendChild(this.canvas);

    this.renderer = new SceneRenderer(this.canvas, { background: options.background });

    this.detachGestures = attachGestures(this.canvas, this.camera, {
      onChange: () => {
        // A user gesture takes over the camera: stop any running animation.
        this.cancelViewAnimation();
        this.requestRender();
      },
      onReset: () => this.fitView({ animate: true }),
    });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();
  }

  /** Load a DXF from text, a File/Blob, or an ArrayBuffer. */
  async load(source: DxfSource): Promise<void> {
    const text =
      typeof source === "string"
        ? source
        : source instanceof Blob
          ? await source.text()
          : new TextDecoder().decode(source);

    this.document = parseDxf(text);
    this.activeSpace = MODEL_SPACE;
    this.activate(tessellate(this.document, { curveSegments: this.options.curveSegments }));
    this.emit("loaded");
  }

  /** Swap in a freshly tessellated space: colors, snap index, geometry, fit. */
  private activate(tessellation: Tessellation): void {
    this.tessellation = tessellation;
    // The layer table's color is a lie for entity-styled files; record what
    // tessellation actually resolved onto each layer, dominant color first.
    if (this.document) {
      for (const layer of this.document.layers.values()) {
        const counts = tessellation.layerColors.get(layer.name);
        layer.effectiveColors = counts
          ? [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color)
          : [layer.color];
      }
    }
    // The snap index is expensive on huge drawings and only needed once the
    // user measures, so build it lazily on the first snap() call.
    this.snapIndex = null;
    this.selectedIndex = null;
    this.highlightedLayer = null;
    this.renderer.setGeometry(tessellation);
    for (const layer of this.document?.layers.values() ?? []) {
      this.renderer.setLayerVisible(layer.name, layer.visible);
    }
    this.fitView();
  }

  /** Model space plus any paper-space layouts, by name (for a space switcher). */
  getSpaces(): string[] {
    return [MODEL_SPACE, ...(this.document?.layouts ?? []).map((l) => l.name)];
  }

  /** The currently displayed space (`"Model"` or a layout name). */
  get activeSpaceName(): string {
    return this.activeSpace;
  }

  /**
   * Switch the displayed space to model space or a paper-space layout by name.
   * Re-tessellates, re-fits, and re-renders. Unknown names are ignored.
   */
  setActiveSpace(name: string): void {
    if (!this.document || name === this.activeSpace) return;
    const opts = { curveSegments: this.options.curveSegments };
    if (name === MODEL_SPACE) {
      this.activeSpace = name;
      this.activate(tessellate(this.document, opts));
      return;
    }
    const layout = this.document.layouts?.find((l) => l.name === name);
    if (!layout) return;
    this.activeSpace = name;
    this.activate(tessellateLayout(this.document, layout, opts));
  }

  /** Convenience: fetch a URL and load it. */
  async loadUrl(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    await this.load(await response.text());
  }

  getLayers(): LayerInfo[] {
    return this.document ? [...this.document.layers.values()] : [];
  }

  setLayerVisible(name: string, visible: boolean): void {
    const layer = this.document?.layers.get(name);
    if (layer) layer.visible = visible;
    this.renderer.setLayerVisible(name, visible);
    if (!visible && this.highlightedLayer === name) this.setLayerHighlight(null);
    this.requestRender();
  }

  /** Emphasize one layer (drawn with fat lines on top), or clear with null. */
  setLayerHighlight(name: string | null): void {
    // Highlighting a hidden layer would draw invisible geometry — treat as clear.
    if (name !== null && this.document?.layers.get(name)?.visible === false) name = null;
    if (name === this.highlightedLayer) return;
    this.highlightedLayer = name;
    this.renderer.setHighlight(name);
    this.requestRender();
  }

  /**
   * Hit-test the drawing at canvas coordinates (CSS px). Returns the layer
   * of the closest visible geometry within `tolerancePx`, or null.
   */
  pickLayer(x: number, y: number, tolerancePx = 6): string | null {
    if (!this.tessellation || !this.document) return null;
    const world = this.camera.screenToWorld(x, y);
    return pickLayer(
      this.tessellation,
      world,
      tolerancePx * this.camera.unitsPerPixel,
      (name) => this.document?.layers.get(name)?.visible !== false,
    );
  }

  /**
   * Hit-test the drawing at canvas coordinates (CSS px) and return the
   * closest visible entity (edges win within `tolerancePx`; otherwise a
   * filled interior under the cursor), with a precomputed summary. Null when
   * nothing is hit.
   */
  pickEntity(x: number, y: number, tolerancePx = 6): PickedEntity | null {
    // Layout tessellations mix paper and viewport-model entity indices, so
    // entity selection is limited to model space.
    if (!this.tessellation || !this.document || this.activeSpace !== MODEL_SPACE) return null;
    const world = this.camera.screenToWorld(x, y);
    const hit = pickEntityHit(
      this.tessellation,
      world,
      tolerancePx * this.camera.unitsPerPixel,
      (name) => this.document?.layers.get(name)?.visible !== false,
    );
    if (!hit) return null;
    const entity = this.document.entities[hit.entityId];
    if (!entity) return null;
    return { index: hit.entityId, entity, info: describeEntity(entity), layer: hit.layer };
  }

  /** Highlight a single entity by its `document.entities` index, or clear with null. */
  setSelection(index: number | null): void {
    if (index === this.selectedIndex) return;
    this.selectedIndex = index;
    if (index === null || !this.tessellation) {
      this.renderer.setSelection(null, null);
      this.requestRender();
      return;
    }
    const pos: number[] = [];
    const fills: number[] = [];
    for (const layer of this.tessellation.layers.values()) {
      const p = layer.positions;
      const ids = layer.segmentIds;
      for (let i = 0, s = 0; i + 5 < p.length; i += 6, s++) {
        if (ids[s] === index) pos.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
      }
      const fp = layer.fillPositions;
      const fids = layer.fillIds;
      for (let i = 0, t = 0; i + 8 < fp.length; i += 9, t++) {
        if (fids[t] === index) for (let k = 0; k < 9; k++) fills.push(fp[i + k]);
      }
    }
    this.renderer.setSelection(
      pos.length ? new Float32Array(pos) : null,
      fills.length ? new Float32Array(fills) : null,
    );
    this.requestRender();
  }

  /** Convert canvas coordinates (CSS px) to world (drawing) coordinates. */
  screenToWorld(x: number, y: number): Point2 {
    const w = this.camera.screenToWorld(x, y);
    const o = this.tessellation?.offset ?? { x: 0, y: 0 };
    return { x: w.x + o.x, y: w.y + o.y };
  }

  /** Convert world (drawing) coordinates to canvas coordinates (CSS px). */
  worldToScreen(point: Point2): Point2 {
    const o = this.tessellation?.offset ?? { x: 0, y: 0 };
    return this.camera.worldToScreen(point.x - o.x, point.y - o.y);
  }

  /**
   * Snap canvas coordinates (CSS px) to the nearest meaningful point —
   * endpoint, node, center, or midpoint — within `tolerancePx`. Returns the
   * snapped world point and its kind, or null. Only visible layers snap.
   */
  snap(x: number, y: number, tolerancePx = 10): SnapResult | null {
    if (!this.tessellation || !this.document) return null;
    // Build the index on first use, then reuse it until the next load/space.
    this.snapIndex ??= buildSnapIndex(this.tessellation, this.document);
    const world = this.screenToWorld(x, y);
    return this.snapIndex.query(
      world,
      tolerancePx * this.camera.unitsPerPixel,
      (name) => this.document?.layers.get(name)?.visible !== false,
    );
  }

  /**
   * Export the whole drawing as a standalone SVG string (vector, scale-
   * independent). Only currently-visible layers are included. `background`
   * fills a solid backdrop; omit for a transparent SVG.
   */
  toSVG(options: { background?: string } = {}): string {
    if (!this.tessellation)
      return '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>';
    return tessellationToSvg(
      this.tessellation,
      (name) => this.document?.layers.get(name)?.visible !== false,
      options,
    );
  }

  /**
   * Export the current view (WYSIWYG — same zoom, pan, rotation, and visible
   * layers) as a PNG data URL at the canvas's native resolution. `background`
   * (24-bit RGB) fills behind the drawing; omit to keep the canvas as-is
   * (transparent when the viewer background is null).
   */
  toPNG(options: { background?: number } = {}): string {
    return this.renderer.toDataURL(this.camera, options.background);
  }

  get view(): ViewState {
    return {
      center: { ...this.camera.center },
      unitsPerPixel: this.camera.unitsPerPixel,
      rotation: this.camera.rotation,
    };
  }

  get stats(): ViewerStats {
    return {
      entityCount: this.document?.entities.length ?? 0,
      segmentCount: this.tessellation?.segmentCount ?? 0,
      unsupported: this.document?.unsupported ?? {},
    };
  }

  /** Fit the whole drawing into the viewport, optionally animated. */
  fitView(options: FitViewOptions = {}): void {
    this.cancelViewAnimation();
    const target = this.fittedView();
    if (!target) {
      this.requestRender();
      return;
    }
    if (options.animate) {
      this.animateView(target, options.durationMs ?? 400);
    } else {
      this.camera.center = { ...target.center };
      this.camera.unitsPerPixel = target.unitsPerPixel;
      this.camera.rotation = target.rotation;
      this.requestRender();
    }
  }

  /** Zoom by `factor` (>1 zooms in) at the viewport center. */
  zoomBy(factor: number, options: { animate?: boolean; durationMs?: number } = {}): void {
    this.cancelViewAnimation();
    const target: ViewState = {
      center: { ...this.camera.center },
      unitsPerPixel: this.camera.unitsPerPixel / factor,
      rotation: this.camera.rotation,
    };
    if (options.animate) {
      this.animateView(target, options.durationMs ?? 250);
    } else {
      this.camera.unitsPerPixel = target.unitsPerPixel;
      this.requestRender();
    }
  }

  /** Rotate back to 0, keeping center and zoom. */
  resetRotation(options: { animate?: boolean; durationMs?: number } = {}): void {
    this.cancelViewAnimation();
    const target: ViewState = {
      center: { ...this.camera.center },
      unitsPerPixel: this.camera.unitsPerPixel,
      rotation: 0,
    };
    if (options.animate) {
      this.animateView(target, options.durationMs ?? 300);
    } else {
      this.camera.rotation = 0;
      this.requestRender();
    }
  }

  /** Compute the fitted camera pose without mutating the live camera. */
  private fittedView(): ViewState | null {
    const bounds = this.tessellation?.bounds;
    const offset = this.tessellation?.offset;
    if (!bounds || !offset) return null;
    const probe = new Camera2D();
    probe.setViewport(this.camera.viewportWidth, this.camera.viewportHeight);
    // Camera works in offset space (geometry is re-centered for precision).
    probe.fit({
      minX: bounds.minX - offset.x,
      minY: bounds.minY - offset.y,
      maxX: bounds.maxX - offset.x,
      maxY: bounds.maxY - offset.y,
    });
    return { center: probe.center, unitsPerPixel: probe.unitsPerPixel, rotation: probe.rotation };
  }

  private animateView(target: ViewState, durationMs: number): void {
    // Normalize rotation so the animation takes the short way around.
    this.camera.rotation -= 2 * Math.PI * Math.round(this.camera.rotation / (2 * Math.PI));
    const start = this.view;
    const startLogZoom = Math.log(start.unitsPerPixel);
    const endLogZoom = Math.log(target.unitsPerPixel);
    const startTime = performance.now();

    const step = (): void => {
      const t = Math.min(1, (performance.now() - startTime) / durationMs);
      const e = easeInOutCubic(t);
      this.camera.center.x = lerp(start.center.x, target.center.x, e);
      this.camera.center.y = lerp(start.center.y, target.center.y, e);
      // Interpolate zoom logarithmically so it feels uniform.
      this.camera.unitsPerPixel = Math.exp(lerp(startLogZoom, endLogZoom, e));
      this.camera.rotation = lerp(start.rotation, target.rotation, e);
      // Render inline — we're already in an animation frame, so going through
      // requestRender would schedule a second rAF and render a frame late.
      this.renderNow();
      this.animationFrame = t < 1 ? requestAnimationFrame(step) : null;
    };
    this.animationFrame = requestAnimationFrame(step);
  }

  private cancelViewAnimation(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  on(event: ViewerEvent, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off(event: ViewerEvent, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: ViewerEvent): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  private handleResize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.camera.setViewport(width, height);
    this.renderer.resize(width, height, window.devicePixelRatio || 1);
    this.requestRender();
  }

  /** Render immediately (once): draw the current camera and notify listeners. */
  private renderNow(): void {
    this.renderQueued = false;
    this.renderer.render(this.camera);
    this.emit("render");
  }

  /** Render on demand, coalesced to one animation frame. */
  private requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      // A direct renderNow() (e.g. an animation frame) may have cleared the
      // flag first — skip the redundant paint.
      if (this.renderQueued) this.renderNow();
    });
  }

  dispose(): void {
    this.cancelViewAnimation();
    this.resizeObserver.disconnect();
    this.detachGestures();
    this.renderer.dispose();
    this.canvas.remove();
    this.listeners.clear();
  }
}
