/**
 * @aspicio/vue/formats/dxf — teach the Vue components to read DXF.
 *
 * ```ts
 * import "@aspicio/vue/formats/dxf";
 * ```
 *
 * A re-export of the elements format module: the components are veneers over
 * the web components, so they share one registry. Importing this module is the
 * whole API; a bundle that never imports it carries no DXF code (INV-11).
 */

import "@aspicio/elements/formats/dxf";
