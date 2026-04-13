-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Create a function that triggers the GitHub Dispatch
CREATE OR REPLACE FUNCTION trigger_github_embedding_workflow()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  queue_count INT;
  v_token TEXT;
BEGIN
  -- Check if there are items in the queue
  SELECT COUNT(*) INTO queue_count FROM embedding_queue;

  -- Get the token securely from Supabase Vault
  SELECT decrypted_secret INTO v_token 
  FROM vault.decrypted_secrets 
  WHERE name = 'github_pat_secret' 
  LIMIT 1;

  -- Only trigger if queue is not empty AND token exists
  IF queue_count > 0 AND v_token IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://api.github.com/repos/aak-ash/query-your-helper/dispatches',
      headers := jsonb_build_object(
        'Accept', 'application/vnd.github+json',
        'Authorization', 'Bearer ' || v_token,
        'X-GitHub-Api-Version', '2022-11-28',
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'event_type', 'embedding-update',
        'client_payload', jsonb_build_object('queue_count', queue_count)
      )
    );
  END IF;
END;
$$;

-- 2. Schedule the cron job to run every 30 minutes
-- Note: '*/30 * * * *' means "Every 30th minute"
SELECT cron.schedule(
  'trigger-embedding-workflow',
  '*/30 * * * *', 
  'SELECT trigger_github_embedding_workflow()'
);