-- Create catalog table for ingestion jobs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type typ
    JOIN pg_namespace nsp ON nsp.oid = typ.typnamespace
    WHERE typ.typname = 'ingestion_job_status'
      AND nsp.nspname = 'public'
  ) THEN
    CREATE TYPE public.ingestion_job_status AS ENUM (
      'queued',
      'ingesting',
      'awaiting_phase1',
      'phase1_complete',
      'awaiting_phase2',
      'promoting',
      'completed',
      'errored'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
  job_id uuid PRIMARY KEY,
  original_url text NOT NULL,
  canonical_url text NOT NULL,
  domain text NOT NULL,
  path text NOT NULL,
  dedupe_key text NOT NULL,
  batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_by uuid,
  status ingestion_job_status NOT NULL DEFAULT 'queued',
  last_step text,
  phase_flags jsonb DEFAULT '{}'::jsonb,
  queued_at timestamptz,
  started_at timestamptz,
  phase1_completed_at timestamptz,
  phase2_completed_at timestamptz,
  stage_at timestamptz,
  promote_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  error_count integer NOT NULL DEFAULT 0,
  last_error text,
  pause_reason text,
  duplicate_of uuid REFERENCES public.ingestion_jobs (job_id),
  assigned_operator uuid,
  CONSTRAINT ingestion_jobs_dedupe_key_ck CHECK (dedupe_key <> '')
);

CREATE INDEX IF NOT EXISTS ingestion_jobs_status_created_at_idx
  ON public.ingestion_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS ingestion_jobs_dedupe_key_idx
  ON public.ingestion_jobs (dedupe_key);

CREATE INDEX IF NOT EXISTS ingestion_jobs_batch_id_idx
  ON public.ingestion_jobs (batch_id);
