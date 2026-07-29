import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// Baked at build time, after the release workflow stamps the manifest — so
// `initialize` reports the real published version, not the repo's 0.0.0
// placeholder (registries display this field).
import pkg from "../package.json";
import { DRAWING_SUMMARY_SHAPE, READ_ONLY_HINTS, TOOLS, widthSchema } from "./tools-meta.ts";
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

/** Build the Aspicio MCP server with the `describe_dxf` and `render_dxf` tools. */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "aspicio",
    title: "Aspicio",
    version: pkg.version,
    icons: [{ src: "https://aspicio.frontsail.app/favicon.svg", mimeType: "image/svg+xml" }],
    websiteUrl: "https://aspicio.frontsail.app",
  });

  const describeFor = {
    dxf: describeDxf,
    pdf: describePdf,
    doc: describeDoc,
  } as const;
  const renderFor = {
    dxf: renderPng,
    pdf: renderPdfPng,
    doc: renderDocPng,
  } as const;

  // Registered from the shared table so this surface and the hosted one cannot
  // drift on which tools exist or what they claim to do (AGT-16).
  for (const tool of TOOLS) {
    if (tool.kind === "describe") {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          annotations: READ_ONLY_HINTS,
          description: tool.description,
          inputSchema: { source: z.string().describe(SOURCE_DESC) },
          outputSchema: DRAWING_SUMMARY_SHAPE,
        },
        async ({ source }) => {
          const summary = await describeFor[tool.format](await loadDxf(source));
          return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
            structuredContent: summary as unknown as Record<string, unknown>,
          };
        },
      );
    } else {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          // No outputSchema on purpose: the result IS the image, not data.
          annotations: READ_ONLY_HINTS,
          description: tool.description,
          inputSchema: { source: z.string().describe(SOURCE_DESC), width: widthSchema },
        },
        async ({ source, width }) => {
          const png = await renderFor[tool.format](await loadDxf(source), width);
          return {
            content: [
              { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
            ],
          };
        },
      );
    }
  }

  return server;
}
