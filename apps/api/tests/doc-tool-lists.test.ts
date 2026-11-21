import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { handleRequest } from "../src/handler.ts";

// Every list of the hosted tools names every tool a user can call, and no
// tool the server lacks (INV-10, AGT-15, AGT-16).
//
// The README and the demo's /mcp page listed only the DXF tools for months
// after the PDF and doc pairs shipped. The existing drift guard checks that a
// taught name still exists; nothing checked that a shipped name is taught.
// A whole-file check is not enough either: the /mcp page's meta description
// named all six format tools while its Tools table listed two. So each list
// is fenced by markers, and only the fenced text counts.
//
// The expected names come from the served tools/list, not from the tool
// table, so a tool the hosted server adds or drops is covered too.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8");

const noPng = async (): Promise<Uint8Array> => new Uint8Array();

interface ListedTool {
  name: string;
  _meta?: { ui?: { visibility?: string[] } };
}

async function servedTools(): Promise<ListedTool[]> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const transport = new StreamableHTTPClientTransport(new URL("http://api.test/mcp"), {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handleRequest(new Request(input, init), noPng)) as typeof fetch,
  });
  const client = new Client({ name: "doc-tool-lists", version: "0" });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools as ListedTool[];
  } finally {
    await client.close();
  }
}

/** The text between the one `<!-- tools:start -->` / `<!-- tools:end -->` pair. */
function fenced(path: string): string {
  const parts = read(path).split(/<!-- tools:(?:start|end) -->/);
  expect(parts.length, `${path} needs exactly one tools:start / tools:end pair`).toBe(3);
  return parts[1]!;
}

/** The llms.txt list item for the hosted server, up to the next item. */
function llmsHostedItem(): string {
  const text = read("apps/demo/public/llms.txt");
  const start = text.indexOf("- [Hosted MCP server]");
  expect(start, "llms.txt lost its Hosted MCP server item").toBeGreaterThan(-1);
  const next = text.indexOf("\n- ", start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

const SNAKE = /\b[a-z]+(?:_[a-z]+)+\b/g;

const LISTS: Array<{ where: string; text: () => string }> = [
  { where: "README.md", text: () => fenced("README.md") },
  {
    where: "apps/demo/public/mcp/index.html",
    text: () => fenced("apps/demo/public/mcp/index.html"),
  },
  { where: "apps/demo/public/llms.txt (Hosted MCP server item)", text: llmsHostedItem },
];

let listing: Promise<ListedTool[]> | undefined;
const tools = (): Promise<ListedTool[]> => (listing ??= servedTools());

test("a user of the hosted server can call seven tools", async () => {
  const visible = (await tools()).filter((t) => !t._meta?.ui?.visibility?.includes("app"));
  // The six format tools and the viewer; the widget's data channel is app-only.
  expect(visible).toHaveLength(7);
});

for (const { where, text } of LISTS) {
  test(`${where} lists every hosted tool a user can call, and nothing else`, async () => {
    const all = await tools();
    const served = new Set(all.map((t) => t.name));
    const visible = all.filter((t) => !t._meta?.ui?.visibility?.includes("app")).map((t) => t.name);
    const list = text();
    const missing = visible.filter((name) => !new RegExp(`\\b${name}\\b`).test(list));
    expect(missing, `${where} does not list these tools`).toEqual([]);
    const unknown = [...new Set(list.match(SNAKE) ?? [])].filter((name) => !served.has(name));
    expect(unknown, `${where} lists tools the hosted server does not serve`).toEqual([]);
  });
}
