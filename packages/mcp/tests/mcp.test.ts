import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test } from "vite-plus/test";
import { createServer } from "../src/server.ts";

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

test("advertises describe_dxf and render_dxf over the protocol", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["describe_dxf", "render_dxf"]);
  // Descriptions carry the usage guidance — usable by any client with no skill.
  expect(tools.every((t) => (t.description?.length ?? 0) > 40)).toBe(true);
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
