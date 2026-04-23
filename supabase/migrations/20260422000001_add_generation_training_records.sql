-- Migration: generation_training_records
-- Stores likeness generation training data: inputs, all candidates, and which was selected.
-- Populated by the likeness-select edge function before temp cleanup runs.
-- Service-role only — no user RLS policies.

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.generation_training_records (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id                  UUID        NOT NULL UNIQUE, -- natural dedup key; ON CONFLICT used for retries
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Selection signal
  selected_pose_id          UUID        NOT NULL REFERENCES public.user_neutral_poses(id) ON DELETE CASCADE,
  selected_candidate_index  INT         NOT NULL,
  total_candidates          INT         NOT NULL,

  -- Generation context captured at time of generation
  identity_summary          TEXT,
  user_overrides            JSONB       NOT NULL DEFAULT '{}', -- {height, weight, skinTone}

  -- Paths in the training-data bucket (permanent)
  -- Selected image is NOT duplicated here — join via selected_pose_id → user_neutral_poses.storage_path
  input_selfie_path         TEXT        NOT NULL,
  input_fullbody_path       TEXT        NOT NULL,
  rejected_candidate_paths  JSONB       NOT NULL DEFAULT '[]' -- [{index: int, path: string}]
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_gtr_user_id    ON public.generation_training_records (user_id);
CREATE INDEX IF NOT EXISTS idx_gtr_created_at ON public.generation_training_records (created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.generation_training_records ENABLE ROW LEVEL SECURITY;
-- No policies: accessible only via service role key in edge functions.
-- Users cannot read, write, or delete their own training records.

-- ─── Storage bucket ──────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'training-data',
  'training-data',
  false,                                                        -- private
  31457280,                                                     -- 30 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- No storage RLS policies for training-data bucket.
-- Access is exclusively through service role key in edge functions.

-- ─── Comments ────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.generation_training_records IS
  'Training dataset for the likeness generation model. One row per completed user selection. '
  'Capped at 2500 rows (enforced in likeness-select edge function). '
  'Paths reference the training-data storage bucket. '
  'Selected image lives in neutral-poses bucket — join via selected_pose_id.';

COMMENT ON COLUMN public.generation_training_records.batch_id IS
  'UUID of the generation batch. UNIQUE — used as ON CONFLICT target to handle retries safely.';

COMMENT ON COLUMN public.generation_training_records.rejected_candidate_paths IS
  'JSON array of {index: int, path: string} for all unselected candidates. Paths in training-data bucket.';

COMMENT ON COLUMN public.generation_training_records.user_overrides IS
  'User-provided or profile-derived overrides at generation time: {height, weight, skinTone}.';
