"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { suggestOrderAction } from "./actions";
import { MAX_HEADCOUNT } from "./shared";

/** Next week's headcount and the button that drafts the order. */
export function SuggestForm({
  lastHeadcount,
  lastWeekLabel,
  nextWeekLabel,
  defaultHeadcount,
  hasDraft,
}: {
  lastHeadcount: number | null;
  lastWeekLabel: string;
  nextWeekLabel: string;
  defaultHeadcount: number | null;
  hasDraft: boolean;
}) {
  const [value, setValue] = useState(defaultHeadcount != null ? String(defaultHeadcount) : "");
  const [error, setError] = useState<string | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [pending, startTransition] = useTransition();

  const headcount = /^\d+$/.test(value.trim()) ? Number(value) : null;
  const change =
    headcount != null && lastHeadcount ? Math.round(((headcount - lastHeadcount) / lastHeadcount) * 100) : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (headcount == null || headcount < 1) {
      setError("Enter next week's headcount as a whole number.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await suggestOrderAction(headcount);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setAiUnavailable(res.source === "rules");
      } catch {
        setError("The order could not be drafted. Check your connection and try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div>
          <p className="text-xs font-medium text-muted">Last week ({lastWeekLabel})</p>
          <p className="mt-1 flex h-12 items-center text-2xl font-semibold tabular-nums">
            {lastHeadcount ?? "—"}
            <span className="ml-1.5 text-sm font-normal text-muted">in the office</span>
          </p>
        </div>
        <label className="text-xs font-medium text-muted">
          Next week ({nextWeekLabel})
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_HEADCOUNT}
            step={1}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 h-12 w-full rounded-lg border border-line bg-surface px-3 text-2xl font-semibold tabular-nums text-foreground outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" variant={hasDraft ? "secondary" : "primary"} disabled={pending}>
          {pending ? "Working it out…" : hasDraft ? "Suggest again" : "Suggest order"}
        </Button>
        <p className="text-sm text-muted" aria-live="polite">
          {pending
            ? "Scaling last week's use to the new headcount. Usually under 20 seconds."
            : change != null && change !== 0
              ? `${Math.abs(change)}% ${change < 0 ? "fewer" : "more"} people than last week.`
              : hasDraft
                ? "Suggesting again replaces the draft below."
                : ""}
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {aiUnavailable && !pending ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          The AI explanation was unavailable, so this draft uses the calculated quantities with standard reasons.
        </p>
      ) : null}
    </form>
  );
}
