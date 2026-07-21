import { expect, test } from "vite-plus/test";
import { isPrivateHost } from "../src/fetch.ts";
import { handleRequest } from "../src/handler.ts";

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

test("the OpenAI domain-verification token is served verbatim", async () => {
  const res = await handleRequest(get("/.well-known/openai-apps-challenge"), noPng);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/plain");
  expect(await res.text()).toBe("1gAK8NA4X6b4VCSuHhmSOywdGJD0VQ0oz4NAILnJHX4");
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

test("render rejects a bg that is not a hex color (SVG injection guard)", async () => {
  const evil = encodeURIComponent('#000"/><script>alert(1)</script>');
  const res = await handleRequest(post(`/render?format=svg&bg=${evil}`, SAMPLE), noPng);
  expect(res.status).toBe(400);
  // A legitimate hex color passes through into the SVG background rect.
  const ok = await handleRequest(post("/render?format=svg&bg=%23112233", SAMPLE), noPng);
  expect(await ok.text()).toContain('fill="#112233"');
});

test("SSRF guard covers IPv6 and canonicalized numeric hosts", async () => {
  for (const src of [
    "http://[::1]/x",
    "http://[fe80::1]/x",
    "http://[fc00::1]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://2130706433/x", // canonicalizes to 127.0.0.1
  ]) {
    const res = await handleRequest(get(`/describe?src=${encodeURIComponent(src)}`), noPng);
    expect(res.status, src).toBe(400);
  }
});

test("?src= fetch: happy path, oversize, and redirect-to-private", async () => {
  const realFetch = globalThis.fetch;
  try {
    // Happy path: the fetched body parses and describes.
    globalThis.fetch = (async () => new Response(SAMPLE)) as typeof fetch;
    const ok = await handleRequest(get("/describe?src=https://example.com/a.dxf"), noPng);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { entityCount: number }).entityCount).toBe(2);

    // A declared content-length over the cap is rejected before buffering.
    globalThis.fetch = (async () =>
      new Response("x", {
        headers: { "content-length": String(9 * 1024 * 1024) },
      })) as typeof fetch;
    const big = await handleRequest(get("/describe?src=https://example.com/a.dxf"), noPng);
    expect(big.status).toBe(413);

    // A public URL redirecting to a private address is refused at the hop.
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/meta" },
      })) as typeof fetch;
    const redir = await handleRequest(get("/describe?src=https://example.com/a.dxf"), noPng);
    expect(redir.status).toBe(400);

    // Endless redirects give up with 502.
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/next" },
      })) as typeof fetch;
    const loop = await handleRequest(get("/describe?src=https://example.com/a.dxf"), noPng);
    expect(loop.status).toBe(502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("rate limiting: denied callers get 429, allowed pass, health is exempt", async () => {
  const denyAll = async (): Promise<boolean> => false;
  const denied = await handleRequest(post("/describe", SAMPLE), noPng, denyAll);
  expect(denied.status).toBe(429);
  const deniedRender = await handleRequest(post("/render?format=svg", SAMPLE), noPng, denyAll);
  expect(deniedRender.status).toBe(429);
  // Health and the index stay reachable even when the limiter says no.
  expect((await handleRequest(get("/health"), noPng, denyAll)).status).toBe(200);
  expect((await handleRequest(get("/"), noPng, denyAll)).status).toBe(200);

  // An allowing limiter is invisible, and receives the client IP as the key.
  let seenKey = "";
  const allow = async (key: string): Promise<boolean> => ((seenKey = key), true);
  const req = new Request("http://api.test/describe", {
    method: "POST",
    body: SAMPLE,
    headers: { "cf-connecting-ip": "203.0.113.9" },
  });
  expect((await handleRequest(req, noPng, allow)).status).toBe(200);
  expect(seenKey).toBe("203.0.113.9");
});

test("429 responses carry a Retry-After header", async () => {
  const denied = await handleRequest(post("/describe", SAMPLE), noPng, async () => false);
  expect(denied.status).toBe(429);
  expect(denied.headers.get("retry-after")).toBe("60");
});

test("/openapi.json serves a valid 3.1 document that matches the routes", async () => {
  const res = await handleRequest(get("/openapi.json"), noPng);
  expect(res.status).toBe(200);
  const doc = (await res.json()) as {
    openapi: string;
    security: unknown[];
    paths: Record<string, unknown>;
  };
  expect(doc.openapi).toBe("3.1.0");
  // Public API: auth "none" must be declared, not implied.
  expect(doc.security).toEqual([]);
  // Route coherence, both directions we can check: the documented path set
  // is pinned, and every documented path is actually served (non-404) —
  // deleting a route from the router while leaving it in the spec fails here.
  expect(Object.keys(doc.paths).sort()).toEqual(["/describe", "/health", "/render"]);
  for (const path of Object.keys(doc.paths)) {
    const served = await handleRequest(get(path), noPng);
    expect(served.status, `${path} is documented but not served`).not.toBe(404);
  }
  // Served-but-undocumented meta routes are deliberate: / (index) and
  // /openapi.json describe the API rather than the drawing domain.
  // The index advertises the spec.
  const root = (await (await handleRequest(get("/"), noPng)).json()) as { openapi: string };
  expect(root.openapi).toBe("/openapi.json");
});

test("/mcp speaks Streamable-HTTP MCP: initialize, tools/list, tools/call", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const stubPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  // Bridge the client's fetch to the pure handler — no network, real protocol.
  const transport = new StreamableHTTPClientTransport(new URL("http://api.test/mcp"), {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handleRequest(new Request(input, init), async () => stubPng)) as typeof fetch,
  });
  const client = new Client({ name: "remote-contract", version: "0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([
    "describe_dxf",
    "load_dxf_for_viewer",
    "render_dxf",
    "view_dxf",
  ]);

  const d = await client.callTool({ name: "describe_dxf", arguments: { source: SAMPLE } });
  const summary = JSON.parse((d.content as Array<{ text: string }>)[0].text) as {
    entityCount: number;
  };
  expect(summary.entityCount).toBe(2);

  const r = await client.callTool({
    name: "render_dxf",
    arguments: { source: SAMPLE, width: 200 },
  });
  const img = (r.content as Array<{ type: string; mimeType?: string; data?: string }>)[0];
  expect(img.type).toBe("image");
  expect(img.mimeType).toBe("image/png");

  // The SSRF guard surfaces as a clean tool error over the wire — the
  // security-relevant behavior for a hosted server.
  const bad = await client.callTool({
    name: "describe_dxf",
    arguments: { source: "http://127.0.0.1/x.dxf" },
  });
  expect(bad.isError).toBe(true);
  expect((bad.content as Array<{ text?: string }>)[0].text).toMatch(/private or loopback/);
  await client.close();
});

test("/mcp is rate-limited like the other work endpoints", async () => {
  const denied = await handleRequest(
    new Request("http://api.test/mcp", { method: "POST", body: "{}" }),
    noPng,
    async () => false,
  );
  expect(denied.status).toBe(429);
});
