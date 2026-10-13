"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { SubmissionStatus } from "@/lib/types";
import { acknowledgeSubmission, resolveSubmission, type InboxActionResult } from "./actions";

export function SubmissionActions({ id, status }: { id: string; status: SubmissionStatus }) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status === "resolved") return null;

  function run(action: () => Promise<InboxActionResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) setError(res.error);
        else setResolving(false);
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      {resolving ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted" htmlFor={`note-${id}`}>
            Note for the employee (optional)
          </label>
          <textarea
            id={`note-${id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. Restocked this morning"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base focus:border-accent focus:outline-none sm:text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={() => run(() => resolveSubmission(id, note))} disabled={pending} className="flex-1 sm:flex-none">
              {pending ? "Resolving…" : "Resolve"}
            </Button>
            <Button variant="ghost" onClick={() => setResolving(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {status === "open" ? (
            <Button
              variant="secondary"
              onClick={() => run(() => acknowledgeSubmission(id))}
              disabled={pending}
              className="flex-1 sm:flex-none"
            >
              {pending ? "Saving…" : "Acknowledge"}
            </Button>
          ) : null}
          <Button onClick={() => setResolving(true)} disabled={pending} className="flex-1 sm:flex-none">
            Resolve
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
