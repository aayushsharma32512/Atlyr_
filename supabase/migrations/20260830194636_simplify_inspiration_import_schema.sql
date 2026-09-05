-- One Inspiration Import now represents one immutable source image and one
-- detection result set. Source edits/crops create a new import instead of
-- versioning an existing row. Retention is derived from created_at and status.
-- Candidates keep one retrieval crop for both preview and search, and a
-- confirmed selection may contain at most one top and one bottom.

DROP FUNCTION public.begin_inspiration_detection(uuid, integer);
DROP FUNCTION public.finalize_inspiration_detection(uuid, integer, uuid, uuid, jsonb, text, text);
DROP FUNCTION public.select_inspiration_candidate(uuid, uuid);
DROP FUNCTION public.reserve_inspiration_provider_call(uuid, text, integer);
DROP FUNCTION public.complete_inspiration_provider_call(uuid);
DROP FUNCTION public.release_inspiration_provider_call(uuid);

DROP INDEX public.inspiration_import_candidates_import_generation_idx;
DROP INDEX public.inspiration_import_candidates_one_selected_idx;

ALTER TABLE public.inspiration_imports
  DROP CONSTRAINT inspiration_import_commit_shape,
  DROP COLUMN source_origin,
  DROP COLUMN crop,
  DROP COLUMN generation,
  DROP COLUMN committed_at,
  DROP COLUMN expires_at;

ALTER TABLE public.inspiration_import_candidates
  DROP COLUMN generation,
  DROP COLUMN display_crop_path;

ALTER TABLE public.inspiration_import_web_results
  DROP COLUMN price,
  DROP COLUMN currency,
  DROP COLUMN in_stock,
  DROP COLUMN snapshot;

DROP TABLE public.inspiration_import_provider_calls;

CREATE INDEX inspiration_import_candidates_import_created_idx
  ON public.inspiration_import_candidates(import_id, created_at);

CREATE UNIQUE INDEX inspiration_import_candidates_one_selected_per_category_idx
  ON public.inspiration_import_candidates(import_id, category)
  WHERE selected_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.begin_inspiration_detection(
  p_import_id uuid, p_lease_seconds integer DEFAULT 600
) RETURNS TABLE(attempt_id uuid, source_path text, started boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_import public.inspiration_imports%ROWTYPE; v_attempt uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_import FROM public.inspiration_imports
    WHERE id = p_import_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'detecting' AND v_import.detection_started_at > now() - make_interval(secs => p_lease_seconds) THEN
    RETURN QUERY SELECT v_import.detection_attempt_id, v_import.source_path, false;
    RETURN;
  END IF;
  IF v_import.status NOT IN ('source_ready', 'failed', 'detecting') THEN
    RAISE EXCEPTION 'invalid_detection_state' USING ERRCODE = 'P0001';
  END IF;
  v_attempt := gen_random_uuid();
  UPDATE public.inspiration_imports SET status = 'detecting', detection_attempt_id = v_attempt,
    detection_started_at = now(), detector_job_id = NULL, error_code = NULL, error_message = NULL
    WHERE id = p_import_id;
  RETURN QUERY SELECT v_attempt, v_import.source_path, true;
END $$;

CREATE FUNCTION public.select_inspiration_candidates(p_import_id uuid, p_candidate_ids uuid[])
RETURNS TABLE(selected_candidate_id uuid, category text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_candidate_count integer; v_category_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.inspiration_imports
    WHERE id = p_import_id AND user_id = auth.uid() AND status IN ('detected', 'candidate_selected', 'ready')
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_candidate_state' USING ERRCODE = 'P0001'; END IF;
  IF p_candidate_ids IS NULL OR cardinality(p_candidate_ids) NOT BETWEEN 1 AND 2
    OR array_position(p_candidate_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_candidate_selection' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), count(DISTINCT c.category)
    INTO v_candidate_count, v_category_count
    FROM public.inspiration_import_candidates c
    WHERE c.import_id = p_import_id AND c.id = ANY(p_candidate_ids);
  IF v_candidate_count <> cardinality(p_candidate_ids) THEN
    RAISE EXCEPTION 'candidate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_category_count <> v_candidate_count THEN
    RAISE EXCEPTION 'duplicate_candidate_category' USING ERRCODE = '22023';
  END IF;
  UPDATE public.inspiration_import_candidates SET selected_at = NULL
    WHERE import_id = p_import_id AND selected_at IS NOT NULL;
  UPDATE public.inspiration_import_candidates SET selected_at = now()
    WHERE import_id = p_import_id AND id = ANY(p_candidate_ids);
  DELETE FROM public.inspiration_import_web_results
    WHERE import_id = p_import_id AND NOT (candidate_id = ANY(p_candidate_ids));
  UPDATE public.inspiration_imports SET status = 'candidate_selected', error_code = NULL, error_message = NULL
    WHERE id = p_import_id;
  RETURN QUERY
    SELECT c.id, c.category
    FROM public.inspiration_import_candidates c
    WHERE c.import_id = p_import_id AND c.id = ANY(p_candidate_ids)
    ORDER BY CASE c.category WHEN 'top' THEN 0 ELSE 1 END;
END $$;

CREATE OR REPLACE FUNCTION public.commit_inspiration_import(
  p_import_id uuid, p_catalogue_product_ids text[], p_web_result_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_import public.inspiration_imports%ROWTYPE; v_candidate_id uuid;
  v_candidate_count integer; v_product_ids text[]; v_existing text[];
  v_product_id text; v_web_selection_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_import FROM public.inspiration_imports
    WHERE id = p_import_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT count(*) INTO v_candidate_count FROM public.inspiration_import_candidates
    WHERE import_id = p_import_id AND selected_at IS NOT NULL;
  IF v_candidate_count = 0 THEN RAISE EXCEPTION 'candidate_required' USING ERRCODE = 'P0001'; END IF;
  IF v_import.status NOT IN ('candidate_selected', 'ready') THEN
    RAISE EXCEPTION 'invalid_commit_state' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(array_agg(DISTINCT value), ARRAY[]::text[]) INTO v_product_ids
    FROM unnest(coalesce(p_catalogue_product_ids, ARRAY[]::text[])) value;
  IF cardinality(v_product_ids) > 30 THEN RAISE EXCEPTION 'too_many_products' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*)
      FROM public.products p
      JOIN public.inspiration_import_candidates c
        ON c.import_id = p_import_id
       AND c.selected_at IS NOT NULL
       AND c.category = p.type::text
      WHERE p.id = ANY(v_product_ids)) <> cardinality(v_product_ids) THEN
    RAISE EXCEPTION 'invalid_products' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(array_agg(product_id), ARRAY[]::text[]) INTO v_existing
    FROM public.user_favorites
    WHERE user_id = auth.uid() AND collection_slug = 'wardrobe' AND product_id = ANY(v_product_ids);
  FOREACH v_product_id IN ARRAY v_product_ids LOOP
    SELECT c.id INTO STRICT v_candidate_id
      FROM public.inspiration_import_candidates c
      JOIN public.products p ON p.id = v_product_id AND p.type::text = c.category
      WHERE c.import_id = p_import_id AND c.selected_at IS NOT NULL;
    INSERT INTO public.user_favorites(id, user_id, outfit_id, product_id, collection_slug, collection_label)
      VALUES (gen_random_uuid(), auth.uid(), NULL, v_product_id, 'wardrobe', 'Wardrobe')
      ON CONFLICT (user_id, collection_slug, product_id) DO NOTHING;
    INSERT INTO public.inspiration_import_selections(
      id, import_id, candidate_id, source, product_id, status, wardrobe_added_at
    ) VALUES (gen_random_uuid(), p_import_id, v_candidate_id, 'catalogue', v_product_id, 'added_to_wardrobe', now())
      ON CONFLICT DO NOTHING;
  END LOOP;
  IF p_web_result_id IS NOT NULL THEN
    SELECT wr.candidate_id INTO v_candidate_id
      FROM public.inspiration_import_web_results wr
      JOIN public.inspiration_import_candidates c
        ON c.id = wr.candidate_id AND c.import_id = wr.import_id AND c.selected_at IS NOT NULL
      WHERE wr.id = p_web_result_id AND wr.import_id = p_import_id AND wr.expires_at > now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_web_result' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.inspiration_import_selections WHERE import_id = p_import_id AND source = 'web';
    v_web_selection_id := gen_random_uuid();
    INSERT INTO public.inspiration_import_selections(
      id, import_id, candidate_id, source, web_result_id, status
    ) VALUES (v_web_selection_id, p_import_id, v_candidate_id, 'web', p_web_result_id, 'selected_for_ingestion');
  END IF;
  UPDATE public.inspiration_imports SET status = 'committed', error_code = NULL, error_message = NULL
    WHERE id = p_import_id;
  RETURN jsonb_build_object(
    'catalogue', jsonb_build_object(
      'addedProductIds', to_jsonb(ARRAY(SELECT unnest(v_product_ids) EXCEPT SELECT unnest(v_existing))),
      'alreadyPresentProductIds', to_jsonb(v_existing)
    ),
    'web', CASE WHEN p_web_result_id IS NULL THEN NULL ELSE jsonb_build_object(
      'selectionId', v_web_selection_id, 'status', 'selected_for_ingestion'
    ) END
  );
END $$;

-- Internal callback: service_role only. A stale attempt returns false and does not mutate state.
CREATE OR REPLACE FUNCTION public.finalize_inspiration_detection(
  p_import_id uuid, p_attempt_id uuid, p_candidates jsonb DEFAULT '[]'::jsonb,
  p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_import public.inspiration_imports%ROWTYPE; v_candidate jsonb;
BEGIN
  SELECT * INTO v_import FROM public.inspiration_imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND OR v_import.status <> 'detecting'
    OR v_import.detection_attempt_id IS DISTINCT FROM p_attempt_id THEN RETURN false; END IF;
  IF p_error_code IS NOT NULL THEN
    UPDATE public.inspiration_imports SET status = 'failed', error_code = left(p_error_code, 80),
      error_message = left(coalesce(p_error_message, 'Garment detection failed'), 300) WHERE id = p_import_id;
    RETURN true;
  END IF;
  IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 12 THEN
    RAISE EXCEPTION 'invalid_candidate_payload' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.inspiration_import_candidates WHERE import_id = p_import_id;
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
    INSERT INTO public.inspiration_import_candidates(
      id, import_id, category, detector_label, confidence, bbox, box_source,
      retrieval_crop_path, metrics
    ) VALUES (
      (v_candidate->>'id')::uuid, p_import_id, v_candidate->>'category',
      nullif(v_candidate->>'label', ''), (v_candidate->>'confidence')::real,
      v_candidate->'bbox', v_candidate->>'boxSource', v_candidate->>'retrievalCropPath',
      coalesce(v_candidate->'metrics', '{}'::jsonb)
    );
  END LOOP;
  UPDATE public.inspiration_imports SET status = 'detected', error_code = NULL, error_message = NULL
    WHERE id = p_import_id;
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.begin_inspiration_detection(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.select_inspiration_candidates(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_inspiration_import(uuid, text[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_inspiration_detection(uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_inspiration_detection(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.select_inspiration_candidates(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_inspiration_import(uuid, text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_inspiration_detection(uuid, uuid, jsonb, text, text) TO service_role;

COMMENT ON FUNCTION public.finalize_inspiration_detection(uuid, uuid, jsonb, text, text) IS
  'Service-only compare-and-set finalizer for Modal callbacks.';
