import type { ReactNode } from "react";
import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, CardTitle, PageHeader, type BadgeTone } from "@/components/ui";
import {
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_TYPES,
  SUBMISSION_TYPE_LABELS,
  type Submission,
  type SubmissionStatus,
  type SubmissionType,
} from "@/lib/types";
import { APP_TIME_ZONE } from "@/lib/week";
import { REQUEST_THRESHOLD, groupRequests, type RequestRow } from "../stock-math";
import { SubmissionActions } from "./SubmissionActions";

type StatusFilter = "active" | "all" | SubmissionStatus;
type TypeFilter = "all" | SubmissionType;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Not resolved" },
  ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: SUBMISSION_STATUS_LABELS[s] })),
  { value: "all", label: "All" },
];
const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All types" },
  ...SUBMISSION_TYPES.map((t) => ({ value: t, label: SUBMISSION_TYPE_LABELS[t] })),
];

const typeTone: Record<SubmissionType, BadgeTone> = {
  low_stock: "danger",
  new_request: "accent",
  maintenance: "warn",
  other: "neutral",
};
const statusTone: Record<SubmissionStatus, BadgeTone> = {
  open: "warn",
  acknowledged: "accent",
  resolved: "neutral",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hrefFor(type: TypeFilter, status: StatusFilter): string {
  const q = new URLSearchParams();
  if (type !== "all") q.set("type", type);
  if (status !== "active") q.set("status", status);
  const s = q.toString();
  return s ? `/manager/inbox?${s}` : "/manager/inbox";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireManager();
  const sp = await searchParams;

  const typeParam = first(sp.type);
  const statusParam = first(sp.status);
  const type: TypeFilter = SUBMISSION_TYPES.includes(typeParam as SubmissionType) ? (typeParam as SubmissionType) : "all";
  const status: StatusFilter =
    statusParam === "all" || SUBMISSION_STATUSES.includes(statusParam as SubmissionStatus)
      ? (statusParam as StatusFilter)
      : "active";

  const supabase = await createClient();

  let listQuery = supabase.from("submissions").select("*").order("created_at", { ascending: false }).limit(200);
  if (type !== "all") listQuery = listQuery.eq("type", type);
  if (status === "active") listQuery = listQuery.neq("status", "resolved");
  else if (status !== "all") listQuery = listQuery.eq("status", status);

  const [listRes, requestsRes, profilesRes, itemsRes] = await Promise.all([
    listQuery,
    supabase
      .from("submissions")
      .select("id, user_id, type, requested_item_name, raw_text, created_at")
      .eq("type", "new_request")
      .neq("status", "resolved")
      .order("created_at"),
    supabase.from("profiles").select("id, full_name, email"),
    supabase.from("items").select("id, name"),
  ]);

  const loadError = [listRes, requestsRes, profilesRes, itemsRes].find((r) => r.error)?.error;

  const submissions = (listRes.data ?? []) as Submission[];
  const groups = groupRequests((requestsRes.data ?? []) as RequestRow[]);
  const names = new Map(
    ((profilesRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [
      p.id,
      p.full_name || p.email || "Someone",
    ]),
  );
  const itemNames = new Map(((itemsRes.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]));
  const nameOf = (userId: string) => names.get(userId) ?? "Someone";

  const timeFmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <>
      <PageHeader title="Inbox" description="What the team has told you, grouped and ready to action." />

      {loadError ? (
        <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Some data could not be loaded: {loadError.message}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <section className="lg:col-span-2" aria-label="Submissions">
          <div className="mb-3 space-y-2">
            <FilterRow label="Status">
              {STATUS_FILTERS.map((f) => (
                <Chip key={f.value} href={hrefFor(type, f.value)} active={status === f.value}>
                  {f.label}
                </Chip>
              ))}
            </FilterRow>
            <FilterRow label="Type">
              {TYPE_FILTERS.map((f) => (
                <Chip key={f.value} href={hrefFor(f.value, status)} active={type === f.value}>
                  {f.label}
                </Chip>
              ))}
            </FilterRow>
          </div>

          {submissions.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">
                {status === "active" && type === "all" ? "All caught up. Nothing is waiting on you." : "Nothing matches these filters."}
              </p>
            </Card>
          ) : (
            <ul className="space-y-3">
              {submissions.map((s) => {
                const itemName = s.item_id ? itemNames.get(s.item_id) : undefined;
                const subject = itemName ?? (s.type === "new_request" ? s.requested_item_name : null);
                return (
                  <li key={s.id}>
                    <Card>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={typeTone[s.type]}>{SUBMISSION_TYPE_LABELS[s.type]}</Badge>
                        {subject ? <span className="text-sm font-semibold">{subject}</span> : null}
                        <Badge tone={statusTone[s.status]} className="ml-auto">
                          {SUBMISSION_STATUS_LABELS[s.status]}
                        </Badge>
                      </div>
                      {s.detail ? <p className="mt-2 text-sm">{s.detail}</p> : null}
                      <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm text-muted">
                        &ldquo;{s.raw_text}&rdquo;
                      </blockquote>
                      <p className="mt-2 text-xs text-muted">
                        {nameOf(s.user_id)} · {timeFmt.format(new Date(s.created_at))}
                      </p>
                      {s.manager_note ? (
                        <p className="mt-2 rounded-lg bg-background px-3 py-2 text-sm">
                          <span className="font-medium">Your note:</span> {s.manager_note}
                        </p>
                      ) : null}
                      <SubmissionActions id={s.id} status={s.status} />
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Card id="requested" className="scroll-mt-20">
          <CardTitle>Requested items</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Open requests by item. At {REQUEST_THRESHOLD} or more people, an item is suggested on the next order.
          </p>
          {groups.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No open requests.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {groups.map((g) => (
                <li key={g.name} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold capitalize">{g.name}</p>
                    <span className="shrink-0 text-xs text-muted">
                      {g.requesterIds.length} {g.requesterIds.length === 1 ? "person" : "people"}
                    </span>
                  </div>
                  {g.atThreshold ? (
                    <Badge tone="accent" className="mt-1">
                      Will be suggested on the next order
                    </Badge>
                  ) : null}
                  <ul className="mt-2 space-y-1">
                    {g.submissions.map((s) => (
                      <li key={s.id} className="text-xs text-muted">
                        <span className="font-medium text-foreground">{nameOf(s.user_id)}:</span> &ldquo;{s.raw_text}
                        &rdquo;
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs font-medium text-muted">{label}</span>
      <div className="-mr-4 flex gap-2 overflow-x-auto pb-1 pr-4">{children}</div>
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-sm font-medium transition-colors ${
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-line bg-surface text-foreground hover:bg-background"
      }`}
    >
      {children}
    </Link>
  );
}
