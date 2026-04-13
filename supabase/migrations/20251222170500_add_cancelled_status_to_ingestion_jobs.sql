-- Migration: add cancelled status to ingestion_job_status enum

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'ingestion_job_status'
      AND e.enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE public.ingestion_job_status ADD VALUE 'cancelled';
  END IF;
END
$$;

