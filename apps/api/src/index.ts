import { initWasm, Resvg } from "@resvg/resvg-wasm";
// wrangler compiles a `.wasm` import to a ready WebAssembly.Module.
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { handleRequest, type RenderPng } from "./handler.ts";

// resvg's WASM is initialized once per isolate.
let resvgReady: Promise<unknown> | null = null;
const renderPng: RenderPng = async (svg, width) => {
  resvgReady ??= initWasm(resvgWasm);
  await resvgReady;
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
};

export default {
  fetch(req: Request): Promise<Response> {
    return handleRequest(req, renderPng);
  },
};
