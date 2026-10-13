"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { sendFridaySummaryNow, type SummaryActionResult } from "./actions";

export function SendSummaryButton() {
  const [result, setResult] = useState<SummaryActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await sendFridaySummaryNow());
      } catch {
        setResult({ ok: false, message: "Not sent: something went wrong. Please try again." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button variant="secondary" onClick={send} disabled={pending} className="w-full sm:w-auto">
        {pending ? "Sending…" : "Send Friday summary now"}
      </Button>
      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={`rounded-lg px-3 py-2 text-sm ${
            result.ok ? "bg-accent-soft text-accent-strong" : "bg-danger-soft text-danger"
          }`}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
