import "server-only";
import { sendManagerEmail, type EmailResult } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Item, Submission } from "@/lib/types";
import { formatDay, formatWeek, nextWeekStart, todayISO } from "@/lib/week";
import { REQUEST_THRESHOLD, groupRequests, isBelowPar, parRatio } from "@/app/(shell)/manager/stock-math";

// The Friday summary email. Runs from Vercel Cron (no user session) and from the
// dashboard button, so it reads with the service-role client. Callers authorise
// first: the cron route checks CRON_SECRET, the server action calls requireManager().

const DAY_MS = 86_400_000;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const S = {
  body: "margin:0;padding:24px 12px;background:#f6f7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2420;",
  card: "max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6e1;border-radius:12px;padding:24px;",
  h1: "margin:0 0 4px;font-size:22px;line-height:1.3;color:#065f46;",
  sub: "margin:0 0 20px;font-size:14px;color:#66706b;",
  h2: "margin:24px 0 8px;font-size:15px;line-height:1.4;color:#1c2420;border-bottom:1px solid #e3e6e1;padding-bottom:6px;",
  table: "width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;",
  td: "padding:6px 0;vertical-align:top;border-bottom:1px solid #f0f2ee;",
  tdRight: "padding:6px 0 6px 12px;vertical-align:top;text-align:right;white-space:nowrap;border-bottom:1px solid #f0f2ee;",
  muted: "color:#66706b;font-size:13px;",
  empty: "margin:0;font-size:14px;color:#66706b;",
  pill: "display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#e3f4ec;color:#065f46;font-size:12px;font-weight:600;",
  button:
    "display:inline-block;background:#047857;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;",
};

function section(title: string, rows: [left: string, right: string][], emptyText: string): string {
  const body =
    rows.length === 0
      ? `<p style="${S.empty}">${esc(emptyText)}</p>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="${S.table}">${rows
          .map(([l, r]) => `<tr><td style="${S.td}">${l}</td><td style="${S.tdRight}">${r}</td></tr>`)
          .join("")}</table>`;
  return `<h2 style="${S.h2}">${esc(title)}</h2>${body}`;
}

/** Build the email. Throws if the data cannot be loaded. */
export async function buildFridaySummary(): Promise<{ subject: string; html: string }> {
  const db = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  const [itemsRes, lowRes, reqRes, maintRes] = await Promise.all([
    db.from("items").select("*").order("name"),
    db.from("submissions").select("id, item_id, detail, raw_text").eq("type", "low_stock").gte("created_at", weekAgo),
    db
      .from("submissions")
      .select("id, user_id, type, requested_item_name, raw_text, created_at")
      .eq("type", "new_request")
      .neq("status", "resolved"),
    db
      .from("submissions")
      .select("id, user_id, detail, raw_text, status, created_at")
      .eq("type", "maintenance")
      .neq("status", "resolved")
      .order("created_at"),
  ]);
  const failed = [itemsRes, lowRes, reqRes, maintRes].find((r) => r.error)?.error;
  if (failed) throw new Error(`Could not load summary data: ${failed.message}`);

  const items = (itemsRes.data ?? []) as Item[];
  const itemName = new Map(items.map((i) => [i.id, i.name]));

  // 1. Low-stock reports from the last 7 days, grouped by item.
  const lowCounts = new Map<string, number>();
  for (const s of (lowRes.data ?? []) as Pick<Submission, "id" | "item_id" | "detail" | "raw_text">[]) {
    const name = (s.item_id && itemName.get(s.item_id)) || "Not matched to an item";
    lowCounts.set(name, (lowCounts.get(name) ?? 0) + 1);
  }
  const lowRows = [...lowCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]): [string, string] => [esc(name), plural(n, "report", "reports")]);

  // 2. Requested items with distinct requester counts.
  const requestRows = groupRequests((reqRes.data ?? []) as Parameters<typeof groupRequests>[0]).map(
    (g): [string, string] => [
      `${esc(g.name)}${g.atThreshold ? `<span style="${S.pill}">${REQUEST_THRESHOLD}+ asked: suggest on next order</span>` : ""}`,
      plural(g.requesterIds.length, "person", "people"),
    ],
  );

  // 3. Maintenance still not resolved.
  const maint = (maintRes.data ?? []) as Pick<Submission, "id" | "detail" | "raw_text" | "status" | "created_at">[];
  const maintRows = maint.map((s): [string, string] => [
    `${esc(s.detail || s.raw_text)}<br><span style="${S.muted}">Reported ${esc(formatDay(todayISO(new Date(s.created_at))))}</span>`,
    s.status === "acknowledged" ? "Acknowledged" : "Open",
  ]);

  // 4. Items currently below par, lowest first.
  const below = items
    .filter((i) => i.active && isBelowPar(i))
    .sort((a, b) => parRatio(a) - parRatio(b));
  const belowRows = below.map((i): [string, string] => [
    `${esc(i.name)}${i.unit ? ` <span style="${S.muted}">${esc(i.unit)}</span>` : ""}`,
    `${i.current_qty} of ${i.par_level}`,
  ]);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const orderUrl = `${appUrl}/manager/order`;
  const today = formatDay(todayISO(now));
  const subject = `Pantry summary, ${today}: ${plural(below.length, "item", "items")} below par`;

  const html = `<!doctype html>
<html lang="en">
<body style="${S.body}">
<div style="${S.card}">
<h1 style="${S.h1}">Pantry summary</h1>
<p style="${S.sub}">${esc(today)} · ready for the order for ${esc(formatWeek(nextWeekStart(now)).toLowerCase())}</p>
${section("Low-stock reports, last 7 days", lowRows, "No low-stock reports this week.")}
${section("Requested items", requestRows, "No open requests.")}
${section("Maintenance still open", maintRows, "No open maintenance reports.")}
${section("Below par right now", belowRows, "Everything is at or above par.")}
<p style="margin:28px 0 8px;"><a href="${esc(orderUrl)}" style="${S.button}">Build this week's order</a></p>
<p style="margin:0;${S.muted}">Or open ${esc(orderUrl)}</p>
</div>
</body>
</html>`;

  return { subject, html };
}

/** Build and send the summary to the manager. Never throws. */
export async function sendFridaySummary(): Promise<EmailResult> {
  try {
    return await sendManagerEmail(await buildFridaySummary());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[friday-summary] failed:", message);
    return { ok: false, skipped: false, error: message };
  }
}
