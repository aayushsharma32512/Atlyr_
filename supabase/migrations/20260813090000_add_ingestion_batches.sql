-- Server-side bulk ingestion batches.
--
-- Until now a "batch" existed only as a browser-side convention: useBulkIngest submitted jobs
-- 3 at a time and grouped them by created_by = 'bulk:<sheet name>'. Closing the tab stopped the
-- pacing loop. This gives batches a real identity so POST /batches can create every job up
-- front and GET /batches/:id can report rollup progress with one indexed query.
--
-- created_by keeps the 'bulk:<sheet>' convention on each job so the existing dashboard
-- grouping (summarizeBatches/isBulkJob) continues to work unchanged.

CREATE TABLE IF NOT EXISTS ingestion_batches (
  batch_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT NOT NULL,
  created_by TEXT,
  -- Row count accepted into the batch at submit time (excludes duplicates and rejected rows).
  total      INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ingestion_pipeline_jobs
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES ingestion_batches(batch_id);

-- Partial: most jobs are manual submissions with no batch.
CREATE INDEX IF NOT EXISTS idx_ingestion_pipeline_jobs_batch_id
  ON ingestion_pipeline_jobs (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_batches_created_at
  ON ingestion_batches (created_at DESC);
