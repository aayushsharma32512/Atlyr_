-- Add new enrichment fields and missing occasions for Fashion Director prompt
-- These support the new prompt with component inventory, occasions analysis, and search summary

-- 1. Add new occasions to support enrichment prompt options
INSERT INTO public.occasions (id, name, slug, background_url, description)
VALUES 
  ('business-casual', 'Business Casual', 'business-casual', '/Backgrounds/7.png', 'Smart casual looks bridging professional and relaxed styles'),
  ('important-event', 'Important Event', 'important-event', '/Backgrounds/12.png', 'Special occasion attire for significant events'),
  ('office-wear', 'Office Wear', 'office-wear', '/Backgrounds/7.png', 'Professional workplace attire for daily office settings'),
  ('default', 'Default', 'default', '/Backgrounds/8.png', 'General purpose fallback occasion')
ON CONFLICT (id) DO NOTHING;

-- 2. Add new columns to drafts table
ALTER TABLE public.outfit_enrichment_drafts 
  ADD COLUMN IF NOT EXISTS analyzed_occasions TEXT[],
  ADD COLUMN IF NOT EXISTS components_list TEXT[],
  ADD COLUMN IF NOT EXISTS search_summary TEXT;

-- 3. Add new columns to outfits table for when drafts get approved
ALTER TABLE public.outfits 
  ADD COLUMN IF NOT EXISTS analyzed_occasions TEXT[],
  ADD COLUMN IF NOT EXISTS components_list TEXT[],
  ADD COLUMN IF NOT EXISTS search_summary TEXT;

-- 4. Update the approve function to copy the new fields
-- #2 FIX: Added proper exception handling for transaction rollback
-- #6 FIX: Changed COALESCE to CASE WHEN to only update when value exists
CREATE OR REPLACE FUNCTION public.approve_outfit_enrichment_draft(draft_id UUID, reviewer_id UUID) 
RETURNS JSONB 
SECURITY DEFINER 
LANGUAGE plpgsql 
AS $$
DECLARE
  draft_record public.outfit_enrichment_drafts%ROWTYPE;
  target_outfit_id TEXT;
  outfit_update_count INT;
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
  
  -- Update outfits table with enriched fields AND suggested fields
  -- #6 FIX: Only update suggested fields if they have values (not NULL)
  UPDATE public.outfits SET 
    -- Existing enriched fields (always copied)
    enriched_fit = draft_record.enriched_fit,
    enriched_feel = draft_record.enriched_feel,
    enriched_word_association = draft_record.enriched_word_association,
    enriched_description = draft_record.enriched_description,
    enriched_vibes = draft_record.enriched_vibes,
    -- Suggested fields: only update if draft has a value
    name = CASE WHEN draft_record.suggested_name IS NOT NULL 
                THEN draft_record.suggested_name 
                ELSE name END,
    category = CASE WHEN draft_record.suggested_category IS NOT NULL 
                    THEN draft_record.suggested_category 
                    ELSE category END,
    occasion = CASE WHEN draft_record.suggested_occasion IS NOT NULL 
                    THEN draft_record.suggested_occasion 
                    ELSE occasion END,
    -- New fields
    analyzed_occasions = draft_record.analyzed_occasions,
    components_list = draft_record.components_list,
    search_summary = draft_record.search_summary,
    updated_at = now()
  WHERE id = target_outfit_id;
  
  -- #2 FIX: Verify outfit was actually updated
  GET DIAGNOSTICS outfit_update_count = ROW_COUNT;
  IF outfit_update_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'outfit_not_found');
  END IF;
  
  -- Update draft status
  UPDATE public.outfit_enrichment_drafts SET 
    approval_status = 'approved',
    reviewed_by = reviewer_id,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = draft_id;
  
  RETURN jsonb_build_object('success', true, 'outfit_id', target_outfit_id);

-- #2 FIX: Handle exceptions and rollback
EXCEPTION
  WHEN OTHERS THEN
    -- Postgres automatically rolls back on exception
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute permission to authenticated users (RLS check is inside the function)
GRANT EXECUTE ON FUNCTION public.approve_outfit_enrichment_draft(UUID, UUID) TO authenticated;
