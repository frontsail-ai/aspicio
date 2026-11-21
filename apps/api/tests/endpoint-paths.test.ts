import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLS } from "@aspicio/agent-tools";
import { expect, test } from "vite-plus/test";
import { handleRequest } from "../src/handler.ts";

// Every path the API hands a caller must lead somewhere real (AGT-9, AGT-16).
//
// The image link and the wrong-format hint were each built from a hand-written
// pattern, and both pointed at routes that do not serve the drawing:
// render_pdf linked to the DXF-only /render (a 422), and a DXF sent to
// /describe-pdf was told to use /describe-dxf (a 404). The tests that existed
// compared those strings with the same pattern, so they could not fail. These
// tests follow every path through the real router instead.

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
  "ENDSEC",
  "0",
  "EOF",
].join("\n");

const PDF = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL("../../../packages/core/tests/fixtures/pdf/minimal.pdf", import.meta.url),
    ),
  ),
);

const FIXTURES = { dxf: DXF, pdf: PDF } as const;
const DXF_URL = "https://example.com/plan.dxf";
const PDF_URL = "https://example.com/artwork.pdf";

const noPng = async (): Promise<Uint8Array> => new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const at = (path: string): string => new URL(path, "http://api.test").toString();
const get = (path: string): Promise<Response> => handleRequest(new Request(at(path)), noPng);
const post = (path: string, body: string | Uint8Array): Promise<Response> =>
  handleRequest(new Request(at(path), { method: "POST", body: body as BodyInit }), noPng);

/** Serve the fixtures for `?src=` fetches; restored after each use. */
async function withSources<T>(run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    return new Response(url.endsWith(".pdf") ? PDF : DXF);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function connect() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const transport = new StreamableHTTPClientTransport(new URL("http://api.test/mcp"), {
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handleRequest(new Request(input, init), noPng)) as typeof fetch,
  });
  const client = new Client({ name: "endpoint-paths", version: "0" });
  await client.connect(transport);
  return client;
}

/** The path a 422 wrong-format reply tells the caller to use. */
async function hintedPath(res: Response): Promise<string> {
  const { error } = (await res.json()) as { error: string };
  const path = /use (\/[a-z-]+)/.exec(error)?.[1];
  expect(path, `no path in: ${error}`).toBeDefined();
  return path!;
}

/** Every drawing endpoint the OpenAPI document advertises. */
async function documentedEndpoints(): Promise<string[]> {
  const doc = (await (await get("/openapi.json")).json()) as { paths: Record<string, unknown> };
  return Object.keys(doc.paths).filter((p) => /^\/(describe|render)/.test(p));
}

const RENDER_SOURCES: Record<string, readonly string[]> = {
  dxf: [DXF_URL],
  pdf: [PDF_URL],
  doc: [DXF_URL, PDF_URL],
};

test("every render tool's direct image link serves an image (AGT-9)", async () => {
  await withSources(async () => {
    const client = await connect();
    try {
      for (const tool of TOOLS.filter((t) => t.kind === "render")) {
        for (const source of RENDER_SOURCES[tool.format]!) {
          const result = await client.callTool({ name: tool.name, arguments: { source } });
          const text = (result.content as { type: string; text?: string }[]).find(
            (part) => part.type === "text",
          )?.text;
          const link = /https?:\/\/\S+/.exec(text ?? "")?.[0];
          expect(link, `${tool.name} gave no link for ${source}`).toBeDefined();
          const res = await handleRequest(new Request(link!), noPng);
          expect(res.status, `${tool.name} → ${link}`).toBe(200);
          expect(res.headers.get("content-type")).toBe("image/png");
        }
      }
    } finally {
      await client.close();
    }
  });
});

test("a wrong-format POST names an endpoint that serves the drawing (AGT-16)", async () => {
  const endpoints = await documentedEndpoints();
  let mismatches = 0;
  for (const path of endpoints) {
    for (const [format, body] of Object.entries(FIXTURES)) {
      const res = await post(path, body);
      if (res.status === 200) continue; // this endpoint reads this format
      mismatches++;
      expect(res.status, `${format} → ${path}`).toBe(422);
      const hinted = await hintedPath(res);
      const retry = await post(hinted, body);
      expect(retry.status, `${format} → ${path} → ${hinted}`).toBe(200);
    }
  }
  // Four typed endpoints, each refusing the one format it does not read.
  expect(mismatches).toBe(4);
});

test("a wrong-format GET redirects to the endpoint for that format (AGT-16)", async () => {
  await withSources(async () => {
    const cases = [
      { path: "/render", src: PDF_URL, to: "/render-pdf" },
      { path: "/describe", src: PDF_URL, to: "/describe-pdf" },
      { path: "/render-pdf", src: DXF_URL, to: "/render" },
      { path: "/describe-pdf", src: DXF_URL, to: "/describe" },
    ];
    for (const { path, src, to } of cases) {
      const query = `?src=${encodeURIComponent(src)}&width=640`;
      const res = await get(`${path}${query}`);
      expect(res.status, `GET ${path} with ${src}`).toBe(307);
      // The query travels unchanged, so width, space, and format still apply.
      expect(res.headers.get("location")).toBe(`${to}${query}`);
      const followed = await get(res.headers.get("location")!);
      expect(followed.status, `GET ${to} with ${src}`).toBe(200);
    }
  });
});

test("every documented drawing endpoint is served", async () => {
  const endpoints = await documentedEndpoints();
  expect(endpoints).toHaveLength(6);
  for (const path of endpoints) {
    const served = await Promise.all(
      Object.values(FIXTURES).map(async (body) => (await post(path, body)).status),
    );
    expect(served, path).toContain(200);
  }
});

test("errors on the PDF and agnostic endpoints do not speak of DXF (INV-12)", async () => {
  for (const path of ["/describe-pdf", "/render-pdf", "/describe-doc", "/render-doc"]) {
    const unparsable = await post(path, "%PDF-1.7 truncated");
    expect(unparsable.status).toBe(422);
    expect(JSON.stringify(await unparsable.json()), path).not.toMatch(/dxf/i);

    const missing = await get(path);
    expect(missing.status).toBe(400);
    expect(JSON.stringify(await missing.json()), path).not.toMatch(/dxf/i);
  }
});
