// The root entry plus the PDF format entry — the shape a PDF-only app has.
import { DrawingViewer } from "@aspicio/core";
import { pdfParser } from "@aspicio/core/pdf";

export const probe = [DrawingViewer, pdfParser];
