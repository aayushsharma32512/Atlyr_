-- Track batch enrichment jobs for Gemini Batch API
CREATE TABLE batch_enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gemini_batch_name TEXT NOT NULL,           -- "batches/abc123"
  status TEXT NOT NULL DEFAULT 'pending'     -- pending, running, succeeded, failed
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  total_outfits INT NOT NULL,
  processed_outfits INT DEFAULT 0,
  failed_outfits INT DEFAULT 0,
  outfit_ids UUID[] NOT NULL,                -- Ordered array matching request order
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Index for status queries
CREATE INDEX idx_batch_enrichment_jobs_status ON batch_enrichment_jobs(status);
CREATE INDEX idx_batch_enrichment_jobs_created_by ON batch_enrichment_jobs(created_by);

-- RLS policies
ALTER TABLE batch_enrichment_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage batch jobs"
  ON batch_enrichment_jobs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.user_id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );
