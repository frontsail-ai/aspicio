import { VIEWER_META_KEY, type ViewerMeta } from "./meta.ts";

/** What the widget should do with a received tool result (pure — the DOM and
 * viewer wiring in main.ts stays a thin shell around this). */
export type ViewerAction =
  | { kind: "load"; bytes: ArrayBuffer; byteLength: number; allowFilePicker: boolean }
  | { kind: "pull"; source: string; byteLength: number; allowFilePicker: boolean }
  | { kind: "too-large"; byteLength: number }
  | { kind: "missing" };

export function actionForToolResult(result: { _meta?: Record<string, unknown> }): ViewerAction {
  const meta = result._meta?.[VIEWER_META_KEY] as ViewerMeta | undefined;
  if (!meta) return { kind: "missing" };
  const allowFilePicker = meta.allowFilePicker === true;
  if (meta.dxfBase64 !== undefined)
    return {
      kind: "load",
      bytes: base64ToBytes(meta.dxfBase64),
      byteLength: meta.byteLength,
      allowFilePicker,
    };
  if (meta.source !== undefined)
    return { kind: "pull", source: meta.source, byteLength: meta.byteLength, allowFilePicker };
  return { kind: "too-large", byteLength: meta.byteLength };
}

export function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Join pulled chunks (each independently base64-decoded) into one buffer. */
export function concatChunks(chunks: Uint8Array[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}

/** 24-bit RGB number → CSS hex, for layer swatches. */
export function cssColor(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

/** "128 KB" under 1 MB, "7.0 MB" from there up (per the design spec). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The status chip line: "6 LAYERS · 128 KB" (singular-safe). */
export function statusChip(layerCount: number, byteLength: number): string {
  const layers = `${layerCount} LAYER${layerCount === 1 ? "" : "S"}`;
  return `${layers} · ${formatBytes(byteLength)}`;
}

/**
 * Display names for the layer list. Xref-qualified drawings repeat a long
 * machine prefix on most rows ("xref-Plan-08$0$A-WALL", …), drowning the
 * part that differs. When more than 3 names share a separator-terminated
 * prefix of 12+ characters, the shared prefix collapses to "…" in the
 * display name; the full name stays alongside for the tooltip.
 */
export function layerDisplayNames(names: string[]): { display: string; full: string }[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    for (let i = 11; i < name.length - 1; i++) {
      if ("$-_".includes(name[i]))
        counts.set(name.slice(0, i + 1), (counts.get(name.slice(0, i + 1)) ?? 0) + 1);
    }
  }
  return names.map((full) => {
    // A row that IS a group's shared prefix (the xref root) stays verbatim —
    // stripping it by a shorter prefix would leave a meaningless stub.
    if ((counts.get(full) ?? 0) > 3) return { full, display: full };
    let best = "";
    for (const [prefix, n] of counts) {
      if (
        n > 3 &&
        prefix.length > best.length &&
        full.length > prefix.length &&
        full.startsWith(prefix)
      ) {
        best = prefix;
      }
    }
    return { full, display: best ? `…${full.slice(best.length)}` : full };
  });
}
