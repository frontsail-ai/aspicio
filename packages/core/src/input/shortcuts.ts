/** The subset of the viewer that keyboard shortcuts drive directly. */
export interface ShortcutViewer {
  fitView(options?: { animate?: boolean }): void;
  zoomBy(factor: number, options?: { animate?: boolean }): void;
  resetRotation(options?: { animate?: boolean }): void;
}

/**
 * App-level actions the shortcut layer can't perform on its own (they depend
 * on selection or app UI). Any left undefined simply does nothing.
 */
export interface ShortcutHandlers {
  /** Gate: shortcuts are ignored when this returns false. */
  isEnabled?: () => boolean;
  /** M — toggle the measure tool. */
  onToggleMeasure?: () => void;
  /** A — show all layers. */
  onShowAll?: () => void;
  /** I — isolate the selected entity's layer. */
  onIsolate?: () => void;
  /** H — hide the selected entity's layer. */
  onHide?: () => void;
  /** C — copy the selection to the clipboard. */
  onCopy?: () => void;
  /** ? — toggle a shortcuts cheat sheet. */
  onToggleHelp?: () => void;
  /** Escape — cancel the current interaction. */
  onEscape?: () => void;
}

/**
 * Attach keyboard shortcuts to a target (window or a focusable element).
 * Camera keys drive the viewer directly — `F` fit, `+`/`-` zoom, `R` reset
 * rotation; the rest delegate to `handlers`. Ignores key repeats, modifier
 * combos (so browser shortcuts still work), and typing into form fields.
 * Returns a detach function.
 */
export function attachShortcuts(
  target: Window | HTMLElement,
  viewer: ShortcutViewer,
  handlers: ShortcutHandlers = {},
): () => void {
  const run = (fn?: () => void): boolean => {
    if (!fn) return false;
    fn();
    return true;
  };

  const onKey = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (e.repeat) return;
    if (handlers.isEnabled && !handlers.isEnabled()) return;
    // Leave browser combos (Cmd/Ctrl/Alt) and text entry alone.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    let handled = true;
    switch (e.key) {
      case "f":
      case "F":
        viewer.fitView({ animate: true });
        break;
      case "+":
      case "=":
        viewer.zoomBy(1.25, { animate: true });
        break;
      case "-":
      case "_":
        viewer.zoomBy(0.8, { animate: true });
        break;
      case "r":
      case "R":
        viewer.resetRotation({ animate: true });
        break;
      case "m":
      case "M":
        handled = run(handlers.onToggleMeasure);
        break;
      case "a":
      case "A":
        handled = run(handlers.onShowAll);
        break;
      case "i":
      case "I":
        handled = run(handlers.onIsolate);
        break;
      case "h":
      case "H":
        handled = run(handlers.onHide);
        break;
      case "c":
      case "C":
        handled = run(handlers.onCopy);
        break;
      case "?":
        handled = run(handlers.onToggleHelp);
        break;
      case "Escape":
        handled = run(handlers.onEscape);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
