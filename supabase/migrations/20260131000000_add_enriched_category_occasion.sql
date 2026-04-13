-- Add enriched_category and enriched_occasion columns to outfits table

ALTER TABLE public.outfits 
  ADD COLUMN IF NOT EXISTS enriched_category TEXT REFERENCES public.categories(id),
  ADD COLUMN IF NOT EXISTS enriched_occasion TEXT REFERENCES public.occasions(id);

-- Update approve function to set enriched_category/occasion (keeping all existing behavior)
CREATE OR REPLACE FUNCTION public.approve_outfit_enrichment_draft(draft_id UUID, reviewer_id UUID) 
RETURNS JSONB 
SECURITY DEFINER 
LANGUAGE plpgsql 
AS $$
DECLARE
  draft_record public.outfit_enrichment_drafts%ROWTYPE;
  target_outfit_id TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = reviewer_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  
  SELECT * INTO draft_record FROM public.outfit_enrichment_drafts WHERE id = draft_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'draft_not_found');
  END IF;
  IF draft_record.approval_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;
  
  target_outfit_id := draft_record.outfit_id;
  
  UPDATE public.outfits SET 
    -- Existing enriched fields
    enriched_fit = draft_record.enriched_fit,
    enriched_feel = draft_record.enriched_feel,
    enriched_word_association = draft_record.enriched_word_association,
    enriched_description = draft_record.enriched_description,
    enriched_vibes = draft_record.enriched_vibes,
    -- NEW: category/occasion go to enriched columns instead of overwriting user values
    enriched_category = CASE WHEN draft_record.suggested_category IS NOT NULL 
                             THEN draft_record.suggested_category 
                             ELSE enriched_category END,
    enriched_occasion = CASE WHEN draft_record.suggested_occasion IS NOT NULL 
                             THEN draft_record.suggested_occasion 
                             ELSE enriched_occasion END,
    -- Suggested name still updates name field
    name = CASE WHEN draft_record.suggested_name IS NOT NULL 
                THEN draft_record.suggested_name 
                ELSE name END,
    -- V2 enrichment fields
    analyzed_occasions = draft_record.analyzed_occasions,
    components_list = draft_record.components_list,
    search_summary = draft_record.search_summary,
    updated_at = now()
  WHERE id = target_outfit_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update outfit %', target_outfit_id;
  END IF;
  
  UPDATE public.outfit_enrichment_drafts SET 
    approval_status = 'approved',
    reviewed_by = reviewer_id,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = draft_id;
  
  RETURN jsonb_build_object('success', true, 'outfit_id', target_outfit_id);
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', 'transaction_failed', 'detail', SQLERRM);
END;
$$;
