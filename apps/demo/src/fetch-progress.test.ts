import { afterEach, expect, test } from "vite-plus/test";
import { FetchError, fetchWithProgress, isHttpUrl, type FetchProgress } from "./fetch-progress.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const enc = new TextEncoder();

/** A Response-like whose body streams the given chunks through a reader. */
function streamingResponse(
  chunks: string[],
  init: { ok?: boolean; status?: number; contentLength?: string | null } = {},
): Response {
  let i = 0;
  const headers = new Map<string, string>();
  if (init.contentLength !== null) {
    const total = init.contentLength ?? String(chunks.join("").length);
    headers.set("content-length", total);
  }
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: {
      getReader: () => ({
        read: () =>
          i < chunks.length
            ? Promise.resolve({ done: false, value: enc.encode(chunks[i++]) })
            : Promise.resolve({ done: true, value: undefined }),
      }),
    },
  } as unknown as Response;
}

test("rejects a non-http(s) scheme before fetching", async () => {
  let fetched = false;
  globalThis.fetch = (() => {
    fetched = true;
    return Promise.reject(new Error("should not be called"));
  }) as typeof fetch;
  await expect(fetchWithProgress("file:///etc/passwd")).rejects.toMatchObject({ kind: "scheme" });
  await expect(fetchWithProgress("javascript:alert(1)")).rejects.toBeInstanceOf(FetchError);
  expect(fetched).toBe(false);
});

test("streams chunks into one buffer and reports byte/percent progress", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(streamingResponse(["hel", "lo!"], { contentLength: "6" }))) as typeof fetch;
  const seen: FetchProgress[] = [];
  const buf = await fetchWithProgress("https://x/a.dxf", { onProgress: (p) => seen.push(p) });
  expect(new TextDecoder().decode(buf)).toBe("hello!");
  expect(buf.byteLength).toBe(6);
  expect(seen.at(-1)).toEqual({ loaded: 6, total: 6 });
  expect(seen.some((p) => p.loaded === 3 && p.total === 6)).toBe(true);
});

test("reports a null total when Content-Length is absent", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(streamingResponse(["abc"], { contentLength: null }))) as typeof fetch;
  const seen: FetchProgress[] = [];
  await fetchWithProgress("https://x/a.dxf", { onProgress: (p) => seen.push(p) });
  expect(seen.at(-1)).toEqual({ loaded: 3, total: null });
});

test("classifies a failed fetch as a network error", async () => {
  globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
  await expect(fetchWithProgress("https://blocked/a.dxf")).rejects.toMatchObject({
    kind: "network",
  });
});

test("classifies a non-OK response as an http error carrying the status", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(streamingResponse([], { ok: false, status: 404 }))) as typeof fetch;
  await expect(fetchWithProgress("https://x/missing.dxf")).rejects.toMatchObject({
    kind: "http",
    status: 404,
  });
});

test("lets an AbortError propagate untouched so cancels aren't shown as failures", async () => {
  globalThis.fetch = (() => {
    const err = new Error("aborted");
    err.name = "AbortError";
    return Promise.reject(err);
  }) as typeof fetch;
  await expect(fetchWithProgress("https://x/a.dxf")).rejects.toMatchObject({ name: "AbortError" });
});

test("isHttpUrl accepts http(s) and rejects everything else", () => {
  expect(isHttpUrl("https://example.com/a.dxf")).toBe(true);
  expect(isHttpUrl("http://example.com/a.dxf")).toBe(true);
  expect(isHttpUrl("ftp://example.com/a.dxf")).toBe(false);
  expect(isHttpUrl("/local/relative.dxf")).toBe(false);
  expect(isHttpUrl("not a url")).toBe(false);
});
