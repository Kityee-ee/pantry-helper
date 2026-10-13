"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Entry } from "@/lib/db";
import { CATEGORY_LABELS } from "@/lib/categorise";

async function fetchEntries(): Promise<Entry[]> {
  const res = await fetch("/api/entries", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load entries (${res.status})`);
  return res.json();
}

export default function Home() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await fetchEntries());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entries");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchEntries()
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load entries");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(entry: Entry) {
    const status = entry.status === "open" ? "done" : "open";
    const res = await fetch(`/api/entries/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) await load();
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold">Pantry Helper</h1>
      <p className="mt-1 text-sm opacity-70">
        Tell us what is missing, what you would like, or what is broken.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. We're out of oat milk again"
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-black/15 bg-transparent p-3 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs opacity-60">{text.length}/2000</span>
          <button
            type="submit"
            disabled={!text.trim() || submitting}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
          Recent entries
        </h2>
        {loading ? (
          <p className="mt-3 text-sm opacity-60">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="mt-3 text-sm opacity-60">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-black/10 dark:divide-white/10">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 py-3">
                <input
                  type="checkbox"
                  aria-label="Mark done"
                  checked={entry.status === "done"}
                  onChange={() => toggleStatus(entry)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p
                    className={`text-sm ${entry.status === "done" ? "line-through opacity-50" : ""}`}
                  >
                    {entry.text}
                  </p>
                  <p className="mt-1 text-xs opacity-60">
                    <span className="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
                      {CATEGORY_LABELS[entry.category]}
                    </span>{" "}
                    · {new Date(entry.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
