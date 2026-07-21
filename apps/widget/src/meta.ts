/**
 * The wire contract between the api Worker's `view_dxf` tool and this widget
 * (AGT-14). The server imports this module via `@aspicio/widget/meta`, so the
 * two sides cannot drift.
 *
 * Delivery has two paths. Small drawings ride inside the tool result's
 * `_meta`. Anything larger is *pulled by the widget* through an app-only
 * tool: hosts cap inline tool results (claude.ai diverts results beyond
 * ~150K characters away from the widget entirely), so pushing big payloads
 * through the result notification is not deliverable.
 */

/** Key of the widget payload inside the tool result's `_meta`. Per the MCP
 * Apps spec, `_meta` reaches the widget but never the model. */
export const VIEWER_META_KEY = "aspicio/viewer";

/** URI of the viewer UI resource the `view_dxf` tool definition points at.
 * Also the host's cache key — version it on breaking widget changes. */
export const VIEWER_RESOURCE_URI = "ui://aspicio/viewer.html";

/** Embed-in-result ceiling: stay well under claude.ai's ~150K-character
 * inline tool-result cap after base64 (+ summary + envelope). */
export const INLINE_EMBED_BYTES = 64 * 1024;

/** App-only tool (hidden from the model) the widget calls to pull the
 * drawing when it wasn't embedded. */
export const LOAD_TOOL_NAME = "load_dxf_for_viewer";

/** Chunk size (raw bytes) for the pull fallback when a single response is
 * capped. Sized so an 8 MB drawing needs at most ~6 rate-limited calls. */
export const LOAD_CHUNK_BYTES = 1_500_000;

export interface ViewerMeta {
  /** Base64 DXF bytes; present only when the drawing fits the embed cap. */
  dxfBase64?: string;
  /** http(s) source the widget may pull via {@link LOAD_TOOL_NAME}. Present
   * when the drawing was too large to embed but is refetchable. */
  source?: string;
  /** Set when the drawing can be neither embedded nor pulled (an inline
   * text source beyond the embed cap). */
  tooLarge?: boolean;
  /** Size of the full DXF in bytes. */
  byteLength: number;
  /** Server-driven gate: only when true may the widget offer controls to
   * open files other than the one delivered in this result (AGT-14). */
  allowFilePicker: boolean;
}

/** structuredContent shape of a {@link LOAD_TOOL_NAME} response. */
export interface LoadResult {
  /** Base64 of the requested byte range (or the whole file). */
  dxfBase64: string;
  /** Total size of the full DXF in bytes. */
  byteLength: number;
  /** Byte offset this response starts at. */
  offset: number;
}
