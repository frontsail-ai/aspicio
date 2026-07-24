import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./style.css";
import { DxfViewer, attachShortcuts, niceLength, partitionLayers } from "@aspicio/core";
import type { EntityInfo, LayerInfo, PickedEntity, Point2, SnapResult } from "@aspicio/core";
import { decodeView, encodeView, packLayers } from "./viewurl.ts";
import type { ViewLink } from "./viewurl.ts";
import { FetchError, fetchWithProgress, isHttpUrl } from "./fetch-progress.ts";
import type { FetchErrorKind, FetchProgress } from "./fetch-progress.ts";
import { clearRecents, loadRecents, pushRecent } from "./recents.ts";
import { formatBytes } from "./format.ts";

/* ---------- SVG fragments ---------- */

const reticle = (size: number, stroke: string, ticks: string): string => `
  <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="7.4" stroke="${stroke}" stroke-width="1.5"></circle>
    <path d="M12 1.6 V4.5 M12 19.5 V22.4 M1.6 12 H4.5 M19.5 12 H22.4"
      stroke="${ticks}" stroke-width="1.5" stroke-linecap="round"></path>
    <circle cx="12" cy="12" r="2.5" fill="var(--cut)"></circle>
  </svg>`;

const icons = {
  layers: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 17 9 5 9-5"></path></svg>`,
  file: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>`,
  filePlus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"></path><path d="M14 2v6h6"></path><path d="M12 12v5"></path><path d="M9.5 14.5h5"></path></svg>`,
  warn: (size: number) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>`,
  close: (size: number) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>`,
  compass: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"></path><path d="m12 2-2.5 4h5z" fill="var(--cut)" stroke="var(--cut)"></path><circle cx="12" cy="13" r="8"></circle></svg>`,
  plus: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>`,
  minus: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14"></path></svg>`,
  fit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg>`,
  ruler: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 2.3 2.3 14.7a1 1 0 0 0 0 1.4l5.6 5.6a1 1 0 0 0 1.4 0L21.7 9.3a1 1 0 0 0 0-1.4l-5.6-5.6a1 1 0 0 0-1.4 0Z"></path><path d="M6 12l2 2M9 9l2 2M12 6l2 2M15 15l2 2"></path></svg>`,
  download: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path></svg>`,
  drop: `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--crease)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"></path><path d="m7 11 5 5 5-5"></path><path d="M5 21h14"></path></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="var(--crease)"></rect><path d="M4.4 8.2 L6.9 10.6 L11.6 5.3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>`,
  chevron: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>`,
  uncheck: `<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="var(--hairline2)" stroke-width="1.4"></rect></svg>`,
  link: (size: number): string =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`,
  clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>`,
  dropArrow: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--crease)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"></path><path d="m7 11 5 5 5-5"></path><path d="M5 21h14"></path></svg>`,
};

/* ---------- markup ---------- */

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

const DESKTOP_HINTS: [string, string][] = [
  ["DRAG", "pan"],
  ["SCROLL", "zoom"],
  ["⇧+DRAG", "rotate"],
  ["CLICK", "select entity"],
  ["HOVER", "highlight layer"],
  ["CLICK ROW", "toggle layer"],
  ["2×CLICK ROW", "solo layer"],
  ["?", "shortcuts"],
];

/** Keyboard shortcuts shown in the ? cheat sheet. */
const SHORTCUTS: [string, string][] = [
  ["F", "Fit to view"],
  ["+ / −", "Zoom in / out"],
  ["R", "Reset rotation"],
  ["M", "Measure tool"],
  ["A", "Show all layers"],
  ["I", "Isolate selected layer"],
  ["H", "Hide selected layer"],
  ["C", "Copy selection details"],
  ["Esc", "Cancel / clear selection"],
  ["?", "Toggle this help"],
];

app.innerHTML = `
  <header class="topbar">
    <div class="brand">${reticle(22, "var(--text)", "var(--text2)")}<span class="brand-name">ASPICIO</span></div>
    <div class="statusbar">
      <span class="vdiv"></span>
      <span id="loading-status" class="loading-status" hidden>
        <span class="loading-dot"></span><span id="loading-text"></span>
      </span>
      <span id="file-status" class="file-status" hidden>
        <span id="file-chip" class="file-chip"></span>
        <span id="stats" class="stats"></span>
        <button id="skipped-btn" class="skipped-btn" type="button" hidden>
          ${icons.warn(12)}<span id="skipped-count"></span>
        </button>
      </span>
    </div>
    <div class="topbar-actions">
      <button id="toggle-layers" class="btn-ghost layers-toggle" type="button">${icons.layers} Layers</button>
      <div class="export-wrap">
        <button id="export-btn" class="btn-ghost export-btn" type="button" hidden>${icons.download} Export</button>
        <div id="export-pop" class="export-pop" hidden>
          <button id="export-svg" class="export-item" type="button">SVG <span class="export-note">vector · whole drawing</span></button>
          <button id="export-png" class="export-item" type="button">PNG <span class="export-note">current view</span></button>
        </div>
      </div>
      <button id="load-sample" class="btn-ghost sample-btn" type="button">${icons.file} Sample</button>
      <button id="open" class="btn-primary" type="button">${icons.filePlus} Open DXF</button>
    </div>
    <div id="progress" class="progress" hidden><div class="progress-bar"></div></div>
    <div id="skipped-pop" class="skipped-pop" hidden>
      <div class="skipped-pop-title">UNSUPPORTED ENTITIES SKIPPED</div>
      <div id="skipped-detail" class="skipped-pop-detail"></div>
      <div class="skipped-pop-note">These types aren't rendered yet. The rest of the drawing is complete.</div>
    </div>
  </header>
  <div class="body">
    <aside id="panel" class="panel asp-scroll">
      <div class="panel-head">
        <div class="panel-title">LAYERS <span id="layer-count" class="count-badge">0</span></div>
        <button id="show-all" class="show-all-btn" type="button" hidden>Show all</button>
        <button id="close-panel" class="panel-close" type="button">${icons.close(18)}</button>
      </div>
      <div id="solo-banner" class="solo-banner" hidden>
        <span class="solo-banner-label">SOLO</span>
        <span id="solo-name" class="solo-banner-name"></span>
        <button id="exit-solo" class="solo-banner-exit" type="button">EXIT</button>
      </div>
      <ul id="layer-list" class="layer-list asp-scroll"></ul>
      <div class="hints">${DESKTOP_HINTS.map(
        ([k, v]) => `<span class="hint-k">${k}</span><span class="hint-v">${v}</span>`,
      ).join("")}</div>
    </aside>
    <div id="panel-backdrop" class="panel-backdrop" hidden></div>
    <main class="viewer-wrap">
      <div class="grid-bg"></div>
      <div id="viewer" class="viewer"></div>
      <div id="empty-state" class="empty-state">
        <div class="empty-inner">
          ${reticle(52, "var(--text2)", "var(--text3)")}
          <div class="empty-kicker">NO DRAWING LOADED</div>
          <h1 class="empty-title">Open a DXF to view it</h1>
          <div class="empty-body">Drop a file anywhere in the window, pick one from your machine, or load the bundled sample.</div>
          <div class="empty-actions">
            <button id="empty-open" class="btn-primary" type="button">Open DXF</button>
            <button id="empty-sample" class="btn-ghost" type="button">Load sample</button>
          </div>
          <div class="empty-supports">SUPPORTS · LINE · POLYLINE · CIRCLE · ARC · ELLIPSE · SPLINE · TEXT · MTEXT · INSERT · DIMENSION · HATCH · SOLID · POINT</div>
          <nav class="empty-links" aria-label="Project links">
            <a href="/docs/">Docs</a>
            <a href="/mcp/">MCP</a>
            <a href="https://github.com/frontsail-ai/aspicio" target="_blank" rel="noopener">GitHub</a>
            <a href="https://www.npmjs.com/package/@aspicio/core" target="_blank" rel="noopener">npm</a>
            <a href="/privacy/">Privacy</a>
            <a href="/terms/">Terms</a>
          </nav>
        </div>
      </div>
      <div id="error-toast" class="error-toast" hidden>
        <div class="error-card">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--err)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>
          <div class="error-content">
            <div id="error-title" class="error-title"></div>
            <div id="error-msg" class="error-msg"></div>
            <div class="error-actions">
              <button id="error-open" class="alt" type="button">Choose another file</button>
              <button id="error-sample" class="quiet" type="button">Load sample instead</button>
            </div>
          </div>
          <button id="error-dismiss" class="error-dismiss" type="button">${icons.close(16)}</button>
        </div>
      </div>
      <div id="controls" class="controls" hidden>
        <button id="measure-btn" class="ctrl" type="button" title="Measure (M)">${icons.ruler}</button>
        <button id="reset-rot" class="ctrl" type="button" title="Reset rotation">${icons.compass}</button>
        <div class="ctrl-stack">
          <button id="zoom-in" type="button" title="Zoom in">${icons.plus}</button>
          <button id="fit-btn" type="button" title="Fit to view">${icons.fit}</button>
          <button id="zoom-out" type="button" title="Zoom out">${icons.minus}</button>
        </div>
      </div>
      <svg id="measure-overlay" class="measure-overlay" hidden></svg>
      <div id="space-tabs" class="space-tabs" hidden></div>
      <div id="readout" class="readout" hidden>
        <span class="readout-chip">ZOOM <span id="zoom-pct">100</span>%</span>
        <span class="readout-chip">ROT <span id="rot-deg">0</span>°</span>
        <span class="readout-chip">X <span id="cur-x">–</span> Y <span id="cur-y">–</span></span>
      </div>
      <div id="scale-bar" class="scale-bar" hidden>
        <span id="scale-line" class="scale-line"></span>
        <span id="scale-label" class="scale-label">—</span>
      </div>
      <div id="measure-card" class="measure-card" hidden>
        <span class="measure-hint">MEASURE · click to add points · Esc to clear</span>
        <div class="measure-rows">
          <span class="measure-k">SEG</span><span id="measure-seg" class="measure-v">–</span>
          <span class="measure-k">TOTAL</span><span id="measure-total" class="measure-v">–</span>
          <span class="measure-k">AREA</span><span id="measure-area" class="measure-v">–</span>
        </div>
      </div>
      <aside id="info-panel" class="info-panel" hidden>
        <div class="info-head">
          <span id="info-type" class="info-type">—</span>
          <button id="info-close" class="info-close" type="button">${icons.close(15)}</button>
        </div>
        <div id="info-rows" class="info-rows"></div>
        <div class="info-actions">
          <button id="info-isolate" class="info-action" type="button" title="Isolate layer (I)">Isolate</button>
          <button id="info-hide" class="info-action" type="button" title="Hide layer (H)">Hide</button>
          <button id="info-copy" class="info-action" type="button" title="Copy details (C)">Copy</button>
        </div>
      </aside>
    </main>
  </div>
  <input id="file" type="file" accept=".dxf" hidden>
  <div id="drop" class="drop-overlay" hidden>
    <div class="drop-frame">
      ${icons.drop}
      <div class="drop-title">DROP DXF TO OPEN</div>
      <div class="drop-sub">.dxf files only · released anywhere</div>
    </div>
  </div>
  <div id="shortcuts" class="shortcuts-overlay" hidden>
    <div class="shortcuts-card">
      <div class="shortcuts-head">
        <span class="shortcuts-title">KEYBOARD SHORTCUTS</span>
        <button id="shortcuts-close" class="shortcuts-close" type="button">${icons.close(16)}</button>
      </div>
      <div class="shortcuts-grid">${SHORTCUTS.map(
        ([k, v]) => `<kbd class="sc-key">${k}</kbd><span class="sc-desc">${v}</span>`,
      ).join("")}</div>
    </div>
  </div>
  <div id="open-dialog" class="od-scrim" hidden>
    <div id="od-card" class="od-card">
      <div class="od-head">
        <div class="od-head-title">${icons.filePlus}<span>OPEN DXF</span></div>
        <button id="od-close" class="od-close" type="button">${icons.close(18)}</button>
      </div>
      <div class="od-body">
        <div id="od-form" class="od-form">
          <button id="od-dropzone" class="od-dropzone" type="button">
            ${icons.dropArrow}
            <div>
              <div class="od-dz-title">Drop a .dxf file here</div>
              <div class="od-dz-sub">or click to browse your machine</div>
            </div>
            <div class="od-dz-note">.DXF · ASCII OR BINARY · PARSED LOCALLY, NEVER UPLOADED</div>
          </button>
          <div class="od-divider">
            <span class="od-divider-line"></span>
            <span class="od-divider-label">OR OPEN FROM A URL</span>
            <span class="od-divider-line"></span>
          </div>
          <label class="od-label" for="od-input">DRAWING URL</label>
          <div class="od-input-row">
            <div class="od-input-wrap">
              <span class="od-input-icon">${icons.link(15)}</span>
              <input id="od-input" class="od-input" type="text" inputmode="url"
                placeholder="https://example.com/drawing.dxf" spellcheck="false" autocomplete="off">
            </div>
            <button id="od-open" class="od-open" type="button" disabled>Open</button>
          </div>
          <div id="od-invalid" class="od-invalid" hidden>${icons.warn(13)}<span>Enter a full http(s):// URL</span></div>
          <div id="od-recents" class="od-recents" hidden>
            <div class="od-recents-head">
              <span class="od-recents-title">RECENT</span>
              <button id="od-clear" class="od-clear" type="button">CLEAR</button>
            </div>
            <div id="od-recents-list" class="od-recents-list"></div>
          </div>
        </div>
        <div id="od-loading" class="od-loading" hidden>
          <div class="od-loading-head">
            <span class="od-loading-dot"></span>
            <span id="od-loading-name" class="od-loading-name">FETCHING DRAWING</span>
          </div>
          <div class="od-bar"><div id="od-bar-fill" class="od-bar-fill"></div></div>
          <div class="od-bytes">
            <span id="od-loaded">0 B</span>
            <span id="od-pct" class="od-pct">0%</span>
          </div>
          <button id="od-cancel" class="od-cancel" type="button">Cancel</button>
        </div>
        <div id="od-cors" class="od-cors" hidden>
          <div class="od-cors-card">
            <span class="od-cors-icon">${icons.warn(18)}</span>
            <div class="od-cors-content">
              <div id="od-cors-title" class="od-cors-title">Couldn't fetch that URL</div>
              <div id="od-cors-msg" class="od-cors-msg"></div>
              <div id="od-cors-url" class="od-cors-url"></div>
            </div>
          </div>
          <div class="od-try">
            <div class="od-try-title">TRY THIS</div>
            <div id="od-tip-status" class="od-try-item"><span class="od-try-dot">·</span><span id="od-tip-status-text"></span></div>
            <div id="od-tip-download" class="od-try-item"><span class="od-try-dot">·</span><span>Download the file, then <button id="od-try-file" class="od-try-link" type="button">drop it in</button> above.</span></div>
            <div id="od-tip-direct" class="od-try-item"><span class="od-try-dot">·</span><span>Check the link points directly at a <span class="od-lit">.dxf</span> (not an HTML page).</span></div>
            <div id="od-tip-cors" class="od-try-item"><span class="od-try-dot">·</span><span>Host it somewhere CORS-enabled (S3 with public read, a raw GitHub URL, etc.).</span></div>
          </div>
          <div class="od-cors-actions">
            <button id="od-retry" class="od-retry" type="button">Try again</button>
            <button id="od-edit" class="od-edit" type="button">Edit URL</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div id="paste-toast" class="paste-toast" hidden>
    <div class="paste-card">
      <span class="paste-icon">${icons.link(18)}</span>
      <div class="paste-content">
        <div class="paste-title">Open this DXF link?</div>
        <div id="paste-url" class="paste-url"></div>
        <div class="paste-actions">
          <button id="paste-open" class="paste-open" type="button">Open</button>
          <button id="paste-dismiss" class="paste-dismiss" type="button">Dismiss</button>
        </div>
      </div>
      <button id="paste-close" class="paste-close" type="button">${icons.close(16)}</button>
    </div>
  </div>
`;

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = app.querySelector<T>(selector);
  if (!el) throw new Error(`${selector} not found`);
  return el;
};

// The measure overlay is an <svg>, which the HTMLElement-typed `$` can't return.
// It's part of the static template above, so the query never misses.
const measureOverlay = app.querySelector<SVGSVGElement>("#measure-overlay")!;

/* ---------- state ---------- */

type Mode = "empty" | "loading" | "loaded" | "error";

const viewerEl = $<HTMLElement>("#viewer");
const viewer = new DxfViewer(viewerEl, { background: null });

let mode: Mode = "empty";
let currentName = "";
let soloLayer: string | null = null;
let hoveredLayer: string | null = null;
let hoverSource: "row" | "canvas" | null = null;
let baselineZoom = 1;
// Deep-link view state. Only the bundled sample is URL-addressable, so we only
// share/restore links for it; a drag-dropped file can't be re-fetched from a URL.
let currentSourceLinkable = false;
// The remote URL the current drawing was fetched from, or null for the sample /
// a local file. Written into the share hash as `src=` so remote loads are
// shareable and auto-restore on reload.
let currentSourceUrl: string | null = null;
let pendingLink: ViewLink | null = null;
let restoringView = false;
let hashWriteTimer: number | null = null;
const layerRows = new Map<string, HTMLLIElement>();

// Open-DXF dialog state. The dropzone and URL field live together in one form;
// `phase` overlays loading/cors/invalid onto it (see renderDialog).
let dialogOpen = false;
let dialogPhase: "idle" | "loading" | "cors" | "invalid" = "idle";
let dialogAbort: AbortController | null = null;
let pastedUrl = "";

// Interaction state for entity selection and the measure tool.
let selectedIndex: number | null = null;
let selected: PickedEntity | null = null;
let measureActive = false;
let measurePoints: Point2[] = [];
let measureCursor: Point2 | null = null;
let measureSnap: SnapResult | null = null;

/* ---------- mode / chrome ---------- */

function setMode(next: Mode): void {
  mode = next;
  const loaded = mode === "loaded";
  $("#empty-state").hidden = loaded || mode === "loading";
  $("#loading-status").hidden = mode !== "loading";
  $("#progress").hidden = mode !== "loading";
  $("#file-status").hidden = !loaded;
  $("#controls").hidden = !loaded;
  $("#readout").hidden = !loaded;
  $("#scale-bar").hidden = !loaded;
  $("#export-btn").hidden = !loaded;
  if (!loaded) $("#export-pop").hidden = true;
  if (!loaded) $("#space-tabs").hidden = true;
  if (!loaded) $("#shortcuts").hidden = true;
  if (!loaded) {
    clearSelection();
    setMeasureActive(false);
  }
  if (mode !== "error") $("#error-toast").hidden = true;
}

function showError(name: string, message: string): void {
  // Keep the previous drawing (if any) visible under the toast.
  setMode(viewer.document ? "loaded" : "empty");
  $("#error-title").textContent = `Couldn't open ${name}`;
  $("#error-msg").textContent = message;
  $("#error-toast").hidden = false;
}

/* ---------- layer visibility / solo (matches the design prototype) ---------- */

function isVisible(name: string): boolean {
  if (soloLayer) return name === soloLayer;
  return viewer.getLayers().find((l) => l.name === name)?.visible !== false;
}

/** Single click: toggle the layer in normal mode, or leave solo (show all). */
function toggleLayer(name: string): void {
  if (soloLayer) {
    exitSolo();
    return;
  }
  const layer = viewer.getLayers().find((l) => l.name === name);
  viewer.setLayerVisible(name, layer?.visible === false);
  syncPanel();
}

/** Double click: solo the layer, or (already soloing) leave solo showing all but it. */
function toggleSolo(name: string): void {
  if (soloLayer) {
    // Exit solo, showing every layer EXCEPT the clicked one — the inverse of solo.
    soloLayer = null;
    for (const layer of viewer.getLayers()) viewer.setLayerVisible(layer.name, layer.name !== name);
  } else {
    soloLayer = name;
    for (const layer of viewer.getLayers()) viewer.setLayerVisible(layer.name, layer.name === name);
  }
  syncPanel();
}

function exitSolo(): void {
  soloLayer = null;
  for (const layer of viewer.getLayers()) viewer.setLayerVisible(layer.name, true);
  syncPanel();
}

/* ---------- hover (row ↔ canvas) ---------- */

function setHover(name: string | null, source: "row" | "canvas" | null): void {
  if (name === hoveredLayer && source === hoverSource) return;
  hoveredLayer = name;
  hoverSource = name ? source : null;
  viewer.setLayerHighlight(name);
  for (const [layerName, row] of layerRows) {
    row.classList.toggle("reverse", layerName === name && hoverSource === "canvas");
  }
}

/* ---------- number formatting ---------- */

/** Compact drawing-unit number: trims trailing zeros, caps decimals. */
function fmt(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  return Number(n.toFixed(digits)).toString();
}

/* ---------- entity selection + info panel ---------- */

// The 4th element is the measurement's unit kind (null = a bare count).
const INFO_FIELDS: [keyof EntityInfo, string, (v: number) => string, "linear" | "area" | null][] = [
  ["length", "LENGTH", fmt, "linear"],
  ["radius", "RADIUS", fmt, "linear"],
  ["area", "AREA", fmt, "area"],
  ["points", "POINTS", (v) => String(v), null],
];

function showInfo(picked: PickedEntity): void {
  const { info } = picked;
  $("#info-type").textContent = info.type;
  const rows: string[] = [];
  rows.push(`<span class="info-k">LAYER</span><span class="info-v">${info.layer}</span>`);
  const rgb = info.color;
  if (rgb !== null) {
    const hex = `#${rgb.toString(16).padStart(6, "0")}`;
    rows.push(
      `<span class="info-k">COLOR</span><span class="info-v"><span class="info-swatch" style="background:${hex}"></span>${hex}</span>`,
    );
  }
  for (const [key, label, format, unit] of INFO_FIELDS) {
    const value = info[key];
    if (typeof value === "number") {
      const rowLabel = key === "length" ? lengthLabel(info) : label;
      const suffix = unit ? measureSuffix(unit) : "";
      rows.push(
        `<span class="info-k">${rowLabel}</span><span class="info-v">${format(value)}${suffix}</span>`,
      );
    }
  }
  if (info.position) {
    rows.push(
      `<span class="info-k">AT</span><span class="info-v">${fmt(info.position.x)}, ${fmt(info.position.y)}</span>`,
    );
  }
  if (info.text) {
    rows.push(`<span class="info-k">TEXT</span><span class="info-v">${info.text}</span>`);
  }
  $("#info-rows").innerHTML = rows.join("");
  $("#info-panel").hidden = false;
}

function clearSelection(): void {
  if (selectedIndex === null && $("#info-panel").hidden) return;
  selectedIndex = null;
  selected = null;
  viewer.setSelection(null);
  $("#info-panel").hidden = true;
}

function selectAt(clientX: number, clientY: number): void {
  const rect = viewerEl.getBoundingClientRect();
  const picked = viewer.pickEntity(clientX - rect.left, clientY - rect.top);
  if (!picked) {
    clearSelection();
    return;
  }
  selectedIndex = picked.index;
  selected = picked;
  viewer.setSelection(picked.index);
  // Dock the panel in the corner opposite the click so it never covers the
  // selection (DEMO-8). Set before showInfo unhides it — no flash.
  $("#info-panel").dataset.side = clientX - rect.left > rect.width / 2 ? "left" : "right";
  showInfo(picked);
}

/* ---------- selection actions (isolate / hide / copy) ---------- */

/** Show only the given layer (solo it) — used to isolate a selected entity. */
function isolateLayer(name: string): void {
  soloLayer = name;
  for (const layer of viewer.getLayers()) viewer.setLayerVisible(layer.name, layer.name === name);
  syncPanel();
}

/** Hide the selected entity's layer and drop the (now invisible) selection. */
function hideSelectedLayer(): void {
  if (!selected) return;
  if (soloLayer) soloLayer = null;
  viewer.setLayerVisible(selected.layer, false);
  clearSelection();
  syncPanel();
}

/** Show every layer again (leave solo, unhide all). */
function showAllLayers(): void {
  exitSolo();
}

/** Copy the selected entity's details to the clipboard as a plain-text block. */
function copySelection(): void {
  if (!selected) return;
  const { info } = selected;
  const lines = [info.type, `layer: ${info.layer}`];
  if (info.color !== null) lines.push(`color: #${info.color.toString(16).padStart(6, "0")}`);
  if (info.length !== undefined)
    lines.push(`${lengthLabel(info).toLowerCase()}: ${fmt(info.length)}${measureSuffix("linear")}`);
  if (info.radius !== undefined)
    lines.push(`radius: ${fmt(info.radius)}${measureSuffix("linear")}`);
  if (info.area !== undefined) lines.push(`area: ${fmt(info.area)}${measureSuffix("area")}`);
  if (info.points !== undefined) lines.push(`points: ${info.points}`);
  if (info.position) lines.push(`at: ${fmt(info.position.x)}, ${fmt(info.position.y)}`);
  if (info.text) lines.push(`text: ${info.text}`);
  // Best-effort — clipboard needs a secure context and may be unavailable.
  void navigator.clipboard?.writeText(lines.join("\n")).then(
    () => flashCopied(),
    () => {},
  );
}

/** Briefly confirm a copy on the info panel's Copy button. */
function flashCopied(): void {
  const btn = $<HTMLButtonElement>("#info-copy");
  const prev = btn.textContent;
  btn.textContent = "Copied";
  window.setTimeout(() => {
    btn.textContent = prev;
  }, 1100);
}

/* ---------- measure tool ---------- */

function setMeasureActive(active: boolean): void {
  measureActive = active;
  measurePoints = [];
  measureCursor = null;
  measureSnap = null;
  $("#measure-btn").classList.toggle("active", active);
  viewerEl.classList.toggle("measuring", active);
  $("#measure-card").hidden = !active;
  if (active) {
    // Measuring and selecting are separate modes.
    clearSelection();
    setHover(null, null);
  }
  renderMeasure();
}

function clearMeasure(): void {
  measurePoints = [];
  renderMeasure();
}

/** Total path length and (for ≥3 points) the shoelace area. */
function measureTotals(points: Point2[]): { total: number; area: number } {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  let area = 0;
  if (points.length >= 3) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) / 2;
  }
  return { total, area };
}

/** Redraw the measure overlay (points are stored in world space). */
/** An SVG snap marker at (sx, sy), shaped by the snap kind. */
function snapMarker(kind: SnapResult["kind"], sx: number, sy: number): string {
  const c = "measure-snap";
  if (kind === "center") return `<circle class="${c}" cx="${sx}" cy="${sy}" r="5.5" fill="none" />`;
  if (kind === "midpoint")
    return `<path class="${c}" fill="none" d="M${sx - 5} ${sy + 4} L${sx + 5} ${sy + 4} L${sx} ${sy - 5} Z" />`;
  if (kind === "node")
    return `<path class="${c}" d="M${sx - 5} ${sy - 5} L${sx + 5} ${sy + 5} M${sx - 5} ${sy + 5} L${sx + 5} ${sy - 5}" />`;
  // endpoint — a square
  return `<rect class="${c}" x="${sx - 4.5}" y="${sy - 4.5}" width="9" height="9" fill="none" />`;
}

function renderMeasure(): void {
  const overlay = measureOverlay;
  if (!measureActive) {
    overlay.toggleAttribute("hidden", true);
    return;
  }
  overlay.toggleAttribute("hidden", false);
  const screen = measurePoints.map((p) => viewer.worldToScreen(p));
  const parts: string[] = [];
  const chain = [...screen];
  if (measureCursor && screen.length > 0) chain.push(viewer.worldToScreen(measureCursor));
  if (chain.length >= 2) {
    const d = chain.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
    parts.push(`<path class="measure-line" d="${d}" />`);
  }
  for (const p of screen)
    parts.push(`<circle class="measure-dot" cx="${p.x}" cy="${p.y}" r="3.5" />`);
  // Snap marker under the cursor, shaped by kind.
  if (measureSnap) {
    const s = viewer.worldToScreen(measureSnap.point);
    parts.push(snapMarker(measureSnap.kind, s.x, s.y));
  }
  // Per-segment length labels at each committed segment midpoint.
  for (let i = 1; i < screen.length; i++) {
    const a = screen[i - 1];
    const b = screen[i];
    const len = Math.hypot(
      measurePoints[i].x - measurePoints[i - 1].x,
      measurePoints[i].y - measurePoints[i - 1].y,
    );
    parts.push(
      `<text class="measure-label" x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 6}">${fmt(len)}</text>`,
    );
  }
  overlay.innerHTML = parts.join("");

  const totals = measureTotals(measurePoints);
  const live =
    measureCursor && measurePoints.length > 0
      ? Math.hypot(
          measureCursor.x - measurePoints[measurePoints.length - 1].x,
          measureCursor.y - measurePoints[measurePoints.length - 1].y,
        )
      : null;
  const us = unitSuffix();
  $("#measure-seg").textContent = live !== null ? `${fmt(live)}${us}` : "–";
  $("#measure-total").textContent = measurePoints.length > 1 ? `${fmt(totals.total)}${us}` : "–";
  $("#measure-area").textContent =
    measurePoints.length >= 3 ? `${fmt(totals.area)}${us ? `${us}²` : ""}` : "–";
}

/* ---------- panel ---------- */

/** Build one layer row and register it in `layerRows` (used by both the main
 *  list and the collapsible empty-layers group — identical behavior). */
function buildLayerRow(layer: LayerInfo): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "layer-row";
  row.title = `${layer.name} · ${layer.entityCount} entities`;

  const check = document.createElement("span");
  check.className = "layer-check";
  check.setAttribute("role", "checkbox");
  check.setAttribute("aria-label", layer.name);
  check.tabIndex = 0;
  // The checkbox toggles instantly (it's an explicit affordance, and stays
  // snappy for keyboard/AT users); the rest of the row defers so a double
  // click can solo without a stray toggle.
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLayer(layer.name);
  });
  check.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggleLayer(layer.name);
    }
  });

  const swatch = document.createElement("span");
  swatch.className = "layer-swatch";

  const name = document.createElement("span");
  name.className = "layer-name";
  name.textContent = layer.name;

  const soloChip = document.createElement("span");
  soloChip.className = "solo-chip";
  soloChip.textContent = "SOLO";
  soloChip.hidden = true;

  const count = document.createElement("span");
  count.className = "layer-count";
  count.textContent = String(layer.entityCount);

  const soloBar = document.createElement("span");
  soloBar.className = "solo-bar";
  soloBar.hidden = true;

  row.append(soloBar, check, swatch, name, soloChip, count);
  row.addEventListener("mouseenter", () => setHover(layer.name, "row"));
  row.addEventListener("mouseleave", () => setHover(null, null));
  // Single click toggles the layer; double click solos it. Defer the single
  // click so a double click can cancel it — otherwise a solo would also fire
  // a stray toggle.
  let clickTimer: number | null = null;
  row.addEventListener("click", () => {
    if (clickTimer !== null) return;
    clickTimer = window.setTimeout(() => {
      clickTimer = null;
      toggleLayer(layer.name);
    }, 250);
  });
  row.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    toggleSolo(layer.name);
  });

  layerRows.set(layer.name, row);
  return row;
}

/** The collapsible "empty layers" group (DEMO-4): layers with no rendered
 *  geometry, collapsed by default. Rendered only when there are empties. */
function buildEmptyGroup(empty: LayerInfo[]): HTMLLIElement {
  const group = document.createElement("li");
  group.className = "layer-group";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "layer-group-head";
  head.setAttribute("aria-expanded", "false");
  head.innerHTML =
    `<span class="layer-group-chevron">${icons.chevron}</span>` +
    `<span class="layer-group-label">EMPTY</span>` +
    `<span class="layer-count">${empty.length}</span>`;

  const rows = document.createElement("ul");
  rows.className = "layer-group-rows";
  rows.hidden = true; // collapsed by default
  for (const layer of empty) rows.appendChild(buildLayerRow(layer));

  head.addEventListener("click", () => {
    const open = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", String(!open));
    rows.hidden = open;
    group.classList.toggle("open", !open);
  });

  group.append(head, rows);
  return group;
}

function buildLayerPanel(): void {
  const list = $<HTMLUListElement>("#layer-list");
  list.textContent = "";
  layerRows.clear();
  // Layers with no rendered geometry (the default "0", "Defpoints") go into a
  // collapsed group so they don't clutter the list; omit the group entirely
  // when every layer has geometry.
  const { rendered, empty } = partitionLayers(viewer.getLayers());
  for (const layer of rendered) list.appendChild(buildLayerRow(layer));
  if (empty.length > 0) list.appendChild(buildEmptyGroup(empty));
  $("#layer-count").textContent = String(viewer.getLayers().length);
  syncPanel();
}

function syncPanel(): void {
  const banner = $("#solo-banner");
  banner.hidden = !soloLayer;
  if (soloLayer) $("#solo-name").textContent = soloLayer;

  // Offer a one-click "Show all" when the user has manually hidden a rendered
  // layer. Solo mode has its own EXIT affordance, so suppress it there; empty
  // layers don't count (hiding them changes nothing on the canvas).
  const anyRenderedHidden =
    !soloLayer && partitionLayers(viewer.getLayers()).rendered.some((l) => l.visible === false);
  $("#show-all").hidden = !anyRenderedHidden;

  for (const layer of viewer.getLayers()) {
    const row = layerRows.get(layer.name);
    if (!row) continue;
    const visible = isVisible(layer.name);
    const isSolo = soloLayer === layer.name;
    row.classList.toggle("solo", isSolo);
    row.classList.toggle("dimmed", !!soloLayer && !isSolo);
    row.classList.toggle("off", !visible && !isSolo);
    row.querySelector<HTMLElement>(".solo-bar")!.hidden = !isSolo;
    row.querySelector<HTMLElement>(".solo-chip")!.hidden = !isSolo;
    const check = row.querySelector<HTMLElement>(".layer-check")!;
    check.setAttribute("aria-checked", String(visible));
    check.innerHTML = visible ? icons.check : icons.uncheck;
    const swatch = row.querySelector<HTMLElement>(".layer-swatch")!;
    // Effective color: what tessellation actually drew (entity overrides
    // included); the layer-table color is only a fallback.
    const rgb = layer.effectiveColors?.[0] ?? layer.color;
    const color = `#${rgb.toString(16).padStart(6, "0")}`;
    swatch.style.background = visible ? color : "transparent";
    swatch.style.border = visible ? "1px solid rgb(255 255 255 / 25%)" : `1px solid ${color}`;
  }
}

/* ---------- paper-space layout tabs ---------- */

function buildSpaceTabs(): void {
  const tabs = $("#space-tabs");
  const spaces = viewer.getSpaces();
  tabs.textContent = "";
  // Only worth a switcher when the file actually has layouts.
  tabs.hidden = spaces.length <= 1;
  if (spaces.length <= 1) return;
  for (const name of spaces) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "space-tab";
    tab.textContent = name;
    tab.classList.toggle("active", name === viewer.activeSpaceName);
    tab.addEventListener("click", () => setSpace(name));
    tabs.appendChild(tab);
  }
}

function setSpace(name: string): void {
  if (name === viewer.activeSpaceName) return;
  soloLayer = null;
  clearSelection();
  setMeasureActive(false);
  viewer.setActiveSpace(name); // re-tessellates and re-fits synchronously
  baselineZoom = viewer.view.unitsPerPixel; // re-baseline zoom% for the new fit
  for (const tab of $("#space-tabs").querySelectorAll<HTMLElement>(".space-tab")) {
    tab.classList.toggle("active", tab.textContent === name);
  }
  syncPanel();
}

/* ---------- status / readout ---------- */

viewer.on("loaded", () => {
  soloLayer = null;
  setHover(null, null);
  baselineZoom = viewer.view.unitsPerPixel;
  buildLayerPanel();
  buildSpaceTabs();

  const { entityCount, segmentCount, unsupported } = viewer.stats;
  $("#file-chip").textContent = currentName;
  $("#stats").textContent = `${entityCount} ENT · ${segmentCount} SEG`;

  const skipped = Object.entries(unsupported);
  const skippedTotal = skipped.reduce((n, [, v]) => n + v, 0);
  $("#skipped-btn").hidden = skippedTotal === 0;
  $("#skipped-count").textContent = `${skippedTotal} SKIPPED`;
  $("#skipped-detail").textContent = skipped.map(([k, v]) => `${v} ${k}`).join("  ·  ");
  $("#skipped-pop").hidden = true;

  setMode("loaded");

  // Restore a deep-linked view once, after the panel/tabs exist. Only valid for
  // the sample (the source the link implicitly refers to).
  if (pendingLink && currentSourceLinkable) applyLink(pendingLink);
  pendingLink = null;
});

/** Drawing-unit suffix (" mm"), or "" when the file is unitless. */
function unitSuffix(): string {
  const u = viewer.document?.units;
  return u ? ` ${u}` : "";
}

/** Measurement suffix for the drawing unit: " mm" (linear), " mm²" (area),
 *  or "" when the file is unitless. One source of truth for panel + copy. */
function measureSuffix(kind: "linear" | "area"): string {
  const us = unitSuffix();
  return us ? (kind === "area" ? `${us}²` : us) : "";
}

/** Label for an entity's path length: a closed curve reads "CIRCUMFERENCE",
 *  a closed polygon "PERIMETER", everything else "LENGTH" (#36). A closed
 *  polyline is the one that carries an `area` (describeEntity). */
function lengthLabel(info: EntityInfo): string {
  if (info.type === "CIRCLE" || info.type === "ELLIPSE") return "CIRCUMFERENCE";
  if (info.type === "POLYLINE" && info.area !== undefined) return "PERIMETER";
  return "LENGTH";
}

/** Redraw the scale bar to a round number of drawing units (~90px target). */
function updateScaleBar(unitsPerPixel: number): void {
  const target = 90; // px
  const length = niceLength(target * unitsPerPixel);
  const px = length > 0 ? length / unitsPerPixel : 0;
  $("#scale-line").style.width = `${px}px`;
  $("#scale-label").textContent = length > 0 ? `${fmt(length)}${unitSuffix()}` : "—";
}

/** Restore a shared view: space, then layer visibility, then the camera pose. */
function applyLink(link: ViewLink): void {
  restoringView = true;
  const spaces = viewer.getSpaces();
  if (link.spaceIndex > 0 && link.spaceIndex < spaces.length) setSpace(spaces[link.spaceIndex]);
  const layers = viewer.getLayers();
  // Resolve visibility from whichever set the link carried (see `packLayers`).
  // A `src`-only link carries neither set — leave every layer as loaded.
  const visSet = link.visibleLayerIndices && new Set(link.visibleLayerIndices);
  const hidSet = link.hiddenLayerIndices && new Set(link.hiddenLayerIndices);
  if (visSet || hidSet) {
    const isVis = (i: number): boolean => (visSet ? visSet.has(i) : !hidSet!.has(i));
    layers.forEach((layer, i) => viewer.setLayerVisible(layer.name, isVis(i)));
  }
  syncPanel();
  // Restore the pose only when the link carried one (unitsPerPixel > 0); a
  // src-only link uses the fitted view from load.
  if (link.view.unitsPerPixel > 0) viewer.setView(link.view);
  restoringView = false;
}

/** Debounced write of the current view to the URL hash (linkable sources only). */
function scheduleHashWrite(): void {
  if (!currentSourceLinkable || restoringView) return;
  if (hashWriteTimer !== null) clearTimeout(hashWriteTimer);
  hashWriteTimer = window.setTimeout(() => {
    hashWriteTimer = null;
    const spaces = viewer.getSpaces();
    const layers = viewer.getLayers();
    const hidden = layers.flatMap((layer, i) => (isVisible(layer.name) ? [] : [i]));
    const link: ViewLink = {
      view: viewer.view,
      spaceIndex: Math.max(0, spaces.indexOf(viewer.activeSpaceName)),
      ...packLayers(hidden, layers.length),
      ...(currentSourceUrl ? { src: currentSourceUrl } : {}),
    };
    history.replaceState(null, "", encodeView(link) || location.pathname + location.search);
  }, 300);
}

viewer.on("render", () => {
  if (mode !== "loaded") return;
  scheduleHashWrite();
  const view = viewer.view;
  $("#zoom-pct").textContent = String(Math.round((baselineZoom / view.unitsPerPixel) * 100));
  const deg = Math.round((view.rotation * 180) / Math.PI);
  $("#rot-deg").textContent = String(((deg % 360) + 360) % 360);
  updateScaleBar(view.unitsPerPixel);
  // Measurement points live in world space — reproject them as the camera moves.
  if (measureActive) renderMeasure();
});

/* ---------- loading ---------- */

const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** Filename shown for a remote URL: the last path segment, or a generic name. */
function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    return decodeURIComponent(last) || "drawing.dxf";
  } catch {
    return "drawing.dxf";
  }
}

/** Host (with port) of a URL, for disambiguating recents; "" if unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Record what the current drawing came from — its name, whether it's
 *  URL-addressable (so the view hash is shareable), and the remote URL if any.
 *  A non-linkable source clears any stale hash (DEMO-7). */
function applySourceMeta(name: string, opts: { linkable: boolean; url?: string | null }): void {
  currentName = name;
  currentSourceLinkable = opts.linkable;
  currentSourceUrl = opts.url ?? null;
  if (!currentSourceLinkable && location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

/** Load a local File or the bundled sample. Errors surface on the toast. */
async function openSource(source: File | string, name: string): Promise<void> {
  applySourceMeta(name, { linkable: source === "/sample.dxf" });
  $("#error-toast").hidden = true;
  $("#loading-text").textContent = `LOADING ${name.toUpperCase()}…`;
  setMode("loading");
  try {
    // The sample is a same-origin relative path; a remote URL never reaches here
    // (it goes through loadRemoteUrl, which streams with byte progress).
    if (typeof source === "string") await viewer.loadUrl(source);
    else await viewer.load(source);
  } catch (error) {
    showError(name, error instanceof Error ? error.message : String(error));
  }
}

/** Fetch a remote DXF with byte/percent progress, then load it. Throws so the
 *  caller can route the failure to the right surface (dialog card vs. toast):
 *  a FetchError is a network/CORS/HTTP problem, anything else is a bad DXF. */
async function loadRemoteUrl(
  url: string,
  onProgress: (p: FetchProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const name = nameFromUrl(url);
  const buffer = await fetchWithProgress(url, { onProgress, signal });
  // Snapshot the current source so a parse failure can undo the swap — otherwise
  // the still-showing previous drawing would inherit the bad URL's share hash.
  const prev = { name: currentName, url: currentSourceUrl, linkable: currentSourceLinkable };
  applySourceMeta(name, { linkable: true, url });
  $("#error-toast").hidden = true;
  $("#loading-text").textContent = `LOADING ${name.toUpperCase()}…`;
  setMode("loading");
  try {
    await viewer.load(buffer); // emits "loaded" on success; throws on bad DXF
  } catch (e) {
    applySourceMeta(prev.name, { linkable: prev.linkable, url: prev.url });
    throw e;
  }
  pushRecent({ url, name, size: buffer.byteLength, ts: Date.now() });
}

/* ---------- open-DXF dialog ---------- */

const fileInput = $<HTMLInputElement>("#file");
const urlInput = $<HTMLInputElement>("#od-input");

/** Coerce raw input into a fetchable http(s) URL, or null when it can't be one.
 *  A scheme-less but domain-shaped value (`example.com/a.dxf`) is assumed https —
 *  the common typo — while a bare word (`notaurl`) or non-http scheme stays null
 *  so the Open button disables and the invalid hint explains why. */
function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return isHttpUrl(s) ? s : null;
  // No scheme: only assume https:// for a dotted host, not any random word.
  const host = s.split(/[/?#]/, 1)[0];
  if (!host.includes(".")) return null;
  const withScheme = `https://${s}`;
  return isHttpUrl(withScheme) ? withScheme : null;
}

/** Reflect dialog state (open, phase) onto the DOM. */
function renderDialog(): void {
  $("#open-dialog").hidden = !dialogOpen;
  // The form (dropzone + URL field) shows unless a fetch is in flight or its
  // error card is up; those two states take over the body.
  const busy = dialogPhase === "loading" || dialogPhase === "cors";
  $("#od-form").hidden = busy;
  $("#od-loading").hidden = dialogPhase !== "loading";
  $("#od-cors").hidden = dialogPhase !== "cors";
  $("#od-invalid").hidden = dialogPhase !== "invalid";
  urlInput.classList.toggle("invalid", dialogPhase === "invalid");
  $<HTMLButtonElement>("#od-open").disabled = normalizeUrl(urlInput.value) === null;
}

/** Rebuild the recent-URL list from storage; hidden when empty. */
function renderRecents(): void {
  const recents = loadRecents();
  $("#od-recents").hidden = recents.length === 0;
  const list = $("#od-recents-list");
  list.textContent = "";
  for (const r of recents) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "od-recent";
    const icon = document.createElement("span");
    icon.className = "od-recent-icon";
    icon.innerHTML = icons.clock; // static SVG constant, not user data
    const main = document.createElement("span");
    main.className = "od-recent-main";
    const name = document.createElement("span");
    name.className = "od-recent-name";
    name.textContent = r.name; // textContent — never interpolate a URL into HTML
    const host = document.createElement("span");
    host.className = "od-recent-host";
    // The host disambiguates same-named files from different origins (#6).
    host.textContent = hostOf(r.url);
    main.append(name, host);
    main.title = r.url;
    const size = document.createElement("span");
    size.className = "od-recent-size";
    size.textContent = formatBytes(r.size);
    btn.append(icon, main, size);
    // Clicking a recent refills the input (an explicit Open still confirms it).
    btn.addEventListener("click", () => {
      urlInput.value = r.url;
      dialogPhase = "idle";
      renderDialog();
      urlInput.focus();
    });
    list.appendChild(btn);
  }
}

function openDialog(): void {
  dialogOpen = true;
  dialogPhase = "idle";
  renderRecents();
  renderDialog();
}

function cancelDialogFetch(): void {
  if (dialogAbort) {
    dialogAbort.abort();
    dialogAbort = null;
  }
}

function closeDialog(): void {
  cancelDialogFetch();
  dialogOpen = false;
  dialogPhase = "idle";
  renderDialog();
}

/** Back out of an error/invalid state to the form (dropzone + URL field). */
function backToForm(focusUrl = false): void {
  dialogPhase = "idle";
  renderDialog();
  if (focusUrl) urlInput.focus();
}

function renderDialogProgress(p: FetchProgress): void {
  const fill = $("#od-bar-fill");
  const pct = p.total ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : null;
  if (pct === null) {
    fill.classList.add("indeterminate");
    fill.style.width = "";
    $("#od-pct").textContent = "";
    $("#od-loaded").textContent = formatBytes(p.loaded);
  } else {
    fill.classList.remove("indeterminate");
    fill.style.width = `${pct}%`;
    $("#od-pct").textContent = `${pct}%`;
    $("#od-loaded").textContent = `${formatBytes(p.loaded)} / ${formatBytes(p.total)}`;
  }
}

/** Guidance for why a fetched HTTP response didn't yield a usable file. */
function httpTip(status: number | undefined): string {
  if (status === 404 || status === 410)
    return "The file may have moved or been removed — double-check the link.";
  if (status === 401 || status === 403)
    return "The file may be private — make sure it's publicly downloadable.";
  if (status !== undefined && status >= 500)
    return "The server had a problem — try again in a moment.";
  return "Check the link points straight at a downloadable .dxf.";
}

/** Show the dialog's error state for a failed URL open, tailoring the title and
 *  the TRY-THIS tips to the cause: a network/CORS block, an HTTP status, or a
 *  file that downloaded fine but isn't a valid DXF. Keeps the user in the URL
 *  flow (Try again / Edit URL) instead of dropping them onto the file toast. */
function showDialogError(url: string, kind: FetchErrorKind | "parse", status?: number): void {
  dialogOpen = true;
  dialogPhase = "cors";
  urlInput.value = url;
  const network = kind === "network" || kind === "scheme";

  // The browser can't distinguish a CORS block from an unreachable host, so the
  // network copy stays honest; an HTTP status and a parse failure are specific.
  $("#od-cors-title").textContent =
    kind === "parse"
      ? "That file isn't a valid DXF"
      : kind === "http"
        ? `The server returned ${status ?? "an error"}`
        : "Couldn't fetch that URL";
  $("#od-cors-msg").textContent =
    kind === "parse"
      ? "The download succeeded, but the file isn't a valid DXF drawing."
      : kind === "http"
        ? "The request reached the server, but it didn't return the file."
        : "The server blocked the request (no CORS header) or the file wasn't reachable. Browsers can only load remote files a server explicitly allows.";
  $("#od-cors-url").textContent = url;

  // Tailor the tips: a download-and-open fallback always fits; the direct-.dxf
  // check fits network and parse failures; CORS hosting only fits network ones;
  // an HTTP status gets its own status-specific line.
  $("#od-tip-status").hidden = kind !== "http";
  if (kind === "http") $("#od-tip-status-text").textContent = httpTip(status);
  $("#od-tip-direct").hidden = !(network || kind === "parse");
  $("#od-tip-cors").hidden = !network;

  // The failed load left the app in "loading" on the cold/hash path; restore it
  // to whatever survived underneath so the drawing behind the modal is coherent.
  setMode(viewer.document ? "loaded" : "empty");
  renderRecents();
  renderDialog();
}

async function submitDialogUrl(): Promise<void> {
  const url = normalizeUrl(urlInput.value);
  if (!url) {
    dialogPhase = "invalid";
    renderDialog();
    return;
  }
  dialogPhase = "loading";
  $("#od-loading-name").textContent = `FETCHING ${nameFromUrl(url).toUpperCase()}`;
  renderDialogProgress({ loaded: 0, total: null });
  renderDialog();
  dialogAbort = new AbortController();
  try {
    await loadRemoteUrl(url, renderDialogProgress, dialogAbort.signal);
    dialogAbort = null;
    closeDialog();
  } catch (e) {
    dialogAbort = null;
    if (isAbortError(e)) return; // user cancelled — cancel handler owns the UI
    // Keep the user in the URL flow: a network/HTTP failure or a valid download
    // that isn't a DXF both surface as the dialog's error state (Try again / Edit
    // URL), not the file-oriented toast.
    if (e instanceof FetchError) showDialogError(url, e.kind, e.status);
    else showDialogError(url, "parse");
  }
}

function cancelDialogLoad(): void {
  cancelDialogFetch();
  dialogPhase = "idle";
  renderDialog();
}

/** Pasting a .dxf link anywhere (dialog closed) offers to open it. */
/** A pasted string that looks like a remote DXF link. */
function looksLikeDxfUrl(text: string): boolean {
  const trimmed = text.trim();
  return isHttpUrl(trimmed) && /\.dxf(\?|#|$)/i.test(trimmed);
}

function maybeShowPasteConfirm(text: string): void {
  if (dialogOpen || !looksLikeDxfUrl(text)) return;
  const trimmed = text.trim();
  pastedUrl = trimmed;
  $("#paste-url").textContent = trimmed;
  $("#paste-toast").hidden = false;
}

/** With the dialog already open, a pasted DXF link drops straight into the URL
 *  field instead of raising the confirm toast (the field is the toast's
 *  purpose here). Skipped while the user is typing into the field — native
 *  paste wins there — and while a fetch is in flight. Returns whether it
 *  consumed the paste, so the caller can suppress the browser's own insert. */
function fillUrlFromPaste(text: string): boolean {
  if (document.activeElement === urlInput || dialogPhase === "loading") return false;
  if (!looksLikeDxfUrl(text)) return false;
  urlInput.value = text.trim();
  dialogPhase = "idle"; // reveal the form if a cors/invalid card was up
  renderDialog();
  urlInput.focus();
  return true;
}

/** Route a paste: fill the open dialog's field, or offer the confirm toast.
 *  Returns true when it filled the field (the caller then preventDefaults so
 *  the browser doesn't also insert the text into the input we just focused). */
function handlePastedText(text: string): boolean {
  if (dialogOpen) return fillUrlFromPaste(text);
  maybeShowPasteConfirm(text);
  return false;
}

function dismissPaste(): void {
  $("#paste-toast").hidden = true;
  pastedUrl = "";
}

$("#od-close").addEventListener("click", closeDialog);
$("#od-dropzone").addEventListener("click", () => {
  closeDialog();
  fileInput.click();
});
// From the error card: "drop it in" returns to the form (the dropzone is right
// there); "Edit URL" does the same but drops focus into the URL field.
$("#od-try-file").addEventListener("click", () => backToForm());
$("#od-open").addEventListener("click", () => void submitDialogUrl());
$("#od-cancel").addEventListener("click", cancelDialogLoad);
$("#od-retry").addEventListener("click", () => void submitDialogUrl());
$("#od-edit").addEventListener("click", () => backToForm(true));
$("#od-clear").addEventListener("click", () => {
  clearRecents();
  renderRecents();
});
urlInput.addEventListener("input", () => {
  if (dialogPhase === "invalid") dialogPhase = "idle";
  renderDialog();
});
urlInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // Enter on an unfixable value surfaces the hint (the Open button is disabled,
  // so this is the only way the "why" reaches the user).
  if (normalizeUrl(urlInput.value)) void submitDialogUrl();
  else {
    dialogPhase = "invalid";
    renderDialog();
  }
});
// Clicking the scrim (not the card) closes — but never mid-fetch.
$("#open-dialog").addEventListener("click", (e) => {
  if (e.target === e.currentTarget && dialogPhase !== "loading") closeDialog();
});

$("#paste-open").addEventListener("click", () => {
  const url = pastedUrl;
  dismissPaste();
  openDialog();
  urlInput.value = url;
  void submitDialogUrl();
});
$("#paste-dismiss").addEventListener("click", dismissPaste);
$("#paste-close").addEventListener("click", dismissPaste);
window.addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text") ?? "";
  // When we fill the field ourselves, stop the browser from also inserting the
  // text into the input we just focused — otherwise the URL lands twice.
  if (handlePastedText(text)) e.preventDefault();
});
// Esc closes the dialog (or cancels an in-flight fetch). The core shortcut
// handler is disabled while the dialog is open, so this is the only Esc path.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !dialogOpen) return;
  e.preventDefault();
  if (dialogPhase === "loading") cancelDialogLoad();
  else closeDialog();
});

/* ---------- wiring ---------- */

const loadSample = (): void => void openSource("/sample.dxf", "sample.dxf");

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void openSource(file, file.name);
});

// Every open control raises the same one-view dialog (dropzone + URL field).
for (const id of ["#open", "#empty-open", "#error-open"]) {
  $(id).addEventListener("click", () => openDialog());
}
for (const id of ["#load-sample", "#empty-sample", "#error-sample"]) {
  $(id).addEventListener("click", loadSample);
}

$("#error-dismiss").addEventListener("click", () => {
  $("#error-toast").hidden = true;
});

$("#exit-solo").addEventListener("click", exitSolo);
$("#show-all").addEventListener("click", showAllLayers);

$("#skipped-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = $("#skipped-pop");
  pop.hidden = !pop.hidden;
});
document.addEventListener("click", (e) => {
  const pop = $("#skipped-pop");
  if (!pop.hidden && !pop.contains(e.target as Node)) pop.hidden = true;
});

/* Export / download */
function download(data: Blob | string, filename: string): void {
  const url = typeof data === "string" ? data : URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof data !== "string") URL.revokeObjectURL(url);
}
const exportBaseName = (): string => currentName.replace(/\.dxf$/i, "") || "drawing";

$("#export-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = $("#export-pop");
  pop.hidden = !pop.hidden;
});
$("#export-svg").addEventListener("click", () => {
  // Give the SVG the canvas backdrop so it's legible on any viewer.
  const svg = viewer.toSVG({ background: "#16181d" });
  download(new Blob([svg], { type: "image/svg+xml" }), `${exportBaseName()}.svg`);
  $("#export-pop").hidden = true;
});
$("#export-png").addEventListener("click", () => {
  download(viewer.toPNG({ background: 0x16181d }), `${exportBaseName()}.png`);
  $("#export-pop").hidden = true;
});
document.addEventListener("click", (e) => {
  const pop = $("#export-pop");
  if (!pop.hidden && !$(".export-wrap").contains(e.target as Node)) pop.hidden = true;
});

/* Canvas controls */
$("#zoom-in").addEventListener("click", () => viewer.zoomBy(1.25, { animate: true }));
$("#zoom-out").addEventListener("click", () => viewer.zoomBy(0.8, { animate: true }));
$("#fit-btn").addEventListener("click", () => viewer.fitView({ animate: true }));
$("#reset-rot").addEventListener("click", () => viewer.resetRotation({ animate: true }));

/* Measure tool + entity selection */
$("#measure-btn").addEventListener("click", () => setMeasureActive(!measureActive));
$("#info-close").addEventListener("click", () => clearSelection());
$("#info-isolate").addEventListener("click", () => {
  if (selected) isolateLayer(selected.layer);
});
$("#info-hide").addEventListener("click", () => hideSelectedLayer());
$("#info-copy").addEventListener("click", () => copySelection());
$("#shortcuts-close").addEventListener("click", () => {
  $("#shortcuts").hidden = true;
});

function toggleShortcuts(): void {
  const s = $("#shortcuts");
  s.hidden = !s.hidden;
}

/** Esc: close the help first, else back out of measure / selection. */
function onEscape(): void {
  if (!$("#shortcuts").hidden) {
    $("#shortcuts").hidden = true;
  } else if (measureActive && measurePoints.length > 0) {
    clearMeasure();
  } else if (measureActive) {
    setMeasureActive(false);
  } else {
    clearSelection();
  }
}

/* Keyboard shortcuts (camera keys drive the viewer; the rest are wired here). */
attachShortcuts(window, viewer, {
  isEnabled: () => mode === "loaded" && !dialogOpen,
  onToggleMeasure: () => setMeasureActive(!measureActive),
  onShowAll: () => showAllLayers(),
  onIsolate: () => {
    if (selected) isolateLayer(selected.layer);
  },
  onHide: () => hideSelectedLayer(),
  onCopy: () => copySelection(),
  onToggleHelp: () => toggleShortcuts(),
  onEscape,
});

const localPoint = (e: PointerEvent): { x: number; y: number } => {
  const rect = viewerEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

/* Cursor readout + hover + measure rubber-band (pointermove) */
let pickQueued = false;
viewerEl.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || mode !== "loaded") return;
  const { x, y } = localPoint(e);
  // In measure mode the cursor snaps to nearby geometry; the readout then
  // reflects the snapped point.
  measureSnap = measureActive ? viewer.snap(x, y) : null;
  const world = measureSnap ? measureSnap.point : viewer.screenToWorld(x, y);
  $("#cur-x").textContent = fmt(world.x);
  $("#cur-y").textContent = fmt(world.y);
  if (measureActive) {
    measureCursor = world;
    renderMeasure();
    return;
  }
  // Layer pick-back highlight (skip while a drag/pan is in progress).
  if (e.buttons !== 0 || pickQueued) return;
  pickQueued = true;
  requestAnimationFrame(() => {
    pickQueued = false;
    const name = viewer.pickLayer(x, y);
    setHover(name, name ? "canvas" : null);
  });
});
viewerEl.addEventListener("pointerleave", () => {
  setHover(null, null);
  $("#cur-x").textContent = "–";
  $("#cur-y").textContent = "–";
});

/* Click detection: a pointerdown+up that didn't travel far (i.e. not a pan). */
let downAt: { x: number; y: number } | null = null;
viewerEl.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  downAt = { x: e.clientX, y: e.clientY };
});
viewerEl.addEventListener("pointerup", (e) => {
  if (mode !== "loaded" || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5) return; // a drag/pan, not a click
  if (measureActive) {
    const { x, y } = localPoint(e);
    // Place the snapped point when snapping, else the raw cursor position.
    const snap = viewer.snap(x, y);
    measurePoints.push(snap ? snap.point : viewer.screenToWorld(x, y));
    renderMeasure();
  } else {
    selectAt(e.clientX, e.clientY);
  }
});

/* Mobile panel */
const panel = $("#panel");
const backdrop = $("#panel-backdrop");
const setPanelOpen = (open: boolean): void => {
  panel.classList.toggle("open", open);
  backdrop.hidden = !open;
};
$("#toggle-layers").addEventListener("click", () =>
  setPanelOpen(!panel.classList.contains("open")),
);
$("#close-panel").addEventListener("click", () => setPanelOpen(false));
backdrop.addEventListener("click", () => setPanelOpen(false));

/* Drag & drop */
const dropOverlay = $("#drop");
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer?.types.includes("Files")) {
    dragDepth += 1;
    dropOverlay.hidden = false;
  }
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    if (dialogOpen) closeDialog(); // a drop supersedes the open dialog
    void openSource(file, file.name);
  }
});

// Open/restore from a decoded share hash. A hash arrives two ways: at cold start,
// and while the app is already running (a pasted `#src=…` link, or back/forward
// between links). Both funnel through here.
//  • `#src=…` → auto-load that remote URL; the "loaded" handler restores any pose.
//    On failure, open the dialog with retry/guidance.
//  • a view-only hash → a shared link to the sample; open it and restore.
//  • nothing usable → cold start shows the empty screen; a live hashchange leaves
//    the current drawing untouched (DEMO-6).
let sourceAbort: AbortController | null = null;

function openFromLink(link: ViewLink | null, cold: boolean): void {
  if (!link) {
    if (cold) setMode("empty");
    return; // a garbage/empty hash never disturbs the current drawing or dialog
  }
  // A live navigation that loads/restores a drawing supersedes the open dialog
  // (like a file drop does). A failed load reopens it with guidance.
  if (!cold && dialogOpen) closeDialog();
  if (link.src) {
    // The same remote is already on screen → just restore the view, no refetch.
    if (!cold && link.src === currentSourceUrl && viewer.document) {
      applyLink(link);
      return;
    }
    const url = link.src;
    pendingLink = link; // the "loaded" handler restores the pose after the fetch
    sourceAbort?.abort(); // supersede an in-flight hash/cold load (rapid nav)
    sourceAbort = new AbortController();
    currentName = nameFromUrl(url);
    $("#loading-text").textContent = `LOADING ${currentName.toUpperCase()}…`;
    setMode("loading");
    loadRemoteUrl(url, () => {}, sourceAbort.signal).catch((e) => {
      if (pendingLink === link) pendingLink = null;
      if (isAbortError(e)) return;
      // showDialogError opens the dialog on the URL tab with retry/guidance and
      // restores the app mode (the load left it in "loading").
      if (e instanceof FetchError) showDialogError(url, e.kind, e.status);
      else showDialogError(url, "parse");
    });
    return;
  }
  // View-only hash → the bundled sample. If it's already shown, just restore.
  if (!cold && currentSourceLinkable && !currentSourceUrl && viewer.document) {
    applyLink(link);
    return;
  }
  pendingLink = link;
  loadSample();
}

openFromLink(decodeView(location.hash), true);
// React to a hash the user introduces after load — pasting a share link into the
// address bar, or back/forward between shared links. Our own writes go through
// history.replaceState, which never fires hashchange, so this can't loop.
window.addEventListener("hashchange", () => openFromLink(decodeView(location.hash), false));

/* Test hook: lets e2e tests observe viewer + demo interaction state. */
declare global {
  interface Window {
    __aspicio?: DxfViewer;
    __demo?: {
      readonly selectedIndex: number | null;
      readonly measureActive: boolean;
      readonly measurePoints: Point2[];
      readonly dialogPhase: string;
      pickAt(x: number, y: number): PickedEntity | null;
      snapAt(x: number, y: number): SnapResult | null;
      /** Drive the paste-confirm path deterministically (clipboard events are
       *  awkward to synthesize in Playwright). */
      simulatePaste(text: string): void;
    };
  }
}
window.__aspicio = viewer;
window.__demo = {
  get selectedIndex() {
    return selectedIndex;
  },
  get measureActive() {
    return measureActive;
  },
  get measurePoints() {
    return measurePoints;
  },
  get dialogPhase() {
    return dialogOpen ? dialogPhase : "closed";
  },
  pickAt: (x, y) => viewer.pickEntity(x, y),
  snapAt: (x, y) => viewer.snap(x, y),
  simulatePaste: (text) => {
    handlePastedText(text);
  },
};
