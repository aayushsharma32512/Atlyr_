-- Durable, user-owned workflow state for image-first Inspiration Import.
-- Browser access is limited to uploading the original image. Workflow tables
-- are private behind Edge Functions and narrowly granted SECURITY DEFINER RPCs.

CREATE TABLE public.inspiration_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('image', 'url')),
  source_path text,
  source_url text,
  source_origin jsonb,
  crop jsonb,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  status text NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'source_ready', 'detecting', 'detected', 'candidate_selected',
    'retrieving', 'ready', 'committed', 'failed', 'expired'
  )),
  detection_attempt_id uuid,
  detection_started_at timestamptz,
  detector_job_id text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  CONSTRAINT inspiration_import_source_shape CHECK (
    (source_kind = 'image' AND source_path IS NOT NULL AND source_url IS NULL)
    OR (source_kind = 'url' AND source_url IS NOT NULL)
  ),
  CONSTRAINT inspiration_import_commit_shape CHECK (
    (status = 'committed' AND committed_at IS NOT NULL AND expires_at IS NULL)
    OR status <> 'committed'
  )
);

CREATE TABLE public.inspiration_import_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.inspiration_imports(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation >= 0),
  category text NOT NULL CHECK (category IN ('top', 'bottom')),
  detector_label text,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  bbox jsonb NOT NULL,
  box_source text NOT NULL CHECK (box_source IN ('fashn_union_dino', 'fashn_only', 'dino_only')),
  display_crop_path text NOT NULL,
  retrieval_crop_path text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_import_candidate_bbox_shape CHECK (
    bbox ?& ARRAY['l', 't', 'w', 'h']
    AND (bbox->>'l')::numeric BETWEEN 0 AND 1
    AND (bbox->>'t')::numeric BETWEEN 0 AND 1
    AND (bbox->>'w')::numeric > 0 AND (bbox->>'w')::numeric <= 1
    AND (bbox->>'h')::numeric > 0 AND (bbox->>'h')::numeric <= 1
  ),
  UNIQUE (import_id, id)
);

CREATE TABLE public.inspiration_import_web_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.inspiration_imports(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'serpapi_google_lens' CHECK (provider = 'serpapi_google_lens'),
  provider_result_id text,
  rank integer NOT NULL CHECK (rank >= 0),
  title text NOT NULL,
  merchant_domain text NOT NULL,
  listing_url text NOT NULL,
  image_url text NOT NULL,
  price numeric,
  currency text,
  in_stock boolean,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (import_id, candidate_id)
    REFERENCES public.inspiration_import_candidates(import_id, id) ON DELETE CASCADE
);

CREATE TABLE public.inspiration_import_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.inspiration_imports(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('catalogue', 'web')),
  product_id text REFERENCES public.products(id) ON DELETE CASCADE,
  web_result_id uuid REFERENCES public.inspiration_import_web_results(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN (
    'added_to_wardrobe', 'selected_for_ingestion', 'queued', 'ingesting', 'ingested', 'failed'
  )),
  ingestion_job_id uuid,
  ingested_product_id text REFERENCES public.products(id) ON DELETE SET NULL,
  wardrobe_added_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_import_selection_source_shape CHECK (
    (source = 'catalogue' AND product_id IS NOT NULL AND web_result_id IS NULL)
    OR (source = 'web' AND product_id IS NULL AND web_result_id IS NOT NULL)
  ),
  FOREIGN KEY (import_id, candidate_id)
    REFERENCES public.inspiration_import_candidates(import_id, id) ON DELETE CASCADE
);

CREATE TABLE public.inspiration_import_provider_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES public.inspiration_imports(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('detect', 'lens')),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'succeeded')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX inspiration_imports_user_created_idx ON public.inspiration_imports(user_id, created_at DESC);
CREATE INDEX inspiration_import_candidates_import_generation_idx
  ON public.inspiration_import_candidates(import_id, generation, created_at);
CREATE UNIQUE INDEX inspiration_import_candidates_one_selected_idx
  ON public.inspiration_import_candidates(import_id) WHERE selected_at IS NOT NULL;
CREATE INDEX inspiration_import_web_results_import_candidate_idx
  ON public.inspiration_import_web_results(import_id, candidate_id, rank);
CREATE INDEX inspiration_import_web_results_candidate_idx ON public.inspiration_import_web_results(candidate_id);
CREATE UNIQUE INDEX inspiration_import_selections_catalogue_idx
  ON public.inspiration_import_selections(import_id, product_id) WHERE source = 'catalogue';
CREATE UNIQUE INDEX inspiration_import_selections_one_web_idx
  ON public.inspiration_import_selections(import_id) WHERE source = 'web' AND status <> 'failed';
CREATE INDEX inspiration_import_selections_import_idx ON public.inspiration_import_selections(import_id);
CREATE INDEX inspiration_import_selections_candidate_idx ON public.inspiration_import_selections(candidate_id);
CREATE INDEX inspiration_import_selections_product_idx
  ON public.inspiration_import_selections(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX inspiration_import_selections_web_result_idx
  ON public.inspiration_import_selections(web_result_id) WHERE web_result_id IS NOT NULL;
CREATE INDEX inspiration_import_selections_ingested_product_idx
  ON public.inspiration_import_selections(ingested_product_id) WHERE ingested_product_id IS NOT NULL;
CREATE INDEX inspiration_import_provider_calls_quota_idx
  ON public.inspiration_import_provider_calls(user_id, operation, reserved_at DESC);
CREATE INDEX inspiration_import_provider_calls_import_idx ON public.inspiration_import_provider_calls(import_id);

CREATE TRIGGER update_inspiration_imports_updated_at
  BEFORE UPDATE ON public.inspiration_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_inspiration_import_selections_updated_at
  BEFORE UPDATE ON public.inspiration_import_selections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.inspiration_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspiration_import_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspiration_import_web_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspiration_import_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspiration_import_provider_calls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inspiration_imports FROM anon, authenticated;
REVOKE ALL ON TABLE public.inspiration_import_candidates FROM anon, authenticated;
REVOKE ALL ON TABLE public.inspiration_import_web_results FROM anon, authenticated;
REVOKE ALL ON TABLE public.inspiration_import_selections FROM anon, authenticated;
REVOKE ALL ON TABLE public.inspiration_import_provider_calls FROM anon, authenticated;

-- Edge Functions use the service-role client through the Data API. Keep these
-- grants explicit because Supabase no longer auto-exposes newly created tables.
REVOKE ALL ON TABLE public.inspiration_imports FROM service_role;
REVOKE ALL ON TABLE public.inspiration_import_candidates FROM service_role;
REVOKE ALL ON TABLE public.inspiration_import_web_results FROM service_role;
REVOKE ALL ON TABLE public.inspiration_import_selections FROM service_role;
REVOKE ALL ON TABLE public.inspiration_import_provider_calls FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.inspiration_imports TO service_role;
GRANT SELECT ON TABLE public.inspiration_import_candidates TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.inspiration_import_web_results TO service_role;
GRANT SELECT ON TABLE public.inspiration_import_selections TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inspiration-imports', 'inspiration-imports', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users upload own inspiration source"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'inspiration-imports'
  AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  AND (storage.foldername(name))[3] = 'source'
  AND storage.filename(name) LIKE 'original.%'
);

CREATE OR REPLACE FUNCTION public.reserve_inspiration_provider_call(
  p_import_id uuid, p_operation text, p_limit integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid := auth.uid(); v_id uuid := gen_random_uuid(); v_count integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF p_operation NOT IN ('detect', 'lens') OR p_limit < 1 THEN
    RAISE EXCEPTION 'invalid_provider_reservation' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inspiration_imports WHERE id = p_import_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_operation, 0));
  DELETE FROM public.inspiration_import_provider_calls
    WHERE user_id = v_user_id AND operation = p_operation AND status = 'reserved' AND expires_at <= now();
  SELECT count(*) INTO v_count FROM public.inspiration_import_provider_calls
    WHERE user_id = v_user_id AND operation = p_operation
      AND (status = 'succeeded' OR expires_at > now())
      AND reserved_at >= now() - interval '24 hours';
  IF v_count >= p_limit THEN RAISE EXCEPTION 'provider_quota_exceeded' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.inspiration_import_provider_calls(id, user_id, import_id, operation)
    VALUES (v_id, v_user_id, p_import_id, p_operation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.complete_inspiration_provider_call(p_reservation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  UPDATE public.inspiration_import_provider_calls SET status = 'succeeded', completed_at = now()
    WHERE id = p_reservation_id AND user_id = auth.uid() AND status = 'reserved';
END $$;

CREATE OR REPLACE FUNCTION public.release_inspiration_provider_call(p_reservation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.inspiration_import_provider_calls
    WHERE id = p_reservation_id AND user_id = auth.uid() AND status = 'reserved';
END $$;

CREATE OR REPLACE FUNCTION public.begin_inspiration_detection(p_import_id uuid, p_lease_seconds integer DEFAULT 600)
RETURNS TABLE(generation integer, attempt_id uuid, source_path text, started boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_import public.inspiration_imports%ROWTYPE; v_attempt uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_import FROM public.inspiration_imports
    WHERE id = p_import_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_import.status = 'detecting' AND v_import.detection_started_at > now() - make_interval(secs => p_lease_seconds) THEN
    RETURN QUERY SELECT v_import.generation, v_import.detection_attempt_id, v_import.source_path, false;
    RETURN;
  END IF;
  IF v_import.status NOT IN ('source_ready', 'failed', 'detecting') THEN
    RAISE EXCEPTION 'invalid_detection_state' USING ERRCODE = 'P0001';
  END IF;
  v_attempt := gen_random_uuid();
  UPDATE public.inspiration_imports SET status = 'detecting', detection_attempt_id = v_attempt,
    detection_started_at = now(), detector_job_id = NULL, error_code = NULL, error_message = NULL
    WHERE id = p_import_id;
  RETURN QUERY SELECT v_import.generation, v_attempt, v_import.source_path, true;
END $$;

CREATE OR REPLACE FUNCTION public.set_inspiration_detector_job(
  p_import_id uuid, p_attempt_id uuid, p_job_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  UPDATE public.inspiration_imports SET detector_job_id = left(p_job_id, 255)
    WHERE id = p_import_id AND user_id = auth.uid() AND status = 'detecting'
      AND detection_attempt_id = p_attempt_id;
END $$;

CREATE OR REPLACE FUNCTION public.select_inspiration_candidate(p_import_id uuid, p_candidate_id uuid)
RETURNS TABLE(selected_candidate_id uuid, category text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_category text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.inspiration_imports
    WHERE id = p_import_id AND user_id = auth.uid() AND status IN ('detected', 'candidate_selected', 'ready')
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_candidate_state' USING ERRCODE = 'P0001'; END IF;
  SELECT c.category INTO v_category FROM public.inspiration_import_candidates c
    JOIN public.inspiration_imports i ON i.id = c.import_id AND i.generation = c.generation
    WHERE c.id = p_candidate_id AND c.import_id = p_import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate_not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.inspiration_import_candidates SET selected_at = NULL
    WHERE import_id = p_import_id AND selected_at IS NOT NULL;
  UPDATE public.inspiration_import_candidates SET selected_at = now()
    WHERE id = p_candidate_id AND import_id = p_import_id;
  DELETE FROM public.inspiration_import_web_results
    WHERE import_id = p_import_id AND candidate_id <> p_candidate_id;
  UPDATE public.inspiration_imports SET status = 'candidate_selected', error_code = NULL, error_message = NULL
    WHERE id = p_import_id;
  RETURN QUERY SELECT p_candidate_id, v_category;
END $$;

CREATE OR REPLACE FUNCTION public.commit_inspiration_import(
  p_import_id uuid, p_catalogue_product_ids text[], p_web_result_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_import public.inspiration_imports%ROWTYPE; v_candidate_id uuid; v_category text;
  v_product_ids text[]; v_existing text[]; v_product_id text; v_web_selection_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_import FROM public.inspiration_imports
    WHERE id = p_import_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT id, category INTO v_candidate_id, v_category FROM public.inspiration_import_candidates
    WHERE import_id = p_import_id AND generation = v_import.generation AND selected_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate_required' USING ERRCODE = 'P0001'; END IF;
  IF v_import.status NOT IN ('candidate_selected', 'ready') THEN
    RAISE EXCEPTION 'invalid_commit_state' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(array_agg(DISTINCT value), ARRAY[]::text[]) INTO v_product_ids
    FROM unnest(coalesce(p_catalogue_product_ids, ARRAY[]::text[])) value;
  IF cardinality(v_product_ids) > 30 THEN RAISE EXCEPTION 'too_many_products' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.products WHERE id = ANY(v_product_ids) AND type::text = v_category) <> cardinality(v_product_ids) THEN
    RAISE EXCEPTION 'invalid_products' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(array_agg(product_id), ARRAY[]::text[]) INTO v_existing
    FROM public.user_favorites
    WHERE user_id = auth.uid() AND collection_slug = 'wardrobe' AND product_id = ANY(v_product_ids);
  FOREACH v_product_id IN ARRAY v_product_ids LOOP
    INSERT INTO public.user_favorites(id, user_id, outfit_id, product_id, collection_slug, collection_label)
      VALUES (gen_random_uuid(), auth.uid(), NULL, v_product_id, 'wardrobe', 'Wardrobe')
      ON CONFLICT (user_id, collection_slug, product_id) DO NOTHING;
    INSERT INTO public.inspiration_import_selections(
      id, import_id, candidate_id, source, product_id, status, wardrobe_added_at
    ) VALUES (gen_random_uuid(), p_import_id, v_candidate_id, 'catalogue', v_product_id, 'added_to_wardrobe', now())
      ON CONFLICT DO NOTHING;
  END LOOP;
  IF p_web_result_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.inspiration_import_web_results
      WHERE id = p_web_result_id AND import_id = p_import_id AND candidate_id = v_candidate_id AND expires_at > now()) THEN
      RAISE EXCEPTION 'invalid_web_result' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.inspiration_import_selections WHERE import_id = p_import_id AND source = 'web';
    v_web_selection_id := gen_random_uuid();
    INSERT INTO public.inspiration_import_selections(
      id, import_id, candidate_id, source, web_result_id, status
    ) VALUES (v_web_selection_id, p_import_id, v_candidate_id, 'web', p_web_result_id, 'selected_for_ingestion');
  END IF;
  UPDATE public.inspiration_imports SET status = 'committed', committed_at = now(), expires_at = NULL,
    error_code = NULL, error_message = NULL WHERE id = p_import_id;
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
  p_import_id uuid, p_generation integer, p_attempt_id uuid, p_reservation_id uuid,
  p_candidates jsonb DEFAULT '[]'::jsonb, p_error_code text DEFAULT NULL, p_error_message text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_import public.inspiration_imports%ROWTYPE; v_candidate jsonb;
BEGIN
  SELECT * INTO v_import FROM public.inspiration_imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND OR v_import.status <> 'detecting' OR v_import.generation <> p_generation
    OR v_import.detection_attempt_id IS DISTINCT FROM p_attempt_id THEN RETURN false; END IF;
  IF p_error_code IS NOT NULL THEN
    UPDATE public.inspiration_imports SET status = 'failed', error_code = left(p_error_code, 80),
      error_message = left(coalesce(p_error_message, 'Garment detection failed'), 300) WHERE id = p_import_id;
    DELETE FROM public.inspiration_import_provider_calls
      WHERE id = p_reservation_id AND import_id = p_import_id AND status = 'reserved';
    RETURN true;
  END IF;
  IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 12 THEN
    RAISE EXCEPTION 'invalid_candidate_payload' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.inspiration_import_candidates
    WHERE import_id = p_import_id AND generation = p_generation;
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
    INSERT INTO public.inspiration_import_candidates(
      id, import_id, generation, category, detector_label, confidence, bbox, box_source,
      display_crop_path, retrieval_crop_path, metrics
    ) VALUES (
      (v_candidate->>'id')::uuid, p_import_id, p_generation, v_candidate->>'category',
      nullif(v_candidate->>'label', ''), (v_candidate->>'confidence')::real,
      v_candidate->'bbox', v_candidate->>'boxSource', v_candidate->>'displayCropPath',
      v_candidate->>'retrievalCropPath', coalesce(v_candidate->'metrics', '{}'::jsonb)
    );
  END LOOP;
  UPDATE public.inspiration_imports SET status = 'detected', error_code = NULL, error_message = NULL
    WHERE id = p_import_id;
  UPDATE public.inspiration_import_provider_calls SET status = 'succeeded', completed_at = now()
    WHERE id = p_reservation_id AND import_id = p_import_id AND operation = 'detect';
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.reserve_inspiration_provider_call(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_inspiration_provider_call(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_inspiration_provider_call(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.begin_inspiration_detection(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_inspiration_detector_job(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.select_inspiration_candidate(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_inspiration_import(uuid, text[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_inspiration_detection(uuid, integer, uuid, uuid, jsonb, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_inspiration_provider_call(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_inspiration_provider_call(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_inspiration_provider_call(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_inspiration_detection(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_inspiration_detector_job(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.select_inspiration_candidate(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_inspiration_import(uuid, text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_inspiration_detection(uuid, integer, uuid, uuid, jsonb, text, text) TO service_role;

COMMENT ON TABLE public.inspiration_import_provider_calls IS
  'Concurrency-safe, rolling-24-hour provider quota reservations; not product workflow sessions.';
COMMENT ON FUNCTION public.finalize_inspiration_detection(uuid, integer, uuid, uuid, jsonb, text, text) IS
  'Service-only compare-and-set finalizer for Modal callbacks.';

-- Automatic retention cleanup is intentionally deferred for the minimal first
-- production deployment. Do not create Vault, pg_net, private-schema, or Cron
-- objects until the cleanup rollout is reviewed separately.
