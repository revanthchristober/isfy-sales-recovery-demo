alter table public.recoveries
  add constraint recoveries_one_per_lead unique (session_id, brand_id, lead_id);

create or replace function public.ingest_demo_cart_event(
  p_session_id uuid,
  p_brand_id uuid,
  p_event_id text,
  p_payload_hash text,
  p_cart_id text,
  p_customer_label text,
  p_amount_cents integer,
  p_is_eligible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_event public.received_events%rowtype;
  lead_row public.leads%rowtype;
  was_created boolean := false;
  result_status text;
begin
  if pg_catalog.length(coalesce(p_event_id, '')) not between 1 and 200
     or p_payload_hash !~ '^[a-f0-9]{64}$'
     or pg_catalog.length(coalesce(p_cart_id, '')) not between 1 and 160
     or pg_catalog.length(coalesce(p_customer_label, '')) not between 1 and 100
     or p_amount_cents < 0 or p_amount_cents > 10000000 then
    raise exception using errcode = '22023', message = 'Invalid cart event';
  end if;

  if not exists (
    select 1 from public.demo_sessions s
    join public.brands b on b.session_id = s.id
    where s.id = p_session_id and s.expires_at > pg_catalog.now() and b.id = p_brand_id
  ) then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  perform 1 from public.brands where id = p_brand_id and session_id = p_session_id for update;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_session_id::text || ':' || p_brand_id::text || ':event:' || p_event_id, 0
  ));

  select * into prior_event from public.received_events
  where session_id = p_session_id and brand_id = p_brand_id and event_id = p_event_id;

  if found then
    if prior_event.payload_hash = p_payload_hash then
      return pg_catalog.jsonb_build_object('status', 'replayed', 'leadId', prior_event.lead_id);
    end if;
    return pg_catalog.jsonb_build_object('status', 'event_conflict');
  end if;

  if (select pg_catalog.count(*) from public.received_events
      where session_id = p_session_id and brand_id = p_brand_id) >= 120 then
    return pg_catalog.jsonb_build_object('status', 'demo_limit');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_session_id::text || ':' || p_brand_id::text || ':cart:' || p_cart_id, 0
  ));

  if (select pg_catalog.count(*) from public.leads
      where session_id = p_session_id and brand_id = p_brand_id) >= 25
     and not exists (select 1 from public.leads
       where session_id = p_session_id and brand_id = p_brand_id and cart_id = p_cart_id) then
    return pg_catalog.jsonb_build_object('status', 'demo_limit');
  end if;

  insert into public.leads (
    session_id, brand_id, cart_id, customer_label, cart_amount_cents, is_eligible, status
  ) values (
    p_session_id, p_brand_id, p_cart_id, p_customer_label, p_amount_cents, p_is_eligible, 'new'
  ) on conflict (session_id, brand_id, cart_id) do nothing
  returning * into lead_row;

  if found then
    was_created := true;
    result_status := 'created';
  else
    select * into lead_row from public.leads
    where session_id = p_session_id and brand_id = p_brand_id and cart_id = p_cart_id;
    result_status := 'duplicate_cart';
  end if;

  insert into public.received_events (
    session_id, brand_id, event_id, payload_hash, event_type, lead_id
  ) values (p_session_id, p_brand_id, p_event_id, p_payload_hash, 'cart_abandoned', lead_row.id);

  insert into public.activity_history (
    session_id, brand_id, lead_id, actor_type, action, summary, details
  ) values (
    p_session_id, p_brand_id, lead_row.id, 'system',
    case when was_created then 'cart_received' else 'duplicate_cart_ignored' end,
    case when was_created then 'New cart added to the lead inbox.' else 'Duplicate cart ignored.' end,
    pg_catalog.jsonb_build_object('cartId', p_cart_id, 'eventId', p_event_id)
  );

  return pg_catalog.jsonb_build_object('status', result_status, 'leadId', lead_row.id);
end;
$$;

create or replace function public.claim_demo_lead(
  p_session_id uuid, p_brand_id uuid, p_lead_id uuid, p_rep_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead_row public.leads%rowtype;
begin
  if not exists (
    select 1 from public.demo_sessions s
    join public.brands b on b.session_id = s.id
    where s.id = p_session_id and s.expires_at > pg_catalog.now() and b.id = p_brand_id
  ) then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;

  select * into lead_row from public.leads
  where id = p_lead_id and session_id = p_session_id and brand_id = p_brand_id
  for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;

  if not exists (
    select 1 from public.reps
    where id = p_rep_id and session_id = p_session_id and brand_id = p_brand_id
  ) then return pg_catalog.jsonb_build_object('status', 'invalid_rep'); end if;

  if not lead_row.is_eligible or lead_row.status = 'suppressed' then
    return pg_catalog.jsonb_build_object('status', 'suppressed');
  end if;
  if lead_row.status <> 'new' then
    return pg_catalog.jsonb_build_object(
      'status', case when lead_row.assigned_rep_id = p_rep_id then 'claimed_by_you' else 'already_claimed' end,
      'repId', lead_row.assigned_rep_id
    );
  end if;

  update public.leads set status = 'claimed', assigned_rep_id = p_rep_id, updated_at = pg_catalog.now()
  where id = p_lead_id;
  insert into public.activity_history (
    session_id, brand_id, lead_id, actor_type, action, summary, details
  ) select p_session_id, p_brand_id, p_lead_id, 'rep', 'lead_claimed',
    'Lead claimed by ' || r.name || '.', pg_catalog.jsonb_build_object('repId', r.id)
    from public.reps r where r.id = p_rep_id;
  return pg_catalog.jsonb_build_object('status', 'claimed', 'repId', p_rep_id);
end;
$$;

create or replace function public.suppress_demo_lead(
  p_session_id uuid, p_brand_id uuid, p_lead_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead_row public.leads%rowtype;
begin
  if not exists (
    select 1 from public.demo_sessions s
    join public.brands b on b.session_id = s.id
    where s.id = p_session_id and s.expires_at > pg_catalog.now() and b.id = p_brand_id
  ) then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;

  select * into lead_row from public.leads
  where id = p_lead_id and session_id = p_session_id and brand_id = p_brand_id
  for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;

  if lead_row.status in ('suppressed', 'recovered') and not lead_row.is_eligible then
    return pg_catalog.jsonb_build_object('status', 'already_suppressed');
  end if;

  update public.leads set
    is_eligible = false,
    status = case when status = 'recovered' then 'recovered' else 'suppressed' end,
    assigned_rep_id = case when status = 'recovered' then assigned_rep_id else null end,
    updated_at = pg_catalog.now()
  where id = p_lead_id;
  insert into public.activity_history (
    session_id, brand_id, lead_id, actor_type, action, summary
  ) values (p_session_id, p_brand_id, p_lead_id, 'visitor', 'lead_suppressed',
    'Lead suppressed. No new contact or claim is allowed.');
  return pg_catalog.jsonb_build_object('status', 'suppressed');
end;
$$;

create or replace function public.ingest_demo_recovery_event(
  p_session_id uuid,
  p_brand_id uuid,
  p_event_id text,
  p_payload_hash text,
  p_lead_id uuid,
  p_order_id text,
  p_amount_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior_event public.received_events%rowtype;
  lead_row public.leads%rowtype;
  recovery_id uuid;
begin
  if pg_catalog.length(coalesce(p_event_id, '')) not between 1 and 200
     or p_payload_hash !~ '^[a-f0-9]{64}$'
     or pg_catalog.length(coalesce(p_order_id, '')) not between 1 and 200
     or p_amount_cents < 0 or p_amount_cents > 10000000 then
    raise exception using errcode = '22023', message = 'Invalid recovery event';
  end if;
  if not exists (
    select 1 from public.demo_sessions s
    join public.brands b on b.session_id = s.id
    where s.id = p_session_id and s.expires_at > pg_catalog.now() and b.id = p_brand_id
  ) then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;

  perform 1 from public.brands where id = p_brand_id and session_id = p_session_id for update;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_session_id::text || ':' || p_brand_id::text || ':event:' || p_event_id, 0
  ));
  select * into prior_event from public.received_events
  where session_id = p_session_id and brand_id = p_brand_id and event_id = p_event_id;
  if found then
    if prior_event.payload_hash = p_payload_hash then
      return pg_catalog.jsonb_build_object('status', 'replayed', 'leadId', prior_event.lead_id);
    end if;
    return pg_catalog.jsonb_build_object('status', 'event_conflict');
  end if;

  if (select pg_catalog.count(*) from public.received_events
      where session_id = p_session_id and brand_id = p_brand_id) >= 120 then
    return pg_catalog.jsonb_build_object('status', 'demo_limit');
  end if;

  select * into lead_row from public.leads
  where id = p_lead_id and session_id = p_session_id and brand_id = p_brand_id
  for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if not lead_row.is_eligible or lead_row.status = 'suppressed' then
    return pg_catalog.jsonb_build_object('status', 'suppressed');
  end if;
  if lead_row.status = 'new' then return pg_catalog.jsonb_build_object('status', 'not_claimed'); end if;
  if lead_row.status = 'recovered' then
    if exists (
      select 1 from public.recoveries
      where session_id = p_session_id and brand_id = p_brand_id and lead_id = p_lead_id
        and order_id = p_order_id and amount_cents = p_amount_cents
    ) then
      return pg_catalog.jsonb_build_object('status', 'duplicate_order');
    end if;
    return pg_catalog.jsonb_build_object('status', 'sale_conflict');
  end if;
  if p_amount_cents <> lead_row.cart_amount_cents then
    return pg_catalog.jsonb_build_object('status', 'amount_mismatch');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_session_id::text || ':' || p_brand_id::text || ':order:' || p_order_id, 0
  ));
  if exists (select 1 from public.recoveries
    where session_id = p_session_id and brand_id = p_brand_id and order_id = p_order_id) then
    return pg_catalog.jsonb_build_object('status', 'duplicate_order');
  end if;

  insert into public.received_events (
    session_id, brand_id, event_id, payload_hash, event_type, lead_id
  ) values (p_session_id, p_brand_id, p_event_id, p_payload_hash, 'order_recovered', p_lead_id);
  insert into public.recoveries (
    session_id, brand_id, lead_id, order_id, amount_cents
  ) values (p_session_id, p_brand_id, p_lead_id, p_order_id, p_amount_cents)
  returning id into recovery_id;
  update public.leads set status = 'recovered', updated_at = pg_catalog.now() where id = p_lead_id;
  insert into public.activity_history (
    session_id, brand_id, lead_id, actor_type, action, summary, details
  ) values (
    p_session_id, p_brand_id, p_lead_id, 'system', 'order_recovered',
    'Simulated sale recorded.', pg_catalog.jsonb_build_object('orderId', p_order_id, 'amountCents', p_amount_cents)
  );
  return pg_catalog.jsonb_build_object('status', 'recovered', 'recoveryId', recovery_id);
end;
$$;

revoke all on function public.ingest_demo_cart_event(uuid, uuid, text, text, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.claim_demo_lead(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.suppress_demo_lead(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.ingest_demo_recovery_event(uuid, uuid, text, text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ingest_demo_cart_event(uuid, uuid, text, text, text, text, integer, boolean) to service_role;
grant execute on function public.claim_demo_lead(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.suppress_demo_lead(uuid, uuid, uuid) to service_role;
grant execute on function public.ingest_demo_recovery_event(uuid, uuid, text, text, uuid, text, integer) to service_role;

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

  delete from public.demo_sessions where expires_at <= pg_catalog.now();
  insert into public.demo_sessions (id, token_hash) values (new_session_id, p_token_hash);
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
