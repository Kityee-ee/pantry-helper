import { timingSafeEqual } from "node:crypto";
import { sendFridaySummary } from "@/lib/friday-summary";

// Called by Vercel Cron (see vercel.json), which sends `Authorization: Bearer ${CRON_SECRET}`.
// There is no user session here, so the shared secret is the authorisation.

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendFridaySummary();
  // A skipped send (email not configured) is not a server failure.
  const status = result.ok || result.skipped ? 200 : 500;
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}
