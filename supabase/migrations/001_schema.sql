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
