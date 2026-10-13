// Types and constants shared by the order pages, their client components and server actions.
// No server-only imports here.

export interface EditorLine {
  /** order_lines.id, or null for a line added in the browser and not saved yet. */
  id: string | null;
  item_id: string | null;
  item_name: string;
  unit: string | null;
  current_qty: number | null;
  par_level: number | null;
  /** Units used last week. Null when unknown or for items not stocked yet. */
  used_last_week: number | null;
  suggested_qty: number | null;
  qty: number;
  reason: string | null;
  is_new: boolean;
  waste_risk: boolean;
}

export interface CatalogueOption {
  id: string;
  name: string;
  unit: string | null;
  current_qty: number;
  par_level: number;
  used_last_week: number | null;
}

/** What the browser sends back when saving or placing the draft. */
export interface LineInput {
  id: string | null;
  item_id: string | null;
  item_name: string;
  qty: number;
}

export interface OrderRef {
  id: string;
  week_start: string;
  headcount: number | null;
  placed_at: string | null;
  total_units: number;
  line_count: number;
}

export type ActionResult = { ok: true } | { ok: false; error: string };
export type SuggestResult = { ok: true; source: "ai" | "rules" } | { ok: false; error: string };

export const MAX_QTY = 9999;
export const MAX_LINES = 120;
export const MAX_NAME = 80;
export const MAX_HEADCOUNT = 100000;
export const MAX_SUMMARY_TEXT = 8000;
