import { DxfViewer } from "@aspicio/core";
import type { DxfSource, DxfViewerOptions, LayerInfo, ViewerStats } from "@aspicio/core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";

export interface DxfPreviewProps {
  /** DXF data: text, File, Blob, or ArrayBuffer. Mutually exclusive with srcUrl. */
  src?: DxfSource | null;
  /** URL to fetch a DXF from. Mutually exclusive with src. */
  srcUrl?: string | null;
  /** Viewer options, applied at mount (changing them recreates the viewer). */
  options?: DxfViewerOptions;
  className?: string;
  style?: CSSProperties;
  /** Fires after each successful load. */
  onLoaded?: (info: { layers: LayerInfo[]; stats: ViewerStats }) => void;
  /** Fires when a load fails. */
  onError?: (error: Error) => void;
  /** Fires once the viewer instance exists (and with null on unmount). */
  onViewer?: (viewer: DxfViewer | null) => void;
}

/**
 * Chrome-less embeddable DXF viewer. Renders a container that the viewer
 * fills; pan/zoom/rotate gestures work out of the box. Use the forwarded
 * ref (the DxfViewer instance) for camera control, layer toggling, and
 * hit-testing; pair with DxfLayerPanel for a ready-made layer list.
 */
export const DxfPreview = forwardRef<DxfViewer | null, DxfPreviewProps>(function DxfPreview(
  { src, srcUrl, options, className, style, onLoaded, onError, onViewer },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<DxfViewer | null>(null);
  const loadToken = useRef(0);

  // Keep callback identity out of effect dependencies.
  const callbacks = useRef({ onLoaded, onError, onViewer });
  callbacks.current = { onLoaded, onError, onViewer };

  // Options are applied at mount; a changed object identity alone must not
  // recreate a WebGL context, so key on their serialized value.
  const optionsKey = JSON.stringify(options ?? {});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = new DxfViewer(container, JSON.parse(optionsKey) as DxfViewerOptions);
    setViewer(instance);
    callbacks.current.onViewer?.(instance);
    return () => {
      callbacks.current.onViewer?.(null);
      setViewer(null);
      instance.dispose();
    };
  }, [optionsKey]);

  useEffect(() => {
    if (!viewer || (src == null && srcUrl == null)) return;
    const token = ++loadToken.current;
    const loading = srcUrl != null ? viewer.loadUrl(srcUrl) : viewer.load(src as DxfSource);
    loading
      .then(() => {
        if (token !== loadToken.current) return; // superseded by a newer src
        callbacks.current.onLoaded?.({ layers: viewer.getLayers(), stats: viewer.stats });
      })
      .catch((error: unknown) => {
        if (token !== loadToken.current) return;
        callbacks.current.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
  }, [viewer, src, srcUrl]);

  useImperativeHandle(ref, () => viewer as DxfViewer, [viewer]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    />
  );
});
