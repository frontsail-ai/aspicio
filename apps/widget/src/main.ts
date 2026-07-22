/**
 * The in-chat DXF viewer widget (AGT-14), implementing the approved design
 * spec ("DXF Viewer Widget.dc.html"): inline mode is a full-bleed canvas with
 * a floating control cluster and a status chip; fullscreen adds host-themed
 * chrome and a docked layer sidebar; non-happy states replace the canvas
 * entirely. Chrome follows host theme tokens with per-theme fallbacks; the
 * canvas and everything floating on it stay dark in both themes.
 *
 * The widget shows exactly the drawing the tool call delivered — there is no
 * way to open another file unless the server sets `allowFilePicker` (the flag
 * is the reserved gate; no picker UI exists yet).
 */
import { DxfViewer, isEmptyLayer } from "@aspicio/core";
import type { LayerInfo } from "@aspicio/core";
import { App } from "@modelcontextprotocol/ext-apps";
import type { McpUiDisplayMode } from "@modelcontextprotocol/ext-apps";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { INLINE_EMBED_BYTES, LOAD_CHUNK_BYTES, LOAD_TOOL_NAME, type LoadResult } from "./meta.ts";
import {
  actionForToolResult,
  base64ToBytes,
  concatChunks,
  cssColor,
  formatBytes,
  layerDisplayNames,
  statusChip,
  type ViewerAction,
} from "./state.ts";

const CANVAS_BG = 0x16181d; // theme-fixed: CAD linework needs a dark canvas

// ---------------------------------------------------------------------------
// Styles — host tokens with per-theme fallbacks (design spec, section 06).
// ---------------------------------------------------------------------------

/** Document-level: theme tokens (the host-facing interface — hosts supply
 * the outer variables) and page sizing. Everything structural lives inside
 * the shadow root, out of reach of host-injected stylesheets. */
const TOKEN_STYLE = `
  :root {
    --w-sans: var(--font-sans, system-ui, -apple-system, sans-serif);
    --w-mono: var(--font-mono, ui-monospace, Menlo, monospace);
    --w-r-sm: var(--border-radius-sm, 2px);
    --w-r-md: var(--border-radius-md, 5px);
  }
  :root[data-theme="light"] {
    --w-frame-bg: var(--color-background-primary, #FCFAF4);
    --w-panel-bg: var(--color-background-secondary, #FFFFFF);
    --w-hover-bg: var(--color-background-tertiary, #F1ECDE);
    --w-text: var(--color-text-primary, #1B1812);
    --w-text-2: var(--color-text-secondary, #5A5345);
    --w-border: var(--color-border-primary, #C2BAA8);
    --w-hairline: var(--color-border-primary, #DCD5C5);
    --w-link: #1F52B5;
    --w-shadow: var(--shadow-md, 0 2px 6px rgba(27,24,18,0.16), 0 1px 2px rgba(27,24,18,0.10));
  }
  :root[data-theme="dark"] {
    --w-frame-bg: var(--color-background-primary, #211E17);
    --w-panel-bg: var(--color-background-secondary, #24211B);
    --w-hover-bg: var(--color-background-tertiary, #2A261D);
    --w-text: var(--color-text-primary, #EDE9DE);
    --w-text-2: var(--color-text-secondary, #A69D8B);
    --w-border: var(--color-border-primary, #4A4436);
    --w-hairline: var(--color-border-primary, #3D382C);
    --w-link: #8FB0EC;
    --w-shadow: var(--shadow-md, 0 2px 8px rgba(0,0,0,0.4));
  }
  html, body { margin: 0; height: 100%; }
`;

const STYLE = `
  :host { display: block; height: 100%; }
  button { font-family: inherit; }

  #root { display: flex; flex-direction: column; height: 100%; min-height: 220px; background: var(--w-frame-bg); font-family: var(--w-sans); }

  /* Fullscreen top bar (hidden inline) */
  #chrome { height: 44px; flex: none; display: none; align-items: center; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--w-hairline); }
  #root[data-mode="fullscreen"] #chrome { display: flex; }
  #chrome .label { font-family: var(--w-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--w-text-2); }
  #chrome .vsep { width: 1px; height: 16px; background: var(--w-hairline); }
  #chrome .mono { font-family: var(--w-mono); font-size: 11px; letter-spacing: 0.06em; color: var(--w-text-2); font-feature-settings: 'tnum' 1, 'zero' 1; }
  #chrome .actions { margin-left: auto; display: flex; gap: 6px; }
  /* A degraded state has no layers to report and nothing to fit. */
  #root:not([data-state="loaded"]) #chip-fs,
  #root:not([data-state="loaded"]) #chrome .vsep,
  #root:not([data-state="loaded"]) #fit-fs { display: none; }
  .chrome-btn { height: 28px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; background: var(--w-panel-bg); border: 1px solid var(--w-border); border-radius: var(--w-r-sm); color: var(--w-text); font: 500 12px var(--w-sans); cursor: pointer; }
  .chrome-btn:hover { border-color: var(--w-text-2); }
  .chrome-btn.icon { width: 28px; padding: 0; }

  #body { flex: 1; min-height: 0; display: flex; }
  #stage { flex: 1; min-width: 0; position: relative; background: #16181d; }
  #viewer { position: absolute; inset: 0; }
  #root:not([data-state="loaded"]) #viewer { visibility: hidden; }

  /* State card — replaces the canvas, theme-fixed on dark */
  #state { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: #16181d; text-align: center; }
  #root:not([data-state="loaded"]) #state { display: flex; }
  #state .card { display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 380px; padding: 0 20px; }
  #state .title { font-family: var(--w-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #9AA1AD; }
  #state .title.danger { color: #E8756B; }
  #state .figure { font-family: var(--w-mono); font-size: 22px; font-weight: 500; color: #DFE3EA; font-feature-settings: 'tnum' 1, 'zero' 1; }
  #state .figure .dim { color: #5A6270; font-size: 14px; }
  #state .msg { font-size: 13.5px; color: #C6CBD4; line-height: 1.5; }
  #state .sub { font-size: 12.5px; color: #6B7280; }
  #state .oc-btn { margin-top: 4px; }
  #state .compact-size { display: none; }
  @media (max-width: 400px) {
    #state .card { gap: 10px; }
    #state .msg { font-size: 12.5px; line-height: 1.45; }
    #state .sub, #state .figure { display: none; }
    #state .compact-size { display: inline; }
  }
  @keyframes crease-march { to { stroke-dashoffset: -12; } }
  .crease { animation: crease-march 1.2s linear infinite; }
  @keyframes dot-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
  #state .dots { display: flex; gap: 6px; }
  #state .dots span { width: 5px; height: 5px; background: #5A6270; }
  #state .dots span:nth-child(1) { animation: dot-pulse 1.2s ease-in-out 0s infinite; }
  #state .dots span:nth-child(2) { animation: dot-pulse 1.2s ease-in-out 0.2s infinite; }
  #state .dots span:nth-child(3) { animation: dot-pulse 1.2s ease-in-out 0.4s infinite; }

  /* On-canvas controls — theme-fixed dark translucent (design 1a) */
  .oc-btn { height: 30px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; background: rgba(22,24,29,0.82); border: 1px solid rgba(255,255,255,0.14); border-radius: var(--w-r-sm); color: #DFE3EA; font: 500 12px var(--w-sans); cursor: pointer; }
  .oc-btn:hover { border-color: rgba(255,255,255,0.35); }
  .oc-btn.icon { width: 30px; padding: 0; }
  .oc-btn[aria-expanded="true"] { background: rgba(45,108,223,0.22); border-color: #2D6CDF; color: #9DBCF3; }

  /* The container is a hit-target hole: with buttons hidden at rest it must
   * not eat canvas clicks/drags. Buttons re-enable their own events. */
  #cluster { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; pointer-events: none; }
  #cluster > button { pointer-events: auto; }
  #root[data-mode="fullscreen"] #cluster, #root:not([data-state="loaded"]) #cluster { display: none; }
  #expand-btn { margin-left: 4px; }
  @media (hover: hover) {
    #root[data-mode="inline"] #layers-btn, #root[data-mode="inline"] #fit-btn { opacity: 0; pointer-events: none; transition: opacity 0.15s; }
    #root:hover #layers-btn, #root:hover #fit-btn, #root:focus-within #layers-btn, #root:focus-within #fit-btn { opacity: 1; pointer-events: auto; }
  }

  #chip { position: absolute; left: 10px; bottom: 10px; font-family: var(--w-mono); font-size: 10.5px; letter-spacing: 0.06em; color: #9AA1AD; background: rgba(22,24,29,0.78); border: 1px solid rgba(255,255,255,0.12); border-radius: var(--w-r-sm); padding: 4px 9px; font-feature-settings: 'tnum' 1, 'zero' 1; }
  #root[data-mode="fullscreen"] #chip, #root:not([data-state="loaded"]) #chip { display: none; }

  /* Layer list — shared row markup, two homes (overlay card / docked sidebar) */
  .layers-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px 7px; border-bottom: 1px solid var(--w-hairline); flex: none; }
  .layers-head .h { font-family: var(--w-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--w-text-2); }
  .layers-head .links { display: flex; gap: 8px; }
  .layers-head .links button { background: none; border: none; padding: 0; color: var(--w-link); cursor: pointer; font: 500 11px var(--w-sans); }
  .layer-rows { overflow-y: auto; padding: 4px 0; }
  /* position: relative is load-bearing: it makes each row the containing
   * block for its visually-hidden absolute checkbox. Without it the
   * checkboxes resolve against #panel, pile up as phantom scrollable
   * overflow, and label-click focus makes the browser scroll the
   * overflow-hidden panel itself — clipping the whole list out of view. */
  .layer-rows label { position: relative; display: flex; align-items: center; gap: 8px; padding: 5px 10px; cursor: pointer; }
  .layer-rows label:hover { background: var(--w-hover-bg); }
  .layer-rows label.off { opacity: 0.55; }
  .layer-rows input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .layer-rows .box { width: 14px; height: 14px; flex: none; border-radius: var(--w-r-sm); background: #2D6CDF; display: flex; align-items: center; justify-content: center; }
  .layer-rows label.off .box { background: transparent; border: 1.5px solid var(--w-border); }
  .layer-rows label.off .box svg { display: none; }
  .layer-rows input:focus-visible + .box { outline: 2px solid #2D6CDF; outline-offset: 1px; }
  /* The 1px keyline keeps white/yellow swatches legible on the light panel
   * (and near-black ones on the dark panel) — DXF color 7 is white. */
  .layer-rows .swatch { width: 18px; flex: none; border-top: 3px solid transparent; box-shadow: 0 0 0 1px var(--w-border); }
  .layer-rows .name { font: 400 13px var(--w-sans); color: var(--w-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Collapsible empty-layers group (AGT-14): 0-entity layers, collapsed. */
  .empty-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; background: none; border: none; border-top: 1px solid var(--w-hairline); cursor: pointer; color: var(--w-text-2); font: 500 11px var(--w-mono); letter-spacing: 0.06em; text-transform: uppercase; }
  .empty-head:hover { background: var(--w-hover-bg); }
  .empty-head .chevron { display: inline-flex; transition: transform 140ms; }
  .empty-head[aria-expanded="true"] .chevron { transform: rotate(90deg); }
  .empty-head .empty-label { flex: 1; text-align: left; }
  .empty-head .empty-count { color: var(--w-text-2); }
  @media (prefers-reduced-motion: reduce) { .empty-head .chevron { transition: none; } }

  #panel { position: absolute; top: 46px; right: 10px; width: 216px; max-height: calc(100% - 56px); background: var(--w-panel-bg); border: 1px solid var(--w-border); border-radius: var(--w-r-md); box-shadow: var(--w-shadow); overflow: hidden; display: none; flex-direction: column; }
  #root[data-mode="inline"][data-state="loaded"] #panel.open { display: flex; }

  #sidebar { width: 240px; flex: none; border-left: 1px solid var(--w-hairline); display: none; flex-direction: column; background: var(--w-frame-bg); }
  #root[data-mode="fullscreen"][data-state="loaded"] #sidebar { display: flex; }
  #sidebar .layers-head { padding: 10px 12px 9px; }
  #sidebar .layer-rows { flex: 1; }
  #sidebar .layer-rows label { padding: 6px 12px; }
  #sidebar .hint { flex: none; padding: 10px 12px; border-top: 1px solid var(--w-hairline); font-family: var(--w-mono); font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--w-text-2); line-height: 1.7; }
`;

// ---------------------------------------------------------------------------
// Icons (inline SVG, stroke = currentColor)
// ---------------------------------------------------------------------------

const svg = (paths: string, size = 14): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  layers: svg(
    '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>',
  ),
  chevron: svg('<path d="m9 18 6-6-6-6"/>'),
  fit: svg(
    '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
  ),
  expand: svg(
    '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    15,
  ),
  collapse: svg(
    '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
  ),
  check:
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  warn: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E8756B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  box: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#5A6270" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
  drawing: `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#5A6270" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M12 5v14" stroke="#2D6CDF" stroke-dasharray="3 3" class="crease"/></svg>`,
  copy: svg(
    '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  ),
};

// ---------------------------------------------------------------------------
// DOM scaffold
// ---------------------------------------------------------------------------

document.documentElement.dataset.theme = "dark";
document.head.appendChild(document.createElement("style")).textContent = TOKEN_STYLE;
// Shadow DOM: hosts (ChatGPT) inject their own stylesheets into widget
// documents, which corrupted the layer panel in the wild. Document styles
// cannot pierce the shadow boundary; the theme variables above still
// inherit through — the one host influence we want.
const shadowHost = document.body.appendChild(document.createElement("div"));
// The host element is the one light-DOM piece a host stylesheet can still
// reach. Inline !important outranks any author stylesheet in the cascade,
// so reset everything and pin the two properties the layout needs.
shadowHost.style.cssText =
  "all: initial !important; display: block !important; height: 100% !important;";
const shadow = shadowHost.attachShadow({ mode: "open" });
shadow.innerHTML = `<style>${STYLE}</style>
  <div id="root" data-mode="inline" data-state="preparing">
    <div id="chrome">
      <span class="label">DXF drawing</span>
      <span class="vsep"></span>
      <span class="mono" id="chip-fs"></span>
      <span class="actions">
        <button id="fit-fs" class="chrome-btn" type="button" aria-label="Fit view">${ICONS.fit} Fit</button>
        <button id="collapse-btn" class="chrome-btn icon" type="button" aria-label="Exit fullscreen">${ICONS.collapse}</button>
      </span>
    </div>
    <div id="body">
      <div id="stage">
        <div id="viewer"></div>
        <div id="state"></div>
        <div id="cluster">
          <button id="layers-btn" class="oc-btn" type="button" aria-label="Toggle layer panel" aria-expanded="false">${ICONS.layers} Layers</button>
          <button id="fit-btn" class="oc-btn" type="button" aria-label="Fit view">${ICONS.fit} Fit</button>
          <button id="expand-btn" class="oc-btn icon" type="button" aria-label="Expand">${ICONS.expand}</button>
        </div>
        <div id="panel"></div>
        <div id="chip"></div>
      </div>
      <div id="sidebar"></div>
    </div>
  </div>
`;

const el = (id: string): HTMLElement => shadow.getElementById(id) as HTMLElement;
const root = el("root");

const viewer = new DxfViewer(el("viewer"), { background: CANVAS_BG });

// ---------------------------------------------------------------------------
// State cards (replace the canvas — never overlay a stale drawing)
// ---------------------------------------------------------------------------

const SUGGESTED_REQUEST =
  "Please render the drawing as an image instead (render_dxf) — it is too large for the interactive viewer.";

function showPreparing(): void {
  root.dataset.state = "preparing";
  el("state").innerHTML = `
    <div class="card">
      ${ICONS.drawing}
      <div class="title">Preparing drawing</div>
      <div class="msg">Waiting for the drawing from the assistant…</div>
      <div class="dots"><span></span><span></span><span></span></div>
    </div>`;
}

/** The widget is pulling the drawing itself (large file, not embedded). */
function showLoading(byteLength: number): void {
  root.dataset.state = "preparing";
  el("state").innerHTML = `
    <div class="card">
      ${ICONS.drawing}
      <div class="title">Loading drawing</div>
      <div class="msg">Fetching ${formatBytes(byteLength)} into the viewer…</div>
      <div class="dots"><span></span><span></span><span></span></div>
    </div>`;
}

/** A result explicitly carried no drawing — distinct from still waiting. */
function showMissing(): void {
  root.dataset.state = "preparing";
  el("state").innerHTML = `
    <div class="card">
      ${ICONS.drawing}
      <div class="title">No drawing in this result</div>
      <div class="msg">This tool result carried no drawing data.</div>
      <div class="sub">Ask the assistant to open the drawing again.</div>
    </div>`;
}

/** Parsed fine, but nothing drawable — distinct from a load failure. */
function showEmpty(): void {
  root.dataset.state = "empty";
  el("state").innerHTML = `
    <div class="card">
      ${ICONS.drawing}
      <div class="title">Drawing is empty</div>
      <div class="msg">The file parsed, but it contains no drawable entities.</div>
      <div class="sub">Ask the assistant to inspect the file (describe_dxf shows what's inside).</div>
    </div>`;
}

function showError(detail: string): void {
  root.dataset.state = "error";
  el("state").innerHTML = `
    <div class="card">
      ${ICONS.warn}
      <div class="title danger">Could not load drawing</div>
      <div class="msg"></div>
      <div class="sub">Ask the assistant to check or re-send the file.</div>
    </div>`;
  (el("state").querySelector(".msg") as HTMLElement).textContent = detail;
}

function showTooLarge(byteLength: number): void {
  root.dataset.state = "toolarge";
  el("state").innerHTML = `
    <div class="card">
      ${ICONS.box}
      <div class="title">Too large to view inline<span class="compact-size"> · ${formatBytes(byteLength)}</span></div>
      <div class="figure">${formatBytes(byteLength)} <span class="dim">/ ${formatBytes(INLINE_EMBED_BYTES)} inline limit</span></div>
      <div class="msg">The drawing was passed as inline text and can't be handed to the viewer. Ask the assistant to host it at a URL, or render an image of it instead.</div>
      <button id="copy-btn" class="oc-btn" type="button" aria-label="Copy suggested request">${ICONS.copy} Copy suggested request</button>
    </div>`;
  el("copy-btn").addEventListener("click", () => {
    // Hosts often sandbox the widget iframe without clipboard permission —
    // and some strip the API entirely, so an absent `clipboard` must take
    // the same fallback path, not silently no-op.
    const copied = navigator.clipboard
      ? navigator.clipboard.writeText(SUGGESTED_REQUEST)
      : Promise.reject(new Error("clipboard unavailable"));
    copied.then(
      () => {
        el("copy-btn").textContent = "Copied";
      },
      () => {
        // Say what happened on the button and surface the text to select.
        el("copy-btn").textContent = "Copy blocked — select the text above";
        const msg = el("state").querySelector(".msg") as HTMLElement;
        msg.textContent = SUGGESTED_REQUEST;
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Layer list — one row set, rendered into panel (inline) and sidebar (fullscreen)
// ---------------------------------------------------------------------------

// data-i is the layer's index in getLayers() — kept stable across the split so
// wireLayerHome/syncLayerRows can look it up regardless of which group holds it.
function rowMarkup(layer: LayerInfo, i: number): string {
  return `<label class="${layer.visible ? "" : "off"}" data-i="${i}">
        <input type="checkbox" ${layer.visible ? "checked" : ""}>
        <span class="box">${ICONS.check}</span>
        <span class="swatch"></span>
        <span class="name"></span>
      </label>`;
}

function layersMarkup(): string {
  const layers = viewer.getLayers();
  const shown: string[] = [];
  const empty: string[] = [];
  // Empty (0-entity) layers go into a collapsed group, omitted when there are
  // none — shared classification with the demo via core's isEmptyLayer.
  layers.forEach((layer, i) => (isEmptyLayer(layer) ? empty : shown).push(rowMarkup(layer, i)));
  const emptyGroup = empty.length
    ? `<button type="button" class="empty-head" aria-expanded="false">
        <span class="chevron">${ICONS.chevron}</span><span class="empty-label">Empty</span><span class="empty-count">${empty.length}</span>
      </button>
      <div class="layer-rows empty-rows" hidden>${empty.join("")}</div>`
    : "";
  return `
    <div class="layers-head">
      <span class="h">Layers · ${layers.length}</span>
      <span class="links">
        <button type="button" data-all="1" aria-label="Show all layers">All</button>
        <button type="button" data-all="0" aria-label="Hide all layers">None</button>
      </span>
    </div>
    <div class="layer-rows">${shown.join("")}</div>
    ${emptyGroup}`;
}

function wireLayerHome(home: HTMLElement): void {
  home.innerHTML = layersMarkup();
  // Names go in via textContent — layer names are drawing data, not markup.
  // Swatch colors go in via the CSSOM: hosts ship CSPs that refuse to parse
  // inline style attributes (style-src-attr), but programmatic assignment
  // is exempt.
  const layers = viewer.getLayers();
  const names = layerDisplayNames(layers.map((l) => l.name));
  for (const label of home.querySelectorAll("label")) {
    const layer = layers[Number(label.dataset.i)];
    (label.querySelector(".name") as HTMLElement).textContent =
      names[Number(label.dataset.i)].display;
    label.title = layer.name;
    (label.querySelector(".swatch") as HTMLElement).style.borderTopColor = cssColor(
      layer.effectiveColors?.[0] ?? layer.color,
    );
    const input = label.querySelector("input") as HTMLInputElement;
    input.addEventListener("change", () => {
      viewer.setLayerVisible(layer.name, input.checked);
      syncLayerRows();
    });
  }
  for (const btn of home.querySelectorAll<HTMLButtonElement>("[data-all]")) {
    btn.addEventListener("click", () => {
      const visible = btn.dataset.all === "1";
      for (const layer of layers) viewer.setLayerVisible(layer.name, visible);
      syncLayerRows();
    });
  }
  // The empty-layers group toggles its own rows (collapsed by default).
  const emptyHead = home.querySelector<HTMLButtonElement>(".empty-head");
  const emptyRows = home.querySelector<HTMLElement>(".empty-rows");
  if (emptyHead && emptyRows) {
    emptyHead.addEventListener("click", () => {
      const open = emptyHead.getAttribute("aria-expanded") === "true";
      emptyHead.setAttribute("aria-expanded", String(!open));
      emptyRows.hidden = open;
      emptyHead.classList.toggle("open", !open);
    });
  }
}

/** Reflect current visibility into both homes without rebuilding them. */
function syncLayerRows(): void {
  const layers = viewer.getLayers();
  for (const home of [el("panel"), el("sidebar")]) {
    for (const label of home.querySelectorAll("label")) {
      const layer = layers[Number(label.dataset.i)];
      if (!layer) continue;
      const input = label.querySelector("input") as HTMLInputElement;
      input.checked = layer.visible;
      label.classList.toggle("off", !layer.visible);
    }
  }
}

const HINT_HTML = `<div class="hint">Drag to pan · Scroll to zoom<br>Double-click to fit</div>`;

function renderLayers(): void {
  wireLayerHome(el("panel"));
  const sidebar = el("sidebar");
  wireLayerHome(sidebar);
  sidebar.insertAdjacentHTML("beforeend", HINT_HTML);
}

/** Self-heal a layer home: hosts have been observed mangling widget DOM
 * (ChatGPT's style/DOM machinery emptied the panel in the wild). If rows no
 * longer match the drawing, rebuild them — opening must always work. */
function healLayerHome(home: HTMLElement, withHint: boolean): void {
  if (root.dataset.state !== "loaded") return;
  if (home.querySelectorAll("label").length === viewer.getLayers().length) return;
  wireLayerHome(home);
  if (withHint) home.insertAdjacentHTML("beforeend", HINT_HTML);
}

// ---------------------------------------------------------------------------
// Panel open/close (inline overlay) — outside click and Esc close it
// ---------------------------------------------------------------------------

function setPanelOpen(open: boolean): void {
  if (open) {
    healLayerHome(el("panel"), false);
    // Overflow-hidden boxes are still programmatically scrollable; if
    // anything ever displaces the panel again, reopening must cure it.
    el("panel").scrollTop = 0;
  }
  el("panel").classList.toggle("open", open);
  el("layers-btn").setAttribute("aria-expanded", String(open));
}

el("layers-btn").addEventListener("click", (ev) => {
  ev.stopPropagation();
  setPanelOpen(!el("panel").classList.contains("open"));
});
el("panel").addEventListener("click", (ev) => ev.stopPropagation());
document.addEventListener("click", () => setPanelOpen(false));
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") setPanelOpen(false);
});

// ---------------------------------------------------------------------------
// Display modes and theme
// ---------------------------------------------------------------------------

function setMode(mode: McpUiDisplayMode): void {
  root.dataset.mode = mode === "fullscreen" ? "fullscreen" : "inline";
  if (mode === "fullscreen") healLayerHome(el("sidebar"), true);
  setPanelOpen(false);
}

function setTheme(theme: string | undefined): void {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
}

el("expand-btn").addEventListener("click", () => {
  void app.requestDisplayMode({ mode: "fullscreen" }).then((r) => setMode(r.mode));
});
el("collapse-btn").addEventListener("click", () => {
  void app.requestDisplayMode({ mode: "inline" }).then((r) => setMode(r.mode));
});
el("fit-btn").addEventListener("click", () => viewer.fitView({ animate: true }));
el("fit-fs").addEventListener("click", () => viewer.fitView({ animate: true }));

// Re-fit when the host resizes the widget (inline card → expanded, etc.) so
// the drawing is never left cropped by a size change.
let refit: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
  if (root.dataset.state !== "loaded") return;
  clearTimeout(refit);
  refit = setTimeout(() => viewer.fitView(), 120);
}).observe(el("stage"));

// ---------------------------------------------------------------------------
// Tool results → widget state
// ---------------------------------------------------------------------------

/** Tell the model what actually happened in the widget — success and failure
 * alike — so follow-up turns reason from facts, not guesses. Best-effort:
 * hosts without the capability just don't get the update. */
function reportStatus(text: string): void {
  void app
    .updateModelContext({ content: [{ type: "text", text: `[Aspicio viewer status] ${text}` }] })
    .catch(() => {});
}

/** Pull the drawing through the app-only load tool: whole-file first, then
 * byte-range chunks if the single response is capped or truncated. */
/** Per-request cap so a host that accepts the call but never answers can't
 * strand the widget in "Loading…" (SDK default is 60s; chunks compound). */
const PULL_TIMEOUT_MS = 30_000;

async function pullDrawing(source: string, byteLength: number): Promise<ArrayBuffer> {
  const call = async (args: Record<string, unknown>): Promise<LoadResult> => {
    const r = await app.callServerTool(
      { name: LOAD_TOOL_NAME, arguments: { source, ...args } },
      { timeout: PULL_TIMEOUT_MS },
    );
    if (r.isError) {
      const text = (r.content as Array<{ text?: string }> | undefined)?.[0]?.text;
      throw new Error(text ?? "the drawing could not be fetched");
    }
    const sc = r.structuredContent as LoadResult | undefined;
    if (!sc?.dxfBase64) throw new Error("the host returned no drawing data");
    return sc;
  };
  try {
    const full = await call({});
    const bytes = base64ToBytes(full.dxfBase64);
    if (bytes.byteLength === full.byteLength) return bytes;
    // Truncated single-shot — fall through to chunked retrieval.
  } catch (err) {
    // A timeout means the host is silent — chunk calls would only re-wait
    // the same 30s each. Fail now instead of compounding.
    if ((err as { code?: number }).code === ErrorCode.RequestTimeout)
      throw new Error("the host did not respond to the drawing request");
    // Any other failure (host cap, transient) — try chunks before giving up.
  }
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < byteLength; offset += LOAD_CHUNK_BYTES) {
    const part = await call({ offset, length: LOAD_CHUNK_BYTES });
    chunks.push(new Uint8Array(base64ToBytes(part.dxfBase64)));
  }
  return concatChunks(chunks);
}

// Each tool result bumps the generation; async work from an older result
// (a slow pull racing a fresh drawing) checks it before touching the UI.
let generation = 0;

async function showDrawing(bytes: ArrayBuffer, byteLength: number, gen: number): Promise<void> {
  if (gen !== generation) return;
  await viewer.load(bytes);
  if (gen !== generation) return;
  if (viewer.stats.entityCount === 0) {
    showEmpty();
    reportStatus(
      "loaded: the drawing contains no drawable entities, so there is nothing to display. Use describe_dxf to inspect the file.",
    );
    return;
  }
  renderLayers();
  const chip = statusChip(viewer.getLayers().length, byteLength);
  el("chip").textContent = chip;
  el("chip-fs").textContent = chip;
  root.dataset.state = "loaded";
  viewer.fitView();
  reportStatus(`loaded: ${chip.toLowerCase()} rendered interactively.`);
}

async function apply(action: ViewerAction, gen: number): Promise<void> {
  switch (action.kind) {
    case "load":
      await showDrawing(action.bytes, action.byteLength, gen);
      break;
    case "pull": {
      showLoading(action.byteLength);
      const bytes = await pullDrawing(action.source, action.byteLength);
      await showDrawing(bytes, action.byteLength, gen);
      break;
    }
    case "too-large":
      showTooLarge(action.byteLength);
      reportStatus(
        `failed: drawing not shown — inline source of ${formatBytes(action.byteLength)} exceeds the ${formatBytes(INLINE_EMBED_BYTES)} embed limit. Pass an http(s) URL instead, or use render_dxf.`,
      );
      break;
    case "missing":
      showMissing();
      reportStatus(
        "failed: the tool result carried no drawing payload (the host may have dropped it). Call view_dxf again with the drawing's URL.",
      );
      break;
  }
}

const app = new App({ name: "aspicio-viewer", version: "0.0.0" }, {});
// Register before connect() so a result replayed during the handshake lands.
app.ontoolresult = (result) => {
  const action = actionForToolResult(result);
  const gen = ++generation;
  void apply(action, gen).catch((err: Error) => {
    if (gen !== generation) return; // a newer result owns the UI now
    // The core parse error is already person-facing ("Not a valid DXF file",
    // "The file is empty") — show it as-is rather than prefixing our own.
    const detail =
      action.kind === "pull"
        ? `Could not load the drawing — ${err.message}.`
        : err.message
          ? `${err.message}.`
          : "The file isn't valid DXF.";
    showError(detail);
    reportStatus(`failed: ${detail}`);
  });
};
app.onhostcontextchanged = (ctx) => {
  setTheme(ctx.theme);
  if (ctx.displayMode) setMode(ctx.displayMode);
};

showPreparing();
await app.connect();
const ctx = app.getHostContext();
setTheme(ctx?.theme);
if (ctx?.displayMode) setMode(ctx.displayMode);
