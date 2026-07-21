/**
 * Hand-written types for the raw-.svelte package — there is no compile
 * step to generate them, and the surface is three small components.
 */
import type { DxfSource, DxfViewer, DxfViewerOptions, LayerInfo, ViewerStats } from "@aspicio/core";
import type { DxfTheme, PanelSide } from "@aspicio/elements";
import type { Component } from "svelte";

export { aspicioTokens } from "@aspicio/elements";

/** Payload of the `onloaded` callback. */
export interface LoadedInfo {
  layers: LayerInfo[];
  stats: ViewerStats;
}

interface SourceProps {
  /** DXF data: text, File, Blob, or ArrayBuffer. The most recently set of src/srcUrl wins. */
  src?: DxfSource | null;
  /** URL to fetch a DXF from. The most recently set of src/srcUrl wins. */
  srcUrl?: string | null;
  /** Viewer options, applied at creation (changing them recreates the viewer). */
  options?: DxfViewerOptions;
  /** Fires after each successful load. */
  onloaded?: (info: LoadedInfo) => void;
  /** Fires when a load fails. */
  onloaderror?: (error: Error) => void;
  /** Fires with the viewer on creation and null on disconnect. */
  onviewerchange?: (viewer: DxfViewer | null) => void;
  /** Layer under the cursor, or null. Providing it enables hover-picking. */
  onhoverlayer?: (layer: string | null) => void;
  /** Show the built-in Download control (SVG / PNG export). Default: true. */
  showDownload?: boolean;
  /** Focus-scoped keyboard shortcuts: F fit, +/- zoom, R reset, A show all. Default: false. */
  shortcuts?: boolean;
  /** Forwarded to the underlying element. */
  [attribute: string]: unknown;
}

export interface DxfPreviewProps extends SourceProps {
  /** Force canvas hover-picking on/off; defaults to on when onhoverlayer is provided. */
  hoverPick?: boolean;
}

export interface DxfEmbedProps extends SourceProps {
  /** Where the layer list sits. Default: "left". */
  panel?: PanelSide;
  /** Visual theme. Defaults to the Aspicio demo look. */
  theme?: DxfTheme;
  /** Inline styles applied to the inner layer panel (CSSOM values, e.g. "300px"). */
  panelStyle?: Partial<CSSStyleDeclaration>;
}

export interface DxfLayerPanelProps {
  /** The viewer to control — from DxfPreview's viewer() or onviewerchange. */
  viewer?: DxfViewer | null;
  /** Visual theme. Defaults to the Aspicio demo look; "none" renders a minimal list. */
  theme?: DxfTheme;
  /** Layer hovered on the canvas; its row is reverse-highlighted. */
  reverseHighlightLayer?: string | null;
  /** Show the gesture-hints footer (themed mode only). Default: true. */
  hints?: boolean;
  [attribute: string]: unknown;
}

/** Instance methods exposed via bind:this. */
export interface ViewerHandle {
  /** The live DxfViewer instance, or null before mount / after unmount. */
  viewer(): DxfViewer | null;
}

export declare const DxfEmbed: Component<DxfEmbedProps, ViewerHandle>;
export declare const DxfPreview: Component<DxfPreviewProps, ViewerHandle>;
export declare const DxfLayerPanel: Component<DxfLayerPanelProps>;
