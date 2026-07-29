// The root entry plus the DXF format entry — the shape every DXF app has.
import { DrawingViewer } from "@aspicio/core";
import { dxfParser } from "@aspicio/core/dxf";

export const probe = [DrawingViewer, dxfParser];
