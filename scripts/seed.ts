/**
 * Demo seed. Run with: npm run seed
 *
 * Idempotent and DESTRUCTIVE for demo data: it wipes every app table (not the
 * users, not storage) and re-creates the demo state relative to today, so the
 * demo works on any day. Uses the service role key from .env.local.
 *
 * Timeline it creates (W = Monday of the current week):
 *   W-10 (Fri)  baseline stock count, and a placed order for last week
 *   W-7  (Mon)  last week's delivery, in full
 *   W-3  (Fri)  stock count showing last week's real consumption (headcount 60),
 *               and the placed order for THIS week ("the order dated last Friday")
 *   W    (Mon)  this week's delivery, with Milk 2L short-delivered (6 of 12)
 * No order exists for next week: creating it is the demo.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { APP_TIME_ZONE, addDays, thisWeekStart } from "../src/lib/week";

const envPath = path.join(process.cwd(), ".env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "pantry123";
const USERS = [
  { key: "priya", email: "priya@pantry.demo", full_name: "Priya Sharma", role: "manager" },
  { key: "josh", email: "josh@pantry.demo", full_name: "Josh Miller", role: "employee" },
  { key: "mei", email: "mei@pantry.demo", full_name: "Mei Chen", role: "employee" },
  { key: "tom", email: "tom@pantry.demo", full_name: "Tom Walker", role: "employee" },
] as const;
type UserKey = (typeof USERS)[number]["key"];

// base  = counted two Fridays ago        delA = delivered last week's Monday
// count = counted last Friday            ordB = ordered last Friday for this week
// delB  = delivered this week's Monday   current_qty = count + delB
// Consumption last week = base + delA - count.
const ITEMS = [
  { name: "Milk 2L", unit: "bottle", par: 12, base: 3, delA: 12, count: 1, ordB: 12, delB: 6 }, // short-delivered
  { name: "Soy milk 1L", unit: "carton", par: 6, base: 2, delA: 6, count: 2, ordB: 6, delB: 6 },
  { name: "Instant coffee", unit: "500g tin", par: 3, base: 2, delA: 2, count: 1, ordB: 2, delB: 2 },
  { name: "Coffee beans", unit: "1kg bag", par: 4, base: 2, delA: 4, count: 1, ordB: 4, delB: 4 },
  { name: "Tea bags", unit: "box of 100", par: 2, base: 15, delA: 0, count: 14, ordB: 0, delB: 0 }, // overstocked: ~14 weeks
  { name: "Sugar", unit: "1kg bag", par: 2, base: 3, delA: 0, count: 2, ordB: 0, delB: 0 },
  { name: "Biscuits", unit: "pack", par: 10, base: 4, delA: 10, count: 2, ordB: 10, delB: 10 },
  { name: "Fruit box", unit: "box", par: 2, base: 0, delA: 2, count: 0, ordB: 2, delB: 2 },
  { name: "Muesli bars", unit: "box of 12", par: 4, base: 1, delA: 4, count: 1, ordB: 4, delB: 4 },
  { name: "Sparkling water", unit: "case of 24", par: 4, base: 2, delA: 4, count: 1, ordB: 4, delB: 4 },
  { name: "Honey", unit: "500g jar", par: 1, base: 1, delA: 0, count: 1, ordB: 0, delB: 0 },
  { name: "Paper towels", unit: "roll", par: 12, base: 10, delA: 6, count: 9, ordB: 6, delB: 6 },
  { name: "Dish soap", unit: "500ml bottle", par: 2, base: 2, delA: 0, count: 1, ordB: 1, delB: 1 },
  { name: "Dishwasher tablets", unit: "pack of 30", par: 2, base: 2, delA: 0, count: 1, ordB: 1, delB: 1 },
  { name: "Hand soap", unit: "500ml pump", par: 3, base: 3, delA: 0, count: 2, ordB: 0, delB: 0 },
  { name: "Bin liners", unit: "roll of 50", par: 2, base: 3, delA: 0, count: 3, ordB: 0, delB: 0 },
];

const HEADCOUNT = 60;

/** The instant at which it is `hour:minute` on `dateISO` in the app time zone. */
function at(dateISO: string, hour: number, minute = 0): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const instant = guess - (shown - guess);
  // Never seed anything in the future (e.g. running this on a Monday morning).
  return new Date(Math.min(instant, Date.now() - 60_000)).toISOString();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function check<R extends { data: unknown; error: { message: string } | null }>(
  label: string,
  res: R,
): NonNullable<Extract<R, { error: null }>["data"]> {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data as NonNullable<Extract<R, { error: null }>["data"]>;
}

async function ensureUsers(): Promise<Record<UserKey, string>> {
  const existing = check("list users", await db.auth.admin.listUsers({ page: 1, perPage: 1000 })).users;
  const ids = {} as Record<UserKey, string>;

  for (const u of USERS) {
    // role goes in app_metadata: only the service role can set it, and the
    // profile trigger in schema.sql trusts nothing else. Clients cannot edit it.
    const user_metadata = { full_name: u.full_name };
    const app_metadata = { role: u.role };
    const found = existing.find((e) => e.email?.toLowerCase() === u.email);
    if (found) {
      check(
        `update ${u.email}`,
        await db.auth.admin.updateUserById(found.id, {
          password: PASSWORD,
          email_confirm: true,
          user_metadata,
          app_metadata,
        }),
      );
      ids[u.key] = found.id;
    } else {
      const created = check(
        `create ${u.email}`,
        await db.auth.admin.createUser({
          email: u.email,
          password: PASSWORD,
          email_confirm: true,
          user_metadata,
          app_metadata,
        }),
      );
      ids[u.key] = created.user.id;
    }
  }

  // The auth trigger creates profiles; upsert anyway so re-runs repair role and name.
  check(
    "upsert profiles",
    await db
      .from("profiles")
      .upsert(USERS.map((u) => ({ id: ids[u.key], full_name: u.full_name, email: u.email, role: u.role }))),
  );
  return ids;
}

async function wipe() {
  // Children before parents.
  for (const table of [
    "notifications",
    "food_posts",
    "submissions",
    "stock_events",
    "deliveries",
    "order_lines",
    "orders",
    "items",
  ]) {
    check(`clear ${table}`, await db.from(table).delete().not("id", "is", null));
  }
  check("clear headcounts", await db.from("headcounts").delete().not("week_start", "is", null));
}

async function main() {
  const W = thisWeekStart();
  const lastWeek = addDays(W, -7);
  const baselineFriday = addDays(W, -10);
  const lastFriday = addDays(W, -3);
  console.log(`Seeding relative to week starting ${W} (${APP_TIME_ZONE})`);

  const users = await ensureUsers();
  console.log(`Users ready: ${USERS.map((u) => u.email).join(", ")} (password ${PASSWORD})`);

  await wipe();

  // Items
  const itemRows = check(
    "insert items",
    await db
      .from("items")
      .insert(
        ITEMS.map((i) => ({
          name: i.name,
          unit: i.unit,
          par_level: i.par,
          current_qty: i.count + i.delB,
          active: true,
          created_at: at(addDays(W, -60), 9),
        })),
      )
      .select("id, name"),
  ) as { id: string; name: string }[];
  const itemId = (name: string) => {
    const row = itemRows.find((r) => r.name === name);
    if (!row) throw new Error(`item not found: ${name}`);
    return row.id;
  };

  // Headcount: last week only.
  check("insert headcount", await db.from("headcounts").insert({ week_start: lastWeek, headcount: HEADCOUNT }));

  // Orders
  const orderAId = randomUUID(); // supplied last week, delivered in full
  const orderBId = randomUUID(); // placed last Friday for this week, milk short-delivered
  const orderALines = ITEMS.filter((i) => i.delA > 0);
  const orderBLines = ITEMS.filter((i) => i.ordB > 0);
  const listText = (lines: typeof ITEMS, qty: (i: (typeof ITEMS)[number]) => number) =>
    lines.map((i) => `- ${qty(i)} x ${i.name} (${i.unit})`).join("\n");

  check(
    "insert orders",
    await db.from("orders").insert([
      {
        id: orderAId,
        week_start: lastWeek,
        status: "placed",
        headcount: HEADCOUNT,
        ai_summary: "Standard weekly top-up to par for 60 people.",
        summary_text: `Pantry order for the week of ${lastWeek}\n\n${listText(orderALines, (i) => i.delA)}`,
        placed_at: at(baselineFriday, 16, 30),
        created_by: users.priya,
        created_at: at(baselineFriday, 16, 10),
      },
      {
        id: orderBId,
        week_start: W,
        status: "placed",
        headcount: HEADCOUNT,
        ai_summary:
          "Top-up to par for 60 people. Milk and biscuits went fastest last week. Tea bags skipped: about 14 weeks already on the shelf.",
        summary_text: `Pantry order for the week of ${W}\n\n${listText(orderBLines, (i) => i.ordB)}`,
        placed_at: at(lastFriday, 16, 30),
        created_by: users.priya,
        created_at: at(lastFriday, 16, 10),
      },
    ]),
  );

  check(
    "insert order lines",
    await db.from("order_lines").insert([
      ...orderALines.map((i) => ({
        order_id: orderAId,
        item_id: itemId(i.name),
        item_name: i.name,
        qty: i.delA,
        suggested_qty: i.delA,
        reason: "Top up to par",
        created_at: at(baselineFriday, 16, 10),
      })),
      ...orderBLines.map((i) => ({
        order_id: orderBId,
        item_id: itemId(i.name),
        item_name: i.name,
        qty: i.ordB,
        suggested_qty: i.ordB,
        reason: `Used ${i.base + i.delA - i.count} last week, ${i.count} left at Friday count`,
        created_at: at(lastFriday, 16, 10),
      })),
    ]),
  );

  // Deliveries. raw_extraction shape here is illustrative; the delivery lane owns the real shape.
  const deliveryAId = randomUUID();
  const deliveryBId = randomUUID();
  const deliveredB = ITEMS.filter((i) => i.delB > 0);
  check(
    "insert deliveries",
    await db.from("deliveries").insert([
      {
        id: deliveryAId,
        order_id: orderAId,
        photo_path: null,
        raw_extraction: {
          supplier: "Office Pantry Co",
          lines: orderALines.map((i) => ({ name: i.name, qty: i.delA })),
        },
        created_by: users.priya,
        created_at: at(lastWeek, 9, 30),
      },
      {
        id: deliveryBId,
        order_id: orderBId,
        photo_path: null,
        raw_extraction: {
          supplier: "Office Pantry Co",
          note: "Milk 2L: 6 supplied, 6 on back order",
          lines: deliveredB.map((i) => ({ name: i.name, qty: i.delB })),
        },
        created_by: users.priya,
        created_at: at(W, 9, 30),
      },
    ]),
  );

  // Stock events, oldest first per item.
  const events: Record<string, unknown>[] = [];
  for (const i of ITEMS) {
    const item_id = itemId(i.name);
    const common = { item_id, created_by: users.priya };
    events.push({ ...common, kind: "count", delta: 0, qty_after: i.base, created_at: at(baselineFriday, 16) });
    if (i.delA > 0) {
      events.push({
        ...common,
        kind: "delivery",
        delta: i.delA,
        qty_after: i.base + i.delA,
        delivery_id: deliveryAId,
        created_at: at(lastWeek, 9, 30),
      });
    }
    events.push({
      ...common,
      kind: "count",
      delta: i.count - (i.base + i.delA), // negative = consumed during last week
      qty_after: i.count,
      created_at: at(lastFriday, 16),
    });
    if (i.delB > 0) {
      events.push({
        ...common,
        kind: "delivery",
        delta: i.delB,
        qty_after: i.count + i.delB,
        delivery_id: deliveryBId,
        created_at: at(W, 9, 30),
      });
    }
  }
  check("insert stock events", await db.from("stock_events").insert(events));

  // Submissions. Oat milk is requested by Mei and Tom only, so Josh's request in the demo is the third.
  check(
    "insert submissions",
    await db.from("submissions").insert([
      {
        user_id: users.mei,
        batch_id: randomUUID(),
        type: "low_stock",
        item_id: itemId("Milk 2L"),
        raw_text: "We're nearly out of milk again, only a couple of bottles left in the fridge",
        detail: "Milk is running low",
        status: "open",
        created_at: hoursAgo(20),
      },
      {
        user_id: users.tom,
        batch_id: randomUUID(),
        type: "low_stock",
        item_id: itemId("Milk 2L"),
        raw_text: "Milk is running low in the level 3 kitchen",
        detail: "Milk is running low (level 3 kitchen)",
        status: "open",
        created_at: hoursAgo(3),
      },
      {
        user_id: users.josh,
        batch_id: randomUUID(),
        type: "maintenance",
        raw_text: "The dishwasher is leaking onto the kitchen floor",
        detail: "Dishwasher leaking onto the floor",
        status: "resolved",
        manager_note: "Plumber replaced the door seal. All fixed.",
        resolved_at: hoursAgo(96),
        created_at: hoursAgo(150),
      },
      {
        user_id: users.mei,
        batch_id: randomUUID(),
        type: "new_request",
        requested_item_name: "oat milk",
        raw_text: "Could we get oat milk for the coffee machine?",
        detail: "Requests oat milk",
        status: "open",
        created_at: hoursAgo(50),
      },
      {
        user_id: users.tom,
        batch_id: randomUUID(),
        type: "new_request",
        requested_item_name: "oat milk",
        raw_text: "Would be nice to have oat milk as a dairy-free option",
        detail: "Requests oat milk",
        status: "open",
        created_at: hoursAgo(26),
      },
    ]),
  );

  console.log(
    `Seeded ${ITEMS.length} items, 2 placed orders, 2 deliveries, ${events.length} stock events, 5 submissions, headcount ${HEADCOUNT} for ${lastWeek}.`,
  );
  console.log("No order exists for next week. Done.");
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  console.error("Have you run supabase/schema.sql in the Supabase SQL editor?");
  process.exit(1);
});
