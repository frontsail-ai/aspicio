import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test } from "vite-plus/test";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.ts";

// A real PDF, passed by path: PDFs are binary, so an inline string source
// would not survive the round trip that inline DXF text does.
const PDF = fileURLToPath(new URL("../../core/tests/fixtures/pdf/minimal.pdf", import.meta.url));

const DXF = [
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
  "CIRCLE",
  "8",
  "WALLS",
  "10",
  "5",
  "20",
  "5",
  "40",
  "2",
  "0",
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

// Connect a real MCP client to our server over an in-memory transport — this
// exercises the wire protocol (initialize, tools/list, tools/call) exactly as
// Claude Code, Codex, or any other MCP client would, with no vendor coupling.
async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "contract-test", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

// AGT-16: three pairs — one per format, plus one that detects from the bytes.
test("advertises the six-tool matrix over the protocol", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([
    "describe_doc",
    "describe_dxf",
    "describe_pdf",
    "render_doc",
    "render_dxf",
    "render_pdf",
  ]);
  // Descriptions carry the usage guidance — usable by any client with no skill.
  expect(tools.every((t) => (t.description?.length ?? 0) > 40)).toBe(true);
  // Every tool declares all three behaviour hints (AGT-6).
  for (const tool of tools) {
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).toBe(false);
    expect(tool.annotations?.openWorldHint).toBe(true);
  }
});

test("describe_dxf returns a JSON summary as text content", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "describe_dxf", arguments: { source: DXF } });
  const content = res.content as Array<{ type: string; text?: string }>;
  expect(content[0].type).toBe("text");
  const summary = JSON.parse(content[0].text ?? "") as { entityCount: number };
  expect(summary.entityCount).toBe(2);
});

test("render_dxf returns a PNG image content item", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "render_dxf", arguments: { source: DXF, width: 400 } });
  const content = res.content as Array<{ type: string; data?: string; mimeType?: string }>;
  expect(content[0].type).toBe("image");
  expect(content[0].mimeType).toBe("image/png");
  const png = Buffer.from(content[0].data ?? "", "base64");
  expect(png.subarray(0, 4).toString("hex")).toBe("89504e47"); // PNG magic
});

test("a broken source surfaces as a protocol error result, not a crash", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "describe_dxf",
    arguments: { source: "not a dxf at all" },
  });
  expect(res.isError).toBe(true);
  const content = res.content as Array<{ type: string; text?: string }>;
  expect(content[0].type).toBe("text");
  expect(content[0].text).toMatch(/file not found|Unexpected|Empty/i);
});

test("describe_dxf declares an output schema and returns matching structured content", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  expect(byName.describe_dxf?.outputSchema).toBeDefined();
  // The image is render_dxf's output — deliberately schema-free.
  expect(byName.render_dxf?.outputSchema).toBeUndefined();
  // The client validates structuredContent against the declared schema on
  // every call, so a real summary passing through is the core-drift guard.
  const res = await client.callTool({ name: "describe_dxf", arguments: { source: DXF } });
  const sc = res.structuredContent as { entityCount: number; layers: Array<{ name: string }> };
  expect(sc.entityCount).toBe(2);
  expect(sc.layers.map((l) => l.name)).toContain("WALLS");
  const text = (res.content as Array<{ text: string }>)[0].text;
  expect(JSON.parse(text)).toEqual(sc);
});

// AGT-16: a typed tool handed the wrong format names the tool that works,
// rather than reporting a parse failure about the file.
test("describe_dxf points at the PDF tool when given a PDF", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "describe_dxf", arguments: { source: PDF } });
  expect(res.isError).toBe(true);
  const text = (res.content as { text?: string }[])[0]?.text ?? "";
  expect(text).toMatch(/describe_pdf/);
});

test("describe_doc reads a PDF without being told the format", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "describe_doc", arguments: { source: PDF } });
  expect(res.isError).toBeFalsy();
  const summary = res.structuredContent as { format?: string };
  expect(summary.format).toBe("pdf");
});

test("describe_doc still reads a DXF", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "describe_doc", arguments: { source: DXF } });
  expect(res.isError).toBeFalsy();
  expect((res.structuredContent as { format?: string }).format).toBe("dxf");
});
