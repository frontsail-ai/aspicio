import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  RGBAFormat,
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
  /** Textured quads for raster images, per layer. Own material + texture each. */
  private imageObjects = new Map<string, Mesh[]>();
  private highlightObject: LineSegments2 | null = null;
  private selectLineObject: LineSegments2 | null = null;
  private selectFillObject: Mesh | null = null;
  private width = 1;
  private height = 1;
  private tessellation: Tessellation | null = null;
  private readonly clearColor: Color;
  private readonly clearAlpha: number;

  constructor(canvas: HTMLCanvasElement, options: SceneRendererOptions = {}) {
    const transparent = options.background === null;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: transparent });
    this.clearColor = new Color(options.background ?? 0x16181d);
    this.clearAlpha = transparent ? 0 : 1;
    this.renderer.setClearColor(this.clearColor, this.clearAlpha);
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
      // Images draw under everything (renderOrder -1), fills next (0),
      // lines on top (1) — the fills-under-lines approximation extended one
      // level, so a dieline always reads over its artwork (PDF-9).
      if (layer.images.length > 0) {
        this.imageObjects.set(
          name,
          layer.images.map((placed) => this.buildImageObject(placed)),
        );
      }
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

  /** One textured two-triangle quad on the placed corners. */
  private buildImageObject(placed: {
    image: { width: number; height: number; rgba: Uint8ClampedArray };
    corners: readonly { x: number; y: number }[];
  }): Mesh {
    const { image, corners } = placed;
    const texture = new DataTexture(
      new Uint8Array(image.rgba.buffer, image.rgba.byteOffset, image.rgba.byteLength),
      image.width,
      image.height,
      RGBAFormat,
    );
    // Left at the default color space on purpose: vertex colors pass through
    // unconverted, and the artwork must get the identical treatment or it
    // would not match the vectors drawn from the same file.
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    const [bl, br, tr, tl] = corners;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([bl.x, bl.y, 0, br.x, br.y, 0, tr.x, tr.y, 0, tl.x, tl.y, 0]),
        3,
      ),
    );
    // Texture row 0 (the image's top edge) sits at GL v=0, so the top
    // corners take v=0 and the bottom corners v=1.
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    // renderOrder alone cannot put a transparent quad under opaque lines —
    // three.js draws the transparent pass after the opaque pass regardless.
    // Sitting slightly behind the z=0 plane lets the lines' and fills'
    // depth buffer cull the image where they drew, which is what "under"
    // means here (PDF-9).
    mesh.position.z = -0.1;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
    return mesh;
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
    for (const mesh of this.imageObjects.get(name) ?? []) mesh.visible = visible;
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

  /**
   * Render the current view and read it back as a PNG data URL. Reading
   * synchronously in the same task as render() captures the frame even
   * without a preserved drawing buffer.
   */
  toDataURL(camera2d: Camera2D, background?: number): string {
    if (background !== undefined) this.renderer.setClearColor(new Color(background), 1);
    this.render(camera2d);
    const url = this.renderer.domElement.toDataURL("image/png");
    if (background !== undefined) {
      // Restore the live clear colour and repaint so the on-screen canvas
      // isn't left showing the export background.
      this.renderer.setClearColor(this.clearColor, this.clearAlpha);
      this.render(camera2d);
    }
    return url;
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
    for (const meshes of this.imageObjects.values()) {
      for (const mesh of meshes) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        const material = mesh.material as MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
      }
    }
    this.layerObjects = new Map();
    this.fillObjects = new Map();
    this.imageObjects = new Map();
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
