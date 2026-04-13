-- Migration: create ingestion_job_state table for durable workflow state

CREATE TABLE IF NOT EXISTS public.ingestion_job_state (
  job_id UUID PRIMARY KEY,
  currentstate JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_job_state_updated_at
  ON public.ingestion_job_state (updated_at DESC);

