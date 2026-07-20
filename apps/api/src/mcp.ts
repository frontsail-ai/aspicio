import { describeDrawing, parseDxfBytes, tessellate, tessellationToSvg } from "@aspicio/core";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { MAX_EMBED_BYTES, VIEWER_META_KEY, VIEWER_RESOURCE_URI } from "@aspicio/widget/meta";
import type { ViewerMeta } from "@aspicio/widget/meta";
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

/** Chunked encode — String.fromCharCode(...4MB) would blow the arg limit. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Build the same describe/render tools as the local server, Worker-flavored,
 * plus the MCP Apps viewer (AGT-14). `widgetHtml` is the built widget bundle;
 * tests inject a stub so they never depend on the widget build. */
function createServer(renderPng: RenderPng, widgetHtml?: string): McpServer {
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
      return { content: [{ type: "image", data: toBase64(png), mimeType: "image/png" }] };
    },
  );

  // The in-chat interactive viewer (MCP Apps, AGT-14). Hosts without the
  // extension ignore the UI metadata and still get a usable text result.
  registerAppResource(
    server,
    "aspicio-viewer",
    VIEWER_RESOURCE_URI,
    {
      title: "Aspicio DXF viewer",
      description: "Interactive in-chat DXF viewer (pan, zoom, layer toggles).",
      // No `_meta.ui.csp`: the widget parses the drawing in-iframe and makes
      // no network requests, so the spec's restrictive default CSP is exact.
    },
    async () => ({
      contents: [
        {
          uri: VIEWER_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml ?? "<!doctype html><!-- widget bundle not provided -->",
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "view_dxf",
    {
      title: "Open a DXF in the interactive viewer",
      description:
        "Open an interactive DXF viewer the user can pan, zoom, and toggle layers in (renders in-chat on MCP Apps-capable hosts). Use this when the user wants to see or explore the drawing themselves; for your own analysis use describe_dxf (facts) or render_dxf (image). The viewer shows only the drawing from this call.",
      inputSchema: {
        source: z.string().describe(SOURCE_DESC),
        allow_file_open: z
          .boolean()
          .optional()
          .describe(
            "Show open-file controls in the viewer (default false: viewer is locked to this drawing)",
          ),
      },
      _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } },
    },
    async ({ source, allow_file_open }) => {
      const bytes = await loadDxf(source);
      const doc = parseDxfBytes(bytes);
      const summary = describeDrawing(doc, tessellate(doc, {}));
      // The drawing itself travels widget-only in `_meta` (invisible to the
      // model); the model narrates from structuredContent.
      const viewerMeta: ViewerMeta =
        bytes.byteLength <= MAX_EMBED_BYTES
          ? {
              dxfBase64: toBase64(bytes),
              byteLength: bytes.byteLength,
              allowFilePicker: allow_file_open === true,
            }
          : {
              tooLarge: true,
              byteLength: bytes.byteLength,
              allowFilePicker: allow_file_open === true,
            };
      return {
        content: [
          {
            type: "text",
            text:
              bytes.byteLength <= MAX_EMBED_BYTES
                ? "Opened the drawing in the interactive viewer."
                : "Drawing exceeds the inline-viewer size cap; returned the structured summary instead.",
          },
        ],
        structuredContent: summary as unknown as Record<string, unknown>,
        _meta: { [VIEWER_META_KEY]: viewerMeta },
      };
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
export async function handleMcp(
  req: Request,
  renderPng: RenderPng,
  widgetHtml?: string,
): Promise<Response> {
  const server = createServer(renderPng, widgetHtml);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
