import type { DxfViewer, LayerInfo } from "@aspicio/core";
import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import type { DxfTheme } from "./theme.ts";
import { tokenStyles } from "./theme.ts";

const DESKTOP_HINTS: [string, string][] = [
  ["DRAG", "pan"],
  ["SCROLL", "zoom"],
  ["⇧+DRAG", "rotate"],
  ["2×CLICK", "fit to view"],
  ["HOVER", "highlight layer"],
  ["2×CLICK ROW", "solo layer"],
];

const checkIcon = (): TemplateResult => html`
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" class="check-fill" />
    <path
      d="M4.4 8.2 L6.9 10.6 L11.6 5.3"
      fill="none"
      stroke="#fff"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
`;

const uncheckIcon = (): TemplateResult => html`
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" class="uncheck-stroke" />
  </svg>
`;

/**
 * `<aspicio-layer-panel>` — ready-made layer list for an embedded viewer,
 * matching the Aspicio demo app: header with layer count, visibility
 * checkboxes, effective-color swatches (INV-2), entity counts,
 * hover-to-highlight, double-click-to-solo (with a banner), canvas-hover
 * reverse-highlight, and a gesture-hints footer.
 *
 * Attributes: `theme` ("aspicio" | "none"), `no-hints`,
 * `reverse-highlight-layer`. Property: `viewer` (from
 * `<aspicio-preview>`'s `viewer` getter or `viewer-change` event).
 * Style internals from the host via `::part()` (`header`, `row`,
 * `checkbox`, `swatch`, `name`, `count`, `hints`, `solo-banner`) and the
 * `--aspicio-*` custom properties.
 */
export class AspicioLayerPanel extends LitElement {
  static properties = {
    viewer: { attribute: false },
    theme: { type: String },
    reverseHighlightLayer: { type: String, attribute: "reverse-highlight-layer" },
    noHints: { type: Boolean, attribute: "no-hints" },
    _layers: { state: true },
    _soloLayer: { state: true },
    _hoveredRow: { state: true },
  };

  declare viewer: DxfViewer | null;
  declare theme: DxfTheme;
  declare reverseHighlightLayer: string | null;
  declare noHints: boolean;
  declare _layers: LayerInfo[];
  declare _soloLayer: string | null;
  declare _hoveredRow: string | null;

  #subscribedViewer: DxfViewer | null = null;
  #sync = (): void => {
    this._soloLayer = null;
    this._layers = this.viewer?.getLayers() ?? [];
  };

  constructor() {
    super();
    this.viewer = null;
    this.theme = "aspicio";
    this.reverseHighlightLayer = null;
    this.noHints = false;
    this._layers = [];
    this._soloLayer = null;
    this._hoveredRow = null;
  }

  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      /* ---------- themed (demo parity) ---------- */
      .panel {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
        background: var(--aspicio-panel);
        color: var(--aspicio-text);
        font-family: var(--aspicio-font-sans);
        font-size: 13px;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 13px 14px 10px;
        flex-shrink: 0;
        font-family: var(--aspicio-font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        color: var(--aspicio-text3);
      }
      .header-count {
        font-size: 10.5px;
        background: var(--aspicio-panel2);
        border: 1px solid var(--aspicio-hairline);
        border-radius: 3px;
        padding: 1px 6px;
        font-feature-settings: "tnum" 1;
      }
      .solo-banner {
        margin: 0 12px 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 9px;
        background: var(--aspicio-amberdim);
        border: 1px solid var(--aspicio-amberborder);
        border-radius: 3px;
      }
      .solo-banner-label {
        font-family: var(--aspicio-font-mono);
        font-size: 10px;
        letter-spacing: 0.1em;
        font-weight: 600;
        color: var(--aspicio-amber);
      }
      .solo-banner-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--aspicio-font-mono);
        font-size: 11.5px;
        color: var(--aspicio-text);
      }
      .solo-exit {
        border: none;
        background: transparent;
        color: var(--aspicio-amber);
        cursor: pointer;
        font-family: var(--aspicio-font-mono);
        font-size: 10px;
        letter-spacing: 0.08em;
        padding: 2px 4px;
      }
      .rows {
        padding: 0 8px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      .empty {
        padding: 24px 10px;
        text-align: center;
        color: var(--aspicio-text3);
        font-size: 12.5px;
        line-height: 1.6;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px;
        border-radius: 3px;
        cursor: pointer;
        user-select: none;
        position: relative;
        min-width: 0;
        border: 1px solid transparent;
        transition:
          background 140ms,
          border-color 140ms,
          opacity 140ms;
      }
      .row.hovered {
        background: var(--aspicio-hover);
      }
      .row.hidden-layer {
        opacity: 0.55;
      }
      .row.solo {
        padding-left: 12px;
        border-color: var(--aspicio-amberborder);
        background: var(--aspicio-amberdim);
        opacity: 1;
      }
      .row.dimmed {
        opacity: 0.34;
      }
      .row.reverse {
        border-color: var(--aspicio-crease);
        background: var(--aspicio-creasedim);
      }
      .solo-rail {
        position: absolute;
        left: 0;
        top: 3px;
        bottom: 3px;
        width: 2px;
        background: var(--aspicio-amber);
        border-radius: 2px;
      }
      .checkbox {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        cursor: pointer;
      }
      .check-fill {
        fill: var(--aspicio-crease);
      }
      .uncheck-stroke {
        stroke: var(--aspicio-hairline2);
        stroke-width: 1.4;
      }
      .swatch {
        width: 13px;
        height: 13px;
        border-radius: 2px;
        flex-shrink: 0;
      }
      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        color: var(--aspicio-text);
      }
      .row.hidden-layer:not(.solo) .name {
        color: var(--aspicio-text3);
      }
      .solo-tag {
        font-family: var(--aspicio-font-mono);
        font-size: 8.5px;
        letter-spacing: 0.1em;
        color: var(--aspicio-amber);
        border: 1px solid var(--aspicio-amberborder);
        border-radius: 2px;
        padding: 1px 4px;
        flex-shrink: 0;
      }
      .count {
        font-family: var(--aspicio-font-mono);
        font-size: 11px;
        color: var(--aspicio-text3);
        flex-shrink: 0;
        font-feature-settings: "tnum" 1;
      }
      .hints {
        flex-shrink: 0;
        padding: 11px 14px 13px;
        border-top: 1px solid var(--aspicio-hairline);
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 5px 10px;
        align-items: baseline;
      }
      .hint-key {
        font-family: var(--aspicio-font-mono);
        font-size: 9.5px;
        letter-spacing: 0.06em;
        color: var(--aspicio-text2);
        white-space: nowrap;
      }
      .hint-desc {
        font-size: 11px;
        color: var(--aspicio-text3);
      }

      /* ---------- minimal (theme="none") ---------- */
      .minimal .row {
        gap: 0.6em;
        padding: 0.35em 0.5em;
        border: none;
        border-radius: 0;
        transition: none;
      }
      .minimal .row.hidden-layer {
        opacity: 0.5;
      }
      .minimal .swatch {
        width: 0.8em;
        height: 0.8em;
      }
      .minimal .count {
        font-family: inherit;
        opacity: 0.55;
        font-size: 0.85em;
        color: inherit;
      }
      .minimal .name {
        font-size: inherit;
        color: inherit;
      }
    `,
  ];

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#subscribedViewer?.off("loaded", this.#sync);
    this.#subscribedViewer = null;
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has("viewer")) {
      this.#subscribedViewer?.off("loaded", this.#sync);
      this.#subscribedViewer = this.viewer ?? null;
      if (this.#subscribedViewer) {
        this.#subscribedViewer.on("loaded", this.#sync);
        this.#sync();
      } else {
        this._layers = [];
        this._soloLayer = null;
      }
    }
  }

  updated(): void {
    // Swatch colors are per-layer data; write them via CSSOM so strict host
    // CSPs (style-src without unsafe-inline) can't strip them.
    const swatches = this.renderRoot.querySelectorAll<HTMLElement>(".swatch");
    swatches.forEach((swatch, i) => {
      const layer = this._layers[i];
      if (!layer) return;
      const rgb = layer.effectiveColors?.[0] ?? layer.color;
      const color = `#${rgb.toString(16).padStart(6, "0")}`;
      const visible = this.#isVisible(layer);
      const borderColor = this.theme === "none" ? "rgba(128,128,128,.5)" : "rgba(255,255,255,.25)";
      swatch.style.background = visible ? color : "transparent";
      swatch.style.border = visible ? `1px solid ${borderColor}` : `1px solid ${color}`;
    });
  }

  #isVisible(layer: LayerInfo): boolean {
    return this._soloLayer ? layer.name === this._soloLayer : layer.visible !== false;
  }

  #toggleLayer(layer: LayerInfo): void {
    const viewer = this.viewer;
    if (!viewer) return;
    if (this._soloLayer) {
      // Toggling a checkbox during solo turns that layer into the only
      // visible one and exits solo.
      for (const l of this._layers) viewer.setLayerVisible(l.name, l.name === layer.name);
      this._soloLayer = null;
    } else {
      viewer.setLayerVisible(layer.name, layer.visible === false);
    }
    this.requestUpdate();
  }

  #toggleSolo(layer: LayerInfo): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const next = this._soloLayer === layer.name ? null : layer.name;
    for (const l of this._layers) viewer.setLayerVisible(l.name, next ? l.name === next : true);
    this._soloLayer = next;
  }

  #exitSolo(): void {
    const viewer = this.viewer;
    if (!viewer) return;
    for (const l of this._layers) viewer.setLayerVisible(l.name, true);
    this._soloLayer = null;
  }

  #hover(name: string | null): void {
    this._hoveredRow = name;
    this.viewer?.setLayerHighlight(name);
  }

  #renderRow(layer: LayerInfo): TemplateResult {
    const themed = this.theme !== "none";
    const visible = this.#isVisible(layer);
    const isSolo = this._soloLayer === layer.name;
    const dimmed = themed && !!this._soloLayer && !isSolo;
    const reverse = themed && this.reverseHighlightLayer === layer.name;
    const rowHover = themed && this._hoveredRow === layer.name;
    const cls = [
      "row",
      visible ? "" : "hidden-layer",
      isSolo ? "solo" : "",
      dimmed ? "dimmed" : "",
      reverse ? "reverse" : "",
      rowHover ? "hovered" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return html`
      <li
        class=${cls}
        part="row"
        title=${themed ? `${layer.name} · ${layer.entityCount} entities` : nothing}
        @mouseenter=${() => this.#hover(layer.name)}
        @mouseleave=${() => this.#hover(null)}
        @dblclick=${(e: Event) => {
          e.preventDefault();
          this.#toggleSolo(layer);
        }}
      >
        ${themed && isSolo ? html`<span class="solo-rail" aria-hidden="true"></span>` : nothing}
        ${themed
          ? html`
              <span
                class="checkbox"
                part="checkbox"
                role="checkbox"
                aria-checked=${visible}
                aria-label=${layer.name}
                tabindex="0"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.#toggleLayer(layer);
                }}
              >
                ${visible ? checkIcon() : uncheckIcon()}
              </span>
            `
          : html`
              <input
                type="checkbox"
                part="checkbox"
                .checked=${visible}
                aria-label=${layer.name}
                @change=${() => this.#toggleLayer(layer)}
              />
            `}
        <span class="swatch" part="swatch" aria-hidden="true"></span>
        <span class="name" part="name">${layer.name}</span>
        ${themed && isSolo ? html`<span class="solo-tag">SOLO</span>` : nothing}
        <span class="count" part="count">${layer.entityCount}</span>
      </li>
    `;
  }

  render(): TemplateResult {
    if (this.theme === "none") {
      return html`
        <ul class="minimal rows" part="rows">
          ${this._layers.map((layer) => this.#renderRow(layer))}
        </ul>
      `;
    }
    return html`
      <div class="panel" part="panel-body">
        <div class="header" part="header">
          LAYERS
          <span class="header-count">${this._layers.length}</span>
        </div>
        ${this._soloLayer
          ? html`
              <div class="solo-banner" part="solo-banner">
                <span class="solo-banner-label">SOLO</span>
                <span class="solo-banner-name">${this._soloLayer}</span>
                <button type="button" class="solo-exit" @click=${() => this.#exitSolo()}>
                  EXIT
                </button>
              </div>
            `
          : nothing}
        <ul class="rows" part="rows">
          ${this._layers.length === 0 ? html`<li class="empty">No layers yet.</li>` : nothing}
          ${this._layers.map((layer) => this.#renderRow(layer))}
        </ul>
        ${!this.noHints
          ? html`
              <div class="hints" part="hints">
                ${DESKTOP_HINTS.map(
                  ([k, v]) => html`
                    <span class="hint-key">${k}</span>
                    <span class="hint-desc">${v}</span>
                  `,
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
