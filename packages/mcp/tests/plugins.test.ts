import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

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
  expect(mcp.args).toContain("@aspicio/mcp");
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
