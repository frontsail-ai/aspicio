import { initWasm, Resvg } from "@resvg/resvg-wasm";
// wrangler compiles a `.wasm` import to a ready WebAssembly.Module.
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { type CheckRateLimit, handleRequest, type RenderPng } from "./handler.ts";

interface Env {
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

// resvg's WASM is initialized once per isolate.
let resvgReady: Promise<unknown> | null = null;
const renderPng: RenderPng = async (svg, width) => {
  resvgReady ??= initWasm(resvgWasm);
  await resvgReady;
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
};

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    // Fail open if the binding is absent (local dev without simulation) —
    // loudly, so an accidental unprotected production deploy is detectable.
    if (!env.RATE_LIMITER)
      console.warn("RATE_LIMITER binding absent — serving without rate limits");
    const checkRateLimit: CheckRateLimit | undefined = env.RATE_LIMITER
      ? async (key) => (await env.RATE_LIMITER!.limit({ key })).success
      : undefined;
    return handleRequest(req, renderPng, checkRateLimit);
  },
};
