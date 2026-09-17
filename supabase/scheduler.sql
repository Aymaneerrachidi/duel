-- Run as postgres in Supabase SQL Editor, separately from the application schema.
-- Generate a private, filled copy with: pnpm scheduler:prepare
-- References: https://supabase.com/docs/guides/functions/schedule-functions
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $setup$
declare
  scheduler_token text := '__CRON_SECRET__';
  secret_id uuid;
begin
  if scheduler_token = '__CRON_' || 'SECRET__' or length(scheduler_token) < 32 then
    raise exception 'Generate the private scheduler SQL with pnpm scheduler:prepare first';
  end if;
  select id into secret_id from vault.secrets where name = 'pnl_duels_cron_secret';
  if secret_id is null then
    perform vault.create_secret(scheduler_token, 'pnl_duels_cron_secret', 'PNL Duels scheduled refresh authentication');
  else
    perform vault.update_secret(secret_id, scheduler_token);
  end if;
end;
$setup$;

-- Check for due work every minute. Portfolio refreshes retain their five-minute
-- interval and quota limits. The database lease prevents overlapping jobs.
select cron.schedule('pnl-duels-refresh', '* * * * *', $job$
  select net.http_get(
    url := '__APP_ORIGIN__/api/cron',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'pnl_duels_cron_secret'
      )
    ),
    timeout_milliseconds := 290000
  );
$job$);
commit;

-- This confirms registration without displaying the token or job command.
select jobid, jobname, schedule, active
from cron.job where jobname = 'pnl-duels-refresh';

-- After two minutes, check /admin for an advancing last-refresh time.
-- Disable only this job if needed: select cron.unschedule('pnl-duels-refresh');
