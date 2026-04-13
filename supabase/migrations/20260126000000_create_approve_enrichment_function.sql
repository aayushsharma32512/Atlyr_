-- Function to approve an outfit enrichment draft
-- Atomically copies enriched fields to outfits table and marks draft as approved
-- SECURITY DEFINER allows the function to bypass RLS when called by authenticated users

CREATE OR REPLACE FUNCTION public.approve_outfit_enrichment_draft(draft_id UUID, reviewer_id UUID) 
RETURNS JSONB 
SECURITY DEFINER 
LANGUAGE plpgsql 
AS $$
DECLARE
  draft_record public.outfit_enrichment_drafts%ROWTYPE;
  target_outfit_id TEXT;
BEGIN
  -- Check reviewer is admin (using profiles.role, not user_roles)
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = reviewer_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  
  -- Get draft and validate
  SELECT * INTO draft_record FROM public.outfit_enrichment_drafts WHERE id = draft_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'draft_not_found');
  END IF;
  IF draft_record.approval_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed');
  END IF;
  
  target_outfit_id := draft_record.outfit_id;
  
  -- Update outfits table with enriched fields
  UPDATE public.outfits SET 
    enriched_fit = draft_record.enriched_fit,
    enriched_feel = draft_record.enriched_feel,
    enriched_word_association = draft_record.enriched_word_association,
    enriched_description = draft_record.enriched_description,
    enriched_vibes = draft_record.enriched_vibes,
    updated_at = now()
  WHERE id = target_outfit_id;
  
  -- Update draft status
  UPDATE public.outfit_enrichment_drafts SET 
    approval_status = 'approved',
    reviewed_by = reviewer_id,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = draft_id;
  
  RETURN jsonb_build_object('success', true, 'outfit_id', target_outfit_id);
END;
$$;

-- Grant execute permission to authenticated users (RLS check is inside the function)
GRANT EXECUTE ON FUNCTION public.approve_outfit_enrichment_draft(UUID, UUID) TO authenticated;
