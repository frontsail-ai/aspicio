import { describeDrawing, parseDxfBytes, tessellate, tessellationToSvg } from "@aspicio/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { fetchDxf } from "./fetch.ts";
import type { RenderPng } from "./handler.ts";

const DEFAULT_BG = "#16181d";

const SOURCE_DESC =
  "A publicly reachable http(s) URL to a .dxf file, or the DXF content inline as text. " +
  "(This is a hosted server — local file paths are not available; use the npx @aspicio/mcp " +
  "local server for files on disk.)";

/** Resolve a remote-MCP `source`: a guarded URL fetch, or inline DXF text. */
async function loadDxf(source: string): Promise<Uint8Array> {
  const s = source.trim();
  if (/^https?:\/\//i.test(s)) return fetchDxf(s);
  return new TextEncoder().encode(source);
}

/** Build the same describe/render tools as the local server, Worker-flavored. */
function createServer(renderPng: RenderPng): McpServer {
  const server = new McpServer({ name: "aspicio", version: "1.0.0" });

  server.registerTool(
    "describe_dxf",
    {
      title: "Describe a DXF drawing",
      description:
        "Return a structured JSON summary of a DXF drawing — units, bounding box, layers (with the color actually drawn), per-type entity counts, the drawing's text content (title blocks and dimension values included), and any skipped/unsupported types. Use this to answer structural questions (what layers exist, how many parts, what size, what does it say) without rendering an image.",
      inputSchema: { source: z.string().describe(SOURCE_DESC) },
    },
    async ({ source }) => {
      const doc = parseDxfBytes(await loadDxf(source));
      const summary = describeDrawing(doc, tessellate(doc, {}));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.registerTool(
    "render_dxf",
    {
      title: "Render a DXF to an image",
      description:
        "Render a DXF drawing to a PNG image you can look at. Use this to answer visual questions (what does it look like, where is a feature) — it returns an image, not text. For structural facts and measurements, prefer describe_dxf; never measure pixels.",
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
      const doc = parseDxfBytes(await loadDxf(source));
      const svg = tessellationToSvg(tessellate(doc, {}), undefined, { background: DEFAULT_BG });
      const png = await renderPng(svg, width ?? 1200);
      let binary = "";
      for (const byte of png) binary += String.fromCharCode(byte);
      return { content: [{ type: "image", data: btoa(binary), mimeType: "image/png" }] };
    },
  );

  return server;
}

/**
 * Handle one Streamable-HTTP MCP request, statelessly: each request gets a
 * fresh server + transport pair (no session affinity — correct for a Worker,
 * where any isolate may serve any request). JSON responses are enabled so
 * plain request/response clients need no SSE.
 */
export async function handleMcp(req: Request, renderPng: RenderPng): Promise<Response> {
  const server = createServer(renderPng);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
