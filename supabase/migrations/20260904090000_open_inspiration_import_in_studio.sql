-- Inspiration catalogue choices now create an editable Studio draft instead of
-- implicitly adding every selected product to Wardrobe. Keep the import-to-
-- outfit relationship and its selected products as an audit trail.

ALTER TABLE public.inspiration_imports
  ADD COLUMN studio_outfit_id text REFERENCES public.outfits(id) ON DELETE SET NULL;
CREATE INDEX inspiration_imports_studio_outfit_idx
  ON public.inspiration_imports(studio_outfit_id)
  WHERE studio_outfit_id IS NOT NULL;
ALTER TABLE public.inspiration_import_selections
  DROP CONSTRAINT inspiration_import_selections_status_check,
  ADD CONSTRAINT inspiration_import_selections_status_check CHECK (status IN (
    'opened_in_studio', 'added_to_wardrobe', 'selected_for_ingestion',
    'queued', 'ingesting', 'ingested', 'failed'
  ));
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

  IF v_import.status = 'committed' AND v_import.studio_outfit_id = p_outfit_id THEN
    RETURN jsonb_build_object(
      'outfitId', p_outfit_id,
      'topId', p_top_product_id,
      'bottomId', p_bottom_product_id
    );
  END IF;
  IF v_import.status NOT IN ('candidate_selected', 'ready') THEN
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
    SELECT c.id INTO v_top_candidate_id
    FROM public.inspiration_import_candidates c
    JOIN public.products p
      ON p.id = p_top_product_id AND p.type::text = c.category
    WHERE c.import_id = p_import_id
      AND c.selected_at IS NOT NULL
      AND c.category = 'top';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_top_product' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_bottom_product_id IS NOT NULL THEN
    SELECT c.id INTO v_bottom_candidate_id
    FROM public.inspiration_import_candidates c
    JOIN public.products p
      ON p.id = p_bottom_product_id AND p.type::text = c.category
    WHERE c.import_id = p_import_id
      AND c.selected_at IS NOT NULL
      AND c.category = 'bottom';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_bottom_product' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- A failed/retried web flow may leave durable rows before the user changes the
  -- final choice back to Inventory. Keep web provenance only when its published
  -- product is the product actually being opened for that candidate.
  DELETE FROM public.inspiration_import_selections selection
  USING public.inspiration_import_candidates candidate
  WHERE selection.import_id = p_import_id
    AND selection.source = 'web'
    AND candidate.id = selection.candidate_id
    AND candidate.import_id = selection.import_id
    AND (
      (candidate.category = 'top'
        AND selection.ingested_product_id IS DISTINCT FROM p_top_product_id)
      OR (candidate.category = 'bottom'
        AND selection.ingested_product_id IS DISTINCT FROM p_bottom_product_id)
    );

  DELETE FROM public.inspiration_import_web_results result
  WHERE result.import_id = p_import_id
    AND NOT EXISTS (
      SELECT 1 FROM public.inspiration_import_selections selection
      WHERE selection.web_result_id = result.id
    );

  DELETE FROM public.inspiration_import_selections
  WHERE import_id = p_import_id AND source = 'catalogue';

  IF p_top_product_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.inspiration_import_selections
      WHERE import_id = p_import_id
        AND candidate_id = v_top_candidate_id
        AND source = 'web'
        AND ingested_product_id = p_top_product_id
    ) THEN
      INSERT INTO public.inspiration_import_selections(
        id, import_id, candidate_id, source, product_id, status
      ) VALUES (
        gen_random_uuid(), p_import_id, v_top_candidate_id,
        'catalogue', p_top_product_id, 'opened_in_studio'
      );
    END IF;
  END IF;

  IF p_bottom_product_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.inspiration_import_selections
      WHERE import_id = p_import_id
        AND candidate_id = v_bottom_candidate_id
        AND source = 'web'
        AND ingested_product_id = p_bottom_product_id
    ) THEN
      INSERT INTO public.inspiration_import_selections(
        id, import_id, candidate_id, source, product_id, status
      ) VALUES (
        gen_random_uuid(), p_import_id, v_bottom_candidate_id,
        'catalogue', p_bottom_product_id, 'opened_in_studio'
      );
    END IF;
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
-- Lens result lists and click state are ephemeral browser data. Persist only
-- the final online choices when the user asks to ingest and open them.

DROP INDEX IF EXISTS public.inspiration_import_selections_one_web_idx;
ALTER TABLE public.inspiration_import_web_results
  ALTER COLUMN expires_at DROP NOT NULL;
-- Remove the old one-row-per-search-result cache, preserving any result that
-- already backs an explicit user selection.
DELETE FROM public.inspiration_import_web_results wr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inspiration_import_selections selection
  WHERE selection.web_result_id = wr.id
);
UPDATE public.inspiration_import_web_results wr
SET expires_at = NULL
WHERE EXISTS (
  SELECT 1
  FROM public.inspiration_import_selections selection
  WHERE selection.web_result_id = wr.id
);
CREATE UNIQUE INDEX inspiration_import_selections_one_web_per_candidate_idx
  ON public.inspiration_import_selections(import_id, candidate_id)
  WHERE source = 'web' AND status <> 'failed';
CREATE OR REPLACE FUNCTION public.finalize_inspiration_web_selections(
  p_user_id uuid,
  p_import_id uuid,
  p_results jsonb
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
  v_rank integer;
  v_count integer := 0;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
    OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_import
  FROM public.inspiration_imports
  WHERE id = p_import_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_import.status NOT IN ('candidate_selected', 'ready') THEN
    RAISE EXCEPTION 'invalid_selection_state' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_results) <> 'array'
    OR jsonb_array_length(p_results) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'invalid_web_results' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.inspiration_import_selections
  WHERE import_id = p_import_id
    AND source = 'web';

  DELETE FROM public.inspiration_import_web_results
  WHERE import_id = p_import_id;

  FOR v_result IN SELECT value FROM jsonb_array_elements(p_results) LOOP
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
    IF v_rank < 0 OR NOT EXISTS (
      SELECT 1
      FROM public.inspiration_import_candidates candidate
      WHERE candidate.id = v_candidate_id
        AND candidate.import_id = p_import_id
        AND candidate.selected_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'candidate_required' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.inspiration_import_selections selection
      WHERE selection.import_id = p_import_id
        AND selection.candidate_id = v_candidate_id
        AND selection.source = 'web'
    ) THEN
      RAISE EXCEPTION 'duplicate_web_candidate' USING ERRCODE = '22023';
    END IF;

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
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('selectionCount', v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finalize_inspiration_web_selections(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_inspiration_web_selections(uuid, uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.finalize_inspiration_web_selections(uuid, uuid, jsonb) IS
  'Persists only the final signed web choices immediately before ingestion starts.';
