-- An import is never finished: after Studio the user can come back, change picks, and open Studio
-- again with a new draft. The latest draft wins.
CREATE OR REPLACE FUNCTION public.open_inspiration_import_in_studio(
  p_import_id uuid,
  p_outfit_id text,
  p_top_product_id text DEFAULT NULL,
  p_bottom_product_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_import public.inspiration_imports%ROWTYPE;
  v_outfit public.outfits%ROWTYPE;
  v_top_candidate_id uuid;
  v_bottom_candidate_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_top_product_id IS NULL AND p_bottom_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_import
  FROM public.inspiration_imports
  WHERE id = p_import_id AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_import.status NOT IN ('candidate_selected', 'ready', 'selections_staged', 'committed') THEN
    RAISE EXCEPTION 'invalid_open_studio_state' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_outfit
  FROM public.outfits
  WHERE id = p_outfit_id AND user_id = auth.uid();
  IF NOT FOUND
    OR v_outfit.top_id IS DISTINCT FROM p_top_product_id
    OR v_outfit.bottom_id IS DISTINCT FROM p_bottom_product_id THEN
    RAISE EXCEPTION 'invalid_studio_outfit' USING ERRCODE = 'P0001';
  END IF;

  IF p_top_product_id IS NOT NULL THEN
    SELECT candidate.id INTO v_top_candidate_id
    FROM public.inspiration_import_candidates candidate
    JOIN public.products product
      ON product.id = p_top_product_id
     AND product.type::text = candidate.category
    WHERE candidate.import_id = p_import_id
      AND candidate.selected_at IS NOT NULL
      AND candidate.category = 'top';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_top_product' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_bottom_product_id IS NOT NULL THEN
    SELECT candidate.id INTO v_bottom_candidate_id
    FROM public.inspiration_import_candidates candidate
    JOIN public.products product
      ON product.id = p_bottom_product_id
     AND product.type::text = candidate.category
    WHERE candidate.import_id = p_import_id
      AND candidate.selected_at IS NOT NULL
      AND candidate.category = 'bottom';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_bottom_product' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  DELETE FROM public.inspiration_import_selections
  WHERE import_id = p_import_id AND source = 'catalogue';

  IF p_top_product_id IS NOT NULL THEN
    INSERT INTO public.inspiration_import_selections(
      import_id, candidate_id, source, product_id, status, outfit_id
    ) VALUES (
      p_import_id, v_top_candidate_id, 'catalogue', p_top_product_id,
      'opened_in_studio', p_outfit_id
    );
  END IF;

  IF p_bottom_product_id IS NOT NULL THEN
    INSERT INTO public.inspiration_import_selections(
      import_id, candidate_id, source, product_id, status, outfit_id
    ) VALUES (
      p_import_id, v_bottom_candidate_id, 'catalogue', p_bottom_product_id,
      'opened_in_studio', p_outfit_id
    );
  END IF;

  UPDATE public.inspiration_imports
  SET status = 'committed',
      studio_outfit_id = p_outfit_id,
      error_code = NULL,
      error_message = NULL
  WHERE id = p_import_id;

  RETURN jsonb_build_object(
    'outfitId', p_outfit_id,
    'topId', p_top_product_id,
    'bottomId', p_bottom_product_id
  );
END;
$$;
