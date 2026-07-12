import type { DxfViewer, LayerInfo } from "@observo/core";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

export interface DxfLayerPanelProps {
  /** The viewer to control — from DxfPreview's ref or onViewer callback. */
  viewer: DxfViewer | null;
  className?: string;
  style?: CSSProperties;
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.6em",
  padding: "0.35em 0.5em",
  borderRadius: 4,
  cursor: "pointer",
  userSelect: "none",
};

/**
 * Optional ready-made layer list for an embedded viewer: visibility
 * checkboxes, effective-color swatches, entity counts, and hover-to-
 * highlight. Deliberately lightly styled — inherits the host font and
 * colors; override via className/style.
 */
export function DxfLayerPanel({ viewer, className, style }: DxfLayerPanelProps): ReactElement {
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!viewer) {
      setLayers([]);
      return;
    }
    const sync = (): void => setLayers(viewer.getLayers());
    sync();
    viewer.on("loaded", sync);
    return () => viewer.off("loaded", sync);
  }, [viewer]);

  const toggle = (layer: LayerInfo): void => {
    viewer?.setLayerVisible(layer.name, !layer.visible);
    bump((n) => n + 1); // LayerInfo mutates in place; force a re-render
  };

  return (
    <ul className={className} style={{ listStyle: "none", margin: 0, padding: 0, ...style }}>
      {layers.map((layer) => {
        const rgb = layer.effectiveColors?.[0] ?? layer.color;
        const color = `#${rgb.toString(16).padStart(6, "0")}`;
        return (
          <li
            key={layer.name}
            style={{ ...rowStyle, opacity: layer.visible ? 1 : 0.5 }}
            onMouseEnter={() => viewer?.setLayerHighlight(layer.name)}
            onMouseLeave={() => viewer?.setLayerHighlight(null)}
          >
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={() => toggle(layer)}
              aria-label={layer.name}
            />
            <span
              aria-hidden
              style={{
                width: "0.8em",
                height: "0.8em",
                borderRadius: 2,
                flexShrink: 0,
                background: layer.visible ? color : "transparent",
                border: layer.visible ? "1px solid rgba(128,128,128,.5)" : `1px solid ${color}`,
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {layer.name}
            </span>
            <span style={{ opacity: 0.55, fontSize: "0.85em" }}>{layer.entityCount}</span>
          </li>
        );
      })}
    </ul>
  );
}
