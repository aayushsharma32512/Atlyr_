-- Add applied_at column to outfit_enrichment_drafts to track when values are applied to outfit
ALTER TABLE public.outfit_enrichment_drafts
ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- Update the apply_enriched_to_outfit function to set applied_at on the draft
-- This version merges the new tracking logic with the existing logic for fit, feel, and vibes
CREATE OR REPLACE FUNCTION public.apply_enriched_to_outfit(p_outfit_id TEXT) 
RETURNS JSONB 
SECURITY DEFINER 
LANGUAGE plpgsql 
AS $$
DECLARE
  outfit_record RECORD;
  caller_id UUID;
  draft_id UUID;
BEGIN
  -- Get current user
  caller_id := auth.uid();
  
  -- Check caller is admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = caller_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- 1. Find the latest approved draft for this outfit to mark as applied
  SELECT id INTO draft_id
  FROM public.outfit_enrichment_drafts
  WHERE outfit_id = p_outfit_id 
    AND approval_status = 'approved'
  ORDER BY updated_at DESC
  LIMIT 1;
  
  -- 2. Fetch outfit enriched values
  SELECT 
    enriched_category, 
    enriched_occasion,
    enriched_fit,
    enriched_feel,
    enriched_vibes
  INTO outfit_record
  FROM public.outfits WHERE id = p_outfit_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'outfit_not_found');
  END IF;
  
  IF outfit_record.enriched_category IS NULL AND 
     outfit_record.enriched_occasion IS NULL AND 
     outfit_record.enriched_fit IS NULL AND 
     outfit_record.enriched_feel IS NULL AND 
     outfit_record.enriched_vibes IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_enriched_values');
  END IF;
  
  -- 3. Update outfit with enriched values
  -- Convert arrays to comma-separated strings for fit, feel, vibes
  UPDATE public.outfits SET 
    category = COALESCE(outfit_record.enriched_category, category),
    occasion = COALESCE(outfit_record.enriched_occasion, occasion),
    fit = CASE 
      WHEN outfit_record.enriched_fit IS NOT NULL THEN array_to_string(outfit_record.enriched_fit, ', ')
      ELSE fit
    END,
    feel = CASE 
      WHEN outfit_record.enriched_feel IS NOT NULL THEN array_to_string(outfit_record.enriched_feel, ', ')
      ELSE feel
    END,
    vibes = CASE 
      WHEN outfit_record.enriched_vibes IS NOT NULL THEN array_to_string(outfit_record.enriched_vibes, ', ')
      ELSE vibes
    END,
    updated_at = now()
  WHERE id = p_outfit_id;

  -- 4. Update the draft if found (mark as applied)
  IF draft_id IS NOT NULL THEN
    UPDATE public.outfit_enrichment_drafts
    SET applied_at = now(),
        updated_at = now()
    WHERE id = draft_id;
  END IF;
  
  RETURN jsonb_build_object('success', true, 'outfit_id', p_outfit_id, 'draft_id', draft_id);
END;
$$;
