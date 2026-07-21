<!--
  Minimal real-world usage of the Svelte bindings: <DxfEmbed> renders the
  layer panel + interactive viewer from a URL, with keyboard shortcuts on.
  Doubles as the browser test harness for the embed.
-->
<script lang="ts">
  import type { DxfViewer, ViewerStats } from "@aspicio/core";
  import { DxfEmbed } from "@aspicio/svelte";
  import type { LoadedInfo } from "@aspicio/svelte";

  let stats: ViewerStats | null = $state(null);
</script>

<div
  style="height: 100vh; display: flex; flex-direction: column; background: #0f1115; color: #e7e3da; font-family: 'IBM Plex Sans', system-ui, sans-serif;"
>
  <header
    style="display: flex; align-items: baseline; gap: 14px; padding: 11px 16px; border-bottom: 1px solid #282c34; font-family: 'IBM Plex Mono', monospace; font-size: 13px; letter-spacing: 0.12em;"
  >
    <span>ASPICIO · SVELTE EMBED</span>
    {#if stats}
      <span style="color: #9aa0ab;">{stats.entityCount} ENT</span>
    {/if}
    <span style="color: #6a707b; font-size: 11px; letter-spacing: 0.04em;">
      click the viewer, then F fit · A show all · +/− zoom · R reset
    </span>
  </header>
  <main style="flex: 1; min-height: 0; padding: 16px;">
    <DxfEmbed
      srcUrl="/sample.dxf"
      shortcuts
      style="height: 100%; border-radius: 8px;"
      onviewerchange={(viewer: DxfViewer | null) => {
        window.__viewer = viewer ?? undefined;
      }}
      onloaded={(info: LoadedInfo) => {
        stats = info.stats;
      }}
    />
  </main>
</div>
