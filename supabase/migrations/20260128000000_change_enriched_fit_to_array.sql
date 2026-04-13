-- Change enriched_fit from text to text[] to support multiple fit descriptors
-- This allows LLM to provide multiple fit characteristics (e.g., ["relaxed", "boxy"])

-- Update outfit_enrichment_drafts table
ALTER TABLE outfit_enrichment_drafts
ALTER COLUMN enriched_fit TYPE text[] USING 
  CASE 
    WHEN enriched_fit IS NULL THEN NULL
    WHEN enriched_fit = '' THEN NULL
    ELSE ARRAY[enriched_fit]
  END;

-- Update outfits table
ALTER TABLE outfits
ALTER COLUMN enriched_fit TYPE text[] USING 
  CASE 
    WHEN enriched_fit IS NULL THEN NULL
    WHEN enriched_fit = '' THEN NULL
    ELSE ARRAY[enriched_fit]
  END;

-- Add comment
COMMENT ON COLUMN outfit_enrichment_drafts.enriched_fit IS 'Array of fit descriptors (e.g., ["relaxed", "tailored"])';
COMMENT ON COLUMN outfits.enriched_fit IS 'Array of fit descriptors (e.g., ["relaxed", "tailored"])';
