import type { DxfViewer, LayerInfo } from "@observo/core";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { observoTokens } from "./theme.ts";
import type { DxfTheme } from "./theme.ts";

export interface DxfLayerPanelProps {
  /** The viewer to control — from DxfPreview's ref or onViewer callback. */
  viewer: DxfViewer | null;
  /** Visual theme. Defaults to the Observo demo look; "none" inherits the host. */
  theme?: DxfTheme;
  className?: string;
  style?: CSSProperties;
}

const baseRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.6em",
  padding: "0.35em 0.5em",
  borderRadius: 3,
  cursor: "pointer",
  userSelect: "none",
};

/**
 * Ready-made layer list for an embedded viewer: visibility checkboxes,
 * effective-color swatches, entity counts, and hover-to-highlight. Styled
 * like the Observo demo app by default (fonts degrade to system faces
 * unless the host loads IBM Plex); pass theme="none" to inherit the host's
 * look instead.
 */
export function DxfLayerPanel({
  viewer,
  theme = "observo",
  className,
  style,
}: DxfLayerPanelProps): ReactElement {
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [, bump] = useState(0);
  const themed = theme === "observo";

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

  const rootStyle: CSSProperties = themed
    ? {
        listStyle: "none",
        margin: 0,
        padding: "8px",
        background: observoTokens.panel,
        color: observoTokens.text,
        fontFamily: observoTokens.fontSans,
        fontSize: 13,
        ...style,
      }
    : { listStyle: "none", margin: 0, padding: 0, ...style };

  return (
    <ul className={className} style={rootStyle}>
      {layers.map((layer) => {
        const rgb = layer.effectiveColors?.[0] ?? layer.color;
        const color = `#${rgb.toString(16).padStart(6, "0")}`;
        return (
          <li
            key={layer.name}
            style={{
              ...baseRow,
              opacity: layer.visible ? 1 : 0.5,
              background: themed && hoveredRow === layer.name ? observoTokens.hover : undefined,
            }}
            onMouseEnter={() => {
              setHoveredRow(layer.name);
              viewer?.setLayerHighlight(layer.name);
            }}
            onMouseLeave={() => {
              setHoveredRow(null);
              viewer?.setLayerHighlight(null);
            }}
          >
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={() => toggle(layer)}
              aria-label={layer.name}
              style={themed ? { accentColor: observoTokens.crease } : undefined}
            />
            <span
              aria-hidden
              style={{
                width: "0.8em",
                height: "0.8em",
                borderRadius: 2,
                flexShrink: 0,
                background: layer.visible ? color : "transparent",
                border: layer.visible ? "1px solid rgba(255,255,255,.25)" : `1px solid ${color}`,
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: themed && !layer.visible ? observoTokens.text3 : undefined,
              }}
            >
              {layer.name}
            </span>
            <span
              style={
                themed
                  ? { color: observoTokens.text3, fontFamily: observoTokens.fontMono, fontSize: 11 }
                  : { opacity: 0.55, fontSize: "0.85em" }
              }
            >
              {layer.entityCount}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
