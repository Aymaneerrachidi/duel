begin;
create function public.duels_table_name(logical_name text) returns text language sql immutable set search_path=public as $$
select case logical_name when 'profiles' then 'wallet_profiles' when 'duels' then 'duels' when 'snapshots' then 'portfolio_snapshots'
 when 'cashflows' then 'external_cashflows' when 'transactions' then 'wallet_transactions' when 'predictions' then 'spectator_predictions'
 when 'ledger' then 'prediction_ledger' when 'events' then 'duel_events' when 'nonces' then 'wallet_nonces' when 'sessions' then 'wallet_sessions'
 when 'usage' then 'provider_usage' when 'controls' then 'app_controls' when 'audit' then 'admin_audit_log' when 'prices' then 'token_prices' else null end;
$$;
create function public.duels_read_state() returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb := '{}'::jsonb; logical_name text; items jsonb; rev bigint;
begin
  -- Shared lock keeps the multi-table read consistent with atomic commits.
  select revision into rev from duels_revision where id=true for share;
  foreach logical_name in array array['profiles','duels','snapshots','cashflows','transactions','predictions','ledger','events','nonces','sessions','usage','controls','audit','prices'] loop
    execute format('select coalesce(jsonb_agg(data),''[]''::jsonb) from public.%I',duels_table_name(logical_name)) into items;
    result := result || jsonb_build_object(logical_name,items);
  end loop;
  return jsonb_build_object('revision',rev,'state',result);
end $$;
create function public.duels_commit(expected_revision bigint,changes jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare actual_revision bigint; change jsonb; target text; previous jsonb; logical_name text;
begin
  select revision into actual_revision from duels_revision where id=true for update;
  if actual_revision<>expected_revision then return false; end if;
  if jsonb_typeof(changes)<>'array' then raise exception 'Changes must be an array'; end if;
  for change in select * from jsonb_array_elements(changes) loop
    logical_name := change->>'table'; target := duels_table_name(logical_name);
    if target is null then raise exception 'Unknown record type'; end if;
    execute format('select data from public.%I where id=$1',target) into previous using change->>'id';
    if previous is not null and logical_name in ('snapshots','cashflows','transactions','ledger','events','audit') and previous is distinct from change->'data' then raise exception 'Historical evidence is append-only'; end if;
    if logical_name='duels' and previous->>'status'='COMPLETED' and previous is distinct from change->'data' then raise exception 'Completed duels are immutable'; end if;
    if logical_name='predictions' and previous is not null and (previous-'payout') is distinct from ((change->'data')-'payout') then raise exception 'Prediction cannot be changed'; end if;
    if change->'data'='null'::jsonb then
      if logical_name not in ('nonces','sessions','controls','prices') then raise exception 'Record cannot be deleted'; end if;
      execute format('delete from public.%I where id=$1',target) using change->>'id';
    else
      if change->'data'->>'id'<>change->>'id' then raise exception 'Record identity mismatch'; end if;
      execute format('insert into public.%I(id,data) values($1,$2) on conflict(id) do update set data=excluded.data',target) using change->>'id',change->'data';
    end if;
  end loop;
  if exists(select profile_id from prediction_ledger group by profile_id having sum((data->>'delta')::bigint)<0) then raise exception 'Negative points balance'; end if;
  update duels_revision set revision=revision+1 where id=true;
  return true;
end $$;
create function public.duels_rate_limit(counter_key text,counter_limit integer,expires_at_ms bigint) returns boolean language plpgsql security definer set search_path=public as $$
declare current_usage integer;
begin
  if counter_limit<1 or length(counter_key)>180 then return false; end if;
  insert into rate_limit_counters values(counter_key,1,expires_at_ms)
    on conflict(id) do update set used=rate_limit_counters.used+1
    returning used into current_usage;
  delete from rate_limit_counters where rate_limit_counters.expires_at_ms < extract(epoch from now())*1000;
  return current_usage<=counter_limit;
end $$;
revoke all on function public.duels_table_name(text), public.duels_read_state(),public.duels_commit(bigint,jsonb),public.duels_rate_limit(text,integer,bigint) from public,anon,authenticated;
grant execute on function public.duels_table_name(text),public.duels_read_state(),public.duels_commit(bigint,jsonb),public.duels_rate_limit(text,integer,bigint) to service_role;
commit;
