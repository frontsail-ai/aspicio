import { DxfViewer, attachShortcuts } from "@aspicio/core";
import type { DxfSource, DxfViewerOptions, LayerInfo, ViewerStats } from "@aspicio/core";
import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues, TemplateResult } from "lit";
import { tokenStyles } from "./theme.ts";

/** Payload of the `loaded` event. */
export interface LoadedDetail {
  layers: LayerInfo[];
  stats: ViewerStats;
}

/**
 * `<aspicio-preview>` — chrome-less embeddable DXF viewer. The canvas fills
 * the element; pan/zoom/rotate gestures work out of the box.
 *
 * Attributes: `src-url`, `no-download`, `shortcuts`, `hover-pick`.
 * Properties: `src` (text | File | Blob | ArrayBuffer), `options`
 * (applied at creation; changing them recreates the viewer), and the
 * readonly `viewer` (the full DxfViewer for camera control, layer
 * toggling, hit-testing, exports). Between `src` and `src-url`, the most
 * recently set source wins; if both are set at creation, `src-url` does.
 * Events: `loaded` ({layers, stats}), `load-error` ({error}),
 * `viewer-change` ({viewer}), `hover-layer` ({layer}).
 */
export class AspicioPreview extends LitElement {
  static properties = {
    src: { attribute: false },
    srcUrl: { type: String, attribute: "src-url" },
    options: { attribute: false },
    noDownload: { type: Boolean, attribute: "no-download" },
    shortcuts: { type: Boolean },
    hoverPick: { type: Boolean, attribute: "hover-pick" },
    _downloadOpen: { state: true },
    _viewerReady: { state: true },
  };

  declare src: DxfSource | null;
  declare srcUrl: string | null;
  declare options: DxfViewerOptions | undefined;
  declare noDownload: boolean;
  declare shortcuts: boolean;
  declare hoverPick: boolean;
  declare _downloadOpen: boolean;
  declare _viewerReady: boolean;

  #viewer: DxfViewer | null = null;
  #firstCycleDone = false;
  /** Which source was set most recently — the one loads use (ELEM-3). */
  #activeSource: "src" | "url" | null = null;
  #loadToken = 0;
  /** Options snapshot the live viewer was created with. */
  #appliedOptionsKey = "{}";
  #detachHover: (() => void) | null = null;
  #detachShortcuts: (() => void) | null = null;

  constructor() {
    super();
    this.src = null;
    this.srcUrl = null;
    this.options = undefined;
    this.noDownload = false;
    this.shortcuts = false;
    this.hoverPick = false;
    this._downloadOpen = false;
    this._viewerReady = false;
  }

  /** The live DxfViewer instance, or null before first render / after disconnect. */
  get viewer(): DxfViewer | null {
    return this.#viewer;
  }

  willUpdate(changed: PropertyValues): void {
    if (!changed.has("src") && !changed.has("srcUrl")) return;
    // The most recently set source wins (ELEM-3): an attribute lingering in
    // the markup must not shadow a later `src` assignment. When both change
    // in the same cycle (e.g. both set in the initial markup), src-url keeps
    // its documented precedence.
    if (changed.has("src") && this.src != null) this.#activeSource = "src";
    if (changed.has("srcUrl") && this.srcUrl != null) this.#activeSource = "url";
    // A cleared active source falls back to the other one, if set.
    if (this.#activeSource === "src" && this.src == null)
      this.#activeSource = this.srcUrl != null ? "url" : null;
    if (this.#activeSource === "url" && this.srcUrl == null)
      this.#activeSource = this.src != null ? "src" : null;
  }

  static styles = [
    tokenStyles,
    css`
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
      }
      .canvas-host {
        position: relative;
        width: 100%;
        height: 100%;
        outline: none;
      }
      .download {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 5;
      }
      .download-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: rgba(25, 28, 34, 0.9);
        border: 1px solid var(--aspicio-hairline2);
        border-radius: 4px;
        color: var(--aspicio-text2);
        cursor: pointer;
      }
      .download-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 116px;
        padding: 4px;
        background: var(--aspicio-panel);
        border: 1px solid var(--aspicio-hairline2);
        border-radius: 5px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
      }
      .download-item {
        display: block;
        width: 100%;
        padding: 6px 10px;
        background: transparent;
        border: none;
        border-radius: 3px;
        color: var(--aspicio-text);
        font: 12px var(--aspicio-font-mono);
        letter-spacing: 0.06em;
        text-align: left;
        cursor: pointer;
      }
    `,
  ];

  get #container(): HTMLElement | null {
    return this.renderRoot?.querySelector(".canvas-host") ?? null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Recreate the viewer after a disconnect/reconnect cycle (e.g. the host
    // moved the element); first creation happens in firstUpdated.
    if (this.hasUpdated && !this.#viewer) this.#createViewer();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#destroyViewer();
  }

  firstUpdated(): void {
    this.#createViewer();
  }

  updated(changed: PropertyValues): void {
    // Lit's first cycle reports every constructor-set property as changed;
    // firstUpdated already created the viewer and started the initial load.
    if (!this.#firstCycleDone) {
      this.#firstCycleDone = true;
      return;
    }
    if (!this.#viewer) return;
    const optionsKey = JSON.stringify(this.options ?? {});
    if (optionsKey !== this.#appliedOptionsKey) {
      // Options apply at creation; a changed object identity alone must not
      // recreate a WebGL context, so compare serialized values.
      this.#destroyViewer();
      this.#createViewer();
      return; // createViewer starts a load with the current source
    }
    if (changed.has("src") || changed.has("srcUrl")) this.#startLoad();
    if (changed.has("hoverPick")) this.#syncHoverPick();
    if (changed.has("shortcuts")) this.#syncShortcuts();
  }

  #createViewer(): void {
    const container = this.#container;
    if (!container) return;
    this.#appliedOptionsKey = JSON.stringify(this.options ?? {});
    const instance = new DxfViewer(
      container,
      JSON.parse(this.#appliedOptionsKey) as DxfViewerOptions,
    );
    this.#viewer = instance;
    this._viewerReady = true;
    this.#emit("viewer-change", { viewer: instance });
    this.#syncHoverPick();
    this.#syncShortcuts();
    if (this.#activeSource != null) this.#startLoad();
  }

  #destroyViewer(): void {
    if (!this.#viewer) return;
    this.#detachHover?.();
    this.#detachHover = null;
    this.#detachShortcuts?.();
    this.#detachShortcuts = null;
    this.#viewer.dispose();
    this.#viewer = null;
    this._viewerReady = false;
    this.#emit("viewer-change", { viewer: null });
  }

  #startLoad(): void {
    const viewer = this.#viewer;
    if (!viewer || this.#activeSource == null) return;
    const token = ++this.#loadToken;
    const loading =
      this.#activeSource === "url"
        ? viewer.loadUrl(this.srcUrl as string)
        : viewer.load(this.src as DxfSource);
    loading
      .then(() => {
        if (token !== this.#loadToken || viewer !== this.#viewer) return; // superseded
        this.#emit("loaded", { layers: viewer.getLayers(), stats: viewer.stats });
      })
      .catch((error: unknown) => {
        if (token !== this.#loadToken || viewer !== this.#viewer) return;
        this.#emit("load-error", {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }

  #syncHoverPick(): void {
    this.#detachHover?.();
    this.#detachHover = null;
    const viewer = this.#viewer;
    const container = this.#container;
    if (!viewer || !container || !this.hoverPick) return;
    let queued = false;
    let last: string | null = null;
    const report = (layer: string | null): void => {
      if (layer === last) return;
      last = layer;
      viewer.setLayerHighlight(layer);
      this.#emit("hover-layer", { layer });
    };
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse" || e.buttons !== 0 || queued) return;
      queued = true;
      const { clientX, clientY } = e;
      requestAnimationFrame(() => {
        queued = false;
        const rect = container.getBoundingClientRect();
        report(viewer.pickLayer(clientX - rect.left, clientY - rect.top));
      });
    };
    const onLeave = (): void => report(null);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    this.#detachHover = () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      report(null);
    };
  }

  // Keyboard shortcuts scoped to the focused container so multiple embeds on
  // a page don't fight over global keys. The canvas isn't focusable, so
  // clicking the embed focuses the container to receive keys. The container
  // (not window) is the listener target: inside a shadow tree, window-level
  // keydowns retarget to the host and would defeat the form-field guard.
  #syncShortcuts(): void {
    this.#detachShortcuts?.();
    this.#detachShortcuts = null;
    const viewer = this.#viewer;
    const container = this.#container;
    if (!viewer || !container || !this.shortcuts) return;
    if (container.tabIndex < 0) container.tabIndex = 0;
    const focus = (): void => container.focus();
    container.addEventListener("pointerdown", focus);
    const detach = attachShortcuts(container, viewer, {
      onShowAll: () => {
        for (const layer of viewer.getLayers()) viewer.setLayerVisible(layer.name, true);
      },
    });
    this.#detachShortcuts = () => {
      container.removeEventListener("pointerdown", focus);
      detach();
    };
  }

  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #downloadName(): string {
    const base = this.srcUrl?.split(/[?#]/)[0].split("/").pop() ?? "";
    return base.replace(/\.dxf$/i, "") || "drawing";
  }

  #save(format: "svg" | "png"): void {
    const viewer = this.#viewer;
    if (!viewer) return;
    const canvasBg =
      getComputedStyle(this).getPropertyValue("--aspicio-canvas").trim() || "#16181d";
    if (format === "svg") {
      const blob = new Blob([viewer.toSVG({ background: canvasBg })], {
        type: "image/svg+xml",
      });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${this.#downloadName()}.svg`);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      triggerDownload(
        viewer.toPNG({ background: parseInt(canvasBg.replace("#", ""), 16) }),
        `${this.#downloadName()}.png`,
      );
    }
    this._downloadOpen = false;
  }

  // The viewer appends its canvas to .canvas-host after Lit renders; the
  // download control lives in a sibling overlay, so Lit never reconciles
  // the canvas node.
  render(): TemplateResult {
    return html`
      <div class="canvas-host" part="canvas-host"></div>
      ${!this.noDownload && this._viewerReady
        ? html`
            <div class="download" part="download">
              <button
                type="button"
                class="download-toggle"
                aria-label="Download"
                @click=${() => {
                  this._downloadOpen = !this._downloadOpen;
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M12 15V3" />
                </svg>
              </button>
              ${this._downloadOpen
                ? html`
                    <div class="download-menu">
                      <button type="button" class="download-item" @click=${() => this.#save("svg")}>
                        SVG
                      </button>
                      <button type="button" class="download-item" @click=${() => this.#save("png")}>
                        PNG
                      </button>
                    </div>
                  `
                : nothing}
            </div>
          `
        : nothing}
    `;
  }
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
