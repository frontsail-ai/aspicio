/**
 * Analytics consent for the demo, persisted in localStorage.
 *
 * The storage shape is deliberately tiny — one of two literal strings — because
 * it is read by the analytics bootstrap before anything else runs. Storage is
 * injectable so the logic stays testable without a DOM, and every access is
 * guarded: private-mode browsers throw on `localStorage`.
 *
 * Absence of a stored value is meaningful. It means "not asked yet", which is
 * what raises the banner; it is never treated as consent (DEMO-19).
 */

/** The visitor's answer to the consent banner. */
export type ConsentChoice = "granted" | "denied";

const KEY = "aspicio.analyticsConsent";

function isChoice(x: unknown): x is ConsentChoice {
  return x === "granted" || x === "denied";
}

/** The browser store, or null when it's unavailable (private mode, SSR, tests). */
function defaultStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The stored choice, or null when the visitor has not answered yet. Anything
 * unrecognised in storage reads as null, so a corrupted value re-asks rather
 * than silently granting.
 */
export function loadConsent(store: Storage | null = defaultStore()): ConsentChoice | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    return isChoice(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the visitor's choice. A store that refuses to write is not fatal. */
export function saveConsent(
  choice: ConsentChoice,
  store: Storage | null = defaultStore(),
): ConsentChoice {
  try {
    store?.setItem(KEY, choice);
  } catch {
    // Quota or private-mode failure — the choice still applies to this page
    // view, it just won't survive a reload, so the banner asks again.
  }
  return choice;
}

/** Forget the choice, so the banner asks again. Used by tests and manual QA. */
export function clearConsent(store: Storage | null = defaultStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // A store that can't remove also can't have persisted.
  }
}
