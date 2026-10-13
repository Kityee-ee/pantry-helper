import "server-only";
import { Resend } from "resend";

export type EmailResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: boolean; error: string };

/**
 * Email the pantry manager (MANAGER_EMAIL) via Resend.
 * Never throws. No-ops (ok: false, skipped: true) when RESEND_API_KEY or MANAGER_EMAIL is missing.
 */
export async function sendManagerEmail({
  subject,
  html,
}: {
  subject: string;
  html: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.MANAGER_EMAIL;
  const from = process.env.RESEND_FROM || "Pantry Helper <onboarding@resend.dev>";

  if (!apiKey || !to) {
    const missing = !apiKey ? "RESEND_API_KEY" : "MANAGER_EMAIL";
    console.warn(`[email] ${missing} not set, skipping "${subject}"`);
    return { ok: false, skipped: true, error: `${missing} not set` };
  }

  try {
    const { data, error } = await new Resend(apiKey).emails.send({ from, to, subject, html });
    if (error) {
      console.error("[email] Resend error:", error.message);
      return { ok: false, skipped: false, error: error.message };
    }
    return { ok: true, id: data?.id ?? null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[email] send failed:", message);
    return { ok: false, skipped: false, error: message };
  }
}
