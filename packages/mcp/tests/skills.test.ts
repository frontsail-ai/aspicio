import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

// The shared Agent Skills (consumed as-is by both Claude Code and Codex
// plugins) live at <repo>/skills/<name>/SKILL.md. Lint their frontmatter so a
// bad edit can't silently break either plugin wrapper.
const SKILLS_DIR = join(import.meta.dirname, "../../../skills");

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  expect(m, "SKILL.md must start with a --- frontmatter block").not.toBeNull();
  const out: Record<string, string> = {};
  for (const line of m![1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^"|"$/g, "");
  }
  return out;
}

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

test("the expected skills exist", () => {
  expect(skillDirs.sort()).toEqual(["aspicio-embed", "aspicio-inspect-dxf"]);
});

for (const dir of skillDirs) {
  test(`skills/${dir}/SKILL.md has valid frontmatter and a real body`, () => {
    const text = readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
    const fm = frontmatter(text);
    // `name` must match the directory (both plugin systems key on it).
    expect(fm.name).toBe(dir);
    // `description` is the load-bearing trigger: present, starts with "Use
    // when", and within the 1024-char limit skills tooling enforces.
    expect(fm.description?.length).toBeGreaterThan(80);
    expect(fm.description!.length).toBeLessThan(1024);
    expect(fm.description).toMatch(/^Use when/);
    // A body with actual guidance, not a stub.
    const body = text.slice(text.indexOf("---", 3) + 3);
    expect(body.trim().length).toBeGreaterThan(500);
  });
}
