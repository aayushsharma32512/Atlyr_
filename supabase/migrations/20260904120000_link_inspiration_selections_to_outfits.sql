-- Incremental follow-up to the already-deployed 20260904090000 migration.
-- Persist the complete final catalogue/web selection set, but do not trigger
-- ingestion or create an outfit for a web-containing selection.

ALTER TABLE public.inspiration_import_selections
  ADD COLUMN outfit_id text REFERENCES public.outfits(id) ON DELETE SET NULL;

ALTER TABLE public.inspiration_imports
  DROP CONSTRAINT inspiration_imports_status_check,
  ADD CONSTRAINT inspiration_imports_status_check CHECK (status IN (
    'created', 'source_ready', 'detecting', 'detected', 'candidate_selected',
    'retrieving', 'ready', 'selections_staged', 'committed', 'failed', 'expired'
  ));

ALTER TABLE public.inspiration_import_selections
  DROP CONSTRAINT inspiration_import_selections_status_check,
  ADD CONSTRAINT inspiration_import_selections_status_check CHECK (status IN (
    'opened_in_studio', 'added_to_wardrobe', 'selected_for_outfit',
    'selected_for_ingestion', 'queued', 'ingesting', 'ingested', 'failed'
  ));

CREATE INDEX inspiration_import_selections_outfit_idx
  ON public.inspiration_import_selections(outfit_id)
  WHERE outfit_id IS NOT NULL;

-- Link existing inventory-only imports opened by 20260904090000 to their
-- already-created Studio outfit.
UPDATE public.inspiration_import_selections selection
SET outfit_id = import_row.studio_outfit_id
FROM public.inspiration_imports import_row
WHERE import_row.id = selection.import_id
  AND import_row.studio_outfit_id IS NOT NULL
  AND selection.status = 'opened_in_studio';

-- The former commit RPC added catalogue products directly to Wardrobe. The
-- old web finalizer persisted only web rows. Both are superseded by the atomic
-- complete-selection staging RPC below.
DROP FUNCTION IF EXISTS public.commit_inspiration_import(uuid, text[], uuid);
DROP FUNCTION IF EXISTS public.finalize_inspiration_web_selections(uuid, uuid, jsonb);

ALTER TABLE public.inspiration_import_selections
  DROP COLUMN wardrobe_added_at;

CREATE FUNCTION public.stage_inspiration_import_selections(
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
  v_seen_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_web_selection_ids uuid[] := ARRAY[]::uuid[];
  v_total_count integer;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
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
      OR coalesce(v_result->>'imageUrl', '') !~ '^https?://' THEN
      RAISE EXCEPTION 'invalid_web_result' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_candidate_id := (v_result->>'candidateId')::uuid;
      v_rank := (v_result->>'rank')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_web_result' USING ERRCODE = '22023';
    END;

    IF v_rank < 0
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
      v_result->>'imageUrl', NULL
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

-- Inventory-only imports can still open immediately. This replacement
-- deliberately contains no web-ingestion or post-ingestion behavior.
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
  IF v_import.status <> 'committed'
    AND v_import.status NOT IN ('candidate_selected', 'ready') THEN
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
  WHERE import_id = p_import_id;

  DELETE FROM public.inspiration_import_web_results
  WHERE import_id = p_import_id;

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

REVOKE EXECUTE ON FUNCTION public.open_inspiration_import_in_studio(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_inspiration_import_in_studio(uuid, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.stage_inspiration_import_selections(uuid, uuid, jsonb, jsonb) IS
  'Atomically persists final selected web URLs and catalogue product IDs without starting ingestion.';

COMMENT ON COLUMN public.inspiration_import_selections.outfit_id IS
  'Private Studio draft containing an inventory-only Inspiration Import selection.';
