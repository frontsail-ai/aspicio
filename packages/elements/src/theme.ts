import { css, unsafeCSS } from "lit";
import type { CSSResult } from "lit";

/** Whether the ready-made elements style themselves at all. */
export type AspicioTheme = "aspicio" | "none";

/** Which palette a styled element uses (ELEM-10). */
export type AspicioThemeMode = "dark" | "light";

/**
 * Design tokens lifted from the Aspicio demo app, exposed as CSS custom
 * properties so hosts can override any of them:
 *
 *   aspicio-embed { --aspicio-crease: hotpink; }
 *
 * Font stacks only — the theme never loads webfonts itself. Load IBM Plex
 * in the host page for the exact demo look; otherwise these degrade to
 * system faces.
 *
 * This object is the single source for the CSS below: the declarations are
 * generated from it rather than hand-copied beside it, because they were
 * hand-copied beside it and the two drifted the moment a token was added.
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
  // 4.8:1 on the canvas and 4.6:1 on the panel. The shipped #6a707b was
  // 3.6:1 / 3.4:1 — under AA for body text, and it is used at 9.5-11px.
  text3: "#7f858f",
  crease: "#4c8dff",
  creasedim: "rgba(76,141,255,.16)",
  amber: "#e0a82e",
  amberdim: "rgba(224,168,46,.16)",
  amberborder: "rgba(224,168,46,.4)",
  /** Everything outside the paper. The darkest region after the app frame. */
  surround: "#0d0f13",
  gridMinor: "rgba(255,255,255,.028)",
  gridMajor: "rgba(255,255,255,.05)",
  fontSans: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  fontMono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/** Every token name, with values free to differ per palette. */
export type AspicioTokens = Record<keyof typeof aspicioTokens, string>;

/**
 * The light palette. Same names, same intent — not the dark one inverted.
 *
 * `text` is a deliberately warm off-white, so its counterpart is a warm
 * near-black rather than a blue-black; no chrome surface goes above #f7f5f1,
 * which is reserved for raised panels. Accents move because they have to:
 * #4c8dff is 3.2:1 on light chrome and #e0a82e is 1.8:1, both below AA.
 *
 * `sheet` is the one token that does not change. In light mode the only pure
 * white on screen is the paper, which is what keeps it reading as a discrete
 * object on a surface rather than merging into the chrome around it.
 */
export const aspicioLightTokens: AspicioTokens = {
  bg: "#e6e3dd",
  canvas: "#dcd8d1",
  panel: "#efece6",
  panel2: "#f7f5f1",
  hover: "rgba(0,0,0,.05)",
  hairline: "#dbd6cd",
  hairline2: "#b6b0a5",
  text: "#1c1a17",
  text2: "#3f3c36",
  text3: "#605c54",
  crease: "#1a63d8",
  creasedim: "rgba(26,99,216,.12)",
  amber: "#8a6209",
  amberdim: "rgba(138,98,9,.14)",
  amberborder: "rgba(138,98,9,.4)",
  // Strictly neutral while the chrome stays warm: this is the only surface
  // that borders artwork, and at L*~79 it is bright enough to shift an
  // adjacent hue by simultaneous contrast. A dark surround contributes no
  // chromatic adaptation at all, which is why only this one is forced grey.
  surround: "#c4c4c4",
  gridMinor: "rgba(0,0,0,.035)",
  gridMajor: "rgba(0,0,0,.065)",
  fontSans: aspicioTokens.fontSans,
  fontMono: aspicioTokens.fontMono,
};

/**
 * Canvas colours the *renderer* needs as numbers rather than CSS.
 *
 * The sheet is WebGL geometry, not a DOM surface, so it cannot come from a
 * custom property. Deriving both from one palette keeps the paper on the
 * canvas and the paper in the CSS from drifting apart.
 */
export interface AspicioCanvasColors {
  /** Paper under a bounded space. White in both palettes: in a PDF the sheet
   * is the *unpainted* region, so a tint would make 0/0/0/0 white artwork
   * show as a rectangle against the paper it is meant to match. */
  sheet: number;
  /** Sheet boundary, or null when contrast alone carries it. */
  sheetEdge: number | null;
  /** Selection over an unbounded canvas, and over paper (VIEW-8). */
  select: number;
  selectOnSheet: number;
  /** Canvas that DXF pen colours must stay legible against (VIEW-18). */
  legibleOn?: number;
  /** What a hueless pen darkens towards under `legibleOn`. */
  ink?: number;
}

export const aspicioCanvasColors: Record<AspicioThemeMode, AspicioCanvasColors> = {
  dark: {
    sheet: 0xffffff,
    // 19:1 against the surround already carries the boundary; a hairline is
    // lost in either the white or the void.
    sheetEdge: null,
    select: 0x8fc8ff,
    selectOnSheet: 0x2b78c8,
  },
  light: {
    sheet: 0xffffff,
    // 1.75:1 here, so contrast cannot carry the boundary on its own.
    sheetEdge: 0xa8a8a8,
    // #8fc8ff is 1.25:1 on this canvas — invisible. One value serves both
    // surfaces in light mode.
    select: 0x2b78c8,
    selectOnSheet: 0x2b78c8,
    legibleOn: 0xdcd8d1,
    ink: 0x1c1a17,
  },
};

/** `fontSans` → `--aspicio-font-sans`. */
const cssName = (key: string): string =>
  `--aspicio-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const declarations = (tokens: AspicioTokens): CSSResult =>
  unsafeCSS(
    Object.entries(tokens)
      .map(([key, value]) => `${cssName(key)}: ${value};`)
      .join("\n    "),
  );

/**
 * Custom-property declarations with token defaults. Included in every
 * element's static styles so `var(--aspicio-*)` always resolves, while a
 * host-page rule on the element (or any ancestor, via inheritance) wins.
 *
 * Dark is the bare `:host` rule so an element with no mode set keeps
 * rendering exactly as it always has.
 */
export const tokenStyles = css`
  :host {
    ${declarations(aspicioTokens)}
  }

  :host([theme-mode="light"]) {
    ${declarations(aspicioLightTokens)}
  }
`;

/**
 * The blueprint grid, drawn behind a transparent canvas.
 *
 * `.page-mode` drops it. The grid's job is parallax and scale feedback in
 * unbounded model space; a bounded page already provides both, and keeping
 * it would run a repeating pattern up to the one line the reader has to
 * trust — the sheet edge — and put it beside artwork being colour-judged.
 */
export const canvasBackgroundStyles = css`
  .canvas-grid {
    background-color: var(--aspicio-canvas);
    background-image:
      linear-gradient(var(--aspicio-grid-minor) 1px, transparent 1px),
      linear-gradient(90deg, var(--aspicio-grid-minor) 1px, transparent 1px),
      linear-gradient(var(--aspicio-grid-major) 1px, transparent 1px),
      linear-gradient(90deg, var(--aspicio-grid-major) 1px, transparent 1px);
    background-size:
      26px 26px,
      26px 26px,
      130px 130px,
      130px 130px;
  }

  .canvas-grid.page-mode {
    background-color: var(--aspicio-surround);
    background-image: none;
  }
`;
