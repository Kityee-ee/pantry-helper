// Types and constants shared by the delivery page, its client component and its server actions.
// No server-only imports here: the client component imports this file.

export type Confidence = "high" | "medium" | "low";

export interface CatalogueEntry {
  id: string;
  name: string;
  unit: string | null;
  current_qty: number;
}

/** The most recent placed order that has no delivery recorded against it yet. */
export interface OpenOrder {
  id: string;
  week_start: string;
  placed_at: string | null;
  lines: { item_id: string | null; item_name: string; qty: number }[];
}

/** A docket line as read by the AI (see src/lib/ai/extract-docket.ts). */
export interface ExtractedLine {
  line_text: string;
  item_id: string | null;
  quantity: number;
  confidence: Confidence;
}

export interface Extraction {
  supplier: string | null;
  docket_number: string | null;
  lines: ExtractedLine[];
}

export type ExtractActionResult =
  | { ok: true; extraction: Extraction; model: string }
  | { ok: false; message: string };

/** One reviewed row sent to the confirm action. */
export interface ConfirmRow {
  line_text: string;
  action: "item" | "new" | "skip";
  item_id: string | null;
  new_name: string | null;
  delivered: number;
  confidence: Confidence | null;
}

export interface ConfirmPayload {
  order_id: string | null;
  source: "ai" | "manual";
  model: string | null;
  extraction: Extraction | null;
  rows: ConfirmRow[];
}

export interface DeliverySummary {
  delivery_id: string;
  items: {
    name: string;
    unit: string | null;
    delivered: number;
    ordered: number | null;
    qty_after: number;
    created: boolean;
  }[];
  not_delivered: { name: string; ordered: number }[];
  resolved_reports: number;
  notified: number;
  photo_saved: boolean;
  warnings: string[];
}

export type ConfirmActionResult = { ok: true; summary: DeliverySummary } | { ok: false; error: string };

/**
 * What `deliveries.raw_extraction` holds. Written by confirmDeliveryAction.
 * `extraction` is exactly what the AI returned (null for manual entry);
 * `confirmed` is what the manager approved, which is what stock was changed by.
 */
export interface RawExtraction {
  version: 1;
  source: "ai" | "manual";
  model: string | null;
  supplier: string | null;
  docket_number: string | null;
  lines: ExtractedLine[];
  confirmed: {
    line_text: string;
    action: "item" | "new" | "skip";
    item_id: string | null;
    item_name: string | null;
    ordered: number | null;
    delivered: number;
    confidence: Confidence | null;
  }[];
  not_delivered: { item_id: string | null; item_name: string; ordered: number }[];
}

export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Server actions accept a 1 MB request body by default (next.config serverActions.bodySizeLimit),
 * so the browser shrinks the photo to fit under this before sending it.
 */
export const MAX_UPLOAD_BYTES = 750 * 1024;
/** Hard ceiling the server accepts, in case the body limit is raised later. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const MAX_ROWS = 80;
export const MAX_QTY = 9999;
export const MAX_NAME = 80;
