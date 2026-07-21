/**
 * Static showcase for the MCP Apps widget: renders apps/widget's built
 * widget.html in an iframe and plays the host side of the MCP Apps
 * protocol with AppBridge — no server, no chat client. Each predefined
 * configuration varies the drawing, iframe size, theme, and display
 * mode; the pull config also serves the widget's chunked
 * load_dxf_for_viewer calls.
 */
import { INLINE_EMBED_BYTES, LOAD_TOOL_NAME, VIEWER_META_KEY } from "@aspicio/widget/meta";
import type { ViewerMeta } from "@aspicio/widget/meta";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

interface ShowcaseConfig {
  id: string;
  label: string;
  width: number;
  height: number;
  theme: "dark" | "light";
  displayMode: "inline" | "fullscreen";
  meta: (sample: Uint8Array) => ViewerMeta;
  /** When set, the fake host serves load_dxf_for_viewer from these bytes. */
  pullBytes?: (sample: Uint8Array) => Uint8Array;
}

const EMPTY_DXF = "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const CONFIGS: ShowcaseConfig[] = [
  {
    id: "inline-dark-small",
    label: "Inline · dark · 520×300",
    width: 520,
    height: 300,
    theme: "dark",
    displayMode: "inline",
    meta: (sample) => ({
      dxfBase64: bytesToBase64(sample),
      byteLength: sample.byteLength,
      allowFilePicker: false,
    }),
  },
  {
    id: "inline-light-large",
    label: "Inline · light · 920×540",
    width: 920,
    height: 540,
    theme: "light",
    displayMode: "inline",
    meta: (sample) => ({
      dxfBase64: bytesToBase64(sample),
      byteLength: sample.byteLength,
      allowFilePicker: false,
    }),
  },
  {
    id: "fullscreen-dark",
    label: "Fullscreen · dark · 920×600",
    width: 920,
    height: 600,
    theme: "dark",
    displayMode: "fullscreen",
    meta: (sample) => ({
      dxfBase64: bytesToBase64(sample),
      byteLength: sample.byteLength,
      allowFilePicker: false,
    }),
  },
  {
    id: "empty-drawing",
    label: "Empty drawing",
    width: 520,
    height: 300,
    theme: "dark",
    displayMode: "inline",
    meta: () => {
      const bytes = new TextEncoder().encode(EMPTY_DXF);
      return {
        dxfBase64: bytesToBase64(bytes),
        byteLength: bytes.byteLength,
        allowFilePicker: false,
      };
    },
  },
  {
    id: "too-large",
    label: "Too-large state card",
    width: 520,
    height: 300,
    theme: "dark",
    displayMode: "inline",
    meta: () => ({ tooLarge: true, byteLength: 48_000_000, allowFilePicker: false }),
  },
  {
    id: "pull-chunked",
    label: "Pull path (chunked fetch)",
    width: 920,
    height: 540,
    theme: "dark",
    displayMode: "inline",
    // Over the embed cap → widget pulls via load_dxf_for_viewer.
    meta: (sample) => ({
      source: "showcase://sample.dxf",
      byteLength: Math.max(sample.byteLength, INLINE_EMBED_BYTES + 1),
      allowFilePicker: false,
    }),
    pullBytes: (sample) => sample,
  },
];

declare global {
  interface Window {
    /** e2e hooks: currently shown config id and per-config readiness. */
    __showcase?: { current: string; ready: boolean };
  }
}

const nav = document.getElementById("configs");
const holder = document.getElementById("frame-holder");
const metaLine = document.getElementById("meta");
if (!nav || !holder || !metaLine) throw new Error("missing page structure");

let activeBridge: AppBridge | null = null;

async function show(config: ShowcaseConfig, sample: Uint8Array): Promise<void> {
  window.__showcase = { current: config.id, ready: false };
  for (const b of nav!.querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(b.dataset.id === config.id));
  metaLine!.textContent =
    `${config.width}×${config.height} · ${config.theme} · ${config.displayMode}` +
    (config.pullBytes ? " · served in byte-range chunks by the fake host" : "");

  await activeBridge?.close().catch(() => {});
  activeBridge = null;
  holder!.textContent = "";

  const iframe = document.createElement("iframe");
  iframe.width = String(config.width);
  iframe.height = String(config.height);
  iframe.src = "/widget.html";
  holder!.append(iframe);
  await new Promise((resolve) => iframe.addEventListener("load", resolve, { once: true }));

  const bytes = config.pullBytes?.(sample);
  const bridge = new AppBridge(
    null, // no MCP client — manual handlers below
    { name: "aspicio-widget-showcase", version: "0.0.0" },
    { serverTools: {}, openLinks: {} },
    {
      hostContext: {
        theme: config.theme,
        displayMode: config.displayMode,
        availableDisplayModes: ["inline", "fullscreen"],
        containerDimensions: { width: config.width, height: config.height },
      },
    },
  );
  activeBridge = bridge;
  bridge.onupdatemodelcontext = async () => ({});
  bridge.onrequestdisplaymode = async ({ mode }) => {
    bridge.setHostContext({ displayMode: mode });
    return { mode };
  };
  bridge.oncalltool = async ({ name, arguments: args }) => {
    if (name !== LOAD_TOOL_NAME || !bytes) return { content: [], isError: true };
    const offset = (args?.offset as number | undefined) ?? 0;
    const length = (args?.length as number | undefined) ?? bytes.byteLength;
    const slice = bytes.slice(offset, offset + length);
    return {
      content: [],
      structuredContent: {
        dxfBase64: bytesToBase64(slice),
        byteLength: bytes.byteLength,
        offset,
      },
    };
  };
  bridge.oninitialized = () => {
    bridge
      .sendToolResult({
        content: [{ type: "text", text: "Opened in the interactive viewer." }],
        structuredContent: {},
        _meta: { [VIEWER_META_KEY]: config.meta(sample) },
      })
      .then(() => {
        if (window.__showcase?.current === config.id) window.__showcase.ready = true;
      })
      .catch(() => {});
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
}

const sample = new Uint8Array(await (await fetch("/sample.dxf")).arrayBuffer());
for (const config of CONFIGS) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.id = config.id;
  button.textContent = config.label;
  button.addEventListener("click", () => void show(config, sample));
  nav.append(button);
}
void show(CONFIGS[0], sample);
