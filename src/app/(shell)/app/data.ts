import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { LiveGroup, StockedItem } from "./shared";

/** Items the pantry stocks. Readable by every signed-in user. */
export async function loadStockedItems(): Promise<StockedItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("items").select("id, name").eq("active", true).order("name");
  if (error) {
    console.error("[tell-us] could not load items:", error.message);
    return [];
  }
  return data as StockedItem[];
}

export interface LiveReports {
  groups: LiveGroup[];
  /** Canonical names of open requests, for the classifier to reuse. */
  requestNames: string[];
}

/**
 * How many people are on each live low-stock item and request.
 *
 * Employees can only read their own submissions (RLS), so this uses the
 * service-role client and returns only item keys and counts, which are sent to
 * the browser. Never add user ids or message text here. Call requireUser() first.
 */
export async function loadLiveReports(userId: string): Promise<LiveReports> {
  const { data, error } = await createAdminClient()
    .from("submissions")
    .select("type, item_id, requested_item_name, user_id")
    .in("type", ["low_stock", "new_request"])
    .neq("status", "resolved")
    .limit(2000);
  if (error) {
    console.error("[tell-us] could not load live reports:", error.message);
    return { groups: [], requestNames: [] };
  }

  const users = new Map<string, Set<string>>();
  for (const row of data) {
    const key =
      row.type === "low_stock"
        ? row.item_id && `low_stock:${row.item_id}`
        : row.requested_item_name && `new_request:${row.requested_item_name}`;
    if (!key) continue;
    if (!users.has(key)) users.set(key, new Set());
    users.get(key)!.add(row.user_id as string);
  }

  const groups = [...users].map(([key, ids]) => ({
    key,
    mine: ids.has(userId),
    others: ids.size - (ids.has(userId) ? 1 : 0),
  }));
  const requestNames = groups
    .filter((g) => g.key.startsWith("new_request:"))
    .map((g) => g.key.slice("new_request:".length))
    .sort();

  return { groups, requestNames };
}
