import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationInput } from "@/lib/types";

// In-app notifications (the bell). Written with the service-role client because
// one user is creating rows for other users. Authorise the caller BEFORE calling.
// These never throw: a failed notification must not fail the action that caused it.

export type NotifyResult = { ok: boolean; count: number };

/** Notify specific users. */
export async function notify(userIds: string[], n: NotificationInput): Promise<NotifyResult> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return { ok: true, count: 0 };
  try {
    const { error } = await createAdminClient()
      .from("notifications")
      .insert(
        ids.map((user_id) => ({
          user_id,
          title: n.title,
          body: n.body ?? null,
          link: n.link ?? null,
        })),
      );
    if (error) throw new Error(error.message);
    return { ok: true, count: ids.length };
  } catch (e) {
    console.error("[notify] failed:", e instanceof Error ? e.message : e);
    return { ok: false, count: 0 };
  }
}

async function profileIds(filter: { role?: "manager"; exceptId?: string }): Promise<string[]> {
  try {
    let q = createAdminClient().from("profiles").select("id");
    if (filter.role) q = q.eq("role", filter.role);
    if (filter.exceptId) q = q.neq("id", filter.exceptId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => p.id as string);
  } catch (e) {
    console.error("[notify] could not load recipients:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Notify every manager. */
export async function notifyManagers(n: NotificationInput): Promise<NotifyResult> {
  return notify(await profileIds({ role: "manager" }), n);
}

/** Notify everyone (both roles) except one user, e.g. the person who posted free food. */
export async function notifyAllExcept(userId: string, n: NotificationInput): Promise<NotifyResult> {
  return notify(await profileIds({ exceptId: userId }), n);
}
