-- Fix for stuck 'generating' records
-- 
-- Issue addressed:
-- cleanup_stale_tryon_placeholders only targeted 'queued' status, leaving 'generating' 
-- records stuck forever if the edge function timed out after setting status to 'generating'
--
-- Change:
-- Update cleanup function to also mark 'generating' records as failed after 2 minutes
-- (Edge function timeout is ~60-150s, so 2 minutes is a safe threshold)

-- ============================================================================
-- FIX: Update cleanup function to handle stuck 'generating' records
-- ============================================================================

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

  -- Mark generating records older than 2 minutes as 'failed'
  -- Edge function timeout is ~60-150s, so 2 minutes is a safe threshold
  -- If still 'generating' after 2 minutes, the request definitely timed out
  WITH updated_generating AS (
    UPDATE user_generations
    SET status = 'failed',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'error', 'stuck_generating_timeout',
          'original_status', 'generating',
          'cleaned_at', NOW()
        )
    WHERE status = 'generating'
      AND created_at < NOW() - INTERVAL '2 minutes'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_generating_count FROM updated_generating;

  RETURN v_queued_count + v_generating_count;
END;
$$;

COMMENT ON FUNCTION cleanup_stale_tryon_placeholders IS 
  'Marks stale queued (>10min) and stuck generating (>2min) try-on records as failed. Run periodically via pg_cron or external scheduler.';
