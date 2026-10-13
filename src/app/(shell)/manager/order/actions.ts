"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import {
  REQUEST_THRESHOLD,
  buildSuggestInput,
  suggestOrder,
  type RequestedItemSignal,
  type SuggestItemFacts,
} from "@/lib/ai/suggest-order";
import { getLastWeekConsumption } from "@/lib/consumption";
import { notify } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { formatDay, lastWeekStart, nextWeekStart } from "@/lib/week";
import { loadLastHeadcount, loadLines, loadPlacedOrders } from "./data";
import {
  MAX_HEADCOUNT,
  MAX_LINES,
  MAX_NAME,
  MAX_QTY,
  MAX_SUMMARY_TEXT,
  type ActionResult,
  type LineInput,
  type SuggestResult,
} from "./shared";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const canonical = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// ---------------------------------------------------------------------------
// Suggest
// ---------------------------------------------------------------------------

/**
 * Build next week's draft order from headcount, last week's use and this week's
 * signals. Replaces any existing draft for that week. Always produces a draft:
 * if the AI call fails the code baseline is saved and `source` is "rules".
 */
export async function suggestOrderAction(rawHeadcount: number): Promise<SuggestResult> {
  const me = await requireManager();

  const headcount = z.number().int().min(1).max(MAX_HEADCOUNT).safeParse(rawHeadcount);
  if (!headcount.success) return { ok: false, error: "Enter next week's headcount as a whole number of 1 or more." };

  const nextWeek = nextWeekStart();
  const lastWeek = lastWeekStart();
  let source: "ai" | "rules";

  try {
    const supabase = await createClient();

    // 1. Record the headcount the order is planned for.
    const { error: headcountError } = await supabase
      .from("headcounts")
      .upsert({ week_start: nextWeek, headcount: headcount.data }, { onConflict: "week_start" });
    if (headcountError) throw new Error(headcountError.message);

    // 2. The numbers.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
    const [itemsRes, consumption, lastHeadcount, lastOrders, lowStockRes, requestsRes] = await Promise.all([
      supabase.from("items").select("id, name, unit, par_level, current_qty").eq("active", true).order("name"),
      getLastWeekConsumption(),
      loadLastHeadcount(supabase, lastWeek),
      loadPlacedOrders(supabase, { beforeWeek: nextWeek, limit: 1 }),
      supabase
        .from("submissions")
        .select("item_id")
        .eq("type", "low_stock")
        .not("item_id", "is", null)
        .gte("created_at", sevenDaysAgo),
      supabase
        .from("submissions")
        .select("user_id, requested_item_name")
        .eq("type", "new_request")
        .neq("status", "resolved")
        .not("requested_item_name", "is", null),
    ]);
    if (itemsRes.error) throw new Error(itemsRes.error.message);
    if (lowStockRes.error) throw new Error(lowStockRes.error.message);
    if (requestsRes.error) throw new Error(requestsRes.error.message);
    const items = itemsRes.data ?? [];
    if (items.length === 0) return { ok: false, error: "There are no items to order yet. Add stock items first." };

    // 3. Signals.
    const lowStock = new Map<string, number>();
    for (const s of lowStockRes.data ?? []) {
      lowStock.set(s.item_id as string, (lowStock.get(s.item_id as string) ?? 0) + 1);
    }
    const requesters = new Map<string, Set<string>>();
    for (const s of requestsRes.data ?? []) {
      const name = canonical(s.requested_item_name as string);
      if (!name) continue;
      const set = requesters.get(name) ?? new Set<string>();
      set.add(s.user_id as string);
      requesters.set(name, set);
    }
    const stocked = new Set(items.map((i) => canonical(i.name as string)));
    const requested: RequestedItemSignal[] = [...requesters]
      .filter(([name, users]) => users.size >= REQUEST_THRESHOLD && !stocked.has(name))
      .map(([name, users]) => ({ name: capitalise(name).slice(0, MAX_NAME), requesters: users.size }))
      .sort((a, b) => b.requesters - a.requesters);

    const lastOrder = lastOrders[0] ?? null;
    const lastOrderQty = new Map<string, number>();
    for (const l of lastOrder?.lines ?? []) {
      if (l.item_id) lastOrderQty.set(l.item_id, (lastOrderQty.get(l.item_id) ?? 0) + l.qty);
    }

    const facts: SuggestItemFacts[] = items.map((i) => ({
      item_id: i.id as string,
      name: i.name as string,
      unit: (i.unit as string | null) ?? null,
      par_level: i.par_level as number,
      current_qty: i.current_qty as number,
      consumed_last_week: consumption.get(i.id as string)?.consumed ?? null,
      last_order_qty: lastOrderQty.get(i.id as string) ?? null,
      low_stock_reports: lowStock.get(i.id as string) ?? 0,
    }));

    const input = buildSuggestInput({
      week_start: nextWeek,
      last_week_headcount: lastHeadcount?.headcount ?? null,
      next_week_headcount: headcount.data,
      last_order_total_units: lastOrder?.total_units ?? null,
      items: facts,
      requested_items: requested,
    });

    // 4. Claude adjusts and explains; falls back to the baseline on any failure.
    const suggestion = await suggestOrder(input);
    source = suggestion.source;

    // 5. Save as the draft for next week, replacing any earlier draft (lines cascade).
    const { error: clearError } = await supabase
      .from("orders")
      .delete()
      .eq("week_start", nextWeek)
      .eq("status", "draft");
    if (clearError) throw new Error(clearError.message);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        week_start: nextWeek,
        status: "draft",
        headcount: headcount.data,
        ai_summary: suggestion.summary,
        created_by: me.id,
      })
      .select("id")
      .single();
    if (orderError) throw new Error(orderError.message);

    const { error: linesError } = await supabase.from("order_lines").insert(
      suggestion.lines.map((l) => ({
        order_id: order.id,
        item_id: l.item_id,
        item_name: l.item_name,
        qty: l.qty,
        suggested_qty: l.qty,
        reason: l.reason,
        is_new: l.is_new,
        waste_risk: l.waste_risk,
      })),
    );
    if (linesError) {
      await supabase.from("orders").delete().eq("id", order.id); // do not leave an empty draft behind
      throw new Error(linesError.message);
    }
  } catch (e) {
    console.error("[order] suggest failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "The order could not be drafted. Please try again." };
  }

  refresh();
  return { ok: true, source };
}

// ---------------------------------------------------------------------------
// Save and place
// ---------------------------------------------------------------------------

const Lines = z
  .array(
    z.object({
      id: z.uuid().nullable(),
      item_id: z.uuid().nullable(),
      item_name: z.string().trim().min(1).max(MAX_NAME),
      qty: z.number().int().min(0).max(MAX_QTY),
    }),
  )
  .max(MAX_LINES);

type SaveOutcome = { state: "saved" } | { state: "placed" } | { state: "error"; error: string };

/** Make the draft's lines match what the manager has on screen. */
async function saveLines(supabase: Supabase, orderId: string, lines: LineInput[]): Promise<SaveOutcome> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw new Error(orderError.message);
  if (!order) return { state: "error", error: "That draft no longer exists. Suggest the order again." };
  if (order.status !== "draft") return { state: "placed" };

  const existing = await loadLines(supabase, orderId);
  const existingById = new Map(existing.map((l) => [l.id, l]));
  const keptIds = new Set(lines.map((l) => l.id).filter((id): id is string => Boolean(id)));

  const removed = existing.filter((l) => !keptIds.has(l.id)).map((l) => l.id);
  if (removed.length > 0) {
    const { error } = await supabase.from("order_lines").delete().in("id", removed);
    if (error) throw new Error(error.message);
  }

  const changed = lines.filter((l) => l.id && existingById.has(l.id) && existingById.get(l.id)!.qty !== l.qty);
  const updates = await Promise.all(
    changed.map((l) => supabase.from("order_lines").update({ qty: l.qty }).eq("id", l.id!).eq("order_id", orderId)),
  );
  const failed = updates.find((u) => u.error);
  if (failed?.error) throw new Error(failed.error.message);

  const added = lines.filter((l) => !l.id);
  if (added.length > 0) {
    // Trust the catalogue for names, not the browser.
    const ids = added.map((l) => l.item_id).filter((id): id is string => Boolean(id));
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: items, error } = await supabase.from("items").select("id, name").in("id", ids);
      if (error) throw new Error(error.message);
      for (const i of items ?? []) names.set(i.id as string, i.name as string);
    }
    const { error } = await supabase.from("order_lines").insert(
      added.map((l) => {
        const known = l.item_id ? names.get(l.item_id) : undefined;
        return {
          order_id: orderId,
          item_id: known ? l.item_id : null,
          item_name: known ?? l.item_name,
          qty: l.qty,
          suggested_qty: null,
          reason: "Added by hand",
          is_new: false,
          waste_risk: false,
        };
      }),
    );
    if (error) throw new Error(error.message);
  }
  return { state: "saved" };
}

/** Save the manager's edits to the draft without placing it. */
export async function saveDraftAction(orderId: string, lines: LineInput[]): Promise<ActionResult> {
  await requireManager();
  const id = z.uuid().safeParse(orderId);
  const parsed = Lines.safeParse(lines);
  if (!id.success || !parsed.success) {
    return { ok: false, error: "Check the quantities: each needs to be a whole number of 0 or more." };
  }

  try {
    const supabase = await createClient();
    const outcome = await saveLines(supabase, id.data, parsed.data);
    if (outcome.state === "error") return { ok: false, error: outcome.error };
    if (outcome.state === "placed") return { ok: false, error: "This order has already been placed." };
  } catch (e) {
    console.error("[order] save failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Your changes could not be saved. Please try again." };
  }
  refresh();
  return { ok: true };
}

/** Plain-text email body for the supplier: quantities only, no internal reasoning. */
function supplierText(weekStart: string, lines: { item_name: string; qty: number; unit: string | null }[], from: string) {
  const list = lines
    .filter((l) => l.qty > 0)
    .map((l) => `- ${l.qty} x ${l.item_name}${l.unit ? ` (${l.unit})` : ""}`)
    .join("\n");
  return [
    "Hi,",
    "",
    `Please supply the following pantry order for delivery on ${formatDay(weekStart)}:`,
    "",
    list,
    "",
    "Please let me know if anything is out of stock or will be short.",
    "",
    "Thanks,",
    from,
  ].join("\n");
}

/**
 * Save the quantities, place the order, write the supplier text, and tell the
 * people whose requested items made it onto the order. Redirects to the order page.
 */
export async function placeOrderAction(orderId: string, lines: LineInput[]): Promise<ActionResult> {
  const me = await requireManager();
  const id = z.uuid().safeParse(orderId);
  const parsed = Lines.safeParse(lines);
  if (!id.success || !parsed.success) {
    return { ok: false, error: "Check the quantities: each needs to be a whole number of 0 or more." };
  }
  if (!parsed.data.some((l) => l.qty > 0)) {
    return { ok: false, error: "Every quantity is 0, so there is nothing to order." };
  }

  try {
    const supabase = await createClient();
    const outcome = await saveLines(supabase, id.data, parsed.data);
    if (outcome.state === "error") return { ok: false, error: outcome.error };

    if (outcome.state === "saved") {
      const [{ data: order, error: orderError }, saved, { data: items, error: itemsError }] = await Promise.all([
        supabase.from("orders").select("week_start").eq("id", id.data).single(),
        loadLines(supabase, id.data),
        supabase.from("items").select("id, unit"),
      ]);
      if (orderError) throw new Error(orderError.message);
      if (itemsError) throw new Error(itemsError.message);
      const units = new Map((items ?? []).map((i) => [i.id as string, (i.unit as string | null) ?? null]));

      const text = supplierText(
        order.week_start as string,
        saved.map((l) => ({ item_name: l.item_name, qty: l.qty, unit: l.item_id ? (units.get(l.item_id) ?? null) : null })),
        me.full_name || "Office pantry team",
      );

      // Only a draft can be placed, so a double tap cannot place (and notify) twice.
      const { data: placed, error: placeError } = await supabase
        .from("orders")
        .update({ status: "placed", placed_at: new Date().toISOString(), summary_text: text })
        .eq("id", id.data)
        .eq("status", "draft")
        .select("id");
      if (placeError) throw new Error(placeError.message);

      if (placed && placed.length > 0) {
        await closeRequests(
          supabase,
          saved.filter((l) => l.is_new && l.qty > 0).map((l) => l.item_name),
        );
      }
    }
  } catch (e) {
    console.error("[order] place failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "The order could not be placed. Please try again." };
  }

  redirect(`/manager/order/${id.data}`);
}

/** Resolve the new-item requests that are now on the order and notify the people who asked. Never throws. */
async function closeRequests(supabase: Supabase, newItemNames: string[]) {
  if (newItemNames.length === 0) return;
  try {
    const { data: requests, error } = await supabase
      .from("submissions")
      .select("id, user_id, requested_item_name")
      .eq("type", "new_request")
      .neq("status", "resolved")
      .not("requested_item_name", "is", null);
    if (error) throw new Error(error.message);

    for (const name of newItemNames) {
      const matching = (requests ?? []).filter((r) => canonical(r.requested_item_name as string) === canonical(name));
      if (matching.length === 0) continue;
      const { error: resolveError } = await supabase
        .from("submissions")
        .update({ status: "resolved", resolved_at: new Date().toISOString(), manager_note: "Added to order" })
        .in(
          "id",
          matching.map((r) => r.id as string),
        );
      if (resolveError) throw new Error(resolveError.message);
      await notify(
        matching.map((r) => r.user_id as string),
        {
          title: `${capitalise(name)} is on next week's order`,
          body: "Thanks for asking: we are adding it as a trial.",
          link: "/app/submissions",
        },
      );
    }
  } catch (e) {
    console.error("[order] could not close requests:", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// Order summary page
// ---------------------------------------------------------------------------

/** Save the manager's edits to the supplier text. */
export async function saveSummaryTextAction(orderId: string, text: string): Promise<ActionResult> {
  await requireManager();
  const id = z.uuid().safeParse(orderId);
  const body = z.string().max(MAX_SUMMARY_TEXT).safeParse(text);
  if (!id.success || !body.success) return { ok: false, error: "That text is too long to save." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ summary_text: body.data })
    .eq("id", id.data)
    .select("id");
  if (error || !data || data.length === 0) {
    console.error("[order] summary save failed:", error?.message ?? "order not found");
    return { ok: false, error: "The text could not be saved. Please try again." };
  }
  refresh();
  return { ok: true };
}
