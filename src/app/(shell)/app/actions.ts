"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { classifyMessage } from "@/lib/ai/classify";
import { sendManagerEmail } from "@/lib/email";
import { notifyManagers } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { SUBMISSION_TYPE_LABELS } from "@/lib/types";
import { loadLiveReports, loadStockedItems } from "./data";
import {
  canonicalName,
  capitalise,
  groupKey,
  MAX_DETAIL,
  MAX_ENTRIES,
  MAX_ITEM,
  MAX_TEXT,
  usesItem,
  type DraftEntry,
  type LiveGroup,
  type StockedItem,
  type SubmitResultEntry,
} from "./shared";

/** Three people asking for the same thing makes it worth ordering. */
const REQUEST_THRESHOLD = 3;

const Text = z.string().trim().min(1).max(MAX_TEXT);

const Entries = z
  .array(
    z.object({
      type: z.enum(["low_stock", "new_request", "maintenance", "other"]),
      item: z.string().trim().max(MAX_ITEM).nullable(),
      detail: z.string().trim().min(1).max(MAX_DETAIL),
    }),
  )
  .min(1)
  .max(MAX_ENTRIES);

// Each classification is a paid AI call, so cap how fast one person can make them.
// In-memory is enough here: it resets on restart and is per server instance.
const CLASSIFY_LIMIT = 10;
const CLASSIFY_WINDOW_MS = 60_000;
const recentClassifies = new Map<string, number[]>();

function allowClassify(userId: string): boolean {
  const now = Date.now();
  const recent = (recentClassifies.get(userId) ?? []).filter((t) => now - t < CLASSIFY_WINDOW_MS);
  if (recent.length >= CLASSIFY_LIMIT) {
    recentClassifies.set(userId, recent);
    return false;
  }
  recentClassifies.set(userId, [...recent, now]);
  return true;
}

export type ClassifyResponse =
  | { ok: true; entries: DraftEntry[]; source: "ai" | "rules"; items: StockedItem[]; live: LiveGroup[] }
  | { ok: false; error: string };

/** Step 1: sort a free-text message into proposed reports. Saves nothing. */
export async function classifyAction(rawText: string): Promise<ClassifyResponse> {
  const profile = await requireUser();

  const text = Text.safeParse(rawText);
  if (!text.success) return { ok: false, error: `Write a message of up to ${MAX_TEXT} characters.` };
  if (!allowClassify(profile.id)) return { ok: false, error: "That is a lot of messages. Try again in a minute." };

  const [items, live] = await Promise.all([loadStockedItems(), loadLiveReports(profile.id)]);
  const { entries, source } = await classifyMessage(text.data, {
    stockedItems: items.map((i) => i.name),
    openRequests: live.requestNames.map(capitalise),
  });

  return { ok: true, entries, source, items, live: live.groups };
}

export type SubmitResponse = { ok: true; results: SubmitResultEntry[] } | { ok: false; error: string };

/** Step 2: save the reports the person confirmed. */
export async function submitAction(rawText: string, rawEntries: DraftEntry[]): Promise<SubmitResponse> {
  const profile = await requireUser();

  const text = Text.safeParse(rawText);
  const entries = Entries.safeParse(rawEntries);
  if (!text.success || !entries.success) {
    return { ok: false, error: "Something in that report is not valid. Check it and try again." };
  }

  const [items, live] = await Promise.all([loadStockedItems(), loadLiveReports(profile.id)]);
  const groups = new Map(live.groups.map((g) => [g.key, g]));
  const batchId = crypto.randomUUID();
  const reporter = profile.full_name || "Someone";

  const results: SubmitResultEntry[] = [];
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const raw of entries.data) {
    const item = usesItem(raw.type) && raw.item ? raw.item.replace(/\s+/g, " ") : null;
    const entry: DraftEntry = { type: raw.type, item, detail: raw.detail };
    const key = groupKey(entry, items);
    const stocked = entry.type === "low_stock" && key ? items.find((i) => `low_stock:${i.id}` === key) : undefined;
    const label = stocked?.name ?? (item ? capitalise(item) : entry.detail);
    const group = key ? groups.get(key) : undefined;

    if (key) {
      if (seen.has(key)) continue; // Same item twice in one message.
      seen.add(key);
      if (group?.mine) {
        results.push({ type: entry.type, label, outcome: "already", others: group.others });
        continue;
      }
    }

    const others = group?.others ?? 0;
    results.push({ type: entry.type, label, outcome: others > 0 ? "joined" : "created", others });
    rows.push({
      user_id: profile.id,
      batch_id: batchId,
      type: entry.type,
      item_id: stocked?.id ?? null,
      requested_item_name: entry.type === "new_request" && item ? canonicalName(item) : null,
      raw_text: text.data,
      // Keep the item name when it could not be matched to a stocked item.
      detail: entry.type === "low_stock" && item && !stocked ? `${capitalise(item)}: ${entry.detail}` : entry.detail,
    });
  }

  if (rows.length > 0) {
    // Inserted as the signed-in user: RLS only allows rows with their own user_id.
    const supabase = await createClient();
    const { error } = await supabase.from("submissions").insert(rows);
    if (error) {
      console.error("[tell-us] insert failed:", error.message);
      return { ok: false, error: "We could not save that. Please try again." };
    }

    // Bells and email never fail the submission: the helpers swallow their own errors.
    const saved = results.filter((r) => r.outcome !== "already");
    await Promise.all(saved.flatMap((r) => tellManager(r, reporter)));
    revalidatePath("/app/submissions");
  }

  return { ok: true, results };
}

function tellManager(r: SubmitResultEntry, reporter: string): Promise<unknown>[] {
  const total = r.others + 1;
  const tasks: Promise<unknown>[] = [
    notifyManagers({
      title: `${SUBMISSION_TYPE_LABELS[r.type]}: ${r.label}`,
      body: total > 1 ? `From ${reporter}. ${total} people so far.` : `From ${reporter}.`,
      link: "/manager/inbox",
    }),
  ];

  if (r.type === "new_request" && total === REQUEST_THRESHOLD) {
    tasks.push(
      notifyManagers({
        title: `${REQUEST_THRESHOLD} people have asked for ${r.label}`,
        body: "Suggested as a new line in next week's order.",
        link: "/manager/order",
      }),
    );
  }

  // Maintenance is the only type that emails straight away; the rest wait for the Friday summary.
  if (r.type === "maintenance") {
    tasks.push(
      sendManagerEmail({
        subject: `Pantry maintenance: ${r.label}`.slice(0, 120),
        html: `<p><strong>${escapeHtml(reporter)}</strong> reported a maintenance issue:</p><p>${escapeHtml(r.label)}</p>`,
      }),
    );
  }

  return tasks;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
