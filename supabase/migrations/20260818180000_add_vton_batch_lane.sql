-- Economy lane: route the VTON step of opted-in jobs through an AI Studio batch instead of a
-- per-job interactive call (~50% of the price, minutes-to-hours instead of seconds).
--
-- Batch is a STATION, not a pipeline mode. A job parks at 'vton_batch_queued', a collector ships
-- a tray of parked jobs to Google, a poller brings results back, and each job then continues
-- alone down the ordinary path. Nothing else about the pipeline changes.
--
-- See docs/economy-lane-batch-vton.md.

-- ─── ingestion_pipeline_jobs ─────────────────────────────────────────────────

-- Which lane this job's VTON step takes. Defaults to 'instant' so every existing row, and every
-- caller that does not opt in, behaves exactly as it does today.
ALTER TABLE public.ingestion_pipeline_jobs
  ADD COLUMN IF NOT EXISTS vton_lane TEXT NOT NULL DEFAULT 'instant'
    CHECK (vton_lane IN ('instant', 'batch'));

-- The tray this job is currently claimed by, or NULL when it is unclaimed. The collector's
-- claim is an atomic UPDATE on this column, and that claim — not the cron cadence — is what
-- makes two overlapping collector ticks safe.
ALTER TABLE public.ingestion_pipeline_jobs
  ADD COLUMN IF NOT EXISTS gemini_batch_id UUID NULL;

-- The parked state. The original CHECK was declared inline and unnamed, so Postgres auto-named
-- it; drop by that name and re-add with the new member.
ALTER TABLE public.ingestion_pipeline_jobs
  DROP CONSTRAINT IF EXISTS ingestion_pipeline_jobs_current_state_check;

ALTER TABLE public.ingestion_pipeline_jobs
  ADD CONSTRAINT ingestion_pipeline_jobs_current_state_check
  CHECK (current_state IN (
    'pending','scraping','identifying',
    'awaiting_hitl_identification',
    'generating_garment_summary','generating_vton',
    'vton_batch_queued',
    'segmenting','segmented',
    'awaiting_hitl_segmentation',
    'placement','completed','failed','discarded','cancelled'
  ));

-- The collector's hot query is "parked and unclaimed". A partial index keeps that scan
-- proportional to the parked set rather than to the whole job table.
CREATE INDEX IF NOT EXISTS ingestion_pipeline_jobs_vton_batch_queued_idx
  ON public.ingestion_pipeline_jobs (current_state)
  WHERE current_state = 'vton_batch_queued';

-- The poller's reconciliation sweep walks members of one tray.
CREATE INDEX IF NOT EXISTS ingestion_pipeline_jobs_gemini_batch_id_idx
  ON public.ingestion_pipeline_jobs (gemini_batch_id)
  WHERE gemini_batch_id IS NOT NULL;

-- ─── gemini_batches ──────────────────────────────────────────────────────────

-- One row per tray shipped to Google.
--
-- The row is inserted in 'submitting' BEFORE any job is claimed and before the provider is
-- called, because batch creation is not idempotent: a crash between submitting and recording
-- the resource name would otherwise be indistinguishable from "never submitted", and retrying
-- would bill the tray twice. A 'submitting' row with no provider_batch_name is the janitor's
-- signal to release its claimed jobs — zero spend, no double submit.
CREATE TABLE IF NOT EXISTS public.gemini_batches (
  batch_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Google's resource name, "batches/…". NULL until the create call returns.
  provider_batch_name TEXT NULL,
  status              TEXT NOT NULL DEFAULT 'submitting'
                        CHECK (status IN ('submitting','pending','running','succeeded','failed','expired')),
  model               TEXT NOT NULL,
  request_count       INT NOT NULL DEFAULT 0,
  -- Files API resource names, set only when the tray outgrew the 20 MB inline ceiling.
  input_file          TEXT NULL,
  output_file         TEXT NULL,
  error               TEXT NULL,
  -- Count of members demoted to the instant lane (per-item refusal, error, or swept after a
  -- terminal batch). The lane's real saving is quoted net of this; without it the first signal
  -- of a broken tray is the bill.
  fallback_count      INT NOT NULL DEFAULT 0,
  submitted_at        TIMESTAMPTZ NULL,
  completed_at        TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The poller scans exactly this set every tick.
CREATE INDEX IF NOT EXISTS gemini_batches_open_idx
  ON public.gemini_batches (status, submitted_at)
  WHERE status IN ('submitting','pending','running');

-- ON DELETE SET NULL, not CASCADE: deleting a tray row must never delete jobs. Losing the tray
-- just makes its members unclaimed again.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_pipeline_jobs_gemini_batch_id_fkey'
  ) THEN
    ALTER TABLE public.ingestion_pipeline_jobs
      ADD CONSTRAINT ingestion_pipeline_jobs_gemini_batch_id_fkey
      FOREIGN KEY (gemini_batch_id) REFERENCES public.gemini_batches(batch_id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.ingestion_pipeline_jobs.vton_lane IS
  'instant = per-job Gemini call; batch = parked for an AI Studio batch tray. Default instant.';
COMMENT ON COLUMN public.ingestion_pipeline_jobs.gemini_batch_id IS
  'Tray currently owning this job. Set by the collector''s atomic claim, cleared on fallback or restart.';
COMMENT ON TABLE public.gemini_batches IS
  'One AI Studio batch tray. Inserted as submitting before any job is claimed — see the economy lane doc.';
