/**
 * @aspicio/react/formats/pdf — teach the React components to read PDF.
 *
 * ```ts
 * import "@aspicio/react/formats/pdf";
 * ```
 *
 * A re-export of the elements format module: the components are veneers over
 * the web components, so they share one registry. Importing this module is the
 * whole API; a bundle that never imports it carries no PDF code (INV-11).
 */

import "@aspicio/elements/formats/pdf";
