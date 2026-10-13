-- Pantry Helper schema.
-- Idempotent: paste the whole file into the Supabase SQL editor and run it. Safe to re-run.
-- Row types live in src/lib/types.ts. Keep the two in sync.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'employee' check (role in ('manager', 'employee')),
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text,
  par_level int not null default 0,
  current_qty int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  status text not null default 'draft' check (status in ('draft', 'placed')),
  headcount int,
  ai_summary text,
  summary_text text,
  placed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  item_name text not null,
  qty int not null default 0,
  suggested_qty int,
  reason text,
  is_new boolean not null default false,
  waste_risk boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  photo_path text,
  order_id uuid references public.orders (id) on delete set null,
  raw_extraction jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  kind text not null check (kind in ('delivery', 'count', 'adjustment')),
  delta int not null default 0,
  qty_after int not null,
  delivery_id uuid references public.deliveries (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  batch_id uuid,
  type text not null check (type in ('low_stock', 'new_request', 'maintenance', 'other')),
  item_id uuid references public.items (id) on delete set null,
  requested_item_name text, -- canonical lower-case name, groups new_request submissions
  raw_text text not null,
  detail text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  manager_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.headcounts (
  week_start date primary key,
  headcount int not null
);

create table if not exists public.food_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  description text not null,
  location text,
  photo_path text,
  expires_at timestamptz not null,
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists order_lines_order_id_idx on public.order_lines (order_id);
create index if not exists orders_week_start_idx on public.orders (week_start);
create index if not exists stock_events_item_created_idx on public.stock_events (item_id, created_at desc);
create index if not exists submissions_user_id_idx on public.submissions (user_id, created_at desc);
create index if not exists submissions_status_idx on public.submissions (status, created_at desc);
create index if not exists submissions_requested_item_idx on public.submissions (requested_item_name)
  where requested_item_name is not null;
create index if not exists food_posts_expires_idx on public.food_posts (expires_at);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Functions and triggers
-- ---------------------------------------------------------------------------

-- True when the calling user is a manager. Security definer so it can read
-- profiles without recursing into the profiles RLS policies.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'manager'
  );
$$;

revoke all on function public.is_manager() from public;
grant execute on function public.is_manager() to authenticated, service_role;

-- Create a profile whenever an auth user is created.
-- full_name comes from the sign-up metadata (raw_user_meta_data), which the client controls.
-- role does NOT: it is read from raw_app_meta_data, which only the service role / admin API
-- can set (scripts/seed.ts does). A public sign-up therefore always becomes an employee.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    case when new.raw_app_meta_data ->> 'role' = 'manager' then 'manager' else 'employee' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Employees may update a food post only to claim it. RLS (below) restricts WHICH
-- rows they can update; this trigger restricts WHAT they can change.
-- Managers and the service role (auth.uid() is null) are not restricted.
create or replace function public.food_posts_guard_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_manager() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.description is distinct from old.description
     or new.location is distinct from old.location
     or new.photo_path is distinct from old.photo_path
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Only claiming is allowed on a food post';
  end if;

  new.claimed_by := auth.uid();
  new.claimed_at := now();
  return new;
end;
$$;

drop trigger if exists food_posts_guard_claim on public.food_posts;
create trigger food_posts_guard_claim
  before update on public.food_posts
  for each row execute function public.food_posts_guard_claim();

-- ---------------------------------------------------------------------------
-- Grants (RLS below decides which rows; these only expose the tables to the API roles)
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on
  public.profiles, public.items, public.orders, public.order_lines, public.deliveries,
  public.stock_events, public.submissions, public.headcounts, public.food_posts, public.notifications
  to authenticated;
grant all on
  public.profiles, public.items, public.orders, public.order_lines, public.deliveries,
  public.stock_events, public.submissions, public.headcounts, public.food_posts, public.notifications
  to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- Managers: everything. Employees: only what is listed. anon: nothing.
-- The service role (src/lib/supabase/admin.ts, scripts/seed.ts) bypasses RLS.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.deliveries enable row level security;
alter table public.stock_events enable row level security;
alter table public.submissions enable row level security;
alter table public.headcounts enable row level security;
alter table public.food_posts enable row level security;
alter table public.notifications enable row level security;

-- Managers can do everything, on every table.
drop policy if exists "managers all" on public.profiles;
create policy "managers all" on public.profiles for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.items;
create policy "managers all" on public.items for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.orders;
create policy "managers all" on public.orders for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.order_lines;
create policy "managers all" on public.order_lines for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.deliveries;
create policy "managers all" on public.deliveries for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.stock_events;
create policy "managers all" on public.stock_events for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.submissions;
create policy "managers all" on public.submissions for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.headcounts;
create policy "managers all" on public.headcounts for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.food_posts;
create policy "managers all" on public.food_posts for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers all" on public.notifications;
create policy "managers all" on public.notifications for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- profiles: everyone signed in can read (names for "claimed by").
drop policy if exists "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable by signed-in users" on public.profiles for select to authenticated
  using (true);

-- items: everyone signed in can read (id and name for display).
drop policy if exists "items readable by signed-in users" on public.items;
create policy "items readable by signed-in users" on public.items for select to authenticated
  using (true);

-- submissions: employees read and create their own (always open, no manager note). No update or delete.
drop policy if exists "submissions select own" on public.submissions;
create policy "submissions select own" on public.submissions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "submissions insert own" on public.submissions;
create policy "submissions insert own" on public.submissions for insert to authenticated
  with check (user_id = auth.uid() and status = 'open' and manager_note is null and resolved_at is null);

-- food_posts: everyone reads all, creates their own, and may claim an unclaimed, unexpired post.
drop policy if exists "food_posts readable by signed-in users" on public.food_posts;
create policy "food_posts readable by signed-in users" on public.food_posts for select to authenticated
  using (true);

drop policy if exists "food_posts insert own" on public.food_posts;
create policy "food_posts insert own" on public.food_posts for insert to authenticated
  with check (user_id = auth.uid() and claimed_by is null and claimed_at is null);

drop policy if exists "food_posts claim" on public.food_posts;
create policy "food_posts claim" on public.food_posts for update to authenticated
  using (claimed_by is null and expires_at > now())
  with check (claimed_by = auth.uid());

-- notifications: read and update (mark as read) your own. Rows are created by the service role.
drop policy if exists "notifications select own" on public.notifications;
create policy "notifications select own" on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- orders, order_lines, deliveries, stock_events, headcounts: no employee policies, so no access.

-- ---------------------------------------------------------------------------
-- Storage: `dockets` (private, managers only) and `food` (public read)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('dockets', 'dockets', false), ('food', 'food', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "dockets managers all" on storage.objects;
create policy "dockets managers all" on storage.objects for all to authenticated
  using (bucket_id = 'dockets' and public.is_manager())
  with check (bucket_id = 'dockets' and public.is_manager());

drop policy if exists "food read" on storage.objects;
create policy "food read" on storage.objects for select to authenticated
  using (bucket_id = 'food');

drop policy if exists "food upload" on storage.objects;
create policy "food upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'food');

drop policy if exists "food delete own or manager" on storage.objects;
create policy "food delete own or manager" on storage.objects for delete to authenticated
  using (bucket_id = 'food' and (owner_id = auth.uid()::text or public.is_manager()));

-- ---------------------------------------------------------------------------
-- Realtime: live bell and live food board
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'food_posts'
    ) then
      alter publication supabase_realtime add table public.food_posts;
    end if;
  end if;
end
$$;
