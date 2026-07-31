import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { TOOLS } from "@aspicio/agent-tools";

// Registry metadata is machine-consumed: a field-name drift means the
// submission is rejected, with green CI. Pin the shape the MCP registry
// schema requires and the cross-file strings that must agree.
const ROOT = join(import.meta.dirname, "../../..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

interface ServerJson {
  $schema: string;
  name: string;
  title: string;
  description: string;
  websiteUrl: string;
  icons: Array<{ src: string; mimeType?: string }>;
  version: string;
  packages: Array<{
    registryType: string;
    identifier: string;
    version: string;
    runtimeHint?: string;
    transport: { type: string };
  }>;
  remotes: Array<{ type: string; url: string }>;
}

test("server.json matches the registry schema shape (2025-12-11)", () => {
  const s = JSON.parse(read("server.json")) as ServerJson;
  // The exact traps that broke earlier drafts: the $schema URL variant that
  // actually resolves, top-level version (not version_detail), the camelCase
  // package fields (2025-12-11 renamed registry_type → registryType), and
  // the 100-char description cap the newer schema enforces.
  expect(s.$schema).toMatch(/\/server\.schema\.json$/);
  expect(s.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(s.description.length).toBeLessThanOrEqual(100);
  expect(s.packages).toHaveLength(1);
  const pkg = s.packages[0];
  expect(pkg.registryType).toBe("npm");
  expect(pkg.transport).toEqual({ type: "stdio" });
  expect(pkg.version).toBe(s.version);
  expect(s.remotes[0].type).toBe("streamable-http");
  expect(s.remotes[0].url).toMatch(/^https:\/\/.+\/mcp$/);
  // Directory UIs hotlink the icon; it must be an absolute https image.
  expect(s.title).toBe("Aspicio");
  expect(s.icons[0].src).toMatch(/^https:\/\/.+\.(svg|png|webp)$/);
});

test("registry metadata agrees on the one load-bearing package name", () => {
  const pkg = JSON.parse(read("packages/mcp/package.json")) as { name: string; mcpName: string };
  const server = JSON.parse(read("server.json")) as ServerJson;
  expect(server.packages[0].identifier).toBe(pkg.name);
  // The registry verifies npm ownership by matching the published package's
  // mcpName against the server name — a mismatch rejects the submission.
  expect(pkg.mcpName).toBe(server.name);
  // Smithery launches the same package via npx.
  const smithery = read("smithery.yaml");
  expect(smithery).toContain(pkg.name);
  expect(smithery).toContain("type: stdio");
  // Smithery's listing metadata must not drift from the registry manifest —
  // its quality score reads description and homepage.
  expect(smithery).toContain(server.description);
  expect(smithery).toContain(server.websiteUrl);
});

test("README's agent-surface strings match the registry manifests", () => {
  // The README quotes the install command and the hosted endpoint; both
  // must track the manifests, not drift independently.
  const readme = read("README.md");
  const server = JSON.parse(read("server.json")) as ServerJson;
  const pkgName = (JSON.parse(read("packages/mcp/package.json")) as { name: string }).name;
  expect(readme).toContain(`npx -y ${pkgName}`);
  expect(readme).toContain(server.remotes[0].url);
});

test("glama.json names at least one maintainer", () => {
  // Glama's entire schema: who may claim the listing. Everything else
  // (name, description) comes from crawling npm + GitHub.
  const glama = JSON.parse(read("glama.json")) as { maintainers: string[] };
  expect(glama.maintainers.length).toBeGreaterThan(0);
  for (const m of glama.maintainers) expect(m).toMatch(/^[\w-]+$/);
});

// `chatgpt-app-submission.json` is the import file the OpenAI app form's Info
// step accepts. Nothing guarded its content, and it drifted exactly as you
// would expect: it listed three of the eight tools for two releases, kept
// describing `view_dxf` as DXF-only after #142 gave it PDF, and carried a
// negative test case asserting "the app handles DXF only" — a behavioural
// claim a reviewer tests against the running app, and one PDF support had
// already falsified.
//
// The form blocks on a missing behaviour hint, so a tool added here without
// hints fails at submission time rather than in CI. This closes that gap.
test("the ChatGPT submission covers every tool the servers advertise", () => {
  const submission = JSON.parse(read("chatgpt-app-submission.json")) as {
    tools: Record<string, { annotations?: Record<string, boolean> }>;
    app_info: { subtitle: string; description: string };
    test_cases: { tools_triggered: string | null }[];
  };
  const listed = Object.keys(submission.tools);

  // Every format tool from the shared table (AGT-16), plus the two the hosted
  // surface adds for the in-chat viewer (AGT-14).
  for (const tool of TOOLS) expect(listed, `${tool.name} missing`).toContain(tool.name);
  for (const name of ["view_dxf", "load_dxf_for_viewer"])
    expect(listed, `${name} missing`).toContain(name);

  // All three hints, explicitly — the submission form rejects a gap (AGT-6).
  for (const [name, tool] of Object.entries(submission.tools)) {
    for (const hint of ["readOnlyHint", "openWorldHint", "destructiveHint"])
      expect(tool.annotations?.[hint], `${name}.${hint}`).toBeTypeOf("boolean");
  }

  // The app copy must not describe a DXF-only product (INV-10).
  for (const [field, text] of Object.entries(submission.app_info))
    if (/\bDXF\b/.test(text)) expect(text, `app_info.${field}`).toMatch(/\bPDF\b/);

  // And at least one positive case must exercise PDF, so a reviewer has
  // something testing the format the submission claims.
  const triggered = submission.test_cases.map((c) => c.tools_triggered ?? "");
  expect(
    triggered.some((t) => t.includes("pdf")),
    "no PDF test case",
  ).toBe(true);
});
