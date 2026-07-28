/**
 * The one parse-failure type, shared by every format (PARSE-12, PARSE-13).
 *
 * Messages are phrased for a person and shown directly by callers on every
 * surface (viewer, API, MCP); a library's own internals never reach here.
 * `format` names the parser that claimed a file and then rejected it, so a
 * caller can report the culprit without matching on message text — it is
 * undefined when no parser claimed the input at all.
 */
export class DrawingParseError extends Error {
  readonly format?: string;

  constructor(message: string, format?: string) {
    super(message);
    this.name = "DrawingParseError";
    this.format = format;
  }
}
