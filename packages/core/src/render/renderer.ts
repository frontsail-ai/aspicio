import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { Camera2D } from "../camera/camera2d.ts";
import type { Tessellation } from "../tessellate/tessellate.ts";

export interface SceneRendererOptions {
  /** Canvas clear color, 24-bit RGB — or null for a transparent canvas. */
  background?: number | null;
  /** Pixel width of the layer-highlight overlay lines. */
  highlightWidth?: number;
  /**
   * Screen pixels drawn per millimetre of lineweight. DXF weights are in
   * 1/100 mm; a weight of 50 (0.5 mm) at the default scale draws ~2.5 px.
   */
  lineWeightScale?: number;
}

const DEFAULT_LINEWEIGHT_SCALE = 5;
/** Selection overlay colours. */
const SELECT_COLOR = 0x8fc8ff;

/** Three.js-backed renderer drawing batched per-layer line segments. */
export class SceneRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly material = new LineBasicMaterial({ vertexColors: true });
  private readonly fillMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  private readonly highlightMaterial: LineMaterial;
  private readonly selectLineMaterial: LineMaterial;
  private readonly selectFillMaterial: MeshBasicMaterial;
  /** Fat-line materials keyed by rounded pixel width, shared across layers. */
  private readonly widthMaterials = new Map<number, LineMaterial>();
  private readonly lineWeightScale: number;
  private layerObjects = new Map<string, (LineSegments | LineSegments2)[]>();
  private fillObjects = new Map<string, Mesh>();
  private highlightObject: LineSegments2 | null = null;
  private selectLineObject: LineSegments2 | null = null;
  private selectFillObject: Mesh | null = null;
  private width = 1;
  private height = 1;
  private tessellation: Tessellation | null = null;

  constructor(canvas: HTMLCanvasElement, options: SceneRendererOptions = {}) {
    const transparent = options.background === null;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: transparent });
    this.renderer.setClearColor(new Color(options.background ?? 0x16181d), transparent ? 0 : 1);
    this.camera.position.z = 10;
    this.lineWeightScale = options.lineWeightScale ?? DEFAULT_LINEWEIGHT_SCALE;
    this.highlightMaterial = new LineMaterial({
      vertexColors: true,
      linewidth: options.highlightWidth ?? 4,
      depthTest: false,
    });
    this.selectLineMaterial = new LineMaterial({
      color: SELECT_COLOR,
      linewidth: 4,
      depthTest: false,
    });
    this.selectFillMaterial = new MeshBasicMaterial({
      color: SELECT_COLOR,
      transparent: true,
      opacity: 0.28,
      side: DoubleSide,
      depthTest: false,
    });
  }

  /** Pixel width for a DXF lineweight (1/100 mm), clamped to a visible minimum. */
  private pixelWidth(weight: number): number {
    return Math.max(1, (weight / 100) * this.lineWeightScale);
  }

  /** A shared fat-line material for a given rounded pixel width. */
  private widthMaterial(px: number): LineMaterial {
    let mat = this.widthMaterials.get(px);
    if (!mat) {
      mat = new LineMaterial({ vertexColors: true, linewidth: px });
      mat.resolution.set(this.width, this.height);
      this.widthMaterials.set(px, mat);
    }
    return mat;
  }

  /** Replace scene content with a new tessellation. */
  setGeometry(tessellation: Tessellation): void {
    this.clearGeometry();
    this.tessellation = tessellation;
    for (const [name, layer] of tessellation.layers) {
      // Fills draw first (renderOrder 0), lines on top (renderOrder 1).
      if (layer.fillPositions.length > 0) {
        const fillGeo = new BufferGeometry();
        fillGeo.setAttribute("position", new BufferAttribute(layer.fillPositions, 3));
        fillGeo.setAttribute("color", new BufferAttribute(layer.fillColors, 3));
        const fill = new Mesh(fillGeo, this.fillMaterial);
        fill.frustumCulled = false;
        this.scene.add(fill);
        this.fillObjects.set(name, fill);
      }
      if (layer.positions.length > 0) {
        this.layerObjects.set(name, this.buildLineObjects(layer));
      }
    }
  }

  /**
   * Build a layer's line objects, grouped by lineweight: hairline/default
   * segments stay cheap thin lines; each heavier weight becomes one fat
   * `LineSegments2` sharing a per-pixel-width material.
   */
  private buildLineObjects(layer: {
    positions: Float32Array;
    colors: Float32Array;
    widths: Float32Array;
  }): (LineSegments | LineSegments2)[] {
    const { positions, colors, widths } = layer;
    // Partition segment indices by rounded pixel width (0 = thin bucket).
    const buckets = new Map<number, number[]>();
    for (let s = 0; s < widths.length; s++) {
      const px = widths[s] > 0 ? Math.round(this.pixelWidth(widths[s])) : 0;
      const key = px <= 1 ? 0 : px;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(s);
    }

    const objects: (LineSegments | LineSegments2)[] = [];
    for (const [px, segs] of buckets) {
      const pos = new Float32Array(segs.length * 6);
      const col = new Float32Array(segs.length * 6);
      for (let j = 0; j < segs.length; j++) {
        pos.set(positions.subarray(segs[j] * 6, segs[j] * 6 + 6), j * 6);
        col.set(colors.subarray(segs[j] * 6, segs[j] * 6 + 6), j * 6);
      }
      if (px === 0) {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(pos, 3));
        geometry.setAttribute("color", new BufferAttribute(col, 3));
        const object = new LineSegments(geometry, this.material);
        object.frustumCulled = false;
        object.renderOrder = 1;
        this.scene.add(object);
        objects.push(object);
      } else {
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(pos);
        geometry.setColors(col);
        const object = new LineSegments2(geometry, this.widthMaterial(px));
        object.frustumCulled = false;
        object.renderOrder = 1;
        this.scene.add(object);
        objects.push(object);
      }
    }
    return objects;
  }

  setLayerVisible(name: string, visible: boolean): void {
    for (const object of this.layerObjects.get(name) ?? []) object.visible = visible;
    const fill = this.fillObjects.get(name);
    if (fill) fill.visible = visible;
  }

  /** Highlight a single entity: its line segments and any filled interior. */
  setSelection(linePositions: Float32Array | null, fillPositions: Float32Array | null): void {
    if (this.selectLineObject) {
      this.scene.remove(this.selectLineObject);
      this.selectLineObject.geometry.dispose();
      this.selectLineObject = null;
    }
    if (this.selectFillObject) {
      this.scene.remove(this.selectFillObject);
      this.selectFillObject.geometry.dispose();
      this.selectFillObject = null;
    }
    if (fillPositions && fillPositions.length > 0) {
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(fillPositions, 3));
      const mesh = new Mesh(geo, this.selectFillMaterial);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.scene.add(mesh);
      this.selectFillObject = mesh;
    }
    if (linePositions && linePositions.length > 0) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(linePositions);
      const object = new LineSegments2(geo, this.selectLineMaterial);
      object.frustumCulled = false;
      object.renderOrder = 3;
      this.scene.add(object);
      this.selectLineObject = object;
    }
  }

  /** Draw one layer with fat lines on top of everything, or clear with null. */
  setHighlight(name: string | null): void {
    if (this.highlightObject) {
      this.scene.remove(this.highlightObject);
      this.highlightObject.geometry.dispose();
      this.highlightObject = null;
    }
    if (name === null) return;
    const layer = this.tessellation?.layers.get(name);
    if (!layer || layer.positions.length === 0) return;

    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(layer.positions);
    geometry.setColors(layer.colors);
    const object = new LineSegments2(geometry, this.highlightMaterial);
    object.frustumCulled = false;
    object.renderOrder = 1;
    this.scene.add(object);
    this.highlightObject = object;
  }

  resize(width: number, height: number, devicePixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.setSize(width, height, false);
    // Every fat-line material needs the viewport size to compute pixel widths.
    this.highlightMaterial.resolution.set(width, height);
    this.selectLineMaterial.resolution.set(width, height);
    for (const mat of this.widthMaterials.values()) mat.resolution.set(width, height);
  }

  render(camera2d: Camera2D): void {
    const halfW = (camera2d.viewportWidth / 2) * camera2d.unitsPerPixel;
    const halfH = (camera2d.viewportHeight / 2) * camera2d.unitsPerPixel;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.up.set(Math.sin(camera2d.rotation), Math.cos(camera2d.rotation), 0);
    this.camera.position.set(camera2d.center.x, camera2d.center.y, 10);
    this.camera.lookAt(camera2d.center.x, camera2d.center.y, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  private clearGeometry(): void {
    this.setHighlight(null);
    this.setSelection(null, null);
    for (const objects of this.layerObjects.values()) {
      for (const object of objects) {
        this.scene.remove(object);
        object.geometry.dispose();
      }
    }
    for (const fill of this.fillObjects.values()) {
      this.scene.remove(fill);
      fill.geometry.dispose();
    }
    this.layerObjects = new Map();
    this.fillObjects = new Map();
    this.tessellation = null;
  }

  dispose(): void {
    this.clearGeometry();
    this.material.dispose();
    this.fillMaterial.dispose();
    this.highlightMaterial.dispose();
    this.selectLineMaterial.dispose();
    this.selectFillMaterial.dispose();
    for (const mat of this.widthMaterials.values()) mat.dispose();
    this.widthMaterials.clear();
    this.renderer.dispose();
  }
}
