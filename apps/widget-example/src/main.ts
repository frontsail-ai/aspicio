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
  /** Drawing served to this config; defaults to the DXF sample. */
  sampleUrl?: string;
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
      bytesBase64: bytesToBase64(sample),
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
      bytesBase64: bytesToBase64(sample),
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
      bytesBase64: bytesToBase64(sample),
      byteLength: sample.byteLength,
      allowFilePicker: false,
    }),
  },
  {
    // Light theming only shows in fullscreen chrome — the inline mode is a
    // full-bleed canvas, and the canvas stays dark in both themes.
    id: "fullscreen-light",
    label: "Fullscreen · light · 920×600",
    width: 920,
    height: 600,
    theme: "light",
    displayMode: "fullscreen",
    meta: (sample) => ({
      bytesBase64: bytesToBase64(sample),
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
        bytesBase64: bytesToBase64(bytes),
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
    id: "inline-pdf",
    label: "Inline · PDF (vector content)",
    width: 920,
    height: 540,
    theme: "dark",
    displayMode: "inline",
    sampleUrl: "/sample.pdf",
    meta: (sample) => ({
      bytesBase64: bytesToBase64(sample),
      byteLength: sample.byteLength,
      allowFilePicker: false,
    }),
  },
  {
    id: "inline-pdf-layers",
    label: "Inline · PDF with optional-content layers",
    width: 920,
    height: 540,
    theme: "dark",
    displayMode: "inline",
    sampleUrl: "/layered.pdf",
    meta: (sample) => ({
      bytesBase64: bytesToBase64(sample),
      byteLength: sample.byteLength,
      allowFilePicker: false,
    }),
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
        bytesBase64: bytesToBase64(slice),
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

const samples = new Map<string, Uint8Array>();
const sampleFor = async (config: ShowcaseConfig): Promise<Uint8Array> => {
  const url = config.sampleUrl ?? "/sample.dxf";
  const cached = samples.get(url);
  if (cached) return cached;
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  samples.set(url, bytes);
  return bytes;
};
for (const config of CONFIGS) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.id = config.id;
  button.textContent = config.label;
  button.addEventListener("click", () => void sampleFor(config).then((s) => show(config, s)));
  nav.append(button);
}
void sampleFor(CONFIGS[0]).then((s) => show(CONFIGS[0], s));
