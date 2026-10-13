"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/lib/types";

const POLL_MS = 30_000;
const LIMIT = 20;

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Bell with unread count and a dropdown of the latest notifications.
 * Reads and marks-read with the browser client (RLS: own rows only).
 * Updates live via Supabase Realtime, with a 30s poll as a fallback.
 * Rows are created server-side with the helpers in src/lib/notify.ts.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter();
  // The browser client is created inside effects and handlers, never during render:
  // constructing it on the server reads the clock and trips Cache Components prerendering.
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const fetchLatest = useCallback(async (): Promise<Notification[] | null> => {
    const { data, error } = await createClient()
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    return error ? null : (data as Notification[]);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const refresh = () => {
      fetchLatest().then((rows) => {
        if (!cancelled && rows) setItems(rows);
      });
    };

    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        refresh,
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, fetchLatest]);

  const unread = items.filter((n) => !n.read_at).length;

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
    await createClient().from("notifications").update({ read_at: now }).in("id", ids).is("read_at", null);
  }

  function openNotification(n: Notification) {
    void markRead(n.read_at ? [] : [n.id]);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-black/5 hover:text-foreground"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-x-2 top-16 z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-lg md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-96">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold">Notifications</p>
              <button
                type="button"
                disabled={unread === 0}
                onClick={() => markRead(items.filter((n) => !n.read_at).map((n) => n.id))}
                className="text-xs font-medium text-accent-strong hover:underline disabled:text-muted disabled:no-underline"
              >
                Mark all read
              </button>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-background ${
                        n.read_at ? "" : "bg-accent-soft/50"
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-accent"}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.read_at ? "" : "font-semibold"}`}>{n.title}</span>
                        {n.body ? <span className="mt-0.5 block text-sm text-muted">{n.body}</span> : null}
                        <span className="mt-1 block text-xs text-muted">{timeAgo(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
