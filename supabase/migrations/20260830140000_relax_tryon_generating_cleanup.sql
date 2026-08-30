-- Relax the stuck-'generating' cleanup threshold from 2 minutes to 8.
--
-- Why: tryon-generate now finishes the Gemini call in an edge background task (the synchronous
-- request was being killed by the platform's 150s idle timeout on slow 2K generations). A
-- background task may legitimately run up to ~400s of model time, so a 2-minute sweep was
-- flagging healthy in-flight generations as failed. 8 minutes = 400s wall clock + margin.
-- The client-side stuck threshold (TRYON_STUCK_THRESHOLD in JobsContext) matches this value.

CREATE OR REPLACE FUNCTION cleanup_stale_tryon_placeholders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queued_count INTEGER := 0;
  v_generating_count INTEGER := 0;
BEGIN
  -- Mark queued records older than 10 minutes as 'failed'
  -- These are from requests that crashed before starting generation
  WITH updated_queued AS (
    UPDATE user_generations
    SET status = 'failed',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'error', 'stale_queued_cleanup',
          'original_status', 'queued',
          'cleaned_at', NOW()
        )
    WHERE status = 'queued'
      AND storage_path = 'pending'
      AND created_at < NOW() - INTERVAL '10 minutes'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_queued_count FROM updated_queued;

  -- Mark generating records older than 8 minutes as 'failed'
  -- (background-task generation can take up to ~400s; see header comment)
  WITH updated_generating AS (
    UPDATE user_generations
    SET status = 'failed',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'error', 'stuck_generating_timeout',
          'original_status', 'generating',
          'cleaned_at', NOW()
        )
    WHERE status = 'generating'
      AND created_at < NOW() - INTERVAL '8 minutes'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_generating_count FROM updated_generating;

  RETURN v_queued_count + v_generating_count;
END;
$$;

COMMENT ON FUNCTION cleanup_stale_tryon_placeholders IS
  'Marks stale queued (>10min) and stuck generating (>8min) try-on records as failed. Run periodically via pg_cron or external scheduler.';
