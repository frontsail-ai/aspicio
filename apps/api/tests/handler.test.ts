import { expect, test } from "vite-plus/test";
import { handleRequest, isPrivateHost } from "../src/handler.ts";

// A tiny valid drawing: a WALLS layer with one LINE and one CIRCLE.
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

const noPng = async (): Promise<Uint8Array> => new Uint8Array();
const get = (path: string): Request => new Request(`http://api.test${path}`);
const post = (path: string, body: string): Request =>
  new Request(`http://api.test${path}`, { method: "POST", body });

test("/health returns ok", async () => {
  const res = await handleRequest(get("/health"), noPng);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("POST /describe returns a structured summary", async () => {
  const res = await handleRequest(post("/describe", SAMPLE), noPng);
  expect(res.status).toBe(200);
  const s = (await res.json()) as { entityCount: number; entityTypes: Record<string, number> };
  expect(s.entityCount).toBe(2);
  expect(s.entityTypes).toEqual({ LINE: 1, CIRCLE: 1 });
});

test("POST /render?format=svg returns SVG and does not call the rasterizer", async () => {
  let called = false;
  const res = await handleRequest(post("/render?format=svg", SAMPLE), async () => {
    called = true;
    return new Uint8Array();
  });
  expect(res.headers.get("content-type")).toContain("image/svg");
  expect(called).toBe(false);
  expect(await res.text()).toContain("<svg");
});

test("POST /render?format=png calls the injected rasterizer with the width", async () => {
  const stub = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  let width = 0;
  const res = await handleRequest(post("/render?format=png&width=800", SAMPLE), async (_svg, w) => {
    width = w;
    return stub;
  });
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(width).toBe(800);
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(stub);
});

test("missing src on a GET → 400", async () => {
  expect((await handleRequest(get("/describe"), noPng)).status).toBe(400);
});

test("SSRF guard: private or non-http src → 400", async () => {
  expect((await handleRequest(get("/describe?src=http://127.0.0.1/x"), noPng)).status).toBe(400);
  expect((await handleRequest(get("/render?src=ftp://host/x"), noPng)).status).toBe(400);
});

test("garbage DXF → 422", async () => {
  expect((await handleRequest(post("/describe", "not a dxf"), noPng)).status).toBe(422);
});

test("unknown route → 404", async () => {
  expect((await handleRequest(get("/nope"), noPng)).status).toBe(404);
});

test("isPrivateHost flags loopback/link-local/private ranges", () => {
  for (const h of [
    "localhost",
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "172.16.0.1",
    "::1",
  ])
    expect(isPrivateHost(h)).toBe(true);
  for (const h of ["example.com", "8.8.8.8", "172.32.0.1"]) expect(isPrivateHost(h)).toBe(false);
});
