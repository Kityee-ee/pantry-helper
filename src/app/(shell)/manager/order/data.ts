import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { OrderLine } from "@/lib/types";
import type { OrderRef } from "./shared";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type LineRow = Pick<
  OrderLine,
  "id" | "item_id" | "item_name" | "qty" | "suggested_qty" | "reason" | "is_new" | "waste_risk"
>;

const LINE_COLUMNS = "id, item_id, item_name, qty, suggested_qty, reason, is_new, waste_risk";

export async function loadLines(supabase: Supabase, orderId: string): Promise<LineRow[]> {
  const { data, error } = await supabase
    .from("order_lines")
    .select(LINE_COLUMNS)
    .eq("order_id", orderId)
    .order("is_new")
    .order("item_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as LineRow[];
}

/**
 * Headcount for last week. Falls back to the most recent earlier week on record,
 * so a missing row does not blank the page.
 */
export async function loadLastHeadcount(
  supabase: Supabase,
  lastWeek: string,
): Promise<{ week_start: string; headcount: number } | null> {
  const { data, error } = await supabase
    .from("headcounts")
    .select("week_start, headcount")
    .lte("week_start", lastWeek)
    .order("week_start", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return row ? { week_start: row.week_start as string, headcount: row.headcount as number } : null;
}

/** Placed orders, newest week first, each with its total units. */
export async function loadPlacedOrders(
  supabase: Supabase,
  opts: { beforeWeek?: string; limit: number },
): Promise<(OrderRef & { lines: { item_id: string | null; qty: number }[] })[]> {
  let query = supabase
    .from("orders")
    .select("id, week_start, headcount, placed_at, order_lines(item_id, qty)")
    .eq("status", "placed")
    .order("week_start", { ascending: false })
    .order("placed_at", { ascending: false, nullsFirst: false })
    .limit(opts.limit);
  if (opts.beforeWeek) query = query.lt("week_start", opts.beforeWeek);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((o) => {
    const lines = ((o.order_lines ?? []) as { item_id: string | null; qty: number }[]).filter((l) => l.qty > 0);
    return {
      id: o.id as string,
      week_start: o.week_start as string,
      headcount: (o.headcount as number | null) ?? null,
      placed_at: (o.placed_at as string | null) ?? null,
      total_units: lines.reduce((sum, l) => sum + l.qty, 0),
      line_count: lines.length,
      lines,
    };
  });
}
