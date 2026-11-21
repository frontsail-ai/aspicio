import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test } from "vite-plus/test";
import { createServer } from "../src/server.ts";

// The repo doubles as the plugin + marketplace for both Claude Code and
// Codex. Keep the three manifests coherent with each other and with skills/.
const ROOT = join(import.meta.dirname, "../../..");
const read = (p: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ROOT, p), "utf8")) as Record<string, unknown>;

test("Claude plugin manifest is coherent", () => {
  const plugin = read(".claude-plugin/plugin.json");
  expect(plugin.name).toBe("aspicio");
});

test(".mcp.json bundles the aspicio MCP server via npx", () => {
  // Claude wires a plugin's MCP servers from .mcp.json at the plugin root
  // (verified: an mcpServers key inside plugin.json is ignored).
  const mcp = (read(".mcp.json").mcpServers as Record<string, { command: string; args: string[] }>)
    .aspicio;
  expect(mcp.command).toBe("npx");
  // The npx target must be the actual package name — the one load-bearing
  // string that makes the plugin work, living in two files. (Deliberately
  // unpinned: plugin installs track the latest published server.)
  expect(mcp.args).toContain(read("packages/mcp/package.json").name);
});

test("Claude marketplace lists the plugin at the repo root", () => {
  const market = read(".claude-plugin/marketplace.json");
  const plugins = market.plugins as Array<{ name: string; source: string }>;
  expect(plugins).toHaveLength(1);
  expect(plugins[0]).toMatchObject({ name: "aspicio", source: "./" });
});

test("Codex plugin manifest points at the shared skills dir", () => {
  const plugin = read(".codex-plugin/plugin.json");
  expect(plugin.name).toBe("aspicio");
  expect(plugin.skills).toBe("./skills/");
  expect(existsSync(join(ROOT, "skills"))).toBe(true);
});

test("both plugin manifests agree on name and version", () => {
  const claude = read(".claude-plugin/plugin.json");
  const codex = read(".codex-plugin/plugin.json");
  expect(claude.name).toBe(codex.name);
  expect(claude.version).toBe(codex.version);
});

// ---- Every list of the stdio tools names all of them (INV-10, AGT-16) ----
// The plugins install this server (.mcp.json), so the manifests describe it,
// not the hosted one: they must never promise the hosted-only viewer. The
// expected names come from the served tools/list, not from the tool table.
// apps/api/tests/doc-tool-lists.test.ts guards the hosted lists the same way.

const text = (p: string): string => readFileSync(join(ROOT, p), "utf8");
const SNAKE = /\b[a-z]+(?:_[a-z]+)+\b/g;
const named = (s: string, names: string[]): string[] =>
  names.filter((name) => new RegExp(`\\b${name}\\b`).test(s));

let listing: Promise<string[]> | undefined;
async function stdioTools(): Promise<string[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "plugins-test", version: "0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await client.close();
  }
}
const tools = (): Promise<string[]> => (listing ??= stdioTools());

/** The text between the one `<!-- tools:start -->` / `<!-- tools:end -->` pair. */
function fenced(path: string): string {
  const parts = text(path).split(/<!-- tools:(?:start|end) -->/);
  expect(parts.length, `${path} needs exactly one tools:start / tools:end pair`).toBe(3);
  return parts[1]!;
}

/** The skill's tool table: from its header row to the first blank line. A
 * model reads the skill raw, so it carries no markers. */
function skillTable(): string {
  const skill = text("skills/aspicio-inspect-dxf/SKILL.md");
  const start = skill.indexOf("| Question kind");
  expect(start, "the inspect skill lost its tool table").toBeGreaterThan(-1);
  return skill.slice(start, skill.indexOf("\n\n", start));
}

const LISTS: Array<{ where: string; list: () => string }> = [
  { where: "packages/mcp/README.md", list: () => fenced("packages/mcp/README.md") },
  { where: "skills/aspicio-inspect-dxf/SKILL.md (tool table)", list: skillTable },
];

test("the stdio server serves the six format tools", async () => {
  expect(await tools()).toHaveLength(6);
});

for (const { where, list } of LISTS) {
  test(`${where} lists every stdio tool, and nothing else`, async () => {
    const names = await tools();
    const region = list();
    expect(
      names.filter((n) => !named(region, [n]).length),
      `${where} does not list these tools`,
    ).toEqual([]);
    const unknown = [...new Set(region.match(SNAKE) ?? [])].filter((n) => !names.includes(n));
    expect(unknown, `${where} lists tools the stdio server does not serve`).toEqual([]);
  });
}

const DESCRIPTIONS: Array<{ where: string; get: () => unknown }> = [
  {
    where: ".claude-plugin/plugin.json description",
    get: () => read(".claude-plugin/plugin.json").description,
  },
  {
    where: ".claude-plugin/marketplace.json plugin description",
    get: () =>
      (read(".claude-plugin/marketplace.json").plugins as Array<{ description: string }>)[0]!
        .description,
  },
  {
    where: ".codex-plugin/plugin.json description",
    get: () => read(".codex-plugin/plugin.json").description,
  },
  {
    where: ".codex-plugin/plugin.json interface.shortDescription",
    get: () =>
      (read(".codex-plugin/plugin.json").interface as Record<string, string>).shortDescription,
  },
  {
    where: ".codex-plugin/plugin.json interface.longDescription",
    get: () =>
      (read(".codex-plugin/plugin.json").interface as Record<string, string>).longDescription,
  },
];

for (const { where, get } of DESCRIPTIONS) {
  test(`${where} covers both formats and names every stdio tool or none`, async () => {
    const names = await tools();
    const description = get();
    expect(typeof description, where).toBe("string");
    const s = description as string;
    expect(s, `${where} must say the plugin reads PDF`).toMatch(/\bPDF\b/);
    const listed = named(s, names);
    expect(
      [0, names.length],
      `${where} names some tools but not all: ${listed.join(", ")}`,
    ).toContain(listed.length);
    const unknown = [...new Set(s.match(SNAKE) ?? [])].filter((n) => !names.includes(n));
    expect(unknown, `${where} names tools the plugin's server does not serve`).toEqual([]);
  });
}
