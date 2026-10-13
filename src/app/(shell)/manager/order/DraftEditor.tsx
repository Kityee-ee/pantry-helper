"use client";

import { useRef, useState, useTransition } from "react";
import { Badge, Button, Card, CardTitle } from "@/components/ui";
import { placeOrderAction, saveDraftAction } from "./actions";
import { MAX_LINES, MAX_NAME, MAX_QTY, type CatalogueOption, type EditorLine, type LineInput } from "./shared";

type Line = EditorLine & { key: number; qtyText: string };

const OTHER = "__other";
const inputClass =
  "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent";
const GRID = "md:grid-cols-[1.5fr_3rem_3rem_3rem_4.5rem_8.5rem_2fr_2.5rem]";

const num = (n: number | null) => (n == null ? "—" : String(n));

/** Editable draft order: quantities, remove, add, save and place. */
export function DraftEditor({
  orderId,
  summary,
  headcount,
  lastHeadcount,
  lastOrder,
  initialLines,
  catalogue,
}: {
  orderId: string;
  summary: string | null;
  headcount: number | null;
  lastHeadcount: number | null;
  lastOrder: { total_units: number; weekLabel: string } | null;
  initialLines: EditorLine[];
  catalogue: CatalogueOption[];
}) {
  const nextKey = useRef(initialLines.length);
  const [lines, setLines] = useState<Line[]>(() =>
    initialLines.map((l, key) => ({ ...l, key, qtyText: String(l.qty) })),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addChoice, setAddChoice] = useState("");
  const [addName, setAddName] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [pending, startTransition] = useTransition();
  const [placing, setPlacing] = useState(false);

  const qtyOf = (l: Line) => (/^\d+$/.test(l.qtyText.trim()) ? Math.min(MAX_QTY, Number(l.qtyText)) : null);
  const invalid = lines.some((l) => qtyOf(l) === null);
  const total = lines.reduce((sum, l) => sum + (qtyOf(l) ?? 0), 0);
  const suggestedTotal = lines.reduce((sum, l) => sum + (l.suggested_qty ?? 0), 0);
  const ordering = lines.filter((l) => (qtyOf(l) ?? 0) > 0).length;
  const wasteSkipped = lines.filter((l) => l.waste_risk && (qtyOf(l) ?? 0) === 0).length;

  const onOrder = new Set(lines.map((l) => l.item_id).filter(Boolean));
  const addable = catalogue.filter((c) => !onOrder.has(c.id));

  function touch() {
    setDirty(true);
    setError(null);
  }

  function setQty(key: number, qtyText: string) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, qtyText } : l)));
    touch();
  }

  function step(line: Line, by: number) {
    setQty(line.key, String(Math.min(MAX_QTY, Math.max(0, (qtyOf(line) ?? 0) + by))));
  }

  function remove(key: number) {
    setLines((current) => current.filter((l) => l.key !== key));
    touch();
  }

  function add() {
    const qty = /^\d+$/.test(addQty.trim()) ? Math.min(MAX_QTY, Number(addQty)) : null;
    if (qty == null) {
      setError("Quantity needs to be a whole number.");
      return;
    }
    const item = catalogue.find((c) => c.id === addChoice);
    const name = item ? item.name : addName.trim();
    if (!name || (!item && addChoice !== OTHER)) {
      setError("Choose an item to add, or pick Other and type a name.");
      return;
    }
    if (lines.length >= MAX_LINES) return;
    nextKey.current += 1;
    const line: Line = {
      key: nextKey.current,
      id: null,
      item_id: item?.id ?? null,
      item_name: name,
      unit: item?.unit ?? null,
      current_qty: item?.current_qty ?? null,
      par_level: item?.par_level ?? null,
      used_last_week: item?.used_last_week ?? null,
      suggested_qty: null,
      qty,
      qtyText: String(qty),
      reason: "Added by hand",
      is_new: false,
      waste_risk: false,
    };
    setLines((current) => [...current, line]);
    setAddChoice("");
    setAddName("");
    setAddQty("1");
    touch();
  }

  function payload(): LineInput[] {
    return lines.map((l) => ({ id: l.id, item_id: l.item_id, item_name: l.item_name, qty: qtyOf(l) ?? 0 }));
  }

  function save() {
    if (pending || invalid) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveDraftAction(orderId, payload());
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // The page re-renders with the saved lines and this editor remounts on them (see its key).
        setDirty(false);
      } catch {
        setError("Your changes could not be saved. Check your connection and try again.");
      }
    });
  }

  function place() {
    if (pending || invalid) return;
    if (total === 0) {
      setError("Every quantity is 0, so there is nothing to order.");
      return;
    }
    setError(null);
    setPlacing(true);
    // No try/catch here: on success the action redirects, which arrives as a
    // thrown navigation signal that Next.js must be left to handle.
    startTransition(async () => {
      const res = await placeOrderAction(orderId, payload());
      if (res && !res.ok) {
        setError(res.error);
        setPlacing(false);
      }
    });
  }

  const diff = lastOrder ? total - lastOrder.total_units : null;
  const pct = lastOrder && lastOrder.total_units > 0 && diff != null ? Math.round((Math.abs(diff) / lastOrder.total_units) * 100) : null;
  const widest = Math.max(total, lastOrder?.total_units ?? 0, 1);

  return (
    <div className="grid gap-4">
      {summary ? (
        <Card className="border-accent/30 bg-accent-soft">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">Why this order</p>
          <p className="mt-1.5 text-sm leading-relaxed">{summary}</p>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Compared with last week&apos;s order</CardTitle>
          {diff != null ? (
            <Badge tone={diff < 0 ? "accent" : diff > 0 ? "warn" : "neutral"} className="text-sm">
              {diff === 0
                ? "Same size"
                : `${Math.abs(diff)} units ${diff < 0 ? "fewer" : "more"}${pct != null ? ` (${pct}% ${diff < 0 ? "less" : "more"})` : ""}`}
            </Badge>
          ) : null}
        </div>
        <dl className="mt-3 grid gap-2.5 text-sm">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">
                This order{headcount != null ? ` · ${headcount} people` : ""}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">{total} units</dd>
            </div>
            <div className="mt-1 h-2.5 rounded-full bg-black/5">
              <div className="h-2.5 rounded-full bg-accent" style={{ width: `${(total / widest) * 100}%` }} />
            </div>
          </div>
          {lastOrder ? (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">
                  Last order ({lastOrder.weekLabel}){lastHeadcount != null ? ` · ${lastHeadcount} people` : ""}
                </dt>
                <dd className="text-lg font-semibold tabular-nums text-muted">{lastOrder.total_units} units</dd>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-black/5">
                <div
                  className="h-2.5 rounded-full bg-muted/50"
                  style={{ width: `${(lastOrder.total_units / widest) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-muted">No earlier order to compare with.</p>
          )}
        </dl>
        <p className="mt-3 text-xs text-muted">
          {ordering} of {lines.length} items ordered
          {wasteSkipped > 0 ? ` · ${wasteSkipped} skipped to avoid waste` : ""}
          {total !== suggestedTotal ? ` · suggested total was ${suggestedTotal}` : ""}
        </p>
      </Card>

      <div className="grid gap-2">
        <div className={`hidden gap-3 px-4 text-xs font-medium text-muted md:grid ${GRID}`}>
          <span>Item</span>
          <span className="text-right">Stock</span>
          <span className="text-right">Par</span>
          <span className="text-right">Used</span>
          <span className="text-right">Suggested</span>
          <span className="text-center">Quantity</span>
          <span>Reason</span>
          <span />
        </div>

        {lines.map((line) => {
          const qty = qtyOf(line);
          const edited = line.suggested_qty != null && qty != null && qty !== line.suggested_qty;
          return (
            <div
              key={line.key}
              className={`grid gap-2 rounded-xl border border-line bg-surface p-3 shadow-sm md:items-center md:gap-3 md:px-4 ${GRID} ${line.waste_risk ? "border-l-4 border-l-warn" : line.is_new ? "border-l-4 border-l-accent" : ""}`}
            >
              <div className="flex items-start justify-between gap-2 md:block">
                <div className="min-w-0">
                  <p className="font-medium leading-snug">{line.item_name}</p>
                  {line.unit ? <p className="text-xs text-muted">{line.unit}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
                    {line.is_new ? <Badge tone="accent">New</Badge> : null}
                    {line.waste_risk ? <Badge tone="warn">Waste risk</Badge> : null}
                    {edited ? <Badge>Edited</Badge> : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${line.item_name}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-lg text-muted hover:bg-black/5 hover:text-danger md:hidden"
                  onClick={() => remove(line.key)}
                >
                  ×
                </button>
              </div>

              <p className="text-xs text-muted md:hidden">
                Stock {num(line.current_qty)} · Par {num(line.par_level)} · Used last week {num(line.used_last_week)} ·
                Suggested {num(line.suggested_qty)}
              </p>
              <span className="hidden text-right text-sm tabular-nums md:block">{num(line.current_qty)}</span>
              <span className="hidden text-right text-sm tabular-nums text-muted md:block">{num(line.par_level)}</span>
              <span className="hidden text-right text-sm tabular-nums md:block">{num(line.used_last_week)}</span>
              <span className="hidden text-right text-sm tabular-nums text-muted md:block">{num(line.suggested_qty)}</span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`One less ${line.item_name}`}
                  className="size-10 shrink-0 rounded-lg border border-line text-lg hover:bg-background"
                  onClick={() => step(line, -1)}
                >
                  −
                </button>
                <input
                  aria-label={`Quantity of ${line.item_name}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_QTY}
                  step={1}
                  className={`${inputClass} min-w-0 flex-1 px-1 text-center text-base font-semibold tabular-nums md:w-12 md:flex-none ${qty === null ? "border-danger" : ""}`}
                  value={line.qtyText}
                  onChange={(e) => setQty(line.key, e.target.value)}
                />
                <button
                  type="button"
                  aria-label={`One more ${line.item_name}`}
                  className="size-10 shrink-0 rounded-lg border border-line text-lg hover:bg-background"
                  onClick={() => step(line, 1)}
                >
                  +
                </button>
              </div>

              <p className="text-sm text-muted">{line.reason}</p>

              <button
                type="button"
                aria-label={`Remove ${line.item_name}`}
                className="hidden size-9 items-center justify-center rounded-lg text-lg text-muted hover:bg-black/5 hover:text-danger md:flex"
                onClick={() => remove(line.key)}
              >
                ×
              </button>
            </div>
          );
        })}

        {lines.length === 0 ? <p className="px-1 text-sm text-muted">No lines on this draft. Add one below.</p> : null}
      </div>

      <Card>
        <CardTitle>Add a line</CardTitle>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-start">
          <div className="grid gap-2">
            <select
              aria-label="Item to add"
              className={inputClass}
              value={addChoice}
              onChange={(e) => setAddChoice(e.target.value)}
            >
              <option value="">Choose item…</option>
              {addable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.unit ? ` (${c.unit})` : ""}
                </option>
              ))}
              <option value={OTHER}>Other (type a name)</option>
            </select>
            {addChoice === OTHER ? (
              <input
                aria-label="Name of the item"
                className={inputClass}
                value={addName}
                maxLength={MAX_NAME}
                placeholder="e.g. Oat milk 1L"
                onChange={(e) => setAddName(e.target.value)}
              />
            ) : null}
          </div>
          <input
            aria-label="Quantity to add"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_QTY}
            step={1}
            className={`${inputClass} text-center tabular-nums`}
            value={addQty}
            onChange={(e) => setAddQty(e.target.value)}
          />
          <Button variant="secondary" onClick={add}>
            Add
          </Button>
        </div>
      </Card>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-20 z-10 rounded-xl border border-line bg-surface p-3 shadow-md md:static md:shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            {invalid
              ? "Quantities need to be whole numbers of 0 or more."
              : `${total} units across ${ordering} items${dirty ? " · unsaved changes" : ""}`}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pending || invalid || !dirty} onClick={save}>
              {pending && !placing ? "Saving…" : "Save draft"}
            </Button>
            <Button size="lg" disabled={pending || invalid} onClick={place}>
              {placing ? "Placing…" : "Place order"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
