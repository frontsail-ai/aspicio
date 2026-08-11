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
import type { Bounds, PageGeometry } from "../model/types.ts";
import type { Tessellation } from "../tessellate/tessellate.ts";

export interface SceneRendererOptions {
  /** Canvas clear color, 24-bit RGB — or null for a transparent canvas. */
  background?: number | null;
  /**
   * The paper a bounded space is drawn on, 24-bit RGB — or null to draw no
   * sheet at all. Only spaces that declare a page box get one; DXF model
   * space is unbounded and never does.
   */
  sheet?: number | null;
  /** Hairline around the sheet, 24-bit RGB, or null for none (VIEW-17). */
  sheetEdge?: number | null;
  /** Pixel width of the layer-highlight overlay lines. */
  highlightWidth?: number;
  /**
   * Screen pixels drawn per millimetre of lineweight. DXF weights are in
   * 1/100 mm; a weight of 50 (0.5 mm) at the default scale draws ~2.5 px.
   */
  lineWeightScale?: number;
}

const DEFAULT_LINEWEIGHT_SCALE = 5;
/**
 * Selection overlay colours.
 *
 * Two, because the sheet broke the single one: #8fc8ff is 10:1 against the
 * dark canvas and 1.8:1 against white paper, so a selection made on a PDF
 * page was legible only until the page had paper under it. The on-sheet
 * variant is 4.5:1 on white and still 3.9:1 on the dark canvas (VIEW-8).
 */
const SELECT_COLOR = 0x8fc8ff;
const SELECT_COLOR_ON_SHEET = 0x2b78c8;

/**
 * Production guides on the sheet (VIEW-19). Both live on white paper in
 * either theme, so neither is theme-dependent.
 *
 * Bleed reuses the brand red every Illustrator user already reads as
 * "bleed", so no new hue enters the palette. Trim is neutral on purpose:
 * a hue there could be mistaken for a separation.
 */
const TRIM_COLOR = 0x7a7a7a;
const BLEED_COLOR = 0xe0301e;
/** Dash metrics in *screen* pixels — see `updateGuideDashes`. */
const GUIDE_DASH_PX = 6;
const GUIDE_GAP_PX = 4;

/*
 * Render-order bands. Three.js draws the opaque pass first, then the
 * transparent pass; renderOrder is the primary sort key *within* each pass
 * and cannot order across them. Raster images are transparent-pass content,
 * so anything that must draw above them has to sit in the transparent pass
 * with a higher renderOrder — being "later" in the opaque pass is not
 * enough. And `depthTest: false` cannot substitute: disabling the GL depth
 * test also disables depth *writes*, so an opaque-pass overlay leaves no
 * depth for a later image fragment to fail against (issue #169).
 *
 *   -2  page backdrop       (opaque pass — the sheet a PDF page is drawn on)
 *   -1  raster images        (transparent pass — alpha from SMasks)
 *    0  fills                (opaque pass)
 *    1  lines                (opaque pass)
 *    2  page guides          (opaque pass — trim/bleed, above the artwork
 *                             they measure, below any overlay)
 *  10+  overlays             (transparent pass — highlight, selection;
 *                             VIEW-6/VIEW-8: bold *on top of all content*)
 *
 * The backdrop needs no depth trick, unlike the images above it: an opaque
 * mesh is drawn in the opaque pass, which three.js runs *before* the
 * transparent one, so images land on top of the sheet whatever their
 * renderOrder. Sitting at z = -0.2 — behind the images' -0.1 — keeps the
 * depth buffer agreeing with the pass order rather than fighting it.
 */

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
  /** Sheet mesh and its hairline, for spaces that have paper. */
  private backdropObjects: (Mesh | LineSegments)[] = [];
  /** Trim/bleed outlines; dashes are re-scaled per frame to stay screen-space. */
  private guideObjects: LineSegments2[] = [];
  private readonly guideMaterials = new Map<number, LineMaterial>();
  private sheetColor: Color | null;
  private sheetEdgeColor: Color | null;
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
    this.sheetColor = options.sheet === null ? null : new Color(options.sheet ?? 0xffffff);
    this.sheetEdgeColor = options.sheetEdge == null ? null : new Color(options.sheetEdge);
    this.lineWeightScale = options.lineWeightScale ?? DEFAULT_LINEWEIGHT_SCALE;
    // Overlays are transparent on purpose — see the render-band contract
    // above: it is what puts them in the pass that draws after images.
    this.highlightMaterial = new LineMaterial({
      vertexColors: true,
      linewidth: options.highlightWidth ?? 4,
      depthTest: false,
      transparent: true,
    });
    this.selectLineMaterial = new LineMaterial({
      color: SELECT_COLOR,
      linewidth: 4,
      depthTest: false,
      transparent: true,
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
    if (tessellation.backdrop) this.buildBackdrop(tessellation.backdrop);
    // Selection has to know what it will be drawn over: the same blue cannot
    // read against both the dark canvas and white paper.
    const select = tessellation.backdrop ? SELECT_COLOR_ON_SHEET : SELECT_COLOR;
    this.selectLineMaterial.color.setHex(select);
    this.selectFillMaterial.color.setHex(select);
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

  /**
   * Repaint the paper in new colours, e.g. on a theme switch.
   *
   * Rebuilds the backdrop from the tessellation already on screen rather
   * than asking the caller to reload: the geometry has not changed, only
   * what colour it is, and a reload would cost a parse and reset the camera.
   */
  setSheetColors(sheet: number | null, edge: number | null): void {
    this.sheetColor = sheet === null ? null : new Color(sheet);
    this.sheetEdgeColor = edge === null ? null : new Color(edge);
    for (const object of this.backdropObjects) {
      this.scene.remove(object);
      object.geometry.dispose();
      (object.material as MeshBasicMaterial | LineBasicMaterial).dispose();
    }
    this.backdropObjects = [];
    this.clearGuides();
    if (this.tessellation?.backdrop) this.buildBackdrop(this.tessellation.backdrop);
  }

  /**
   * The sheet a bounded space is drawn on, plus its optional hairline.
   *
   * Opaque and drawn first, so everything above it — images included — lands
   * on top without a depth trick; see the render-band contract above. The
   * hairline is world-space geometry rather than a screen-space stroke, which
   * keeps it exactly on the paper's edge at every zoom.
   */
  private buildBackdrop(page: PageGeometry): void {
    if (!this.sheetColor) return;
    const { minX, minY, maxX, maxY } = page.sheet;

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([minX, minY, 0, maxX, minY, 0, maxX, maxY, 0, minX, maxY, 0]),
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const sheet = new Mesh(geometry, new MeshBasicMaterial({ color: this.sheetColor }));
    sheet.frustumCulled = false;
    sheet.position.z = -0.2;
    sheet.renderOrder = -2;
    this.scene.add(sheet);
    this.backdropObjects.push(sheet);

    for (const [box, color] of [
      [page.bleed, BLEED_COLOR],
      [page.trim, TRIM_COLOR],
    ] as const) {
      if (box) this.buildGuide(box, color);
    }

    if (!this.sheetEdgeColor) return;
    const edge = new BufferGeometry();
    edge.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          minX,
          minY,
          0,
          maxX,
          minY,
          0,
          maxX,
          minY,
          0,
          maxX,
          maxY,
          0,
          maxX,
          maxY,
          0,
          minX,
          maxY,
          0,
          minX,
          maxY,
          0,
          minX,
          minY,
          0,
        ]),
        3,
      ),
    );
    const outline = new LineSegments(edge, new LineBasicMaterial({ color: this.sheetEdgeColor }));
    outline.frustumCulled = false;
    outline.position.z = -0.19;
    outline.renderOrder = -2;
    this.scene.add(outline);
    this.backdropObjects.push(outline);
  }

  /**
   * One dashed guide rectangle, drawn above the artwork it measures and
   * below any overlay (band 2).
   *
   * A guide is a measuring instrument, so it is 1px on screen at every
   * zoom: one that thickened under magnification would compete with the
   * line work it exists to qualify.
   */
  private buildGuide(box: Bounds, color: number): void {
    const { minX, minY, maxX, maxY } = box;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions([
      minX,
      minY,
      0,
      maxX,
      minY,
      0,
      maxX,
      minY,
      0,
      maxX,
      maxY,
      0,
      maxX,
      maxY,
      0,
      minX,
      maxY,
      0,
      minX,
      maxY,
      0,
      minX,
      minY,
      0,
    ]);

    let material = this.guideMaterials.get(color);
    if (!material) {
      material = new LineMaterial({ color, linewidth: 1, dashed: true, transparent: true });
      material.resolution.set(this.width, this.height);
      this.guideMaterials.set(color, material);
    }

    const object = new LineSegments2(geometry, material);
    object.computeLineDistances();
    object.frustumCulled = false;
    object.renderOrder = 2;
    this.scene.add(object);
    this.guideObjects.push(object);
  }

  /**
   * Keep guide dashes a constant size on screen.
   *
   * `LineMaterial` measures dashes along world-space line distance, so a
   * fixed `dashSize` would turn into a solid line when zoomed out and a few
   * enormous strokes when zoomed in. Converting through units-per-pixel each
   * frame is what makes "1px, screen-space" true of the pattern and not just
   * the stroke width.
   */
  private updateGuideDashes(unitsPerPixel: number): void {
    for (const material of this.guideMaterials.values()) {
      material.dashSize = GUIDE_DASH_PX * unitsPerPixel;
      material.gapSize = GUIDE_GAP_PX * unitsPerPixel;
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
      mesh.renderOrder = 11;
      this.scene.add(mesh);
      this.selectFillObject = mesh;
    }
    if (linePositions && linePositions.length > 0) {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(linePositions);
      const object = new LineSegments2(geo, this.selectLineMaterial);
      object.frustumCulled = false;
      object.renderOrder = 12;
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
    object.renderOrder = 10;
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
    for (const mat of this.guideMaterials.values()) mat.resolution.set(width, height);
  }

  render(camera2d: Camera2D): void {
    this.updateGuideDashes(camera2d.unitsPerPixel);
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
    for (const object of this.backdropObjects) {
      this.scene.remove(object);
      object.geometry.dispose();
      (object.material as MeshBasicMaterial | LineBasicMaterial).dispose();
    }
    this.backdropObjects = [];
    this.clearGuides();
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

  private clearGuides(): void {
    for (const object of this.guideObjects) {
      this.scene.remove(object);
      object.geometry.dispose();
    }
    this.guideObjects = [];
  }

  dispose(): void {
    this.clearGeometry();
    for (const mat of this.guideMaterials.values()) mat.dispose();
    this.guideMaterials.clear();
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
