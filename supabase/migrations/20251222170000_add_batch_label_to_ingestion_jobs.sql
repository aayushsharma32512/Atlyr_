-- Migration: persist batch label on ingestion_jobs

ALTER TABLE public.ingestion_jobs
ADD COLUMN IF NOT EXISTS batch_label text;

COMMENT ON COLUMN public.ingestion_jobs.batch_label IS 'Optional human-friendly label provided at batch submission time; duplicated per job for easier filtering in dashboards.';

