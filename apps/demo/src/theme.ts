/**
 * Light/dark theme for the demo (DEMO-22).
 *
 * The palettes themselves live in CSS (`style.css`, keyed off
 * `:root[data-theme]`); this module only decides which one is active and
 * remembers the choice. The canvas is the exception: the sheet a PDF page is
 * drawn on is WebGL geometry, not a DOM surface, so its colour cannot come
 * from a custom property and is handed to the viewer as a number instead.
 */

export type ThemeMode = "dark" | "light";

const KEY = "aspicio:theme";

/**
 * Canvas colours the renderer needs as numbers rather than CSS.
 *
 * `legibleOn` is the canvas a DXF pen colour is judged against; omitted in
 * the dark theme, where the ACI palette was designed to be read on black.
 */
export const canvasColors: Record<
  ThemeMode,
  {
    sheet: number;
    sheetEdge: number | null;
    select: number;
    selectOnSheet: number;
    legibleOn?: number;
    ink?: number;
  }
> = {
  dark: {
    sheet: 0xffffff,
    // Sheet-to-surround is 19:1 here, so the boundary carries itself; a
    // hairline is lost in either the white or the void.
    sheetEdge: null,
    select: 0x8fc8ff,
    selectOnSheet: 0x2b78c8,
  },
  light: {
    sheet: 0xffffff,
    // 1.75:1 here, where contrast alone cannot carry it.
    sheetEdge: 0xa8a8a8,
    // #8fc8ff is 1.25:1 on the light canvas — a selection nobody can see.
    select: 0x2b78c8,
    selectOnSheet: 0x2b78c8,
    legibleOn: 0xdcd8d1,
    ink: 0x1c1a17,
  },
};

/** The browser store, or null when it's unavailable (private mode, SSR, tests). */
function defaultStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isMode = (v: unknown): v is ThemeMode => v === "dark" || v === "light";

/**
 * The visitor's stored theme, or dark when they have not chosen.
 *
 * Deliberately not `prefers-color-scheme`: this is a drawing tool whose
 * canvas has always been dark, and inheriting the OS setting would flip the
 * look of a returning visitor's drawings without them asking.
 */
export function loadTheme(store: Storage | null = defaultStore()): ThemeMode {
  if (!store) return "dark";
  try {
    const raw = store.getItem(KEY);
    return isMode(raw) ? raw : "dark";
  } catch {
    return "dark";
  }
}

/** Remember the choice; storage failures are not worth breaking a click over. */
export function saveTheme(mode: ThemeMode, store: Storage | null = defaultStore()): void {
  try {
    store?.setItem(KEY, mode);
  } catch {
    // Private mode or a full quota: the theme still applies for this session.
  }
}

/** Apply a theme to the document. The CSS keys off `data-theme`. */
export function applyTheme(mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = mode;
}
