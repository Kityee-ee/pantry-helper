import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { getLastWeekConsumption } from "@/lib/consumption";
import { createClient } from "@/lib/supabase/server";
import { formatDay, formatWeek, lastWeekStart, nextWeekStart } from "@/lib/week";
import { DraftEditor } from "./DraftEditor";
import { SuggestForm } from "./SuggestForm";
import { loadLastHeadcount, loadLines, loadPlacedOrders } from "./data";
import type { CatalogueOption, EditorLine } from "./shared";

const shortDate = (weekStart: string) => formatDay(weekStart).replace(/^\w+ /, ""); // "12 Oct"

async function loadPage() {
  const supabase = await createClient();
  const nextWeek = nextWeekStart();
  const lastWeek = lastWeekStart();

  const [lastHeadcount, nextHeadcountRes, draftRes, placed, itemsRes, consumption] = await Promise.all([
    loadLastHeadcount(supabase, lastWeek),
    supabase.from("headcounts").select("headcount").eq("week_start", nextWeek).maybeSingle(),
    supabase
      .from("orders")
      .select("id, week_start, headcount, ai_summary")
      .eq("week_start", nextWeek)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1),
    loadPlacedOrders(supabase, { limit: 6 }),
    supabase.from("items").select("id, name, unit, par_level, current_qty, active").order("name"),
    getLastWeekConsumption(),
  ]);
  if (nextHeadcountRes.error) throw new Error(nextHeadcountRes.error.message);
  if (draftRes.error) throw new Error(draftRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);

  const items = itemsRes.data ?? [];
  const catalogue: CatalogueOption[] = items
    .filter((i) => i.active)
    .map((i) => ({
      id: i.id as string,
      name: i.name as string,
      unit: (i.unit as string | null) ?? null,
      current_qty: i.current_qty as number,
      par_level: i.par_level as number,
      used_last_week: consumption.get(i.id as string)?.consumed ?? null,
    }));

  const draft = draftRes.data?.[0] ?? null;
  let lines: EditorLine[] = [];
  if (draft) {
    const itemById = new Map(items.map((i) => [i.id as string, i]));
    lines = (await loadLines(supabase, draft.id as string)).map((l) => {
      const item = l.item_id ? itemById.get(l.item_id) : undefined;
      return {
        ...l,
        unit: (item?.unit as string | null | undefined) ?? null,
        current_qty: (item?.current_qty as number | undefined) ?? null,
        par_level: (item?.par_level as number | undefined) ?? null,
        used_last_week: l.item_id ? (consumption.get(l.item_id)?.consumed ?? null) : null,
      };
    });
  }

  return {
    nextWeek,
    lastWeek,
    lastHeadcount,
    nextHeadcount: (nextHeadcountRes.data?.headcount as number | undefined) ?? null,
    draft,
    lines,
    catalogue,
    placed,
    lastOrder: placed.find((o) => o.week_start < nextWeek) ?? null,
    alreadyPlaced: placed.find((o) => o.week_start === nextWeek) ?? null,
  };
}

export default async function OrderPage() {
  await requireManager();

  let data: Awaited<ReturnType<typeof loadPage>>;
  try {
    data = await loadPage();
  } catch (e) {
    console.error("[order] page load failed:", e instanceof Error ? e.message : e);
    return (
      <>
        <PageHeader title="Order" description="Next week's order, sized to who will be in." />
        <Card>
          <p className="text-sm text-danger">The order could not be loaded. Reload the page to try again.</p>
        </Card>
      </>
    );
  }
  const { nextWeek, lastHeadcount, nextHeadcount, draft, lines, catalogue, placed, lastOrder, alreadyPlaced } = data;

  return (
    <>
      <PageHeader
        title="Order"
        description={`Next week's order (${formatWeek(nextWeek).toLowerCase()}), sized to who will be in.`}
      />

      <div className="grid gap-4">
        {alreadyPlaced ? (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-strong">
            An order for {formatWeek(nextWeek).toLowerCase()} has already been placed.{" "}
            <Link href={`/manager/order/${alreadyPlaced.id}`} className="font-medium underline underline-offset-2">
              View it
            </Link>
          </p>
        ) : null}

        <Card>
          <CardTitle>How many people next week?</CardTitle>
          <p className="mb-4 mt-1 text-sm text-muted">
            The order is scaled from what was actually used last week to the number of people expected in.
          </p>
          <SuggestForm
            lastHeadcount={lastHeadcount?.headcount ?? null}
            lastWeekLabel={lastHeadcount ? shortDate(lastHeadcount.week_start) : shortDate(data.lastWeek)}
            nextWeekLabel={shortDate(nextWeek)}
            defaultHeadcount={(draft?.headcount as number | null | undefined) ?? nextHeadcount ?? lastHeadcount?.headcount ?? null}
            hasDraft={Boolean(draft)}
          />
        </Card>

        {draft ? (
          <DraftEditor
            // Remount on the saved state, so local edits never drift from what is stored.
            key={`${draft.id}:${lines.map((l) => `${l.id}=${l.qty}`).join(",")}`}
            orderId={draft.id as string}
            summary={(draft.ai_summary as string | null) ?? null}
            headcount={(draft.headcount as number | null) ?? null}
            lastHeadcount={lastOrder?.headcount ?? lastHeadcount?.headcount ?? null}
            lastOrder={
              lastOrder ? { total_units: lastOrder.total_units, weekLabel: shortDate(lastOrder.week_start) } : null
            }
            initialLines={lines}
            catalogue={catalogue}
          />
        ) : (
          <Card>
            <p className="text-sm text-muted">
              No draft yet for {formatWeek(nextWeek).toLowerCase()}. Enter the headcount and tap Suggest order: each
              line comes with the reason behind it, and you can change anything before placing it.
            </p>
          </Card>
        )}

        <Card>
          <CardTitle>Recent orders</CardTitle>
          {placed.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No orders placed yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {placed.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/manager/order/${o.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-background"
                  >
                    <span>
                      <span className="font-medium">{formatWeek(o.week_start)}</span>
                      <span className="block text-xs text-muted">
                        {o.total_units} units · {o.line_count} items
                        {o.headcount != null ? ` · ${o.headcount} people` : ""}
                      </span>
                    </span>
                    <Badge tone="accent">Placed</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
