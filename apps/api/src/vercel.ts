// Vercel Node-function entry — same 30-line shim shape as the Workers entry
// (index.ts), with the platform pieces swapped: native resvg instead of WASM,
// and no in-code rate limiter (the platform WAF rule enforces AGT-4; see
// AGT-5 for the 429-body caveat).
import { Resvg } from "@resvg/resvg-js";
import widgetHtml from "../../widget/dist/widget.html?raw";
import { handleRequest, type RenderPng } from "./handler.ts";

const renderPng: RenderPng = async (svg, width) =>
  new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();

export default {
  fetch(req: Request): Promise<Response> {
    return handleRequest(req, renderPng, undefined, widgetHtml);
  },
};
