import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// Baked at build time, after the release workflow stamps the manifest — so
// `initialize` reports the real published version, not the repo's 0.0.0
// placeholder (registries display this field).
import pkg from "../package.json";
import {
  describeDoc,
  describeDxf,
  describePdf,
  loadDxf,
  renderDocPng,
  renderPdfPng,
  renderPng,
} from "./tools.ts";

const SOURCE_DESC = "An http(s) URL to a .dxf, a local file path, or inline DXF text.";

// Mirrors DrawingSummary (@aspicio/core describe.ts). Declared as
// describe_dxf's output schema so models consume results reliably; the
// contract test round-trips a real summary through a validating client, so
// drift from core fails CI.
const DRAWING_SUMMARY_SHAPE = {
  format: z.string().describe('Which format was read ("dxf", "pdf")'),
  units: z.string().describe('Drawing-unit label (e.g. "mm"), "" when unitless'),
  bounds: z
    .object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() })
    .nullable()
    .describe("World-space extents, null for an empty drawing"),
  size: z
    .object({ width: z.number(), height: z.number() })
    .nullable()
    .describe("Bounding-box size in drawing units, null when empty"),
  entityCount: z.number().int(),
  segmentCount: z.number().int(),
  layers: z.array(
    z.object({
      name: z.string(),
      entityCount: z.number().int(),
      visible: z.boolean(),
      color: z.string().describe("The color actually drawn (dominant), as #rrggbb"),
    }),
  ),
  entityTypes: z.record(z.string(), z.number()).describe("Top-level entities per DXF type"),
  unsupported: z.record(z.string(), z.number()).describe("Per-type counts of skipped entities"),
  texts: z.array(z.string()).describe("Unique TEXT/MTEXT strings, blocks included"),
};

/** Build the Aspicio MCP server with the `describe_dxf` and `render_dxf` tools. */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "aspicio",
    title: "Aspicio",
    version: pkg.version,
    icons: [{ src: "https://aspicio.frontsail.app/favicon.svg", mimeType: "image/svg+xml" }],
    websiteUrl: "https://aspicio.frontsail.app",
  });

  server.registerTool(
    "describe_dxf",
    {
      title: "Describe a DXF drawing",
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Return a structured JSON summary of a DXF drawing — units, bounding box, layers (with the color actually drawn), per-type entity counts, and any skipped/unsupported types. Use this to answer structural questions (what layers exist, how many parts, what size, is it to scale) without rendering an image.",
      inputSchema: { source: z.string().describe(SOURCE_DESC) },
      outputSchema: DRAWING_SUMMARY_SHAPE,
    },
    async ({ source }) => {
      const summary = await describeDxf(await loadDxf(source));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "render_dxf",
    {
      title: "Render a DXF to an image",
      // No outputSchema on purpose: the result IS the image, not data.
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Render a DXF drawing to a PNG image you can look at. Use this to answer visual questions (what does it look like, where is a feature, does it look right) — it returns an image, not text. For structural facts, prefer describe_dxf.",
      inputSchema: {
        source: z.string().describe(SOURCE_DESC),
        width: z
          .number()
          .int()
          .min(64)
          .max(4000)
          .optional()
          .describe("PNG width in pixels (default 1200)"),
      },
    },
    async ({ source, width }) => {
      const png = await renderPng(await loadDxf(source), width);
      return {
        content: [
          { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );

  /* ---------- PDF (AGT-16) ---------- */

  server.registerTool(
    "describe_pdf",
    {
      title: "Describe a PDF drawing",
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Return a structured JSON summary of a PDF drawing — units (points), bounding box, layers, per-type entity counts, the text it contains, and what was skipped (images, shadings, transparency). Use this for structural questions about a PDF without rendering it. For DXF use describe_dxf; if you are unsure of the format, use describe_doc.",
      inputSchema: { source: z.string().describe(SOURCE_DESC) },
      outputSchema: DRAWING_SUMMARY_SHAPE,
    },
    async ({ source }) => {
      const summary = await describePdf(await loadDxf(source));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "render_pdf",
    {
      title: "Render a PDF to an image",
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Render a PDF drawing's vector content to a PNG you can look at. Images, shadings, and transparency are not drawn — they are reported by describe_pdf — so this shows line work and text, not a page facsimile. For DXF use render_dxf; if you are unsure of the format, use render_doc.",
      inputSchema: {
        source: z.string().describe(SOURCE_DESC),
        width: z
          .number()
          .int()
          .min(64)
          .max(4000)
          .optional()
          .describe("PNG width in pixels (default 1200)"),
      },
    },
    async ({ source, width }) => {
      const png = await renderPdfPng(await loadDxf(source), width);
      return {
        content: [
          { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );

  /* ---------- format-agnostic (AGT-16) ---------- */

  server.registerTool(
    "describe_doc",
    {
      title: "Describe a drawing of any supported format",
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Return a structured JSON summary of a drawing in any supported format (DXF or PDF), detected from its bytes rather than its name. Use this when you do not know which format you have; the reply names the format that was read.",
      inputSchema: { source: z.string().describe(SOURCE_DESC) },
      outputSchema: DRAWING_SUMMARY_SHAPE,
    },
    async ({ source }) => {
      const summary = await describeDoc(await loadDxf(source));
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "render_doc",
    {
      title: "Render a drawing of any supported format",
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Render a drawing in any supported format (DXF or PDF) to a PNG you can look at, detected from its bytes rather than its name. Use this when you do not know which format you have.",
      inputSchema: {
        source: z.string().describe(SOURCE_DESC),
        width: z
          .number()
          .int()
          .min(64)
          .max(4000)
          .optional()
          .describe("PNG width in pixels (default 1200)"),
      },
    },
    async ({ source, width }) => {
      const png = await renderDocPng(await loadDxf(source), width);
      return {
        content: [
          { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );

  return server;
}
