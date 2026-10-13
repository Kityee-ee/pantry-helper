import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, buttonClass, type BadgeTone } from "@/components/ui";
import {
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_TYPE_LABELS,
  type Submission,
  type SubmissionStatus,
} from "@/lib/types";
import { loadLiveReports } from "../data";
import { capitalise, others } from "../shared";

type Row = Pick<
  Submission,
  "id" | "type" | "status" | "item_id" | "requested_item_name" | "raw_text" | "detail" | "manager_note" | "created_at"
>;

const STATUS_TONES: Record<SubmissionStatus, BadgeTone> = {
  open: "neutral",
  acknowledged: "warn",
  resolved: "accent",
};

const dateFormat = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" });

export default async function MySubmissionsPage() {
  const profile = await requireUser();
  const supabase = await createClient();

  const [{ data, error }, { data: items }, live] = await Promise.all([
    supabase
      .from("submissions")
      .select("id, type, status, item_id, requested_item_name, raw_text, detail, manager_note, created_at")
      // RLS already limits employees to their own rows; managers would otherwise see everyone's here.
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("items").select("id, name"),
    loadLiveReports(profile.id),
  ]);

  const rows = (data ?? []) as Row[];
  const itemNames = new Map((items ?? []).map((i) => [i.id as string, i.name as string]));
  const groups = new Map(live.groups.map((g) => [g.key, g]));

  return (
    <>
      <PageHeader
        title="My requests"
        description="Everything you have sent and where it is up to."
        action={
          <Link href="/app" className={buttonClass("primary")}>
            Tell us something
          </Link>
        }
      />

      {error ? (
        <Card>
          <p className="text-sm text-danger">We could not load your requests. Try refreshing the page.</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nothing yet. When you report something it shows up here with its status.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const title =
              (row.item_id && itemNames.get(row.item_id)) ||
              (row.requested_item_name && capitalise(row.requested_item_name)) ||
              row.detail ||
              row.raw_text;
            const key =
              row.type === "low_stock" && row.item_id
                ? `low_stock:${row.item_id}`
                : row.type === "new_request" && row.requested_item_name
                  ? `new_request:${row.requested_item_name}`
                  : null;
            const group = row.status !== "resolved" && key ? groups.get(key) : undefined;

            return (
              <li key={row.id}>
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{SUBMISSION_TYPE_LABELS[row.type]}</Badge>
                    <Badge tone={STATUS_TONES[row.status]}>{SUBMISSION_STATUS_LABELS[row.status]}</Badge>
                    <span className="ml-auto text-xs text-muted">{dateFormat.format(new Date(row.created_at))}</span>
                  </div>
                  <p className="mt-2 font-medium">{title}</p>
                  {row.detail && row.detail !== title ? <p className="mt-1 text-sm">{row.detail}</p> : null}
                  <p className="mt-1 text-sm text-muted">You wrote: “{row.raw_text}”</p>
                  {group && group.others > 0 ? (
                    <p className="mt-2 text-sm text-accent-strong">
                      {row.type === "new_request"
                        ? `${group.others + 1} people want this.`
                        : `${others(group.others)} reported this too.`}
                    </p>
                  ) : null}
                  {row.manager_note ? (
                    <p className="mt-2 rounded-lg bg-background px-3 py-2 text-sm">
                      <span className="font-medium">Note from the office manager:</span> {row.manager_note}
                    </p>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
