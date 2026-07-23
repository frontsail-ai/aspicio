/**
 * Recently opened DXF URLs, persisted in localStorage for the "From URL" tab.
 * Storage is injectable so the pure list logic stays testable without a DOM,
 * and every access is guarded — private-mode browsers throw on `localStorage`.
 */

export interface RecentUrl {
  /** The absolute http(s) URL that was loaded. */
  url: string;
  /** Filename derived from the URL, shown in the list. */
  name: string;
  /** Byte size of the fetched drawing, or null when it wasn't known. */
  size: number | null;
  /** Epoch ms of the load, used only for newest-first ordering. */
  ts: number;
}

const KEY = "aspicio.recentUrls";
const CAP = 5;

/** Prepend `entry`, drop any earlier copy of the same URL, and cap the list. */
export function mergeRecent(list: RecentUrl[], entry: RecentUrl, cap = CAP): RecentUrl[] {
  return [entry, ...list.filter((r) => r.url !== entry.url)].slice(0, cap);
}

function isRecent(x: unknown): x is RecentUrl {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as RecentUrl).url === "string" &&
    typeof (x as RecentUrl).name === "string"
  );
}

/** The browser store, or null when it's unavailable (private mode, SSR, tests). */
function defaultStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadRecents(store: Storage | null = defaultStore()): RecentUrl[] {
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, CAP);
  } catch {
    return [];
  }
}

export function pushRecent(entry: RecentUrl, store: Storage | null = defaultStore()): RecentUrl[] {
  const next = mergeRecent(loadRecents(store), entry);
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or private-mode failure — the in-memory list is still returned.
  }
  return next;
}

export function clearRecents(store: Storage | null = defaultStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // Nothing to do — a store that can't remove also can't have persisted.
  }
}
