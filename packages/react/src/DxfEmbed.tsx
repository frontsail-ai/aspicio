import type { DxfViewer } from "@aspicio/core";
import { forwardRef, useImperativeHandle, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { DxfLayerPanel } from "./DxfLayerPanel.tsx";
import { DxfPreview } from "./DxfPreview.tsx";
import type { DxfPreviewProps } from "./DxfPreview.tsx";
import { aspicioCanvasBackground, aspicioTokens } from "./theme.ts";
import type { DxfTheme } from "./theme.ts";

export interface DxfEmbedProps extends DxfPreviewProps {
  /** Where the layer list sits. Default: "left". */
  panel?: "left" | "right" | "none";
  panelClassName?: string;
  panelStyle?: CSSProperties;
  /** Visual theme. Defaults to the Aspicio demo look; "none" inherits the host. */
  theme?: DxfTheme;
}

/**
 * Batteries-included embed: layer list + interactive preview in one
 * component, styled like the Aspicio demo app (blueprint grid, dark
 * panel) unless theme="none". Pass the DXF as `src` (text, File, Blob,
 * ArrayBuffer) or `srcUrl`; everything else is optional.
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
    panelClassName,
    panelStyle,
    theme = "aspicio",
    className,
    style,
    options,
    onViewer,
    ...previewProps
  },
  ref,
): ReactElement {
  const [viewer, setViewer] = useState<DxfViewer | null>(null);
  useImperativeHandle(ref, () => viewer as DxfViewer, [viewer]);
  const themed = theme === "aspicio";

  const panelElement =
    panel === "none" ? null : (
      <DxfLayerPanel
        viewer={viewer}
        theme={theme}
        className={panelClassName}
        style={{
          width: 220,
          flexShrink: 0,
          overflowY: "auto",
          ...(themed && {
            [panel === "left" ? "borderRight" : "borderLeft"]:
              `1px solid ${aspicioTokens.hairline}`,
          }),
          ...panelStyle,
        }}
      />
    );

  const rootStyle: CSSProperties = themed
    ? {
        display: "flex",
        width: "100%",
        height: "100%",
        background: aspicioTokens.bg,
        border: `1px solid ${aspicioTokens.hairline2}`,
        borderRadius: 6,
        overflow: "hidden",
        ...style,
      }
    : { display: "flex", gap: "0.75em", width: "100%", height: "100%", ...style };

  return (
    <div className={className} style={rootStyle}>
      {panel === "left" && panelElement}
      <DxfPreview
        {...previewProps}
        // The demo look draws its blueprint grid behind a transparent
        // canvas; respect an explicit background if the caller set one.
        options={
          themed && options?.background === undefined ? { ...options, background: null } : options
        }
        style={{ flex: 1, minWidth: 0, ...(themed && aspicioCanvasBackground) }}
        onViewer={(instance) => {
          setViewer(instance);
          onViewer?.(instance);
        }}
      />
      {panel === "right" && panelElement}
    </div>
  );
});
