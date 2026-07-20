import { VIEWER_META_KEY, type ViewerMeta } from "./meta.ts";

/** What the widget should do with a received tool result (pure — the DOM and
 * viewer wiring in main.ts stays a thin shell around this). */
export type ViewerAction =
  | { kind: "load"; bytes: ArrayBuffer; byteLength: number; allowFilePicker: boolean }
  | { kind: "too-large"; byteLength: number }
  | { kind: "missing" };

export function actionForToolResult(result: { _meta?: Record<string, unknown> }): ViewerAction {
  const meta = result._meta?.[VIEWER_META_KEY] as ViewerMeta | undefined;
  if (!meta) return { kind: "missing" };
  if (meta.dxfBase64 === undefined) return { kind: "too-large", byteLength: meta.byteLength };
  return {
    kind: "load",
    bytes: base64ToBytes(meta.dxfBase64),
    byteLength: meta.byteLength,
    allowFilePicker: meta.allowFilePicker === true,
  };
}

export function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
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
