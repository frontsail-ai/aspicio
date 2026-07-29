/**
 * @aspicio/elements/formats/pdf — teach the components to read PDF.
 *
 * ```ts
 * import "@aspicio/elements";
 * import "@aspicio/elements/formats/pdf";
 * ```
 *
 * Importing this module is the whole API: it registers the PDF parser and
 * exports nothing. A page that never imports it bundles no PDF code (INV-11),
 * which is why the package declares this path as side-effectful.
 */

import { pdfParser } from "@aspicio/core/pdf";
import { registerFormat } from "../formats.ts";

registerFormat(pdfParser);
