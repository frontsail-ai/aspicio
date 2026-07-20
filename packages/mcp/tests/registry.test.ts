import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

// Registry metadata is machine-consumed: a field-name drift means the
// submission is rejected, with green CI. Pin the shape the MCP registry
// schema requires and the cross-file strings that must agree.
const ROOT = join(import.meta.dirname, "../../..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

interface ServerJson {
  $schema: string;
  name: string;
  version: string;
  packages: Array<{
    registry_type: string;
    identifier: string;
    version: string;
    runtime_hint?: string;
    transport: { type: string };
  }>;
  remotes: Array<{ type: string; url: string }>;
}

test("server.json matches the registry schema shape (2025-07-09)", () => {
  const s = JSON.parse(read("server.json")) as ServerJson;
  // The exact traps that broke the first draft: the $schema URL variant that
  // actually resolves, top-level version (not version_detail), and the
  // registry_type/identifier/transport package fields.
  expect(s.$schema).toMatch(/\/server\.schema\.json$/);
  expect(s.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(s.packages).toHaveLength(1);
  const pkg = s.packages[0];
  expect(pkg.registry_type).toBe("npm");
  expect(pkg.transport).toEqual({ type: "stdio" });
  expect(pkg.version).toBe(s.version);
  expect(s.remotes[0].type).toBe("streamable-http");
  expect(s.remotes[0].url).toMatch(/^https:\/\/.+\/mcp$/);
});

test("registry metadata agrees on the one load-bearing package name", () => {
  const pkgName = (JSON.parse(read("packages/mcp/package.json")) as { name: string }).name;
  const server = JSON.parse(read("server.json")) as ServerJson;
  expect(server.packages[0].identifier).toBe(pkgName);
  // Smithery launches the same package via npx.
  expect(read("smithery.yaml")).toContain(pkgName);
  expect(read("smithery.yaml")).toContain("type: stdio");
});

test("glama.json names at least one maintainer", () => {
  // Glama's entire schema: who may claim the listing. Everything else
  // (name, description) comes from crawling npm + GitHub.
  const glama = JSON.parse(read("glama.json")) as { maintainers: string[] };
  expect(glama.maintainers.length).toBeGreaterThan(0);
  for (const m of glama.maintainers) expect(m).toMatch(/^[\w-]+$/);
});
