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
}

/** Three.js-backed renderer drawing batched per-layer line segments. */
export class SceneRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly material = new LineBasicMaterial({ vertexColors: true });
  private readonly fillMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  private readonly highlightMaterial: LineMaterial;
  private layerObjects = new Map<string, LineSegments>();
  private fillObjects = new Map<string, Mesh>();
  private highlightObject: LineSegments2 | null = null;
  private tessellation: Tessellation | null = null;

  constructor(canvas: HTMLCanvasElement, options: SceneRendererOptions = {}) {
    const transparent = options.background === null;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: transparent });
    this.renderer.setClearColor(new Color(options.background ?? 0x16181d), transparent ? 0 : 1);
    this.camera.position.z = 10;
    this.highlightMaterial = new LineMaterial({
      vertexColors: true,
      linewidth: options.highlightWidth ?? 3,
      depthTest: false,
    });
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
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(layer.positions, 3));
        geometry.setAttribute("color", new BufferAttribute(layer.colors, 3));
        const object = new LineSegments(geometry, this.material);
        object.frustumCulled = false;
        object.renderOrder = 1;
        this.scene.add(object);
        this.layerObjects.set(name, object);
      }
    }
  }

  setLayerVisible(name: string, visible: boolean): void {
    const object = this.layerObjects.get(name);
    if (object) object.visible = visible;
    const fill = this.fillObjects.get(name);
    if (fill) fill.visible = visible;
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
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.setSize(width, height, false);
    // Fat-line material needs the viewport size to compute pixel widths.
    this.highlightMaterial.resolution.set(width, height);
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
    for (const object of this.layerObjects.values()) {
      this.scene.remove(object);
      object.geometry.dispose();
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
    this.renderer.dispose();
  }
}
