-- Atomic slot reservation functions to prevent race conditions
-- These functions check the limit AND insert in a single atomic operation
-- Uses SECURITY DEFINER to ensure consistent execution regardless of caller
-- Uses search_path = public to prevent search_path injection attacks

-- Function to atomically reserve a try-on generation slot
-- Returns the generation ID if successful, NULL if limit reached or duplicate
CREATE OR REPLACE FUNCTION reserve_tryon_slot(
  p_generation_id UUID,
  p_user_id UUID,
  p_outfit_id TEXT,
  p_neutral_pose_id UUID,
  p_daily_limit INTEGER DEFAULT 10
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_of_day_ist TIMESTAMPTZ;
  v_result UUID;
BEGIN
  -- Serialize requests for this user to prevent race conditions
  -- Under READ COMMITTED, concurrent COUNT queries can see the same snapshot
  -- This lock ensures only one request per user is processed at a time
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '_tryon'));

  -- Calculate start of day in IST (UTC+5:30)
  -- IST midnight = UTC 18:30 previous day
  v_start_of_day_ist := (
    DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') 
    AT TIME ZONE 'Asia/Kolkata'
  );

  -- Atomic check + insert using a CTE
  -- The INSERT only happens if the subquery returns a row (i.e., count < limit)
  -- ON CONFLICT handles duplicate generation IDs gracefully (returns NULL)
  INSERT INTO user_generations (id, user_id, outfit_id, neutral_pose_id, storage_path, status, created_at)
  SELECT 
    p_generation_id,
    p_user_id,
    p_outfit_id,
    p_neutral_pose_id,
    'pending',  -- Placeholder, will be updated when generation completes
    'queued',
    NOW()
  WHERE (
    SELECT COUNT(*)
    FROM user_generations
    WHERE user_id = p_user_id
      AND created_at >= v_start_of_day_ist
  ) < p_daily_limit
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_result;

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    -- Handle race condition where same ID was inserted by another request
    RETURN NULL;
END;
$$;

-- Function to atomically reserve a likeness generation slot
-- Returns the candidate ID if successful, NULL if limit reached or duplicate
-- Ignores placeholder records older than 10 minutes (stale from crashed requests)
CREATE OR REPLACE FUNCTION reserve_likeness_slot(
  p_candidate_id UUID,
  p_user_id UUID,
  p_batch_id UUID,
  p_daily_limit INTEGER DEFAULT 3
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_of_day_ist TIMESTAMPTZ;
  v_placeholder_cutoff TIMESTAMPTZ;
  v_result UUID;
BEGIN
  -- Serialize requests for this user to prevent race conditions
  -- Under READ COMMITTED, concurrent COUNT queries can see the same snapshot
  -- This lock ensures only one request per user is processed at a time
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '_likeness'));

  -- Calculate start of day in IST (UTC+5:30)
  v_start_of_day_ist := (
    DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') 
    AT TIME ZONE 'Asia/Kolkata'
  );
  
  -- Placeholders older than 10 minutes are considered stale (crashed requests)
  v_placeholder_cutoff := NOW() - INTERVAL '10 minutes';

  -- Atomic check + insert using a single statement
  -- The INSERT only happens if the combined count is under the limit
  -- This counts: saved poses (user_neutral_poses) + distinct pending batches (likeness_candidates)
  -- Excludes stale placeholder records (older than 10 minutes with candidate_index = -1)
  INSERT INTO likeness_candidates (id, user_id, batch_id, candidate_index, storage_path, mime_type, created_at)
  SELECT 
    p_candidate_id,
    p_user_id,
    p_batch_id,
    -1,  -- Placeholder index
    'reserved',
    'reserved',
    NOW()
  WHERE (
    -- Count saved poses today
    (SELECT COUNT(*) FROM user_neutral_poses 
     WHERE user_id = p_user_id AND created_at >= v_start_of_day_ist)
    +
    -- Count distinct pending batches today
    -- Include real candidates (index >= 0) OR recent placeholders (index = -1, less than 10 min old)
    (SELECT COUNT(DISTINCT batch_id) FROM likeness_candidates 
     WHERE user_id = p_user_id 
       AND created_at >= v_start_of_day_ist 
       AND (candidate_index >= 0 OR created_at > v_placeholder_cutoff))
  ) < p_daily_limit
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_result;

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    -- Handle race condition where same ID was inserted by another request
    RETURN NULL;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION reserve_tryon_slot(UUID, UUID, TEXT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION reserve_likeness_slot(UUID, UUID, UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION reserve_tryon_slot IS 'Atomically checks daily limit and reserves a try-on slot. Returns generation ID if successful, NULL if limit reached.';
COMMENT ON FUNCTION reserve_likeness_slot IS 'Atomically checks daily limit and reserves a likeness slot. Returns candidate ID if successful, NULL if limit reached. Ignores stale placeholders older than 10 minutes.';

-- Cleanup function for stale placeholder records
-- Can be called periodically (e.g., via pg_cron) to clean up orphaned placeholders
-- from crashed or timed-out requests
CREATE OR REPLACE FUNCTION cleanup_stale_likeness_placeholders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete placeholder records (candidate_index = -1) older than 10 minutes
  -- These are from requests that crashed or timed out before completing
  DELETE FROM likeness_candidates
  WHERE candidate_index = -1
    AND storage_path = 'reserved'
    AND created_at < NOW() - INTERVAL '10 minutes'
  RETURNING COUNT(*) INTO v_deleted_count;
  
  RETURN COALESCE(v_deleted_count, 0);
END;
$$;

-- Cleanup function for stale try-on records stuck in 'queued' status
CREATE OR REPLACE FUNCTION cleanup_stale_tryon_placeholders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Mark queued records older than 10 minutes as 'failed'
  -- These are from requests that crashed before starting generation
  UPDATE user_generations
  SET status = 'failed',
      metadata = jsonb_build_object('error', 'stale_placeholder_cleanup', 'cleaned_at', NOW())
  WHERE status = 'queued'
    AND storage_path = 'pending'
    AND created_at < NOW() - INTERVAL '10 minutes'
  RETURNING COUNT(*) INTO v_deleted_count;
  
  RETURN COALESCE(v_deleted_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_stale_likeness_placeholders() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_stale_tryon_placeholders() TO service_role;

COMMENT ON FUNCTION cleanup_stale_likeness_placeholders IS 'Removes stale likeness placeholder records older than 10 minutes. Run periodically.';
COMMENT ON FUNCTION cleanup_stale_tryon_placeholders IS 'Marks stale queued try-on records as failed. Run periodically.';

-- ============================================================================
-- PERFORMANCE: Add indexes for IST date filtering queries
-- These indexes optimize the COUNT queries in reserve_*_slot functions
-- ============================================================================

-- Index for user_generations date filtering (used by reserve_tryon_slot)
CREATE INDEX IF NOT EXISTS idx_user_generations_user_created_at 
  ON user_generations (user_id, created_at);

-- Index for likeness_candidates date filtering (used by reserve_likeness_slot)
CREATE INDEX IF NOT EXISTS idx_likeness_candidates_user_created_at 
  ON likeness_candidates (user_id, created_at);

-- Index for user_neutral_poses date filtering (used by reserve_likeness_slot)
CREATE INDEX IF NOT EXISTS idx_user_neutral_poses_user_created_at 
  ON user_neutral_poses (user_id, created_at);

-- ============================================================================
-- AUTO-CLEANUP: Schedule periodic cleanup using pg_cron
-- Runs every 5 minutes to clean up stale placeholders
-- NOTE: pg_cron must be enabled in Supabase dashboard (Database > Extensions)
-- ============================================================================

-- Enable pg_cron extension (requires Supabase Pro plan or self-hosted)
-- Uncomment the following lines if pg_cron is available:

-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup every 5 minutes
-- SELECT cron.schedule(
--   'cleanup-stale-likeness-placeholders',
--   '*/5 * * * *',  -- Every 5 minutes
--   'SELECT cleanup_stale_likeness_placeholders()'
-- );

-- SELECT cron.schedule(
--   'cleanup-stale-tryon-placeholders', 
--   '*/5 * * * *',  -- Every 5 minutes
--   'SELECT cleanup_stale_tryon_placeholders()'
-- );

-- ============================================================================
-- RATE LIMITING NOTE
-- ============================================================================
-- Server-side rate limiting should be implemented at the CDN/edge level:
-- 
-- For Vercel: Use vercel.json with "rewrites" and rate limiting middleware
-- For Cloudflare: Use Rate Limiting Rules in the dashboard
-- 
-- Recommended limits:
--   - /functions/v1/tryon-generate: 10 requests/minute per IP
--   - /functions/v1/likeness-upload: 5 requests/minute per IP
-- 
-- This is NOT implemented in this migration as it requires infrastructure config.
-- ============================================================================
