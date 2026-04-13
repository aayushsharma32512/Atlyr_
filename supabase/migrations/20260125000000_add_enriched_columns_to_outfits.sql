-- Add AI-enriched columns to outfits table
-- These are populated from approved outfit_enrichment_drafts records
-- Separate from existing fit/feel/word_association/description columns (user-curated)

-- Add enriched columns (all nullable)
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS enriched_fit TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS enriched_feel TEXT[];
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS enriched_word_association TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS enriched_description TEXT;
ALTER TABLE public.outfits ADD COLUMN IF NOT EXISTS enriched_vibes TEXT[];

-- Column comments for documentation
COMMENT ON COLUMN public.outfits.enriched_fit IS 'AI-generated fit classification, populated from approved enrichment drafts';
COMMENT ON COLUMN public.outfits.enriched_feel IS 'AI-generated feel tags array, populated from approved enrichment drafts';
COMMENT ON COLUMN public.outfits.enriched_word_association IS 'AI-generated word associations, populated from approved enrichment drafts';
COMMENT ON COLUMN public.outfits.enriched_description IS 'AI-generated outfit description, populated from approved enrichment drafts';
COMMENT ON COLUMN public.outfits.enriched_vibes IS 'AI-generated vibes tags array, populated from approved enrichment drafts';
