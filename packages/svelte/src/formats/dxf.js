/**
 * @aspicio/svelte/formats/dxf — teach the Svelte components to read DXF.
 *
 * ```js
 * import "@aspicio/svelte/formats/dxf";
 * ```
 *
 * A re-export of the elements format module: the components are veneers over
 * the web components, so they share one registry. Importing this module is the
 * whole API; a bundle that never imports it carries no DXF code (INV-11).
 *
 * Plain JS, like the rest of this package — it ships as source (SVELTE-8).
 */

import "@aspicio/elements/formats/dxf";
