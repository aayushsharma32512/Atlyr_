-- Enable pg_cron for automatic cleanup of stale placeholders
-- 
-- Prerequisites:
-- 1. pg_cron must be enabled in Supabase Dashboard (Database > Extensions)
-- 2. This is available on Supabase Pro plan or self-hosted
--
-- This migration schedules periodic cleanup of:
-- - Stale likeness placeholders (older than 10 minutes)
-- - Stale/stuck try-on records (queued >10min, generating >2min)

-- pg_cron is already enabled via Supabase dashboard, no need to create extension

-- Schedule cleanup every 5 minutes for likeness placeholders
DO $$
BEGIN
  -- Unschedule if exists to avoid duplicates
  PERFORM cron.unschedule('cleanup-stale-likeness-placeholders');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist, ignore
END;
$$;

SELECT cron.schedule(
  'cleanup-stale-likeness-placeholders',
  '*/5 * * * *',
  'SELECT cleanup_stale_likeness_placeholders()'
);

-- Schedule cleanup every 5 minutes for try-on placeholders
DO $$
BEGIN
  -- Unschedule if exists to avoid duplicates
  PERFORM cron.unschedule('cleanup-stale-tryon-placeholders');
EXCEPTION WHEN OTHERS THEN
  -- Job doesn't exist, ignore
END;
$$;

SELECT cron.schedule(
  'cleanup-stale-tryon-placeholders', 
  '*/5 * * * *',
  'SELECT cleanup_stale_tryon_placeholders()'
);
