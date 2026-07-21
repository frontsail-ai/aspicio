import type { DxfSource, DxfViewer, DxfViewerOptions } from "@aspicio/core";
import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import type { DxfTheme } from "./theme.ts";
import { canvasBackgroundStyles, tokenStyles } from "./theme.ts";

export type PanelSide = "left" | "right" | "none";

/**
 * `<aspicio-embed>` — batteries-included embed: layer list + interactive
 * preview in one element, styled like the Aspicio demo app (blueprint
 * grid, dark panel) unless `theme="none"`. Pass the DXF via the `src-url`
 * attribute or the `src` property (text, File, Blob, ArrayBuffer);
 * everything else is optional.
 *
 *   <aspicio-embed src-url="/drawing.dxf" style="height: 480px"></aspicio-embed>
 *
 * The `viewer` property (and the `viewer-change` event) exposes the full
 * DxfViewer for camera control; compose <aspicio-preview> and
 * <aspicio-layer-panel> directly when you need a custom layout.
 * `loaded`, `load-error`, and `hover-layer` events are re-dispatched from
 * this element.
 */
export class AspicioEmbed extends LitElement {
  static properties = {
    src: { attribute: false },
    srcUrl: { type: String, attribute: "src-url" },
    options: { attribute: false },
    panel: { type: String },
    // Reflected: the host styles key off :host([theme="none"]), which must
    // hold whether callers set the attribute or the property.
    theme: { type: String, reflect: true },
    panelStyle: { attribute: false },
    noDownload: { type: Boolean, attribute: "no-download" },
    shortcuts: { type: Boolean },
    _reverseHighlight: { state: true },
    _viewer: { state: true },
  };

  declare src: DxfSource | null;
  declare srcUrl: string | null;
  declare options: DxfViewerOptions | undefined;
  declare panel: PanelSide;
  declare theme: DxfTheme;
  declare panelStyle: Partial<CSSStyleDeclaration> | undefined;
  declare noDownload: boolean;
  declare shortcuts: boolean;
  declare _reverseHighlight: string | null;
  declare _viewer: DxfViewer | null;

  constructor() {
    super();
    this.src = null;
    this.srcUrl = null;
    this.options = undefined;
    this.panel = "left";
    this.theme = "aspicio";
    this.panelStyle = undefined;
    this.noDownload = false;
    this.shortcuts = false;
    this._reverseHighlight = null;
    this._viewer = null;
  }

  /** The live DxfViewer instance of the inner preview, or null. */
  get viewer(): DxfViewer | null {
    return this._viewer;
  }

  static styles = [
    tokenStyles,
    canvasBackgroundStyles,
    css`
      :host {
        display: flex;
        width: 100%;
        height: 100%;
      }
      :host(:not([theme="none"])) {
        background: var(--aspicio-bg);
        border: 1px solid var(--aspicio-hairline2);
        border-radius: 6px;
        overflow: hidden;
      }
      :host([theme="none"]) {
        gap: 0.75em;
      }
      aspicio-layer-panel {
        width: 220px;
        flex-shrink: 0;
      }
      :host(:not([theme="none"])) aspicio-layer-panel.panel-left {
        border-right: 1px solid var(--aspicio-hairline);
      }
      :host(:not([theme="none"])) aspicio-layer-panel.panel-right {
        border-left: 1px solid var(--aspicio-hairline);
      }
      :host([theme="none"]) aspicio-layer-panel {
        overflow-y: auto;
      }
      .canvas-wrap {
        flex: 1;
        min-width: 0;
        position: relative;
      }
      .canvas-wrap aspicio-preview {
        position: absolute;
        inset: 0;
      }
    `,
  ];

  updated(changed: PropertyValues): void {
    if (changed.has("panelStyle") || changed.has("panel") || changed.has("theme")) {
      // A style object can't cross the shadow boundary as CSS, so apply it
      // via CSSOM on the panel element (also keeps strict host CSPs happy).
      const panelEl = this.renderRoot.querySelector<HTMLElement>("aspicio-layer-panel");
      if (panelEl && this.panelStyle) Object.assign(panelEl.style, this.panelStyle);
    }
  }

  #onViewerChange = (e: CustomEvent<{ viewer: DxfViewer | null }>): void => {
    this._viewer = e.detail.viewer;
    this.#redispatch(e);
  };

  #onHoverLayer = (e: CustomEvent<{ layer: string | null }>): void => {
    if (this.panel !== "none") this._reverseHighlight = e.detail.layer;
    this.#redispatch(e);
  };

  #redispatch = (e: CustomEvent): void => {
    this.dispatchEvent(new CustomEvent(e.type, { detail: e.detail }));
  };

  #previewOptions(): DxfViewerOptions | undefined {
    // The demo look draws its blueprint grid behind a transparent canvas;
    // respect an explicit background if the caller set one.
    const themed = this.theme !== "none";
    return themed && this.options?.background === undefined
      ? { ...this.options, background: null }
      : this.options;
  }

  #renderPanel(): TemplateResult | typeof nothing {
    if (this.panel === "none") return nothing;
    return html`
      <aspicio-layer-panel
        class=${this.panel === "left" ? "panel-left" : "panel-right"}
        part="panel"
        exportparts="header, row, checkbox, swatch, name, count, hints, solo-banner, rows"
        theme=${this.theme}
        .viewer=${this._viewer}
        reverse-highlight-layer=${this._reverseHighlight ?? nothing}
      ></aspicio-layer-panel>
    `;
  }

  render(): TemplateResult {
    const themed = this.theme !== "none";
    return html`
      ${this.panel === "left" ? this.#renderPanel() : nothing}
      <div class="canvas-wrap ${themed ? "canvas-grid" : ""}">
        <aspicio-preview
          part="preview"
          exportparts="canvas-host, download"
          .src=${this.src}
          src-url=${this.srcUrl ?? nothing}
          .options=${this.#previewOptions()}
          ?no-download=${this.noDownload}
          ?shortcuts=${this.shortcuts}
          hover-pick
          @viewer-change=${this.#onViewerChange}
          @hover-layer=${this.#onHoverLayer}
          @loaded=${this.#redispatch}
          @load-error=${this.#redispatch}
        ></aspicio-preview>
      </div>
      ${this.panel === "right" ? this.#renderPanel() : nothing}
    `;
  }
}
