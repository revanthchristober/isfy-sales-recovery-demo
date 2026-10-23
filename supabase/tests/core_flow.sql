do $$
declare
  v_session_id uuid;
  v_other_session_id uuid;
  v_brand_id uuid;
  v_other_brand_id uuid;
  v_second_lead_id uuid;
  v_rep_one uuid;
  v_rep_two uuid;
  v_lead_id uuid;
  v_result jsonb;
  recovery_count integer;
  revenue_cents integer;
begin
  v_session_id := public.create_demo_session(pg_catalog.md5(pg_catalog.random()::text) || pg_catalog.md5(pg_catalog.random()::text));
  select id into v_brand_id from public.brands b where b.session_id = v_session_id order by b.slug limit 1;
  select id into v_other_brand_id from public.brands b where b.session_id = v_session_id and b.id <> v_brand_id limit 1;
  select id into v_rep_one from public.reps r where r.session_id = v_session_id and r.brand_id = v_brand_id order by r.name limit 1;
  select id into v_rep_two from public.reps r where r.session_id = v_session_id and r.brand_id = v_brand_id order by r.name offset 1 limit 1;
  v_other_session_id := public.create_demo_session(pg_catalog.md5(pg_catalog.random()::text) || pg_catalog.md5(pg_catalog.random()::text));

  v_result := public.ingest_demo_cart_event(v_session_id, v_brand_id, 'event-cart-1', pg_catalog.repeat('a', 64), 'cart-1', 'Morgan Lee', 12800, true);
  if v_result->>'status' <> 'created' then raise exception 'expected created cart: %', v_result; end if;
  v_lead_id := (v_result->>'leadId')::uuid;

  v_result := public.ingest_demo_cart_event(v_session_id, v_brand_id, 'event-cart-1', pg_catalog.repeat('a', 64), 'cart-1', 'Morgan Lee', 12800, true);
  if v_result->>'status' <> 'replayed' then raise exception 'expected replay: %', v_result; end if;
  v_result := public.ingest_demo_cart_event(v_session_id, v_brand_id, 'event-cart-1', pg_catalog.repeat('b', 64), 'cart-1', 'Morgan Lee', 12800, true);
  if v_result->>'status' <> 'event_conflict' then raise exception 'expected changed-payload conflict: %', v_result; end if;
  v_result := public.ingest_demo_cart_event(v_session_id, v_brand_id, 'event-cart-2', pg_catalog.repeat('c', 64), 'cart-1', 'Morgan Lee', 12800, true);
  if v_result->>'status' <> 'duplicate_cart' then raise exception 'expected duplicate cart: %', v_result; end if;

  v_result := public.claim_demo_lead(v_session_id, v_brand_id, v_lead_id, v_rep_one);
  if v_result->>'status' <> 'claimed' then raise exception 'expected claim: %', v_result; end if;
  v_result := public.claim_demo_lead(v_session_id, v_brand_id, v_lead_id, v_rep_one);
  if v_result->>'status' <> 'claimed_by_you' then raise exception 'expected same-rep retry: %', v_result; end if;
  v_result := public.claim_demo_lead(v_session_id, v_brand_id, v_lead_id, v_rep_two);
  if v_result->>'status' <> 'already_claimed' then raise exception 'expected competing claim loss: %', v_result; end if;

  v_result := public.ingest_demo_recovery_event(v_session_id, v_brand_id, 'event-order-1', pg_catalog.repeat('d', 64), v_lead_id, 'order-1', 12800);
  if v_result->>'status' <> 'recovered' then raise exception 'expected recovery: %', v_result; end if;
  v_result := public.ingest_demo_recovery_event(v_session_id, v_brand_id, 'event-order-1', pg_catalog.repeat('d', 64), v_lead_id, 'order-1', 12800);
  if v_result->>'status' <> 'replayed' then raise exception 'expected recovery replay: %', v_result; end if;
  v_result := public.ingest_demo_recovery_event(v_session_id, v_brand_id, 'event-order-2', pg_catalog.repeat('e', 64), v_lead_id, 'order-1', 12800);
  if v_result->>'status' <> 'duplicate_order' then raise exception 'expected duplicate order: %', v_result; end if;
  v_result := public.ingest_demo_recovery_event(v_session_id, v_brand_id, 'event-order-3', pg_catalog.repeat('f', 64), v_lead_id, 'order-2', 12800);
  if v_result->>'status' <> 'sale_conflict' then raise exception 'expected different sale conflict: %', v_result; end if;

  v_result := public.claim_demo_lead(v_session_id, v_other_brand_id, v_lead_id, v_rep_one);
  if v_result->>'status' <> 'not_found' then raise exception 'expected brand boundary: %', v_result; end if;
  v_result := public.claim_demo_lead(v_other_session_id, v_brand_id, v_lead_id, v_rep_one);
  if v_result->>'status' <> 'not_found' then raise exception 'expected session boundary: %', v_result; end if;

  v_result := public.suppress_demo_lead(v_session_id, v_brand_id, v_lead_id);
  if v_result->>'status' <> 'suppressed' then raise exception 'expected suppression: %', v_result; end if;
  v_result := public.suppress_demo_lead(v_session_id, v_brand_id, v_lead_id);
  if v_result->>'status' <> 'already_suppressed' then raise exception 'expected suppression replay: %', v_result; end if;
  v_result := public.ingest_demo_recovery_event(v_session_id, v_brand_id, 'event-order-4', pg_catalog.repeat('1', 64), v_lead_id, 'order-3', 12800);
  if v_result->>'status' <> 'suppressed' then raise exception 'expected suppressed sale rejection: %', v_result; end if;

  v_result := public.ingest_demo_cart_event(v_session_id, v_brand_id, 'event-cart-3', pg_catalog.repeat('2', 64), 'cart-2', 'Casey Jordan', 7450, true);
  v_second_lead_id := (v_result->>'leadId')::uuid;
  v_result := public.suppress_demo_lead(v_session_id, v_brand_id, v_second_lead_id);
  if v_result->>'status' <> 'suppressed' then raise exception 'expected new lead suppression: %', v_result; end if;
  v_result := public.claim_demo_lead(v_session_id, v_brand_id, v_second_lead_id, v_rep_one);
  if v_result->>'status' <> 'suppressed' then raise exception 'expected blocked claim: %', v_result; end if;
  v_result := public.ingest_demo_recovery_event(v_session_id, v_brand_id, 'event-order-5', pg_catalog.repeat('3', 64), v_second_lead_id, 'order-4', 7450);
  if v_result->>'status' <> 'suppressed' then raise exception 'expected blocked sale: %', v_result; end if;

  select pg_catalog.count(*), coalesce(pg_catalog.sum(amount_cents), 0)::integer
    into recovery_count, revenue_cents from public.recoveries
    where session_id = v_session_id and brand_id = v_brand_id;
  if recovery_count <> 1 or revenue_cents <> 12800 then
    raise exception 'expected exactly one $128.00 recovery, got count %, cents %', recovery_count, revenue_cents;
  end if;

  raise notice 'Core flow checks passed for session %', v_session_id;
end;
$$;

do $$
begin
  if pg_catalog.has_function_privilege('anon', 'public.create_demo_session(text)', 'EXECUTE') then
    raise exception 'Anonymous users must not be able to create sessions through database functions.';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.leads', 'SELECT') then
    raise exception 'Anonymous users must not be able to read demo leads directly.';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.create_demo_session(text)', 'EXECUTE') then
    raise exception 'The server role must be able to create demo sessions.';
  end if;
end;
$$;

create function pg_temp.fail_demo_cart_activity() returns trigger
language plpgsql
as $$
begin
  if new.action = 'cart_received' then
    raise exception 'forced activity failure for rollback check';
  end if;
  return new;
end;
$$;

create trigger fail_demo_cart_activity
before insert on public.activity_history
for each row execute function pg_temp.fail_demo_cart_activity();

do $$
declare
  v_session_id uuid;
  v_brand_id uuid;
  did_fail boolean := false;
begin
  v_session_id := public.create_demo_session(pg_catalog.md5(pg_catalog.random()::text) || pg_catalog.md5(pg_catalog.random()::text));
  select id into v_brand_id from public.brands b where b.session_id = v_session_id order by b.slug limit 1;
  begin
    perform public.ingest_demo_cart_event(v_session_id, v_brand_id, 'rollback-event', pg_catalog.repeat('9', 64), 'rollback-cart', 'Rollback Check', 900, true);
  exception when others then
    did_fail := true;
  end;
  if not did_fail then raise exception 'Expected the activity insert to fail.'; end if;
  if exists (select 1 from public.leads where session_id = v_session_id and brand_id = v_brand_id and cart_id = 'rollback-cart')
     or exists (select 1 from public.received_events where session_id = v_session_id and brand_id = v_brand_id and event_id = 'rollback-event') then
    raise exception 'A failed cart event left partial records.';
  end if;
  raise notice 'Rollback check passed for session %', v_session_id;
end;
$$;

drop trigger fail_demo_cart_activity on public.activity_history;
drop function pg_temp.fail_demo_cart_activity();
