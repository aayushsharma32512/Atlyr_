-- Fix outfit_ids type mismatch: outfits.id is TEXT, not UUID
-- Example IDs: 'outfit-work-1', 'outfit-casual-1'

ALTER TABLE batch_enrichment_jobs 
  ALTER COLUMN outfit_ids TYPE TEXT[] 
  USING outfit_ids::TEXT[];

-- Fix race condition: prevent multiple admins from creating concurrent batch jobs
-- Only ONE job can be in 'pending' or 'running' status at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_batch_job 
  ON batch_enrichment_jobs ((1)) 
  WHERE status IN ('pending', 'running');

-- Fix orphaned drafts: Track which batch job created each draft
-- Allows cleanup and debugging when batch jobs fail partway through
ALTER TABLE outfit_enrichment_drafts 
  ADD COLUMN IF NOT EXISTS batch_job_id UUID REFERENCES batch_enrichment_jobs(id) ON DELETE SET NULL;

-- Index for querying drafts by batch job
CREATE INDEX IF NOT EXISTS idx_drafts_batch_job_id 
  ON outfit_enrichment_drafts(batch_job_id) 
  WHERE batch_job_id IS NOT NULL;

-- Cleanup stale batch jobs (requires pg_cron extension)
-- Jobs stuck in pending/running for >24 hours are likely failed
-- Run every 6 hours to mark them as failed
DO $$
BEGIN
  -- Only create if pg_cron extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-stale-batch-enrichment-jobs',
      '0 */6 * * *',  -- Every 6 hours
      'UPDATE batch_enrichment_jobs 
       SET 
         status = ''failed'', 
         error_message = ''Job timeout - exceeded 24 hours without completion'',
         updated_at = now()
       WHERE status IN (''pending'', ''running'')
         AND created_at < now() - interval ''24 hours'''
    );
  END IF;
END $$;

-- P2: Track failed outfit IDs for debugging partial batch failures
ALTER TABLE batch_enrichment_jobs 
  ADD COLUMN IF NOT EXISTS failed_outfit_ids TEXT[];

-- P2: Cleanup old rejected drafts to prevent DB bloat
-- Delete rejected drafts older than 30 days (keep recent ones for audit)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-rejected-enrichment-drafts',
      '0 3 * * 0',  -- Every Sunday at 3 AM
      'DELETE FROM outfit_enrichment_drafts 
       WHERE approval_status = ''rejected''
         AND created_at < now() - interval ''30 days'''
    );
  END IF;
END $$;
