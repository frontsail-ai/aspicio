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
    title: "Aspicio DXF API",
    version: "1.0.0",
    description:
      "Inspect and render DXF/CAD drawings. `describe` returns structured JSON facts " +
      "(layers with the colors actually drawn, units, bounds, entity counts, text content); " +
      "`render` returns the drawing as a PNG or SVG image. " +
      "Input is a fetched `src` URL or the DXF file POSTed as the request body. " +
      "DXF endpoints are rate-limited per client IP.",
    license: { name: "MIT", url: "https://github.com/frontsail-ai/aspicio/blob/master/LICENSE" },
  },
  servers: [{ url: "https://aspicio-api.dmitri-66a.workers.dev" }],
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
