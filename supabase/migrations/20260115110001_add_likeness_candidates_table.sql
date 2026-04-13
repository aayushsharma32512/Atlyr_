-- Create likeness_candidates table for persistent candidate storage
-- Enables background processing and multiple concurrent avatar generation requests

-- Drop existing table if exists (for development safety)
DROP TABLE IF EXISTS public.likeness_candidates CASCADE;

-- Create likeness_candidates table
CREATE TABLE public.likeness_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL,
  candidate_index INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  identity_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Ensure unique candidates per batch
  UNIQUE(batch_id, candidate_index)
);

-- Add indexes for efficient querying
CREATE INDEX idx_likeness_candidates_user_id ON public.likeness_candidates(user_id);
CREATE INDEX idx_likeness_candidates_batch_id ON public.likeness_candidates(batch_id);
CREATE INDEX idx_likeness_candidates_created_at ON public.likeness_candidates(created_at DESC);
CREATE INDEX idx_likeness_candidates_user_batch ON public.likeness_candidates(user_id, batch_id);

-- Enable Row Level Security
ALTER TABLE public.likeness_candidates ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only select their own candidates
CREATE POLICY "Users can view their own likeness candidates"
  ON public.likeness_candidates
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can insert candidates (for edge function)
CREATE POLICY "Service role can insert candidates"
  ON public.likeness_candidates
  FOR INSERT
  WITH CHECK (true);

-- RLS Policy: Users can delete their own candidates
CREATE POLICY "Users can delete their own likeness candidates"
  ON public.likeness_candidates
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add comment for documentation
COMMENT ON TABLE public.likeness_candidates IS 'Stores generated avatar likeness candidates for persistent retrieval across sessions';
COMMENT ON COLUMN public.likeness_candidates.batch_id IS 'UUID linking candidates to a single generation batch';
COMMENT ON COLUMN public.likeness_candidates.candidate_index IS 'Zero-based index of candidate within batch (for ordering)';
COMMENT ON COLUMN public.likeness_candidates.storage_path IS 'Path in temp-candidates bucket (format: {user_id}/{batch_id}/candidates/{index}.png)';
COMMENT ON COLUMN public.likeness_candidates.identity_summary IS 'AI-generated identity summary from stage 1 model';
