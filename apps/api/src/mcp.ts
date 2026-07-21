import { describeDrawing, parseDxfBytes, tessellate, tessellationToSvg } from "@aspicio/core";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  INLINE_EMBED_BYTES,
  LOAD_TOOL_NAME,
  VIEWER_META_KEY,
  VIEWER_RESOURCE_URI,
} from "@aspicio/widget/meta";
import type { ViewerMeta } from "@aspicio/widget/meta";
import { z } from "zod";
import registry from "../../../server.json";
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
// Mirrors DrawingSummary (packages/core describe.ts). Declared as the output
// schema of describe_dxf and view_dxf so models consume results reliably;
// the contract tests round-trip real summaries through a validating client,
// so drift from core fails CI.
const DRAWING_SUMMARY_SHAPE = {
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

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A stateless HTTP link to the same render, for URL sources — chat UIs
 * that drop MCP image blocks from user display can still show a plain
 * image URL (AGT-9). Returns undefined for inline sources (nothing to link). */
export function renderLink(origin: string, source: string, width: number): string | undefined {
  const s = source.trim();
  if (!/^https?:\/\//i.test(s)) return undefined;
  return `${origin}/render?src=${encodeURIComponent(s)}&width=${width}`;
}

/** Build the same describe/render tools as the local server, Worker-flavored,
 * plus the MCP Apps viewer (AGT-14). `widgetHtml` is the built widget bundle;
 * tests inject a stub so they never depend on the widget build. */
function createServer(renderPng: RenderPng, widgetHtml?: string, origin = ""): McpServer {
  const server = new McpServer(
    // The Worker deploys from master, not from release tags; the honest
    // version is the registry-pinned one in server.json (bumped pre-tag),
    // which the drift guards already keep coherent. Title and icon ride
    // along so hosts can label the connector properly.
    {
      name: "aspicio",
      title: registry.title,
      version: registry.version,
      icons: registry.icons,
      websiteUrl: registry.websiteUrl,
    },
    {
      instructions:
        "When the user asks to see, show, or explore a drawing, prefer the interactive viewer " +
        "(view_dxf) over a static render — panning, zooming, and layer toggles are far more " +
        "useful to them than a fixed image. If your platform requires the user to approve " +
        "interactive tools first, offer the viewer and ask instead of silently falling back " +
        "to a static render. Use describe_dxf and render_dxf for your own analysis.",
    },
  );

  server.registerTool(
    "describe_dxf",
    {
      title: "Describe a DXF drawing",
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Return a structured JSON summary of a DXF drawing — units, bounding box, layers (with the color actually drawn), per-type entity counts, the drawing's text content (title blocks and dimension values included), and any skipped/unsupported types. Use this to answer structural questions (what layers exist, how many parts, what size, what does it say) without rendering an image.",
      inputSchema: { source: z.string().describe(SOURCE_DESC) },
      outputSchema: DRAWING_SUMMARY_SHAPE,
    },
    async ({ source }) => {
      const doc = parseDxfBytes(await loadDxf(source));
      const summary = describeDrawing(doc, tessellate(doc, {}));
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
        "Render a DXF drawing to a PNG image you can look at. Use this to answer visual questions (what does it look like, where is a feature) — it returns an image, not text. For structural facts and measurements, prefer describe_dxf; never measure pixels. Some chat UIs do not display the returned image to the user: for URL sources the result also includes a direct image link — show it to the user (e.g. as a markdown image) when they need to see the render. When the user wants to see or explore the drawing themselves, prefer view_dxf (interactive viewer) — if your platform gates it behind user approval, offer it and ask rather than substituting a static render.",
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
      const link = renderLink(origin, source, width ?? 1200);
      return {
        content: [
          { type: "image", data: toBase64(png), mimeType: "image/png" },
          ...(link
            ? [{ type: "text" as const, text: `Direct image link (for the user): ${link}` }]
            : []),
        ],
      };
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
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Open an interactive DXF viewer the user can pan, zoom, and toggle layers in (renders in-chat on MCP Apps-capable hosts). Use this when the user wants to see or explore the drawing themselves; for your own analysis use describe_dxf (facts) or render_dxf (image). The viewer shows only the drawing from this call. Delivery is handled by the widget itself: small drawings are embedded in the result and larger URL-sourced drawings are fetched by the widget through its own tool call — never re-fetch or inline the file for the viewer's sake, and don't blind-retry if the user reports an empty viewer (the viewer posts its actual status back to the conversation context).",
      inputSchema: {
        source: z.string().describe(SOURCE_DESC),
        allow_file_open: z
          .boolean()
          .optional()
          .describe(
            "Show open-file controls in the viewer (default false: viewer is locked to this drawing)",
          ),
      },
      outputSchema: DRAWING_SUMMARY_SHAPE,
      _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI } },
    },
    async ({ source, allow_file_open }) => {
      const bytes = await loadDxf(source);
      const doc = parseDxfBytes(bytes);
      const summary = describeDrawing(doc, tessellate(doc, {}));
      const allowFilePicker = allow_file_open === true;
      const trimmed = source.trim();
      const isUrl = /^https?:\/\//i.test(trimmed);
      // The drawing travels widget-only (invisible to the model): embedded in
      // `_meta` when small, pulled by the widget via LOAD_TOOL_NAME when the
      // source is a URL — hosts cap inline results (claude.ai ~150K chars),
      // so big payloads are not deliverable through the result itself.
      const viewerMeta: ViewerMeta =
        bytes.byteLength <= INLINE_EMBED_BYTES
          ? { dxfBase64: toBase64(bytes), byteLength: bytes.byteLength, allowFilePicker }
          : isUrl
            ? { source: trimmed, byteLength: bytes.byteLength, allowFilePicker }
            : { tooLarge: true, byteLength: bytes.byteLength, allowFilePicker };
      const text =
        viewerMeta.dxfBase64 !== undefined
          ? "Opened the drawing in the interactive viewer."
          : viewerMeta.source !== undefined
            ? "Viewer opened; it is fetching the drawing itself and will report its status."
            : "The drawing was passed inline and exceeds the viewer's embed limit; returned the structured summary instead. Host it at an http(s) URL to view it interactively.";
      return {
        content: [{ type: "text", text }],
        structuredContent: summary as unknown as Record<string, unknown>,
        _meta: { [VIEWER_META_KEY]: viewerMeta },
      };
    },
  );

  // The widget's data channel (AGT-14): app-only visibility keeps it out of
  // the model's tool list; the widget calls it over the bridge to pull the
  // drawing, whole or in byte ranges when a host caps single responses.
  registerAppTool(
    server,
    LOAD_TOOL_NAME,
    {
      title: "Load a DXF for the viewer widget",
      annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false },
      description:
        "Internal: returns DXF bytes (base64) for the in-chat viewer. Called by the widget, not the model.",
      inputSchema: {
        source: z.string().describe("http(s) URL of the DXF (same guards as the other tools)"),
        offset: z.number().int().min(0).optional().describe("Byte offset of the requested range"),
        length: z
          .number()
          .int()
          .min(1)
          .max(4_000_000)
          .optional()
          .describe("Byte length of the requested range"),
      },
      outputSchema: {
        dxfBase64: z.string().describe("The requested bytes, base64"),
        byteLength: z.number().int().describe("Total size of the whole file"),
        offset: z.number().int().describe("Byte offset this slice starts at"),
      },
      _meta: { ui: { resourceUri: VIEWER_RESOURCE_URI, visibility: ["app"] } },
    },
    async ({ source, offset, length }) => {
      const bytes = await loadDxf(source);
      const start = offset ?? 0;
      const slice =
        offset === undefined && length === undefined
          ? bytes
          : bytes.subarray(start, length === undefined ? undefined : start + length);
      return {
        content: [{ type: "text", text: `${slice.byteLength} bytes at offset ${start}` }],
        structuredContent: {
          dxfBase64: toBase64(slice),
          byteLength: bytes.byteLength,
          offset: start,
        },
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
  const server = createServer(renderPng, widgetHtml, new URL(req.url).origin);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
