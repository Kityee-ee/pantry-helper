import "server-only";
import { createClient } from "@/lib/supabase/server";

// Last week's consumption per item, derived from stock_events.
//
// Definition (shared with the dashboard, keep in step):
//   take the two most recent `count` events for the item;
//   consumption = earlier qty_after
//               + sum of `delivery` deltas recorded between the two counts
//               - later qty_after
//   floored at 0, and null when the item has fewer than two counts.

export interface ConsumptionEvent {
  item_id: string;
  kind: string;
  delta: number;
  qty_after: number;
  created_at: string;
}

export interface ItemConsumption {
  /** Units used between the two most recent counts. Null with fewer than two counts. */
  consumed: number | null;
  /** When the later of the two counts was taken. */
  counted_at: string | null;
  /** When the earlier of the two counts was taken. */
  previous_count_at: string | null;
}

const NONE: ItemConsumption = { consumed: null, counted_at: null, previous_count_at: null };

/** Pure calculation over a list of events (any order, any mix of items). */
export function consumptionFromEvents(events: ConsumptionEvent[]): Map<string, ItemConsumption> {
  const byItem = new Map<string, ConsumptionEvent[]>();
  for (const e of events) {
    const list = byItem.get(e.item_id);
    if (list) list.push(e);
    else byItem.set(e.item_id, [e]);
  }

  const time = (e: ConsumptionEvent) => new Date(e.created_at).getTime();
  const out = new Map<string, ItemConsumption>();
  for (const [itemId, list] of byItem) {
    const counts = list.filter((e) => e.kind === "count").sort((a, b) => time(b) - time(a));
    if (counts.length < 2) {
      out.set(itemId, { ...NONE, counted_at: counts[0]?.created_at ?? null });
      continue;
    }
    const [later, earlier] = counts;
    const delivered = list
      .filter((e) => e.kind === "delivery" && time(e) > time(earlier) && time(e) < time(later))
      .reduce((sum, e) => sum + e.delta, 0);
    out.set(itemId, {
      consumed: Math.max(0, earlier.qty_after + delivered - later.qty_after),
      counted_at: later.created_at,
      previous_count_at: earlier.created_at,
    });
  }
  return out;
}

/**
 * Last week's consumption for every active item, keyed by item id.
 * Every active item has an entry; `consumed` is null when it cannot be worked out.
 * Runs as the signed-in manager (stock_events is manager-only under RLS), so
 * authorise with requireManager() before calling.
 */
export async function getLastWeekConsumption(): Promise<Map<string, ItemConsumption>> {
  const supabase = await createClient();
  const [itemsRes, eventsRes] = await Promise.all([
    supabase.from("items").select("id").eq("active", true),
    // Newest first, so if the row cap is ever hit it is old history that is cut off.
    supabase
      .from("stock_events")
      .select("item_id, kind, delta, qty_after, created_at")
      .in("kind", ["count", "delivery"])
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const computed = consumptionFromEvents((eventsRes.data ?? []) as ConsumptionEvent[]);
  const out = new Map<string, ItemConsumption>();
  for (const item of itemsRes.data ?? []) {
    out.set(item.id as string, computed.get(item.id as string) ?? NONE);
  }
  return out;
}
