/**
 * The in-chat DXF viewer widget (AGT-14). Runs inside a host-sandboxed
 * iframe; receives the drawing via the MCP Apps `ui/notifications/tool-result`
 * notification and renders it with the real WebGL viewer. It shows exactly
 * the drawing the tool call delivered — there is no way to open another file
 * unless the server set `allowFilePicker` (no picker UI exists yet; the flag
 * is the reserved gate).
 */
import { DxfViewer } from "@aspicio/core";
import { App } from "@modelcontextprotocol/ext-apps";
import { actionForToolResult, cssColor, type ViewerAction } from "./state.ts";

const BACKGROUND = 0x16181d; // matches the API's default render background

const STYLE = `
  html, body { margin: 0; height: 100%; }
  body { background: #16181d; color: #cfd3dc; font: 13px/1.4 system-ui, sans-serif; }
  #root { display: flex; flex-direction: column; height: 100%; min-height: 320px; }
  #toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 8px; }
  #toolbar button {
    background: #262a33; color: inherit; border: 1px solid #3a3f4b;
    border-radius: 6px; padding: 3px 10px; cursor: pointer;
  }
  #toolbar button:hover { background: #2f3440; }
  #status { margin-left: auto; opacity: 0.7; }
  #stage { position: relative; flex: 1; min-height: 0; }
  #viewer { position: absolute; inset: 0; }
  #layers {
    position: absolute; top: 8px; left: 8px; max-height: calc(100% - 16px);
    overflow-y: auto; background: #1d2027ee; border: 1px solid #3a3f4b;
    border-radius: 8px; padding: 6px 10px; display: none;
  }
  #layers.open { display: block; }
  #layers label { display: flex; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }
  #layers .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
`;

document.head.appendChild(document.createElement("style")).textContent = STYLE;
document.body.innerHTML = `
  <div id="root">
    <div id="toolbar">
      <button id="toggle-layers" type="button">Layers</button>
      <button id="fit" type="button">Fit</button>
      <span id="status">Waiting for a drawing…</span>
    </div>
    <div id="stage">
      <div id="viewer"></div>
      <div id="layers"></div>
    </div>
  </div>
`;

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const status = (text: string): void => {
  el("status").textContent = text;
};

const viewer = new DxfViewer(el("viewer"), { background: BACKGROUND });

el("fit").addEventListener("click", () => viewer.fitView({ animate: true }));
el("toggle-layers").addEventListener("click", () => el("layers").classList.toggle("open"));

function renderLayerPanel(): void {
  const panel = el("layers");
  panel.textContent = "";
  for (const layer of viewer.getLayers()) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = layer.visible;
    box.addEventListener("change", () => viewer.setLayerVisible(layer.name, box.checked));
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = cssColor(layer.effectiveColors?.[0] ?? layer.color);
    const name = document.createElement("span");
    name.textContent = layer.name;
    label.append(box, swatch, name);
    panel.appendChild(label);
  }
}

async function apply(action: ViewerAction): Promise<void> {
  switch (action.kind) {
    case "load":
      await viewer.load(action.bytes);
      renderLayerPanel();
      status(`${viewer.getLayers().length} layers`);
      break;
    case "too-large":
      status(
        `Drawing too large for inline viewing (${(action.byteLength / 1024 / 1024).toFixed(1)} MB)`,
      );
      break;
    case "missing":
      status("No drawing in the tool result");
      break;
  }
}

const app = new App({ name: "aspicio-viewer", version: "0.0.0" }, {});
// Register before connect() so a result replayed during the handshake lands.
app.ontoolresult = (result) => {
  void apply(actionForToolResult(result)).catch((err: Error) => {
    status(`Could not load drawing: ${err.message}`);
  });
};
await app.connect();
