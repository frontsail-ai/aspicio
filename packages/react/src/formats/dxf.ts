/**
 * @aspicio/react/formats/dxf — teach the React components to read DXF.
 *
 * ```ts
 * import "@aspicio/react/formats/dxf";
 * ```
 *
 * A re-export of the elements format module: the components are veneers over
 * the web components, so they share one registry. Importing this module is the
 * whole API; a bundle that never imports it carries no DXF code (INV-11).
 */

import "@aspicio/elements/formats/dxf";
