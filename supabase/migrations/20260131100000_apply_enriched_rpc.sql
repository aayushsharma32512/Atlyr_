-- Create RPC function to apply enriched values to outfit (admin only)
CREATE OR REPLACE FUNCTION public.apply_enriched_to_outfit(p_outfit_id TEXT) 
RETURNS JSONB 
SECURITY DEFINER 
LANGUAGE plpgsql 
AS $$
DECLARE
  outfit_record RECORD;
  caller_id UUID;
BEGIN
  -- Get current user
  caller_id := auth.uid();
  
  -- Check caller is admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = caller_id AND role = 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;
  
  -- Fetch outfit enriched values
  SELECT enriched_category, enriched_occasion INTO outfit_record
  FROM public.outfits WHERE id = p_outfit_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'outfit_not_found');
  END IF;
  
  IF outfit_record.enriched_category IS NULL AND outfit_record.enriched_occasion IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_enriched_values');
  END IF;
  
  -- Update outfit with enriched values
  UPDATE public.outfits SET 
    category = COALESCE(outfit_record.enriched_category, category),
    occasion = COALESCE(outfit_record.enriched_occasion, occasion),
    updated_at = now()
  WHERE id = p_outfit_id;
  
  RETURN jsonb_build_object('success', true, 'outfit_id', p_outfit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_enriched_to_outfit(TEXT) TO authenticated;
