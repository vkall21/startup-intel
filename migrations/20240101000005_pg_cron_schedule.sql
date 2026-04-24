-- Requires Supabase Pro (pg_cron + pg_net / net.http_post)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Weekly TechCrunch ingestion: every Monday at 6am UTC
SELECT cron.schedule(
  'weekly-techcrunch',
  '0 6 * * 1',
  $$
    SELECT net.http_post(
      url := current_setting('app.ingest_webhook_url', true),
      body := '{"source":"techcrunch"}'::jsonb
    )
  $$
);

-- Weekly Product Hunt ingestion: every Monday at 7am UTC
SELECT cron.schedule(
  'weekly-producthunt',
  '0 7 * * 1',
  $$
    SELECT net.http_post(
      url := current_setting('app.ingest_webhook_url', true),
      body := '{"source":"producthunt"}'::jsonb
    )
  $$
);

-- Verify
SELECT jobname, schedule, active FROM cron.job;
