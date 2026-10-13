"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardTitle, buttonClass } from "@/components/ui";
import { SUBMISSION_TYPES, SUBMISSION_TYPE_LABELS, type SubmissionType } from "@/lib/types";
import { classifyAction, submitAction } from "./actions";
import {
  groupKey,
  MAX_DETAIL,
  MAX_ITEM,
  MAX_TEXT,
  others,
  usesItem,
  type DraftEntry,
  type LiveGroup,
  type StockedItem,
  type SubmitResultEntry,
} from "./shared";

type Draft = DraftEntry & { id: number };

type Phase =
  | { step: "write" }
  | { step: "confirm"; source: "ai" | "rules"; items: StockedItem[]; live: LiveGroup[] }
  | { step: "done"; results: SubmitResultEntry[] };

const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

/** Free-text box, then one confirmation card per issue found in the message. */
export function TellUs({ managerName }: { managerName: string }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "write" });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function classify(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await classifyAction(text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDrafts(res.entries.map((entry, id) => ({ ...entry, id })));
      setPhase({ step: "confirm", source: res.source, items: res.items, live: res.live });
    });
  }

  function send() {
    if (drafts.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await submitAction(
        text,
        drafts.map(({ type, item, detail }) => ({ type, item, detail })),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhase({ step: "done", results: res.results });
    });
  }

  function update(id: number, patch: Partial<DraftEntry>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function startOver() {
    setText("");
    setDrafts([]);
    setError(null);
    setPhase({ step: "write" });
  }

  if (phase.step === "done") {
    return (
      <Card>
        <CardTitle>Sent</CardTitle>
        <ul className="mt-3 space-y-3">
          {phase.results.map((r, i) => (
            <li key={i} className="flex items-start gap-3">
              <Badge tone={r.outcome === "already" ? "neutral" : "accent"} className="mt-0.5 shrink-0">
                {SUBMISSION_TYPE_LABELS[r.type]}
              </Badge>
              <p className="text-sm">{resultMessage(r, managerName)}</p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={startOver}>Tell us something else</Button>
          <Link href="/app/submissions" className={buttonClass("secondary")}>
            See my requests
          </Link>
        </div>
      </Card>
    );
  }

  if (phase.step === "confirm") {
    const live = new Map(phase.live.map((g) => [g.key, g]));
    return (
      <div className="space-y-4">
        <Card className="bg-background">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">You wrote</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
        </Card>

        <p className="text-sm text-muted">
          {drafts.length === 1 ? "Here is how we read it." : `We found ${drafts.length} separate things.`} Fix
          anything that looks wrong, then send.
          {phase.source === "rules" ? " (Sorted by simple keyword rules because the AI step was unavailable.)" : ""}
        </p>

        {drafts.map((d) => {
          const key = groupKey(d, phase.items);
          return (
            <Card key={d.id}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`type-${d.id}`}>
                  Type
                </label>
                <select
                  id={`type-${d.id}`}
                  value={d.type}
                  onChange={(e) => update(d.id, { type: e.target.value as SubmissionType })}
                  className="h-9 rounded-lg border border-line bg-accent-soft px-2 text-sm font-medium text-accent-strong outline-none focus:border-accent"
                >
                  {SUBMISSION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {SUBMISSION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                {drafts.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                    className="ml-auto h-9 rounded-lg px-2 text-sm text-muted hover:bg-black/5 hover:text-foreground"
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              {usesItem(d.type) ? (
                <div className="mt-3">
                  <label className="text-xs font-medium text-muted" htmlFor={`item-${d.id}`}>
                    Item
                  </label>
                  <input
                    id={`item-${d.id}`}
                    value={d.item ?? ""}
                    maxLength={MAX_ITEM}
                    onChange={(e) => update(d.id, { item: e.target.value })}
                    placeholder="e.g. Oat milk"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              ) : null}

              <div className="mt-3">
                <label className="text-xs font-medium text-muted" htmlFor={`detail-${d.id}`}>
                  What we will tell {managerName}
                </label>
                <input
                  id={`detail-${d.id}`}
                  value={d.detail}
                  maxLength={MAX_DETAIL}
                  onChange={(e) => update(d.id, { detail: e.target.value })}
                  className={`mt-1 ${inputClass}`}
                />
              </div>

              <Hint type={d.type} group={key ? live.get(key) : undefined} managerName={managerName} />
            </Card>
          );
        })}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={send} disabled={pending || drafts.some((d) => !d.detail.trim())}>
            {pending ? "Sending…" : drafts.length === 1 ? "Looks right, send" : `Looks right, send all ${drafts.length}`}
          </Button>
          <Button variant="secondary" onClick={() => setPhase({ step: "write" })} disabled={pending}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <form onSubmit={classify} className="flex flex-col gap-3">
        <label className="sr-only" htmlFor="tell-us">
          Your message
        </label>
        <textarea
          id="tell-us"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. We're out of oat milk again, and the dishwasher is leaking"
          rows={4}
          maxLength={MAX_TEXT}
          className={`${inputClass} resize-y`}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted">One message can cover several things.</span>
          <Button type="submit" disabled={!text.trim() || pending}>
            {pending ? "Reading…" : "Send"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** What happens next for this card, including whether other people already reported the same item. */
function Hint({ type, group, managerName }: { type: SubmissionType; group?: LiveGroup; managerName: string }) {
  let message: string;
  if (group?.mine) {
    message = "You have already reported this, so we will not send it twice.";
  } else if (type === "low_stock") {
    message = group?.others
      ? `${others(group.others)} already reported this. We will add you, and you will hear when it is restocked.`
      : "Goes into Friday's order. You will hear when it is restocked.";
  } else if (type === "new_request") {
    message = group?.others
      ? `${others(group.others)} already asked for this. Yours makes ${group.others + 1}.`
      : "Requests are counted. Popular ones get added to the weekly order.";
  } else if (type === "maintenance") {
    message = `${managerName} is told straight away.`;
  } else {
    message = `${managerName} will take a look.`;
  }
  return <p className="mt-3 text-xs text-muted">{message}</p>;
}

function resultMessage(r: SubmitResultEntry, managerName: string): string {
  if (r.outcome === "already") return `You have already reported ${r.label}. It is still on the list.`;
  switch (r.type) {
    case "low_stock":
      return r.outcome === "joined"
        ? `${r.label}: ${others(r.others)} reported this too, and we have added you. You will hear when it is restocked.`
        : `${r.label}: noted for Friday's order. You will hear when it is restocked.`;
    case "new_request":
      return r.others > 0
        ? `${r.label}: ${r.others + 1} people want this now. Popular requests get added to the weekly order.`
        : `${r.label}: noted. Popular requests get added to the weekly order.`;
    case "maintenance":
      return `${managerName} has been notified: ${r.label}`;
    default:
      return `Thanks. ${managerName} will take a look.`;
  }
}
