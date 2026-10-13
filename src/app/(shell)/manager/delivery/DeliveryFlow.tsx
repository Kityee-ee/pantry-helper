"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardTitle, buttonClass, type BadgeTone } from "@/components/ui";
import { formatWeek } from "@/lib/week";
import { confirmDeliveryAction, extractDocketAction } from "./actions";
import {
  MAX_NAME,
  MAX_QTY,
  MAX_ROWS,
  MAX_UPLOAD_BYTES,
  PHOTO_TYPES,
  type CatalogueEntry,
  type Confidence,
  type ConfirmPayload,
  type DeliverySummary,
  type Extraction,
  type OpenOrder,
} from "./shared";

const SKIP = "__skip";
const NEW = "__new";

interface Row {
  key: number;
  line_text: string;
  /** An item id, SKIP, NEW, or "" while nothing is chosen yet. */
  choice: string;
  new_name: string;
  /** Kept as text so the field can be cleared while typing. */
  delivered: string;
  confidence: Confidence | null;
}

type Step = "capture" | "reading" | "review" | "done";

interface Notice {
  tone: "accent" | "warn";
  text: string;
}

const inputClass =
  "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent";

const confidenceLook: Record<Confidence, { label: string; tone: BadgeTone; edge: string }> = {
  high: { label: "Confident", tone: "accent", edge: "border-l-accent" },
  medium: { label: "Check", tone: "warn", edge: "border-l-warn" },
  low: { label: "Unsure", tone: "danger", edge: "border-l-danger" },
};

/** Shrink a photo in the browser so it fits in a server action request. */
async function shrinkPhoto(file: File): Promise<File> {
  const attempts: [number, number][] = [
    [1600, 0.82],
    [1280, 0.72],
    [1024, 0.6],
  ];
  try {
    const bitmap = await createImageBitmap(file);
    try {
      for (const [maxEdge, quality] of attempts) {
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) break;
        ctx.fillStyle = "#ffffff"; // screenshots with transparency would otherwise turn black as JPEG
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= MAX_UPLOAD_BYTES) return new File([blob], "docket.jpg", { type: "image/jpeg" });
      }
    } finally {
      bitmap.close();
    }
  } catch {
    // Fall through: the browser could not decode it (for example HEIC on a desktop).
  }
  if (PHOTO_TYPES[file.type] && file.size <= MAX_UPLOAD_BYTES) return file;
  throw new Error("unusable photo");
}

export function DeliveryFlow({
  catalogue,
  openOrder,
  lastDelivery,
}: {
  catalogue: CatalogueEntry[];
  openOrder: OpenOrder | null;
  lastDelivery: string | null;
}) {
  const [step, setStep] = useState<Step>("capture");
  const [rows, setRows] = useState<Row[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<{ data: Extraction; model: string } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [pending, startTransition] = useTransition();
  const nextKey = useRef(0);

  const itemById = new Map(catalogue.map((i) => [i.id, i]));
  const orderedByItem = new Map<string, number>();
  for (const line of openOrder?.lines ?? []) {
    if (line.item_id) orderedByItem.set(line.item_id, (orderedByItem.get(line.item_id) ?? 0) + line.qty);
  }

  function makeRow(partial: Omit<Row, "key">): Row {
    nextKey.current += 1;
    return { key: nextKey.current, ...partial };
  }

  /** The manual table: one row per line of the open order, delivered = ordered. */
  function rowsFromOrder(): Row[] {
    return (openOrder?.lines ?? [])
      .filter((l) => l.item_id && itemById.has(l.item_id))
      .map((l) =>
        makeRow({
          line_text: l.item_name,
          choice: l.item_id!,
          new_name: "",
          delivered: String(l.qty),
          confidence: null,
        }),
      );
  }

  function blankRow(): Row {
    return makeRow({ line_text: "", choice: "", new_name: "", delivered: "1", confidence: null });
  }

  function goManual(reason: string | null) {
    const prefilled = rowsFromOrder();
    setExtraction(null);
    setRows(prefilled.length > 0 ? prefilled : [blankRow()]);
    const basis =
      prefilled.length > 0
        ? "The table below is filled in from your order, with everything delivered in full. Change anything that differs from the docket."
        : "There is no order waiting on a delivery, so add what arrived line by line.";
    setNotice({ tone: reason ? "warn" : "accent", text: reason ? `${reason} ${basis}` : basis });
    setError(null);
    setStep("review");
  }

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPhoto(null);
    setExtraction(null);
    setRows([]);
    setNotice(null);
    setError(null);
    setSummary(null);
    setStep("capture");
  }

  function onPhotoChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (!file || pending) return;
    setError(null);
    setStep("reading");

    startTransition(async () => {
      let small: File;
      try {
        small = await shrinkPhoto(file);
      } catch {
        goManual("That photo could not be opened here.");
        return;
      }
      if (preview) URL.revokeObjectURL(preview);
      setPhoto(small);
      setPreview(URL.createObjectURL(small));

      try {
        const form = new FormData();
        form.set("photo", small);
        const res = await extractDocketAction(form);
        if (!res.ok) {
          goManual(res.message);
          return;
        }
        setExtraction({ data: res.extraction, model: res.model });
        setRows(
          res.extraction.lines.map((line) =>
            makeRow({
              line_text: line.line_text,
              // Unmatched lines default to a new item, named from the docket. The manager can change it.
              choice: line.item_id && itemById.has(line.item_id) ? line.item_id : NEW,
              new_name: line.line_text.slice(0, MAX_NAME),
              delivered: String(line.quantity),
              confidence: line.confidence,
            }),
          ),
        );
        const from = [res.extraction.supplier, res.extraction.docket_number && `docket ${res.extraction.docket_number}`]
          .filter(Boolean)
          .join(", ");
        const count = res.extraction.lines.length;
        setNotice({
          tone: "accent",
          text: `Read ${count} line${count === 1 ? "" : "s"}${from ? ` from ${from}` : ""}. Check the matches and quantities, then confirm.`,
        });
        setStep("review");
      } catch {
        // Network failure, or the request was rejected (for example too large).
        goManual("The photo could not be sent for reading.");
      }
    });
  }

  function patch(key: number, change: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  const qtyOf = (r: Row) => (/^\d+$/.test(r.delivered.trim()) ? Math.min(MAX_QTY, Number(r.delivered)) : null);
  const active = rows.filter((r) => r.choice !== SKIP);
  const chosenItemIds = new Set(active.map((r) => r.choice).filter((c) => itemById.has(c)));
  const notOnDocket = (openOrder?.lines ?? []).filter((l) => !l.item_id || !chosenItemIds.has(l.item_id));
  const totalUnits = active.reduce((sum, r) => sum + (qtyOf(r) ?? 0), 0);

  const problem =
    active.length === 0
      ? "Every line is skipped."
      : active.some((r) => r.choice === "")
        ? "Choose an item for every line, or set it to Skip."
        : active.some((r) => r.choice === NEW && !r.new_name.trim())
          ? "Give each new item a name."
          : rows.some((r) => r.choice !== SKIP && qtyOf(r) === null)
            ? "Delivered needs to be a whole number of 0 or more."
            : null;

  function confirm() {
    if (pending || problem) return;
    setError(null);
    const payload: ConfirmPayload = {
      order_id: openOrder?.id ?? null,
      source: extraction ? "ai" : "manual",
      model: extraction?.model ?? null,
      extraction: extraction?.data ?? null,
      rows: rows.map((r) => {
        const action = r.choice === SKIP ? "skip" : r.choice === NEW ? "new" : "item";
        return {
          line_text: r.line_text.trim() || (itemById.get(r.choice)?.name ?? r.new_name.trim()),
          action,
          item_id: action === "item" ? r.choice : null,
          new_name: action === "new" ? r.new_name.trim() : null,
          delivered: qtyOf(r) ?? 0,
          confidence: r.confidence,
        };
      }),
    };

    startTransition(async () => {
      try {
        const form = new FormData();
        form.set("payload", JSON.stringify(payload));
        if (photo) form.set("photo", photo);
        const res = await confirmDeliveryAction(form);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setSummary(res.summary);
        setStep("done");
        window.scrollTo({ top: 0 });
      } catch {
        setError("The delivery could not be sent. Check your connection and try again.");
      }
    });
  }

  // ------------------------------------------------------------------ capture
  if (step === "capture" || step === "reading") {
    const reading = step === "reading";
    return (
      <div className="grid gap-4">
        <Card>
          <CardTitle>Photograph the docket</CardTitle>
          <p className="mt-1 text-sm text-muted">
            {openOrder
              ? `It will be checked against the order for ${formatWeek(openOrder.week_start).toLowerCase()} (${openOrder.lines.length} lines).`
              : "No order is waiting on a delivery, so the lines will simply be added to stock."}
          </p>

          {reading ? (
            <div className="mt-4 flex items-center gap-3 rounded-lg bg-accent-soft p-4" role="status">
              <span className="size-5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <div>
                <p className="text-sm font-medium text-accent-strong">Reading the docket…</p>
                <p className="text-xs text-muted">Matching each line to your items. This usually takes under 20 seconds.</p>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <label className={buttonClass("primary", "lg", "cursor-pointer")}>
                Take photo
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhotoChosen} />
              </label>
              <label className={buttonClass("secondary", "lg", "cursor-pointer")}>
                Choose a photo
                <input type="file" accept="image/*" className="sr-only" onChange={onPhotoChosen} />
              </label>
            </div>
          )}

          {preview && reading ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={preview} alt="Docket being read" className="mt-4 max-h-64 rounded-lg border border-line" />
          ) : null}

          {!reading ? (
            <p className="mt-4 text-sm">
              <button
                type="button"
                className="font-medium text-accent-strong underline underline-offset-2"
                onClick={() => goManual(null)}
              >
                Skip photo, enter manually
              </button>
            </p>
          ) : null}
        </Card>
        {lastDelivery && !reading ? <p className="px-1 text-xs text-muted">Last delivery recorded {lastDelivery}.</p> : null}
      </div>
    );
  }

  // --------------------------------------------------------------------- done
  if (step === "done" && summary) {
    const short = summary.items.filter((i) => i.ordered != null && i.delivered < i.ordered);
    const units = summary.items.reduce((sum, i) => sum + i.delivered, 0);
    return (
      <div className="grid gap-4">
        <Card className="border-accent/40 bg-accent-soft">
          <CardTitle className="text-accent-strong">Delivery recorded</CardTitle>
          <p className="mt-1 text-sm">
            {units} unit{units === 1 ? "" : "s"} across {summary.items.length} item
            {summary.items.length === 1 ? "" : "s"} added to stock.
            {summary.resolved_reports > 0
              ? ` ${summary.resolved_reports} low-stock report${summary.resolved_reports === 1 ? "" : "s"} closed and ${summary.notified} ${summary.notified === 1 ? "person" : "people"} told it is back in stock.`
              : ""}
            {summary.photo_saved ? " Docket photo saved." : ""}
          </p>
        </Card>

        {summary.warnings.map((w) => (
          <p key={w} className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            {w}
          </p>
        ))}

        {short.length > 0 || summary.not_delivered.length > 0 ? (
          <Card className="border-danger/30">
            <CardTitle>Short on this delivery</CardTitle>
            <ul className="mt-2 grid gap-1.5 text-sm">
              {short.map((i) => (
                <li key={i.name} className="flex items-center justify-between gap-3">
                  <span>{i.name}</span>
                  <Badge tone="danger">
                    {i.delivered} of {i.ordered} delivered
                  </Badge>
                </li>
              ))}
              {summary.not_delivered.map((i) => (
                <li key={i.name} className="flex items-center justify-between gap-3">
                  <span>{i.name}</span>
                  <Badge tone="danger">0 of {i.ordered} delivered</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Worth a call to the supplier, or add the shortfall to this week&apos;s order.</p>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Stock now</CardTitle>
          <ul className="mt-2 divide-y divide-line text-sm">
            {summary.items.map((i) => (
              <li key={i.name} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{i.name}</span>
                  {i.created ? (
                    <Badge tone="accent" className="ml-2">
                      New item
                    </Badge>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  +{i.delivered} <span className="text-foreground">→ {i.qty_after}</span>
                  {i.unit ? ` ${i.unit}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Link href="/manager" className={buttonClass("primary", "lg", "flex-1 sm:flex-none")}>
            Back to dashboard
          </Link>
          <Button variant="secondary" size="lg" className="flex-1 sm:flex-none" onClick={reset}>
            Record another
          </Button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------- review
  return (
    <div className="grid gap-4">
      {notice ? (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-strong"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {preview ? (
        <details className="rounded-xl border border-line bg-surface p-3 text-sm">
          <summary className="cursor-pointer font-medium">Docket photo</summary>
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
          <img src={preview} alt="Delivery docket" className="mt-3 max-h-[28rem] rounded-lg border border-line" />
        </details>
      ) : null}

      <div className="grid gap-2">
        <div className="hidden grid-cols-[1.3fr_1.5fr_4.5rem_6rem_7rem] gap-3 px-4 text-xs font-medium text-muted md:grid">
          <span>On the docket</span>
          <span>Item</span>
          <span className="text-right">Ordered</span>
          <span>Delivered</span>
          <span>Status</span>
        </div>

        {rows.map((row) => {
          const skipped = row.choice === SKIP;
          const ordered = orderedByItem.get(row.choice) ?? null;
          const qty = qtyOf(row);
          const isShort = !skipped && ordered != null && qty != null && qty < ordered;
          const look = row.confidence ? confidenceLook[row.confidence] : null;
          const edge = isShort ? "border-l-danger" : (look?.edge ?? "border-l-line");
          return (
            <div
              key={row.key}
              className={`grid gap-2 rounded-xl border border-l-4 border-line bg-surface p-3 shadow-sm md:grid-cols-[1.3fr_1.5fr_4.5rem_6rem_7rem] md:items-center md:gap-3 md:px-4 ${edge} ${skipped ? "opacity-60" : ""} ${isShort ? "bg-danger-soft/40" : ""}`}
            >
              <div className="min-w-0">
                {row.confidence || row.line_text ? (
                  <p className="break-words font-mono text-xs text-muted md:text-sm">{row.line_text || "Added by hand"}</p>
                ) : (
                  <p className="text-xs text-muted">Added by hand</p>
                )}
              </div>

              <div className="grid gap-1.5">
                <select
                  aria-label="Matched item"
                  className={inputClass}
                  value={row.choice}
                  onChange={(e) => patch(row.key, { choice: e.target.value })}
                >
                  {row.choice === "" ? <option value="">Choose item…</option> : null}
                  <optgroup label="Items">
                    {catalogue.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.unit ? ` (${item.unit})` : ""}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Other">
                    <option value={NEW}>Create new item</option>
                    <option value={SKIP}>Skip this line</option>
                  </optgroup>
                </select>
                {row.choice === NEW ? (
                  <input
                    aria-label="New item name"
                    className={inputClass}
                    value={row.new_name}
                    maxLength={MAX_NAME}
                    placeholder="Name for the new item"
                    onChange={(e) => patch(row.key, { new_name: e.target.value })}
                  />
                ) : null}
              </div>

              <div className="flex items-center justify-between text-sm md:block md:text-right">
                <span className="text-xs text-muted md:hidden">Ordered</span>
                <span className="tabular-nums">{skipped || ordered == null ? "—" : ordered}</span>
              </div>

              <label className="flex items-center justify-between gap-3 text-sm md:block">
                <span className="text-xs text-muted md:hidden">Delivered</span>
                <input
                  aria-label="Delivered quantity"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_QTY}
                  step={1}
                  disabled={skipped}
                  className={`${inputClass} w-24 text-right tabular-nums md:w-full ${isShort ? "border-danger" : ""}`}
                  value={row.delivered}
                  onChange={(e) => patch(row.key, { delivered: e.target.value })}
                />
              </label>

              <div className="flex flex-wrap items-center gap-1.5">
                {isShort ? (
                  <Badge tone="danger">
                    Short {qty} of {ordered}
                  </Badge>
                ) : null}
                {row.choice === NEW ? <Badge tone="warn">Not in catalogue</Badge> : null}
                {look && !skipped ? <Badge tone={look.tone}>{look.label}</Badge> : null}
                {skipped ? <Badge>Skipped</Badge> : null}
              </div>
            </div>
          );
        })}

        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={rows.length >= MAX_ROWS}
            onClick={() => setRows((current) => [...current, blankRow()])}
          >
            + Add a line
          </Button>
        </div>
      </div>

      {notOnDocket.length > 0 ? (
        <Card className="border-danger/30">
          <CardTitle>Not delivered</CardTitle>
          <p className="mt-1 text-sm text-muted">On the order but not on this docket.</p>
          <ul className="mt-2 divide-y divide-line text-sm">
            {notOnDocket.map((line) => (
              <li key={`${line.item_id}-${line.item_name}`} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {line.item_name} <span className="text-muted">· ordered {line.qty}</span>
                </span>
                {line.item_id && itemById.has(line.item_id) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setRows((current) => [
                        ...current,
                        makeRow({
                          line_text: "",
                          choice: line.item_id!,
                          new_name: "",
                          delivered: String(line.qty),
                          confidence: null,
                        }),
                      ])
                    }
                  >
                    It did arrive
                  </Button>
                ) : (
                  <Badge tone="danger">Missing</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-20 z-10 rounded-xl border border-line bg-surface p-3 shadow-md md:static md:shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {problem ?? `${active.length} line${active.length === 1 ? "" : "s"}, ${totalUnits} units into stock`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={pending} onClick={reset}>
              Start again
            </Button>
            <Button size="lg" disabled={pending || Boolean(problem)} onClick={confirm}>
              {pending ? "Saving…" : "Confirm delivery"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
