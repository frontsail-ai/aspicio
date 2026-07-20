import { MAX_EMBED_BYTES, VIEWER_META_KEY, VIEWER_RESOURCE_URI } from "@aspicio/widget/meta";
import type { ViewerMeta } from "@aspicio/widget/meta";
import { expect, test } from "vite-plus/test";
import { handleRequest } from "../src/handler.ts";

// The MCP Apps contract (AGT-14): the view_dxf tool links the ui:// viewer
// resource, the drawing travels widget-only in the result's _meta, and the
// file-controls flag is server-driven. Same in-memory Streamable-HTTP bridge
// as the /mcp contract test — no network, real protocol.

const SAMPLE = [
  "0",
  "SECTION",
  "2",
  "ENTITIES",
  "0",
  "LINE",
  "8",
  "WALLS",
  "10",
  "0",
  "20",
  "0",
  "11",
  "10",
  "21",
  "0",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

const WIDGET_STUB = "<!doctype html><title>widget-stub</title>";

async function connect() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const transport = new StreamableHTTPClientTransport(new URL("http://api.test/mcp"), {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handleRequest(
        new Request(input, init),
        async () => new Uint8Array(),
        undefined,
        WIDGET_STUB,
      )) as typeof fetch,
  });
  const client = new Client({ name: "mcp-apps-contract", version: "0" });
  await client.connect(transport);
  return client;
}

test("view_dxf declares its UI resource in tool metadata (current + legacy key)", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const view = tools.find((t) => t.name === "view_dxf");
  const meta = view?._meta as { ui?: { resourceUri?: string }; "ui/resourceUri"?: string };
  expect(meta.ui?.resourceUri).toBe(VIEWER_RESOURCE_URI);
  // registerAppTool mirrors the deprecated flat key for older hosts.
  expect(meta["ui/resourceUri"]).toBe(VIEWER_RESOURCE_URI);
  await client.close();
});

test("the viewer resource serves the widget bundle with the MCP Apps mimetype", async () => {
  const client = await connect();
  const { contents } = await client.readResource({ uri: VIEWER_RESOURCE_URI });
  expect(contents).toHaveLength(1);
  const first = contents[0] as { mimeType?: string; text?: string };
  expect(first.mimeType).toBe("text/html;profile=mcp-app");
  expect(first.text).toBe(WIDGET_STUB);
  await client.close();
});

test("view_dxf embeds the drawing widget-only and answers the model with facts", async () => {
  const client = await connect();
  const r = await client.callTool({ name: "view_dxf", arguments: { source: SAMPLE } });
  // Model-facing: a summary in structuredContent, a short text line.
  expect((r.structuredContent as { entityCount: number }).entityCount).toBe(1);
  expect((r.content as Array<{ text: string }>)[0].text).toMatch(/viewer/i);
  // Widget-facing: the exact DXF bytes, base64 in _meta.
  const meta = (r._meta as Record<string, ViewerMeta>)[VIEWER_META_KEY];
  expect(atob(meta.dxfBase64!)).toBe(SAMPLE);
  expect(meta.byteLength).toBe(SAMPLE.length);
  await client.close();
});

test("file-open controls are off unless the tool call enables them (AGT-14)", async () => {
  const client = await connect();
  const off = await client.callTool({ name: "view_dxf", arguments: { source: SAMPLE } });
  const on = await client.callTool({
    name: "view_dxf",
    arguments: { source: SAMPLE, allow_file_open: true },
  });
  const metaOf = (r: unknown) =>
    ((r as { _meta: Record<string, ViewerMeta> })._meta ?? {})[VIEWER_META_KEY];
  expect(metaOf(off).allowFilePicker).toBe(false);
  expect(metaOf(on).allowFilePicker).toBe(true);
  await client.close();
});

test("an over-cap drawing degrades to facts plus a too-large marker", async () => {
  // Pad past the embed cap with 999-group comments the parser accepts.
  const pad = `999\n${"x".repeat(120)}\n`;
  const big = pad.repeat(Math.ceil((MAX_EMBED_BYTES + 1) / pad.length)) + SAMPLE;
  const client = await connect();
  const r = await client.callTool({ name: "view_dxf", arguments: { source: big } });
  const meta = (r._meta as Record<string, ViewerMeta>)[VIEWER_META_KEY];
  expect(meta.dxfBase64).toBeUndefined();
  expect(meta.tooLarge).toBe(true);
  expect(meta.byteLength).toBeGreaterThan(MAX_EMBED_BYTES);
  expect((r.structuredContent as { entityCount: number }).entityCount).toBe(1);
  await client.close();
});
