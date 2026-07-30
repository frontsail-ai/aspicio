/**
 * The OpenAPI 3.1 description of this API — the universal adapter that lets
 * OpenAPI-speaking platforms (ChatGPT Actions, Gemini/Grok function calling,
 * no-code agent builders) generate tools from these endpoints without
 * per-platform work. Served at /openapi.json.
 */

const errorResponse = (description: string): object => ({
  description,
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
});

const dxfSourceDescription =
  "Publicly reachable http(s) URL of a .dxf file (ASCII or binary DXF). " +
  "Alternatively, POST the DXF file itself as the request body and omit this parameter.";

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Aspicio DXF and PDF API",
    version: "1.0.0",
    description:
      "Inspect and render drawings — DXF/CAD and the vector content of PDF. A `describe` " +
      "returns structured JSON facts (the format read, layers with the colors actually drawn, " +
      "units, bounds, entity counts, text content); a `render` returns the drawing as a PNG or " +
      "SVG image. `/describe` and `/render` read DXF only, `/describe-pdf` and `/render-pdf` " +
      "read PDF only, and `/describe-doc` and `/render-doc` accept either and detect the format " +
      "from the bytes; a typed endpoint handed the wrong format answers 422 naming the one that " +
      "would have worked. A PDF render shows vector line work and text, not a page facsimile. " +
      "Input is a fetched `src` URL or the file POSTed as the request body. Drawing endpoints " +
      "are rate-limited per client IP.",
    license: { name: "MIT", url: "https://github.com/frontsail-ai/aspicio/blob/master/LICENSE" },
  },
  // Placeholder — the handler overwrites `servers` with the origin that
  // actually served the request (the API answers on several domains).
  servers: [{ url: "https://aspicio-api.frontsail.app" }],
  // Deliberately public: no authentication. Declared explicitly so importers
  // (ChatGPT Actions, generators) treat it as auth "none".
  security: [],
  paths: {
    "/describe": {
      get: {
        operationId: "describeDxf",
        summary: "Describe a DXF drawing as structured JSON",
        description:
          "Returns units, bounds and size, entity and segment counts, per-layer entries with " +
          "the color actually drawn, per-type entity counts, skipped (unsupported) types, and " +
          "the drawing's text content (title blocks and dimension values included). " +
          "Use for structural questions — layers, counts, dimensions, what the drawing says.",
        parameters: [
          {
            name: "src",
            in: "query",
            required: true,
            description: dxfSourceDescription,
            schema: { type: "string", format: "uri" },
          },
        ],
        responses: {
          "200": {
            description: "Structured summary of the drawing",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/DrawingSummary" } },
            },
          },
          "400": errorResponse("Bad input (missing/invalid src, private address refused)"),
          "413": errorResponse("DXF exceeds the 8 MB limit"),
          "422": errorResponse("The file could not be parsed as DXF"),
          "429": errorResponse("Rate limit exceeded (per client IP)"),
          "502": errorResponse("Fetching the src URL failed"),
        },
      },
      post: {
        operationId: "describeDxfUpload",
        summary: "Describe an uploaded DXF drawing",
        description: "Same as GET /describe, but the DXF file is the request body.",
        requestBody: {
          required: true,
          content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
        },
        responses: {
          "200": {
            description: "Structured summary of the drawing",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/DrawingSummary" } },
            },
          },
          "400": errorResponse("Empty request body"),
          "413": errorResponse("DXF exceeds the 8 MB limit"),
          "422": errorResponse("The file could not be parsed as DXF"),
          "429": errorResponse("Rate limit exceeded (per client IP)"),
        },
      },
    },
    "/render": {
      get: {
        operationId: "renderDxf",
        summary: "Render a DXF drawing to an image",
        description:
          "Returns the whole drawing as a PNG (default) or SVG. " +
          "Use for visual questions — what the drawing looks like. " +
          "For measurements and structure, prefer /describe (never measure pixels).",
        parameters: [
          {
            name: "src",
            in: "query",
            required: true,
            description: dxfSourceDescription,
            schema: { type: "string", format: "uri" },
          },
          { $ref: "#/components/parameters/format" },
          { $ref: "#/components/parameters/width" },
          { $ref: "#/components/parameters/bg" },
        ],
        responses: {
          "200": {
            description: "The rendered image",
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/svg+xml": { schema: { type: "string" } },
            },
          },
          "400": errorResponse("Bad input (src, format, or bg invalid)"),
          "413": errorResponse("DXF exceeds the 8 MB limit"),
          "422": errorResponse("The file could not be parsed as DXF"),
          "429": errorResponse("Rate limit exceeded (per client IP)"),
          "502": errorResponse("Fetching the src URL failed"),
        },
      },
      post: {
        operationId: "renderDxfUpload",
        summary: "Render an uploaded DXF drawing to an image",
        description: "Same as GET /render, but the DXF file is the request body.",
        parameters: [
          { $ref: "#/components/parameters/format" },
          { $ref: "#/components/parameters/width" },
          { $ref: "#/components/parameters/bg" },
        ],
        requestBody: {
          required: true,
          content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
        },
        responses: {
          "200": {
            description: "The rendered image",
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/svg+xml": { schema: { type: "string" } },
            },
          },
          "400": errorResponse("Bad input (format or bg invalid, empty body)"),
          "413": errorResponse("DXF exceeds the 8 MB limit"),
          "422": errorResponse("The file could not be parsed as DXF"),
          "429": errorResponse("Rate limit exceeded (per client IP)"),
        },
      },
    },
    "/health": {
      get: {
        operationId: "health",
        summary: "Health check",
        responses: {
          "200": {
            description: "The service is up",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string", const: "ok" } },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      format: {
        name: "format",
        in: "query",
        description: "Image format (default png)",
        schema: { type: "string", enum: ["png", "svg"], default: "png" },
      },
      width: {
        name: "width",
        in: "query",
        description: "PNG width in pixels (default 1200)",
        schema: { type: "integer", minimum: 1, maximum: 4000, default: 1200 },
      },
      bg: {
        name: "bg",
        in: "query",
        description:
          'Background: a hex color like "#16181d" (URL-encode the #), or "none" for transparent. Default dark slate.',
        schema: { type: "string", pattern: "^(#[0-9a-fA-F]{3,8}|none)$", default: "#16181d" },
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string", description: "Human-readable failure reason" } },
      },
      LayerSummary: {
        type: "object",
        required: ["name", "entityCount", "visible", "color"],
        properties: {
          name: { type: "string" },
          entityCount: { type: "integer" },
          visible: { type: "boolean" },
          color: {
            type: "string",
            description:
              "The color actually drawn on this layer (entity overrides included), #rrggbb",
          },
        },
      },
      DrawingSummary: {
        type: "object",
        required: [
          "format",
          "units",
          "bounds",
          "size",
          "entityCount",
          "segmentCount",
          "layers",
          "entityTypes",
          "unsupported",
        ],
        properties: {
          format: {
            type: "string",
            description: 'Which format was read ("dxf", "pdf")',
          },
          units: {
            type: "string",
            description: 'Drawing unit label ("mm", "in", …) or "" when unitless',
          },
          bounds: {
            oneOf: [
              {
                type: "object",
                required: ["minX", "minY", "maxX", "maxY"],
                properties: {
                  minX: { type: "number" },
                  minY: { type: "number" },
                  maxX: { type: "number" },
                  maxY: { type: "number" },
                },
              },
              { type: "null" },
            ],
            description: "World-space extents, or null for an empty drawing",
          },
          size: {
            oneOf: [
              {
                type: "object",
                required: ["width", "height"],
                properties: { width: { type: "number" }, height: { type: "number" } },
              },
              { type: "null" },
            ],
            description: "Bounding-box size in drawing units",
          },
          entityCount: { type: "integer" },
          segmentCount: { type: "integer" },
          layers: { type: "array", items: { $ref: "#/components/schemas/LayerSummary" } },
          entityTypes: {
            type: "object",
            additionalProperties: { type: "integer" },
            description: "Top-level entities per DXF type",
          },
          unsupported: {
            type: "object",
            additionalProperties: { type: "integer" },
            description: "Per-type counts of skipped (unsupported) entities",
          },
          texts: {
            type: "array",
            items: { type: "string" },
            description:
              "Unique TEXT/MTEXT strings, including inside blocks reachable via inserts and dimensions (title blocks, dimension values)",
          },
        },
      },
    },
  },
} as const;

/**
 * The format-specific and format-agnostic endpoints (AGT-16).
 *
 * Generated from the DXF operations so the six stay in step — the only
 * differences are the path, the operation id, and which formats the wording
 * names.
 *
 * The rewrite walks *every* nested string, not just the operation's own
 * `summary` and `description`. It used to do only those two, which left every
 * generated PDF endpoint telling callers to pass "a .dxf file (ASCII or binary
 * DXF)" and answering 422 with "could not be parsed as DXF" — wrong guidance
 * in the document agent platforms import, on endpoints that only accept PDF.
 * A per-endpoint parity test now pins the invariant, because the shallow
 * version looked correct for as long as nobody read the generated output.
 */
type Operation = Record<string, unknown>;

/** Phrase rewrites per target, longest-context first: "DXF file" must match
 *  before the bare "DXF", or the qualifier is left stranded. */
const PHRASES: Record<string, readonly (readonly [RegExp, string])[]> = {
  PDF: [
    [/\ba \.dxf file \(ASCII or binary DXF\)/g, "a .pdf file"],
    [/\bDXF file\b/g, "PDF file"],
    [/\ba DXF\b/g, "a PDF"],
    [/\bDXF\b/g, "PDF"],
  ],
  drawing: [
    [
      /\ba \.dxf file \(ASCII or binary DXF\)/g,
      "a drawing file (DXF or PDF, detected from the bytes)",
    ],
    [/\bDXF file\b/g, "drawing file"],
    // "a DXF drawing" → "a drawing", not "a drawing drawing": the alternation
    // takes the first alternative that matches at a position, so every longer
    // context has to precede the shorter one it contains.
    [/\ba DXF drawing\b/g, "a drawing"],
    [/\bDXF drawing\b/g, "drawing"],
    [/\ba DXF\b/g, "a drawing"],
    [/\bparsed as DXF\b/g, "parsed as any supported format"],
    // Sentence-initial: the bare noun would read "drawing exceeds the 8 MB…".
    [/\bDXF exceeds\b/g, "The drawing exceeds"],
    [/\bDXF\b/g, "drawing"],
  ],
};

/**
 * Apply the phrases in a single pass.
 *
 * Chained `.replace()` calls re-scan their own output: the `.dxf file` rule
 * emits "(DXF or PDF, detected from the bytes)", which the later bare-`DXF`
 * rule then rewrote *inside* that replacement, producing "a drawing file
 * (drawing (DXF or PDF, detected from the bytes) or PDF, detected from the
 * bytes)". One alternation, matched left-to-right with the longest context
 * first, cannot re-enter what it just wrote.
 */
function applyPhrases(text: string, phrases: readonly (readonly [RegExp, string])[]): string {
  const combined = new RegExp(phrases.map(([pattern]) => `(?:${pattern.source})`).join("|"), "g");
  return text.replace(combined, (match) => {
    for (const [pattern, replacement] of phrases)
      if (new RegExp(`^(?:${pattern.source})$`).test(match)) return replacement;
    return match;
  });
}

/** Rewrite prose in place, wherever it sits in the operation tree. */
function rewriteProse(node: unknown, phrases: readonly (readonly [RegExp, string])[]): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteProse(item, phrases);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "description" || key === "summary") {
      if (typeof value === "string") record[key] = applyPhrases(value, phrases);
      continue;
    }
    rewriteProse(value, phrases);
  }
}

function retarget(path: Operation, suffix: string, target: "PDF" | "drawing"): Operation {
  const out: Operation = {};
  for (const [method, op] of Object.entries(path)) {
    const cloned = structuredClone(op) as Record<string, unknown>;
    if (typeof cloned["operationId"] === "string")
      cloned["operationId"] = `${cloned["operationId"]}${suffix}`;
    // `$ref`d components are shared by every endpoint, so they are never
    // rewritten — only the inline prose this operation owns.
    rewriteProse(cloned, PHRASES[target]);
    out[method] = cloned;
  }
  return out;
}

const describePath = openapi.paths["/describe"] as unknown as Operation;
const renderPath = openapi.paths["/render"] as unknown as Operation;

/** The published document, including the endpoints derived above. */
export const openapiDocument = {
  ...openapi,
  paths: {
    ...openapi.paths,
    "/describe-pdf": retarget(describePath, "Pdf", "PDF"),
    "/render-pdf": retarget(renderPath, "Pdf", "PDF"),
    "/describe-doc": retarget(describePath, "Doc", "drawing"),
    "/render-doc": retarget(renderPath, "Doc", "drawing"),
  },
};
