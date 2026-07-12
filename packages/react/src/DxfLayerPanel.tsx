import type { DxfViewer, LayerInfo } from "@aspicio/core";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { aspicioTokens as t } from "./theme.ts";
import type { DxfTheme } from "./theme.ts";

export interface DxfLayerPanelProps {
  /** The viewer to control — from DxfPreview's ref or onViewer callback. */
  viewer: DxfViewer | null;
  /** Visual theme. Defaults to the Aspicio demo look; "none" inherits the host. */
  theme?: DxfTheme;
  /**
   * Layer currently hovered on the canvas (from DxfPreview's onHoverLayer).
   * Its row is reverse-highlighted. DxfEmbed wires this automatically.
   */
  reverseHighlightLayer?: string | null;
  /** Show the gesture-hints footer (themed mode only). Default: true. */
  hints?: boolean;
  className?: string;
  style?: CSSProperties;
}

const DESKTOP_HINTS: [string, string][] = [
  ["DRAG", "pan"],
  ["SCROLL", "zoom"],
  ["⇧+DRAG", "rotate"],
  ["2×CLICK", "fit to view"],
  ["HOVER", "highlight layer"],
  ["2×CLICK ROW", "solo layer"],
];

const CheckIcon = (): ReactElement => (
  <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
    <rect x={1.5} y={1.5} width={13} height={13} rx={2.5} fill={t.crease} />
    <path
      d="M4.4 8.2 L6.9 10.6 L11.6 5.3"
      fill="none"
      stroke="#fff"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const UncheckIcon = (): ReactElement => (
  <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
    <rect
      x={1.5}
      y={1.5}
      width={13}
      height={13}
      rx={2.5}
      fill="none"
      stroke={t.hairline2}
      strokeWidth={1.4}
    />
  </svg>
);

/**
 * Ready-made layer list for an embedded viewer, matching the Aspicio demo
 * app: header with layer count, visibility checkboxes, effective-color
 * swatches, entity counts, hover-to-highlight, double-click-to-solo (with a
 * banner), canvas-hover reverse-highlight, and a gesture-hints footer. Pass
 * theme="none" for a minimal list that inherits the host's styling.
 */
export function DxfLayerPanel({
  viewer,
  theme = "aspicio",
  reverseHighlightLayer = null,
  hints = true,
  className,
  style,
}: DxfLayerPanelProps): ReactElement {
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [soloLayer, setSoloLayer] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const themed = theme === "aspicio";

  useEffect(() => {
    if (!viewer) {
      setLayers([]);
      return;
    }
    const sync = (): void => {
      setSoloLayer(null);
      setLayers(viewer.getLayers());
    };
    sync();
    viewer.on("loaded", sync);
    return () => viewer.off("loaded", sync);
  }, [viewer]);

  const tick = (): void => forceRender((n) => n + 1);
  const isVisible = (layer: LayerInfo): boolean =>
    soloLayer ? layer.name === soloLayer : layer.visible !== false;

  const toggleLayer = (layer: LayerInfo): void => {
    if (!viewer) return;
    if (soloLayer) {
      // Toggling a checkbox during solo turns that layer into the only
      // visible one and exits solo.
      for (const l of layers) viewer.setLayerVisible(l.name, l.name === layer.name);
      setSoloLayer(null);
    } else {
      viewer.setLayerVisible(layer.name, layer.visible === false);
    }
    tick();
  };

  const toggleSolo = (layer: LayerInfo): void => {
    if (!viewer) return;
    const next = soloLayer === layer.name ? null : layer.name;
    for (const l of layers) viewer.setLayerVisible(l.name, next ? l.name === next : true);
    setSoloLayer(next);
    tick();
  };

  const exitSolo = (): void => {
    if (!viewer) return;
    for (const l of layers) viewer.setLayerVisible(l.name, true);
    setSoloLayer(null);
    tick();
  };

  const hover = (name: string | null): void => {
    setHoveredRow(name);
    viewer?.setLayerHighlight(name);
  };

  /* ---------- minimal (theme="none") ---------- */
  if (!themed) {
    return (
      <ul className={className} style={{ listStyle: "none", margin: 0, padding: 0, ...style }}>
        {layers.map((layer) => {
          const visible = isVisible(layer);
          const rgb = layer.effectiveColors?.[0] ?? layer.color;
          const color = `#${rgb.toString(16).padStart(6, "0")}`;
          return (
            <li
              key={layer.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6em",
                padding: "0.35em 0.5em",
                cursor: "pointer",
                userSelect: "none",
                opacity: visible ? 1 : 0.5,
              }}
              onMouseEnter={() => hover(layer.name)}
              onMouseLeave={() => hover(null)}
              onDoubleClick={() => toggleSolo(layer)}
            >
              <input
                type="checkbox"
                checked={visible}
                onChange={() => toggleLayer(layer)}
                aria-label={layer.name}
              />
              <span
                aria-hidden
                style={{
                  width: "0.8em",
                  height: "0.8em",
                  borderRadius: 2,
                  flexShrink: 0,
                  background: visible ? color : "transparent",
                  border: visible ? "1px solid rgba(128,128,128,.5)" : `1px solid ${color}`,
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

  /* ---------- themed (demo parity) ---------- */
  const mono = t.fontMono;
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        background: t.panel,
        color: t.text,
        fontFamily: t.fontSans,
        fontSize: 13,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "13px 14px 10px",
          flexShrink: 0,
          fontFamily: mono,
          fontSize: 11,
          letterSpacing: "0.14em",
          color: t.text3,
        }}
      >
        LAYERS
        <span
          style={{
            fontSize: 10.5,
            background: t.panel2,
            border: `1px solid ${t.hairline}`,
            borderRadius: 3,
            padding: "1px 6px",
            fontFeatureSettings: '"tnum" 1',
          }}
        >
          {layers.length}
        </span>
      </div>

      {soloLayer && (
        <div
          style={{
            margin: "0 12px 8px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 9px",
            background: t.amberdim,
            border: `1px solid ${t.amberborder}`,
            borderRadius: 3,
          }}
        >
          <span
            style={{
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: "0.1em",
              fontWeight: 600,
              color: t.amber,
            }}
          >
            SOLO
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: mono,
              fontSize: 11.5,
              color: t.text,
            }}
          >
            {soloLayer}
          </span>
          <button
            type="button"
            onClick={exitSolo}
            style={{
              border: "none",
              background: "transparent",
              color: t.amber,
              cursor: "pointer",
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: "0.08em",
              padding: "2px 4px",
            }}
          >
            EXIT
          </button>
        </div>
      )}

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: "0 8px",
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {layers.length === 0 && (
          <li
            style={{
              padding: "24px 10px",
              textAlign: "center",
              color: t.text3,
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
            No layers yet.
          </li>
        )}
        {layers.map((layer) => {
          const visible = isVisible(layer);
          const isSolo = soloLayer === layer.name;
          const dimmed = !!soloLayer && !isSolo;
          const reverse = reverseHighlightLayer === layer.name;
          const rowHover = hoveredRow === layer.name;
          const rgb = layer.effectiveColors?.[0] ?? layer.color;
          const color = `#${rgb.toString(16).padStart(6, "0")}`;
          return (
            <li
              key={layer.name}
              title={`${layer.name} · ${layer.entityCount} entities`}
              onMouseEnter={() => hover(layer.name)}
              onMouseLeave={() => hover(null)}
              onDoubleClick={(e) => {
                e.preventDefault();
                toggleSolo(layer);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 8px",
                paddingLeft: isSolo ? 12 : 8,
                borderRadius: 3,
                cursor: "pointer",
                userSelect: "none",
                position: "relative",
                minWidth: 0,
                border: `1px solid ${reverse ? t.crease : isSolo ? t.amberborder : "transparent"}`,
                background: reverse
                  ? t.creasedim
                  : isSolo
                    ? t.amberdim
                    : rowHover
                      ? t.hover
                      : "transparent",
                opacity: dimmed ? 0.34 : visible || isSolo ? 1 : 0.55,
                transition: "background 140ms, border-color 140ms, opacity 140ms",
              }}
            >
              {isSolo && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 3,
                    bottom: 3,
                    width: 2,
                    background: t.amber,
                    borderRadius: 2,
                  }}
                />
              )}
              <span
                role="checkbox"
                aria-checked={visible}
                aria-label={layer.name}
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayer(layer);
                }}
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  cursor: "pointer",
                }}
              >
                {visible ? <CheckIcon /> : <UncheckIcon />}
              </span>
              <span
                aria-hidden
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 2,
                  flexShrink: 0,
                  background: visible ? color : "transparent",
                  border: visible ? "1px solid rgba(255,255,255,.25)" : `1px solid ${color}`,
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 13,
                  color: visible || isSolo ? t.text : t.text3,
                }}
              >
                {layer.name}
              </span>
              {isSolo && (
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 8.5,
                    letterSpacing: "0.1em",
                    color: t.amber,
                    border: `1px solid ${t.amberborder}`,
                    borderRadius: 2,
                    padding: "1px 4px",
                    flexShrink: 0,
                  }}
                >
                  SOLO
                </span>
              )}
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: t.text3,
                  flexShrink: 0,
                  fontFeatureSettings: '"tnum" 1',
                }}
              >
                {layer.entityCount}
              </span>
            </li>
          );
        })}
      </ul>

      {hints && (
        <div
          style={{
            flexShrink: 0,
            padding: "11px 14px 13px",
            borderTop: `1px solid ${t.hairline}`,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "5px 10px",
            alignItems: "baseline",
          }}
        >
          {DESKTOP_HINTS.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 9.5,
                  letterSpacing: "0.06em",
                  color: t.text2,
                  whiteSpace: "nowrap",
                }}
              >
                {k}
              </span>
              <span style={{ fontSize: 11, color: t.text3 }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
