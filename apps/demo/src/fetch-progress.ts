/**
 * Stream a remote DXF into an ArrayBuffer while reporting byte/percent progress.
 *
 * The browser deliberately collapses "cross-origin blocked", "DNS failure" and
 * "offline" into one opaque `TypeError` — so a network failure can't truthfully
 * be called a CORS error. We classify only what's observable: a failed
 * `fetch()` (network), a non-OK response (http, with status), or a rejected
 * scheme. The caller words its guidance accordingly.
 */

export type FetchErrorKind = "scheme" | "network" | "http";

export class FetchError extends Error {
  readonly kind: FetchErrorKind;
  readonly status?: number;

  constructor(message: string, kind: FetchErrorKind, status?: number) {
    super(message);
    this.name = "FetchError";
    this.kind = kind;
    this.status = status;
  }
}

export interface FetchProgress {
  /** Bytes received so far. */
  loaded: number;
  /** Total bytes from Content-Length, or null when the server didn't declare it. */
  total: number | null;
}

export interface FetchOptions {
  onProgress?: (p: FetchProgress) => void;
  signal?: AbortSignal;
}

/** True for a well-formed absolute http(s) URL — the only scheme we'll fetch. */
export function isHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

export async function fetchWithProgress(
  url: string,
  opts: FetchOptions = {},
): Promise<ArrayBuffer> {
  if (!isHttpUrl(url)) throw new FetchError("Enter a full http(s):// URL", "scheme");

  let res: Response;
  try {
    res = await fetch(url, { signal: opts.signal });
  } catch (e) {
    if (isAbort(e)) throw e; // a user cancel, not a failure — let it propagate
    throw new FetchError("Couldn't reach that URL", "network");
  }

  if (!res.ok) throw new FetchError(`Server responded ${res.status}`, "http", res.status);

  const declared = Number(res.headers.get("content-length"));
  const total = Number.isFinite(declared) && declared > 0 ? declared : null;

  // No readable stream (older engines, some proxies): fall back to a whole-buffer
  // read. Still correct — we just can't report intermediate progress.
  if (!res.body) {
    const buf = await res.arrayBuffer();
    opts.onProgress?.({ loaded: buf.byteLength, total });
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  opts.onProgress?.({ loaded: 0, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      opts.onProgress?.({ loaded, total });
    }
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
