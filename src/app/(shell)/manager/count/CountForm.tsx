"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { Item } from "@/lib/types";
import { saveCount, type CountResult } from "./actions";

type CountItem = Pick<Item, "id" | "name" | "unit" | "par_level" | "current_qty">;

const stepClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-xl font-medium hover:bg-background disabled:opacity-40";

export function CountForm({ items }: { items: CountItem[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, String(i.current_qty)])),
  );
  const [result, setResult] = useState<CountResult | null>(null);
  const [pending, startTransition] = useTransition();

  const parse = (raw: string | undefined) => (raw !== undefined && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null);
  const changedCount = items.filter((i) => parse(values[i.id]) !== i.current_qty).length;
  const invalid = items.some((i) => parse(values[i.id]) === null);

  function set(id: string, value: string) {
    setResult(null);
    setValues((v) => ({ ...v, [id]: value }));
  }

  function step(id: string, by: number) {
    const current = parse(values[id]) ?? 0;
    set(id, String(Math.max(0, current + by)));
  }

  function save() {
    if (invalid) {
      setResult({ ok: false, error: "Every count must be a whole number, 0 or more." });
      return;
    }
    const payload: Record<string, number> = {};
    for (const i of items) payload[i.id] = parse(values[i.id]) ?? i.current_qty;
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await saveCount(payload));
      } catch {
        setResult({ ok: false, error: "Something went wrong. Please try again." });
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-sm">
        {items.map((item) => {
          const parsed = parse(values[item.id]);
          const changed = parsed !== item.current_qty;
          return (
            <li key={item.id} className={`flex items-center gap-3 px-4 py-3 ${changed ? "bg-accent-soft/50" : ""}`}>
              <label htmlFor={`qty-${item.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.name}</span>
                <span className="block text-xs text-muted">
                  {item.unit ? `${item.unit} · ` : ""}par {item.par_level}
                  {changed && parsed !== null ? ` · was ${item.current_qty}` : ""}
                </span>
              </label>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className={stepClass}
                  onClick={() => step(item.id, -1)}
                  disabled={pending || (parsed ?? 0) <= 0}
                  aria-label={`One less ${item.name}`}
                >
                  −
                </button>
                <input
                  id={`qty-${item.id}`}
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  step={1}
                  value={values[item.id] ?? ""}
                  onChange={(e) => set(item.id, e.target.value)}
                  onFocus={(e) => e.target.select()}
                  disabled={pending}
                  aria-invalid={parsed === null}
                  className={`h-11 w-16 rounded-lg border bg-surface text-center text-base font-semibold tabular-nums focus:border-accent focus:outline-none ${
                    parsed === null ? "border-danger" : "border-line"
                  }`}
                />
                <button
                  type="button"
                  className={stepClass}
                  onClick={() => step(item.id, 1)}
                  disabled={pending}
                  aria-label={`One more ${item.name}`}
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-20 z-10 mt-4 rounded-xl border border-line bg-surface p-3 shadow-md md:bottom-4">
        {result ? (
          <p
            role={result.ok ? "status" : "alert"}
            className={`mb-3 rounded-lg px-3 py-2 text-sm ${
              result.ok ? "bg-accent-soft text-accent-strong" : "bg-danger-soft text-danger"
            }`}
          >
            {result.ok
              ? `Count saved. ${result.changed} of ${result.counted} ${result.counted === 1 ? "item" : "items"} changed.`
              : result.error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {changedCount === 0 ? "No changes yet" : `${changedCount} ${changedCount === 1 ? "item" : "items"} changed`}
          </p>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Saving…" : "Save count"}
          </Button>
        </div>
      </div>
    </form>
  );
}
