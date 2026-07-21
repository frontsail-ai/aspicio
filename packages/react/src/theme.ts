import type { CSSProperties } from "react";

/** Visual theme for the ready-made components. */
export type { DxfTheme } from "@aspicio/elements";

/**
 * Design tokens lifted from the Aspicio demo app. The elements underneath
 * expose the same values as `--aspicio-*` CSS custom properties — override
 * those to retheme; this object remains for hosts that build their own
 * chrome around the components.
 */
export { aspicioTokens } from "@aspicio/elements";

/**
 * The demo app's blueprint grid, drawn behind a transparent canvas.
 * <DxfEmbed> paints this internally; the export remains for hosts
 * composing DxfPreview into their own themed layouts.
 */
export const aspicioCanvasBackground: CSSProperties = {
  background: "#16181d",
  backgroundImage: [
    "linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px)",
    "linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px)",
    "linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)",
  ].join(", "),
  backgroundSize: "26px 26px, 26px 26px, 130px 130px, 130px 130px",
};
