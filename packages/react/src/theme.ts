import type { CSSProperties } from "react";

/** Visual theme for the ready-made components. */
export type DxfTheme = "observo" | "none";

/** Design tokens lifted from the Observo demo app. */
export const observoTokens = {
  bg: "#0f1115",
  canvas: "#16181d",
  panel: "#191c22",
  hover: "rgba(255,255,255,.055)",
  hairline: "#282c34",
  hairline2: "#3a3f4a",
  text: "#e7e3da",
  text2: "#9aa0ab",
  text3: "#6a707b",
  crease: "#4c8dff",
  /*
   * Font stacks only — the theme never loads webfonts itself. Load IBM Plex
   * in the host page for the exact demo look; otherwise these degrade to
   * system faces.
   */
  fontSans: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontMono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/** The demo app's blueprint grid, drawn behind a transparent canvas. */
export const observoCanvasBackground: CSSProperties = {
  background: observoTokens.canvas,
  backgroundImage: [
    "linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px)",
    "linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)",
  ].join(", "),
  backgroundSize: "26px 26px, 26px 26px, 130px 130px, 130px 130px",
};
