-- Push notification subscriptions (anonymous devices)
-- endpoint is the unique per-browser-install identifier from the Web Push API
create table if not exists push_subscriptions (
  id              bigint generated always as identity primary key,
  endpoint        text    not null unique,
  p256dh          text    not null,
  auth            text    not null,
  route_short_names text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Let service-role bypass RLS for server-side writes; anon key cannot write
alter table push_subscriptions enable row level security;

-- Service role (used by server) can do everything
create policy "service full access"
  on push_subscriptions
  for all
  to service_role
  using (true)
  with check (true);
