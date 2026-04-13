-- Redefine reserve_tryon_slot to exclude failed generations from the daily count
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
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '_tryon'));

  -- Calculate start of day in IST (UTC+5:30)
  v_start_of_day_ist := (
    DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') 
    AT TIME ZONE 'Asia/Kolkata'
  );

  -- Atomic check + insert
  -- Exclude 'failed' status from the count to allow retries
  INSERT INTO user_generations (id, user_id, outfit_id, neutral_pose_id, storage_path, status, created_at)
  SELECT 
    p_generation_id,
    p_user_id,
    p_outfit_id,
    p_neutral_pose_id,
    'pending',
    'queued',
    NOW()
  WHERE (
    SELECT COUNT(*)
    FROM user_generations
    WHERE user_id = p_user_id
      AND created_at >= v_start_of_day_ist
      AND status != 'failed'
  ) < p_daily_limit
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_result;

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    RETURN NULL;
END;
$$;
