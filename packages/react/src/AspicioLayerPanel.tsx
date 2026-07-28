import type { DrawingViewer } from "@aspicio/core";
import { AspicioLayerPanel as AspicioLayerPanelElement } from "@aspicio/elements";
import { createComponent } from "@lit/react";
import * as React from "react";
import type { CSSProperties, ReactElement } from "react";
import type { AspicioTheme } from "./theme.ts";

export interface AspicioLayerPanelProps {
  /** The viewer to control — from AspicioPreview's ref or onViewer callback. */
  viewer: DrawingViewer | null;
  /** Visual theme. Defaults to the Aspicio demo look; "none" renders a minimal list. */
  theme?: AspicioTheme;
  /**
   * Layer currently hovered on the canvas (from AspicioPreview's onHoverLayer).
   * Its row is reverse-highlighted. AspicioEmbed wires this automatically.
   */
  reverseHighlightLayer?: string | null;
  /** Show the gesture-hints footer (themed mode only). Default: true. */
  hints?: boolean;
  className?: string;
  style?: CSSProperties;
}

const LayerPanelElement = createComponent({
  tagName: "aspicio-layer-panel",
  elementClass: AspicioLayerPanelElement,
  react: React,
});

/**
 * Ready-made layer list for an embedded viewer — a thin React veneer over
 * the framework-neutral `<aspicio-layer-panel>` element from
 * @aspicio/elements. Matches the Aspicio demo app: header with layer
 * count, visibility checkboxes, effective-color swatches, entity counts,
 * hover-to-highlight, double-click-to-solo (with a banner), canvas-hover
 * reverse-highlight, and a gesture-hints footer. Pass theme="none" for a
 * minimal list; style internals via the element's `::part()` hooks and
 * `--aspicio-*` custom properties.
 */
export function AspicioLayerPanel({
  viewer,
  theme = "aspicio",
  reverseHighlightLayer = null,
  hints = true,
  className,
  style,
}: AspicioLayerPanelProps): ReactElement {
  return (
    <LayerPanelElement
      className={className}
      style={style}
      viewer={viewer}
      theme={theme}
      reverseHighlightLayer={reverseHighlightLayer}
      noHints={!hints}
    />
  );
}
