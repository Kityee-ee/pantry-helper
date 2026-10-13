import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { Badge, Card, CardTitle, PageHeader, buttonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/types";
import { APP_TIME_ZONE, formatWeek } from "@/lib/week";
import { loadLines, type LineRow } from "../data";
import { SummaryEditor } from "./SummaryEditor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const backLink = (
  <Link href="/manager/order" className={buttonClass("secondary", "sm")}>
    All orders
  </Link>
);

export default async function OrderDetailPage({ params }: PageProps<"/manager/order/[id]">) {
  await requireManager();
  const { id } = await params;

  let order: Order | null = null;
  let lines: LineRow[] = [];
  let units = new Map<string, string | null>();
  let failed = false;
  if (UUID.test(id)) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      order = (data as Order | null) ?? null;
      if (order) {
        const [loaded, itemsRes] = await Promise.all([
          loadLines(supabase, order.id),
          supabase.from("items").select("id, unit"),
        ]);
        lines = loaded;
        units = new Map((itemsRes.data ?? []).map((i) => [i.id as string, (i.unit as string | null) ?? null]));
      }
    } catch (e) {
      console.error("[order] detail load failed:", e instanceof Error ? e.message : e);
      failed = true;
    }
  }

  if (!order) {
    return (
      <>
        <PageHeader title="Order" action={backLink} />
        <Card>
          <p className={`text-sm ${failed ? "text-danger" : "text-muted"}`}>
            {failed ? "This order could not be loaded. Reload the page to try again." : "That order could not be found."}
          </p>
        </Card>
      </>
    );
  }

  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone: APP_TIME_ZONE,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  const placed = order.status === "placed";
  const ordered = lines.filter((l) => l.qty > 0);
  const skipped = lines.filter((l) => l.qty === 0);
  const total = ordered.reduce((sum, l) => sum + l.qty, 0);

  return (
    <>
      <PageHeader title={`Order for ${formatWeek(order.week_start).toLowerCase()}`} action={backLink} />

      <div className="grid gap-4">
        <Card className={placed ? "border-accent/40 bg-accent-soft" : ""}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge tone={placed ? "accent" : "warn"} className="bg-surface text-sm">
              {placed ? "Placed" : "Draft"}
            </Badge>
            <p className="text-sm">
              {placed && order.placed_at ? `Placed ${when(order.placed_at)}` : `Drafted ${when(order.created_at)}`}
            </p>
          </div>
          <p className="mt-2 text-sm text-muted">
            {total} units across {ordered.length} items
            {order.headcount != null ? ` · planned for ${order.headcount} people` : ""}
          </p>
          {!placed ? (
            <p className="mt-3 text-sm">
              This order has not been placed yet.{" "}
              <Link href="/manager/order" className="font-medium text-accent-strong underline underline-offset-2">
                Continue editing
              </Link>
            </p>
          ) : null}
        </Card>

        {placed ? (
          <Card>
            <CardTitle>Send to supplier</CardTitle>
            <p className="mb-3 mt-1 text-sm text-muted">
              Ready to paste into an email. Edit it here if you need to; your reasons are not included.
            </p>
            <SummaryEditor key={order.id} orderId={order.id} initialText={order.summary_text ?? ""} />
          </Card>
        ) : null}

        {order.ai_summary ? (
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">Why this order</p>
            <p className="mt-1.5 text-sm leading-relaxed">{order.ai_summary}</p>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Lines and reasons</CardTitle>
          <p className="mt-1 text-sm text-muted">For your reference. Not sent to the supplier.</p>
          {lines.length === 0 ? (
            <p className="mt-3 text-sm text-muted">This order has no lines.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {[...ordered, ...skipped].map((l) => {
                const unit = l.item_id ? units.get(l.item_id) : null;
                return (
                  <li key={l.id} className={`flex gap-3 py-2.5 ${l.qty === 0 ? "opacity-70" : ""}`}>
                    <span className="w-9 shrink-0 text-right text-base font-semibold tabular-nums">{l.qty}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">{l.item_name}</span>
                        {unit ? <span className="text-xs text-muted">{unit}</span> : null}
                        {l.is_new ? <Badge tone="accent">New</Badge> : null}
                        {l.waste_risk ? <Badge tone="warn">Waste risk</Badge> : null}
                        {l.suggested_qty != null && l.suggested_qty !== l.qty ? (
                          <Badge>Suggested {l.suggested_qty}</Badge>
                        ) : null}
                      </span>
                      {l.reason ? <span className="mt-0.5 block text-sm text-muted">{l.reason}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
