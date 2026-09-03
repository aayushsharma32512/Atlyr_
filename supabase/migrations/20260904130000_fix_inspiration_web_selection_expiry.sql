-- Preserve the signed web-result expiry when staging final selections.
-- The previous function inserted NULL into the NOT NULL expires_at column.

CREATE OR REPLACE FUNCTION public.stage_inspiration_import_selections(
  p_user_id uuid,
  p_import_id uuid,
  p_catalogue_results jsonb,
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
  v_seen_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_web_selection_ids uuid[] := ARRAY[]::uuid[];
  v_total_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_catalogue_results) <> 'array'
    OR jsonb_typeof(p_web_results) <> 'array' THEN
    RAISE EXCEPTION 'invalid_selections' USING ERRCODE = '22023';
  END IF;

  v_total_count := jsonb_array_length(p_catalogue_results) + jsonb_array_length(p_web_results);
  IF v_total_count NOT BETWEEN 1 AND 2 OR jsonb_array_length(p_web_results) < 1 THEN
    RAISE EXCEPTION 'invalid_selections' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_import
  FROM public.inspiration_imports
  WHERE id = p_import_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_import.status NOT IN ('candidate_selected', 'ready', 'selections_staged') THEN
    RAISE EXCEPTION 'invalid_selection_state' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.inspiration_import_selections
  WHERE import_id = p_import_id;

  DELETE FROM public.inspiration_import_web_results
  WHERE import_id = p_import_id;

  FOR v_result IN SELECT value FROM jsonb_array_elements(p_catalogue_results) LOOP
    IF jsonb_typeof(v_result) <> 'object'
      OR coalesce(v_result->>'candidateId', '') = ''
      OR coalesce(v_result->>'productId', '') = '' THEN
      RAISE EXCEPTION 'invalid_catalogue_selection' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_candidate_id := (v_result->>'candidateId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_catalogue_selection' USING ERRCODE = '22023';
    END;

    IF v_candidate_id = ANY(v_seen_candidate_ids)
      OR NOT EXISTS (
        SELECT 1
        FROM public.inspiration_import_candidates candidate
        JOIN public.products product
          ON product.id = v_result->>'productId'
         AND product.type::text = candidate.category
        WHERE candidate.id = v_candidate_id
          AND candidate.import_id = p_import_id
          AND candidate.selected_at IS NOT NULL
      ) THEN
      RAISE EXCEPTION 'invalid_catalogue_selection' USING ERRCODE = 'P0001';
    END IF;

    v_seen_candidate_ids := array_append(v_seen_candidate_ids, v_candidate_id);
    INSERT INTO public.inspiration_import_selections(
      import_id, candidate_id, source, product_id, status
    ) VALUES (
      p_import_id, v_candidate_id, 'catalogue', v_result->>'productId', 'selected_for_outfit'
    );
  END LOOP;

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

    IF v_rank < 0
      OR v_expires_at <= now()
      OR v_candidate_id = ANY(v_seen_candidate_ids)
      OR NOT EXISTS (
        SELECT 1
        FROM public.inspiration_import_candidates candidate
        WHERE candidate.id = v_candidate_id
          AND candidate.import_id = p_import_id
          AND candidate.selected_at IS NOT NULL
      ) THEN
      RAISE EXCEPTION 'invalid_web_result' USING ERRCODE = 'P0001';
    END IF;

    v_seen_candidate_ids := array_append(v_seen_candidate_ids, v_candidate_id);

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

    v_web_selection_ids := array_append(v_web_selection_ids, v_selection_id);
  END LOOP;

  UPDATE public.inspiration_imports
  SET status = 'selections_staged',
      error_code = NULL,
      error_message = NULL
  WHERE id = p_import_id;

  RETURN jsonb_build_object(
    'selectionCount', v_total_count,
    'webSelectionIds', to_jsonb(v_web_selection_ids)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stage_inspiration_import_selections(uuid, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stage_inspiration_import_selections(uuid, uuid, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.stage_inspiration_import_selections(uuid, uuid, jsonb, jsonb) IS
  'Atomically persists final selected web URLs, signed expiry, and catalogue product IDs without starting ingestion.';
