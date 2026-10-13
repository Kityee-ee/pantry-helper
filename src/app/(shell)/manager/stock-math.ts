// Pure helpers shared by the manager dashboard, the inbox and the Friday summary email.
// No I/O and no server-only imports, so both pages and src/lib/friday-summary.ts can use them.

import type { Item, StockEvent, Submission } from "@/lib/types";

/** A requested item is suggested on the next order once this many DIFFERENT people asked for it. */
export const REQUEST_THRESHOLD = 3;

/** An item is overstocked when it holds more than this many weeks of stock. */
export const OVERSTOCK_WEEKS = 2;

/** How far back to load stock_events when deriving consumption. */
export const CONSUMPTION_LOOKBACK_DAYS = 35;

const DAY_MS = 86_400_000;
/** Two counts closer together than this are treated as the same count (e.g. a correction). */
const MIN_GAP_DAYS = 2;

export type StockEventLite = Pick<StockEvent, "item_id" | "kind" | "delta" | "qty_after" | "created_at">;

/**
 * Weekly consumption per item id, from the latest count and the most recent count at
 * least MIN_GAP_DAYS before it:
 *
 *   consumed = earlier count qty_after + deliveries between the two counts - later count qty_after
 *
 * scaled to 7 days. Items without two usable counts, or where the result is not
 * positive, are left out: the caller falls back to the par-level rule.
 */
export function weeklyConsumption(events: StockEventLite[]): Map<string, number> {
  const byItem = new Map<string, StockEventLite[]>();
  for (const e of events) {
    const list = byItem.get(e.item_id);
    if (list) list.push(e);
    else byItem.set(e.item_id, [e]);
  }

  const result = new Map<string, number>();
  for (const [itemId, list] of byItem) {
    list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const counts = list.filter((e) => e.kind === "count");
    const later = counts[counts.length - 1];
    if (!later) continue;
    const laterAt = Date.parse(later.created_at);
    let earlier: StockEventLite | undefined;
    for (let i = counts.length - 2; i >= 0; i--) {
      if (laterAt - Date.parse(counts[i].created_at) >= MIN_GAP_DAYS * DAY_MS) {
        earlier = counts[i];
        break;
      }
    }
    if (!earlier) continue;
    const earlierAt = Date.parse(earlier.created_at);

    let delivered = 0;
    for (const e of list) {
      const t = Date.parse(e.created_at);
      if (e.kind === "delivery" && t > earlierAt && t <= laterAt) delivered += e.delta;
    }
    const consumed = earlier.qty_after + delivered - later.qty_after;
    const weekly = (consumed * 7 * DAY_MS) / (laterAt - earlierAt);
    if (weekly > 0) result.set(itemId, weekly);
  }
  return result;
}

export interface OverstockRow {
  item: Item;
  /** Weeks of stock on hand, or null when consumption could not be derived. */
  weeksOfStock: number | null;
  weekly: number | null;
}

/** Items holding more than OVERSTOCK_WEEKS of stock; falls back to current_qty > 2 x par_level. */
export function overstocked(items: Item[], weekly: Map<string, number>): OverstockRow[] {
  const rows: OverstockRow[] = [];
  for (const item of items) {
    if (item.current_qty <= 0) continue;
    const w = weekly.get(item.id);
    if (w !== undefined) {
      const weeks = item.current_qty / w;
      if (weeks > OVERSTOCK_WEEKS) rows.push({ item, weeksOfStock: weeks, weekly: w });
    } else if (item.par_level > 0 && item.current_qty > OVERSTOCK_WEEKS * item.par_level) {
      rows.push({ item, weeksOfStock: null, weekly: null });
    }
  }
  return rows.sort(
    (a, b) => (b.weeksOfStock ?? Number.POSITIVE_INFINITY) - (a.weeksOfStock ?? Number.POSITIVE_INFINITY),
  );
}

export const isBelowPar = (item: Pick<Item, "current_qty" | "par_level">) => item.current_qty < item.par_level;

/** current / par, with par 0 counted as "fine". Used to sort the stock list, lowest first. */
export function parRatio(item: Pick<Item, "current_qty" | "par_level">): number {
  return item.par_level > 0 ? item.current_qty / item.par_level : Number.POSITIVE_INFINITY;
}

export type RequestRow = Pick<
  Submission,
  "id" | "user_id" | "type" | "requested_item_name" | "raw_text" | "created_at"
>;

export interface RequestGroup {
  name: string;
  /** Distinct user ids. */
  requesterIds: string[];
  submissions: RequestRow[];
  atThreshold: boolean;
}

/**
 * Group new_request submissions by requested_item_name (trimmed, lower-cased).
 * Pass only the rows that should count (this lane passes those that are not resolved).
 * Rows without a requested_item_name are ignored.
 */
export function groupRequests(rows: RequestRow[]): RequestGroup[] {
  const groups = new Map<string, RequestGroup>();
  for (const s of rows) {
    if (s.type !== "new_request") continue;
    const name = s.requested_item_name?.trim().toLowerCase();
    if (!name) continue;
    let g = groups.get(name);
    if (!g) {
      g = { name, requesterIds: [], submissions: [], atThreshold: false };
      groups.set(name, g);
    }
    if (!g.requesterIds.includes(s.user_id)) g.requesterIds.push(s.user_id);
    g.submissions.push(s);
  }
  const list = [...groups.values()];
  for (const g of list) g.atThreshold = g.requesterIds.length >= REQUEST_THRESHOLD;
  return list.sort((a, b) => b.requesterIds.length - a.requesterIds.length || a.name.localeCompare(b.name));
}
