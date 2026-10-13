"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import { extractDocket, type DocketMediaType } from "@/lib/ai/extract-docket";
import { notify } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { STORAGE_BUCKETS } from "@/lib/types";
import { loadCatalogue, loadOpenOrder } from "./data";
import {
  MAX_NAME,
  MAX_PHOTO_BYTES,
  MAX_QTY,
  MAX_ROWS,
  PHOTO_TYPES,
  type ConfirmActionResult,
  type DeliverySummary,
  type ExtractActionResult,
  type RawExtraction,
} from "./shared";

function photoFrom(form: FormData): File | null {
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return null;
  if (!PHOTO_TYPES[photo.type] || photo.size > MAX_PHOTO_BYTES) return null;
  return photo;
}

/** Read a docket photo with AI. Changes nothing; the manager reviews the result first. */
export async function extractDocketAction(form: FormData): Promise<ExtractActionResult> {
  await requireManager();

  const photo = photoFrom(form);
  if (!photo) return { ok: false, message: "That photo could not be used. It needs to be a JPG, PNG or WebP." };

  try {
    const supabase = await createClient();
    const catalogue = await loadCatalogue(supabase);
    const base64 = Buffer.from(await photo.arrayBuffer()).toString("base64");
    const result = await extractDocket({ base64, mediaType: photo.type as DocketMediaType }, catalogue);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, extraction: result.extraction, model: result.model };
  } catch (e) {
    console.error("[delivery] extraction failed:", e instanceof Error ? e.message : e);
    return { ok: false, message: "The photo could not be read right now." };
  }
}

const Confidence = z.enum(["high", "medium", "low"]);
const Payload = z.object({
  order_id: z.uuid().nullable(),
  source: z.enum(["ai", "manual"]),
  model: z.string().max(100).nullable(),
  extraction: z
    .object({
      supplier: z.string().max(200).nullable(),
      docket_number: z.string().max(100).nullable(),
      lines: z
        .array(
          z.object({
            line_text: z.string().max(200),
            item_id: z.uuid().nullable(),
            quantity: z.number().int().min(0).max(MAX_QTY),
            confidence: Confidence,
          }),
        )
        .max(MAX_ROWS),
    })
    .nullable(),
  rows: z
    .array(
      z.object({
        line_text: z.string().trim().max(200),
        action: z.enum(["item", "new", "skip"]),
        item_id: z.uuid().nullable(),
        new_name: z.string().trim().max(MAX_NAME).nullable(),
        delivered: z.number().int().min(0).max(MAX_QTY),
        confidence: Confidence.nullable(),
      }),
    )
    .min(1)
    .max(MAX_ROWS),
});

/**
 * Record a reviewed delivery: store the photo, insert the delivery, add stock,
 * then close the low-stock reports the delivery answers and tell the reporters.
 */
export async function confirmDeliveryAction(form: FormData): Promise<ConfirmActionResult> {
  const me = await requireManager();

  let json: unknown;
  try {
    json = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return { ok: false, error: "That delivery could not be read. Please try again." };
  }
  const parsed = Payload.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: "Check the quantities: each needs to be a whole number of 0 or more." };
  }
  const payload = parsed.data;
  const rows = payload.rows.filter((r) => r.action !== "skip");
  if (rows.length === 0) return { ok: false, error: "Every line is skipped, so there is nothing to record." };
  if (rows.some((r) => r.action === "item" && !r.item_id)) {
    return { ok: false, error: "Choose an item for every line, or set it to Skip." };
  }
  if (rows.some((r) => r.action === "new" && !r.new_name)) {
    return { ok: false, error: "Give each new item a name." };
  }

  const warnings: string[] = [];
  let summary: DeliverySummary;
  let deliverySaved = false;

  try {
    const supabase = await createClient();

    // The order this delivery answers. Re-read on the server: the client only names it.
    const openOrder = await loadOpenOrder(supabase);
    const order = openOrder && openOrder.id === payload.order_id ? openOrder : null;
    if (payload.order_id && !order) {
      warnings.push("The order this was checked against has changed, so the delivery was saved without an order link.");
    }
    const orderedByItem = new Map<string, number>();
    for (const line of order?.lines ?? []) {
      if (line.item_id) orderedByItem.set(line.item_id, (orderedByItem.get(line.item_id) ?? 0) + line.qty);
    }

    // 1. "Create new item" lines become catalogue items first.
    const createdIds = new Set<string>();
    const newIdByName = new Map<string, string>();
    for (const row of rows) {
      if (row.action !== "new" || !row.new_name) continue;
      const key = row.new_name.toLowerCase();
      if (newIdByName.has(key)) continue;
      const { data: created, error: createError } = await supabase
        .from("items")
        .insert({ name: row.new_name, unit: null, par_level: row.delivered, current_qty: 0, active: true })
        .select("id")
        .maybeSingle();
      if (created) {
        newIdByName.set(key, created.id as string);
        createdIds.add(created.id as string);
        continue;
      }
      // Most likely the name already exists (names are unique): use that item instead.
      const { data: existing } = await supabase.from("items").select("id").eq("name", row.new_name).maybeSingle();
      if (!existing) throw new Error(`could not create item "${row.new_name}": ${createError?.message}`);
      await supabase.from("items").update({ active: true }).eq("id", existing.id);
      newIdByName.set(key, existing.id as string);
    }

    // 2. Total delivered per item (two docket lines may be the same item).
    const deliveredByItem = new Map<string, number>();
    const resolved = rows.map((row) => {
      const itemId = row.action === "new" ? newIdByName.get(row.new_name!.toLowerCase())! : row.item_id!;
      deliveredByItem.set(itemId, (deliveredByItem.get(itemId) ?? 0) + row.delivered);
      return { row, itemId };
    });

    const itemIds = [...deliveredByItem.keys()];
    const { data: itemRows, error: itemsError } = await supabase
      .from("items")
      .select("id, name, unit, current_qty")
      .in("id", itemIds);
    if (itemsError) throw new Error(itemsError.message);
    const items = new Map((itemRows ?? []).map((i) => [i.id as string, i]));
    if (items.size !== itemIds.length) {
      return { ok: false, error: "One of the chosen items no longer exists. Reload the page and try again." };
    }

    // 3. Photo into the private bucket. A failed upload must not block the stock update.
    let photoPath: string | null = null;
    const photo = photoFrom(form);
    if (photo) {
      const path = `${me.id}/${crypto.randomUUID()}.${PHOTO_TYPES[photo.type]}`;
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKETS.dockets)
        .upload(path, await photo.arrayBuffer(), { contentType: photo.type });
      if (uploadError) {
        console.error("[delivery] photo upload failed:", uploadError.message);
        warnings.push("The docket photo could not be saved, but the delivery was recorded.");
      } else {
        photoPath = path;
      }
    }

    // 4. The delivery row.
    const notDelivered = (order?.lines ?? []).filter((l) => !l.item_id || !deliveredByItem.has(l.item_id));
    const raw: RawExtraction = {
      version: 1,
      source: payload.source,
      model: payload.model,
      supplier: payload.extraction?.supplier ?? null,
      docket_number: payload.extraction?.docket_number ?? null,
      lines: payload.extraction?.lines ?? [],
      confirmed: [
        ...resolved.map(({ row, itemId }) => ({
          line_text: row.line_text,
          action: row.action,
          item_id: itemId,
          item_name: (items.get(itemId)?.name as string | undefined) ?? null,
          ordered: orderedByItem.get(itemId) ?? null,
          delivered: row.delivered,
          confidence: row.confidence,
        })),
        ...payload.rows
          .filter((r) => r.action === "skip")
          .map((row) => ({
            line_text: row.line_text,
            action: row.action,
            item_id: null,
            item_name: null,
            ordered: null,
            delivered: row.delivered,
            confidence: row.confidence,
          })),
      ],
      not_delivered: notDelivered.map((l) => ({ item_id: l.item_id, item_name: l.item_name, ordered: l.qty })),
    };

    const { data: delivery, error: deliveryError } = await supabase
      .from("deliveries")
      .insert({ photo_path: photoPath, order_id: order?.id ?? null, raw_extraction: raw, created_by: me.id })
      .select("id")
      .single();
    if (deliveryError) throw new Error(deliveryError.message);
    const deliveryId = delivery.id as string;
    deliverySaved = true;

    // 5. Stock events and new stock levels. Lines with 0 delivered move no stock.
    const moved = itemIds
      .map((id) => ({ id, delta: deliveredByItem.get(id)!, before: items.get(id)!.current_qty as number }))
      .filter((m) => m.delta > 0);
    if (moved.length > 0) {
      const { error: eventsError } = await supabase.from("stock_events").insert(
        moved.map((m) => ({
          item_id: m.id,
          kind: "delivery",
          delta: m.delta,
          qty_after: m.before + m.delta,
          delivery_id: deliveryId,
          created_by: me.id,
        })),
      );
      if (eventsError) throw new Error(eventsError.message);

      const updates = await Promise.all(
        moved.map((m) =>
          supabase
            .from("items")
            .update({ current_qty: m.before + m.delta })
            .eq("id", m.id),
        ),
      );
      const failed = updates.find((u) => u.error);
      if (failed?.error) throw new Error(failed.error.message);
    }

    // 6. Close the low-stock reports this delivery answers, and tell each reporter once per item.
    let resolvedReports = 0;
    let notified = 0;
    if (moved.length > 0) {
      const { data: reports, error: reportsError } = await supabase
        .from("submissions")
        .select("id, user_id, item_id")
        .eq("type", "low_stock")
        .in("status", ["open", "acknowledged"])
        .in(
          "item_id",
          moved.map((m) => m.id),
        );
      if (reportsError) {
        console.error("[delivery] could not load low-stock reports:", reportsError.message);
        warnings.push("Low-stock reports could not be closed automatically.");
      } else if (reports && reports.length > 0) {
        const { error: resolveError } = await supabase
          .from("submissions")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
            manager_note: "Restocked by delivery",
          })
          .in(
            "id",
            reports.map((r) => r.id as string),
          );
        if (resolveError) {
          console.error("[delivery] could not resolve reports:", resolveError.message);
          warnings.push("Low-stock reports could not be closed automatically.");
        } else {
          resolvedReports = reports.length;
          const reportersByItem = new Map<string, Set<string>>();
          for (const r of reports) {
            const set = reportersByItem.get(r.item_id as string) ?? new Set<string>();
            set.add(r.user_id as string);
            reportersByItem.set(r.item_id as string, set);
          }
          for (const [itemId, reporters] of reportersByItem) {
            const res = await notify([...reporters], {
              title: `${items.get(itemId)!.name} is back in stock`,
              body: "Restocked by today's delivery. Thanks for letting us know.",
              link: "/app/submissions",
            });
            notified += res.count;
          }
        }
      }
    }

    summary = {
      delivery_id: deliveryId,
      items: itemIds.map((id) => {
        const item = items.get(id)!;
        const delivered = deliveredByItem.get(id)!;
        return {
          name: item.name as string,
          unit: (item.unit as string | null) ?? null,
          delivered,
          ordered: orderedByItem.get(id) ?? null,
          qty_after: (item.current_qty as number) + delivered,
          created: createdIds.has(id),
        };
      }),
      not_delivered: notDelivered.map((l) => ({ name: l.item_name, ordered: l.qty })),
      resolved_reports: resolvedReports,
      notified,
      photo_saved: Boolean(photoPath),
      warnings,
    };
  } catch (e) {
    console.error("[delivery] confirm failed:", e instanceof Error ? e.message : e);
    return {
      ok: false,
      error: deliverySaved
        ? "The delivery was saved, but stock may be only partly updated. Check stock levels before recording it again."
        : "The delivery could not be saved and no stock was changed. Please try again.",
    };
  }

  refresh();
  return { ok: true, summary };
}
