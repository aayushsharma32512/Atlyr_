ALTER TABLE public.ingestion_job_state
  ADD COLUMN IF NOT EXISTS checkpoint JSONB;
