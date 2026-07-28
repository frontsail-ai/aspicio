import type {
  DrawingSource,
  DrawingViewer,
  DrawingViewerOptions,
  LayerInfo,
  ViewerStats,
} from "@aspicio/core";
import { AspicioPreview as AspicioPreviewElement } from "@aspicio/elements";
import { createComponent } from "@lit/react";
import * as React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";

export interface AspicioPreviewProps {
  /** DXF data: text, File, Blob, or ArrayBuffer. The most recently set of src/srcUrl wins. */
  src?: DrawingSource | null;
  /** URL to fetch a DXF from. The most recently set of src/srcUrl wins. */
  srcUrl?: string | null;
  /** Viewer options, applied at mount (changing them recreates the viewer). */
  options?: DrawingViewerOptions;
  className?: string;
  style?: CSSProperties;
  /** Fires after each successful load. */
  onLoaded?: (info: { layers: LayerInfo[]; stats: ViewerStats }) => void;
  /** Fires when a load fails. */
  onError?: (error: Error) => void;
  /** Fires once the viewer instance exists (and with null on unmount). */
  onViewer?: (viewer: DrawingViewer | null) => void;
  /**
   * When provided, the canvas hit-tests the layer under the cursor on hover,
   * highlights it, and reports its name (or null). AspicioEmbed uses this to
   * reverse-highlight the matching layer-panel row.
   */
  onHoverLayer?: (layer: string | null) => void;
  /**
   * Show the built-in Download control (SVG / PNG export). Default: true.
   * Set false to hide it in embeds; `toSVG()`/`toPNG()` remain callable via
   * the forwarded ref.
   */
  showDownload?: boolean;
  /**
   * Enable keyboard shortcuts on the (focused) viewer: `F` fit, `+`/`-` zoom,
   * `R` reset rotation, `A` show all layers. Default: false. The embed must be
   * focused (click it) to receive keys, so multiple embeds don't collide.
   */
  shortcuts?: boolean;
}

const PreviewElement = createComponent({
  tagName: "aspicio-preview",
  elementClass: AspicioPreviewElement,
  react: React,
  events: {
    onLoadedEvent: "loaded",
    onLoadErrorEvent: "load-error",
    onViewerChangeEvent: "viewer-change",
    onHoverLayerEvent: "hover-layer",
  },
});

/**
 * Chrome-less embeddable DXF viewer — a thin React veneer over the
 * framework-neutral `<aspicio-preview>` element from @aspicio/elements.
 * Use the forwarded ref (the DrawingViewer instance) for camera control,
 * layer toggling, and hit-testing; pair with AspicioLayerPanel for a
 * ready-made layer list.
 */
export const AspicioPreview = forwardRef<DrawingViewer | null, AspicioPreviewProps>(
  function AspicioPreview(
    {
      src,
      srcUrl,
      options,
      className,
      style,
      onLoaded,
      onError,
      onViewer,
      onHoverLayer,
      showDownload = true,
      shortcuts = false,
    },
    ref,
  ) {
    const [viewer, setViewer] = useState<DrawingViewer | null>(null);
    useImperativeHandle(ref, () => viewer as DrawingViewer, [viewer]);

    // Keep callback identity out of the element's listener wiring.
    const callbacks = useRef({ onLoaded, onError, onViewer, onHoverLayer });
    callbacks.current = { onLoaded, onError, onViewer, onHoverLayer };

    // React detaches event listeners before the element disconnects, so the
    // element's final `viewer-change` (null) never reaches us — honor the
    // "null on unmount" contract from the veneer itself. Under StrictMode the
    // cleanup also runs mid-life (after the viewer already exists), so the
    // setup re-reads the element's live viewer to undo it.
    const elRef = useRef<AspicioPreviewElement | null>(null);
    const liveViewer = useRef<DrawingViewer | null>(null);
    const report = (next: DrawingViewer | null): void => {
      if (liveViewer.current === next) return;
      liveViewer.current = next;
      setViewer(next);
      callbacks.current.onViewer?.(next);
    };
    const reportRef = useRef(report);
    reportRef.current = report;
    useEffect(() => {
      reportRef.current(elRef.current?.viewer ?? null);
      return () => reportRef.current(null);
    }, []);

    return (
      <PreviewElement
        ref={elRef}
        className={className}
        style={style}
        src={src ?? null}
        srcUrl={srcUrl ?? null}
        options={options}
        noDownload={!showDownload}
        shortcuts={shortcuts}
        hoverPick={onHoverLayer != null}
        onLoadedEvent={(e: Event) => {
          callbacks.current.onLoaded?.(
            (e as CustomEvent<{ layers: LayerInfo[]; stats: ViewerStats }>).detail,
          );
        }}
        onLoadErrorEvent={(e: Event) => {
          callbacks.current.onError?.((e as CustomEvent<{ error: Error }>).detail.error);
        }}
        onViewerChangeEvent={(e: Event) => {
          report((e as CustomEvent<{ viewer: DrawingViewer | null }>).detail.viewer);
        }}
        onHoverLayerEvent={(e: Event) => {
          callbacks.current.onHoverLayer?.(
            (e as CustomEvent<{ layer: string | null }>).detail.layer,
          );
        }}
      />
    );
  },
);
