-- "Add to Atlyr" and "Studio" are two independent actions on one import.
-- Web picks append to an ingestion request list and never lock the import;
-- opening Studio must keep those web rows so the admin team can still see them.

DROP FUNCTION IF EXISTS public.stage_inspiration_import_selections(uuid, uuid, jsonb, jsonb);

CREATE FUNCTION public.add_inspiration_import_web_selections(
  p_user_id uuid,
  p_import_id uuid,
  p_web_results jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_import public.inspiration_imports%ROWTYPE;
  v_result jsonb;
  v_candidate_id uuid;
  v_web_result_id uuid;
  v_selection_id uuid;
  v_rank integer;
  v_expires_at timestamptz;
  v_added_ids uuid[] := ARRAY[]::uuid[];
  v_skipped integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_web_results) <> 'array'
    OR jsonb_array_length(p_web_results) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'invalid_selections' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_import
  FROM public.inspiration_imports
  WHERE id = p_import_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_import.status NOT IN ('candidate_selected', 'ready', 'selections_staged', 'committed') THEN
    RAISE EXCEPTION 'invalid_selection_state' USING ERRCODE = 'P0001';
  END IF;

  FOR v_result IN SELECT value FROM jsonb_array_elements(p_web_results) LOOP
    IF jsonb_typeof(v_result) <> 'object'
      OR coalesce(v_result->>'candidateId', '') = ''
      OR coalesce(v_result->>'providerResultId', '') = ''
      OR coalesce(v_result->>'title', '') = ''
      OR coalesce(v_result->>'merchantDomain', '') = ''
      OR coalesce(v_result->>'listingUrl', '') !~ '^https?://'
      OR coalesce(v_result->>'imageUrl', '') !~ '^https?://'
      OR jsonb_typeof(v_result->'expiresAt') <> 'number' THEN
      RAISE EXCEPTION 'invalid_web_result' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_candidate_id := (v_result->>'candidateId')::uuid;
      v_rank := (v_result->>'rank')::integer;
      v_expires_at := to_timestamp((v_result->>'expiresAt')::double precision);
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
        RAISE EXCEPTION 'invalid_web_result' USING ERRCODE = '22023';
    END;

    IF v_rank < 0 OR v_expires_at <= now() OR NOT EXISTS (
      SELECT 1 FROM public.inspiration_import_candidates candidate
      WHERE candidate.id = v_candidate_id
        AND candidate.import_id = p_import_id
        AND candidate.selected_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'invalid_web_result' USING ERRCODE = 'P0001';
    END IF;

    -- The same listing added twice from one import is one request, not two.
    IF EXISTS (
      SELECT 1 FROM public.inspiration_import_web_results existing
      WHERE existing.import_id = p_import_id
        AND existing.listing_url = v_result->>'listingUrl'
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.inspiration_import_web_results(
      import_id, candidate_id, provider, provider_result_id, rank, title,
      merchant_domain, listing_url, image_url, expires_at
    ) VALUES (
      p_import_id, v_candidate_id, 'serpapi_google_lens',
      v_result->>'providerResultId', v_rank, v_result->>'title',
      v_result->>'merchantDomain', v_result->>'listingUrl',
      v_result->>'imageUrl', v_expires_at
    ) RETURNING id INTO v_web_result_id;

    INSERT INTO public.inspiration_import_selections(
      import_id, candidate_id, source, web_result_id, status
    ) VALUES (
      p_import_id, v_candidate_id, 'web', v_web_result_id, 'selected_for_ingestion'
    ) RETURNING id INTO v_selection_id;

    v_added_ids := array_append(v_added_ids, v_selection_id);
  END LOOP;

  RETURN jsonb_build_object(
    'addedCount', coalesce(array_length(v_added_ids, 1), 0),
    'skippedCount', v_skipped,
    'webSelectionIds', to_jsonb(v_added_ids)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_inspiration_import_web_selections(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_inspiration_import_web_selections(uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.add_inspiration_import_web_selections(uuid, uuid, jsonb) IS
  'Appends signed web picks as ingestion requests for the Atlyr team. Never changes the import status.';

-- Studio keeps the web rows: only the catalogue picks are replaced.
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
  IF v_import.status = 'committed'
    AND v_import.studio_outfit_id IS DISTINCT FROM p_outfit_id THEN
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

  IF v_import.status = 'committed' THEN
    RETURN jsonb_build_object(
      'outfitId', p_outfit_id,
      'topId', p_top_product_id,
      'bottomId', p_bottom_product_id
    );
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
