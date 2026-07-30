import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { isPrivateHost } from "../src/fetch.ts";
import { TOOLS } from "@aspicio/agent-tools";
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
const post = (path: string, body: string | Uint8Array): Request =>
  new Request(`http://api.test${path}`, { method: "POST", body: body as BodyInit });

/** A real PDF: binary, so it is read from disk rather than written inline. */
const PDF = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL("../../../packages/core/tests/fixtures/pdf/minimal.pdf", import.meta.url),
    ),
  ),
);

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

test("the Glama connector-ownership manifest is served for verification", async () => {
  const res = await handleRequest(get("/.well-known/glama.json"), noPng);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toEqual({
    $schema: "https://glama.ai/mcp/schemas/connector.json",
    maintainers: [{ email: "dmitri@frontsail.ai" }],
  });
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
  expect(Object.keys(doc.paths).sort()).toEqual([
    "/describe",
    "/describe-doc",
    "/describe-pdf",
    "/health",
    "/render",
    "/render-doc",
    "/render-pdf",
  ]);
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
  // The six-tool matrix (AGT-16) plus this surface's own viewer tools.
  expect(tools.map((t) => t.name).sort()).toEqual([
    "describe_doc",
    "describe_dxf",
    "describe_pdf",
    "load_dxf_for_viewer",
    "render_doc",
    "render_dxf",
    "render_pdf",
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

/* ---------- format-specific and agnostic endpoints (AGT-16) ---------- */

test("/describe-pdf reads a PDF and reports its format", async () => {
  const res = await handleRequest(post("/describe-pdf", PDF), noPng);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { format: string; units: string };
  expect(body.format).toBe("pdf");
  expect(body.units).toBe("pt");
});

test("/describe-doc detects the format from the bytes", async () => {
  const pdf = await handleRequest(post("/describe-doc", PDF), noPng);
  expect(((await pdf.json()) as { format: string }).format).toBe("pdf");
  const dxf = await handleRequest(post("/describe-doc", SAMPLE), noPng);
  expect(((await dxf.json()) as { format: string }).format).toBe("dxf");
});

// A typed endpoint handed the wrong format names the one that works, rather
// than reporting a parse failure about the file.
test("/describe points at the PDF endpoint when given a PDF", async () => {
  const res = await handleRequest(post("/describe", PDF), noPng);
  expect(res.status).toBe(422);
  expect(JSON.stringify(await res.json())).toMatch(/describe-pdf/);
});

test("a DXF still describes as DXF", async () => {
  const res = await handleRequest(post("/describe", SAMPLE), noPng);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { format: string }).format).toBe("dxf");
});

test("the OpenAPI document lists all six endpoints and the format field", async () => {
  const res = await handleRequest(get("/openapi.json"), noPng);
  const doc = (await res.json()) as {
    paths: Record<string, unknown>;
    components: { schemas: Record<string, { required?: string[] }> };
  };
  for (const path of [
    "/describe",
    "/render",
    "/describe-pdf",
    "/render-pdf",
    "/describe-doc",
    "/render-doc",
  ])
    expect(doc.paths[path]).toBeDefined();
  // The response shape gained `format`; the published document must say so.
  const summary = Object.values(doc.components.schemas).find((v) => v.required?.includes("units"));
  expect(summary?.required).toContain("format");
});

// AGT-16 asserts both MCP surfaces offer the same six tools. They register
// from one shared table; this is what proves the table is the source of this
// surface rather than a third copy nobody reads.
test("the hosted surface offers exactly the shared tool set", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const stubPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const transport = new StreamableHTTPClientTransport(new URL("http://api.test/mcp"), {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handleRequest(new Request(input, init), async () => stubPng)) as typeof fetch,
  });
  const client = new Client({ name: "shared-table", version: "0" });
  await client.connect(transport);
  const { tools } = await client.listTools();

  for (const tool of TOOLS) {
    const found = tools.find((t) => t.name === tool.name);
    expect(found, `${tool.name} is missing from the hosted surface`).toBeDefined();
    // Descriptions may carry this surface's own guidance appended, but the
    // shared text is what both surfaces promise.
    expect(found?.description?.startsWith(tool.description)).toBe(true);
  }
});

// AGT-16 + INV-10: every documented endpoint must describe the formats it
// actually accepts, in *all* its prose — not just the operation summary.
//
// The generator used to rewrite only `summary` and `description` at the
// operation level, so `/describe-pdf` shipped a `src` parameter reading
// "a .dxf file (ASCII or binary DXF)" and a 422 saying "could not be parsed
// as DXF". Wrong guidance, in the document agent platforms import, on an
// endpoint that only accepts PDF. Walking every string is the fix; this is
// the guard, because the shallow version looked right until someone read the
// generated output.
test("no PDF-only endpoint mentions DXF anywhere in its prose (AGT-16)", async () => {
  const doc = (await (await handleRequest(get("/openapi.json"), noPng)).json()) as {
    paths: Record<string, unknown>;
  };

  /** Every `description`/`summary` string under a node, however deep. */
  const prose = (node: unknown, out: string[] = []): string[] => {
    if (Array.isArray(node)) {
      for (const item of node) prose(item, out);
      return out;
    }
    if (node === null || typeof node !== "object") return out;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if ((key === "description" || key === "summary") && typeof value === "string")
        out.push(value);
      else prose(value, out);
    }
    return out;
  };

  for (const path of ["/describe-pdf", "/render-pdf"]) {
    for (const text of prose(doc.paths[path])) {
      expect(text, `${path}: "${text}"`).not.toMatch(/\bDXF\b|\.dxf/i);
    }
  }

  // The agnostic pair may name DXF — but only alongside PDF, never alone.
  for (const path of ["/describe-doc", "/render-doc"]) {
    for (const text of prose(doc.paths[path])) {
      if (/\bDXF\b/i.test(text)) expect(text, `${path}: "${text}"`).toMatch(/\bPDF\b/i);
    }
  }

  // And the DXF-only pair stays DXF-only rather than being genericised: the
  // point of the typed endpoints is that they say what they take.
  for (const path of ["/describe", "/render"]) {
    expect(prose(doc.paths[path]).join(" "), path).toMatch(/\bDXF\b/);
  }

  // operationIds are the most agent-visible names in the document — an
  // OpenAPI platform turns each into a callable function — so they follow
  // INV-12 too. Appending the suffix used to yield `describeDxfPdf`.
  //
  // Deliberately no `.filter(Boolean)`: dropping empty ids would hide the
  // worst case rather than catch it. A generator returning "" gives every
  // operation the same missing name — eight operations no importer can tell
  // apart — and a filtered uniqueness check passes it happily.
  const ids = (path: string): string[] =>
    Object.values(doc.paths[path] as Record<string, { operationId?: string }>).map(
      (op) => op.operationId ?? "",
    );
  for (const path of ["/describe-pdf", "/render-pdf", "/describe-doc", "/render-doc"]) {
    for (const id of ids(path)) expect(id, `${path} operationId`).not.toMatch(/Dxf/);
  }
  // Every operation carries a name at all...
  for (const path of Object.keys(doc.paths)) {
    for (const id of ids(path))
      expect(id, `${path} has an operation with no operationId`).not.toBe("");
  }
  // ...and OpenAPI requires those names to be unique document-wide: a
  // substitution that collided would generate two functions with one name.
  const all = Object.keys(doc.paths).flatMap(ids);
  expect(new Set(all).size, `duplicate or missing operationId in ${all.join(", ")}`).toBe(
    all.length,
  );
});
