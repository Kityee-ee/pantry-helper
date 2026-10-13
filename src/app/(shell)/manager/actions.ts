"use server";

import { requireManager } from "@/lib/auth";
import { sendFridaySummary } from "@/lib/friday-summary";

export type SummaryActionResult = { ok: boolean; message: string };

/** Dashboard button: send the Friday summary email right now. */
export async function sendFridaySummaryNow(): Promise<SummaryActionResult> {
  await requireManager();
  const result = await sendFridaySummary();
  if (result.ok) return { ok: true, message: "Friday summary sent to the manager's email." };
  return {
    ok: false,
    message: result.skipped ? `Not sent: email is not configured (${result.error}).` : `Not sent: ${result.error}`,
  };
}
