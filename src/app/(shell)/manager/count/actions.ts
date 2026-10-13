"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const Counts = z.record(z.uuid(), z.number().int().min(0).max(100_000));

export type CountResult = { ok: true; changed: number; counted: number } | { ok: false; error: string };

/**
 * Save a stock count. Every active item gets a `count` stock event (delta 0 when
 * unchanged, so weekly consumption stays computable); changed items also get
 * their current_qty updated.
 */
export async function saveCount(input: Record<string, number>): Promise<CountResult> {
  const me = await requireManager();

  const parsed = Counts.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Every count must be a whole number, 0 or more." };
  const counts = parsed.data;

  const supabase = await createClient();
  const { data: items, error: loadError } = await supabase
    .from("items")
    .select("id, current_qty")
    .eq("active", true);
  if (loadError) {
    console.error("[count] load failed:", loadError.message);
    return { ok: false, error: "Could not load the items. Please try again." };
  }

  // Deltas are measured against what the database holds now, not what the form was loaded with.
  // An active item missing from the form (added since the page loaded) is recorded as unchanged.
  const rows = ((items ?? []) as { id: string; current_qty: number }[]).map((item) => {
    const qty = counts[item.id] ?? item.current_qty;
    return { id: item.id, qty, delta: qty - item.current_qty };
  });
  if (rows.length === 0) return { ok: false, error: "There are no active items to count." };

  const { error: eventsError } = await supabase.from("stock_events").insert(
    rows.map((r) => ({
      item_id: r.id,
      kind: "count",
      delta: r.delta,
      qty_after: r.qty,
      created_by: me.id,
    })),
  );
  if (eventsError) {
    console.error("[count] insert events failed:", eventsError.message);
    return { ok: false, error: "Could not save the count. Nothing was changed." };
  }

  const changed = rows.filter((r) => r.delta !== 0);
  const updates = await Promise.all(
    changed.map((r) => supabase.from("items").update({ current_qty: r.qty }).eq("id", r.id)),
  );
  const failed = updates.filter((u) => u.error);
  if (failed.length > 0) {
    console.error("[count] item update failed:", failed[0].error?.message);
    refresh();
    return {
      ok: false,
      error: `The count was recorded, but ${failed.length} of ${changed.length} stock levels did not update. Check the numbers and save again.`,
    };
  }

  refresh();
  return { ok: true, changed: changed.length, counted: rows.length };
}
