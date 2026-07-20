/**
 * The wire contract between the api Worker's `view_dxf` tool and this widget
 * (AGT-14). The server imports this module via `@aspicio/widget/meta`, so the
 * two sides cannot drift.
 */

/** Key of the widget payload inside the tool result's `_meta`. Per the MCP
 * Apps spec, `_meta` reaches the widget but never the model. */
export const VIEWER_META_KEY = "aspicio/viewer";

/** URI of the viewer UI resource the `view_dxf` tool definition points at.
 * Also the host's cache key — version it on breaking widget changes. */
export const VIEWER_RESOURCE_URI = "ui://aspicio/viewer.html";

/** Drawings larger than this arrive as facts only, never as embedded bytes
 * (the transport is a chat message; multi-MB payloads degrade hosts). */
export const MAX_EMBED_BYTES = 4 * 1024 * 1024;

export interface ViewerMeta {
  /** Base64-encoded DXF bytes (ASCII or binary DXF). Absent when the
   * drawing exceeds {@link MAX_EMBED_BYTES}. */
  dxfBase64?: string;
  /** Set when the drawing was too large to embed. */
  tooLarge?: boolean;
  /** Size of the original DXF in bytes. */
  byteLength: number;
  /** Server-driven gate: only when true may the widget offer controls to
   * open files other than the one delivered in this result (AGT-14). */
  allowFilePicker: boolean;
}
