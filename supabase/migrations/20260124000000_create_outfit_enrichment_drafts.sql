-- Create outfit_enrichment_drafts table for AI-generated enrichment staging
-- Drafts are reviewed by admin before being promoted to outfits table

CREATE TABLE IF NOT EXISTS public.outfit_enrichment_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id TEXT NOT NULL REFERENCES public.outfits(id) ON DELETE CASCADE,
  
  -- Enriched fields (AI-generated, pending review)
  enriched_fit TEXT,
  enriched_feel TEXT[],
  enriched_word_association TEXT,
  enriched_description TEXT,
  enriched_vibes TEXT[],
  
  -- Model metadata for traceability
  model_name TEXT NOT NULL,
  model_version TEXT,
  prompt_version TEXT NOT NULL,
  raw_response JSONB NOT NULL,
  
  -- Review workflow
  approval_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT valid_approval_status CHECK (approval_status IN ('pending', 'approved', 'rejected'))
);

-- Indexes for common query patterns
CREATE INDEX idx_drafts_approval_status ON public.outfit_enrichment_drafts(approval_status);
CREATE INDEX idx_drafts_outfit_id ON public.outfit_enrichment_drafts(outfit_id);
CREATE INDEX idx_drafts_created_at ON public.outfit_enrichment_drafts(created_at DESC);

-- Only one pending draft per outfit (idempotent enrichment)
CREATE UNIQUE INDEX idx_drafts_unique_pending ON public.outfit_enrichment_drafts(outfit_id) 
  WHERE approval_status = 'pending';

-- Enable Row Level Security
ALTER TABLE public.outfit_enrichment_drafts ENABLE ROW LEVEL SECURITY;

-- Admin-only access policy (uses profiles.role, not separate user_roles table)
CREATE POLICY "Admins can manage drafts" 
  ON public.outfit_enrichment_drafts 
  FOR ALL 
  TO authenticated 
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION public.update_outfit_enrichment_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_outfit_enrichment_drafts_updated_at
  BEFORE UPDATE ON public.outfit_enrichment_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_outfit_enrichment_drafts_updated_at();
