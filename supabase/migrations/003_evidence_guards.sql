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
