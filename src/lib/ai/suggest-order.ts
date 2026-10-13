import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, aiEnabled, anthropic } from "./client";

// Next week's order suggestion.
//
// The arithmetic is done in code (buildSuggestInput): consumption, per-head rate,
// projected need and a baseline quantity per item. Claude then gets those numbers
// plus the week's signals, may adjust the baseline within bounds, and writes the
// reasons and the summary. If the call fails, the baseline is used as is with
// rule-written reasons, so the manager always gets a draft.

export interface SuggestItemFacts {
  item_id: string;
  name: string;
  unit: string | null;
  par_level: number;
  current_qty: number;
  /** Units used between the two most recent stock counts. Null when unknown. */
  consumed_last_week: number | null;
  /** Quantity on the most recent placed order. Null when it was not on it. */
  last_order_qty: number | null;
  /** Low-stock reports from staff in the last 7 days. */
  low_stock_reports: number;
}

export interface SuggestItemInput extends SuggestItemFacts {
  /** consumed_last_week / last_week_headcount. Null when either is unknown. */
  per_head_rate: number | null;
  /** per_head_rate x next_week_headcount (or last week's use when headcount is unknown). */
  projected_need: number | null;
  /** max(0, ceil(projected_need + safety buffer - current_qty)), or par - stock without history. */
  baseline_qty: number;
  /** Far more on the shelf than next week needs. */
  overstocked: boolean;
}

export interface RequestedItemSignal {
  /** Display name, e.g. "Oat milk". */
  name: string;
  /** Distinct people who asked for it. */
  requesters: number;
}

export interface SuggestOrderInput {
  week_start: string;
  last_week_headcount: number | null;
  next_week_headcount: number;
  /** Total units on the most recent placed order. */
  last_order_total_units: number | null;
  items: SuggestItemInput[];
  /** New-item requests that reached the threshold of distinct requesters. */
  requested_items: RequestedItemSignal[];
}

export interface SuggestedLine {
  item_id: string | null;
  item_name: string;
  qty: number;
  reason: string;
  is_new: boolean;
  waste_risk: boolean;
}

export interface SuggestOrderOutput {
  /** "rules" means the AI call was unavailable and the code baseline was used. */
  source: "ai" | "rules";
  summary: string;
  lines: SuggestedLine[];
}

export const REQUEST_THRESHOLD = 3;
const TRIAL_QTY = 2;
const MAX_REASON = 200;
const TIME_BUDGET_MS = 55_000;

// ---------------------------------------------------------------------------
// Code baseline
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Derive rate, projected need and baseline quantity for every item. Pure. */
export function buildSuggestInput(args: {
  week_start: string;
  last_week_headcount: number | null;
  next_week_headcount: number;
  last_order_total_units: number | null;
  items: SuggestItemFacts[];
  requested_items: RequestedItemSignal[];
}): SuggestOrderInput {
  const last = args.last_week_headcount && args.last_week_headcount > 0 ? args.last_week_headcount : null;
  const next = Math.max(0, args.next_week_headcount);

  const items = args.items.map((item): SuggestItemInput => {
    if (item.consumed_last_week == null) {
      return {
        ...item,
        per_head_rate: null,
        projected_need: null,
        baseline_qty: Math.max(0, item.par_level - item.current_qty),
        overstocked: false,
      };
    }
    const rate = last ? item.consumed_last_week / last : null;
    const need = rate != null ? rate * next : item.consumed_last_week;
    // Small safety buffer: 10% of the projected need, at least one unit when anything is needed.
    const buffer = need > 0 ? Math.max(1, Math.ceil(need * 0.1)) : 0;
    const overstocked =
      item.current_qty > 0 && item.current_qty >= item.par_level * 2 && item.current_qty >= need * 3;
    return {
      ...item,
      per_head_rate: rate != null ? Math.round(rate * 1000) / 1000 : null,
      projected_need: round1(need),
      baseline_qty: overstocked ? 0 : Math.max(0, Math.ceil(need + buffer - item.current_qty)),
      overstocked,
    };
  });

  return {
    week_start: args.week_start,
    last_week_headcount: last,
    next_week_headcount: next,
    last_order_total_units: args.last_order_total_units,
    items,
    requested_items: args.requested_items,
  };
}

function ruleReason(item: SuggestItemInput, input: SuggestOrderInput): string {
  const reports =
    item.low_stock_reports > 0
      ? ` ${item.low_stock_reports} low-stock report${item.low_stock_reports === 1 ? "" : "s"} this week.`
      : "";
  if (item.consumed_last_week == null || item.projected_need == null) {
    return item.baseline_qty > 0
      ? `No usage history yet, so topping up to par (${item.par_level}).${reports}`
      : `No usage history yet and already at par (${item.par_level}).${reports}`;
  }
  const people = `${input.next_week_headcount} people`;
  if (item.overstocked) {
    return `${item.current_qty} on hand against about ${item.projected_need} needed: skipped to avoid waste.`;
  }
  if (item.baseline_qty === 0) {
    return `${item.current_qty} on hand covers the ${item.projected_need} needed for ${people}.${reports}`;
  }
  const used = input.last_week_headcount
    ? `Used ${item.consumed_last_week} last week with ${input.last_week_headcount} in`
    : `Used ${item.consumed_last_week} last week`;
  return `${used}; about ${item.projected_need} needed for ${people}, ${item.current_qty} on hand.${reports}`;
}

function newLineReason(r: RequestedItemSignal): string {
  return `Requested by ${r.requesters} people: small trial quantity.`;
}

function ruleSummary(input: SuggestOrderInput, lines: SuggestedLine[]): string {
  const total = lines.reduce((sum, l) => sum + l.qty, 0);
  const { last_week_headcount: last, next_week_headcount: next } = input;
  let head: string;
  if (last && next !== last) {
    const pct = Math.round((Math.abs(next - last) / last) * 100);
    head = `Headcount goes from ${last} to ${next} next week (${next < last ? "down" : "up"} ${pct}%), so quantities are scaled to expected use.`;
  } else if (last) {
    head = `Headcount stays at ${last} next week, so the order follows last week's use.`;
  } else {
    head = `Planned for ${next} people next week.`;
  }
  const compare =
    input.last_order_total_units != null
      ? ` The draft comes to ${total} units against ${input.last_order_total_units} on the last order.`
      : ` The draft comes to ${total} units.`;
  const skipped = lines.filter((l) => l.waste_risk).length;
  const skip = skipped > 0 ? ` ${skipped} overstocked item${skipped === 1 ? " is" : "s are"} skipped to avoid waste.` : "";
  return head + compare + skip;
}

/** The draft straight from the code baseline. Used when the AI call is unavailable. */
export function baselineOrder(input: SuggestOrderInput): SuggestOrderOutput {
  const lines: SuggestedLine[] = [
    ...input.items.map((item) => ({
      item_id: item.item_id,
      item_name: item.name,
      qty: item.baseline_qty,
      reason: ruleReason(item, input),
      is_new: false,
      waste_risk: item.overstocked,
    })),
    ...input.requested_items.map((r) => ({
      item_id: null,
      item_name: r.name,
      qty: TRIAL_QTY,
      reason: newLineReason(r),
      is_new: true,
      waste_risk: false,
    })),
  ];
  return { source: "rules", summary: ruleSummary(input, lines), lines };
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

// The model refers to items by the short `ref` we hand it, never by database id.
const Output = z.object({
  summary: z.string(),
  lines: z.array(
    z.object({
      item_ref: z.number().nullable(),
      item_name: z.string(),
      qty: z.number(),
      reason: z.string(),
      is_new: z.boolean(),
      waste_risk: z.boolean(),
    }),
  ),
});

const SYSTEM = `You help the office manager of a hybrid office build next week's pantry order. Headcount swings from week to week, and ordering the same amount regardless is what causes food waste here. Your job is to turn the numbers you are given into an order she can trust at a glance, and to explain each line in terms she can check.

You receive JSON with last week's and next week's headcount and, for each stocked item: stock on hand (current_qty), par_level, units used last week (consumed_last_week), the per-head rate, projected_need for next week's headcount, baseline_qty (already calculated as projected need plus a small safety buffer minus stock on hand), what was on the last order, how many staff reported it running low in the last 7 days, and an overstocked flag. The arithmetic is done: do not redo it, and never state a number that is not in the input.

Return one line for every item in "items", using its ref as item_ref and its name unchanged.
- qty: start from baseline_qty. Keep it unless a signal in the input justifies a change, and then move by a unit or two, not more. Low-stock reports mean the item ran short this week, which is a reason to add a little. An item with null consumed_last_week has no history: its baseline is a top-up to par. Whole numbers only, never negative.
- Items with overstocked true have far more on the shelf than next week needs: qty 0 and waste_risk true. Set waste_risk false on every other line.
- reason: one short sentence, under 120 characters, naming the actual driver with its numbers: the headcount change, last week's use, stock on hand, low-stock reports, or par. For example "Used 14 last week with 60 in; about 9 needed for 40, 1 on hand." Plain words, no jargon such as "baseline" or "per-head rate".
- is_new false.

Then add one line for each entry in "requested_items" (items staff asked for that the pantry does not stock yet, already filtered to those with enough requests): item_ref null, item_name as given, is_new true, waste_risk false, a small trial qty of 1 to 3, and reason "Requested by N people" with the real count, optionally followed by a few words. Do not invent any other new lines.

summary: 2 to 3 plain sentences for the manager, written as a short paragraph with no lists. Lead with the headcount change against last week and what it does to the order overall, in words only (smaller, larger, about the same). Do NOT state the total number of units or any sum: the totals are calculated in code and appended after your text. Then mention the one or two things most worth knowing, such as an overstocked item skipped to avoid waste, an item bumped because of low-stock reports, or a new item added on request.`;

// Server-side fallback on a declined request is only offered on these models.
const SUPPORTS_FALLBACK = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(AI_MODEL);

/**
 * Suggest next week's order. Never throws: on any AI failure it returns the
 * code baseline with rule-written reasons and `source: "rules"`.
 */
export async function suggestOrder(input: SuggestOrderInput): Promise<SuggestOrderOutput> {
  const fallback = baselineOrder(input);
  if (!aiEnabled) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIME_BUDGET_MS);
  try {
    const payload = {
      week_start: input.week_start,
      last_week_headcount: input.last_week_headcount,
      next_week_headcount: input.next_week_headcount,
      last_order_total_units: input.last_order_total_units,
      items: input.items.map((item, i) => ({
        ref: i + 1,
        name: item.name,
        unit: item.unit,
        current_qty: item.current_qty,
        par_level: item.par_level,
        consumed_last_week: item.consumed_last_week,
        per_head_rate: item.per_head_rate,
        projected_need: item.projected_need,
        baseline_qty: item.baseline_qty,
        last_order_qty: item.last_order_qty,
        low_stock_reports: item.low_stock_reports,
        overstocked: item.overstocked,
      })),
      requested_items: input.requested_items,
    };

    const response = await anthropic.beta.messages.parse(
      {
        model: AI_MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(payload, null, 1) }],
        output_config: { effort: "low", format: betaZodOutputFormat(Output) },
        ...(SUPPORTS_FALLBACK
          ? { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const }
          : {}),
      },
      { timeout: 45_000, maxRetries: 1, signal: controller.signal },
    );

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      console.error("[suggest-order] no usable output, stop_reason:", response.stop_reason);
      return fallback;
    }
    return mergeAiOutput(input, fallback, response.parsed_output);
  } catch (e) {
    console.error("[suggest-order] AI call failed, using the baseline:", e instanceof Error ? e.message : e);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** Validate the model's lines against the input. Anything missing or off falls back to the baseline line. */
function mergeAiOutput(
  input: SuggestOrderInput,
  fallback: SuggestOrderOutput,
  out: z.infer<typeof Output>,
): SuggestOrderOutput {
  const byRef = new Map<number, (typeof out.lines)[number]>();
  const newByName = new Map<string, (typeof out.lines)[number]>();
  for (const line of out.lines) {
    if (line.item_ref != null) {
      // Unknown refs are ignored; the first line for a ref wins.
      if (line.item_ref >= 1 && line.item_ref <= input.items.length && !byRef.has(line.item_ref)) {
        byRef.set(line.item_ref, line);
      }
    } else if (line.is_new) {
      const key = line.item_name.trim().toLowerCase();
      if (key && !newByName.has(key)) newByName.set(key, line);
    }
  }

  const lines: SuggestedLine[] = input.items.map((item, i) => {
    const base = fallback.lines[i];
    const ai = byRef.get(i + 1);
    if (!ai || !Number.isFinite(ai.qty)) return base;
    if (item.overstocked) {
      return { ...base, qty: 0, waste_risk: true, reason: clip(ai.reason) || base.reason };
    }
    // Grounding: the model may nudge the baseline, not replace it.
    const cap = Math.max(item.par_level, item.baseline_qty + Math.max(3, Math.ceil(item.baseline_qty * 0.5)));
    const qty = Math.min(cap, Math.max(0, Math.round(ai.qty)));
    return {
      ...base,
      qty,
      reason: clip(ai.reason) || base.reason,
      waste_risk: ai.waste_risk && qty === 0 && item.current_qty > 0,
    };
  });

  // New lines only for requests that really reached the threshold.
  for (const [i, requested] of input.requested_items.entries()) {
    const base = fallback.lines[input.items.length + i];
    const ai = newByName.get(requested.name.trim().toLowerCase());
    if (!ai || !Number.isFinite(ai.qty)) {
      lines.push(base);
      continue;
    }
    lines.push({
      ...base,
      qty: Math.min(6, Math.max(1, Math.round(ai.qty))),
      reason: clip(ai.reason) || base.reason,
    });
  }

  const text = out.summary.trim().replace(/\s+/g, " ").slice(0, 700);
  if (!text) return { source: "ai", summary: fallback.summary, lines };
  // Totals are computed here, never by the model, so the sentence always matches the lines.
  const total = lines.reduce((sum, l) => sum + l.qty, 0);
  const totals =
    input.last_order_total_units != null
      ? `The draft comes to ${total} units against ${input.last_order_total_units} on the last order.`
      : `The draft comes to ${total} units.`;
  return { source: "ai", summary: `${text} ${totals}`, lines };
}

function clip(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_REASON);
}
