create table public.demo_sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null default (pg_catalog.now() + interval '24 hours'),
  constraint demo_sessions_expiry_after_creation check (expires_at > created_at)
);

create index demo_sessions_expiry_idx on public.demo_sessions (expires_at);

create table public.brands (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{1,80}$'),
  name text not null check (pg_catalog.length(name) between 1 and 120),
  created_at timestamptz not null default pg_catalog.now(),
  unique (session_id, slug),
  unique (id, session_id)
);

create table public.reps (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  brand_id uuid not null,
  name text not null check (pg_catalog.length(name) between 1 and 100),
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (brand_id, session_id) references public.brands(id, session_id) on delete cascade,
  unique (id, session_id, brand_id)
);

create table public.leads (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  brand_id uuid not null,
  cart_id text not null check (pg_catalog.length(cart_id) between 1 and 160),
  customer_label text not null check (pg_catalog.length(customer_label) between 1 and 100),
  cart_amount_cents integer not null check (cart_amount_cents >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  is_eligible boolean not null default true,
  status text not null default 'new' check (status in ('new', 'claimed', 'suppressed', 'recovered')),
  assigned_rep_id uuid,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  foreign key (brand_id, session_id) references public.brands(id, session_id) on delete cascade,
  foreign key (assigned_rep_id, session_id, brand_id) references public.reps(id, session_id, brand_id),
  unique (session_id, brand_id, cart_id),
  unique (id, session_id, brand_id)
);

create index leads_session_brand_created_idx
  on public.leads (session_id, brand_id, created_at desc);

create table public.received_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  brand_id uuid not null,
  event_id text not null check (pg_catalog.length(event_id) between 1 and 200),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  event_type text not null check (event_type in ('cart_abandoned', 'order_recovered')),
  lead_id uuid,
  received_at timestamptz not null default pg_catalog.now(),
  foreign key (brand_id, session_id) references public.brands(id, session_id) on delete cascade,
  foreign key (lead_id, session_id, brand_id) references public.leads(id, session_id, brand_id),
  unique (session_id, brand_id, event_id)
);

create table public.recoveries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  brand_id uuid not null,
  lead_id uuid not null,
  order_id text not null check (pg_catalog.length(order_id) between 1 and 200),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  recovered_at timestamptz not null default pg_catalog.now(),
  foreign key (brand_id, session_id) references public.brands(id, session_id) on delete cascade,
  foreign key (lead_id, session_id, brand_id) references public.leads(id, session_id, brand_id),
  unique (session_id, brand_id, order_id)
);

create table public.activity_history (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.demo_sessions(id) on delete cascade,
  brand_id uuid not null,
  lead_id uuid,
  actor_type text not null check (actor_type in ('system', 'rep', 'visitor')),
  action text not null check (pg_catalog.length(action) between 1 and 80),
  summary text not null check (pg_catalog.length(summary) between 1 and 300),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (brand_id, session_id) references public.brands(id, session_id) on delete cascade,
  foreign key (lead_id, session_id, brand_id) references public.leads(id, session_id, brand_id)
);

create index activity_history_session_brand_created_idx
  on public.activity_history (session_id, brand_id, created_at desc);

create or replace function public.create_demo_session(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_session_id uuid := pg_catalog.gen_random_uuid();
  northstar_id uuid;
  sunday_table_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid demo session token hash';
  end if;

  insert into public.demo_sessions (id, token_hash)
  values (new_session_id, p_token_hash);

  insert into public.brands (session_id, slug, name)
  values (new_session_id, 'northstar-outfitters', 'Northstar Outfitters')
  returning id into northstar_id;

  insert into public.brands (session_id, slug, name)
  values (new_session_id, 'sunday-table', 'Sunday Table Co.')
  returning id into sunday_table_id;

  insert into public.reps (session_id, brand_id, name)
  values
    (new_session_id, northstar_id, 'Avery Cole'),
    (new_session_id, northstar_id, 'Sam Taylor'),
    (new_session_id, sunday_table_id, 'Jamie Quinn'),
    (new_session_id, sunday_table_id, 'Riley Park');

  return new_session_id;
end;
$$;

revoke all on function public.create_demo_session(text) from public, anon, authenticated;
grant execute on function public.create_demo_session(text) to service_role;

alter table public.demo_sessions enable row level security;
alter table public.brands enable row level security;
alter table public.reps enable row level security;
alter table public.leads enable row level security;
alter table public.received_events enable row level security;
alter table public.recoveries enable row level security;
alter table public.activity_history enable row level security;

revoke all on table
  public.demo_sessions,
  public.brands,
  public.reps,
  public.leads,
  public.received_events,
  public.recoveries,
  public.activity_history
from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.demo_sessions,
  public.brands,
  public.reps,
  public.leads,
  public.received_events,
  public.recoveries,
  public.activity_history
to service_role;

comment on table public.demo_sessions is 'Visitor sessions expire after 24 hours; token values are never stored, only SHA-256 hashes.';
comment on table public.brands is 'Fictional brands created separately for each visitor session.';
comment on table public.reps is 'Fictional sales reps, scoped to one brand and visitor session.';
comment on table public.leads is 'Synthetic abandoned carts. Monetary values are integer USD cents.';
comment on table public.received_events is 'Synthetic inbound events, deduplicated within one session and brand.';
comment on table public.recoveries is 'Synthetic recovered orders, deduplicated by order ID within one session and brand.';
comment on table public.activity_history is 'Short synthetic activity entries scoped to one session and brand.';
