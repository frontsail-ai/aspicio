import type { DxfViewer } from "@observo/core";
import { forwardRef, useImperativeHandle, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { DxfLayerPanel } from "./DxfLayerPanel.tsx";
import { DxfPreview } from "./DxfPreview.tsx";
import type { DxfPreviewProps } from "./DxfPreview.tsx";

export interface DxfEmbedProps extends DxfPreviewProps {
  /** Where the layer list sits. Default: "left". */
  panel?: "left" | "right" | "none";
  panelClassName?: string;
  panelStyle?: CSSProperties;
}

/**
 * Batteries-included embed: layer list + interactive preview in one
 * component. Pass the DXF as `src` (text, File, Blob, ArrayBuffer) or
 * `srcUrl`; everything else is optional.
 *
 *   <DxfEmbed src={file} style={{ height: 480 }} />
 *
 * The forwarded ref (and onViewer) still expose the full DxfViewer for
 * camera control; use DxfPreview + DxfLayerPanel directly when you need
 * a custom layout.
 */
export const DxfEmbed = forwardRef<DxfViewer | null, DxfEmbedProps>(function DxfEmbed(
  { panel = "left", panelClassName, panelStyle, className, style, onViewer, ...previewProps },
  ref,
): ReactElement {
  const [viewer, setViewer] = useState<DxfViewer | null>(null);
  useImperativeHandle(ref, () => viewer as DxfViewer, [viewer]);

  const panelElement =
    panel === "none" ? null : (
      <DxfLayerPanel
        viewer={viewer}
        className={panelClassName}
        style={{ width: 220, flexShrink: 0, overflowY: "auto", ...panelStyle }}
      />
    );

  return (
    <div
      className={className}
      style={{ display: "flex", gap: "0.75em", width: "100%", height: "100%", ...style }}
    >
      {panel === "left" && panelElement}
      <DxfPreview
        {...previewProps}
        style={{ flex: 1, minWidth: 0 }}
        onViewer={(instance) => {
          setViewer(instance);
          onViewer?.(instance);
        }}
      />
      {panel === "right" && panelElement}
    </div>
  );
});
