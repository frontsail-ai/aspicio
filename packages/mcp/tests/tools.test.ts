import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { describeDxf, loadDrawing, renderPng } from "../src/tools.ts";

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

const PNG_MAGIC = "89504e47";

test("loadDrawing treats multi-line DXF text as inline bytes (not a path)", async () => {
  const bytes = await loadDrawing(DXF);
  expect(new TextDecoder().decode(bytes)).toContain("SECTION");
});

test("loadDrawing reads a local file path", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "aspicio-mcp-")), "drawing.dxf");
  writeFileSync(path, DXF);
  const summary = await describeDxf(await loadDrawing(path));
  expect(summary.entityCount).toBe(2);
});

test("describeDxf summarizes entity types", async () => {
  const summary = await describeDxf(new TextEncoder().encode(DXF));
  expect(summary.entityTypes).toEqual({ LINE: 1, CIRCLE: 1 });
});

test("renderPng returns PNG bytes", async () => {
  const png = await renderPng(new TextEncoder().encode(DXF), 300);
  expect(Buffer.from(png.subarray(0, 4)).toString("hex")).toBe(PNG_MAGIC);
  expect(png.length).toBeGreaterThan(100);
});

test("a path-shaped source that does not exist fails with 'file not found'", async () => {
  await expect(loadDrawing("/no/such/dir/drawing.dxf")).rejects.toThrow(/file not found/);
});

test("a real path containing DXF-ish words still reads from disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aspicio-SECTION-"));
  const path = join(dir, "EOF-plan.dxf");
  writeFileSync(path, DXF);
  expect((await describeDxf(await loadDrawing(path))).entityCount).toBe(2);
});

test("URL sources are guarded: private hosts, redirect hops, and the size cap", async () => {
  // Private/loopback targets are refused outright, IPv4 and IPv6 alike.
  for (const url of ["http://127.0.0.1/a.dxf", "http://[fe80::1]/a.dxf", "http://10.0.0.8/x"]) {
    await expect(loadDrawing(url)).rejects.toThrow(/private or loopback/);
  }

  const realFetch = globalThis.fetch;
  try {
    // Happy path: fetched bytes parse.
    globalThis.fetch = (async () => new Response(DXF)) as typeof fetch;
    expect((await describeDxf(await loadDrawing("https://example.com/a.dxf"))).entityCount).toBe(2);

    // A public URL redirecting to a private address is refused at the hop.
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/m" },
      })) as typeof fetch;
    await expect(loadDrawing("https://example.com/a.dxf")).rejects.toThrow(/private or loopback/);

    // Oversized content-length is rejected before buffering.
    globalThis.fetch = (async () =>
      new Response("x", {
        headers: { "content-length": String(9 * 1024 * 1024) },
      })) as typeof fetch;
    await expect(loadDrawing("https://example.com/a.dxf")).rejects.toThrow(/8 MB/);

    // Upstream failure surfaces as a clear error.
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    await expect(loadDrawing("https://example.com/a.dxf")).rejects.toThrow(/HTTP 404/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ---------- spaces (AGT-1, AGT-2) ---------- */

// prettier-ignore
const TWO_SPACES = [
  "0", "SECTION", "2", "ENTITIES",
  "0", "LINE", "8", "MODEL", "10", "0", "20", "0", "11", "1", "21", "1",
  "0", "LINE", "8", "SHEET", "67", "1", "10", "0", "20", "0", "11", "10", "21", "4",
  "0", "ENDSEC", "0", "EOF",
].join("\n");

test("the stdio tools describe the whole drawing, and scope to one space", async () => {
  const bytes = new TextEncoder().encode(TWO_SPACES);

  const whole = await describeDxf(bytes);
  expect(whole.space).toBeNull();
  expect(whole.entityCount).toBe(2);
  expect(whole.spaces.map((s) => s.name)).toEqual(["Model", "Layout1"]);

  const sheet = await describeDxf(bytes, "Layout1");
  expect(sheet.space).toBe("Layout1");
  expect(sheet.entityCount).toBe(1);
  expect(sheet.layers.reduce((n, l) => n + l.entityCount, 0)).toBe(sheet.entityCount);

  // Naming a space the drawing lacks is an error the caller sees (AGT-8), not
  // a quiet fallback to page one.
  await expect(describeDxf(bytes, "Nope")).rejects.toThrow(/"Model", "Layout1"/);
});

test("render reaches a space other than the first", async () => {
  const bytes = new TextEncoder().encode(TWO_SPACES);
  const model = await renderPng(bytes, 64);
  const sheet = await renderPng(bytes, 64, "Layout1");
  expect(Buffer.from(sheet).equals(Buffer.from(model))).toBe(false);
});
