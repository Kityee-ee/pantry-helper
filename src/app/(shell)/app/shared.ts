import type { SubmissionType } from "@/lib/types";

// Types and pure helpers shared by the Tell us server actions and client UI.

export const MAX_TEXT = 2000;
export { MAX_DETAIL, MAX_ENTRIES, MAX_ITEM } from "@/lib/ai/limits";

/** One report on a confirmation card. */
export interface DraftEntry {
  type: SubmissionType;
  /** Item name. Only used for low_stock and new_request. */
  item: string | null;
  detail: string;
}

export interface StockedItem {
  id: string;
  name: string;
}

/**
 * A live (not yet resolved) low-stock report or request, by group.
 * Carries the group key (a stocked item id or a requested item name) and counts,
 * never who reported or what they wrote.
 */
export interface LiveGroup {
  key: string;
  /** People other than the current user. */
  others: number;
  mine: boolean;
}

export type Outcome = "created" | "joined" | "already";

export interface SubmitResultEntry {
  type: SubmissionType;
  label: string;
  outcome: Outcome;
  /** Other people on the same item, not counting this report. */
  others: number;
}

export function usesItem(type: SubmissionType): boolean {
  return type === "low_stock" || type === "new_request";
}

/** Canonical lower-case name, as stored in submissions.requested_item_name. */
export function canonicalName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Key that groups reports about the same thing across people:
 * low stock by stocked item, requests by canonical name. Null when a report cannot be grouped.
 */
export function groupKey(entry: DraftEntry, items: StockedItem[]): string | null {
  if (!entry.item || !usesItem(entry.type)) return null;
  const name = canonicalName(entry.item);
  if (!name) return null;
  if (entry.type === "new_request") return `new_request:${name}`;
  const match = items.find((i) => canonicalName(i.name) === name);
  return match ? `low_stock:${match.id}` : null;
}

export function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "2 others" / "1 other". */
export function others(count: number): string {
  return `${count} ${count === 1 ? "other" : "others"}`;
}
