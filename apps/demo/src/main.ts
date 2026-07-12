import "./style.css";
import { DxfViewer } from "@aspicio/core";
import type { EntityInfo, PickedEntity, Point2 } from "@aspicio/core";

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
  drop: `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--crease)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"></path><path d="m7 11 5 5 5-5"></path><path d="M5 21h14"></path></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="var(--crease)"></rect><path d="M4.4 8.2 L6.9 10.6 L11.6 5.3" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path></svg>`,
  uncheck: `<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="var(--hairline2)" stroke-width="1.4"></rect></svg>`,
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
          <div class="empty-title">Open a DXF to view it</div>
          <div class="empty-body">Drop a file anywhere in the window, pick one from your machine, or load the bundled sample.</div>
          <div class="empty-actions">
            <button id="empty-open" class="btn-primary" type="button">Open DXF</button>
            <button id="empty-sample" class="btn-ghost" type="button">Load sample</button>
          </div>
          <div class="empty-supports">SUPPORTS · LINE · POLYLINE · CIRCLE · ARC · ELLIPSE · INSERT</div>
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
      <div id="readout" class="readout" hidden>
        <span class="readout-chip">ZOOM <span id="zoom-pct">100</span>%</span>
        <span class="readout-chip">ROT <span id="rot-deg">0</span>°</span>
        <span class="readout-chip">X <span id="cur-x">–</span> Y <span id="cur-y">–</span></span>
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
const layerRows = new Map<string, HTMLLIElement>();

// Interaction state for entity selection and the measure tool.
let selectedIndex: number | null = null;
let measureActive = false;
let measurePoints: Point2[] = [];
let measureCursor: Point2 | null = null;

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

const INFO_FIELDS: [keyof EntityInfo, string, (v: number) => string][] = [
  ["length", "LENGTH", fmt],
  ["radius", "RADIUS", fmt],
  ["area", "AREA", fmt],
  ["points", "POINTS", (v) => String(v)],
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
  for (const [key, label, format] of INFO_FIELDS) {
    const value = info[key];
    if (typeof value === "number") {
      rows.push(`<span class="info-k">${label}</span><span class="info-v">${format(value)}</span>`);
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
  viewer.setSelection(picked.index);
  showInfo(picked);
}

/* ---------- measure tool ---------- */

function setMeasureActive(active: boolean): void {
  measureActive = active;
  measurePoints = [];
  measureCursor = null;
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
  $("#measure-seg").textContent = live !== null ? fmt(live) : "–";
  $("#measure-total").textContent = measurePoints.length > 1 ? fmt(totals.total) : "–";
  $("#measure-area").textContent = measurePoints.length >= 3 ? fmt(totals.area) : "–";
}

/* ---------- panel ---------- */

function buildLayerPanel(): void {
  const list = $<HTMLUListElement>("#layer-list");
  list.textContent = "";
  layerRows.clear();
  for (const layer of viewer.getLayers()) {
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

    list.appendChild(row);
    layerRows.set(layer.name, row);
  }
  $("#layer-count").textContent = String(viewer.getLayers().length);
  syncPanel();
}

function syncPanel(): void {
  const banner = $("#solo-banner");
  banner.hidden = !soloLayer;
  if (soloLayer) $("#solo-name").textContent = soloLayer;

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

/* ---------- status / readout ---------- */

viewer.on("loaded", () => {
  soloLayer = null;
  setHover(null, null);
  baselineZoom = viewer.view.unitsPerPixel;
  buildLayerPanel();

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
});

viewer.on("render", () => {
  if (mode !== "loaded") return;
  const view = viewer.view;
  $("#zoom-pct").textContent = String(Math.round((baselineZoom / view.unitsPerPixel) * 100));
  const deg = Math.round((view.rotation * 180) / Math.PI);
  $("#rot-deg").textContent = String(((deg % 360) + 360) % 360);
  // Measurement points live in world space — reproject them as the camera moves.
  if (measureActive) renderMeasure();
});

/* ---------- loading ---------- */

async function openSource(source: File | string, name: string): Promise<void> {
  currentName = name;
  $("#error-toast").hidden = true;
  $("#loading-text").textContent = `LOADING ${name.toUpperCase()}…`;
  setMode("loading");
  try {
    if (typeof source === "string") await viewer.loadUrl(source);
    else await viewer.load(source);
  } catch (error) {
    showError(name, error instanceof Error ? error.message : String(error));
  }
}

/* ---------- wiring ---------- */

const fileInput = $<HTMLInputElement>("#file");
const openPicker = (): void => fileInput.click();
const loadSample = (): void => void openSource("/sample.dxf", "sample.dxf");

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void openSource(file, file.name);
});

for (const id of ["#open", "#empty-open", "#error-open"]) {
  $(id).addEventListener("click", openPicker);
}
for (const id of ["#load-sample", "#empty-sample", "#error-sample"]) {
  $(id).addEventListener("click", loadSample);
}

$("#error-dismiss").addEventListener("click", () => {
  $("#error-toast").hidden = true;
});

$("#exit-solo").addEventListener("click", exitSolo);

$("#skipped-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = $("#skipped-pop");
  pop.hidden = !pop.hidden;
});
document.addEventListener("click", (e) => {
  const pop = $("#skipped-pop");
  if (!pop.hidden && !pop.contains(e.target as Node)) pop.hidden = true;
});

/* Canvas controls */
$("#zoom-in").addEventListener("click", () => viewer.zoomBy(1.25, { animate: true }));
$("#zoom-out").addEventListener("click", () => viewer.zoomBy(0.8, { animate: true }));
$("#fit-btn").addEventListener("click", () => viewer.fitView({ animate: true }));
$("#reset-rot").addEventListener("click", () => viewer.resetRotation({ animate: true }));

/* Measure tool + entity selection */
$("#measure-btn").addEventListener("click", () => setMeasureActive(!measureActive));
$("#info-close").addEventListener("click", () => clearSelection());
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || mode !== "loaded") return;
  if (measureActive && measurePoints.length > 0) clearMeasure();
  else if (measureActive) setMeasureActive(false);
  else clearSelection();
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
  // Live world-coordinate readout, always on.
  const world = viewer.screenToWorld(x, y);
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
    measurePoints.push(viewer.screenToWorld(localPoint(e).x, localPoint(e).y));
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
  if (file) void openSource(file, file.name);
});

setMode("empty");

/* Test hook: lets e2e tests observe viewer + demo interaction state. */
declare global {
  interface Window {
    __aspicio?: DxfViewer;
    __demo?: {
      readonly selectedIndex: number | null;
      readonly measureActive: boolean;
      readonly measurePoints: Point2[];
      pickAt(x: number, y: number): PickedEntity | null;
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
  pickAt: (x, y) => viewer.pickEntity(x, y),
};
