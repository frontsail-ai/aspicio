/**
 * Hand-written types for the raw-.svelte package — there is no compile
 * step to generate them, and the surface is three small components.
 */
import type {
  DrawingSource,
  DrawingViewer,
  DrawingViewerOptions,
  LayerInfo,
  ViewerStats,
} from "@aspicio/core";
import type { AspicioTheme, PanelSide } from "@aspicio/elements";
import type { Component } from "svelte";

export { aspicioTokens } from "@aspicio/elements";

/** Payload of the `onloaded` callback. */
export interface LoadedInfo {
  layers: LayerInfo[];
  stats: ViewerStats;
}

interface SourceProps {
  /** DXF data: text, File, Blob, or ArrayBuffer. The most recently set of src/srcUrl wins. */
  src?: DrawingSource | null;
  /** URL to fetch a DXF from. The most recently set of src/srcUrl wins. */
  srcUrl?: string | null;
  /** Viewer options, applied at creation (changing them recreates the viewer). */
  options?: DrawingViewerOptions;
  /** Fires after each successful load. */
  onloaded?: (info: LoadedInfo) => void;
  /** Fires when a load fails. */
  onloaderror?: (error: Error) => void;
  /** Fires with the viewer on creation and null on disconnect. */
  onviewerchange?: (viewer: DrawingViewer | null) => void;
  /** Layer under the cursor, or null. Providing it enables hover-picking. */
  onhoverlayer?: (layer: string | null) => void;
  /** Show the built-in Download control (SVG / PNG export). Default: true. */
  showDownload?: boolean;
  /** Focus-scoped keyboard shortcuts: F fit, +/- zoom, R reset, A show all. Default: false. */
  shortcuts?: boolean;
  /** Forwarded to the underlying element. */
  [attribute: string]: unknown;
}

export interface AspicioPreviewProps extends SourceProps {
  /** Force canvas hover-picking on/off; defaults to on when onhoverlayer is provided. */
  hoverPick?: boolean;
}

export interface AspicioEmbedProps extends SourceProps {
  /** Where the layer list sits. Default: "left". */
  panel?: PanelSide;
  /** Visual theme. Defaults to the Aspicio demo look. */
  theme?: AspicioTheme;
  /** Inline styles applied to the inner layer panel (CSSOM values, e.g. "300px"). */
  panelStyle?: Partial<CSSStyleDeclaration>;
}

export interface AspicioLayerPanelProps {
  /** The viewer to control — from AspicioPreview's viewer() or onviewerchange. */
  viewer?: DrawingViewer | null;
  /** Visual theme. Defaults to the Aspicio demo look; "none" renders a minimal list. */
  theme?: AspicioTheme;
  /** Layer hovered on the canvas; its row is reverse-highlighted. */
  reverseHighlightLayer?: string | null;
  /** Show the gesture-hints footer (themed mode only). Default: true. */
  hints?: boolean;
  [attribute: string]: unknown;
}

/** Instance methods exposed via bind:this. */
export interface ViewerHandle {
  /** The live DrawingViewer instance, or null before mount / after unmount. */
  viewer(): DrawingViewer | null;
}

export declare const AspicioEmbed: Component<AspicioEmbedProps, ViewerHandle>;
export declare const AspicioPreview: Component<AspicioPreviewProps, ViewerHandle>;
export declare const AspicioLayerPanel: Component<AspicioLayerPanelProps>;
