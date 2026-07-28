/**
 * @aspicio/elements/formats/dxf — teach the components to read DXF.
 *
 * ```ts
 * import "@aspicio/elements";
 * import "@aspicio/elements/formats/dxf";
 * ```
 *
 * Importing this module is the whole API: it registers the DXF parser and
 * exports nothing. A page that never imports it bundles no DXF code (INV-11),
 * which is why the package declares this path as side-effectful.
 */

import { dxfParser } from "@aspicio/core/dxf";
import { registerFormat } from "../formats.ts";

registerFormat(dxfParser);
