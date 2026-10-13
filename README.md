# Pantry Helper

An office pantry app with two roles.

- **Manager (Priya)** tracks stock, records deliveries from a docket photo, runs the weekly stock count, builds the weekly order and works an inbox of what the team has reported.
- **Employee (Josh)** tells the pantry team anything in free text (AI sorts it into low stock, new request, maintenance or other), posts and claims free food, and gets notifications in a bell.

## Stack

- Next.js 16 App Router, TypeScript, Tailwind 4 (`cacheComponents: true`)
- Supabase: auth, Postgres with row level security, storage, realtime
- Anthropic API for AI, Resend for email

> Next.js 16 differs from earlier versions. Read `AGENTS.md` and the guides in `node_modules/next/dist/docs/` before writing code. The points that matter here are summarised under [Conventions](#conventions-read-before-adding-a-page).

## Setup

1. `npm install`
2. Create a Supabase project.
3. In the Supabase SQL editor, paste and run all of `supabase/schema.sql`. It is idempotent, so re-run it whenever it changes.
4. Optional: in Supabase Authentication settings, turn off public sign-ups. The app has no sign-up page. A sign-up through the API always becomes an employee, because the manager role is only read from `app_metadata`, which only the service role can set (the seed does).
5. Copy `.env.example` to `.env.local` and fill it in.
6. `npm run seed` creates the demo users and demo data. Re-running it **wipes all app data** and re-creates the demo state relative to today.
7. `npm run dev` and open http://localhost:3000.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (browser and server) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, bypasses RLS (admin client, seed) |
| `ANTHROPIC_API_KEY` | AI calls. Optional `AI_MODEL` overrides the model |
| `RESEND_API_KEY`, `RESEND_FROM`, `MANAGER_EMAIL` | Manager emails. Without `RESEND_API_KEY` emails are skipped, not errors |
| `CRON_SECRET` | Shared secret for scheduled route handlers |
| `NEXT_PUBLIC_APP_URL` | Base URL for links in emails |
| `APP_TIME_ZONE` (optional) | Time zone that decides "this week". Default `Australia/Sydney` |

## Demo accounts

Password for all: `pantry123`. The login page has one-tap buttons for each.

| Email | Name | Role |
| --- | --- | --- |
| priya@pantry.demo | Priya Sharma | manager |
| josh@pantry.demo | Josh Miller | employee |
| mei@pantry.demo | Mei Chen | employee |
| tom@pantry.demo | Tom Walker | employee |

Seeded story (W = Monday of the current week): a baseline count and a placed order two Fridays ago; a full delivery last week's Monday; headcount 60 for last week; a count last Friday showing last week's consumption; a placed order last Friday for this week. **This week's delivery is not seeded**: uploading its docket and reconciling it against that order is the demo, and `npm run seed` ends by printing the expected docket (Milk 2L short at 6 of 12). Stock levels are as of last Friday's count. Tea bags are heavily overstocked. Two open low-stock reports for milk (Mei, Tom), one resolved maintenance report (Josh), and `oat milk` requested by Mei and Tom, so Josh's request is the third. There is no delivery for this week and no order for next week.

## Route map

| Route | Who | File |
| --- | --- | --- |
| `/` | redirects to `/manager`, `/app` or `/login` | `src/app/page.tsx` |
| `/login` | public | `src/app/login/` |
| `/app` | signed in (employee home, "Tell us") | `src/app/(shell)/app/page.tsx` |
| `/app/submissions` | signed in | `src/app/(shell)/app/submissions/page.tsx` |
| `/food` | both roles | `src/app/(shell)/food/page.tsx` |
| `/manager` | manager (dashboard) | `src/app/(shell)/manager/page.tsx` |
| `/manager/delivery` | manager | `src/app/(shell)/manager/delivery/page.tsx` |
| `/manager/inbox` | manager | `src/app/(shell)/manager/inbox/page.tsx` |
| `/manager/count` | manager | `src/app/(shell)/manager/count/page.tsx` |
| `/manager/order` | manager | `src/app/(shell)/manager/order/page.tsx` |
| `/manager/order/[id]` | manager | `src/app/(shell)/manager/order/[id]/page.tsx` |

`(shell)` is a route group: it adds the shared app shell and does not appear in the URL. An employee who opens a `/manager` route is redirected to `/app`. Signed-out visitors are redirected to `/login`.

Navigation lives in one place, `src/components/shell/nav.ts`.

## Shared helpers

| File | Exports | Notes |
| --- | --- | --- |
| `src/lib/auth.ts` | `getSessionProfile()`, `requireUser()`, `requireManager()`, `homeFor(role)` | Server only. `require*` return the `Profile` or redirect. First line of every page, server action and route handler |
| `src/lib/supabase/server.ts` | `createClient()` (async) | Cookie-based, runs as the signed-in user, RLS applies |
| `src/lib/supabase/client.ts` | `createClient()` | Browser client: realtime, storage uploads, light reads |
| `src/lib/supabase/admin.ts` | `createAdminClient()` | Service role, bypasses RLS, server only. Authorise the caller first |
| `src/lib/types.ts` | Row types (`Profile`, `Item`, `Order`, `OrderLine`, `Delivery`, `StockEvent`, `Submission`, `Headcount`, `FoodPost`, `Notification`), enums, label maps, `STORAGE_BUCKETS` | Mirrors `supabase/schema.sql` |
| `src/lib/notify.ts` | `notify(userIds, n)`, `notifyManagers(n)`, `notifyAllExcept(userId, n)` | `n = { title, body?, link? }`. Never throws. Feeds the bell |
| `src/lib/email.ts` | `sendManagerEmail({ subject, html })` | Never throws. Returns `{ ok, ... }`. Skips when `RESEND_API_KEY` is missing |
| `src/lib/ai/client.ts` | `anthropic`, `AI_MODEL`, `aiEnabled` | Server only. No prompts here |
| `src/lib/categorise.ts` | `categoriseByRules(text)` | Pure keyword fallback for when the AI call fails |
| `src/lib/week.ts` | `thisWeekStart()`, `lastWeekStart()`, `nextWeekStart()`, `weekStartOf()`, `addDays()`, `todayISO()`, `formatWeek()`, `formatDay()` | `week_start` is always a Monday as `"YYYY-MM-DD"` |
| `src/components/ui` | `Button`, `buttonClass`, `Card`, `CardTitle`, `Badge`, `PageHeader` | Shared look |
| `src/app/globals.css` | Colour tokens | `bg-accent`, `text-accent-fg`, `bg-accent-soft`, `text-accent-strong`, `bg-surface`, `bg-background`, `text-muted`, `border-line`, `danger`, `warn` |
| `src/app/login/actions.ts` | `signIn`, `signOut` | Server actions |
| `src/proxy.ts` | `proxy` | Session cookie refresh and optimistic redirects |

## Conventions (read before adding a page)

**1. Middleware is now `proxy`.** The file is `src/proxy.ts` and exports `proxy`. Do not add a `middleware.ts`.

**2. Per-user data must render inside `<Suspense>`.** With `cacheComponents: true`, reading cookies (which every Supabase server call does) outside a Suspense boundary fails the build. There is no `export const dynamic = "force-dynamic"`. The shell layout already wraps `{children}` in a boundary, so a page under `src/app/(shell)/` can be this simple (copy `src/app/(shell)/manager/page.tsx`):

```tsx
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  await requireManager(); // or requireUser()
  const supabase = await createClient();
  const { data } = await supabase.from("items").select("*").order("name");
  return <>...</>;
}
```

A layout must stay synchronous: put session reads in an async child component inside a boundary, as `src/app/(shell)/layout.tsx` does. Add your own inner `<Suspense>` boundaries when part of a page is slow.

**3. `new Date()`, `Date.now()` and `Math.random()` in a Server Component** are only allowed after a request-time read. Call `await requireUser()` first, then use the `week.ts` helpers.

**4. `params` and `searchParams` are Promises.** `const { id } = await params`. Type pages with the global `PageProps<"/manager/order/[id]">`.

**5. Guard every server action and route handler.** Layout guards do not protect them, and layouts do not re-run on client navigation.

```ts
"use server";
import { refresh } from "next/cache";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function resolveSubmission(id: string) {
  const me = await requireManager();
  const supabase = await createClient();
  const { error } = await supabase
    .from("submissions")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  refresh(); // re-render the current page with fresh data
  return { error: null };
}
```

Nothing here uses `"use cache"`, so there are no tags to invalidate: call `refresh()` from `next/cache` at the end of an action (it only works inside server actions). `redirect()` throws, so keep it outside `try/catch`.

**6. RLS is the real boundary.** The cookie client runs as the user. Employees can read `items`, `profiles` and `food_posts`, read and create their own `submissions`, create and claim `food_posts`, and read and mark their own `notifications`. They have no access to `orders`, `order_lines`, `deliveries`, `stock_events` or `headcounts`. Anything an employee action must do beyond that (count other people's requests for the same item, notify other users) goes through `createAdminClient()` after `requireUser()`.

**7. Claiming free food** is one atomic update, safe against two people tapping at once. The database stamps `claimed_by` and `claimed_at` itself:

```ts
const { data } = await supabase
  .from("food_posts")
  .update({ claimed_by: me.id })
  .eq("id", postId)
  .is("claimed_by", null)
  .select()
  .maybeSingle(); // null means someone else got there first, or it expired
```

**8. Embedding profiles on `food_posts`** needs the foreign key named, because there are two: `select("*, poster:profiles!food_posts_user_id_fkey(full_name), claimer:profiles!food_posts_claimed_by_fkey(full_name)")`.

**9. Storage.** `dockets` is private and manager only: read with `createSignedUrl`. `food` is public: any signed-in user can upload, show with `getPublicUrl`. Store the object path in `photo_path`.

## Scripts

- `npm run dev`, `npm run build`, `npm run start`
- `npm run lint`
- `npm run seed`
