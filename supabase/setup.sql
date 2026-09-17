-- Initial setup for a fresh PNL DUELS Supabase project.
-- Run this complete file in the Supabase SQL Editor once.

-- 001_schema.sql
-- Run in a NEW Supabase project. All write access is service-role only.
-- Compact typed JSON records avoid storing raw RPC payloads; generated columns
-- expose normalized identity, state, time, and relationship indexes to Postgres.
begin;
create table public.duels_revision (id boolean primary key default true check(id), revision bigint not null default 0);
insert into public.duels_revision values (true, 0);
do $$ declare t text; begin
  foreach t in array array['wallet_profiles','duels','portfolio_snapshots','external_cashflows','wallet_transactions','spectator_predictions','prediction_ledger','duel_events','wallet_nonces','wallet_sessions','provider_usage','app_controls','admin_audit_log','token_prices'] loop
    execute format('create table public.%I (id text primary key, data jsonb not null check(jsonb_typeof(data) = ''object''), created_at timestamptz not null default now(), check(data->>''id'' = id))',t);
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
alter table public.duels_revision enable row level security;
revoke all on public.duels_revision from anon, authenticated;
grant all on public.duels_revision to service_role;
alter table public.wallet_profiles add column wallet text generated always as (data->>'wallet') stored,
  add column chain text generated always as (data->>'chain') stored,
  add column username text generated always as (nullif(data->>'username','')) stored;
create unique index profile_wallet_chain on public.wallet_profiles (chain, wallet);
create unique index profile_username_unique on public.wallet_profiles (username) where username is not null;
alter table public.duels add column slug text generated always as (data->>'slug') stored unique,
  add column status text generated always as (data->>'status') stored,
  add column challenger_id text generated always as (data->>'challenger') stored references public.wallet_profiles(id),
  add column opponent_id text generated always as (data->>'opponent') stored references public.wallet_profiles(id),
  add column ends_at_ms bigint generated always as ((data->>'endsAt')::bigint) stored,
  add column visibility text generated always as (data->>'visibility') stored,
  add constraint duel_status_valid check(status in ('OPEN','AWAITING_DEPOSIT','ACTIVE','CALCULATING','FINALIZING','COMPLETED','CANCELLED','DISPUTED')),
  add constraint different_participants check(challenger_id<>opponent_id),
  add constraint positive_stake check((data->>'stake')::numeric>0);
create index due_duels on public.duels (status, ends_at_ms);
create index public_duels on public.duels (visibility,status);
alter table public.portfolio_snapshots add column duel_id text generated always as (data->>'duelId') stored references public.duels(id),
  add column wallet_id text generated always as (data->>'wallet') stored references public.wallet_profiles(id),
  add column timestamp_ms bigint generated always as ((data->>'timestamp')::bigint) stored;
create index snapshot_duel_wallet_time on public.portfolio_snapshots(duel_id,wallet_id,timestamp_ms);
create index snapshot_wallet_time on public.portfolio_snapshots(wallet_id,timestamp_ms);
alter table public.spectator_predictions add column duel_id text generated always as (data->>'duelId') stored references public.duels(id),
  add column profile_id text generated always as (data->>'profileId') stored references public.wallet_profiles(id),
  add constraint one_prediction_per_wallet unique(duel_id,profile_id),
  add constraint positive_points check((data->>'points')::bigint>=10);
alter table public.prediction_ledger add column profile_id text generated always as (data->>'profileId') stored references public.wallet_profiles(id);
create index ledger_wallet on public.prediction_ledger(profile_id);
create index nonce_expiry on public.wallet_nonces(((data->>'expiresAt')::bigint));
create index session_expiry on public.wallet_sessions(((data->>'expiresAt')::bigint));
create index flow_duel_wallet on public.external_cashflows((data->>'duelId'),(data->>'wallet'));
create index transaction_duel_wallet on public.wallet_transactions((data->>'duelId'),(data->>'wallet'));
create index event_duel_time on public.duel_events((data->>'duelId'),((data->>'createdAt')::bigint));
create table public.rate_limit_counters (id text primary key, used integer not null, expires_at_ms bigint not null);
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon,authenticated;
grant all on public.rate_limit_counters to service_role;
-- Public clients read the Worker read model; no table-wide anonymous grants.
-- Historical positions are normalized through a read-only projection, without duplication.
create view public.portfolio_positions with (security_invoker = true) as
  select s.id snapshot_id,s.duel_id,s.wallet_id,s.timestamp_ms,p.value->>'address' token_address,
    p.value->>'balance' balance,p.value->>'valueUsd' usd_value,p.value->'price' price_evidence,p.value->>'reason' exclusion_reason
  from public.portfolio_snapshots s cross join lateral jsonb_array_elements(s.data->'positions') p;
create view public.prediction_balances with (security_invoker = true) as
  select profile_id,sum((data->>'delta')::bigint) points from public.prediction_ledger group by profile_id;
revoke all on public.portfolio_positions, public.prediction_balances from anon,authenticated;
grant select on public.portfolio_positions, public.prediction_balances to service_role;
commit;


-- 002_atomic_functions.sql
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


-- 003_evidence_guards.sql
begin;
-- Enforce evidence immutability even if a service client bypasses the commit RPC.
create function public.duels_guard_evidence() returns trigger language plpgsql set search_path=public as $$
begin
  if TG_OP='DELETE' or old.data is distinct from new.data then
    raise exception 'Historical evidence is append-only';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['portfolio_snapshots','external_cashflows','wallet_transactions','prediction_ledger','duel_events','admin_audit_log'] loop
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.duels_guard_evidence()',t);
  end loop;
end $$;
create function public.duels_guard_completed() returns trigger language plpgsql set search_path=public as $$
begin
  if old.data->>'status'='COMPLETED' and (TG_OP='DELETE' or old.data is distinct from new.data) then
    raise exception 'Completed duels are immutable';
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
create trigger immutable_completed before update or delete on public.duels for each row execute function public.duels_guard_completed();
revoke all on function public.duels_guard_evidence(),public.duels_guard_completed() from public,anon,authenticated;
commit;
