/**
 * @aspicio/svelte/formats/pdf — teach the Svelte components to read PDF.
 *
 * ```js
 * import "@aspicio/svelte/formats/pdf";
 * ```
 *
 * A re-export of the elements format module: the components are veneers over
 * the web components, so they share one registry. Importing this module is the
 * whole API; a bundle that never imports it carries no PDF code (INV-11).
 *
 * Plain JS, like the rest of this package — it ships as source (SVELTE-8).
 */

import "@aspicio/elements/formats/pdf";
