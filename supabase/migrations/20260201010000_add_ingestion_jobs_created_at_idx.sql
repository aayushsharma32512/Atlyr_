-- Add index to speed up the default "All jobs" query in the HITL dashboard
CREATE INDEX IF NOT EXISTS ingestion_jobs_created_at_idx ON public.ingestion_jobs (created_at DESC);
