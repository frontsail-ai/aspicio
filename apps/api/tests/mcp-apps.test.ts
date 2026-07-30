import {
  INLINE_EMBED_BYTES,
  LOAD_TOOL_NAME,
  VIEWER_META_KEY,
  VIEWER_RESOURCE_URI,
} from "@aspicio/widget/meta";
import type { LoadResult, ViewerMeta } from "@aspicio/widget/meta";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { handleRequest } from "../src/handler.ts";
import { renderLink } from "../src/mcp.ts";

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

test("server instructions steer hosts toward the interactive viewer", async () => {
  const client = await connect();
  const instructions = client.getInstructions();
  expect(instructions).toContain("view_dxf");
  expect(instructions).toMatch(/offer the viewer and ask/);
  await client.close();
});

test("the remote server reports the registry-pinned version (#63)", async () => {
  // Registries display serverInfo.version; server.json is the source of
  // truth the pre-tag bump keeps current, and drift guards keep coherent.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const registry = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../server.json"), "utf8"),
  ) as { version: string };
  const client = await connect();
  expect(client.getServerVersion()?.version).toBe(registry.version);
  await client.close();
});

test("every tool declares all three hints explicitly (directory reviews block on gaps)", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  expect(tools.length).toBeGreaterThanOrEqual(4);
  for (const tool of tools) {
    expect(tool.annotations?.readOnlyHint, `${tool.name} readOnlyHint`).toBe(true);
    expect(tool.annotations?.openWorldHint, `${tool.name} openWorldHint`).toBe(true);
    expect(tool.annotations?.destructiveHint, `${tool.name} destructiveHint`).toBe(false);
  }
  await client.close();
});

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
  expect(atob(meta.bytesBase64!)).toBe(SAMPLE);
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

test("an over-cap inline drawing degrades to facts plus a too-large marker", async () => {
  // Pad past the embed cap with 999-group comments the parser accepts. An
  // inline source can't be re-fetched, so there is no pull path either.
  const pad = `999\n${"x".repeat(120)}\n`;
  const big = pad.repeat(Math.ceil((INLINE_EMBED_BYTES + 1) / pad.length)) + SAMPLE;
  const client = await connect();
  const r = await client.callTool({ name: "view_dxf", arguments: { source: big } });
  const meta = (r._meta as Record<string, ViewerMeta>)[VIEWER_META_KEY];
  expect(meta.bytesBase64).toBeUndefined();
  expect(meta.source).toBeUndefined();
  expect(meta.tooLarge).toBe(true);
  expect(meta.byteLength).toBeGreaterThan(INLINE_EMBED_BYTES);
  expect((r.structuredContent as { entityCount: number }).entityCount).toBe(1);
  await client.close();
});

test("render_dxf offers a direct image link for URL sources only (AGT-9)", () => {
  // Chat UIs that drop MCP image blocks can still show a plain URL.
  expect(renderLink("http://api.test", "https://x.test/a b.dxf", 800)).toBe(
    "http://api.test/render?src=https%3A%2F%2Fx.test%2Fa%20b.dxf&width=800",
  );
  // Inline DXF text has nothing to link statelessly.
  expect(renderLink("http://api.test", "0\nSECTION\n...", 800)).toBeUndefined();
});

test("the widget's load tool is app-only and serves whole files and byte ranges", async () => {
  const client = await connect();
  // App-only visibility: listed to the host, flagged for hiding from models.
  const { tools } = await client.listTools();
  const load = tools.find((t) => t.name === LOAD_TOOL_NAME);
  const meta = (load?._meta ?? {}) as { ui?: { visibility?: string[]; resourceUri?: string } };
  expect(meta.ui?.visibility).toEqual(["app"]);
  expect(meta.ui?.resourceUri).toBe(VIEWER_RESOURCE_URI);

  // Whole file round-trips byte-exact.
  const whole = await client.callTool({ name: LOAD_TOOL_NAME, arguments: { source: SAMPLE } });
  const w = whole.structuredContent as LoadResult;
  expect(atob(w.bytesBase64)).toBe(SAMPLE);
  expect(w.byteLength).toBe(SAMPLE.length);
  expect(w.offset).toBe(0);

  // Byte-range chunks reassemble to the original.
  const chunk = 40;
  const parts: string[] = [];
  for (let offset = 0; offset < SAMPLE.length; offset += chunk) {
    const r = await client.callTool({
      name: LOAD_TOOL_NAME,
      arguments: { source: SAMPLE, offset, length: chunk },
    });
    const sc = r.structuredContent as LoadResult;
    expect(sc.offset).toBe(offset);
    expect(sc.byteLength).toBe(SAMPLE.length);
    parts.push(atob(sc.bytesBase64));
  }
  expect(parts.join("")).toBe(SAMPLE);
  await client.close();
});

test("structured tools declare output schemas and validate real results (AGT-9)", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const name of ["describe_dxf", "view_dxf", LOAD_TOOL_NAME]) {
    expect(byName[name]?.outputSchema, `${name} outputSchema`).toBeDefined();
  }
  // The image is render_dxf's output — deliberately schema-free.
  expect(byName.render_dxf?.outputSchema).toBeUndefined();
  // The client validates structuredContent against declared schemas on every
  // call, so a real summary passing through is the core-drift guard.
  const r = await client.callTool({ name: "describe_dxf", arguments: { source: SAMPLE } });
  const sc = r.structuredContent as { entityCount: number; layers: Array<{ name: string }> };
  expect(sc.entityCount).toBe(1);
  expect(sc.layers.map((l) => l.name)).toContain("WALLS");
  expect(JSON.parse((r.content as Array<{ text: string }>)[0].text)).toEqual(sc);
  await client.close();
});

// AGT-14: the in-chat viewer opens both formats. AGT-7: on this surface a PDF
// can only arrive as a URL, because the inline form is text and binary PDF
// bytes do not survive it — so the constraint is asserted, not just written
// down in a spec.
const PDF_BYTES = readFileSync(
  fileURLToPath(new URL("../../../packages/core/tests/fixtures/pdf/minimal.pdf", import.meta.url)),
);

test("view_dxf opens a PDF fetched from a URL (AGT-14)", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(PDF_BYTES)) as typeof fetch;
    const client = await connect();
    const res = await client.callTool({
      name: "view_dxf",
      arguments: { source: "https://example.com/artwork.pdf" },
    });
    expect(res.isError).toBeFalsy();
    // The model gets facts naming the format it actually read.
    expect((res.structuredContent as { format: string }).format).toBe("pdf");
    // The widget gets the bytes; the model never does.
    const meta = (res._meta as Record<string, ViewerMeta>)[VIEWER_META_KEY];
    expect(meta.bytesBase64).toBeDefined();
    expect(atob(meta.bytesBase64!).startsWith("%PDF-")).toBe(true);
    await client.close();
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an inline PDF is refused with the form to use instead (AGT-7)", async () => {
  const client = await connect();
  // Every tool shares one loader, so checking the viewer covers the surface.
  for (const name of ["view_dxf", "describe_pdf"]) {
    const res = await client.callTool({
      name,
      arguments: { source: PDF_BYTES.toString("latin1") },
    });
    expect(res.isError, `${name} should refuse inline PDF`).toBe(true);
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? "";
    // Names the fix, not a parse failure from inside the object layer.
    expect(text, name).toMatch(/http\(s\) URL/);
    expect(text, name).not.toMatch(/xref|startxref|trailer/i);
  }
  await client.close();
});

test("every tool's source description states this surface's real forms (AGT-7)", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  for (const tool of tools) {
    const desc = (tool.inputSchema?.properties as { source?: { description?: string } } | undefined)
      ?.source?.description;
    if (desc === undefined) continue;
    // No tool may name a single format as the thing it takes — the old
    // hand-written string promised ".dxf" to describe_pdf as well.
    expect(desc, tool.name).not.toMatch(/\.dxf|of the DXF/);
    // The app-only pull tool is URL-only, so the binary caveat is moot there.
    if (tool.name !== LOAD_TOOL_NAME) expect(desc, tool.name).toMatch(/PDF is binary/);
  }
  await client.close();
});
