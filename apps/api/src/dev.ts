// Local dev server (`vp run dev`) — serves the same platform-free handler
// the Vercel deploy uses, with native resvg. No rate limiting locally (same
// as the deployed entries: the platform owns that). Build the widget first
// if you need view_dxf's viewer resource:
//   vp run -F @aspicio/core -F @aspicio/widget build
import { existsSync, readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { handleRequest, type RenderPng } from "./handler.ts";

// Self-declared to keep bun-types out of the package: this file is the only
// Bun-API user, and the check tsconfig stays WebWorker-flavored.
declare const Bun: {
  serve(options: { port: number; fetch(req: Request): Response | Promise<Response> }): unknown;
};

const renderPng: RenderPng = async (svg, width) =>
  new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();

const widgetPath = new URL("../../widget/dist/widget.html", import.meta.url).pathname;
const widgetHtml = existsSync(widgetPath) ? readFileSync(widgetPath, "utf8") : undefined;
if (!widgetHtml)
  console.warn(
    "widget dist missing — view_dxf's viewer resource will 404 until you build @aspicio/widget",
  );

const port = Number(process.env.PORT ?? 8788);
Bun.serve({ port, fetch: (req) => handleRequest(req, renderPng, undefined, widgetHtml) });
console.log(`aspicio-api dev server → http://localhost:${port}`);
