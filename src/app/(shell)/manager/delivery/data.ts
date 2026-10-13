import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { thisWeekStart } from "@/lib/week";
import type { CatalogueEntry, OpenOrder } from "./shared";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Active items, by name. */
export async function loadCatalogue(supabase: Supabase): Promise<CatalogueEntry[]> {
  const { data, error } = await supabase
    .from("items")
    .select("id, name, unit, current_qty")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogueEntry[];
}

/**
 * The order a delivery arriving now should be checked against: the most recent
 * placed order with no delivery linked to it yet.
 *
 * Orders that are due (week_start is this week or earlier) are preferred, so that
 * placing next week's order before recording this week's delivery does not make
 * the delivery reconcile against the wrong order.
 *
 * Call after requireManager(): it reads the clock.
 */
export async function loadOpenOrder(supabase: Supabase): Promise<OpenOrder | null> {
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, week_start, placed_at")
    .eq("status", "placed")
    .order("placed_at", { ascending: false, nullsFirst: false })
    .limit(10);
  if (error) throw new Error(error.message);
  if (!orders || orders.length === 0) return null;

  const { data: delivered, error: deliveriesError } = await supabase
    .from("deliveries")
    .select("order_id")
    .in(
      "order_id",
      orders.map((o) => o.id as string),
    );
  if (deliveriesError) throw new Error(deliveriesError.message);
  const done = new Set((delivered ?? []).map((d) => d.order_id as string));

  const waiting = orders.filter((o) => !done.has(o.id as string));
  const thisWeek = thisWeekStart();
  const order = waiting.find((o) => (o.week_start as string) <= thisWeek) ?? waiting[0];
  if (!order) return null;

  const { data: lines, error: linesError } = await supabase
    .from("order_lines")
    .select("item_id, item_name, qty")
    .eq("order_id", order.id)
    .order("item_name");
  if (linesError) throw new Error(linesError.message);

  return {
    id: order.id as string,
    week_start: order.week_start as string,
    placed_at: (order.placed_at as string | null) ?? null,
    lines: ((lines ?? []) as OpenOrder["lines"]).filter((l) => l.qty > 0),
  };
}
