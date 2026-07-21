import type { DxfViewer, LayerInfo, ViewerStats } from "@aspicio/core";
import { AspicioEmbed } from "@aspicio/elements";
import { createComponent } from "@lit/react";
import * as React from "react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DxfPreviewProps } from "./DxfPreview.tsx";
import type { DxfTheme } from "./theme.ts";

export interface DxfEmbedProps extends DxfPreviewProps {
  /** Where the layer list sits. Default: "left". */
  panel?: "left" | "right" | "none";
  /**
   * @deprecated Host CSS can't reach into the embed's shadow DOM, so a
   * class on the inner panel has no effect. Use `panelStyle`, the
   * `--aspicio-*` custom properties, or `::part(panel)` instead.
   */
  panelClassName?: string;
  /** Inline styles applied to the inner layer panel. */
  panelStyle?: CSSProperties;
  /** Visual theme. Defaults to the Aspicio demo look; "none" inherits the host. */
  theme?: DxfTheme;
}

const EmbedElement = createComponent({
  tagName: "aspicio-embed",
  elementClass: AspicioEmbed,
  react: React,
  events: {
    onLoadedEvent: "loaded",
    onLoadErrorEvent: "load-error",
    onViewerChangeEvent: "viewer-change",
    onHoverLayerEvent: "hover-layer",
  },
});

/** CSS properties that take unitless numbers (mirrors React's DOM handling). */
const UNITLESS = new Set([
  "opacity",
  "zIndex",
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "lineHeight",
  "order",
  "zoom",
]);

/**
 * React allows numeric style values ("width: 220" → "220px"); the element
 * applies panelStyle via CSSOM, which doesn't convert — do it here.
 */
function toCssomStyle(style: CSSProperties): Partial<CSSStyleDeclaration> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value == null) continue;
    out[key] = typeof value === "number" && !UNITLESS.has(key) ? `${value}px` : String(value);
  }
  return out as Partial<CSSStyleDeclaration>;
}

/**
 * Batteries-included embed: layer list + interactive preview in one
 * component — a thin React veneer over the framework-neutral
 * `<aspicio-embed>` element from @aspicio/elements, styled like the
 * Aspicio demo app (blueprint grid, dark panel) unless theme="none".
 * Pass the DXF as `src` (text, File, Blob, ArrayBuffer) or `srcUrl`;
 * everything else is optional.
 *
 *   <DxfEmbed src={file} style={{ height: 480 }} />
 *
 * The forwarded ref (and onViewer) still expose the full DxfViewer for
 * camera control; use DxfPreview + DxfLayerPanel directly when you need
 * a custom layout.
 */
export const DxfEmbed = forwardRef<DxfViewer | null, DxfEmbedProps>(function DxfEmbed(
  {
    panel = "left",
    panelClassName: _panelClassName,
    panelStyle,
    theme = "aspicio",
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
  const [viewer, setViewer] = useState<DxfViewer | null>(null);
  useImperativeHandle(ref, () => viewer as DxfViewer, [viewer]);

  const callbacks = useRef({ onLoaded, onError, onViewer, onHoverLayer });
  callbacks.current = { onLoaded, onError, onViewer, onHoverLayer };

  // React detaches event listeners before the element disconnects, so the
  // element's final `viewer-change` (null) never reaches us — honor the
  // "null on unmount" contract from the veneer itself. Under StrictMode the
  // cleanup also runs mid-life (after the viewer already exists), so the
  // setup re-reads the element's live viewer to undo it.
  const elRef = useRef<AspicioEmbed | null>(null);
  const liveViewer = useRef<DxfViewer | null>(null);
  const report = (next: DxfViewer | null): void => {
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

  const panelStyleCssom = useMemo(
    () => (panelStyle ? toCssomStyle(panelStyle) : undefined),
    [panelStyle],
  );

  return (
    <EmbedElement
      ref={elRef}
      className={className}
      style={style}
      src={src ?? null}
      srcUrl={srcUrl ?? null}
      options={options}
      panel={panel}
      theme={theme}
      panelStyle={panelStyleCssom}
      noDownload={!showDownload}
      shortcuts={shortcuts}
      onLoadedEvent={(e: Event) => {
        callbacks.current.onLoaded?.(
          (e as CustomEvent<{ layers: LayerInfo[]; stats: ViewerStats }>).detail,
        );
      }}
      onLoadErrorEvent={(e: Event) => {
        callbacks.current.onError?.((e as CustomEvent<{ error: Error }>).detail.error);
      }}
      onViewerChangeEvent={(e: Event) => {
        report((e as CustomEvent<{ viewer: DxfViewer | null }>).detail.viewer);
      }}
      onHoverLayerEvent={(e: Event) => {
        callbacks.current.onHoverLayer?.((e as CustomEvent<{ layer: string | null }>).detail.layer);
      }}
    />
  );
});
