import { css } from "lit";

/** Visual theme for the ready-made elements. */
export type DxfTheme = "aspicio" | "none";

/**
 * Design tokens lifted from the Aspicio demo app, exposed as CSS custom
 * properties so hosts can override any of them:
 *
 *   aspicio-embed { --aspicio-crease: hotpink; }
 *
 * Font stacks only — the theme never loads webfonts itself. Load IBM Plex
 * in the host page for the exact demo look; otherwise these degrade to
 * system faces.
 */
export const aspicioTokens = {
  bg: "#0f1115",
  canvas: "#16181d",
  panel: "#191c22",
  panel2: "#1f232b",
  hover: "rgba(255,255,255,.055)",
  hairline: "#282c34",
  hairline2: "#3a3f4a",
  text: "#e7e3da",
  text2: "#9aa0ab",
  text3: "#6a707b",
  crease: "#4c8dff",
  creasedim: "rgba(76,141,255,.16)",
  amber: "#e0a82e",
  amberdim: "rgba(224,168,46,.16)",
  amberborder: "rgba(224,168,46,.4)",
  fontSans: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontMono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/**
 * Custom-property declarations with token defaults. Included in every
 * element's static styles so `var(--aspicio-*)` always resolves, while a
 * host-page rule on the element (or any ancestor, via inheritance) wins.
 */
export const tokenStyles = css`
  :host {
    --aspicio-bg: #0f1115;
    --aspicio-canvas: #16181d;
    --aspicio-panel: #191c22;
    --aspicio-panel2: #1f232b;
    --aspicio-hover: rgba(255, 255, 255, 0.055);
    --aspicio-hairline: #282c34;
    --aspicio-hairline2: #3a3f4a;
    --aspicio-text: #e7e3da;
    --aspicio-text2: #9aa0ab;
    --aspicio-text3: #6a707b;
    --aspicio-crease: #4c8dff;
    --aspicio-creasedim: rgba(76, 141, 255, 0.16);
    --aspicio-amber: #e0a82e;
    --aspicio-amberdim: rgba(224, 168, 46, 0.16);
    --aspicio-amberborder: rgba(224, 168, 46, 0.4);
    --aspicio-font-sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --aspicio-font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  }
`;

/** The demo app's blueprint grid, drawn behind a transparent canvas. */
export const canvasBackgroundStyles = css`
  .canvas-grid {
    background-color: var(--aspicio-canvas);
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px),
      linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
    background-size:
      26px 26px,
      26px 26px,
      130px 130px,
      130px 130px;
  }
`;
