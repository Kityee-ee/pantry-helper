"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireManager } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { SUBMISSION_TYPE_LABELS, type Submission } from "@/lib/types";

export type InboxActionResult = { ok: true } | { ok: false; error: string };

type Touched = Pick<Submission, "id" | "user_id" | "type" | "detail" | "raw_text">;
const TOUCHED = "id, user_id, type, detail, raw_text";

function quote(s: Touched): string {
  const text = (s.detail || s.raw_text).trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Mark an open submission as seen, and tell the person who sent it. */
export async function acknowledgeSubmission(rawId: string): Promise<InboxActionResult> {
  const me = await requireManager();

  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { ok: false, error: "That submission could not be found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("submissions")
    .update({ status: "acknowledged" })
    .eq("id", id.data)
    .eq("status", "open")
    .select(TOUCHED)
    .maybeSingle();
  if (error) {
    console.error("[inbox] acknowledge failed:", error.message);
    return { ok: false, error: "Could not acknowledge that. Please try again." };
  }

  if (data) {
    const s = data as Touched;
    await notify([s.user_id], {
      title: `${me.full_name || "The pantry manager"} has seen your ${SUBMISSION_TYPE_LABELS[s.type].toLowerCase()} report`,
      body: quote(s),
      link: "/app/submissions",
    });
  }

  refresh();
  return { ok: true };
}

/** Resolve a submission with an optional note, and tell the person who sent it. */
export async function resolveSubmission(rawId: string, rawNote: string): Promise<InboxActionResult> {
  await requireManager();

  const id = z.uuid().safeParse(rawId);
  if (!id.success) return { ok: false, error: "That submission could not be found." };
  const note = z.string().trim().max(500).safeParse(rawNote ?? "");
  if (!note.success) return { ok: false, error: "Keep the note under 500 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("submissions")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), manager_note: note.data || null })
    .eq("id", id.data)
    .neq("status", "resolved")
    .select(TOUCHED)
    .maybeSingle();
  if (error) {
    console.error("[inbox] resolve failed:", error.message);
    return { ok: false, error: "Could not resolve that. Please try again." };
  }

  if (data) {
    const s = data as Touched;
    await notify([s.user_id], {
      title: `Resolved: your ${SUBMISSION_TYPE_LABELS[s.type].toLowerCase()} report`,
      body: note.data ? `${quote(s)} · Note: ${note.data}` : quote(s),
      link: "/app/submissions",
    });
  }

  refresh();
  return { ok: true };
}
