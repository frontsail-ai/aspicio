import { DxfViewer, attachShortcuts } from "@aspicio/core";
import type { DxfSource, DxfViewerOptions, LayerInfo, ViewerStats } from "@aspicio/core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { aspicioTokens } from "./theme.ts";

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
  /**
   * When provided, the canvas hit-tests the layer under the cursor on hover,
   * highlights it, and reports its name (or null). DxfEmbed uses this to
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

/**
 * Chrome-less embeddable DXF viewer. Renders a container that the viewer
 * fills; pan/zoom/rotate gestures work out of the box. Use the forwarded
 * ref (the DxfViewer instance) for camera control, layer toggling, and
 * hit-testing; pair with DxfLayerPanel for a ready-made layer list.
 */
export const DxfPreview = forwardRef<DxfViewer | null, DxfPreviewProps>(function DxfPreview(
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<DxfViewer | null>(null);
  const loadToken = useRef(0);

  // Keep callback identity out of effect dependencies.
  const callbacks = useRef({ onLoaded, onError, onViewer, onHoverLayer });
  callbacks.current = { onLoaded, onError, onViewer, onHoverLayer };

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

  // Canvas hover-picking: active while an onHoverLayer callback is set. The
  // effect keys on the boolean (not the callback identity) and reads the live
  // callback from the ref, so an unstable caller-supplied handler doesn't tear
  // the listener down and clear the highlight on every render.
  const hoverEnabled = onHoverLayer != null;
  useEffect(() => {
    const container = containerRef.current;
    if (!viewer || !container || !hoverEnabled) return;
    let queued = false;
    let last: string | null = null;
    const report = (layer: string | null): void => {
      if (layer === last) return;
      last = layer;
      viewer.setLayerHighlight(layer);
      callbacks.current.onHoverLayer?.(layer);
    };
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse" || e.buttons !== 0 || queued) return;
      queued = true;
      const { clientX, clientY } = e;
      requestAnimationFrame(() => {
        queued = false;
        const rect = container.getBoundingClientRect();
        report(viewer.pickLayer(clientX - rect.left, clientY - rect.top));
      });
    };
    const onLeave = (): void => report(null);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      report(null);
    };
  }, [viewer, hoverEnabled]);

  // Keyboard shortcuts (camera + show-all), scoped to the focused container so
  // multiple embeds on a page don't fight over global keys. The canvas isn't
  // focusable, so clicking the embed focuses the container to receive keys.
  useEffect(() => {
    const container = containerRef.current;
    if (!viewer || !container || !shortcuts) return;
    if (container.tabIndex < 0) container.tabIndex = 0;
    container.style.outline = "none";
    const focus = (): void => container.focus();
    container.addEventListener("pointerdown", focus);
    const detach = attachShortcuts(container, viewer, {
      onShowAll: () => {
        for (const layer of viewer.getLayers()) viewer.setLayerVisible(layer.name, true);
      },
    });
    return () => {
      container.removeEventListener("pointerdown", focus);
      detach();
    };
  }, [viewer, shortcuts]);

  useImperativeHandle(ref, () => viewer as DxfViewer, [viewer]);

  // The viewer appends its canvas to this container after React renders; the
  // download control is a React-managed child laid over it (absolute), and the
  // canvas is appended after it, so React never reconciles the canvas node.
  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      {showDownload && viewer ? (
        <DownloadControl viewer={viewer} filename={downloadName(srcUrl)} />
      ) : null}
    </div>
  );
});

function downloadName(srcUrl?: string | null): string {
  const base = srcUrl?.split(/[?#]/)[0].split("/").pop() ?? "";
  return base.replace(/\.dxf$/i, "") || "drawing";
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** A small overlay button that exports the drawing as SVG or PNG. */
function DownloadControl({ viewer, filename }: { viewer: DxfViewer; filename: string }) {
  const [open, setOpen] = useState(false);

  const save = (format: "svg" | "png"): void => {
    if (format === "svg") {
      const blob = new Blob([viewer.toSVG({ background: aspicioTokens.canvas })], {
        type: "image/svg+xml",
      });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${filename}.svg`);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      triggerDownload(viewer.toPNG({ background: 0x16181d }), `${filename}.png`);
    }
    setOpen(false);
  };

  const item: CSSProperties = {
    display: "block",
    width: "100%",
    padding: "6px 10px",
    background: "transparent",
    border: "none",
    borderRadius: 3,
    color: aspicioTokens.text,
    font: `12px ${aspicioTokens.fontMono}`,
    letterSpacing: "0.06em",
    textAlign: "left",
    cursor: "pointer",
  };

  return (
    <div style={{ position: "absolute", top: 10, right: 10, zIndex: 5 }}>
      <button
        type="button"
        aria-label="Download"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          background: "rgba(25,28,34,.9)",
          border: `1px solid ${aspicioTokens.hairline2}`,
          borderRadius: 4,
          color: aspicioTokens.text2,
          cursor: "pointer",
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 116,
            padding: 4,
            background: aspicioTokens.panel,
            border: `1px solid ${aspicioTokens.hairline2}`,
            borderRadius: 5,
            boxShadow: "0 12px 32px rgba(0,0,0,.5)",
          }}
        >
          <button type="button" style={item} onClick={() => save("svg")}>
            SVG
          </button>
          <button type="button" style={item} onClick={() => save("png")}>
            PNG
          </button>
        </div>
      ) : null}
    </div>
  );
}
