import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeDxf, loadDxf, renderPng } from "./tools.ts";

const SOURCE_DESC = "An http(s) URL to a .dxf, a local file path, or inline DXF text.";

/** Build the Aspicio MCP server with the `describe_dxf` and `render_dxf` tools. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "aspicio", version: "0.0.0" });

  server.registerTool(
    "describe_dxf",
    {
      title: "Describe a DXF drawing",
      description:
        "Return a structured JSON summary of a DXF drawing — units, bounding box, layers (with the color actually drawn), per-type entity counts, and any skipped/unsupported types. Use this to answer structural questions (what layers exist, how many parts, what size, is it to scale) without rendering an image.",
      inputSchema: { source: z.string().describe(SOURCE_DESC) },
    },
    async ({ source }) => {
      const summary = describeDxf(await loadDxf(source));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.registerTool(
    "render_dxf",
    {
      title: "Render a DXF to an image",
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
      const png = renderPng(await loadDxf(source), width);
      return {
        content: [
          { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );

  return server;
}
