import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardTitle, PageHeader, buttonClass } from "@/components/ui";
import type { FoodPost, Item } from "@/lib/types";
import { APP_TIME_ZONE, addDays, formatWeek, nextWeekStart, thisWeekStart, todayISO } from "@/lib/week";
import { SendSummaryButton } from "./SendSummaryButton";
import {
  CONSUMPTION_LOOKBACK_DAYS,
  REQUEST_THRESHOLD,
  groupRequests,
  isBelowPar,
  overstocked,
  parRatio,
  weeklyConsumption,
  type RequestRow,
  type StockEventLite,
} from "./stock-math";

const DAY_MS = 86_400_000;

export default async function ManagerDashboardPage() {
  await requireManager();
  const supabase = await createClient();

  const now = new Date();
  const today = todayISO(now);
  const friday = addDays(thisWeekStart(now), 4);
  const nextWeek = nextWeekStart(now);
  const since = new Date(now.getTime() - CONSUMPTION_LOOKBACK_DAYS * DAY_MS).toISOString();

  const [itemsRes, subsRes, eventsRes, ordersRes, foodRes] = await Promise.all([
    supabase.from("items").select("*").eq("active", true).order("name"),
    supabase
      .from("submissions")
      .select("id, user_id, type, requested_item_name, raw_text, created_at")
      .neq("status", "resolved"),
    supabase
      .from("stock_events")
      .select("item_id, kind, delta, qty_after, created_at")
      .in("kind", ["count", "delivery"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("orders").select("id").eq("week_start", nextWeek).eq("status", "placed").limit(1),
    supabase
      .from("food_posts")
      .select("*")
      .is("claimed_by", null)
      .gt("expires_at", now.toISOString())
      .order("expires_at"),
  ]);

  const loadError = [itemsRes, subsRes, eventsRes, ordersRes, foodRes].find((r) => r.error)?.error;

  const items = ((itemsRes.data ?? []) as Item[]).slice().sort((a, b) => parRatio(a) - parRatio(b));
  const openSubs = (subsRes.data ?? []) as RequestRow[];
  const weekly = weeklyConsumption((eventsRes.data ?? []) as StockEventLite[]);
  const over = overstocked(items, weekly);
  const food = (foodRes.data ?? []) as FoodPost[];

  const belowPar = items.filter(isBelowPar);
  const atThreshold = groupRequests(openSubs).filter((g) => g.atThreshold);
  const orderPlaced = (ordersRes.data ?? []).length > 0;

  const daysToFriday = Math.round((Date.parse(`${friday}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  let orderTile: { value: string; hint: string; tone: Tone };
  if (orderPlaced) {
    orderTile = { value: "Order placed", hint: formatWeek(nextWeek), tone: "ok" };
  } else if (daysToFriday > 0) {
    orderTile = {
      value: `${daysToFriday} day${daysToFriday === 1 ? "" : "s"}`,
      hint: "until Friday's order",
      tone: "ok",
    };
  } else if (daysToFriday === 0) {
    orderTile = { value: "Today", hint: "Friday's order is due", tone: "warn" };
  } else {
    orderTile = { value: "Overdue", hint: `No order for ${formatWeek(nextWeek).toLowerCase()}`, tone: "danger" };
  }

  const timeFmt = new Intl.DateTimeFormat("en-AU", { timeZone: APP_TIME_ZONE, hour: "numeric", minute: "2-digit" });

  return (
    <>
      <PageHeader title="Dashboard" description="Stock at a glance and what needs your attention this week." />

      {loadError ? (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Some data could not be loaded: {loadError.message}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          href="#stock"
          label="Below par"
          value={String(belowPar.length)}
          hint={belowPar.length === 1 ? "item" : "items"}
          tone={belowPar.length > 0 ? "danger" : "ok"}
        />
        <Tile
          href="/manager/inbox"
          label="Open submissions"
          value={String(openSubs.length)}
          hint="not resolved"
          tone={openSubs.length > 0 ? "warn" : "ok"}
        />
        <Tile
          href="/manager/inbox#requested"
          label="Requests at threshold"
          value={String(atThreshold.length)}
          hint={`${REQUEST_THRESHOLD}+ people asked`}
          tone="ok"
        />
        <Tile
          href="/manager/order"
          label="Next order"
          value={orderTile.value}
          hint={orderTile.hint}
          tone={orderTile.tone}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card id="stock" className="scroll-mt-20 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <CardTitle>Stock</CardTitle>
            <Link href="/manager/count" className={buttonClass("secondary", "sm")}>
              Count stock
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-muted">No active items yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <StockRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardTitle>Overstock</CardTitle>
            <p className="mt-1 text-xs text-muted">More than 2 weeks of stock at last week&apos;s usage.</p>
            {over.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nothing is overstocked.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {over.map(({ item, weeksOfStock, weekly: used }) => (
                  <li key={item.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted">
                        {item.current_qty} on hand
                        {used !== null ? ` · uses about ${formatQty(used)} a week` : ` · par ${item.par_level}`}
                      </p>
                    </div>
                    <Badge tone="warn" className="shrink-0">
                      {weeksOfStock !== null ? `${formatQty(weeksOfStock)} weeks` : "Over 2× par"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Free food</CardTitle>
              <Link href="/food" className="text-sm font-medium text-accent-strong hover:underline">
                Open board
              </Link>
            </div>
            {food.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No open posts right now.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {food.map((post) => (
                  <li key={post.id}>
                    <Link href="/food" className="block rounded-lg hover:bg-background">
                      <p className="text-sm font-medium">{post.description}</p>
                      <p className="text-xs text-muted">
                        {post.location ? `${post.location} · ` : ""}until {timeFmt.format(new Date(post.expires_at))}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardTitle>Friday summary</CardTitle>
        <p className="mb-3 mt-1 text-sm text-muted">
          Emailed every Friday morning: low-stock reports, requests, open maintenance and what is below par.
        </p>
        <SendSummaryButton />
      </Card>
    </>
  );
}

type Tone = "ok" | "warn" | "danger";

const toneText: Record<Tone, string> = { ok: "text-foreground", warn: "text-warn", danger: "text-danger" };
const toneBar: Record<Tone, string> = { ok: "bg-accent", warn: "bg-warn", danger: "bg-danger" };

function Tile({
  href,
  label,
  value,
  hint,
  tone,
}: {
  href: string;
  label: string;
  value: string;
  hint: string;
  tone: Tone;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-line bg-surface p-4 shadow-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${toneText[tone]}`}>{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </Link>
  );
}

function StockRow({ item }: { item: Item }) {
  const ratio = parRatio(item);
  const tone: Tone = ratio < 0.5 ? "danger" : ratio < 1 ? "warn" : "ok";
  const width = Number.isFinite(ratio) ? Math.max(Math.min(ratio, 1) * 100, item.current_qty > 0 ? 4 : 0) : 100;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium">
          {item.name}
          {item.unit ? <span className="ml-1.5 font-normal text-muted">{item.unit}</span> : null}
        </p>
        <p className={`shrink-0 text-sm tabular-nums ${toneText[tone]}`}>
          <span className="font-semibold">{item.current_qty}</span>
          <span className="text-muted"> / {item.par_level}</span>
        </p>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/5"
        role="img"
        aria-label={`${item.current_qty} of par ${item.par_level}`}
      >
        <div className={`h-full rounded-full ${toneBar[tone]}`} style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}

function formatQty(n: number): string {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}
